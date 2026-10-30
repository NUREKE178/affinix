package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLDecoder
import java.net.URL
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GoogleSignInTest {
    @Test fun theChallengeIsTheOneOfRfc7636() {
        // the worked example of RFC 7636 appendix B
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun aVerifierIsLongRandomAndUsesOnlyAllowedCharacters() {
        val a = Pkce.verifier(); val b = Pkce.verifier()
        assertTrue(a.length in 43..128 && a != b)
        assertTrue(a.all { it.isLetterOrDigit() || it in "-._~" })
    }

    @Test fun queryValuesArePercentEncodedLikeAnyUrl() {
        assertEquals("https%3A%2F%2Fa.b%2Fc%3Fd%3De%20f%C3%A9", urlEncode("https://a.b/c?d=e fé"))
        assertEquals("a-b_c.d~e", urlEncode("a-b_c.d~e"))
    }

    private val jsonH = headersOf(HttpHeaders.ContentType, "application/json")
    private val seen = mutableListOf<String>()
    private fun api(token: String = """{"access_token":"AT","refresh_token":"RT","expires_in":3600,"user":{"id":"u1","email":"g@x.kz"}}"""): Api {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            synchronized(seen) { seen += "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $body" }
            respond(token, HttpStatusCode.OK, jsonH)
        }
        return Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(null), nowSeconds = { 1000 })
    }

    @Test fun theStartAddressAsksSupabaseForGoogleWithPkce() {
        val u = api().googleUrl("http://127.0.0.1:5555/callback", "CH")
        assertTrue(u.startsWith("https://sb.test/auth/v1/authorize?provider=google"), u)
        assertTrue(u.contains("flow_type=pkce") && u.contains("code_challenge=CH") && u.contains("code_challenge_method=s256"), u)
        assertTrue(u.contains("redirect_to=http%3A%2F%2F127.0.0.1%3A5555%2Fcallback"), u)
    }

    @Test fun theLoopbackServerHandsTheBrowsersCodeToTheApp() = runTest {
        Browser.opener = { url ->
            val redirect = URLDecoder.decode(url.substringAfter("redirect_to="), "UTF-8")
            Thread {
                Thread.sleep(150)
                // a browser asks for the icon first, then lands on the callback
                runCatching { (URL(redirect.substringBefore("/callback") + "/favicon.ico").openConnection() as HttpURLConnection).responseCode }
                (URL("$redirect?code=abc123&state=s%20t").openConnection() as HttpURLConnection).apply { responseCode; disconnect() }
            }.start()
            true
        }
        try {
            val got = Browser.authorize { redirect -> "https://sb.test/authorize?redirect_to=${urlEncode(redirect)}" }
            assertNotNull(got)
            assertEquals("abc123", got["code"]); assertEquals("s t", got["state"])
        } finally { Browser.opener = { false } }
    }

    @Test fun aBrowserThatCannotBeOpenedEndsTheAttemptAtOnce() = runTest {
        Browser.opener = { false }
        assertNull(Browser.authorize { "https://x" })
    }

    @Test fun aRefusedSignInSaysWhy() = runTest {
        Browser.opener = { url ->
            val redirect = URLDecoder.decode(url.substringAfter("redirect_to="), "UTF-8")
            Thread { Thread.sleep(100); (URL("$redirect?error=access_denied&error_description=Provider%20is%20off").openConnection() as HttpURLConnection).apply { responseCode; disconnect() } }.start()
            true
        }
        try {
            val e = assertFailsWith<ApiException> { api().signInWithGoogle() }
            assertEquals("Provider is off", e.message)
        } finally { Browser.opener = { false } }
    }

    @Test fun theCodeIsExchangedTogetherWithTheVerifier() = runTest {
        Browser.opener = { url ->
            val redirect = URLDecoder.decode(url.substringAfter("redirect_to="), "UTF-8").substringBefore("&")
            Thread { Thread.sleep(100); (URL("$redirect?code=the-code").openConnection() as HttpURLConnection).apply { responseCode; disconnect() } }.start()
            true
        }
        try {
            val a = api()
            val s = a.signInWithGoogle()
            assertNotNull(s)
            assertEquals("u1", s.userId); assertEquals("AT", s.accessToken)
            val call = synchronized(seen) { seen.last { it.contains("/auth/v1/token") } }
            assertTrue(call.contains("grant_type=pkce") && call.contains("\"auth_code\":\"the-code\"") && call.contains("\"code_verifier\":\""), call)
        } finally { Browser.opener = { false } }
    }
}
