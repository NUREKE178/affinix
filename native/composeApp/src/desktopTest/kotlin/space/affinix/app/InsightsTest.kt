package space.affinix.app

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.affinix.app.i18n.Lang
import space.affinix.app.i18n.tr
import space.affinix.app.net.ApiJson
import space.affinix.app.net.Experiment
import space.affinix.app.net.ExperimentRow
import space.affinix.app.net.ParticipantSession
import space.affinix.app.net.SessionRow
import space.affinix.app.net.toExperiment
import space.affinix.app.net.toSession
import space.affinix.app.store.ResearchInsights
import space.affinix.app.store.ResearchStats
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * insights.json holds what the website's report (insights.js and the markdown report of the Reports page) says about the research fixture's experiment, in ru / kk / en and for
 * a full sample, a thin one, no answers and a randomised variant order (recorded by native/scripts/gen-insights-fixture.mjs). The app's port has to say the same, word for word.
 */
class InsightsTest {
    private val research: JsonObject = ApiJson.parseToJsonElement(javaClass.getResource("/research.json")!!.readText()).jsonObject
    private val fx: JsonObject = ApiJson.parseToJsonElement(javaClass.getResource("/insights.json")!!.readText()).jsonObject
    private val experiment: Experiment = ApiJson.decodeFromJsonElement(ExperimentRow.serializer(), research["experiment"]!!).toExperiment()
    private val sessions: List<ParticipantSession> = ApiJson.decodeFromJsonElement(ListSerializer(SessionRow.serializer()), research["sessions"]!!).map { it.toSession() }
    private val smallCount = fx["smallCount"]!!.jsonPrimitive.int

    private fun tr(locale: String) = ResearchInsights.Tr { key, vars -> tr(Lang.values().first { it.tag == locale }, key, *vars.toTypedArray()) }

    private fun scenario(name: String): Pair<Experiment, List<ParticipantSession>> = when (name) {
        "full" -> experiment to sessions
        "small" -> experiment to sessions.take(smallCount)
        "empty" -> experiment to emptyList()
        "randomized" -> experiment.copy(randomizeVariants = true) to sessions
        else -> error(name)
    }

    @Test fun theReportSaysWhatTheWebsiteSaysInEveryLanguage() {
        val cases = fx["cases"]!!.jsonArray
        assertEquals(12, cases.size)
        for (c in cases) {
            val o = c.jsonObject
            val name = o["scenario"]!!.jsonPrimitive.content; val locale = o["locale"]!!.jsonPrimitive.content
            val (e, ps) = scenario(name)
            val t = tr(locale)
            val got = ResearchInsights.generate(e, ps, t)
            val want = o["insights"]!!.jsonObject
            val what = "$name/$locale"
            assertEquals(want["whatHappened"]!!.jsonArray.map { it.jsonPrimitive.content }, got.whatHappened, "$what whatHappened")
            assertEquals(want["why"]!!.jsonArray.map { it.jsonPrimitive.content }, got.why, "$what why")
            assertEquals(want["recommendation"]!!.jsonObject["text"]!!.jsonPrimitive.content, got.recommendation.text, "$what recommendation")
            assertEquals(want["recommendation"]!!.jsonObject["confidence"]!!.jsonPrimitive.content, got.recommendation.confidence, "$what confidence")
            assertEquals(want["sample"]!!.jsonObject["n"]!!.jsonPrimitive.int, got.sample.n, "$what sample n")
            assertEquals(want["disclaimer"]!!.jsonPrimitive.content, got.disclaimer, "$what disclaimer")

            // the markdown report; its third line carries today's date, which differs by the day it was recorded
            val done = ResearchStats.completed(ps.filter { it.experimentId == e.id })
            val sel = ResearchStats.primarySelectionQuestion(e)
            val choice = sel?.let { ResearchStats.choice(e, done, it.id) }
            val segments = sel?.let { ResearchStats.segments(e, done, it.id, "ageRange") } ?: emptyList()
            val md = ResearchInsights.markdown(e, ResearchStats.summary(e, ps), choice, segments, got, t, "DATE")
            val wantLines = o["markdown"]!!.jsonPrimitive.content.lines(); val gotLines = md.lines()
            assertEquals(wantLines.size, gotLines.size, "$what markdown lines")
            wantLines.forEachIndexed { i, line -> if (i != 2) assertEquals(line, gotLines[i], "$what markdown line ${i + 1}") }
            assertTrue(gotLines[2].startsWith("*") && gotLines[2].contains("DATE"), "$what date line")
        }
    }

    @Test fun theRoundingIsJavaScriptsToFixed() {
        // values the website's format.js gives (Number.prototype.toFixed: the exact value of the double, ties to the larger)
        assertEquals("0.1", ResearchInsights.toFixed(0.15, 1))
        assertEquals("1.00", ResearchInsights.toFixed(1.005, 2))
        assertEquals("3", ResearchInsights.toFixed(2.5, 0))
        assertEquals("28", ResearchInsights.toFixed(0.285 * 100, 0))
        assertEquals("8.35", ResearchInsights.toFixed(8.345, 2))
        assertEquals("-2", ResearchInsights.toFixed(-1.5, 0))
        assertEquals("56.7", ResearchInsights.toFixed(56.6666, 1))
        assertEquals("13%", ResearchInsights.pct(0.125))
        assertEquals("—", ResearchInsights.pct(null))
        assertEquals("56.7 pts", ResearchInsights.pts(56.6666))
    }

    @Test fun theVariantOrderSettingIsReadFromTheExperimentRow() {
        val row = research["experiment"]!!.jsonObject.toMutableMap().also { it["settings"] = ApiJson.parseToJsonElement("""{"randomizeVariantOrder":true}""") }
        val e = ApiJson.decodeFromJsonElement(ExperimentRow.serializer(), JsonObject(row)).toExperiment()
        assertTrue(e.randomizeVariants)
        assertTrue(!experiment.randomizeVariants)
    }
}
