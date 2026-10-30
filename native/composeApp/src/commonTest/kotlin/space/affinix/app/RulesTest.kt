package space.affinix.app

import kotlin.test.Test
import kotlin.test.assertEquals

/** Expected values come straight from src/lib/arena/rules.js, so the app and the website agree on XP and levels. */
class RulesTest {
    @Test fun levels() {
        val expected = listOf(0L to 1, 1L to 1, 99L to 1, 100L to 2, 299L to 2, 300L to 3, 301L to 3, 4499L to 9, 4500L to 10, 123456L to 50, 10_000_000_000L to 200)
        for ((xp, level) in expected) assertEquals(level, Rules.levelForXp(xp), "xp=$xp")
    }

    @Test fun flowBonus() {
        for ((c, b) in listOf(0 to 0, 1 to 0, 2 to 0, 3 to 1, 5 to 3, 12 to 10, 13 to 10, 20 to 10)) assertEquals(b, Rules.flowBonus(c), "combo=$c")
    }

    @Test fun voteXp() {
        assertEquals(10, Rules.voteXp(0, 0, false))
        assertEquals(10, Rules.voteXp(500, 10, false)) // an instant answer earns no bonus
        assertEquals(20, Rules.voteXp(600, 10, false))
        assertEquals(19, Rules.voteXp(2000, 4, true))
        assertEquals(25, Rules.voteXp(2000, 99, true)) // the bonus is capped
    }

    @Test fun ranks() {
        val expected = listOf(1 to "novice", 2 to "novice", 3 to "apprentice", 5 to "apprentice", 6 to "observer", 9 to "observer", 10 to "sharpEye", 14 to "sharpEye",
            15 to "tastemaker", 19 to "tastemaker", 20 to "artDirector", 29 to "artDirector", 30 to "creativeDirector", 39 to "creativeDirector", 40 to "maestro", 80 to "maestro")
        for ((l, id) in expected) assertEquals(id, Rules.rankForLevel(l), "level=$l")
    }

    @Test fun progress() {
        val p = Rules.levelProgress(450)
        assertEquals(3, p.level); assertEquals(150L, p.into); assertEquals(300L, p.span); assertEquals(0.5f, p.ratio)
    }

    @Test fun days() {
        // 2026-10-30 23:30 UTC is already the 31st in Almaty (UTC+5) and still the 30th in UTC
        val t = 1793403000000L // 2026-10-30T23:30:00Z
        assertEquals("2026-10-30", localDay(t, 0))
        assertEquals("2026-10-31", localDay(t, 5 * 60))
        assertEquals("2026-10-30", localDay(t, -8 * 60))
        assertEquals("202610", seasonOf(1793491199000L)) // 2026-10-31T23:59:59Z
        assertEquals("202601", seasonOf(1767225600000L)) // 2026-01-01T00:00:00Z
        assertEquals("1970-01-01", localDay(0, 0))
        assertEquals("2024-02-29", localDay(1709164800000L, 0))
    }
}
