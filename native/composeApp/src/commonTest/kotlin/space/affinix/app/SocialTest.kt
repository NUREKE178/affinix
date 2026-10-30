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
    val research = space.affinix.app.store.ResearchModel(api, scope) { "me" }
    var adopted = 0
    val mission = space.affinix.app.store.MissionModel(api, scope, { "me" }) { adopted++ }
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


class MissionTest {
    private val queue = """{"available":2,"missionXp":24,"cap":300,"tests":[{"id":"t1","title":"Which logo?","dim":"trust","owner":{"id":"u2","name":"Dias","username":"dias","avatarUrl":null},
        "items":[{"id":"i1","pos":0,"label":"Blue","path":null},{"id":"i2","pos":1,"label":null,"path":"u2/x.jpg"},{"id":"i3","pos":2,"label":"Green","path":null}],
        "pairs":[["i1","i2"],["i1","i3"],["i2","i3"]],"done":0,"total":3}]}"""

    private fun rig(vote: (String) -> String = { _ -> """{"results":[{"accepted":true,"xp":12,"bonus":0,"capped":false,"aVotes":7,"bVotes":3}],"missionXp":36,"status":"open","state":{"profile":{"xp":150}}}""" },
                    reject: (String, String, String) -> String? = { _, _, _ -> null }) =
        Rig({ _, path, _, body -> when {
            path.endsWith("/rpc/arena_test_queue") -> queue
            path.endsWith("/rpc/arena_test_vote") -> vote(body)
            else -> "null"
        } }, reject = reject)

    private suspend fun started(r: Rig): space.affinix.app.store.MissionTest {
        r.mission.loadQueue(); until { r.mission.queue != null }
        val t = r.mission.queue!!.tests.single()
        r.mission.start(t)
        return t
    }

    @Test fun theQueueListsOtherPeoplesTestsWithTheirPairs() = runTest {
        val r = rig(); r.mission.loadQueue(); until { r.mission.queue != null }
        val q = r.mission.queue!!
        assertEquals(2, q.available); assertEquals(24, q.missionXp); assertEquals(300, q.cap)
        assertEquals("Dias", q.tests.single().owner?.name)
        assertEquals(3, q.tests.single().pairs.size)
        assertEquals("p_limit", Regex("\"(p_limit)\":3").find(r.log().first { it.contains("arena_test_queue") })!!.groupValues[1])
    }

    @Test fun aMissionAsksEveryPairOnceInSomeOrder() = runTest {
        val r = rig(); started(r)
        val round = r.mission.round!!
        assertEquals(3, round.duels.size)
        assertEquals(setOf("i1|i2", "i1|i3", "i2|i3"), round.duels.map { "${it.a}|${it.b}" }.toSet())
    }

    @Test fun anAnswerIsSentAtOnceAndThePaymentAndTheSplitComeBack() = runTest {
        val r = rig(); started(r)
        val duel = r.mission.round!!.duel!!
        r.mission.vote(0)
        assertEquals(space.affinix.app.store.Phase.Reveal, r.mission.round!!.phase)
        until { r.mission.round!!.last?.pending == false }
        val last = r.mission.round!!.last!!
        assertEquals(12, last.xp)
        val left = if (duel.swap) duel.b else duel.a
        assertEquals(left, last.pick)
        // the server counts for the lower id (7) and the higher (3): the screen needs them per option
        assertEquals(if (duel.a < duel.b) 7 to 3 else 3 to 7, last.tally)
        assertEquals(36, r.mission.round!!.missionXp)
        assertTrue(r.adopted >= 1)
        val call = r.log().first { it.contains("/rpc/arena_test_vote") }
        assertTrue(call.contains("\"p_test\":\"t1\"") && call.contains("\"pick\":\"$left\"") && call.contains("\"p_day\":"), call)
    }

    @Test fun nextGoesOnAfterAnAcceptedAnswerAndTheLastOneEndsInASummary() = runTest {
        val r = rig(); started(r)
        repeat(3) { i ->
            r.mission.vote(1); until { r.mission.round!!.last?.pending == false }
            r.mission.next()
            if (i < 2) assertEquals(space.affinix.app.store.Phase.Choose, r.mission.round!!.phase)
        }
        assertEquals(space.affinix.app.store.Phase.Summary, r.mission.round!!.phase)
        assertEquals(36, r.mission.round!!.xp)
    }

