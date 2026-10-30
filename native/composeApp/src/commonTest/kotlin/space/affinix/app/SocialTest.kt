package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.FeedModel
import space.affinix.app.store.MessagesModel
import space.affinix.app.store.PeopleModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val jsonH = headersOf(HttpHeaders.ContentType, "application/json")

/** Real time wait for something a coroutine on another thread does (the mock engine answers on its own thread). */
private suspend fun until(cond: () -> Boolean) = withContext(Dispatchers.Default) { withTimeout(5000) { while (!cond()) delay(10) } }

private class Rig(
    val handler: (method: String, path: String, query: String, body: String) -> String,
    val failWrites: () -> Boolean = { false },
    /** a short word the server refuses a call with (HTTP 400, {"message": word}); null = answer normally */
    val reject: (method: String, path: String, query: String) -> String? = { _, _, _ -> null },
) {
    val seen = mutableListOf<String>()
    val api: Api
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    init {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            val line = "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $body"
            synchronized(seen) { seen += line }
            val refused = reject(req.method.value, req.url.encodedPath, req.url.encodedQuery)
            if (refused != null) {
                // "message|hint": a database function that raised with a hint
                val parts = refused.split("|")
                respond("""{"message":"${parts[0]}"${if (parts.size > 1) ""","hint":"${parts[1]}"""" else ""}}""", HttpStatusCode.BadRequest, jsonH)
            }
            else if (failWrites() && req.method.value != "GET") respond("""{"message":"boom"}""", HttpStatusCode.InternalServerError, jsonH)
            else respond(handler(req.method.value, req.url.encodedPath, req.url.encodedQuery, body), HttpStatusCode.OK, jsonH)
        }
        api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
    }
    val feed = FeedModel(api, scope) { "me" }
    val people = PeopleModel(api, scope, { "me" }, feed)
    val messages = MessagesModel(api, scope, { "me" }, feed)
    val notifications = space.affinix.app.store.NotificationsModel(api, scope, { "me" }, feed)
    val search = space.affinix.app.store.SearchModel(api, scope, feed, people)
    var xp = 500L
    val crowd = space.affinix.app.store.CrowdModel(api, scope, { "me" }, { xp })
    val app by lazy { space.affinix.app.store.AppModel(api, scope, space.affinix.app.net.MemoryKeyValueStore()) }
    fun log() = synchronized(seen) { seen.toList() }
}

private const val PROFILES = """[{"id":"u2","full_name":"Dias","username":"dias","avatar_url":null},{"id":"u3","full_name":"Aigerim","username":"aigerim"},{"id":"u4","full_name":"Dina D","username":"dd"},{"id":"me","full_name":"Me","username":"me"}]"""

class PeopleTest {
    private val friendships = """[
        {"id":"f1","requester_id":"me","addressee_id":"u2","status":"accepted","created_at":"2026-10-01T10:00:00+00:00"},
        {"id":"f2","requester_id":"u3","addressee_id":"me","status":"pending","created_at":"2026-10-02T10:00:00+00:00"},
        {"id":"f3","requester_id":"me","addressee_id":"u4","status":"pending","created_at":"2026-10-03T10:00:00+00:00"}]"""

    private fun rig() = Rig({ _, path, _, _ -> if (path.endsWith("/friendships")) friendships else if (path.endsWith("/profiles_public")) PROFILES else "[]" })

    @Test fun friendshipsAreSplitIntoFriendsIncomingAndOutgoing() = runTest {
        val r = rig()
        r.people.loadNow()
        assertEquals(listOf("Dias"), r.people.friends.map { it.other.name })
        assertEquals(listOf("Aigerim"), r.people.incoming.map { it.other.name })
        assertEquals(listOf("Dina D"), r.people.outgoing.map { it.other.name })
        assertTrue(r.people.outgoing.single().iRequested)
        assertTrue(r.log().first { it.contains("/friendships?") }.contains("or=%28requester_id.eq.me%2Caddressee_id.eq.me%29") || r.log().first { it.contains("/friendships?") }.contains("requester_id.eq.me"))
        assertEquals("f1", r.people.relation("u2")?.id)
        assertNull(r.people.relation("nobody"))
    }

    @Test fun cleanQueryDropsAtSignsWildcardsAndQuotes() {
        val p = rig().people
        assertEquals("dias", p.clean("@dias"))
        assertEquals("a b", p.clean("  a   \"b\"  ".replace("\"", " ")))
        assertEquals("ab", p.clean("*a*b".replace("*a*b", "*ab")).replace(" ", ""))
        assertEquals(40, p.clean("x".repeat(100)).length)
    }

    @Test fun searchPutsTheExactUsernameFirstAndNeverListsTheViewer() = runTest {
        val r = rig()
        val found = r.people.runSearch("dias")
        assertEquals("Dias", found.first().name)
        assertTrue(found.none { it.id == "me" })
        val queries = r.log().filter { it.contains("/profiles_public?") }
        assertEquals(3, queries.size) // by name, by username prefix, by username substring
        assertTrue(queries.any { it.contains("full_name.ilike") } && queries.any { it.contains("username=ilike") }, queries.toString())
    }

    @Test fun aMultiWordSearchOnlyLooksAtNames() = runTest {
        val r = rig()
        r.people.runSearch("dina d")
        assertEquals(1, r.log().count { it.contains("/profiles_public?") })
    }

