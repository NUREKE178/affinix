package space.affinix.app.store

import space.affinix.app.Rules
import space.affinix.app.civil
import space.affinix.app.net.Duel
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Taste Match, a port of src/lib/arena/challenge.js: a person sends the answers they gave to a handful of duels as a link; a friend plays the
 * same pairs and sees how many they picked the same way. Nothing is modelled and nothing is kept on a server: the link carries the season, the
 * pairs with their answers and the sender's first name. The link is the website's own, so a link made in either app opens in the other
 * (the shared test vectors in ChallengeVectors.kt are generated from the website's code and fail on any drift).
 *
 * Link: `1.<season>.<entry>-<entry>-...-<entry>.<name>`; an entry is a ledger entry in base 36 (`((((family * 1024 + a) * 1024 + b) * 16 + dim) * 2 + pick`),
 * the name is the first name in UTF-8, base64url.
 */
object Challenge {
    const val MIN = 5
    const val MAX = 10
    const val NAME_MAX = 24
    private const val VERSION = "1"
    private const val INDEX_LIMIT = 1024
    private const val DIM_RADIX = 16
    private const val MAX_ENTRY = 1L shl 29

    /** the question ids in the order of the ledger encoding (src/lib/arena/catalog.js); an eye test is the one with a right answer */
    val DIMENSION_IDS = listOf("preference", "attention", "trust", "quality", "premium", "clarity", "purchaseIntent", "friendly", "modern", "natural", "energetic")
    private val OBJECTIVE = setOf("clarity")

    /** one answered pair: [pick] is the canonical side (0 = the lower index) */
    data class Answer(val family: String, val a: Int, val b: Int, val dim: String, val pick: Int)

    data class Parsed(val season: String, val answers: List<Answer>, val name: String?)

    /** control, format, unassigned and line/paragraph separator characters: invisible or able to change how text is drawn (the website's `[\\p{C}\\p{Zl}\\p{Zp}]`) */
    private val INVISIBLE = Regex("[\\p{C}\\p{Zl}\\p{Zp}]")

    /** what JavaScript's `\\s` means (java.util.regex's `\\s` is ASCII only), so that a name is cut at the same place in both apps */
    private val SPACES = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]+")

    /** The first name only, cleaned of anything that could pretend to be something else on screen: control and invisible characters, direction overrides. */
    fun cleanName(raw: String?): String {
        val first = (raw ?: "").replace(INVISIBLE, "").replace(SPACES, " ").trim().substringBefore(' ')
        var i = 0
        var n = 0
        while (i < first.length && n < NAME_MAX) { i += if (first[i].isHighSurrogate() && i + 1 < first.length && first[i + 1].isLowSurrogate()) 2 else 1; n++ }
        return first.substring(0, i)
    }

    /** A taste answer that can travel: a known family and question, two different specimens, an answer, and not an eye test (it has a right answer). */
    fun isShareable(a: Answer) =
        a.family in Rules.FAMILY_IDS && a.dim in DIMENSION_IDS && a.dim !in OBJECTIVE && a.a >= 0 && a.a < a.b && a.b < INDEX_LIMIT && (a.pick == 0 || a.pick == 1)

    private fun duelCode(a: Answer) = ((Rules.FAMILY_IDS.indexOf(a.family) * INDEX_LIMIT + a.a) * INDEX_LIMIT + a.b) * DIM_RADIX + DIMENSION_IDS.indexOf(a.dim)

    @OptIn(ExperimentalEncodingApi::class)
    private val b64 = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT_OPTIONAL)

    /** The text of a link's `c` parameter, or null when the answers cannot be sent. */
    @OptIn(ExperimentalEncodingApi::class)
    fun encode(season: String, answers: List<Answer>, name: String?): String? {
        if (!Regex("\\d{6}").matches(season) || answers.size < MIN || answers.size > MAX || !answers.all(::isShareable)) return null
        if (answers.map(::duelCode).toSet().size != answers.size) return null
        val entries = answers.joinToString("-") { (duelCode(it) * 2L + it.pick).toString(36) }
        val who = cleanName(name)
        return "$VERSION.$season.$entries.${if (who.isEmpty()) "" else b64.encode(who.encodeToByteArray()).trimEnd('=')}"
    }

    /** What a link says, or null for anything that is not exactly what [encode] writes (the text comes from an address bar or a pasted message: it is never trusted). */
    @OptIn(ExperimentalEncodingApi::class)
    fun decode(text: String?): Parsed? {
        if (text == null || text.length > 400) return null
        val parts = text.split('.')
        if (parts.size != 4 || parts[0] != VERSION) return null
        val (_, season, entryText, nameText) = parts
        if (!Regex("\\d{4}(0[1-9]|1[0-2])").matches(season)) return null
        if (!Regex("[0-9a-z]{1,6}(-[0-9a-z]{1,6}){4,9}").matches(entryText)) return null
        val answers = ArrayList<Answer>()
        val seen = HashSet<Long>()
        for (piece in entryText.split('-')) {
            val entry = piece.toLongOrNull(36) ?: return null
            if (entry >= MAX_ENTRY) return null
            var c = entry shr 1
            val pick = (entry and 1L).toInt()
            val d = (c % DIM_RADIX).toInt(); c /= DIM_RADIX
            val b = (c % INDEX_LIMIT).toInt(); c /= INDEX_LIMIT
            val a = (c % INDEX_LIMIT).toInt(); c /= INDEX_LIMIT
            val family = Rules.FAMILY_IDS.getOrNull(c.toInt()) ?: return null
            val dim = DIMENSION_IDS.getOrNull(d) ?: return null
            val answer = Answer(family, a, b, dim, pick)
            if (!isShareable(answer) || !seen.add(duelCode(answer).toLong())) return null
            answers += answer
        }
        var name: String? = null
        if (nameText.isNotEmpty()) {
            if (!Regex("[A-Za-z0-9_-]*").matches(nameText)) return null
            val decoded = try { b64.decode(nameText).decodeToString(throwOnInvalidSequence = true) } catch (e: Exception) { return null }
            name = cleanName(decoded).ifEmpty { null }
        }
        return Parsed(season, answers, name)
    }

    /** The `c` value out of whatever a person pasted: a whole address, a message that has one in it, or the bare value. Null when there is none. */
    fun param(pasted: String?): String? {
        val text = pasted?.trim().orEmpty()
        if (text.isEmpty()) return null
        Regex("[?&]c=([A-Za-z0-9._-]+)").find(text)?.let { return it.groupValues[1] }
        return text.takeIf { Regex("1\\.\\d{6}\\.[0-9a-z-]+\\.[A-Za-z0-9_-]*").matches(it) }
    }

    /** The answers of a finished round that can be sent: the season and the answers (empty when fewer than [MIN] can be). A skipped duel and an eye test are left out. */
    fun answersOf(season: String, results: List<Result>): Pair<String, List<Answer>> {
        val answers = results.mapNotNull { r -> Answer(r.duel.family, r.duel.a, r.duel.b, r.duel.dim, r.pick).takeIf(::isShareable) }
        return season to if (answers.size >= MIN) answers.take(MAX) else emptyList()
    }

    /** How the second person's picks compare with the first one's, duel by duel. [sameAt] has one entry per sent answer: true, false, or null when it was skipped. */
    data class Match(val compared: Int, val same: Int, val percent: Int?, val splits: List<Int>, val sameAt: List<Boolean?>)

    /** [results] are the answers of the second person; a pair they skipped has no result and is not counted for or against. */
    fun matchOf(season: String, answers: List<Answer>, results: List<Result>): Match {
        val byPair = results.filter { !it.duel.objective }.associateBy { "${it.duel.pair}|${it.duel.dim}" }
        var compared = 0
        var same = 0
        val splits = ArrayList<Int>()
        val sameAt = ArrayList<Boolean?>()
        answers.forEachIndexed { i, a ->
            val r = byPair["${pairOf(season, a)}|${a.dim}"]
            if (r == null) { sameAt += null; return@forEachIndexed }
            compared++
            val eq = r.pick == a.pick
            if (eq) same++ else splits += i
            sameAt += eq
        }
        return Match(compared, same, if (compared > 0) ((100.0 * same) / compared + .5).toInt() else null, splits, sameAt)
    }

    /** the canonical pair id the server uses for a duel of [season]: "202611/mark/18-25" */
    fun pairOf(season: String, a: Answer) = "$season/${a.family}/${a.a}-${a.b}"

    /** A name for how close two people are: twins / close / mixed / opposite. */
    fun label(percent: Int?): String = when {
        percent == null -> "mixed"
        percent >= 90 -> "twins"
        percent >= 70 -> "close"
        percent >= 40 -> "mixed"
        else -> "opposite"
    }

    /** A season that the server still takes votes for: this month's and last month's. */
    fun seasonIsLive(season: String, nowMillis: Long): Boolean {
        val (y, m, _) = civil(nowMillis.floorDiv(86_400_000L))
        fun id(yy: Int, mm: Int) = "$yy${mm.toString().padStart(2, '0')}"
        val prev = if (m == 1) id(y - 1, 12) else id(y, m - 1)
        return season == id(y, m) || season == prev
    }

    /** the duels of a link as the dealer returns them, marked so that a pair already answered (or of a season the server no longer takes) earns nothing */
    fun marked(duels: List<Duel>, seen: Set<String>, live: Boolean): List<Duel> =
        duels.map { it.copy(repeat = !live || "${it.pair}|${it.dim}" in seen, daily = false, set = 0) }
}
