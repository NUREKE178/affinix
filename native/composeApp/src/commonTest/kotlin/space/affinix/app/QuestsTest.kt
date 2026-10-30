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
import space.affinix.app.net.DayStats
import space.affinix.app.net.MemoryKeyValueStore
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.AppModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Expected values were computed with the website's own src/lib/prng.js and rules.js. */
class PrngAndQuestsTest {
    @Test fun hashMatchesTheWebsite() {
        assertEquals(566933746L, Prng.hashStringToSeed("u1/2026-10-30/slate"))
        assertEquals(871640481L, Prng.hashStringToSeed("abc-123/2026-11-02/slate"))
        assertEquals(1257444779L, Prng.hashStringToSeed("қазақ/2026-01-01/slate"))
    }

    @Test fun mulberryMatchesTheWebsite() {
        assertEquals(0.1499791224487126, Prng.mulberry32(566933746L)(), 1e-15)
        assertEquals(0.31231972947716713, Prng.mulberry32(871640481L)(), 1e-15)
        assertEquals(0.18873210181482136, Prng.mulberry32(1257444779L)(), 1e-15)
    }

    @Test fun theSlateIsTheSameAsOnTheWebsite() {
        assertEquals(listOf("votes_15", "fam_5", "combo_12"), Rules.slateFor("u1", "2026-10-30"))
        assertEquals(listOf("votes_15", "eye_5", "combo_12"), Rules.slateFor("abc-123", "2026-11-02"))
        assertEquals(listOf("votes_15", "combo_6", "eye_12"), Rules.slateFor("қазақ", "2026-01-01"))
    }

    @Test fun aSlateHasOneQuestPerTierAndNeverTwoOfAKind() {
        for (i in 0 until 300) {
            val ids = Rules.slateFor("user$i", "2026-10-30")
            val defs = ids.map { Rules.QUEST_BY_ID.getValue(it) }
            assertEquals(listOf(Rules.Tier.Easy, Rules.Tier.Medium, Rules.Tier.Hard), defs.map { it.tier })
            assertEquals(3, defs.map { it.kind }.toSet().size)
            assertTrue(defs.none { it.retired })
        }
    }

    @Test fun questCountersReadTheDay() {
        val d = DayStats(votes = 20, sec = 120, maxCombo = 7, eyeCorrect = 4, families = listOf("mark", "card"), dims = listOf("trust"))
        assertEquals(listOf(20, 2, 1, 7, 4, 120), listOf("votes", "families", "dims", "combo", "eye", "time").map { d.metric(it) })
        assertEquals(0, d.metric("nonsense"))
    }
}

private val jsonH = headersOf(HttpHeaders.ContentType, "application/json")

class ClaimFlowTest {
    private val seen = mutableListOf<String>()
    private fun app(state: String, claim: String = """{"ok":true,"state":{"profile":{"xp":1030,"level":5},"today":{"day":"x","slate":["votes_15","fam_5","combo_12"],"claimed":["votes_15"],"votes":20}}}"""): AppModel {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            synchronized(seen) { seen += "${req.method.value} ${req.url.encodedPath} $body" }
            respond(
                when {
                    req.url.encodedPath.endsWith("arena_state") -> state
                    req.url.encodedPath.endsWith("arena_submit") -> """{"state":{"profile":{"xp":0},"today":{"day":"x","slate":["a","b","c"]}}}"""
                    req.url.encodedPath.endsWith("arena_claim") -> claim
                    req.url.encodedPath.endsWith("arena_my_votes") -> """{"rows":[],"last":0,"more":false}"""
                    else -> "{}"
                }, HttpStatusCode.OK, jsonH,
            )
        }
        val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        return AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), MemoryKeyValueStore())
    }

    private suspend fun until(cond: () -> Boolean) = withContext(Dispatchers.Default) { withTimeout(5000) { while (!cond()) delay(10) } }

    @Test fun aDayWithoutQuestsGetsTheWebsitesSlateSubmitted() = runTest {
        val a = app("""{"profile":{"xp":5},"today":{"day":"x","slate":[]}}""")
        until { synchronized(seen) { seen.any { it.contains("arena_submit") } } }
        val submit = synchronized(seen) { seen.first { it.contains("arena_submit") } }
        val expected = Rules.slateFor("me", localDay())
        assertTrue(submit.contains("\"p_slate\":{\"day\":\"${localDay()}\",\"ids\":[${expected.joinToString(",") { "\"$it\"" }}]}"), submit)
        assertTrue(submit.contains("\"p_votes\":[]"))
        until { a.today?.slate?.size == 3 }
    }

    @Test fun aDayThatAlreadyHasQuestsIsLeftAlone() = runTest {
        val a = app("""{"profile":{"xp":5},"today":{"day":"x","slate":["votes_15","fam_5","combo_12"],"votes":3}}""")
        until { a.today != null }
        delay(150)
        assertTrue(synchronized(seen) { seen.none { it.contains("arena_submit") } })
        assertEquals(listOf("votes_15", "fam_5", "combo_12"), a.quests.map { it.id })
    }

    @Test fun claimingUpdatesTheProfileAndTheClaimedList() = runTest {
        val a = app("""{"profile":{"xp":1000},"today":{"day":"x","slate":["votes_15","fam_5","combo_12"],"votes":20}}""")
        until { a.today != null }
        assertNull(a.claim("votes_15"))
        assertEquals(1030L, a.profile?.xp)
        assertEquals(listOf("votes_15"), a.today?.claimed)
        assertTrue(synchronized(seen) { seen.first { it.contains("arena_claim") } }.contains("\"p_quest\":\"votes_15\""))
    }

    @Test fun aRefusedClaimSaysSo() = runTest {
        val a = app("""{"profile":{"xp":1000},"today":{"day":"x","slate":["votes_15","fam_5","combo_12"]}}""", claim = """{"ok":false,"reason":"not_done"}""")
        until { a.today != null }
        assertEquals("arena.toast.claimRefused", a.claim("votes_15"))
        assertEquals(1000L, a.profile?.xp)
    }
}