    @Test fun sendingARequestCallsTheSameRpcAsTheWebsite() = runTest {
        val r = rig()
        r.people.send("u9")
        until { r.log().any { it.contains("/rpc/send_friend_request") } }
        assertTrue(r.log().first { it.contains("/rpc/send_friend_request") }.contains("\"target_id\":\"u9\""))
    }
}

class MessagesTest {
    private val convs = """[{"id":"c1","user_a":"me","user_b":"u2","last_message_body":"see you","last_message_at":"2026-10-30T09:00:00+00:00","last_message_sender_id":"u2"},
        {"id":"c2","user_a":"u3","user_b":"me","last_message_body":null,"last_message_at":null}]"""
    private val thread = """[{"id":"m2","conversation_id":"c1","sender_id":"u2","body":"see you","created_at":"2026-10-30T09:00:00+00:00","read_at":null},
        {"id":"m1","conversation_id":"c1","sender_id":"me","body":"hi","created_at":"2026-10-30T08:59:00+00:00","read_at":"2026-10-30T08:59:30+00:00"}]"""

    private fun rig(fail: () -> Boolean = { false }) = Rig({ m, path, _, body ->
        when {
            path.endsWith("/conversations") -> convs
            path.endsWith("/rpc/my_unread_counts") -> """[{"conversation_id":"c1","unread":2},{"conversation_id":"c2","unread":"1"}]"""
            path.endsWith("/profiles_public") -> PROFILES
            path.endsWith("/rpc/get_or_create_conversation") -> "\"c1\""
            path.endsWith("/messages") && m == "GET" -> thread
            path.endsWith("/messages") && m == "POST" -> """[{"id":"${Regex("\"id\":\"([^\"]+)\"").find(body)!!.groupValues[1]}","conversation_id":"c1","sender_id":"me","body":"hello","created_at":"2026-10-30T09:05:00+00:00"}]"""
            else -> "null"
        }
    }, fail)

    @Test fun theListJoinsPeopleAndCountsUnreadWhetherNumberOrString() = runTest {
        val r = rig()
        r.messages.refreshNow()
        assertEquals(listOf("Dias", "Aigerim"), r.messages.conversations.map { it.other.name })
        assertEquals(listOf(2L, 1L), r.messages.conversations.map { it.unread })
        assertEquals(3L, r.messages.unreadTotal)
    }

    @Test fun openingAChatReadsTheLatestMessagesOldestFirstAndMarksThemRead() = runTest {
        val r = rig()
        r.messages.refreshNow()
        r.messages.openChat(r.messages.conversations[0])
        until { r.messages.threadLoaded }
        assertEquals(listOf("m1", "m2"), r.messages.thread.map { it.id })
        assertTrue(r.messages.thread[0].read && !r.messages.thread[1].read)
        until { r.log().any { it.contains("/rpc/mark_conversation_read") } }
        assertEquals(0L, r.messages.conversations[0].unread)
    }

    @Test fun aSentMessageShowsAtOnceThenIsConfirmedByTheServer() = runTest {
        val r = rig()
        r.messages.refreshNow(); r.messages.openChat(r.messages.conversations[0]); until { r.messages.threadLoaded }
        r.messages.send("  hello  ")
        assertEquals("sending", r.messages.thread.last().status)
        assertEquals("hello", r.messages.thread.last().body)
        until { r.messages.thread.none { it.status != null } }
        assertEquals("2026-10-30T09:05:00+00:00", r.messages.thread.last().createdAt)
        val post = r.log().first { it.startsWith("POST") && it.contains("/messages?") || it.startsWith("POST /rest/v1/messages") }
        assertTrue(post.contains("\"conversation_id\":\"c1\"") && post.contains("\"body\":\"hello\""), post)
    }

    @Test fun aFailedSendCanBeRetried() = runTest {
        var down = true
        val r = rig { down }
        r.messages.refreshNow(); r.messages.openChat(r.messages.conversations[0]); until { r.messages.threadLoaded }
        r.messages.send("later")
        until { r.messages.thread.last().status == "failed" }
        down = false
        r.messages.retry(r.messages.thread.last())
        until { r.messages.thread.none { it.status != null } }
        assertTrue(r.messages.thread.none { it.status != null })
    }

    @Test fun startingAChatWithAFriendOpensIt() = runTest {
        val r = rig()
        r.messages.openWith(r.people.run { space.affinix.app.net.Person("u2", "Dias", "dias", null) })
        until { r.messages.open != null }
        assertEquals("c1", r.messages.open?.id)
    }

    @Test fun emptyMessagesAreNotSent() = runTest {
        val r = rig()
        r.messages.refreshNow(); r.messages.openChat(r.messages.conversations[0]); until { r.messages.threadLoaded }
        r.messages.send("   ")
        assertTrue(r.messages.thread.none { it.status == "sending" })
    }
}

class ProfileTest {
    private fun rig() = Rig({ _, path, _, _ -> if (path.endsWith("/profiles")) """[{"full_name":"Me","username":"me","role_title":"","bio":""}]""" else "{}" })

    @Test fun usernameRuleIsTheWebsites() {
        val a = rig().app
        assertTrue(a.usernameOk("") && a.usernameOk("nurlan") && a.usernameOk("a_b_9") && a.usernameOk("x".repeat(30)))
        assertTrue(!a.usernameOk("ab") && !a.usernameOk("Nurlan") && !a.usernameOk("has space") && !a.usernameOk("x".repeat(31)) && !a.usernameOk("қазақ"))
    }

