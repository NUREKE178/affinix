package space.affinix.app.store

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import space.affinix.app.net.Experiment
import space.affinix.app.net.Question
import space.affinix.app.net.ParticipantSession

/**
 * The analytics of the website (src/lib/stats.js) as pure functions over (experiment, participants): the same inputs always give the same numbers.
 * The numbers are tested against what the website itself computes for a recorded experiment (native/scripts/gen-research-fixture.mjs).
 */
object ResearchStats {
    const val MIN_RELIABLE_SAMPLE = 30

    fun completed(ps: List<ParticipantSession>) = ps.filter { it.status == "completed" }

    class Completion(val completed: Int, val total: Int, val rate: Double)
    fun completionRate(ps: List<ParticipantSession>): Completion {
        val c = ps.count { it.status == "completed" }
        return Completion(c, ps.size, if (ps.isNotEmpty()) c.toDouble() / ps.size else 0.0)
    }

    fun mean(a: List<Double>): Double? = if (a.isEmpty()) null else a.sum() / a.size
    fun median(a: List<Double>): Double? {
        if (a.isEmpty()) return null
        val s = a.sorted(); val mid = s.size / 2
        return if (s.size % 2 == 1) s[mid] else (s[mid - 1] + s[mid]) / 2
    }

    /** Wilson score interval of a proportion: better behaved than the normal approximation for small panels */
    fun wilson(successes: Int, n: Int, z: Double = 1.96): Pair<Double, Double> = CrowdVerdict.wilson(successes, n, z)

    class SampleCheck(val sufficient: Boolean, val n: Int, val threshold: Int)
    fun sampleSizeCheck(n: Int, threshold: Int = MIN_RELIABLE_SAMPLE) = SampleCheck(n >= threshold, n, threshold)

    private fun ParticipantSession.answer(qid: String): space.affinix.app.net.Resp? = responses.firstOrNull { it.questionId == qid }

    class ResponseTime(val meanMs: Double?, val medianMs: Double?, val n: Int)
    /** an answer without a time counts as 0, as it does on the website */
    fun responseTimeFor(ps: List<ParticipantSession>, qid: String): ResponseTime {
        val times = ps.mapNotNull { p -> p.answer(qid)?.let { (it.responseTimeMs ?: 0L).toDouble() } }
        return ResponseTime(mean(times), median(times), times.size)
    }

    fun primarySelectionQuestion(e: Experiment): Question? =
        e.questions.firstOrNull { it.role == "selection" } ?: e.questions.firstOrNull { it.appliesTo == "variants" && it.type == "single_choice" } ?: e.questions.firstOrNull()

    // ---- per question ------------------------------------------------------------------------------------------------------------

    class ChoiceRow(val variantId: String, val label: String, val name: String, val color: String?, val count: Int, val rate: Double, val lo: Double, val hi: Double)
    class Choice(val rows: List<ChoiceRow>, val n: Int, val check: SampleCheck)