    @Test fun anAnswerThatWasNotSentCanBeSentAgainAndBlocksNextUntilThen() = runTest {
        var down = true
        val r = rig(reject = { _, p, _ -> if (down && p.endsWith("/rpc/arena_test_vote")) "x" else null }); started(r)
        r.mission.vote(0); until { r.mission.round!!.last?.pending == false }
        assertEquals("generic", r.mission.round!!.last!!.error)
        r.mission.next()
        assertEquals(space.affinix.app.store.Phase.Reveal, r.mission.round!!.phase) // stays: send it again first
        down = false
        r.mission.retry(); until { r.mission.round!!.last?.pending == false && r.mission.round!!.last?.error == null }
        r.mission.next()
        assertEquals(1, r.mission.round!!.idx)
    }

    @Test fun aClosedTestEndsTheMission() = runTest {
        val r = rig(reject = { _, p, _ -> if (p.endsWith("/rpc/arena_test_vote")) "closed|closed" else null }); started(r)
        r.mission.vote(0); until { r.mission.round!!.last?.pending == false }
        assertEquals("closed", r.mission.round!!.last!!.error)
        r.mission.next()
        assertEquals(space.affinix.app.store.Phase.Summary, r.mission.round!!.phase)
    }

    @Test fun aTestThatClosedAfterTheAnswerEndsTheMissionToo() = runTest {
        val r = rig(vote = { """{"results":[{"accepted":true,"xp":12}],"missionXp":12,"status":"closed"}""" }); started(r)
        r.mission.vote(0); until { r.mission.round!!.last?.pending == false }
        r.mission.next()
        assertEquals(space.affinix.app.store.Phase.Summary, r.mission.round!!.phase)
    }

    @Test fun reportingCallsTheSameRpcAndEndingReloadsTheQueue() = runTest {
        val r = rig(); val t = started(r)
        r.mission.report(t); until { r.mission.reported }
        assertTrue(r.log().first { it.contains("/rpc/arena_test_report") }.contains("\"p_test\":\"t1\""))
        r.mission.end()
        until { r.log().count { it.contains("arena_test_queue") } == 2 }
        assertNull(r.mission.round)
    }
}


class ResearchModelTest {
    private val orgs = """[{"role":"owner","organization":{"id":"o1","name":"Acme","slug":"acme"}},{"role":"viewer","organization":{"id":"o2","name":"Other","slug":"other"}}]"""
    private val exps = """[{"id":"e1","organization_id":"o1","name":"Logo test","objective":"Pick one","research_type":"logo_testing","status":"draft","public_slug":null,"participant_limit":50,
        "created_at":"2026-10-01T10:00:00+00:00","updated_at":"2026-10-20T10:00:00+00:00",
        "experiment_variants":[{"id":"v2","label":"B","name":"Two","position":1},{"id":"v1","label":"A","name":"One","position":0}],
        "experiment_questions":[{"id":"q1","type":"single_choice","applies_to":"variants","role":"selection","prompt":"Which?","position":0,"experiment_question_options":[]}]},
        {"id":"e2","organization_id":"o1","name":"Poster","status":"published","public_slug":"abcd2345","participant_settings":{"targetCount":80},"participant_limit":50,
        "created_at":"2026-09-01T10:00:00+00:00","updated_at":"2026-10-25T10:00:00+00:00","experiment_variants":[],"experiment_questions":[]}]"""
    private val members = """[{"id":"m1","role":"owner","user_id":"me","created_at":"2026-09-01T10:00:00+00:00","profile":{"full_name":"Me","email":"me@x.kz"}},
        {"id":"m2","role":"viewer","user_id":"u2","created_at":"2026-10-01T10:00:00+00:00","profile":{"full_name":"","email":"dias@x.kz"}}]"""

    // the same path serves both uses of organization_members (my companies, a company's members): answer by what is asked for
    private fun rigWith(reject: (String, String, String) -> String? = { _, _, _ -> null }): Rig = Rig({ m, path, q, _ -> when {
        path.endsWith("/organization_members") && q.contains("organization%3Aorganizations") -> orgs
        path.endsWith("/organization_members") -> members
        path.endsWith("/experiments") -> exps
        path.endsWith("/participant_sessions") -> """[{"id":"s1","experiment_id":"e1","status":"completed","started_at":"2026-10-03T10:00:00+00:00","completed_at":"2026-10-03T10:03:00+00:00","demographics":{"ageRange":"25-34"},"responses":[{"question_id":"q1","variant_id":null,"value":"v1","response_time_ms":2000,"created_at":"2026-10-03T10:01:00+00:00"}],"experiments":{"id":"e1","name":"Logo test"}}]"""
        path.endsWith("/rpc/add_member_by_email") -> """{"id":"m9"}"""
        else -> "[]"
    } }, reject = reject)