    @Test fun savingSendsOneTrimmedPatchWithALowerCaseUsername() = runTest {
        val r = rig()
        assertNull(r.app.saveMyProfile("  Nurlan K  ", " NurLan ", " Head of Research ", "  Hi there  "))
        val patch = r.log().first { it.startsWith("PATCH") }
        assertTrue(patch.contains("/profiles?id=eq.me"), patch)
        assertTrue(patch.contains("\"full_name\":\"Nurlan K\"") && patch.contains("\"username\":\"nurlan\"") && patch.contains("\"role_title\":\"Head of Research\"") && patch.contains("\"bio\":\"Hi there\""), patch)
        assertEquals("nurlan", r.app.myProfile?.username)
    }

    @Test fun anInvalidUsernameIsRefusedBeforeAnythingIsSent() = runTest {
        val r = rig()
        assertEquals("profile.personal.usernameInvalid", r.app.saveMyProfile("A", "No Good", "", ""))
        assertTrue(r.log().none { it.startsWith("PATCH") })
    }

    @Test fun anEmptyUsernameIsSentAsNull() = runTest {
        val r = rig()
        assertNull(r.app.saveMyProfile("A", "", "", ""))
        assertTrue(r.log().first { it.startsWith("PATCH") }.contains("\"username\":null"))
    }

    @Test fun savedPostsComeInTheOrderTheyWereSaved() = runTest {
        val r = Rig({ _, path, _, _ ->
            when {
                path.endsWith("/post_saves") -> """[{"post_id":"p2"},{"post_id":"p1"}]"""
                path.endsWith("/posts") -> """[{"id":"p1","author_id":"u2","body":"one","created_at":"2026-10-01T00:00:00+00:00","post_likes":[{"count":0}],"post_comments":[{"count":0}]},{"id":"p2","author_id":"u2","body":"two","created_at":"2026-10-02T00:00:00+00:00","post_likes":[{"count":0}],"post_comments":[{"count":0}]}]"""
                path.endsWith("/profiles_public") -> PROFILES
                else -> "[]"
            }
        })
        r.feed.showMode(2)
        until { r.feed.loaded }
        assertEquals(listOf("p2", "p1"), r.feed.posts.map { it.id })
        assertTrue(r.feed.posts.all { it.saved })
        assertTrue(!r.feed.hasMore)
    }
}

class NotificationsTest {
    private val rows = """[{"id":"n1","type":"comment","post_id":"p1","actor_id":"u2","is_read":false,"created_at":"2026-10-30T09:00:00+00:00","comment":{"body":"Nice work"}},
        {"id":"n2","type":"friend_request","actor_id":"u3","is_read":true,"created_at":"2026-10-29T09:00:00+00:00","comment":null},
        {"id":"n3","actor_id":"u2","is_read":false,"created_at":"2026-10-28T09:00:00+00:00"}]"""
    private fun rig() = Rig({ _, path, _, _ -> if (path.endsWith("/notifications")) rows else if (path.endsWith("/profiles_public")) PROFILES else "[]" })

    @Test fun theBellReadsMyNotificationsWithTheirActorsAndCounts() = runTest {
        val r = rig()
        r.notifications.refreshNow()
        assertEquals(listOf("n1", "n2", "n3"), r.notifications.items.map { it.id })
        assertEquals(listOf("comment", "friend_request", "comment"), r.notifications.items.map { it.type }) // a missing type is a comment, as on the website
        assertEquals("Dias", r.notifications.items[0].actor.name); assertEquals("Nice work", r.notifications.items[0].commentBody)
        assertEquals(2, r.notifications.unread)
        assertTrue(r.log().first { it.contains("/notifications?") }.contains("recipient_id=eq.me"))
    }

    @Test fun oneCopyKeyPerKindLikeTheWebsite() {
        val n = rig().notifications
        assertEquals("shell.notifications.friendRequest", n.copyKey("friend_request"))
        assertEquals("shell.notifications.friendAccepted", n.copyKey("friend_accept"))
        assertEquals("shell.notifications.commentOn", n.copyKey("comment"))
    }

    @Test fun markingReadShowsAtOnceAndPatchesOnlyMyUnreadOnes() = runTest {
        val r = rig()
        r.notifications.refreshNow()
        r.notifications.markAllRead()
        assertEquals(0, r.notifications.unread)
        until { r.log().any { it.startsWith("PATCH") } }
        val patch = r.log().first { it.startsWith("PATCH") }
        assertTrue(patch.contains("recipient_id=eq.me") && patch.contains("is_read=eq.false") && patch.contains("\"is_read\":true"), patch)
    }
}


/** now as the server writes it, so "within 48 hours" holds whatever day the tests run */
private fun isoNow(minusMs: Long = 0): String {
    val ms = Platform.nowMillis() - minusMs
    val days = ms.floorDiv(86_400_000L); val (y, mo, d) = civil(days)
    val s = (ms - days * 86_400_000L) / 1000
    fun two(n: Long) = n.toString().padStart(2, '0')
    return "$y-${two(mo.toLong())}-${two(d.toLong())}T${two(s / 3600)}:${two(s / 60 % 60)}:${two(s % 60)}+00:00"
}