    /** selection-style stats for a variants / single_choice or recall question: count, rate and 95% interval per variant */
    fun choice(e: Experiment, ps: List<ParticipantSession>, qid: String): Choice {
        val counts = LinkedHashMap<String, Int>().also { m -> e.variants.forEach { m[it.id] = 0 } }
        var n = 0
        for (p in ps) {
            val v = (p.answer(qid)?.value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
            if (v in counts) { counts[v] = counts.getValue(v) + 1; n++ }
        }
        val rows = e.variants.map { v ->
            val c = counts.getValue(v.id); val (lo, hi) = wilson(c, n)
            ChoiceRow(v.id, v.label, v.name, v.color, c, if (n > 0) c.toDouble() / n else 0.0, lo, hi)
        }.sortedByDescending { it.rate }
        return Choice(rows, n, sampleSizeCheck(n))
    }

    class RatingRow(val variantId: String?, val label: String?, val name: String, val mean: Double?, val median: Double?, val n: Int)
    private fun num(el: JsonElement?): Double? = (el as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.doubleOrNull

    fun rating(e: Experiment, ps: List<ParticipantSession>, q: Question): List<RatingRow> {
        if (q.appliesTo == "variants") return e.variants.map { v ->
            val values = ps.mapNotNull { p -> num((p.answer(q.id)?.value as? JsonObject)?.get(v.id)) }
            RatingRow(v.id, v.label, v.name, mean(values), median(values), values.size)
        }
        val values = ps.mapNotNull { p -> num(p.answer(q.id)?.value) }
        return listOf(RatingRow(null, null, "Overall", mean(values), median(values), values.size))
    }

    class YesNoRow(val variantId: String?, val label: String?, val name: String, val yes: Int, val n: Int, val rate: Double, val lo: Double, val hi: Double)
    private fun bool(el: JsonElement?): Boolean? = (el as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

    fun yesNo(e: Experiment, ps: List<ParticipantSession>, q: Question): List<YesNoRow> {
        if (q.appliesTo == "variants") return e.variants.map { v ->
            var yes = 0; var n = 0
            for (p in ps) bool((p.answer(q.id)?.value as? JsonObject)?.get(v.id))?.let { n++; if (it) yes++ }
            val (lo, hi) = wilson(yes, n)
            YesNoRow(v.id, v.label, v.name, yes, n, if (n > 0) yes.toDouble() / n else 0.0, lo, hi)
        }
        var yes = 0; var n = 0
        for (p in ps) bool(p.answer(q.id)?.value)?.let { n++; if (it) yes++ }
        val (lo, hi) = wilson(yes, n)
        return listOf(YesNoRow(null, null, "Overall", yes, n, if (n > 0) yes.toDouble() / n else 0.0, lo, hi))
    }

    class RankRow(val variantId: String, val label: String, val name: String, val avgRank: Double?, val n: Int)
    /** average rank per variant (1 = best); the lower the better */
    fun ranking(e: Experiment, ps: List<ParticipantSession>, q: Question): List<RankRow> {
        val total = HashMap<String, Int>(); val cnt = HashMap<String, Int>()
        for (p in ps) {
            val arr = p.answer(q.id)?.value as? JsonArray ?: continue
            arr.forEachIndexed { idx, el ->
                val vid = (el as? JsonPrimitive)?.contentOrNull ?: return@forEachIndexed
                if (e.variants.any { it.id == vid }) { total[vid] = (total[vid] ?: 0) + idx + 1; cnt[vid] = (cnt[vid] ?: 0) + 1 }
            }
        }
        return e.variants.map { v -> RankRow(v.id, v.label, v.name, cnt[v.id]?.takeIf { it > 0 }?.let { total.getValue(v.id).toDouble() / it }, cnt[v.id] ?: 0) }
            .sortedBy { it.avgRank ?: 99.0 }
    }

    class DistRow(val option: String, val count: Int, val rate: Double)
    class Distribution(val n: Int, val rows: List<DistRow>)

    fun distribution(ps: List<ParticipantSession>, qid: String, options: List<String>): Distribution {
        val counts = LinkedHashMap<String, Int>().also { m -> options.forEach { m[it] = 0 } }
        var n = 0
        for (p in ps) {
            val r = p.answer(qid) ?: continue
            val values: List<JsonElement?> = (r.value as? JsonArray)?.toList() ?: listOf(r.value)
            for (v in values) (v as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { s -> if (s in counts) counts[s] = counts.getValue(s) + 1 }
            n++
        }
        return Distribution(n, options.map { DistRow(it, counts.getValue(it), if (n > 0) counts.getValue(it).toDouble() / n else 0.0) })
    }

    /** the price question: fixed bands as a distribution, free numbers as mean and median */
    class Price(val bands: Distribution?, val n: Int, val mean: Double?, val median: Double?)
    fun price(ps: List<ParticipantSession>, q: Question): Price {
        if (q.options != null) return distribution(ps, q.id, q.options).let { Price(it, it.n, null, null) }
        val nums = ps.mapNotNull { p -> num(p.answer(q.id)?.value) }
        return Price(null, nums.size, mean(nums), median(nums))
    }

    fun openText(ps: List<ParticipantSession>, qid: String): List<String> = ps.mapNotNull { p -> (p.answer(qid)?.value as? JsonPrimitive)?.takeIf { it.isString }?.content }

    /** one question's stats: the kind says which of the shapes it is */
    sealed class QuestionStats {
        class ChoiceS(val d: Choice) : QuestionStats()
        class Dist(val d: Distribution) : QuestionStats()
        class RatingS(val d: List<RatingRow>) : QuestionStats()
        class YesNoS(val d: List<YesNoRow>) : QuestionStats()
        class RankS(val d: List<RankRow>) : QuestionStats()
        class PriceS(val d: Price) : QuestionStats()
        class TextS(val d: List<String>) : QuestionStats()
        object Unknown : QuestionStats()
    }

    fun forQuestion(e: Experiment, ps: List<ParticipantSession>, q: Question): QuestionStats = when (q.type) {
        "single_choice", "recall" -> if (q.appliesTo == "variants") QuestionStats.ChoiceS(choice(e, ps, q.id)) else QuestionStats.Dist(distribution(ps, q.id, q.options ?: emptyList()))
        "multiple_choice" -> QuestionStats.Dist(distribution(ps, q.id, q.options ?: emptyList()))
        "rating" -> QuestionStats.RatingS(rating(e, ps, q))
        "yes_no" -> QuestionStats.YesNoS(yesNo(e, ps, q))
        "ranking" -> QuestionStats.RankS(ranking(e, ps, q))
        "price_perception" -> QuestionStats.PriceS(price(ps, q))
        "open_text" -> QuestionStats.TextS(openText(ps, q.id))
        else -> QuestionStats.Unknown
    }

    class Segment(val segment: String, val choice: Choice)
    /** a choice question's results by a demographic key (ageRange, country, language), the biggest group first */
    fun segments(e: Experiment, ps: List<ParticipantSession>, qid: String, key: String): List<Segment> {
        val groups = LinkedHashMap<String, MutableList<ParticipantSession>>()
        for (p in ps) groups.getOrPut(p.demographics[key] ?: "Unknown") { mutableListOf() }.add(p)
        return groups.map { (k, g) -> Segment(k, choice(e, g, qid)) }.sortedByDescending { it.choice.n }
    }

    fun averageCompletionTimeMs(ps: List<ParticipantSession>): Double? = mean(
        ps.filter { it.status == "completed" && it.completedAt != null && it.startedAt.isNotEmpty() }.mapNotNull { p ->
            val a = space.affinix.app.epochOfIso(p.startedAt); val b = space.affinix.app.epochOfIso(p.completedAt!!)
            if (a != null && b != null) (b - a).toDouble() else null
        },
    )

    class Summary(
        val participantCount: Int, val totalStarted: Int, val completion: Completion, val avgCompletionTimeMs: Double?, val sampleSize: SampleCheck,
        val topVariant: ChoiceRow?, val marginPts: Double,
    )

    fun summary(e: Experiment, all: List<ParticipantSession>): Summary {
        val ps = all.filter { it.experimentId == e.id }
        val done = completed(ps)
        val selQ = primarySelectionQuestion(e)
        val ch = selQ?.let { choice(e, done, it.id) }
        val top = ch?.rows?.getOrNull(0); val next = ch?.rows?.getOrNull(1)
        return Summary(
            done.size, ps.size, completionRate(ps), averageCompletionTimeMs(ps), sampleSizeCheck(done.size), top,
            if (top != null && next != null) (top.rate - next.rate) * 100 else if (top != null) top.rate * 100 else 0.0,
        )
    }
}
