package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.Platform
import space.affinix.app.epochOfIso
import space.affinix.app.net.Api
import space.affinix.app.net.Conversation
import space.affinix.app.net.ConversationRow
import space.affinix.app.net.Message
import space.affinix.app.net.MessageRow
import space.affinix.app.net.ApiException
import space.affinix.app.net.FoundMessageRow
import space.affinix.app.net.Person
import space.affinix.app.net.PrefRow
import space.affinix.app.net.Quote
import space.affinix.app.net.Reaction
import space.affinix.app.net.UnreadRow

/**
 * 1:1 chats between friends over the website's tables and RPCs (src/lib/messagesStore.js). Messages are text; new ones arrive by asking the server
 * every few seconds while a chat is open (the website uses a live socket; typing and online dots are not in the app). Replies, reactions, edit / delete,
 * pin / mute and the text search use the website's RPCs from migration 0024. Photos need the picker of the platform (see ImagePicker).
 */
class MessagesModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val feed: FeedModel) {
    var conversations by mutableStateOf<List<Conversation>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    var open by mutableStateOf<Conversation?>(null)
        private set
    var thread by mutableStateOf<List<Message>>(emptyList())   // oldest first
        private set
    var threadLoaded by mutableStateOf(false)
        private set
    var hasOlder by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    /** the message the next send answers, and the one being edited (the composer fills with its text) */
    var replyTo by mutableStateOf<Message?>(null)
    var editing by mutableStateOf<Message?>(null)
    var found by mutableStateOf<List<FoundMessage>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set

    val unreadTotal: Long get() = conversations.sumOf { it.unread }

    private fun say(key: String) { notice = key; scope.launch { delay(3500); if (notice == key) notice = null } }

    /** The locale key that words a failed chat call: the server raises short words (edit_expired, not_found, deleted, bad_text, bad_emoji, not_friends). */
    internal fun errorKey(e: Exception): String {
        val word = (e as? ApiException)?.message?.trim().orEmpty()
        if (e is ApiException && (e.status == 404 || word.contains("Could not find the function"))) return "messages.err.updatePending"
        return if (word in KNOWN_ERRORS) "messages.err.$word" else if (e is ApiException) "messages.err.generic" else "app.noNetwork"
    }

    // ---- list -------------------------------------------------------------------------------------------------------------------------

    fun refresh() { scope.launch { refreshNow() } }

