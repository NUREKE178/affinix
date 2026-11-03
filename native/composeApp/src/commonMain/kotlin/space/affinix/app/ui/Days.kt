package space.affinix.app.ui

import space.affinix.app.civil
import space.affinix.app.epochOfIso
import space.affinix.app.net.Message
import space.affinix.app.net.Notice

// Everything here is plain arithmetic on the player's own calendar (their midnight, not UTC's), so that the day groups of the bell and the day pills of a chat can be tested
// without a screen. The screens only turn the results into words.

/** The number of the player's calendar day that [epochMs] falls in (days since 1970-01-01 in their zone). */
internal fun dayNumber(epochMs: Long, tzOffsetMinutes: Int): Long = (epochMs + tzOffsetMinutes * 60_000L).floorDiv(86_400_000L)

/** Monday = 0 ... Sunday = 6 (1970-01-01 was a Thursday). */
internal fun weekdayOf(day: Long): Int = (day + 3).mod(7L).toInt()

// ---- the bell: Today / Yesterday / This week / Earlier ---------------------------------------------------------------------------------------

enum class Bucket(val key: String) {
    Today("days.today"), Yesterday("days.yesterday"), ThisWeek("days.thisWeek"), Earlier("days.earlier"),
}

/** [ageDays] = how many calendar days ago. A moment in the future (the phone's clock is a little behind the server's) counts as today. */
internal fun bucketOf(ageDays: Long): Bucket = when {
    ageDays <= 0 -> Bucket.Today
    ageDays == 1L -> Bucket.Yesterday
    ageDays < 7 -> Bucket.ThisWeek
    else -> Bucket.Earlier
}

class NoticeGroup(val bucket: Bucket, val items: List<Notice>) {
    /** how many of them are still unread: the group's «3 new» */
    val fresh: Int get() = items.count { !it.read }
}

/** The bell's rows (newest first) in their day groups, in the order Today, Yesterday, This week, Earlier; empty groups are left out and the order inside a group is kept. */
fun groupNotices(items: List<Notice>, nowMs: Long, tzOffsetMinutes: Int): List<NoticeGroup> {
    val today = dayNumber(nowMs, tzOffsetMinutes)
    val by = items.groupBy { n -> epochOfIso(n.createdAt)?.let { bucketOf(today - dayNumber(it, tzOffsetMinutes)) } ?: Bucket.Earlier }
    return Bucket.entries.mapNotNull { b -> by[b]?.let { NoticeGroup(b, it) } }
}

// ---- a chat: day pills and the «New messages» line --------------------------------------------------------------------------------------------

/** A calendar date for a pill: «12 October», with the year when it is not this year's. */
class DayLabel(val today: Boolean, val yesterday: Boolean, val day: Int, val month: Int, val year: Int, val withYear: Boolean)

internal fun dayLabelOf(dayNum: Long, todayNum: Long): DayLabel {
    val (y, m, d) = civil(dayNum)
    val thisYear = civil(todayNum).first
    return DayLabel(dayNum >= todayNum, dayNum == todayNum - 1, d, m, y, y != thisYear)
}

sealed interface ThreadRow {
    /** stays the same for the same row, so the list keeps its place when messages arrive */
    val key: String

    class Day(val dayNum: Long, val label: DayLabel) : ThreadRow { override val key get() = "day$dayNum" }
    data object NewMessages : ThreadRow { override val key get() = "new" }
    class Msg(val m: Message) : ThreadRow { override val key get() = m.id }
}

/**
 * The messages (oldest first) with a pill before the first message of every day and, when [newFromId] is the first message that was not read when the chat was opened, the line
 * «New messages» in front of it (after the pill of its day). A message whose time cannot be read has no day of its own: it stays in the day before it.
 */
fun threadRows(thread: List<Message>, newFromId: String?, nowMs: Long, tzOffsetMinutes: Int): List<ThreadRow> {
    val today = dayNumber(nowMs, tzOffsetMinutes)
    val out = ArrayList<ThreadRow>(thread.size + 4)
    var last = Long.MIN_VALUE
    var marked = false
    for (m in thread) {
        val day = epochOfIso(m.createdAt)?.let { dayNumber(it, tzOffsetMinutes) }
        if (day != null && day != last) { out.add(ThreadRow.Day(day, dayLabelOf(day, today))); last = day }
        if (!marked && newFromId != null && m.id == newFromId) { out.add(ThreadRow.NewMessages); marked = true }
        out.add(ThreadRow.Msg(m))
    }
    return out
}

// ---- the podium of the rankings ---------------------------------------------------------------------------------------------------------------

/** The places of the first three, left to right: the leader stands in the middle, second place on its left, third on its right. Indexes into the ranked list; fewer people, fewer places. */
fun podiumOrder(count: Int): List<Int> = when {
    count >= 3 -> listOf(1, 0, 2)
    count == 2 -> listOf(1, 0)
    count == 1 -> listOf(0)
    else -> emptyList()
}