class ChatActionsTest {
    private val convs = """[{"id":"c1","user_a":"me","user_b":"u2","last_message_body":"mine","last_message_at":"__NOW__","last_message_sender_id":"me"},
        {"id":"c2","user_a":"u3","user_b":"me","last_message_body":"hello","last_message_at":"2000-01-01T00:00:00+00:00","last_message_sender_id":"u3"}]"""
    private fun thread(now: String = isoNow(), old: String = isoNow(49L * 3600 * 1000)) = """[
        {"id":"m3","conversation_id":"c1","sender_id":"me","body":"mine","created_at":"$now","reply_to_id":"m2",
         "reply":{"id":"m2","sender_id":"u2","body":"see you","attachment_path":null,"deleted_at":null},
         "reactions":[{"user_id":"u2","emoji":"❤️"}]},
        {"id":"m2","conversation_id":"c1","sender_id":"u2","body":"see you","created_at":"${isoNow(60_000)}","reactions":[]},
        {"id":"m1","conversation_id":"c1","sender_id":"me","body":"old one","created_at":"$old","reactions":[]}]"""

    private fun rig(
        prefs: String = "[]",
        reject: (String, String, String) -> String? = { _, _, _ -> null },
    ) = Rig({ m, path, _, body ->
        when {
            path.endsWith("/conversations") -> convs.replace("__NOW__", isoNow())
            path.endsWith("/conversation_prefs") -> prefs
            path.endsWith("/rpc/my_unread_counts") -> "[]"
            path.endsWith("/profiles_public") -> PROFILES
            path.endsWith("/rpc/search_messages") -> """[{"message_id":"m2","conversation_id":"c1","sender_id":"u2","body":"see you","created_at":"${isoNow()}"}]"""
            path.endsWith("/messages") && m == "GET" -> thread()
            path.endsWith("/messages") && m == "POST" -> """[{"id":"${Regex("\"id\":\"([^\"]+)\"").find(body)!!.groupValues[1]}","conversation_id":"c1","sender_id":"me","body":"ok","created_at":"${isoNow()}","reply_to_id":"m2"}]"""
            else -> "null"
        }
    }, reject = reject)

    private suspend fun open(r: Rig) { r.messages.refreshNow(); r.messages.openChat(r.messages.conversations.first { it.id == "c1" }); until { r.messages.threadLoaded } }

    @Test fun theThreadCarriesReactionsAndTheQuotedMessage() = runTest {
        val r = rig(); open(r)
        val m3 = r.messages.thread.first { it.id == "m3" }
        assertEquals(listOf("❤️"), m3.reactions.map { it.emoji })
        assertEquals("see you", m3.reply?.text)
        assertEquals("u2", m3.reply?.senderId)
        assertTrue(r.log().first { it.contains("/messages?") }.contains("message_reactions"))
    }

    @Test fun reactingShowsAtOnceAndCallsTheSameRpcAsTheWebsite() = runTest {
        val r = rig(); open(r)
        val m2 = r.messages.thread.first { it.id == "m2" }
        r.messages.react(m2, "👍")
        assertEquals(listOf("👍"), r.messages.thread.first { it.id == "m2" }.reactions.map { it.emoji })
        until { r.log().any { it.contains("/rpc/react_to_message") } }
        val call = r.log().first { it.contains("/rpc/react_to_message") }
        assertTrue(call.contains("\"p_message_id\":\"m2\"") && call.contains("\"p_emoji\":\"👍\""), call)
        // the same emoji again takes it back: the website sends null
        r.messages.react(r.messages.thread.first { it.id == "m2" }, "👍")
        assertTrue(r.messages.thread.first { it.id == "m2" }.reactions.isEmpty())
        until { r.log().count { it.contains("/rpc/react_to_message") } == 2 }
        assertTrue(r.log().last { it.contains("/rpc/react_to_message") }.contains("\"p_emoji\":null"))
    }

    @Test fun aRefusedReactionIsTakenBackAndTheReasonIsShown() = runTest {
        val r = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/react_to_message")) "not_friends" else null }); open(r)
        r.messages.react(r.messages.thread.first { it.id == "m2" }, "🙏")
        until { r.messages.notice != null }
        assertEquals("messages.err.not_friends", r.messages.notice)
        assertTrue(r.messages.thread.first { it.id == "m2" }.reactions.isEmpty())
    }

    @Test fun anUnknownEmojiNeverLeavesTheDevice() = runTest {
        val r = rig(); open(r)
        r.messages.react(r.messages.thread.first { it.id == "m2" }, "💩")
        assertTrue(r.log().none { it.contains("/rpc/react_to_message") })
    }

    @Test fun editingChangesTheTextAndMarksItEdited() = runTest {
        val r = rig(); open(r)
        val m3 = r.messages.thread.first { it.id == "m3" }
        assertTrue(r.messages.canEdit(m3))
        r.messages.edit(m3, "  fixed  ")
        assertEquals("fixed", r.messages.thread.first { it.id == "m3" }.body)
        assertTrue(r.messages.thread.first { it.id == "m3" }.edited)
        until { r.log().any { it.contains("/rpc/edit_message") } }
        assertTrue(r.log().first { it.contains("/rpc/edit_message") }.contains("\"p_body\":\"fixed\""))
    }

    @Test fun aMessageOlderThan48HoursCannotBeEditedAndNothingIsSent() = runTest {
        val r = rig(); open(r)
        val old = r.messages.thread.first { it.id == "m1" }
        assertTrue(!r.messages.canEdit(old))
        r.messages.edit(old, "late")
        assertEquals("messages.err.edit_expired", r.messages.notice)
        assertEquals("old one", r.messages.thread.first { it.id == "m1" }.body)
        assertTrue(r.log().none { it.contains("/rpc/edit_message") })
    }

