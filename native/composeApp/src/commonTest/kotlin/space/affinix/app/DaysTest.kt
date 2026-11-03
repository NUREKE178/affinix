package space.affinix.app

import space.affinix.app.net.Message
import space.affinix.app.net.Notice
import space.affinix.app.net.Person
import space.affinix.app.ui.Bucket
import space.affinix.app.ui.ThreadRow
import space.affinix.app.ui.bucketOf
import space.affinix.app.ui.dayLabelOf
import space.affinix.app.ui.dayNumber
import space.affinix.app.ui.groupNotices
import space.affinix.app.ui.podiumOrder
import space.affinix.app.ui.threadRows
import space.affinix.app.ui.weekdayOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The day arithmetic behind the bell's groups, the chat's day pills and the podium's places. «Now» is Tuesday 3 Nov 2026, 12:00 UTC; the player is in Almaty (UTC+5), where it is 17:00. */
class DaysTest {
    private val now = epochOfIso("2026-11-03T12:00:00+00:00")!!
    private val tz = 300

    private fun notice(id: String, at: String, read: Boolean = true) = Notice(id, "comment", Person("u", "A", null, null), null, read, at)
    private fun msg(id: String, at: String, mine: Boolean = false, read: Boolean = true) =
        Message(id, "c1", if (mine) "me" else "them", "hi", at, read, edited = false, deleted = false, hasImage = false)

    @Test fun theDayIsThePlayersOwnNotUtcs() {
        // 20:00 UTC on the 2nd is 01:00 on the 3rd in Almaty: «today» for the player
        val late = epochOfIso("2026-11-02T20:00:00+00:00")!!
        assertEquals(dayNumber(now, tz), dayNumber(late, tz))
        assertEquals(dayNumber(now, 0) - 1, dayNumber(late, 0))
    }

    @Test fun bucketsFollowTheCalendarNotTheHours() {
        assertEquals(Bucket.Today, bucketOf(-1)) // the phone's clock a little behind the server's
        assertEquals(Bucket.Today, bucketOf(0))
        assertEquals(Bucket.Yesterday, bucketOf(1))
        for (d in 2L..6L) assertEquals(Bucket.ThisWeek, bucketOf(d))
        assertEquals(Bucket.Earlier, bucketOf(7))
        assertEquals(Bucket.Earlier, bucketOf(400))
    }

    @Test fun noticesAreGroupedInOrderWithTheirNewCounts() {
        val groups = groupNotices(
            listOf(
                notice("a", "2026-11-03T08:00:00+00:00", read = false),
                notice("b", "2026-11-02T20:00:00+00:00", read = false), // 01:00 local: still today
                notice("c", "2026-11-03T01:00:00+00:00"),
                notice("d", "2026-11-02T10:00:00+00:00"),
                notice("e", "2026-10-30T10:00:00+00:00"),
                notice("f", "2026-10-20T10:00:00+00:00"),
                notice("g", ""), // a time that cannot be read goes to the end
            ),
            now, tz,
        )
        assertEquals(listOf(Bucket.Today, Bucket.Yesterday, Bucket.ThisWeek, Bucket.Earlier), groups.map { it.bucket })
        assertEquals(listOf("a", "b", "c"), groups[0].items.map { it.id }) // the order inside a group is the order they came in
        assertEquals(2, groups[0].fresh)
        assertEquals(0, groups[1].fresh)
        assertEquals(listOf("f", "g"), groups[3].items.map { it.id })
    }

    @Test fun emptyGroupsAreLeftOut() {
        val groups = groupNotices(listOf(notice("x", "2026-10-01T10:00:00+00:00")), now, tz)
        assertEquals(listOf(Bucket.Earlier), groups.map { it.bucket })
        assertTrue(groupNotices(emptyList(), now, tz).isEmpty())
    }

    @Test fun weekdaysCountFromMonday() {
        assertEquals(3, weekdayOf(0)) // 1970-01-01 was a Thursday
        assertEquals(1, weekdayOf(dayNumber(now, tz))) // 3 Nov 2026 is a Tuesday
        assertEquals(0, weekdayOf(dayNumber(now, tz) - 1)) // Monday
        assertEquals(6, weekdayOf(dayNumber(now, tz) - 2)) // Sunday
    }

    @Test fun aDayLabelKnowsTodayYesterdayAndWhenToShowTheYear() {
        val today = dayNumber(now, tz)
        assertTrue(dayLabelOf(today, today).today)
        assertTrue(dayLabelOf(today - 1, today).yesterday)
        val oct = dayLabelOf(daysFromCivil(2026, 10, 12), today)
        assertEquals(12, oct.day); assertEquals(10, oct.month); assertEquals(false, oct.withYear)
        val last = dayLabelOf(daysFromCivil(2025, 12, 31), today)
        assertEquals(2025, last.year); assertEquals(true, last.withYear)
    }

    @Test fun aChatGetsOnePillPerDayAndTheNewLineAfterThePillOfItsDay() {
        val rows = threadRows(
            listOf(
                msg("m1", "2026-10-12T14:02:00+00:00"),
                msg("m2", "2026-10-12T14:05:00+00:00", mine = true),
                msg("m3", "2026-11-02T16:10:00+00:00"),
                msg("m4", "2026-11-03T04:12:00+00:00", read = false),
                msg("m5", "2026-11-03T04:12:30+00:00", read = false),
            ),
            newFromId = "m4", nowMs = now, tzOffsetMinutes = tz,
        )
        val shape = rows.map {
            when (it) { is ThreadRow.Day -> "D"; ThreadRow.NewMessages -> "N"; is ThreadRow.Msg -> it.m.id }
        }
        assertEquals(listOf("D", "m1", "m2", "D", "m3", "D", "N", "m4", "m5"), shape)
        val days = rows.filterIsInstance<ThreadRow.Day>()
        assertEquals(false, days[0].label.today); assertTrue(days[1].label.yesterday); assertTrue(days[2].label.today)
        assertEquals(rows.size, rows.map { it.key }.toSet().size, "every row has its own key")
    }

    @Test fun theNewLineAppearsOnceAndOnlyForAMessageThatIsThere() {
        val thread = listOf(msg("m1", "2026-11-03T04:00:00+00:00"), msg("m2", "2026-11-03T04:01:00+00:00"))
        assertEquals(1, threadRows(thread, "m2", now, tz).count { it === ThreadRow.NewMessages })
        assertEquals(0, threadRows(thread, "gone", now, tz).count { it === ThreadRow.NewMessages })
        assertEquals(0, threadRows(thread, null, now, tz).count { it === ThreadRow.NewMessages })
        assertTrue(threadRows(emptyList(), "m1", now, tz).isEmpty())
    }

    @Test fun aMessageWithoutAReadableTimeStaysInTheDayBeforeIt() {
        val rows = threadRows(listOf(msg("m1", "2026-11-03T04:00:00+00:00"), msg("m2", "")), null, now, tz)
        assertEquals(1, rows.count { it is ThreadRow.Day })
        assertEquals(3, rows.size)
        assertNull(threadRows(listOf(msg("m1", "")), null, now, tz).filterIsInstance<ThreadRow.Day>().firstOrNull())
    }

    @Test fun thePodiumPutsTheLeaderInTheMiddle() {
        assertEquals(emptyList(), podiumOrder(0))
        assertEquals(listOf(0), podiumOrder(1))
        assertEquals(listOf(1, 0), podiumOrder(2))
        assertEquals(listOf(1, 0, 2), podiumOrder(3))
        assertEquals(listOf(1, 0, 2), podiumOrder(40))
    }
}
