package space.affinix.app.store

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import space.affinix.app.net.Experiment
import space.affinix.app.net.ParticipantSession
import space.affinix.app.net.Question
import space.affinix.app.store.ResearchStats.QuestionStats
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * The researcher's report of one experiment: a port of src/lib/insights.js (the rule-based interpreter: what happened, why it might have happened, a recommendation whose
 * confidence is tied to the sample size and the size of the gap) and of the markdown report of the website's Reports page. Every sentence traces back to a number of
 * [ResearchStats]; there is no model behind it, and the text says it is an estimate. The wording is the website's own (`insightsGen.*`, `reports.md.*`).
 */
object ResearchInsights {
    /** the text of a key with `{name}` placeholders filled, in the language of the screen */
    fun interface Tr { fun text(key: String, vars: List<Pair<String, Any>>): String }

    private fun Tr.t(key: String, vararg vars: Pair<String, Any>) = text(key, vars.toList())

    class Recommendation(val text: String, val confidence: String, val marginPts: Double? = null, val topVariantId: String? = null)

    class Insights(val whatHappened: List<String>, val why: List<String>, val recommendation: Recommendation, val sample: ResearchStats.SampleCheck, val disclaimer: String)

    /** JavaScript's `Number.prototype.toFixed` (exact decimal value of the double, ties to the larger) */
    fun toFixed(x: Double, digits: Int): String = BigDecimal(x).setScale(digits, RoundingMode.HALF_UP).toPlainString()

    /** the website's format.js: `pct` and `pts` ("pts" stays English there, in every language) */
    fun pct(x: Double?, digits: Int = 0): String = if (x == null || x.isNaN()) "—" else toFixed(x * 100, digits) + "%"
    fun pts(x: Double?, digits: Int = 1): String = if (x == null || x.isNaN()) "—" else toFixed(x, digits) + " pts"

    /** the roles of the builder's ready-made measurement questions (DIMENSION_ROLES of questionTypes.js) */
    private val DIMENSION_ROLES = setOf("selection", "attention", "trust", "quality", "premium", "clarity", "recall", "purchase_intention")

    private fun variantName(label: String?, name: String, t: Tr) = t.t("insightsGen.variantName", "label" to (label ?: ""), "name" to name)

    private fun findByRole(e: Experiment, role: String): Question? = e.questions.firstOrNull { it.role == role }

