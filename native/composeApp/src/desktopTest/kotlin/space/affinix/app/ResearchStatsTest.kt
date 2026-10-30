package space.affinix.app

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.affinix.app.net.ApiJson
import space.affinix.app.net.Experiment
import space.affinix.app.net.ExperimentRow
import space.affinix.app.net.ParticipantSession
import space.affinix.app.net.SessionRow
import space.affinix.app.net.toExperiment
import space.affinix.app.net.toSession
import space.affinix.app.store.ResearchStats
import space.affinix.app.store.ResearchStats.QuestionStats
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * research.json holds database-shaped rows of an experiment (12 questions of every type, 3 variants) and 72 participant sessions, and what the website's analytics
 * (stats.js with the row mappers of experiments.js / participants.js) computes for them, recorded by native/scripts/gen-research-fixture.mjs.
 * The app's port has to agree on every number.
 */
class ResearchStatsTest {
    private val fx: JsonObject = ApiJson.parseToJsonElement(javaClass.getResource("/research.json")!!.readText()).jsonObject
    private val experiment: Experiment = ApiJson.decodeFromJsonElement(ExperimentRow.serializer(), fx["experiment"]!!).toExperiment()
    private val sessions: List<ParticipantSession> = ApiJson.decodeFromJsonElement(ListSerializer(SessionRow.serializer()), fx["sessions"]!!).map { it.toSession() }
    private val expected = fx["expected"]!!.jsonObject
    private val done = ResearchStats.completed(sessions)

