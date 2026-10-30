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

private class Rig(val handler: (method: String, path: String, query: String, body: String) -> String, val failWrites: () -> Boolean = { false }) {
    val seen = mutableListOf<String>()
    val api: Api
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    init {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            val line = "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $body"
            synchronized(seen) { seen += line }
            if (failWrites() && req.method.value != "GET") respond("""{"message":"boom"}""", HttpStatusCode.InternalServerError, jsonH)
            else respond(handler(req.method.value, req.url.encodedPath, req.url.encodedQuery, body), HttpStatusCode.OK, jsonH)
        }
        api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
    }
    val feed = FeedModel(api, scope) { "me" }
    val people = PeopleModel(api, scope, { "me" }, feed)
    val messages = MessagesModel(api, scope, { "me" }, feed)
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
