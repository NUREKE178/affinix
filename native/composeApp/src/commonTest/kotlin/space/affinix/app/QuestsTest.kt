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
import space.affinix.app.net.ApiJson
import space.affinix.app.net.DayStats
import space.affinix.app.net.StateResponse
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

class MarathonTest {
    @Test fun weekAndThemeMatchTheWebsitesRules() {
        // reference values computed with src/lib/arena/rules.js
        assertEquals("2026-10-26", Rules.weekStart("2026-10-30"))
        assertEquals("2026-10-26", Rules.weekStart("2026-10-26"))
        assertEquals("2026-10-26", Rules.weekStart("2026-11-01"))
        assertEquals("2024-02-26", Rules.weekStart("2024-02-29"))
        assertEquals("2025-12-29", Rules.weekStart("2026-01-01"))
        assertEquals(3, Rules.themeIndex("2026-10-30", 9))
        assertEquals(8, Rules.themeIndex("2024-02-29", 9))
        assertEquals(5, Rules.themeIndex("2026-01-01", 9))
        assertEquals("2026-10-27", Rules.addDays("2026-10-30", -3))
        assertEquals("2026-11-04", Rules.addDays("2026-10-30", 5))
        assertEquals("2024-03-05", Rules.addDays("2024-02-29", 5))
    }

    @Test fun theStateDecodesTheSetCountersAndTheRecentDays() {
        val st = ApiJson.decodeFromString(StateResponse.serializer(),
            """{"profile":{"xp":5},"today":{"day":"2026-10-30","dailyVotes":10,"setVotes":[10,4,0,0,0],"familyVotes":{"card":7},"claimed":["daily_set","set_2"]},
               "days":[{"day":"2026-10-28","familyVotes":{"card":30,"mark":2},"claimed":[]},{"day":"2026-10-30","familyVotes":{"card":7}}]}""")
        assertEquals(listOf(10, 4, 0, 0, 0), st.today?.setVotes)
        assertEquals(2, st.days.size)
        assertEquals(30, st.days[0].familyVotes["card"])
    }

