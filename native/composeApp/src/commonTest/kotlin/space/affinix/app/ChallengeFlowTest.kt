package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.runTest
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.MemoryKeyValueStore
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.AppModel
import space.affinix.app.store.Challenge
import space.affinix.app.store.Mode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The app side of Taste Match: a link that reaches the device, the welcome, and playing the friend's pairs (AppModel, with a fake server). */
class ChallengeFlowTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    /** the six answers of the shared vector «no name» */
    private val sent = ChallengeVectors.good.first { it.note == "no name" }.answers.split(',').map { p -> p.split(':').let { Challenge.Answer(it[0], it[1].toInt(), it[2].toInt(), it[3], it[4].toInt()) } }

    private fun linkFor(season: String, name: String? = "Aigerim") = assertNotNull(Challenge.encode(season, sent, name))

    private fun dealFor(season: String) = """{"duels":[${sent.joinToString(",") { a ->
        """{"id":"${a.family}-${a.a}-${a.b}","season":"$season","family":"${a.family}","dim":"${a.dim}","a":${a.a},"b":${a.b},"pair":"$season/${a.family}/${a.a}-${a.b}","swap":false,"objective":false,"repeat":false,"daily":false,"set":0,"specimens":[{"name":"A"},{"name":"B"}]}"""
    }}]}"""

    private class Rig(val app: AppModel, val log: MutableList<String>, val kv: MemoryKeyValueStore) {
        /** the requests the fake server has seen so far (a copy: the server writes to the list from its own thread) */
        fun requests(): List<String> = synchronized(log) { log.toList() }
    }

    private fun rig(season: String = seasonOf(), kv: MemoryKeyValueStore = MemoryKeyValueStore(), votes: Int = 0, seen: List<Pair<String, String>> = emptyList(), dealFails: Boolean = false): Rig {
        val log = java.util.Collections.synchronizedList(mutableListOf<String>())
        val engine = MockEngine { req ->
            val path = req.url.encodedPath
            log += "${req.method.value} $path?${req.url.encodedQuery}"
            if (dealFails && path.endsWith("/api/arena-deal")) return@MockEngine respond("""{"error":"bad kind"}""", HttpStatusCode.BadRequest, json)
            val body = when {
                path.endsWith("/api/arena-deal") -> dealFor(season)
                path.endsWith("arena_state") -> """{"profile":{"xp":0,"level":1,"votes":$votes,"streak":0,"visible":true,"badges":[]}}"""
                path.endsWith("arena_my_votes") -> """{"rows":[${seen.joinToString(",") { (pair, dim) -> """["$pair","$dim",0]""" }}],"last":0,"more":false}"""
                path.endsWith("arena_tallies") -> "[]"
                else -> "[]"
            }
            respond(body, HttpStatusCode.OK, json)
        }
        val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        return Rig(AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), kv), log, kv)
    }

    private suspend fun waitUntil(limitMs: Long = 5000, cond: () -> Boolean) = kotlinx.coroutines.withContext(Dispatchers.Default) {
        kotlinx.coroutines.withTimeout(limitMs) { while (!cond()) kotlinx.coroutines.delay(10) }
    }

    /** AppModel reads the profile as soon as it is made; while that goes on `loading` is true and the Play key is disabled (playChallenge ignores the call, like startDaily) */
    private suspend fun settled(app: AppModel) = waitUntil { app.profile != null && !app.loading }

    // ---- a link that reaches the device ----------------------------------------------------------

    @Test fun aLinkIsTakenFromAnAddressAFriendsMessageOrTheBareValue() {
        val c = linkFor(seasonOf())
        for (text in listOf("https://affinix.space/?c=$c", "Сравним вкусы?\nhttps://affinix.space/?c=$c\nИ узнай, насколько мы совпадаем.", c)) {
            val app = rig().app
            assertTrue(app.receiveChallenge(text), text)
            assertEquals("Aigerim", app.challenge?.name)
            assertEquals(sent, app.challenge?.answers)
        }
    }

    @Test fun somethingThatIsNotAChallengeIsRefusedAndChangesNothing() {
        val app = rig().app
        assertFalse(app.receiveChallenge("привет"))
        assertFalse(app.receiveChallenge("https://affinix.space/?c=1.202611.zzzz-1-2-3-4."))
        assertFalse(app.receiveChallenge(null))
        assertNull(app.challenge)
        assertTrue(app.receiveChallenge(linkFor(seasonOf())))
        assertFalse(app.receiveChallenge("привет"))
        assertNotNull(app.challenge, "a refused paste does not throw away the waiting challenge")
    }

    @Test fun aWaitingChallengeSurvivesARestartAndIsForgottenOnRequest() {
        val kv = MemoryKeyValueStore()
        val first = rig(kv = kv).app
        first.receiveChallenge(linkFor(seasonOf()))
        assertNotNull(rig(kv = kv).app.challenge, "after a restart the same link is still waiting")
        first.forgetChallenge()
        assertNull(first.challenge)
        assertNull(rig(kv = kv).app.challenge)
    }

    @Test fun aBrokenValueInStorageIsThrownAway() {
        val kv = MemoryKeyValueStore().also { it.put("challenge", "1.202611.zzzz-1-2-3-4.") }
        val app = rig(kv = kv).app
        assertNull(app.challenge)
        assertNull(kv.get("challenge"))
    }

    @Test fun laterPutsTheWelcomeAwayForThisVisitOnly() {
        val kv = MemoryKeyValueStore()
        val app = rig(kv = kv).app
        app.receiveChallenge(linkFor(seasonOf()))
        assertNotNull(app.activeChallenge)
        app.snoozeChallenge()
        assertNull(app.activeChallenge, "hidden for now")
        assertNotNull(app.challenge, "but still waiting")
        assertNotNull(rig(kv = kv).app.activeChallenge, "and back at the next visit")
    }

    // ---- the first look ---------------------------------------------------------------------------

    @Test fun theWelcomeIsForAPlayerWithNoAnswersAndOnlyOnce() = runTest {
        val kv = MemoryKeyValueStore()
        val r = rig(kv = kv, votes = 0)
        assertFalse(r.app.firstLookDue, "nothing is shown before the profile has been read")
        r.app.refresh()
        waitUntil { r.app.profile != null }
        assertTrue(r.app.firstLookDue)
        r.app.markFirstLookSeen()
        assertFalse(r.app.firstLookDue)
        assertTrue(rig(kv = kv).app.firstLookSeen, "and it stays put after a restart")
    }

    @Test fun aPlayerWhoHasAnsweredIsNeverWelcomedAgain() = runTest {
        val r = rig(votes = 12)
        r.app.refresh()
        waitUntil { r.app.profile != null }
        assertFalse(r.app.firstLookDue)
    }

    // ---- playing the friend's pairs --------------------------------------------------------------------

    @Test fun playingAChallengeDealsTheLinksPairsAndOpensAChallengeRound() = runTest {
        val season = seasonOf()
        val r = rig(season)
        settled(r.app)
        r.app.receiveChallenge(linkFor(season))
        r.app.playChallenge()
        waitUntil { r.app.game.round.value != null }
        val round = r.app.game.round.value!!
        assertEquals(Mode.Challenge, round.mode)
        assertEquals(sent.size, round.duels.size)
        assertEquals(sent.map { Challenge.pairOf(season, it) }, round.duels.map { it.pair }, "the friend's pairs, in the friend's order")
        assertTrue(round.duels.none { it.repeat }, "nothing answered yet: every pair is worth XP")
        assertTrue(round.duels.none { it.daily || it.set != 0 }, "a challenge pair is a free-play pair for the server")
        assertEquals("Aigerim", round.challenge?.name)
        val deal = r.requests().first { it.contains("/api/arena-deal") }
        assertTrue(deal.contains("kind=pairs") && deal.contains("c=1.") && deal.contains("seed="), deal)
        assertNull(r.app.challenge, "once the round is open the challenge is no longer waiting")
        assertNull(r.kv.get("challenge"))
        assertTrue(r.app.firstLookSeen, "and a player who plays one needs no welcome")
    }

    @Test fun aPairThePlayerHasAlreadyAnsweredEarnsNothingAgain() = runTest {
        val season = seasonOf()
        val r = rig(season, seen = listOf(Challenge.pairOf(season, sent[2]) to sent[2].dim))
        settled(r.app)
        r.app.receiveChallenge(linkFor(season))
        r.app.playChallenge()
        waitUntil { r.app.game.round.value != null }
        assertEquals(sent.indices.map { it == 2 }, r.app.game.round.value!!.duels.map { it.repeat }, "only the third pair was answered before")
    }

    @Test fun aChallengeOfAnOldSeasonIsPlayedButEarnsNothing() = runTest {
        val r = rig("202401")
        settled(r.app)
        r.app.receiveChallenge(linkFor("202401"))
        r.app.playChallenge()
        waitUntil { r.app.game.round.value != null }
        assertTrue(r.app.game.round.value!!.duels.all { it.repeat }, "the server no longer takes votes of that season: no XP and nothing is sent")
        assertFalse(Challenge.seasonIsLive("202401", Platform.nowMillis()))
    }

    @Test fun aFailedDealKeepsTheChallengeWaiting() = runTest {
        // an older server does not know kind=pairs: it answers 400, the app says so and the link stays for the next try
        val r = rig(dealFails = true)
        settled(r.app)
        r.app.receiveChallenge(linkFor(seasonOf()))
        r.app.playChallenge()
        waitUntil { r.requests().any { it.contains("/api/arena-deal") } && !r.app.loading }
        assertNull(r.app.game.round.value)
        assertNotNull(r.app.challenge, "the player can try again")
        assertNotNull(r.kv.get("challenge"))
        assertNotNull(r.app.error)
        assertTrue(r.app.error!!.contains("400"), r.app.error)
    }
}
