package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.net.TallyQuery
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val json = headersOf(HttpHeaders.ContentType, "application/json")

private fun token(access: String, refresh: String = "r-$access", expiresIn: Long = 3600) =
    """{"access_token":"$access","refresh_token":"$refresh","expires_in":$expiresIn,"user":{"id":"u1","email":"me@x.kz"}}"""

class ApiTest {
    private val config = Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test")

    @Test fun signInStoresTheSessionAndSendsTheKey() = runTest {
        val seen = mutableListOf<String>()
        val engine = MockEngine { req ->
            seen += "${req.method.value} ${req.url.encodedPath}?${req.url.parameters["grant_type"]} apikey=${req.headers["apikey"]} body=${String(req.body.toByteArray())}"
            respond(token("a1"), HttpStatusCode.OK, json)
        }
        val store = MemorySessionStore()
        val api = Api(HttpClient(engine), config, store, nowSeconds = { 1000 })
        val s = api.signIn("  me@x.kz ", "pw")
        assertEquals("a1", s.accessToken); assertEquals("u1", s.userId); assertEquals(4600L, s.expiresAt)
        assertEquals(s, store.load())
        assertEquals("POST /auth/v1/token?password apikey=anon body={\"email\":\"me@x.kz\",\"password\":\"pw\"}", seen.single())
    }

    @Test fun wrongPasswordSurfacesTheServersMessage() = runTest {
        val engine = MockEngine { respond("""{"error_code":"invalid_credentials","msg":"Invalid login credentials"}""", HttpStatusCode.BadRequest, json) }
        val api = Api(HttpClient(engine), config, MemorySessionStore())
        val e = assertFailsWith<ApiException> { api.signIn("a@b.c", "x") }
        assertEquals(400, e.status); assertEquals("Invalid login credentials", e.message)
        assertNull(api.session)
    }

    @Test fun signUpWithoutConfirmationReturnsNullSession() = runTest {
        val engine = MockEngine { respond("""{"id":"u9","email":"n@x.kz"}""", HttpStatusCode.OK, json) }
        val api = Api(HttpClient(engine), config, MemorySessionStore())
        assertNull(api.signUp("n@x.kz", "secret1"))
    }

    @Test fun anExpiringTokenIsRefreshedBeforeTheCall() = runTest {
        val calls = mutableListOf<String>()
        val engine = MockEngine { req ->
            calls += req.url.encodedPath + "|" + (req.headers[HttpHeaders.Authorization] ?: "")
            if (req.url.encodedPath == "/auth/v1/token") respond(token("new"), HttpStatusCode.OK, json) else respond("""{"profile":{"xp":120,"level":2}}""", HttpStatusCode.OK, json)
        }
        val store = MemorySessionStore(Session("old", "r-old", expiresAt = 1010, userId = "u1"))
        val api = Api(HttpClient(engine), config, store, nowSeconds = { 1000 }) // 10 s left: inside the 30 s margin
        val st = api.state("2026-10-30")
        assertEquals(120L, st.profile.xp)
        assertEquals(listOf("/auth/v1/token|", "/rest/v1/rpc/arena_state|Bearer new"), calls)
        assertEquals("new", store.load()!!.accessToken)
    }

    @Test fun a401IsRetriedOnceWithAFreshToken() = runTest {
        var rpcCalls = 0
        val engine = MockEngine { req ->
            when (req.url.encodedPath) {
                "/auth/v1/token" -> respond(token("fresh"), HttpStatusCode.OK, json)
                else -> if (rpcCalls++ == 0) respond("""{"message":"JWT expired"}""", HttpStatusCode.Unauthorized, json) else respond("[]", HttpStatusCode.OK, json)
            }
        }
        val api = Api(HttpClient(engine), config, MemorySessionStore(Session("stale", "r", expiresAt = 99999, userId = "u1")), nowSeconds = { 1000 })
        assertTrue(api.tallies(listOf(TallyQuery("202610/mark/1-2", "preference"))).isEmpty())
        assertEquals(2, rpcCalls)
    }

    @Test fun aDeadRefreshTokenSignsTheUserOut() = runTest {
        val engine = MockEngine { respond("""{"error_description":"Invalid Refresh Token"}""", HttpStatusCode.BadRequest, json) }
        val store = MemorySessionStore(Session("old", "dead", expiresAt = 0, userId = "u1"))
        val api = Api(HttpClient(engine), config, store, nowSeconds = { 1000 })
        assertFailsWith<ApiException> { api.state("2026-10-30") }
        assertNull(store.load())
    }