    @Test fun otherPeoplesMessagesCannotBeEditedOrDeleted() = runTest {
        val r = rig(); open(r)
        val theirs = r.messages.thread.first { it.id == "m2" }
        assertTrue(!r.messages.canEdit(theirs))
        r.messages.edit(theirs, "x"); r.messages.delete(theirs)
        assertTrue(r.log().none { it.contains("/rpc/edit_message") || it.contains("/rpc/delete_message") })
    }

    @Test fun deletingBlanksTheMessageAndAFailureBringsItBack() = runTest {
        val r = rig(); open(r)
        r.messages.delete(r.messages.thread.first { it.id == "m3" })
        assertTrue(r.messages.thread.first { it.id == "m3" }.deleted)
        assertEquals("", r.messages.thread.first { it.id == "m3" }.body)
        until { r.log().any { it.contains("/rpc/delete_message") } }

        val bad = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/delete_message")) "not_found" else null }); open(bad)
        bad.messages.delete(bad.messages.thread.first { it.id == "m3" })
        until { bad.messages.notice != null }
        assertTrue(!bad.messages.thread.first { it.id == "m3" }.deleted)
        assertEquals("mine", bad.messages.thread.first { it.id == "m3" }.body)
    }

    @Test fun aReplyCarriesTheIdOfTheMessageItAnswers() = runTest {
        val r = rig(); open(r)
        r.messages.replyTo = r.messages.thread.first { it.id == "m2" }
        r.messages.send("ok")
        assertEquals("m2", r.messages.thread.last().replyToId)
        assertEquals("see you", r.messages.thread.last().reply?.text)
        assertNull(r.messages.replyTo)
        until { r.messages.thread.none { it.status != null } }
        assertTrue(r.log().first { it.startsWith("POST") && it.contains("/messages") }.contains("\"reply_to_id\":\"m2\""))
        assertEquals("see you", r.messages.thread.last().reply?.text) // the quote survives the server's answer
    }

    @Test fun sendingWhileEditingEditsInsteadOfSendingANewMessage() = runTest {
        val r = rig(); open(r)
        r.messages.editing = r.messages.thread.first { it.id == "m3" }
        r.messages.send("changed")
        assertNull(r.messages.editing)
        until { r.log().any { it.contains("/rpc/edit_message") } }
        assertTrue(r.log().none { it.startsWith("POST") && it.contains("/rest/v1/messages") })
    }

    @Test fun pinnedChatsComeFirstAndMutedOnesAreMarked() = runTest {
        val r = rig(prefs = """[{"conversation_id":"c2","pinned_at":"2026-10-01T00:00:00+00:00","muted":true}]""")
        r.messages.refreshNow()
        assertEquals(listOf("c2", "c1"), r.messages.conversations.map { it.id })
        assertTrue(r.messages.conversations[0].pinned && r.messages.conversations[0].muted)
    }

    @Test fun pinningCallsTheRpcAndReordersAtOnce() = runTest {
        val r = rig(); r.messages.refreshNow()
        val c2 = r.messages.conversations.first { it.id == "c2" }
        r.messages.setPref(c2, pinned = true)
        assertEquals("c2", r.messages.conversations.first().id)
        until { r.log().any { it.contains("/rpc/set_conversation_pref") } }
        val call = r.log().first { it.contains("/rpc/set_conversation_pref") }
        assertTrue(call.contains("\"p_pinned\":true") && call.contains("\"p_muted\":null"), call)
    }

    @Test fun searchFindsMessagesByTheirText() = runTest {
        val r = rig(); r.messages.refreshNow()
        r.messages.searchText("see")
        until { r.messages.found.isNotEmpty() }
        assertEquals("c1", r.messages.found.single().conversationId)
        assertEquals("Dias", r.messages.found.single().other?.name)
        r.messages.searchText("s")
        assertTrue(r.messages.found.isEmpty()) // under two characters nothing is asked
    }

    @Test fun aDatabaseWithoutTheChatActionsStillShowsPlainMessages() = runTest {
        val r = rig(reject = { _, p, q -> if (p.endsWith("/messages") && q.contains("message_reactions")) "Could not find a relationship" else null }); open(r)
        assertEquals(3, r.messages.thread.size)
        assertTrue(r.log().any { it.contains("/messages?") && !it.contains("message_reactions") })
    }
}


class GlobalSearchTest {
    private fun rig(posts: String = """[{"id":"p1","author_id":"u2","body":"Which logo feels trustworthy?","created_at":"2026-10-30T09:12:36+00:00"}]""", failPosts: Boolean = false) =
        Rig({ _, path, _, _ -> if (path.endsWith("/posts")) posts else if (path.endsWith("/profiles_public")) PROFILES else "[]" },
            reject = { _, p, _ -> if (failPosts && p.endsWith("/posts")) "boom" else null })

    @Test fun theTextIsMadeSafeForAPatternTheWayTheWebsiteDoesIt() {
        val c = space.affinix.app.store.SearchModel.Companion
        assertEquals("a b", c.cleanText("  a   b "))
        assertEquals("a b c", c.cleanText("a*b%c"))
        assertEquals("a\\_b", c.cleanText("a_b"))
        assertEquals("#tag @me", c.cleanText("#tag @me"))
        assertEquals(60, c.cleanText("x".repeat(100)).length)
    }

