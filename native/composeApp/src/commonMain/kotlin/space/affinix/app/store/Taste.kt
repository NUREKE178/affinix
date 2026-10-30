package space.affinix.app.store

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Taste DNA, a port of src/lib/arena/dna.js: how consistently a player's picks lean along each of the seven trait axes. For every answer the
 * pick-minus-other difference on a trait is added to a signed sum and its size to an absolute sum; the lean is signed / (absolute + prior).
 */
object Taste {
    val TRAITS = listOf("warm", "bold", "round", "airy", "vivid", "rich", "dark")
    private const val PRIOR = 3.0
    const val MIN_VOTES_FOR_TYPE = 20
    const val FULL_CONFIDENCE_VOTES = 80
    private const val LEAN_SCALE = 1.8

    class Dna(var n: Int = 0, val s: DoubleArray = DoubleArray(TRAITS.size), val a: DoubleArray = DoubleArray(TRAITS.size)) {
        fun add(chosen: DoubleArray, other: DoubleArray) {
            n++
            for (i in TRAITS.indices) { val d = chosen[i] - other[i]; s[i] += d; a[i] += abs(d) }
        }
    }

    class Result(val all: Dna, val byDim: Map<String, Dna>)

    /** one answered duel: the two specimens' traits, in the order of the pair (a = lower index), and which side was picked (0 = a) */
    class Answer(val dim: String, val pick: Int, val a: DoubleArray, val b: DoubleArray)

    fun build(answers: List<Answer>): Result {
        val all = Dna(); val byDim = LinkedHashMap<String, Dna>()
        for (x in answers) {
            val (chosen, other) = if (x.pick == 0) x.a to x.b else x.b to x.a
            all.add(chosen, other)
            byDim.getOrPut(x.dim) { Dna() }.add(chosen, other)
        }
        return Result(all, byDim)
    }

    /** lean in [-1, 1] per trait, in the order of [TRAITS] */
    fun leanOf(d: Dna): DoubleArray = DoubleArray(TRAITS.size) { d.s[it] / (d.a[it] + PRIOR) }

    fun confidenceOf(d: Dna): Double = min(1.0, d.n / FULL_CONFIDENCE_VOTES.toDouble())

    /** "none" / "slight" / "clear" / "strong" from |lean| */
    fun strength(v: Double): String { val m = abs(v); return if (m < 0.12) "none" else if (m < 0.3) "slight" else if (m < 0.55) "clear" else "strong" }

    class Archetype(val id: String, val v: DoubleArray)

    // prototype vectors in the order warm, bold, round, airy, vivid, rich, dark
    val ARCHETYPES = listOf(
        Archetype("minimalist", doubleArrayOf(0.0, -0.4, 0.1, 0.8, -0.6, -0.8, -0.2)),
        Archetype("expressionist", doubleArrayOf(0.4, 0.8, 0.2, -0.5, 0.8, 0.5, 0.0)),
        Archetype("craftsman", doubleArrayOf(0.8, 0.1, 0.5, 0.0, -0.3, 0.5, -0.1)),
        Archetype("technologist", doubleArrayOf(-0.7, 0.2, -0.6, 0.2, 0.1, -0.3, 0.7)),
        Archetype("luxe", doubleArrayOf(0.2, 0.3, -0.2, 0.4, -0.6, -0.1, 0.9)),
        Archetype("optimist", doubleArrayOf(0.7, 0.3, 0.7, 0.1, 0.8, 0.1, -0.7)),
        Archetype("modernist", doubleArrayOf(-0.2, 0.7, -0.8, 0.6, 0.2, -0.6, 0.0)),
        Archetype("dreamer", doubleArrayOf(0.2, -0.6, 0.8, 0.6, -0.3, 0.0, -0.4)),
        Archetype("maximalist", doubleArrayOf(0.3, 0.6, 0.2, -0.9, 0.6, 0.9, 0.1)),
    )

    class TypeFit(val id: String, val fit: Double)

    /** the nearest taste type for a lean vector, with how close it is (0..1) */
    fun archetypeOf(lean: DoubleArray): TypeFit {
        var best: Archetype? = null; var bestD = Double.POSITIVE_INFINITY
        for (a in ARCHETYPES) {
            var s = 0.0
            for (i in TRAITS.indices) { val x = max(-1.0, min(1.0, lean[i] * LEAN_SCALE)) - a.v[i]; s += x * x }
            val d = sqrt(s)
            if (d < bestD) { bestD = d; best = a }
        }
        return TypeFit(best!!.id, max(0.0, min(1.0, 1 - bestD / 3.2)))
    }

    class Lean(val trait: String, val lean: Double)

    /** the traits a player leans on hardest, biggest first */
    fun topTraits(lean: DoubleArray, count: Int = 3): List<Lean> = TRAITS.indices.map { Lean(TRAITS[it], lean[it]) }.sortedByDescending { abs(it.lean) }.take(count)

    class Standout(val dim: String, val trait: String, val delta: Double, val lean: Double)

    /** the biggest difference between how one question is judged and the overall lean, or null (needs [minVotes] in that question) */
    fun standout(r: Result, minVotes: Int = 15): Standout? {
        val base = leanOf(r.all)
        var best: Standout? = null
        for ((dim, d) in r.byDim) {
            if (d.n < minVotes) continue
            val l = leanOf(d)
            for (i in TRAITS.indices) {
                val delta = l[i] - base[i]
                if (best == null || abs(delta) > abs(best.delta)) best = Standout(dim, TRAITS[i], delta, l[i])
            }
        }
        return best?.takeIf { abs(it.delta) >= 0.25 }
    }
}
