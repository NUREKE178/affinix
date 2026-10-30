package space.affinix.app.store

/**
 * The website's good-faith profanity guard (src/lib/profanityFilter.js), same stems and same policy: no match = as is, one match = that word is starred out,
 * two or more = the post is refused. A UX guard, not a security boundary (a request sent straight to the API is not checked here either).
 */
object Moderation {
    private val stems = listOf(
        "хуй", "хуе", "хую", "хуя", "пизд", "еба", "ебат", "ебан", "ебн", "долбоеб", "мудак", "мудил", "бля", "сука", "сучк", "гандон", "пидор", "пидар", "залуп",
        "қотақ", "сіктір", "сігіл", "боқтаған", "боқмия",
        "fuck", "shit", "bitch", "asshole", "cunt",
    )
    private val pattern = Regex("(?<![\\p{L}\\p{N}])(${stems.joinToString("|")})[\\p{L}]*", RegexOption.IGNORE_CASE)

    enum class Action { Clean, Censor, Block }
    data class Verdict(val action: Action, val text: String)

    /** ё -> е is 1:1, so offsets found in the normalised text are valid in the original too. */
    private fun matches(text: String): List<IntRange> = pattern.findAll(text.replace('ё', 'е').replace('Ё', 'Е')).map { it.range }.toList()

    private fun mask(word: String) = if (word.length <= 1) "*" else word[0] + "*".repeat(word.length - 1)

    fun moderate(text: String): Verdict {
        val m = matches(text)
        if (m.isEmpty()) return Verdict(Action.Clean, text)
        if (m.size > 1) return Verdict(Action.Block, text)
        val r = m[0]
        return Verdict(Action.Censor, text.substring(0, r.first) + mask(text.substring(r.first, r.last + 1)) + text.substring(r.last + 1))
    }
}