    @Test fun pagesAreMatchedByNameAndAllShownForEmptyText() {
        val pages = listOf("Feed" to 1, "Friends" to 2, "Profile" to 3)
        val c = space.affinix.app.store.SearchModel.Companion
        assertEquals(listOf("Friends"), c.matchPages(pages, " frie ").map { it.first })
        assertEquals(3, c.matchPages(pages, "").size)
        assertTrue(c.matchPages(pages, "zzz").isEmpty())
    }

    @Test fun postsAndPeopleComeBackTogetherWithAuthors() = runTest {
        val r = rig()
        val res = r.search.run("logo")
        assertEquals("Which logo feels trustworthy?", res.posts.single().body)
        assertEquals("Dias", res.posts.single().author?.name)
        assertEquals(0, res.failed)
        val q = r.log().first { it.contains("/posts?") }
        assertTrue(q.contains("body=ilike.%2Alogo%2A") || q.contains("body=ilike.*logo*"), q)
        assertTrue(q.contains("limit=5"), q)
    }

    @Test fun aFailingGroupComesBackEmptyAndIsCounted() = runTest {
        val r = rig(failPosts = true)
        val res = r.search.run("dias")
        assertTrue(res.posts.isEmpty())
        assertEquals(1, res.failed)
        assertTrue(res.people.isNotEmpty())
    }

    @Test fun nothingIsAskedForUnderTwoCharacters() = runTest {
        val r = rig()
        assertTrue(r.search.searchPosts("a").isEmpty())
        assertTrue(r.log().none { it.contains("/posts?") })
    }
}

class PictureUploadTest {
    private val jpg = space.affinix.app.ShrunkImage(byteArrayOf(1, 2, 3), "image/jpeg", "jpg")

    @Test fun aPostWithAPictureUploadsItFirstAndPointsThePostAtIt() = runTest {
        val r = Rig({ _, _, _, _ -> "[]" })
        assertNull(r.feed.publish("hello world", jpg))
        val log = r.log()
        val up = log.first { it.contains("/storage/v1/object/post-images/me/") }
        assertTrue(up.startsWith("POST") && up.contains(".jpg"), up)
        val path = Regex("/post-images/(me/[^?]+\\.jpg)").find(up)!!.groupValues[1]
        val post = log.first { it.startsWith("POST") && it.contains("/rest/v1/posts") }
        assertTrue(post.contains("\"image_url\":\"https://sb.test/storage/v1/object/public/post-images/$path\""), post)
        assertTrue(log.indexOf(up) < log.indexOf(post)) // the file first, then the row that names it
    }

    @Test fun aPostWhoseRowIsRefusedTakesItsPictureBack() = runTest {
        val r = Rig({ _, _, _, _ -> "[]" }, reject = { m, p, _ -> if (m == "POST" && p.endsWith("/rest/v1/posts")) "boom" else null })
        assertEquals("app.noNetwork", r.feed.publish("hello world", jpg))
        val del = r.log().firstOrNull { it.startsWith("DELETE") && it.contains("/storage/v1/object/post-images") }
        assertTrue(del != null && del.contains("\"prefixes\":[\"me/"), r.log().toString())
    }

    @Test fun aPostWithoutAPictureSendsNoImageUrl() = runTest {
        val r = Rig({ _, _, _, _ -> "[]" })
        r.feed.publish("just words", null)
        assertTrue(r.log().none { it.contains("/storage/") })
        assertTrue(r.log().first { it.startsWith("POST") && it.contains("/rest/v1/posts") }.let { !it.contains("image_url") })
    }

    @Test fun aChatPictureIsUploadedToTheConversationFolderAndNamedInTheMessage() = runTest {
        val r = Rig({ m, path, _, body ->
            when {
                path.endsWith("/conversations") -> """[{"id":"c1","user_a":"me","user_b":"u2"}]"""
                path.endsWith("/profiles_public") -> PROFILES
                path.endsWith("/messages") && m == "GET" -> "[]"
                path.endsWith("/messages") && m == "POST" -> """[{"id":"${Regex("\"id\":\"([^\"]+)\"").find(body)!!.groupValues[1]}","conversation_id":"c1","sender_id":"me","body":"","created_at":"2026-10-30T09:05:00+00:00","attachment_path":"x"}]"""
                else -> "null"
            }
        })
        r.messages.refreshNow(); r.messages.openChat(r.messages.conversations.first()); until { r.messages.threadLoaded }
        r.messages.send("", jpg)
        assertTrue(r.messages.thread.last().hasImage)
        until { r.messages.thread.none { it.status != null } }
        val up = r.log().first { it.contains("/storage/v1/object/message-images/c1/me/") }
        val id = Regex("/message-images/c1/me/([^.]+)\\.jpg").find(up)!!.groupValues[1]
        val msg = r.log().first { it.startsWith("POST") && it.contains("/rest/v1/messages") }
        assertTrue(msg.contains("\"attachment_path\":\"c1/me/$id.jpg\"") && msg.contains("\"id\":\"$id\""), msg)
    }

    @Test fun aChatPictureIsSignedBeforeItIsShown() = runTest {
        val r = Rig({ _, path, _, _ -> if (path.contains("/storage/v1/object/sign/message-images")) """[{"path":"c1/u2/a.jpg","signedURL":"/object/sign/message-images/c1/u2/a.jpg?token=T"},{"path":"c1/u2/b.jpg","signedURL":null,"error":"not found"}]""" else "[]" })
        assertEquals("https://sb.test/storage/v1/object/sign/message-images/c1/u2/a.jpg?token=T", r.messages.attachmentUrl("c1/u2/a.jpg"))
        assertNull(r.messages.attachmentUrl("c1/u2/b.jpg"))
        r.messages.attachmentUrl("c1/u2/a.jpg") // second time from memory
        assertEquals(2, r.log().count { it.contains("/storage/v1/object/sign/") })
    }

