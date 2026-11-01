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
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.affinix.app.net.Api
import space.affinix.app.net.ApiJson
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.StyleStats
import space.affinix.app.store.StylesModel
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private val fx: JsonObject = ApiJson.parseToJsonElement(StylesTest::class.java.getResource("/styles.json")!!.readText()).jsonObject
private val expected = fx["expected"]!!.jsonObject
private val traitOrder = fx["traitOrder"]!!.jsonArray.map { it.jsonPrimitive.content }

private fun entryOf(o: JsonObject, country: String? = null) = StyleStats.Entry(
    o["stim"]!!.jsonPrimitive.content, o["family"]!!.jsonPrimitive.content, o["index"]!!.jsonPrimitive.int,
    o["wins"]!!.jsonPrimitive.int, o["losses"]!!.jsonPrimitive.int, o["traits"]!!.jsonArray.map { it.jsonPrimitive.double }.toDoubleArray(), country,
)

private val entries = fx["entries"]!!.jsonArray.map { entryOf(it.jsonObject) }

private fun close(a: Double, b: Double, what: String) = assertTrue(abs(a - b) < 1e-9, "$what: $a vs $b")

/**
 * styles.json: 420 records of specimens (real measured traits from the website's generator, wins and losses) and what the website's styleInsights.js computes for them
 * (recorded by native/scripts/gen-styles-fixture.mjs). The app's port has to agree on every number and on the order of the ranked lists.
 */
class StylesTest {
    private fun checkLifts(got: List<StyleStats.Lift>, want: JsonArray, what: String) {
        assertEquals(want.size, got.size)
        want.forEachIndexed { i, w ->
            val o = w.jsonObject; val g = got[i]
            assertEquals(o["trait"]!!.jsonPrimitive.content, g.trait, what)
            close(g.lift, o["lift"]!!.jsonPrimitive.double, "$what ${g.trait} lift")
            close(g.hiRate, o["hiRate"]!!.jsonPrimitive.double, "$what ${g.trait} hiRate")
            close(g.loRate, o["loRate"]!!.jsonPrimitive.double, "$what ${g.trait} loRate")
            close(g.z, o["z"]!!.jsonPrimitive.double, "$what ${g.trait} z")
            assertEquals(o["nHi"]!!.jsonPrimitive.int, g.nHi, "$what ${g.trait} nHi"); assertEquals(o["nLo"]!!.jsonPrimitive.int, g.nLo, "$what ${g.trait} nLo")
            assertEquals(o["level"]!!.jsonPrimitive.content, g.level, "$what ${g.trait} level")
        }
    }

    private fun checkRanked(got: StyleStats.Ranked, want: JsonObject, what: String) {
        for ((name, list) in listOf("best" to got.best, "worst" to got.worst)) {
            val w = want[name]!!.jsonArray
            assertEquals(w.map { it.jsonObject["stim"]!!.jsonPrimitive.content }, list.map { it.stim }, "$what $name order")
            w.forEachIndexed { i, x ->
                val o = x.jsonObject
                assertEquals(o["wins"]!!.jsonPrimitive.int, list[i].wins); assertEquals(o["losses"]!!.jsonPrimitive.int, list[i].losses); assertEquals(o["n"]!!.jsonPrimitive.int, list[i].n)
                close(list[i].rate, o["rate"]!!.jsonPrimitive.double, "$what $name rate")
            }
        }
    }

    @Test fun theTraitLiftsAndTheRecipeAreTheWebsitesNumbers() {
        val lifts = StyleStats.traitLifts(entries)
        checkLifts(lifts, expected["lifts"]!!.jsonArray, "all")
        assertEquals(expected["recipe"]!!.jsonArray.map { it.jsonPrimitive.content }, StyleStats.recipeOf(lifts).map { it.trait })
        assertEquals(traitOrder, space.affinix.app.store.Taste.TRAITS) // the fixture and the app agree on the order of the seven traits
    }