    internal suspend fun refreshNow() {
        val uid = me() ?: return
        try {
            val rows = api.restGet("conversations", ListSerializer(ConversationRow.serializer()), "select" to "*", "order" to "last_message_at.desc.nullslast")
            val unread = runCatching { api.rpc("my_unread_counts", buildJsonObject {}, ListSerializer(UnreadRow.serializer())) }.getOrDefault(emptyList())
                .associate { it.conversationId to (it.unread?.content?.toDoubleOrNull()?.toLong() ?: 0L) }
            val prefs = runCatching { api.restGet("conversation_prefs", ListSerializer(PrefRow.serializer()), "select" to "conversation_id,pinned_at,muted") }.getOrDefault(emptyList())
                .associateBy { it.conversationId }
            val people = feed.authors(rows.map { if (it.userA == uid) it.userB else it.userA })
            conversations = rows.map { r ->
                val oid = if (r.userA == uid) r.userB else r.userA
                Conversation(r.id, people[oid] ?: Person(oid, null, null, null), r.lastBody, r.lastAt, r.lastSender, r.lastHasImage, r.lastDeleted,
                    if (open?.id == r.id) 0 else unread[r.id] ?: 0, prefs[r.id]?.pinnedAt != null, prefs[r.id]?.muted == true)
            }.sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { epochOfIso(it.lastAt.orEmpty()) ?: 0L })
            loaded = true; failed = false
        } catch (e: CancellationException) { throw e } catch (e: Exception) { if (!loaded) failed = true }
    }

    // ---- one chat -----------------------------------------------------------------------------------------------------------------------

    fun openChat(c: Conversation) {
        open = c; thread = emptyList(); threadLoaded = false; hasOlder = false; replyTo = null; editing = null
        scope.launch { loadThread(); markRead() }
    }

    fun closeChat() { open = null; thread = emptyList(); replyTo = null; editing = null; refresh() }

    /** Starts (or finds) the chat with a friend and opens it. */
    fun openWith(p: Person) {
        scope.launch {
            try {
                val id = api.rpcText("get_or_create_conversation", buildJsonObject { put("other_id", p.id) }).trim().trim('"')
                refreshNow()
                (conversations.firstOrNull { it.id == id } ?: Conversation(id, p, null, null, null, false, false, 0)).let { openChat(it) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { say("app.noNetwork") }
        }
    }

    private fun map(r: MessageRow) = Message(
        r.id, r.conversationId, r.senderId, r.body.orEmpty(), r.createdAt, r.readAt != null, r.editedAt != null, r.deletedAt != null, r.attachmentPath != null,
        r.reactions.map { Reaction(it.userId, it.emoji) },
        r.reply?.let { Quote(it.id, it.senderId, it.body.orEmpty(), it.attachmentPath != null, it.deletedAt != null) }, r.replyToId,
    )

    /** an older database (before 0024) has no reactions table or reply relation: the plain read still works */
    private var plainOnly = false

    private suspend fun fetchThread(convId: String, before: String? = null): List<Message> {
        fun query(select: String): Array<Pair<String, String>> {
            val q = mutableListOf("select" to select, "conversation_id" to "eq.$convId", "order" to "created_at.desc", "limit" to PAGE.toString())
            if (before != null) q += "created_at" to "lt.$before"
            return q.toTypedArray()
        }
        if (!plainOnly) try {
            return api.restGet("messages", ListSerializer(MessageRow.serializer()), *query(FULL_SELECT)).map(::map).reversed()
        } catch (e: ApiException) { if (e.status !in 400..404) throw e; plainOnly = true }
        return api.restGet("messages", ListSerializer(MessageRow.serializer()), *query("*")).map(::map).reversed()
    }

    internal suspend fun loadThread() {
        val c = open ?: return
        try {
            val fresh = fetchThread(c.id)
            if (open?.id != c.id) return
            val keep = thread.filter { it.status != null && fresh.none { f -> f.id == it.id } } // still being sent / failed
            thread = (fresh + keep).sortedBy { epochOfIso(it.createdAt) ?: Long.MAX_VALUE }
            hasOlder = fresh.size >= PAGE; threadLoaded = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { if (!threadLoaded) say("app.noNetwork") }
    }

    /** What the open chat does every few seconds: new messages, and a read mark for what arrived. */
    fun poll() {
        scope.launch {
            val c = open ?: return@launch
            loadThread()
            if (thread.any { it.senderId != me() && !it.read }) markRead()
        }
    }

    fun loadOlder() {
        val c = open ?: return
        val first = thread.firstOrNull { it.status == null } ?: return
        scope.launch {
            try {
                val older = fetchThread(c.id, first.createdAt)
                val have = thread.map { it.id }.toSet()
                thread = older.filter { it.id !in have } + thread; hasOlder = older.size >= PAGE
            } catch (e: CancellationException) { throw e } catch (e: Exception) { say("app.noNetwork") }
        }
    }

    private suspend fun markRead() {
        val c = open ?: return
        runCatching { api.rpcText("mark_conversation_read", buildJsonObject { put("p_conversation_id", c.id) }) }
        conversations = conversations.map { if (it.id == c.id) it.copy(unread = 0) else it }
    }

    // ---- sending --------------------------------------------------------------------------------------------------------------------

    fun send(text: String) {
        val c = open ?: return
        val body = text.trim().take(4000)
        if (body.isEmpty()) return
        val being = editing
        if (being != null) { editing = null; edit(being, body); return }
        val uid = me() ?: return
        val id = Platform.uuid()
        val now = Platform.nowMillis()
        val to = replyTo
        replyTo = null
        val quote = to?.let { Quote(it.id, it.senderId, it.body, it.hasImage, it.deleted) }
        thread = thread + Message(id, c.id, uid, body, isoOf(now), read = false, edited = false, deleted = false, hasImage = false, reply = quote, replyToId = to?.id, status = "sending")
        deliver(c.id, id, body, to?.id)
    }

    fun retry(m: Message) {
        thread = thread.map { if (it.id == m.id) it.copy(status = "sending") else it }
        deliver(m.conversationId, m.id, m.body, m.replyToId)
    }

    private fun deliver(convId: String, id: String, body: String, replyToId: String? = null) {
        scope.launch {
            try {
                val written = api.restWrite(HttpMethod.Post, "messages", body = buildJsonObject {
                    put("id", id); put("conversation_id", convId); put("body", body); if (replyToId != null) put("reply_to_id", replyToId)
                }, returning = true)
                val row = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; isLenient = true }.decodeFromString(ListSerializer(MessageRow.serializer()), written).firstOrNull()
                thread = thread.map { if (it.id == id) (row?.let { r -> map(r).copy(reply = it.reply) } ?: it.copy(status = null)) else it }.sortedBy { epochOfIso(it.createdAt) ?: Long.MAX_VALUE }
                conversations = conversations.map { if (it.id == convId) it.copy(lastBody = body.take(140), lastAt = row?.createdAt ?: it.lastAt, lastSender = me(), unread = 0) else it }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                thread = thread.map { if (it.id == id) it.copy(status = "failed") else it }
            }
        }
    }

    // ---- actions on a message ---------------------------------------------------------------------------------------------------

    private fun patch(id: String, f: (Message) -> Message) { thread = thread.map { if (it.id == id) f(it) else it } }

    fun canEdit(m: Message): Boolean = m.senderId == me() && !m.deleted && m.status == null && !m.hasImage &&
        (epochOfIso(m.createdAt)?.let { Platform.nowMillis() - it <= EDIT_WINDOW_MS } ?: false)

    /** Edits my own text message; shows the new text at once and puts the old one back if the server refuses. */
    fun edit(m: Message, raw: String) {
        val body = raw.trim().take(4000)
        if (m.senderId != me() || m.deleted || m.status != null) return
        if (body.isEmpty() || body == m.body) return
        if (Platform.nowMillis() - (epochOfIso(m.createdAt) ?: 0L) > EDIT_WINDOW_MS) { say("messages.err.edit_expired"); return }
        val c = open ?: return
        val isLast = conversations.firstOrNull { it.id == c.id }?.lastAt == m.createdAt
        patch(m.id) { it.copy(body = body, edited = true) }
        if (isLast) conversations = conversations.map { if (it.id == c.id) it.copy(lastBody = body.take(140)) else it }
        scope.launch {
            try { api.rpcText("edit_message", buildJsonObject { put("p_message_id", m.id); put("p_body", body) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) {
                patch(m.id) { m }
                if (isLast) conversations = conversations.map { if (it.id == c.id) it.copy(lastBody = m.body.take(140)) else it }
                say(errorKey(e))
            }
        }
    }

    /** Deletes my message for both people (one that never left this device is only dropped). */
    fun delete(m: Message) {
        if (m.senderId != me()) return
        if (m.status != null) { thread = thread.filter { it.id != m.id }; return }
        val c = open ?: return
        val isLast = conversations.firstOrNull { it.id == c.id }?.lastAt == m.createdAt
        patch(m.id) { it.copy(body = "", deleted = true, hasImage = false, reactions = emptyList()) }
        if (isLast) conversations = conversations.map { if (it.id == c.id) it.copy(lastBody = "", lastHasImage = false, lastDeleted = true) else it }
        scope.launch {
            try { api.rpcText("delete_message", buildJsonObject { put("p_message_id", m.id) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) {
                patch(m.id) { m }
                if (isLast) conversations = conversations.map { if (it.id == c.id) it.copy(lastBody = m.body.take(140), lastHasImage = m.hasImage, lastDeleted = false) else it }
                say(errorKey(e))
            }
        }
    }

    /** One reaction per person; the same emoji again takes it back. */
    fun react(m: Message, emoji: String) {
        val uid = me() ?: return
        if (m.deleted || m.status != null || emoji !in REACTIONS) return
        val next = if (m.reactions.firstOrNull { it.userId == uid }?.emoji == emoji) null else emoji
        patch(m.id) { it.copy(reactions = it.reactions.filter { r -> r.userId != uid } + listOfNotNull(next?.let { e -> Reaction(uid, e) })) }
        scope.launch {
            try { api.rpcText("react_to_message", buildJsonObject { put("p_message_id", m.id); put("p_emoji", next?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { patch(m.id) { cur -> cur.copy(reactions = m.reactions) }; say(errorKey(e)) }
        }
    }

    /** Pin or mute a chat (only for me); a field left null stays as it is. */
    fun setPref(c: Conversation, pinned: Boolean? = null, muted: Boolean? = null) {
        fun apply(p: Boolean, mu: Boolean) {
            conversations = conversations.map { if (it.id == c.id) it.copy(pinned = p, muted = mu) else it }
                .sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { epochOfIso(it.lastAt.orEmpty()) ?: 0L })
            if (open?.id == c.id) open = open?.copy(pinned = p, muted = mu)
        }
        apply(pinned ?: c.pinned, muted ?: c.muted)
        scope.launch {
            try {
                api.rpcText("set_conversation_pref", buildJsonObject {
                    put("p_conversation_id", c.id)
                    put("p_pinned", pinned?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
                    put("p_muted", muted?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
                })
            } catch (e: CancellationException) { throw e } catch (e: Exception) { apply(c.pinned, c.muted); say(errorKey(e)) }
        }
    }

    // ---- search the text of my chats -------------------------------------------------------------------------------------------

    fun searchText(query: String) {
        val q = query.trim()
        if (q.length < 2) { found = emptyList(); searching = false; return }
        searching = true
        scope.launch {
            try {
                val rows = api.rpc("search_messages", buildJsonObject { put("p_query", q); put("p_limit", 30) }, ListSerializer(FoundMessageRow.serializer()))
                found = rows.map { r ->
                    val c = conversations.firstOrNull { it.id == r.conversationId }
                    FoundMessage(r.messageId, r.conversationId, c?.other, r.body, r.createdAt, r.senderId == me())
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { found = emptyList(); say(errorKey(e)) }
            searching = false
        }
    }

    fun clearSearch() { found = emptyList(); searching = false }

    /** Opens the chat a found message belongs to. */
    fun openFound(f: FoundMessage) { conversations.firstOrNull { it.id == f.conversationId }?.let { openChat(it) } }

    private fun isoOf(ms: Long): String {
        val days = ms.floorDiv(86_400_000L); val (y, mo, d) = space.affinix.app.civil(days)
        val s = (ms - days * 86_400_000L) / 1000
        fun two(n: Long) = n.toString().padStart(2, '0')
        return "$y-${two(mo.toLong())}-${two(d.toLong())}T${two(s / 3600)}:${two(s / 60 % 60)}:${two(s % 60)}Z"
    }

    companion object {
        const val PAGE = 40
        const val EDIT_WINDOW_MS = 48L * 3600 * 1000
        val REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")
        private val KNOWN_ERRORS = setOf("edit_expired", "not_found", "deleted", "bad_text", "bad_emoji", "not_friends")
        private const val FULL_SELECT = "*,reactions:message_reactions(user_id,emoji),reply:messages!reply_to_id(id,sender_id,body,attachment_path,deleted_at)"
    }
}

/** One hit of the text search over my chats. */
data class FoundMessage(val id: String, val conversationId: String, val other: Person?, val body: String, val createdAt: String, val mine: Boolean)
