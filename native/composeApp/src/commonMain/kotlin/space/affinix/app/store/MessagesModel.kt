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
import space.affinix.app.net.Person
import space.affinix.app.net.UnreadRow

/**
 * 1:1 chats between friends over the website's tables and RPCs (src/lib/messagesStore.js). Messages are text; new ones arrive by asking the server
 * every few seconds while a chat is open (the website uses a live socket; photos, replies, reactions, typing and online dots are not in the app yet).
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

    val unreadTotal: Long get() = conversations.sumOf { it.unread }

    private fun say(key: String) { notice = key; scope.launch { delay(3500); if (notice == key) notice = null } }

    // ---- list -------------------------------------------------------------------------------------------------------------------------

    fun refresh() { scope.launch { refreshNow() } }

    internal suspend fun refreshNow() {
        val uid = me() ?: return
        try {
            val rows = api.restGet("conversations", ListSerializer(ConversationRow.serializer()), "select" to "*", "order" to "last_message_at.desc.nullslast")
            val unread = runCatching { api.rpc("my_unread_counts", buildJsonObject {}, ListSerializer(UnreadRow.serializer())) }.getOrDefault(emptyList())
                .associate { it.conversationId to (it.unread?.content?.toDoubleOrNull()?.toLong() ?: 0L) }
            val people = feed.authors(rows.map { if (it.userA == uid) it.userB else it.userA })
            conversations = rows.map { r ->
                val oid = if (r.userA == uid) r.userB else r.userA
                Conversation(r.id, people[oid] ?: Person(oid, null, null, null), r.lastBody, r.lastAt, r.lastSender, r.lastHasImage, r.lastDeleted,
                    if (open?.id == r.id) 0 else unread[r.id] ?: 0)
            }
            loaded = true; failed = false
        } catch (e: CancellationException) { throw e } catch (e: Exception) { if (!loaded) failed = true }
    }

    // ---- one chat -----------------------------------------------------------------------------------------------------------------------

    fun openChat(c: Conversation) {
        open = c; thread = emptyList(); threadLoaded = false; hasOlder = false
        scope.launch { loadThread(); markRead() }
    }

    fun closeChat() { open = null; thread = emptyList(); refresh() }

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
    )

    private suspend fun fetchThread(convId: String, before: String? = null): List<Message> {
        val q = mutableListOf("select" to "*", "conversation_id" to "eq.$convId", "order" to "created_at.desc", "limit" to PAGE.toString())
        if (before != null) q += "created_at" to "lt.$before"
        return api.restGet("messages", ListSerializer(MessageRow.serializer()), *q.toTypedArray()).map(::map).reversed()
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
        val body = text.trim()
        if (body.isEmpty()) return
        val uid = me() ?: return
        val id = Platform.uuid()
        val now = Platform.nowMillis()
        thread = thread + Message(id, c.id, uid, body, isoOf(now), read = false, edited = false, deleted = false, hasImage = false, status = "sending")
        deliver(c.id, id, body)
    }

    fun retry(m: Message) {
        thread = thread.map { if (it.id == m.id) it.copy(status = "sending") else it }
        deliver(m.conversationId, m.id, m.body)
    }

    private fun deliver(convId: String, id: String, body: String) {
        scope.launch {
            try {
                val written = api.restWrite(HttpMethod.Post, "messages", body = buildJsonObject { put("id", id); put("conversation_id", convId); put("body", body) }, returning = true)
                val row = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; isLenient = true }.decodeFromString(ListSerializer(MessageRow.serializer()), written).firstOrNull()
                thread = thread.map { if (it.id == id) (row?.let(::map) ?: it.copy(status = null)) else it }.sortedBy { epochOfIso(it.createdAt) ?: Long.MAX_VALUE }
                conversations = conversations.map { if (it.id == convId) it.copy(lastBody = body.take(140), lastAt = row?.createdAt ?: it.lastAt, lastSender = me(), unread = 0) else it }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                thread = thread.map { if (it.id == id) it.copy(status = "failed") else it }
            }
        }
    }

    private fun isoOf(ms: Long): String {
        val days = ms.floorDiv(86_400_000L); val (y, mo, d) = space.affinix.app.civil(days)
        val s = (ms - days * 86_400_000L) / 1000
        fun two(n: Long) = n.toString().padStart(2, '0')
        return "$y-${two(mo.toLong())}-${two(d.toLong())}T${two(s / 3600)}:${two(s / 60 % 60)}:${two(s % 60)}Z"
    }

    companion object { const val PAGE = 40 }
}