    private val seenLines = mutableListOf<String>()
    private fun app(state: String): AppModel {
        val engine = MockEngine { req ->
            val sent = String(req.body.toByteArray())
            synchronized(seenLines) { seenLines += "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $sent" }
            respond(
                when {
                    req.url.encodedPath.endsWith("arena_state") -> state
                    req.url.encodedPath.endsWith("arena_submit") -> """{"state":{"profile":{"xp":0},"today":{"day":"x","slate":["a","b","c"]}}}"""
                    req.url.encodedPath.endsWith("arena_my_votes") -> """{"rows":[],"last":0,"more":false}"""
                    req.url.encodedPath.endsWith("arena-deal") -> """{"duels":[
                        {"id":"d1","season":"202610","family":"card","dim":"trust","a":1,"b":2,"pair":"202610/card/1-2","daily":false,"set":3,"specimens":[{"name":"a"},{"name":"b"}]},
                        {"id":"d2","season":"202610","family":"card","dim":"trust","a":3,"b":4,"pair":"202610/card/3-4","daily":false,"set":3,"specimens":[{"name":"a"},{"name":"b"}]},
                        {"id":"d3","season":"202610","family":"card","dim":"clarity","a":5,"b":6,"pair":"202610/card/5-6","daily":false,"set":3,"specimens":[{"name":"a"},{"name":"b"}]}]}"""
                    else -> "{}"
                }, HttpStatusCode.OK, jsonH,
            )
        }
        val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        return AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), MemoryKeyValueStore())
    }

    private suspend fun until(cond: () -> Boolean) = withContext(Dispatchers.Default) { withTimeout(5000) { while (!cond()) delay(10) } }

    private fun day() = space.affinix.app.localDay()
    private fun stateWith(setVotes: String, claimed: String = "", dailyVotes: Int = 10, extraDays: String = "", familyVotes: String = "{}") =
        """{"profile":{"xp":5},"today":{"day":"${day()}","dailyVotes":$dailyVotes,"slate":["a","b","c"],"setVotes":$setVotes,"familyVotes":$familyVotes,"claimed":[$claimed]},"days":[$extraDays]}"""

    @Test fun setsOpenOneAfterAnotherOnceTheDailyTenIsDone() = runTest {
        val a = app(stateWith("[10,4,0,0,0]", "\"set_2\""))
        until { a.today != null && a.today?.setVotes?.isNotEmpty() == true }
        assertTrue(a.marathonReady)
        assertEquals(listOf(true, false, false, false, false), a.sets.map { it.done })
        assertEquals(listOf(true, false, false, false, false), a.sets.map { it.claimed })
        assertTrue(a.setOpen(2) && a.setOpen(3) && !a.setOpen(4) && !a.setOpen(6))
    }

    @Test fun nothingOpensBeforeTheDailyTenIsDone() = runTest {
        val a = app(stateWith("[0,0,0,0,0]", dailyVotes = 6))
        until { a.today != null && a.today?.setVotes?.isNotEmpty() == true }
        assertTrue(Rules.EXTRA_SETS.none { a.setOpen(it) })
    }

    @Test fun aServerWithoutMigration0023IsNotOfferedTheMarathon() = runTest {
        val a = app("""{"profile":{"xp":5},"today":{"day":"${day()}","dailyVotes":10,"slate":["a","b","c"]}}""")
        until { a.today != null }
        assertTrue(!a.marathonReady)
    }

    @Test fun theThemeAddsUpTheFamilyAcrossTheWeekOnly() = runTest {
        val d = day()
        val monday = Rules.weekStart(d)
        val fam = Rules.FAMILY_IDS[Rules.themeIndex(d, Rules.FAMILY_IDS.size)]
        val lastWeek = Rules.addDays(monday, -1)
        val a = app(stateWith(
            "[0,0,0,0,0]", familyVotes = """{"$fam":7,"mark":99}""",
            extraDays = """{"day":"$monday","familyVotes":{"$fam":30}},{"day":"$lastWeek","familyVotes":{"$fam":500}}""",
        ))
        until { a.today != null && a.days.isNotEmpty() }
        val th = a.theme
        assertEquals(fam, th.family)
        // today's 7 + Monday's 30 (unless today is Monday, when the same row is replaced by the fresher one); last week never counts
        val expected = if (d == monday) 7 else 37
        assertEquals(expected, th.votes)
        assertEquals(Rules.THEME_GOAL, th.goal)
        assertTrue(!th.done && !th.claimed)
    }

    @Test fun aThemeGoalReachedCanBeClaimedOnce() = runTest {
        val d = day(); val fam = Rules.FAMILY_IDS[Rules.themeIndex(d, Rules.FAMILY_IDS.size)]
        val a = app(stateWith("[0,0,0,0,0]", "\"week_theme\"", familyVotes = """{"$fam":61}"""))
        until { a.today != null }
        assertTrue(a.theme.done && a.theme.claimed)
        assertEquals(60, a.theme.votes)
    }

    @Test fun playingASetDealsThatSetAndOnlyWhatIsStillMissing() = runTest {
        val a = app(stateWith("[10,7,0,0,0]"))
        until { a.today?.setVotes?.isNotEmpty() == true }
        a.startSet(3)
        until { a.game.round.value != null }
        val r = a.game.round.value!!
        assertEquals(3, r.set)
        assertEquals(3, r.duels.size) // 10 - 7 left (the mock has 3)
        val call = synchronized(seenLines) { seenLines.first { it.contains("arena-deal") } }
        assertTrue(call.contains("kind=set") && call.contains("n=3"), call)
    }

    @Test fun aLockedOrFinishedSetIsNotStarted() = runTest {
        val a = app(stateWith("[10,0,0,0,0]"))
        until { a.today?.setVotes?.isNotEmpty() == true }
        a.startSet(4) // set 3 is not done: locked
        a.startSet(2) // done
        kotlinx.coroutines.delay(200)
        assertTrue(a.game.round.value == null)
        assertTrue(synchronized(seenLines) { seenLines.none { it.contains("arena-deal") } })
    }
}
