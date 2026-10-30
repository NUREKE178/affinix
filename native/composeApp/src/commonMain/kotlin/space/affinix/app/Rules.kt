package space.affinix.app

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** The Arena rulebook, ported 1:1 from src/lib/arena/rules.js (the server re-derives the same numbers in SQL). */
object Rules {
    const val XP_BASE = 10
    const val PIONEER_BONUS = 5
    const val MAX_FLOW_BONUS = 10
    const val MIN_FLOW_MS = 600L
    const val MAX_FLOW_MS = 12000L
    const val ROUND_SIZE = 10
    const val DAILY_SET_SIZE = 10
    const val CROWD_MIN_VOTES = 5
    const val MAX_VOTES_PER_SUBMIT = 100
    const val MAX_LEVEL = 200

    private fun clamp(n: Int, lo: Int, hi: Int) = min(hi, max(lo, n))

    /** +1 XP per consecutive quick vote beyond the second, up to +10. */
    fun flowBonus(combo: Int) = clamp(combo - 2, 0, MAX_FLOW_BONUS)

    fun isFlowMs(ms: Long) = ms in MIN_FLOW_MS..MAX_FLOW_MS

    /** XP of one accepted vote; the combo bonus only counts for a considered (not instant) answer. */
    fun voteXp(ms: Long, bonus: Int, pioneer: Boolean): Int =
        XP_BASE + (if (ms >= MIN_FLOW_MS) clamp(bonus, 0, MAX_FLOW_BONUS) else 0) + (if (pioneer) PIONEER_BONUS else 0)

    fun xpForLevel(level: Int): Long = 50L * level * (level - 1)

    fun levelForXp(xp: Long): Int {
        if (xp <= 0) return 1
        var level = floor((1 + sqrt(1 + xp / 12.5)) / 2).toInt()
        while (level > 1 && xpForLevel(level) > xp) level--
        while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level++
        return clamp(level, 1, MAX_LEVEL)
    }

    data class Progress(val level: Int, val into: Long, val span: Long, val ratio: Float)

    fun levelProgress(xp: Long): Progress {
        val level = levelForXp(xp)
        val floorXp = xpForLevel(level)
        val span = xpForLevel(level + 1) - floorXp
        val into = max(0L, xp - floorXp)
        return Progress(level, into, span, if (span > 0) (into.toFloat() / span).coerceIn(0f, 1f) else 1f)
    }

    /** All awards, in the order the website lists them (BADGE_DEFS in rules.js). The server decides which a player has; the app only names them. */
    val BADGE_IDS = listOf(
        "first_vote", "votes_100", "votes_500", "votes_1000", "votes_2500", "votes_5000", "streak_3", "streak_7", "streak_14", "streak_30", "daily_7", "daily_30",
        "combo_8", "combo_12", "eye_80", "crowd_70", "explorer", "level_5", "level_10", "level_20", "level_30", "hour_1", "marathon_3h",
    )

    private val ranks = listOf(1 to "novice", 3 to "apprentice", 6 to "observer", 10 to "sharpEye", 15 to "tastemaker", 20 to "artDirector", 30 to "creativeDirector", 40 to "maestro")

    fun rankForLevel(level: Int): String = ranks.last { level >= it.first }.second

}