    @Test fun onlyRealPicturesOfASaneSizeAreAccepted() {
        val c = space.affinix.app.ImageRules
        assertNull(c.check(space.affinix.app.PickedImage(ByteArray(10), "image/png")))
        assertEquals("messages.err.img_bad_type", c.check(space.affinix.app.PickedImage(ByteArray(10), "application/pdf")))
        assertEquals("messages.err.img_too_big", c.check(space.affinix.app.PickedImage(ByteArray(0), "image/jpeg", tooBig = true)))
    }

    @Test fun aPublicUrlGivesBackItsStoragePath() {
        val api = Rig({ _, _, _, _ -> "[]" }).api
        val url = api.publicObjectUrl("avatars", "me/a.jpg")
        assertEquals("me/a.jpg", api.pathFromPublicUrl("avatars", url))
        assertNull(api.pathFromPublicUrl("avatars", "https://elsewhere.test/a.jpg"))
        assertNull(api.pathFromPublicUrl("avatars", null))
    }
}


class CrowdTestTest {
    private val mine = """[{"id":"t1","title":"Which logo?","dim":"trust","status":"open","target":150,"votes":120,"voters":9,"createdAt":"2026-10-29T10:00:00Z","note":null,
        "items":[{"id":"i1","pos":0,"label":"Blue","path":null,"wins":45,"games":60},{"id":"i2","pos":1,"label":null,"path":"me/x.jpg","wins":20,"games":60},{"id":"i3","pos":2,"label":"Green","path":null,"wins":10,"games":60}]},
        {"id":"t2","title":"Slogan","dim":"preference","status":"closed","target":150,"votes":0,"voters":0,"createdAt":"2026-10-28T10:00:00Z","items":[{"id":"i4","pos":0,"label":"A","wins":0,"games":0},{"id":"i5","pos":1,"label":"B","wins":0,"games":0}]}]"""

    private fun rig(reject: (String, String, String) -> String? = { _, _, _ -> null }, answers: (String, String) -> String? = { _, _ -> null }) =
        Rig({ m, path, _, _ -> answers(m, path) ?: when {
            path.endsWith("/rpc/arena_test_mine") -> mine
            path.endsWith("/rpc/arena_test_create") -> """{"id":"t9"}"""
            path.endsWith("/rpc/arena_test_delete") -> """{"paths":["me/x.jpg","me/y.jpg"]}"""
            else -> "{}"
        } }, reject = reject)

    @Test fun wilsonIntervalsMatchTheWebsiteToTheLastDigit() {
        fun same(a: Pair<Double, Double>, lo: Double, hi: Double) = assertTrue(abs(a.first - lo) < 1e-12 && abs(a.second - hi) < 1e-12, a.toString())
        val w = space.affinix.app.store.CrowdVerdict
        same(w.wilson(30, 50), 0.46181189102759373, 0.7239181021375426)
        same(w.wilson(0, 10), 0.0, 0.2775401687666165)
        same(w.wilson(10, 10), 0.7224598312333834, 1.0)
        same(w.wilson(45, 60), 0.627676890545152, 0.8422361442158816)
        same(w.wilson(20, 60), 0.2272909421592783, 0.459433701333366)
        same(w.wilson(0, 0), 0.0, 0.0)
    }

    private fun abs(x: Double) = kotlin.math.abs(x)

    @Test fun theListIsReadAndTheVerdictsFollowTheHonestyRule() = runTest {
        val r = rig(); r.crowd.loadNow()
        assertEquals(listOf("t1", "t2"), r.crowd.tests.map { it.id })
        assertEquals(1, r.crowd.openCount)
        val v1 = space.affinix.app.store.CrowdVerdict.of(r.crowd.tests[0])
        assertEquals("winner", v1.state) // 75% [63,84] against 33% [23,46]: the leader lies wholly above
        assertEquals(listOf("i1", "i2", "i3"), v1.ranked.map { it.item.id })
        assertEquals(0.8f, v1.progress)
        assertEquals("empty", space.affinix.app.store.CrowdVerdict.of(r.crowd.tests[1]).state)
    }

    @Test fun belowThirtyDuelsThereIsNoVerdictAndCloseOptionsAreCalledClose() {
        val v = space.affinix.app.store.CrowdVerdict
        fun test(w1: Int, g1: Int, w2: Int, g2: Int, votes: Int = 40) = space.affinix.app.store.CrowdTest("t", items = listOf(
            space.affinix.app.store.CrowdItem("a", 0, "A", null, w1, g1), space.affinix.app.store.CrowdItem("b", 1, "B", null, w2, g2)), votes = votes, target = 150)
        assertEquals("collecting", v.of(test(14, 20, 6, 20)).state) // 20 duels: too early
        assertEquals("close", v.of(test(33, 60, 27, 60)).state)
        assertEquals("winner", v.of(test(50, 60, 10, 60)).state)
    }

