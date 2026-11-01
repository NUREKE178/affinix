package space.affinix.app.store

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * "What people love" (the website's Styles page), a port of the maths of src/lib/styleInsights.js. The server counts how every specimen fared in its duels; the traits of a
 * specimen are measured (see [Taste.TRAITS]). Specimens that lean one way on a trait (<= -0.25 or >= +0.25) are compared with those that lean the other way: the lift is the
 * difference of their win rates, with an ordinary two-proportion z. A signal about Arena players, not a forecast for a target market.
 */
object StyleStats {
    const val LEAN = 0.25
    const val MIN_GROUP = 40
    const val MAX_SPECIMENS = 900

    /** one specimen's record for one question (or, for an audience, in one country) with its measured traits in the order of [Taste.TRAITS] */
    class Entry(val stim: String, val family: String, val index: Int, val wins: Int, val losses: Int, val traits: DoubleArray, val country: String? = null)

    /** lift in -1..1 (positive: the "hi" pole wins); level is "strong" | "clear" | "hint" | "none" */
    class Lift(val trait: String, val lift: Double, val hiRate: Double, val loRate: Double, val nHi: Int, val nLo: Int, val z: Double, val level: String)

    class Spec(val stim: String, val family: String, val index: Int, val traits: DoubleArray, val wins: Int, val losses: Int, val n: Int, val rate: Double)

    class Ranked(val best: List<Spec>, val worst: List<Spec>)

    /** "mark:3" -> ("mark", 3) */
    fun parseKey(stim: String): Pair<String, Int>? {
        val i = stim.indexOf(':')
        if (i <= 0) return null
        val index = stim.substring(i + 1).toIntOrNull() ?: return null
        return stim.substring(0, i) to index
    }

    /** like the site's `a - b || tie`: only a real difference decides */
    private fun sign(x: Double) = if (x < 0) -1 else if (x > 0) 1 else 0

    private fun rate(w: Int, l: Int) = if (w + l > 0) w.toDouble() / (w + l) else 0.5

    fun traitLifts(entries: List<Entry>): List<Lift> = Taste.TRAITS.mapIndexed { ti, trait ->
        var hw = 0; var hl = 0; var lw = 0; var ll = 0
        for (e in entries) {
            val v = e.traits[ti]
            if (v >= LEAN) { hw += e.wins; hl += e.losses } else if (v <= -LEAN) { lw += e.wins; ll += e.losses }
        }
        val nHi = hw + hl; val nLo = lw + ll
        val hiRate = rate(hw, hl); val loRate = rate(lw, ll)
        val lift = hiRate - loRate
        val se = sqrt((hiRate * (1 - hiRate)) / max(nHi, 1) + (loRate * (1 - loRate)) / max(nLo, 1))
        val z = if (nHi >= MIN_GROUP && nLo >= MIN_GROUP && se > 0) lift / se else 0.0
        val level = if (abs(z) >= 2.58) "strong" else if (abs(z) >= 1.96) "clear" else if (abs(z) >= 1.28) "hint" else "none"
        Lift(trait, lift, hiRate, loRate, nHi, nLo, z, level)
    }

    /** the lifts that are at least "clear", strongest first: the recipe of a winning style */
    fun recipeOf(lifts: List<Lift>, count: Int = 3): List<Lift> =
        lifts.filter { it.level == "strong" || it.level == "clear" }.sortedByDescending { abs(it.z) }.take(count)

    /** lower bound of the 80% Wilson interval of a win rate: ranks a specimen by what it can be trusted to be worth */
    fun wilsonLow(w: Int, n: Int, z: Double = 1.28): Double {
        if (n <= 0) return 0.0
        val p = w.toDouble() / n
        val d = 1 + (z * z) / n
        return (p + (z * z) / (2 * n) - z * sqrt((p * (1 - p)) / n + (z * z) / (4.0 * n * n))) / d
    }

    /**
     * Specimens merged over the loaded questions, then ranked. The "worst" list is ordered exactly as the website orders it (by the lower bound of the loss rate, ascending),
     * so the two agree; scripts/gen-styles-fixture.mjs records the site's answer and StylesStatsTest compares.
     */
    fun rankSpecimens(entries: List<Entry>, top: Int = 6, bottom: Int = 3, minAnswers: Int = 6): Ranked {
        class M(val stim: String, val family: String, val index: Int, val traits: DoubleArray) { var wins = 0; var losses = 0 }
        val merged = LinkedHashMap<String, M>()
        for (e in entries) {
            val m = merged.getOrPut(e.stim) { M(e.stim, e.family, e.index, e.traits) }
            m.wins += e.wins; m.losses += e.losses
        }
        val list = merged.values.filter { it.wins + it.losses >= minAnswers }.map { Spec(it.stim, it.family, it.index, it.traits, it.wins, it.losses, it.wins + it.losses, rate(it.wins, it.losses)) }
        val byLow = list.sortedWith { a, b ->
            val c = sign(wilsonLow(b.wins, b.n) - wilsonLow(a.wins, a.n))
            if (c != 0) c else b.n.compareTo(a.n)
        }
        val worst = list.sortedWith { a, b ->
            val c = sign(wilsonLow(a.losses, a.n) - wilsonLow(b.losses, b.n))
            if (c != 0) c else b.n.compareTo(a.n)
        }.filter { it.rate < 0.5 }.take(bottom)
        return Ranked(byLow.filter { it.rate > 0.5 }.take(top), worst)
    }
}