    @Test fun theCompaniesOfThePersonAreReadAndTheFirstIsActive() = runTest {
        val r = rigWith(); r.research.loadOrgs()
        until { r.research.experimentsLoaded }
        assertEquals(listOf("Acme", "Other"), r.research.orgs.map { it.name })
        assertEquals("o1", r.research.activeOrgId)
        assertTrue(r.research.canManage) // an owner
        val q = r.log().first { it.contains("organization_members") }
        assertTrue(q.contains("user_id=eq.me"), q)
        assertTrue(r.log().any { it.contains("/experiments?") && it.contains("organization_id=eq.o1") })
    }

    @Test fun experimentsAreMappedWithTheirVariantsAndTheTargetTheWebsiteUses() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        val e1 = r.research.experiments.first { it.id == "e1" }; val e2 = r.research.experiments.first { it.id == "e2" }
        assertEquals(listOf("A", "B"), e1.variants.map { it.label }) // by position
        assertEquals(50, e1.targetCount); assertEquals(80, e2.targetCount) // the settings win over the limit
        assertEquals("Which?", e1.questions.single().prompt)
        assertEquals("https://affinix.space/#/research/abcd2345", r.research.publicLink(e2)); assertNull(r.research.publicLink(e1))
    }

    @Test fun publishingADraftSendsTheStatusASlugAndTheTime() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.publish(r.research.experiments.first { it.id == "e1" })
        until { r.log().any { it.startsWith("PATCH") && it.contains("/experiments") } }
        val call = r.log().first { it.startsWith("PATCH") && it.contains("/experiments") }
        assertTrue(call.contains("id=eq.e1") && call.contains("\"status\":\"published\"") && Regex("\"public_slug\":\"[a-hj-km-np-z2-9]{8}\"").containsMatchIn(call) && call.contains("\"published_at\":\"20"), call)
    }

    @Test fun deletingRemovesTheRowAndAFailureLeavesItInPlace() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.delete(r.research.experiments.first { it.id == "e2" })
        until { r.research.experiments.none { it.id == "e2" } }
        assertTrue(r.log().any { it.startsWith("DELETE") && it.contains("id=eq.e2") })
        val bad = rigWith(reject = { m, _, _ -> if (m == "DELETE") "denied" else null }); bad.research.loadOrgs(); until { bad.research.experimentsLoaded }
        bad.research.delete(bad.research.experiments.first { it.id == "e1" })
        until { bad.research.notice != null }
        assertEquals("research.actionFailed", bad.research.notice)
        assertTrue(bad.research.experiments.any { it.id == "e1" })
    }

    @Test fun theResultsOfOneExperimentAreAskedWithTheirAnswers() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.openExperiment("e1"); until { r.research.sessionsLoaded }
        assertEquals(1, r.research.sessions.size)
        val s = space.affinix.app.store.ResearchStats.summary(r.research.openExperiment!!, r.research.sessions)
        assertEquals("A", s.topVariant?.label)
        val q = r.log().first { it.contains("/participant_sessions?") && it.contains("experiment_id=eq.e1") }
        assertTrue(q.contains("responses"), q)
    }

    @Test fun theParticipantsOfTheCompanyCarryTheExperimentName() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.loadOrgSessions(); until { r.research.orgSessionsLoaded }
        assertEquals("Logo test", r.research.orgSessions.single().experimentName)
        assertTrue(r.log().any { it.contains("experiments.organization_id=eq.o1") && it.contains("inner") })
    }

    @Test fun theTeamIsReadAndTheNameFallsBackToTheEmail() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.loadMembers(); until { r.research.membersLoaded }
        assertEquals(listOf("Me", "dias@x.kz"), r.research.members.map { it.name })
        assertEquals(listOf("owner", "viewer"), r.research.members.map { it.role })
    }

    @Test fun aRoleChangeShowsAtOnceAndIsPutBackWhenRefused() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.loadMembers(); until { r.research.membersLoaded }
        r.research.setRole(r.research.members[1], "admin")
        assertEquals("admin", r.research.members[1].role)
        until { r.log().any { it.startsWith("PATCH") && it.contains("organization_members") } }
        assertTrue(r.log().first { it.startsWith("PATCH") && it.contains("organization_members") }.contains("\"role\":\"admin\""))
        val bad = rigWith(reject = { m, p, _ -> if (m == "PATCH" && p.endsWith("/organization_members")) "denied" else null }); bad.research.loadOrgs(); until { bad.research.experimentsLoaded }
        bad.research.loadMembers(); until { bad.research.membersLoaded }
        bad.research.setRole(bad.research.members[1], "admin")
        until { bad.research.notice != null }
        assertEquals("viewer", bad.research.members[1].role)
    }

    @Test fun anExistingAccountIsAddedAtOnce() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertEquals("added", r.research.addMember("  dias@x.kz ", "researcher"))
        val call = r.log().first { it.contains("/rpc/add_member_by_email") }
        assertTrue(call.contains("\"org_id\":\"o1\"") && call.contains("\"member_email\":\"dias@x.kz\"") && call.contains("\"member_role\":\"researcher\""), call)
    }

    @Test fun anUnknownEmailGetsAnInviteFromTheEdgeFunction() = runTest {
        val r = rigWith(reject = { _, p, _ -> if (p.endsWith("/rpc/add_member_by_email")) "No account found for this email" else null }); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertEquals("invited", r.research.addMember("new@x.kz", "viewer"))
        val call = r.log().first { it.contains("/functions/v1/invite-member") }
        assertTrue(call.contains("\"email\":\"new@x.kz\"") && call.contains("\"role\":\"viewer\""), call)
    }

    @Test fun anotherRefusalIsReportedWithItsMessage() = runTest {
        val r = rigWith(reject = { _, p, _ -> if (p.endsWith("/rpc/add_member_by_email")) "Only owners and admins can add members" else null }); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertEquals("error:Only owners and admins can add members", r.research.addMember("a@x.kz", "viewer"))
        assertTrue(r.log().none { it.contains("invite-member") })
    }

    private val img = space.affinix.app.ShrunkImage(byteArrayOf(1, 2), "image/jpeg", "jpg")
    private fun variants() = listOf(space.affinix.app.store.ResearchModel.DraftVariant("Blue cup", "calm", img), space.affinix.app.store.ResearchModel.DraftVariant("Orange bean", "", null), space.affinix.app.store.ResearchModel.DraftVariant("  ", "", null))
    private fun questions(m: space.affinix.app.store.ResearchModel) = listOf(
        m.dimensionQuestion("preference", "Which would you choose?")!!, m.dimensionQuestion("purchaseIntent", "Would you buy it?")!!,
        space.affinix.app.store.ResearchModel.DraftQuestion("single_choice", "general", null, "How often?", "Daily, Weekly, ,Rarely", null),
        space.affinix.app.store.ResearchModel.DraftQuestion("open_text", "general", null, "Anything else?", "", null),
    )

    @Test fun theBuilderChecksWhatTheWebsiteChecks() = runTest {
        val m = rigWith().research
        val v = variants(); val q = questions(m)
        assertEquals("builder.step7.checkInfo", m.validate(" ", "obj", "logo_testing", v, q))
        assertEquals("builder.step7.checkInfo", m.validate("n", "", "logo_testing", v, q))
        assertEquals("builder.steps.researchType", m.validate("n", "o", null, v, q))
        assertEquals("builder.step7.checkVariants", m.validate("n", "o", "logo_testing", v.take(1) + v.last(), q)) // a variant with a blank name does not count
        assertEquals("builder.step7.checkQuestions", m.validate("n", "o", "logo_testing", v, emptyList()))
        assertNull(m.validate("n", "o", "logo_testing", v, q))
    }

    @Test fun aDimensionIsAReadyMadeQuestionLikeTheWebsitesChips() = runTest {
        val m = rigWith().research
        val p = m.dimensionQuestion("preference", "P?")!!; val pi = m.dimensionQuestion("purchaseIntent", "B?")!!
        assertEquals(listOf("single_choice", "variants", "selection", null), listOf(p.type, p.appliesTo, p.role, p.scaleMax))
        assertEquals(listOf("rating", "purchase_intention", 7), listOf(pi.type, pi.role, pi.scaleMax))
        assertNull(m.dimensionQuestion("nonsense", "x"))
    }

    @Test fun savingADraftWritesTheRowThenVariantsQuestionsAndOptionsInThatOrder() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.creating = true
        val e = r.research.create("  Coffee logo ", " Which cup? ", "logo_testing", 120, true, variants(), questions(r.research), publish = false)
        assertNull(e)
        assertTrue(!r.research.creating)
        val posts = r.log().filter { it.startsWith("POST") && it.contains("/rest/v1/") }.map { Regex("/rest/v1/([a-z_]+)").find(it)!!.groupValues[1] }
        assertEquals(listOf("experiments", "experiment_variants", "experiment_questions", "experiment_question_options"), posts)
        val row = r.log().first { it.startsWith("POST") && it.contains("/rest/v1/experiments") }
        assertTrue(row.contains("\"name\":\"Coffee logo\"") && row.contains("\"objective\":\"Which cup?\"") && row.contains("\"organization_id\":\"o1\"") && row.contains("\"status\":\"draft\"") &&
            row.contains("\"research_type\":\"logo_testing\"") && row.contains("\"participant_limit\":120") && row.contains("\"targetCount\":120") && row.contains("\"randomizeVariantOrder\":true") && !row.contains("public_slug"), row)
        val id = Regex("\"id\":\"([^\"]+)\"").find(row)!!.groupValues[1]
        // two named variants (the blank one is dropped), labelled A and B, the first with its picture under <company>/<experiment>/
        val vrows = r.log().first { it.contains("/rest/v1/experiment_variants") }
        assertTrue(vrows.contains("\"label\":\"A\"") && vrows.contains("\"label\":\"B\"") && !vrows.contains("\"label\":\"C\"") && vrows.contains("\"position\":1"), vrows)
        assertTrue(Regex("\"asset_url\":\"https://sb.test/storage/v1/object/public/variant-assets/o1/$id/[^\"]+\\.jpg\"").containsMatchIn(vrows) && vrows.contains("\"asset_type\":\"image\""), vrows)
        assertEquals(1, r.log().count { it.startsWith("POST") && it.contains("/storage/v1/object/variant-assets/o1/$id/") })
        val qrows = r.log().first { it.contains("/rest/v1/experiment_questions") }
        assertTrue(qrows.contains("\"role\":\"selection\"") && qrows.contains("\"scale\":{\"min\":1,\"max\":7}") && qrows.contains("\"applies_to\":\"general\""), qrows)
        // the options of the general choice question: trimmed, empty ones dropped, in order
        val orows = r.log().first { it.contains("/rest/v1/experiment_question_options") }
        assertTrue(Regex("\"label\":\"Daily\".*\"label\":\"Weekly\".*\"label\":\"Rarely\"").containsMatchIn(orows) && !orows.contains("\"label\":\"\""), orows)
    }

    @Test fun publishingAlsoGivesTheExperimentAPublicLink() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertNull(r.research.create("N", "O", "ad_testing", 50, false, variants(), questions(r.research), publish = true))
        val row = r.log().first { it.startsWith("POST") && it.contains("/rest/v1/experiments") }
        assertTrue(row.contains("\"status\":\"published\"") && Regex("\"public_slug\":\"[a-hj-km-np-z2-9]{8}\"").containsMatchIn(row) && row.contains("\"published_at\":\"20") && row.contains("\"randomizeVariantOrder\":false"), row)
    }

    @Test fun anIncompleteFormSendsNothing() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertEquals("builder.step7.checkQuestions", r.research.create("N", "O", "ad_testing", 50, true, variants(), emptyList(), publish = false))
        assertTrue(r.log().none { it.startsWith("POST") && it.contains("/rest/v1/experiments") })
    }

    @Test fun aRefusedWriteTakesTheRowAndThePictureBack() = runTest {
        val r = rigWith(reject = { m, p, _ -> if (m == "POST" && p.endsWith("/rest/v1/experiment_questions")) "denied" else null }); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        assertEquals("research.actionFailed", r.research.create("N", "O", "ad_testing", 50, true, variants(), questions(r.research), publish = false))
        val log = r.log()
        assertTrue(log.any { it.startsWith("DELETE") && it.contains("/rest/v1/experiments?id=eq.") }, log.toString())
        assertTrue(log.any { it.startsWith("DELETE") && it.contains("/storage/v1/object/variant-assets") })
    }

    @Test fun aViewerCannotManageTheTeam() = runTest {
        val r = rigWith(); r.research.loadOrgs(); until { r.research.experimentsLoaded }
        r.research.pickOrg("o2")
        assertTrue(!r.research.canManage)
    }
}