    @Test fun aThinSliceGivesTheSameWeakerSignal() {
        val small = entries.filter { it.index < 64 }
        val lifts = StyleStats.traitLifts(small)
        checkLifts(lifts, expected["smallLifts"]!!.jsonArray, "small")
        assertEquals(expected["smallRecipe"]!!.jsonArray.map { it.jsonPrimitive.content }, StyleStats.recipeOf(lifts).map { it.trait })
    }

    @Test fun theRankedSpecimensComeInTheWebsitesOrder() {
        checkRanked(StyleStats.rankSpecimens(entries, top = 12, bottom = 4, minAnswers = 6), expected["ranked"]!!.jsonObject, "ranked")
        checkRanked(StyleStats.rankSpecimens(entries, top = 12, bottom = 4, minAnswers = 3), expected["rankedFew"]!!.jsonObject, "rankedFew")
    }

    @Test fun theWilsonBoundMatches() {
        for (w in expected["wilson"]!!.jsonArray) {
            val o = w.jsonObject
            close(StyleStats.wilsonLow(o["w"]!!.jsonPrimitive.int, o["n"]!!.jsonPrimitive.int), o["v"]!!.jsonPrimitive.double, "wilson ${o["w"]}/${o["n"]}")
        }
    }

    @Test fun seasonsAndPoolsFollowTheWebsite() {
        assertEquals("202610", StylesModel.previousSeason("202611"))
        assertEquals("202512", StylesModel.previousSeason("202601"))
        assertEquals(1, StylesModel.dropPoolForDay("2026-11-01"))
        assertEquals(30, StylesModel.dropPoolForDay("2026-10-30"))
        assertEquals("mark" to 3, StyleStats.parseKey("mark:3"))
        assertEquals(null, StyleStats.parseKey("broken"))
    }
}

private val jsonH = headersOf(HttpHeaders.ContentType, "application/json")

/** the model against a mock server that answers with the fixture's records */
class StylesModelTest {
    private val seen = mutableListOf<String>()

    private fun rowsJson(list: List<StyleStats.Entry>, dim: String = "preference") = list.joinToString(",") { """["${it.stim}","$dim",${it.wins},${it.losses}]""" }
    private val traitsByStim = entries.associate { it.stim to it.traits }