    private fun near(a: Double?, b: JsonElement?, what: String) {
        val want = (b as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
        if (want == null) assertNull(a, what) else { assertNotNull(a, what); assertTrue(abs(a - want) < 1e-9, "$what: $a vs $want") }
    }

    private fun result(qid: String): JsonObject = expected["questions"]!!.jsonArray.map { it.jsonObject }.first { it["id"]!!.jsonPrimitive.content == qid }["result"]!!.jsonObject

    @Test fun theRowsAreMappedLikeTheWebsiteDoes() {
        assertEquals(12, experiment.questions.size)
        assertEquals(listOf("A", "B", "C"), experiment.variants.map { it.label })
        assertEquals(expected["targetCount"]!!.jsonPrimitive.int, experiment.targetCount) // 120 from the settings, not the limit 100
        assertEquals(72, sessions.size)
        assertEquals(listOf("Daily", "Weekly", "Rarely"), experiment.questions[4].options)
        assertNull(experiment.questions[0].options)
        assertEquals(expected["completedCount"]!!.jsonPrimitive.int, done.size)
    }

    @Test fun everyQuestionTypeGivesTheWebsitesNumbers() {
        for (q in experiment.questions) {
            val want = result(q.id)
            val data = want["data"]
            when (val got = ResearchStats.forQuestion(experiment, done, q)) {
                is QuestionStats.ChoiceS -> {
                    assertEquals("choice", want["kind"]!!.jsonPrimitive.content, q.prompt)
                    assertEquals(data!!.jsonObject["n"]!!.jsonPrimitive.int, got.d.n)
                    val rows = data.jsonObject["rows"]!!.jsonArray
                    assertEquals(rows.map { it.jsonObject["variantId"]!!.jsonPrimitive.content }, got.d.rows.map { it.variantId }, "order of ${q.prompt}")
                    rows.forEachIndexed { i, r ->
                        assertEquals(r.jsonObject["count"]!!.jsonPrimitive.int, got.d.rows[i].count)
                        near(got.d.rows[i].rate, r.jsonObject["rate"], "rate"); near(got.d.rows[i].lo, r.jsonObject["ci"]!!.jsonArray[0], "lo"); near(got.d.rows[i].hi, r.jsonObject["ci"]!!.jsonArray[1], "hi")
                    }
                    assertEquals(data.jsonObject["sufficient"]!!.jsonPrimitive.content == "true", got.d.check.sufficient)
                }
                is QuestionStats.Dist -> {
                    assertEquals("distribution", want["kind"]!!.jsonPrimitive.content, q.prompt)
                    assertEquals(data!!.jsonObject["n"]!!.jsonPrimitive.int, got.d.n)
                    data.jsonObject["rows"]!!.jsonArray.forEachIndexed { i, r ->
                        assertEquals(r.jsonObject["option"]!!.jsonPrimitive.content, got.d.rows[i].option); assertEquals(r.jsonObject["count"]!!.jsonPrimitive.int, got.d.rows[i].count)
                        near(got.d.rows[i].rate, r.jsonObject["rate"], "dist rate")
                    }
                }
                is QuestionStats.RatingS -> {
                    assertEquals("rating", want["kind"]!!.jsonPrimitive.content)
                    data!!.jsonArray.forEachIndexed { i, r ->
                        assertEquals(r.jsonObject["n"]!!.jsonPrimitive.int, got.d[i].n); near(got.d[i].mean, r.jsonObject["mean"], "mean"); near(got.d[i].median, r.jsonObject["median"], "median")
                    }
                }
                is QuestionStats.YesNoS -> {
                    assertEquals("yesno", want["kind"]!!.jsonPrimitive.content)
                    data!!.jsonArray.forEachIndexed { i, r ->
                        assertEquals(r.jsonObject["yes"]!!.jsonPrimitive.int, got.d[i].yes); assertEquals(r.jsonObject["n"]!!.jsonPrimitive.int, got.d[i].n)
                        near(got.d[i].rate, r.jsonObject["rate"], "yes rate"); near(got.d[i].lo, r.jsonObject["ci"]!!.jsonArray[0], "yes lo"); near(got.d[i].hi, r.jsonObject["ci"]!!.jsonArray[1], "yes hi")
                    }
                }
                is QuestionStats.RankS -> {
                    assertEquals("ranking", want["kind"]!!.jsonPrimitive.content)
                    assertEquals(data!!.jsonArray.map { it.jsonObject["variantId"]!!.jsonPrimitive.content }, got.d.map { it.variantId })
                    data.jsonArray.forEachIndexed { i, r -> near(got.d[i].avgRank, r.jsonObject["avgRank"], "avgRank"); assertEquals(r.jsonObject["n"]!!.jsonPrimitive.int, got.d[i].n) }
                }
                is QuestionStats.PriceS -> {
                    assertEquals("price", want["kind"]!!.jsonPrimitive.content)
                    if (got.d.bands != null) {
                        assertEquals(data!!.jsonObject["n"]!!.jsonPrimitive.int, got.d.bands.n)
                        data.jsonObject["rows"]!!.jsonArray.forEachIndexed { i, r -> assertEquals(r.jsonObject["count"]!!.jsonPrimitive.int, got.d.bands.rows[i].count) }
                    } else {
                        assertEquals(data!!.jsonObject["n"]!!.jsonPrimitive.int, got.d.n); near(got.d.mean, data.jsonObject["mean"], "price mean"); near(got.d.median, data.jsonObject["median"], "price median")
                    }
                }
                is QuestionStats.TextS -> {
                    assertEquals("text", want["kind"]!!.jsonPrimitive.content)
                    assertEquals(data!!.jsonArray.map { it.jsonPrimitive.content }, got.d)
                }
                QuestionStats.Unknown -> error("unknown question type ${q.type}")
            }
        }
    }

    @Test fun segmentsAreSortedByTheirSizeAndAgreeWithTheWebsite() {
        val sel = expected["selectionQuestion"]!!.jsonPrimitive.content
        for (key in listOf("ageRange", "country", "language")) {
            val want = expected["segments"]!!.jsonObject[key]!!.jsonArray
            val got = ResearchStats.segments(experiment, done, sel, key)
            assertEquals(want.map { it.jsonObject["segment"]!!.jsonPrimitive.content }, got.map { it.segment }, key)
            want.forEachIndexed { i, s ->
                assertEquals(s.jsonObject["n"]!!.jsonPrimitive.int, got[i].choice.n)
                s.jsonObject["rows"]!!.jsonArray.forEachIndexed { j, r -> near(got[i].choice.rows[j].rate, r.jsonObject["rate"], "segment rate") }
            }
        }
        assertTrue(ResearchStats.segments(experiment, done, sel, "ageRange").any { it.segment == "Unknown" }) // a session without the key is its own group
    }

    @Test fun theSummaryTimesAndCompletionAreTheWebsites() {
        val s = ResearchStats.summary(experiment, sessions)
        val want = expected["summary"]!!.jsonObject
        assertEquals(want["participantCount"]!!.jsonPrimitive.int, s.participantCount); assertEquals(want["totalStarted"]!!.jsonPrimitive.int, s.totalStarted)
        near(s.completion.rate, want["completion"]!!.jsonObject["rate"], "completion rate")
        near(s.avgCompletionTimeMs, want["avgCompletionTimeMs"], "avg time"); near(s.marginPts, want["marginPts"], "margin")
        assertEquals(want["topVariant"]!!.jsonObject["label"]!!.jsonPrimitive.content, s.topVariant?.label)
        assertEquals(want["sampleSize"]!!.jsonObject["sufficient"]!!.jsonPrimitive.content == "true", s.sampleSize.sufficient)
        val rt = ResearchStats.responseTimeFor(done, expected["selectionQuestion"]!!.jsonPrimitive.content)
        near(rt.meanMs, expected["responseTime"]!!.jsonObject["meanMs"], "rt mean"); near(rt.medianMs, expected["responseTime"]!!.jsonObject["medianMs"], "rt median")
        assertEquals(expected["responseTime"]!!.jsonObject["n"]!!.jsonPrimitive.int, rt.n)
    }

    @Test fun noAnswersGiveNoNumbersAndNoVerdict() {
        val none = emptyList<ParticipantSession>()
        val s = ResearchStats.summary(experiment, none)
        assertEquals(0, s.participantCount); assertNull(s.avgCompletionTimeMs); assertEquals(0.0, s.completion.rate)
        assertTrue(!s.sampleSize.sufficient)
        val c = ResearchStats.choice(experiment, none, experiment.questions[0].id)
        assertEquals(0, c.n); assertTrue(c.rows.all { it.rate == 0.0 })
    }
}