    @Test fun anErrorHintBecomesTheSitesMessage() = runTest {
        val r = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/arena_test_mine")) "x" else null })
        r.crowd.loadNow() // a refusal without a hint reads as a generic failure
        assertEquals("crowd.err.generic", r.crowd.loadError)
        val hinted = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/arena_test_mine")) "No|too_many_open" else null })
        hinted.crowd.loadNow()
        assertEquals("crowd.err.too_many_open", hinted.crowd.loadError)
        val missing = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/arena_test_mine")) "Could not find the function public.arena_test_mine" else null })
        missing.crowd.loadNow()
        assertEquals("crowd.err.pending", missing.crowd.loadError)
    }

    @Test fun creatingAnUnderLevelPlayerIsGatedAndTheFormIsCheckedFirst() = runTest {
        val r = rig()
        r.xp = 40
        assertTrue(r.crowd.locked)
        r.xp = 100
        assertTrue(!r.crowd.locked)
        val two = listOf(space.affinix.app.store.DraftOption("A", null), space.affinix.app.store.DraftOption("B", null))
        assertEquals("crowd.err.bad_title", r.crowd.validate("ab", "trust", two))
        assertEquals("crowd.err.bad_question", r.crowd.validate("Good title", "nonsense", two))
        assertEquals("crowd.err.bad_items", r.crowd.validate("Good title", "trust", two.take(1)))
        assertEquals("crowd.err.bad_items", r.crowd.validate("Good title", "trust", two + listOf(space.affinix.app.store.DraftOption("x".repeat(61), null))))
        assertEquals("crowd.err.bad_items", r.crowd.validate("Good title", "trust", List(5) { space.affinix.app.store.DraftOption("o$it", null) }))
        assertEquals(null, r.crowd.validate("Good title", "trust", two + space.affinix.app.store.DraftOption("", null))) // an empty option row is ignored
    }

    @Test fun aTestIsCreatedAfterItsPicturesAreUploaded() = runTest {
        val r = rig()
        val img = space.affinix.app.ShrunkImage(byteArrayOf(1, 2), "image/jpeg", "jpg")
        val e = r.crowd.create("  Which logo?  ", "trust", listOf(space.affinix.app.store.DraftOption("Blue", img), space.affinix.app.store.DraftOption("", img), space.affinix.app.store.DraftOption("Red", null)))
        assertNull(e)
        val log = r.log()
        assertEquals(2, log.count { it.startsWith("POST") && it.contains("/storage/v1/object/arena-tests/me/") })
        val call = log.first { it.contains("/rpc/arena_test_create") }
        assertTrue(call.contains("\"p_title\":\"Which logo?\"") && call.contains("\"p_dim\":\"trust\""), call)
        assertTrue(call.contains("\"label\":\"Blue\"") && call.contains("\"label\":\"Red\"") && Regex("\"path\":\"me/[^\"]+\\.jpg\"").findAll(call).count() == 2, call)
        assertTrue(log.indexOfLast { it.contains("/storage/") } < log.indexOfFirst { it.contains("/rpc/arena_test_create") })
        assertEquals(2, r.crowd.tests.size) // the list is read again
    }

    @Test fun aRefusedTestTakesItsPicturesBackAndSaysWhy() = runTest {
        val r = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/arena_test_create")) "Play a round in the Arena first (level 2).|need_level" else null })
        val img = space.affinix.app.ShrunkImage(byteArrayOf(1), "image/jpeg", "jpg")
        val e = r.crowd.create("Which logo?", "trust", listOf(space.affinix.app.store.DraftOption("A", img), space.affinix.app.store.DraftOption("B", null)))
        assertEquals("crowd.err.need_level", e)
        assertTrue(r.log().any { it.startsWith("DELETE") && it.contains("/storage/v1/object/arena-tests") })
    }

    @Test fun deletingRemovesThePicturesTheServerNames() = runTest {
        val r = rig(); r.crowd.loadNow()
        assertNull(r.crowd.delete(r.crowd.tests[0]))
        val del = r.log().first { it.startsWith("DELETE") && it.contains("/storage/v1/object/arena-tests") }
        assertTrue(del.contains("me/x.jpg") && del.contains("me/y.jpg"), del)
    }

    @Test fun pausingAndReopeningUseTheSameRpcAsTheWebsite() = runTest {
        val r = rig(); r.crowd.loadNow()
        assertNull(r.crowd.setStatus(r.crowd.tests[0], open = false))
        assertTrue(r.log().first { it.contains("/rpc/arena_test_set_status") }.contains("\"p_status\":\"closed\""))
        assertNull(r.crowd.setStatus(r.crowd.tests[1], open = true))
        assertTrue(r.log().last { it.contains("/rpc/arena_test_set_status") }.contains("\"p_status\":\"open\""))
    }

    @Test fun theResultsDecodeWithPairsAndAverageTime() = runTest {
        val r = rig(answers = { _, p -> if (p.endsWith("/rpc/arena_test_results")) """{"test":$mine""".let { _ -> """{"test":{"id":"t1","title":"T","dim":"trust","status":"open","target":150,"votes":10,"voters":2,"items":[{"id":"i1","pos":0,"label":"A","wins":3,"games":5}]},"pairs":[{"a":"i1","b":"i2","aVotes":3,"bVotes":2}],"avgMs":2400}""" } else null })
        r.crowd.open("t1")
        until { r.crowd.result != null }
        assertEquals(1, r.crowd.result!!.pairs.size)
        assertEquals(2400.0, r.crowd.result!!.avgMs)
        assertEquals("p_test", Regex("\"(p_test)\"").find(r.log().first { it.contains("/rpc/arena_test_results") })!!.groupValues[1])
    }
}