    private fun model(
        missing: Boolean = false,
        countries: String = """{"countries":[],"rows":[]}""",
        report: List<StyleStats.Entry> = entries,
    ): StylesModel {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            synchronized(seen) { seen += "${req.url.encodedPath} $body" }
            val path = req.url.encodedPath
            when {
                path.endsWith("arena_style_report") ->
                    if (missing) respond("""{"code":"PGRST202","message":"Could not find the function public.arena_style_report"}""", HttpStatusCode.NotFound, jsonH)
                    else respond("""{"season":"x","votes":9000,"voters":410,"rows":[${rowsJson(report)}]}""", HttpStatusCode.OK, jsonH)
                path.endsWith("arena_style_segments") -> respond(countries, HttpStatusCode.OK, jsonH)
                path.endsWith("arena-traits") -> {
                    val items = ApiJson.parseToJsonElement(body).jsonObject["items"]!!.jsonArray
                    val map = items.joinToString(",") { it.jsonArray.let { a ->
                        val key = "${a[0].jsonPrimitive.content}/${a[1].jsonPrimitive.content}/${a[2].jsonPrimitive.int}"
                        """"$key":${traitsByStim.getValue("${a[1].jsonPrimitive.content}:${a[2].jsonPrimitive.int}").joinToString(prefix = "[", postfix = "]")}"""
                    } }
                    respond("""{"order":["warm","bold","round","airy","vivid","rich","dark"],"traits":{$map}}""", HttpStatusCode.OK, jsonH)
                }
                else -> respond("{}", HttpStatusCode.OK, jsonH)
            }
        }
        val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        return StylesModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default))
    }

    private fun until(cond: () -> Boolean) = runBlocking { withTimeout(10_000) { while (!cond()) delay(10) } }

    @Test fun theModelShowsWhatTheWebsiteShowsForTheSameRecords() {
        val m = model(); m.load()
        until { m.status == StylesModel.Status.Ready }
        val v = assertNotNull(m.view())
        assertEquals(entries.sumOf { it.wins }, v.duels)
        assertEquals(entries.map { it.stim }.toSet().size, v.specimens)
        assertTrue(v.enough)
        assertEquals("high", v.reliability)
        val want = expected["lifts"]!!.jsonArray
        v.lifts.forEachIndexed { i, l -> close(l.lift, want[i].jsonObject["lift"]!!.jsonPrimitive.double, "model ${l.trait}") }
        assertEquals(expected["recipe"]!!.jsonArray.map { it.jsonPrimitive.content }, v.recipe.map { it.trait })
        val call = synchronized(seen) { seen.first { it.contains("arena_style_report") } }
        assertTrue(call.contains("\"p_dim\":\"preference\"") && call.contains("\"p_family\":null") && call.contains("\"p_min\":4"), call)
    }

    @Test fun aFamilyAndAQuestionAreAskedOfTheServer() {
        val m = model(); m.load(); until { m.status == StylesModel.Status.Ready }
        m.pickDim("premium"); until { m.status == StylesModel.Status.Ready && synchronized(seen) { seen.any { it.contains("\"p_dim\":\"premium\"") } } }
        m.pickFamily("card"); until { m.status == StylesModel.Status.Ready && synchronized(seen) { seen.any { it.contains("\"p_family\":\"card\"") } } }
        val last = synchronized(seen) { seen.last { it.contains("arena_style_report") } }
        assertTrue(last.contains("\"p_dim\":\"premium\"") && last.contains("\"p_family\":\"card\""), last)
    }

    @Test fun theClassicsFilterKeepsOnlyTheFirstPool() {
        val m = model(); m.load(); until { m.status == StylesModel.Status.Ready }
        m.pickScope("classic")
        val v = assertNotNull(m.view())
        val classics = entries.filter { it.index / 32 == 0 }
        assertEquals(classics.map { it.stim }.toSet().size, v.specimens)
        assertEquals(classics.sumOf { it.wins }, v.duels)
        assertTrue(!v.enough == (v.duels < 60))
    }

    @Test fun anAudienceNarrowsTheNumbersAndKeepsTheOverallAsTheReference() {
        val some = entries.take(150)
        val segRows = some.joinToString(",") { """["KZ","${it.stim}",${it.wins},${it.losses}]""" }
        val m = model(countries = """{"countries":[{"code":"KZ","voters":12,"votes":3000}],"rows":[$segRows]}""")
        m.load(); until { m.status == StylesModel.Status.Ready }
        assertEquals(listOf("KZ"), m.data!!.countries.map { it.code })
        m.pickCountry("KZ")
        val v = assertNotNull(m.view())
        assertTrue(v.picked)
        assertEquals(some.sumOf { it.wins }, v.duels)
        val direct = StyleStats.traitLifts(some)
        v.lifts.forEachIndexed { i, l -> close(l.lift, direct[i].lift, "KZ ${l.trait}") }
        val all = StyleStats.traitLifts(entries)
        v.overall.forEachIndexed { i, l -> close(l.lift, all[i].lift, "overall ${l.trait}") }
    }

    @Test fun aServerWithoutMigration0026SaysSo() {
        val m = model(missing = true); m.load()
        until { m.status == StylesModel.Status.Error }
        assertEquals("updatePending", m.error)
    }

    @Test fun tooFewAnswersAreNotPresentedAsAFinding() {
        val m = model(report = entries.take(1)); m.load(); until { m.status == StylesModel.Status.Ready }
        val v = assertNotNull(m.view())
        assertTrue(!v.enough)
    }
}