    private fun idOf(el: JsonElement?): String? = (el as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun answerOf(p: ParticipantSession, qid: String) = p.responses.firstOrNull { it.questionId == qid }

    private class Rate(val n: Int, val rate: Double?)

    /** among those who picked [target] on the selection question, the share that picked it again on [q] (a variants choice question like premium or recall) */
    private fun alignmentRate(ps: List<ParticipantSession>, selId: String, q: Question, target: String): Rate {
        var withTarget = 0; var aligned = 0
        for (p in ps) {
            if (idOf(answerOf(p, selId)?.value) != target) continue
            withTarget++
            if (idOf(answerOf(p, q.id)?.value) == target) aligned++
        }
        return Rate(withTarget, if (withTarget > 0) aligned.toDouble() / withTarget else null)
    }

    /** among those who did NOT pick [target] on the selection question, the baseline share that picked it on [q] */
    private fun baselineRate(ps: List<ParticipantSession>, selId: String, q: Question, target: String): Rate {
        var others = 0; var picked = 0
        for (p in ps) {
            val sel = answerOf(p, selId) ?: continue
            if (idOf(sel.value) == target) continue
            others++
            if (idOf(answerOf(p, q.id)?.value) == target) picked++
        }
        return Rate(others, if (others > 0) picked.toDouble() / others else null)
    }

    private class Factor(val factor: String, val rate: Double, val n: Int)

    private fun topInfluenceFactor(ps: List<ParticipantSession>, influenceId: String, selId: String, target: String): Factor? {
        val counts = LinkedHashMap<String, Int>(); var n = 0
        for (p in ps) {
            if (idOf(answerOf(p, selId)?.value) != target) continue
            val inf = answerOf(p, influenceId) ?: continue
            val v = inf.value ?: continue
            val values: List<JsonElement> = if (v is JsonArray) v.toList() else listOf(v)
            for (x in values) idOf(x)?.let { counts[it] = (counts[it] ?: 0) + 1 }
            n++
        }
        if (n == 0) return null
        var best: Pair<String, Int>? = null
        for ((f, c) in counts) if (best == null || c > best.second) best = f to c
        return best?.let { Factor(it.first, it.second.toDouble() / n, n) }
    }

    private fun confidenceFor(sufficient: Boolean, marginPts: Double, corroboration: Boolean): String = when {
        !sufficient -> "low"
        marginPts >= 15 && corroboration -> "high"
        marginPts >= 8 -> "moderate"
        marginPts >= 3 -> "low-moderate"
        else -> "low"
    }

    fun generate(e: Experiment, all: List<ParticipantSession>, t: Tr): Insights {
        val ps = all.filter { it.experimentId == e.id }
        val done = ResearchStats.completed(ps)
        val sample = ResearchStats.sampleSizeCheck(done.size)
        val selQ = ResearchStats.primarySelectionQuestion(e)
        if (selQ == null || done.isEmpty()) {
            return Insights(listOf(t.t("insightsGen.noDataYet")), emptyList(), Recommendation(t.t("insightsGen.noDataRecommendation"), "none"), sample, t.t("insightsGen.disclaimer"))
        }
        val whatHappened = ArrayList<String>(); val why = ArrayList<String>()
        val choice = ResearchStats.choice(e, done, selQ.id)
        val top = choice.rows.getOrNull(0)
            ?: return Insights(listOf(t.t("insightsGen.noDataYet")), emptyList(), Recommendation(t.t("insightsGen.noDataRecommendation"), "none"), sample, t.t("insightsGen.disclaimer"))
        val runnerUp = choice.rows.getOrNull(1)
        val marginPts = if (runnerUp != null) (top.rate - runnerUp.rate) * 100 else top.rate * 100

        if (!sample.sufficient) whatHappened += t.t("insightsGen.insufficientLeadIn", "n" to sample.n, "min" to ResearchStats.MIN_RELIABLE_SAMPLE)
        whatHappened += t.t("insightsGen.topRate", "top" to variantName(top.label, top.name, t), "rate" to pct(top.rate), "ciLow" to pct(top.lo), "ciHigh" to pct(top.hi), "n" to choice.n)
        if (runnerUp != null) whatHappened += t.t("insightsGen.edgedOut", "runnerUp" to variantName(runnerUp.label, runnerUp.name, t), "rate" to pct(runnerUp.rate), "margin" to pts(marginPts))

        var corroboration = false

        // a rating+variants question with no role or an unrecognised one stands in for "premium"; never a different known dimension such as purchase intention
        val premiumQ = findByRole(e, "premium")
            ?: e.questions.firstOrNull { it.type == "rating" && it.appliesTo == "variants" && (it.role == null || it.role !in DIMENSION_ROLES) }
        var premiumLeaderIsTop = false
        if (premiumQ != null) {
            when (val res = ResearchStats.forQuestion(e, done, premiumQ)) {
                is QuestionStats.ChoiceS -> res.d.rows.getOrNull(0)?.let { leader ->
                    premiumLeaderIsTop = leader.variantId == top.variantId
                    whatHappened += t.t("insightsGen.premiumChoiceLeader", "leader" to variantName(leader.label, leader.name, t), "rate" to pct(leader.rate))
                }
                is QuestionStats.RatingS -> {
                    val leader = res.d.sortedWith { a, b -> ((b.mean ?: 0.0) - (a.mean ?: 0.0)).let { if (it < 0) -1 else if (it > 0) 1 else 0 } }.firstOrNull()
                    if (leader?.mean != null) {
                        premiumLeaderIsTop = leader.variantId == top.variantId
                        whatHappened += t.t("insightsGen.premiumRatingLeader", "leader" to variantName(leader.label, leader.name, t), "mean" to toFixed(leader.mean, 2), "n" to leader.n)
                    }
                }
                else -> Unit
            }
        }

        val recallQ = findByRole(e, "recall") ?: e.questions.firstOrNull { it.type == "recall" }
        var recallLeaderIsTop = false
        if (recallQ != null) {
            val res = ResearchStats.forQuestion(e, done, recallQ)
            if (res is QuestionStats.ChoiceS) res.d.rows.getOrNull(0)?.let { leader ->
                recallLeaderIsTop = leader.variantId == top.variantId
                whatHappened += t.t("insightsGen.recallLeader", "leader" to variantName(leader.label, leader.name, t), "rate" to pct(leader.rate))
            }
        }

        // associational "why" sentences: observed links in this sample, never proven causes
        if (premiumQ != null && premiumQ.appliesTo == "variants" && premiumQ.type != "rating") {
            val aligned = alignmentRate(done, selQ.id, premiumQ, top.variantId)
            val base = baselineRate(done, selQ.id, premiumQ, top.variantId)
            if (aligned.n >= 5 && base.rate != null && aligned.rate != null && base.rate > 0) {
                val lift = aligned.rate / base.rate
                if (lift > 1.2) {
                    corroboration = true
                    why += t.t("insightsGen.premiumAlignment", "top" to variantName(top.label, top.name, t), "lift" to toFixed(lift, 1), "alignedRate" to pct(aligned.rate), "baseRate" to pct(base.rate), "n" to aligned.n)
                }
            }
        } else if (premiumLeaderIsTop) {
            corroboration = true
            why += t.t("insightsGen.premiumLeaderMatch", "top" to variantName(top.label, top.name, t))
        }

        if (recallLeaderIsTop) {
            corroboration = true
            why += t.t("insightsGen.recallLeaderMatch", "top" to variantName(top.label, top.name, t))
        }

        val influenceQ = findByRole(e, "influence")
        if (influenceQ != null) {
            val topFactor = topInfluenceFactor(done, influenceQ.id, selQ.id, top.variantId)
            val runnerFactor = runnerUp?.let { topInfluenceFactor(done, influenceQ.id, selQ.id, it.variantId) }
            if (topFactor != null && topFactor.n >= 5) {
                var line = t.t("insightsGen.influenceFactor", "top" to variantName(top.label, top.name, t), "rate" to pct(topFactor.rate), "factor" to topFactor.factor, "n" to topFactor.n)
                if (runnerFactor != null && runnerUp != null && runnerFactor.n >= 5 && runnerFactor.factor != topFactor.factor) {
                    line += t.t("insightsGen.influenceFactorRunnerUp", "runnerUp" to variantName(runnerUp.label, runnerUp.name, t), "factor" to runnerFactor.factor, "rate" to pct(runnerFactor.rate), "n" to runnerFactor.n)
                }
                why += line
            }
        }

        if (why.isEmpty()) why += t.t("insightsGen.noSecondaryPattern")

        val confidence = confidenceFor(sample.sufficient, marginPts, corroboration)
        val topName = variantName(top.label, top.name, t)
        val text = if (!sample.sufficient) t.t("insightsGen.recInsufficient", "top" to topName, "needed" to maxOf(0, ResearchStats.MIN_RELIABLE_SAMPLE - sample.n))
        else if (confidence == "high") t.t("insightsGen.recHigh", "top" to topName, "margin" to pts(marginPts))
        else if (confidence == "moderate") t.t("insightsGen.recModerate", "top" to topName, "margin" to pts(marginPts))
        else t.t("insightsGen.recLow", "top" to topName, "margin" to pts(marginPts))

        return Insights(whatHappened, why, Recommendation(text, confidence, marginPts, top.variantId), sample, t.t("insightsGen.disclaimer"))
    }

    fun researchTypeLabel(id: String?, t: Tr): String = if (id != null && id in ResearchModel.RESEARCH_TYPES) t.t("questionTypes.research.$id.label") else id ?: ""

    /** the website's `buildMarkdownReport`: the report as text to keep or send. [dateText] is today's date as the reader's locale writes it. */
    fun markdown(e: Experiment, summary: ResearchStats.Summary, choice: ResearchStats.Choice?, segments: List<ResearchStats.Segment>, insights: Insights, t: Tr, dateText: String): String {
        val lines = ArrayList<String>()
        lines += "# ${e.name}"
        lines += ""
        lines += "*${t.t("reports.md.generatedOn", "type" to researchTypeLabel(e.researchType, t), "date" to dateText)}*"
        lines += ""
        lines += "## ${t.t("reports.md.objective")}"
        lines += e.objective?.takeIf { it.isNotEmpty() } ?: "—"
        lines += ""
        lines += "## ${t.t("reports.md.methodology")}"
        lines += t.t("reports.md.methodologyBody", "variants" to e.variants.size, "questions" to e.questions.size, "randomized" to if (e.randomizeVariants) t.t("reports.md.randomized") else t.t("reports.md.fixed"))
        lines += ""
        lines += "## ${t.t("reports.md.sample")}"
        lines += "- ${t.t("reports.md.sampleParticipants", "count" to summary.participantCount, "target" to e.targetCount)}"
        lines += "- ${t.t("reports.md.sampleCompletion", "rate" to pct(summary.completion.rate))}"
        lines += "- ${t.t("reports.md.sampleSize", "status" to if (summary.sampleSize.sufficient) t.t("reports.md.sampleSufficient") else t.t("reports.md.sampleInsufficient"), "n" to summary.sampleSize.n)}"
        lines += ""
        if (choice != null) {
            lines += "## ${t.t("reports.md.comparison")}"
            for (r in choice.rows) lines += "- ${t.t("reports.md.comparisonRow", "label" to r.label, "name" to r.name, "rate" to pct(r.rate), "ciLow" to pct(r.lo), "ciHigh" to pct(r.hi), "n" to r.count)}"
            lines += ""
        }
        if (segments.isNotEmpty()) {
            lines += "## ${t.t("reports.md.segments")}"
            for (s in segments) {
                val leader = s.choice.rows.getOrNull(0) ?: continue
                lines += "- ${t.t("reports.md.segmentRow", "segment" to s.segment, "n" to s.choice.n, "smallSample" to if (!s.choice.check.sufficient) t.t("reports.md.smallSampleSuffix") else "", "label" to leader.label, "rate" to pct(leader.rate))}"
            }
            lines += ""
        }
        lines += "## ${t.t("reports.md.keyFindings")}"
        lines += "**${t.t("reports.md.whatHappened")}**"
        insights.whatHappened.forEach { lines += "- $it" }
        lines += "\n**${t.t("reports.md.whyItMightHaveHappened")}**"
        insights.why.forEach { lines += "- $it" }
        lines += "\n**${t.t("reports.md.recommendationHeading", "confidence" to t.t("insights.confidence.${insights.recommendation.confidence}"))}**\n${insights.recommendation.text}"
        lines += ""
        lines += "## ${t.t("reports.md.limitations")}"
        lines += "- ${t.t("reports.md.limitation1")}"
        lines += "- ${t.t("reports.md.limitation2")}"
        if (!summary.sampleSize.sufficient) lines += "- ${t.t("reports.md.limitation3")}"
        lines += ""
        lines += "## ${t.t("reports.md.nextExperiment")}"
        lines += if (summary.sampleSize.sufficient) t.t("reports.md.nextExperimentSufficient") else t.t("reports.md.nextExperimentInsufficient", "n" to maxOf(0, 30 - summary.sampleSize.n))
        lines += "\n---\n${insights.disclaimer}"
        return lines.joinToString("\n")
    }
}