    @Test fun submitSendsTheWireShapeOfTheWebsite() = runTest {
        var body = ""
        val engine = MockEngine { req -> body = String(req.body.toByteArray()); respond("""{"state":{"profile":{"xp":10,"level":1,"streak":1}},"newBadges":["first_vote"]}""", HttpStatusCode.OK, json) }
        val api = Api(HttpClient(engine), config, MemorySessionStore(Session("a", "r", 99999, "u1")), nowSeconds = { 1000 })
        val res = api.submit(listOf(space.affinix.app.net.WireVote("v1", "202610/mark/1-2", "preference", 1, 2100, 0, "2026-10-30", true, null, null, 1)), "2026-10-30")
        assertEquals(listOf("first_vote"), res.newBadges)
        assertEquals(10L, res.state!!.profile.xp)
        assertEquals("""{"p_votes":[{"id":"v1","pair":"202610/mark/1-2","dim":"preference","pick":1,"ms":2100,"bonus":0,"day":"2026-10-30","daily":true,"combo":1}],"p_slices":[],"p_slate":null,"p_day":"2026-10-30"}""", body)
    }

    @Test fun dealDecodesTheDuelsTheBffReturns() = runTest {
        var url = ""
        val engine = MockEngine { req ->
            url = req.url.toString(); assertEquals(HttpMethod.Get, req.method)
            respond("""{"duels":[{"id":"poster-975-980-clarity","season":"202610","family":"poster","dim":"clarity","a":975,"b":980,"pair":"202610/poster/975-980","swap":true,"objective":true,"repeat":false,"daily":true,"set":0,"pool":30,"truth":1,"specimens":[{"name":"x","contrast":4.7,"size":0.58},{"name":"y","contrast":7.3,"size":0.51}]}]}""", HttpStatusCode.OK, json)
        }
        val api = Api(HttpClient(engine), config, MemorySessionStore())
        val d = api.dealDaily("2026-10-30", "202610").single()
        assertEquals("https://api.test/api/arena-deal?kind=daily&day=2026-10-30&season=202610", url)
        assertTrue(d.swap && d.objective); assertEquals(1, d.truth); assertEquals(7.3, d.specimens[1].contrast)
    }

    @Test fun leaderboardAndSpecimenUrls() = runTest {
        val engine = MockEngine { respond("""{"rows":[{"rank":1,"userId":"u","name":"Aru","xp":900,"level":4,"streak":3,"isMe":true}],"me":{"rank":1,"xp":900},"weekStart":"2026-10-26"}""", HttpStatusCode.OK, json) }
        val api = Api(HttpClient(engine), config, MemorySessionStore(Session("a", "r", 99999, "u1")), nowSeconds = { 1000 })
        val lb = api.leaderboard("week")
        assertEquals("Aru", lb.rows.single().name); assertEquals(1, lb.me!!.rank)
        assertEquals("https://api.test/api/arena-specimen?season=202610&family=card&index=17&w=640&v=1", api.specimenUrl("202610", "card", 17))
    }

    @Test fun aWebPageInsteadOfDuelsIsReportedAsWhatItIs() = runTest {
        val engine = MockEngine { respond("<!doctype html><html><head><title>Affinix</title></head>", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/html")) }
        val api = Api(HttpClient(engine), config, MemorySessionStore())
        val e = assertFailsWith<ApiException> { api.dealDaily("2026-10-30", "202610") }
        assertTrue(e.message.startsWith("unexpected answer: <!doctype html>"), e.message)
    }

    @Test fun aBareArrayIsReadToo() {
        val one = """{"id":"a-1-2-trust","season":"202610","family":"mark","dim":"trust","a":1,"b":2,"pair":"202610/mark/1-2","specimens":[{"name":"x"},{"name":"y"}]}"""
        assertEquals(1, space.affinix.app.net.parseDuels("[$one]").size)
        assertEquals(1, space.affinix.app.net.parseDuels("{\"duels\":[$one]}").size)
    }

    @Test fun anErrorObjectIsNotMistakenForDuels() {
        val e = assertFailsWith<ApiException> { space.affinix.app.net.parseDuels("""{"error":"bad day or season"}""") }
        assertTrue(e.message.startsWith("unexpected answer"), e.message)
    }
}
