package space.affinix.app.ui

import androidx.compose.runtime.Composable
import space.affinix.app.Platform
import space.affinix.app.epochOfIso
import space.affinix.app.i18n.t

// The words for the day arithmetic of Days.kt.

/** «Today», «Yesterday», or «12 October» (with the year when it is not this year's). */
@Composable
fun dayLabelText(l: DayLabel): String = when {
    l.today -> t("days.today")
    l.yesterday -> t("days.yesterday")
    else -> t(if (l.withYear) "days.dateYear" else "days.date", "d" to l.day, "month" to t("days.m${l.month}"), "y" to l.year)
}

/** The time of a bell entry inside its group: «14:20», «Mon, 11:08», or «12 October, 09:30» (the day itself is already said by the group's title for today and yesterday). */
@Composable
fun noticeTime(iso: String, bucket: Bucket): String {
    val at = epochOfIso(iso) ?: return ""
    val clock = clockText(iso)
    val tz = Platform.tzOffsetMinutes()
    val day = dayNumber(at, tz)
    return when (bucket) {
        Bucket.Today, Bucket.Yesterday -> clock
        Bucket.ThisWeek -> "${t("days.wd${weekdayOf(day)}")}, $clock"
        Bucket.Earlier -> "${dayLabelText(dayLabelOf(day, dayNumber(Platform.nowMillis(), tz)))}, $clock"
    }
}

/** «Yesterday, 21:11» / «12 October, 19:02»: the moment of a message or a picture in full. */
@Composable
fun momentText(iso: String): String {
    val at = epochOfIso(iso) ?: return ""
    val tz = Platform.tzOffsetMinutes()
    return "${dayLabelText(dayLabelOf(dayNumber(at, tz), dayNumber(Platform.nowMillis(), tz)))}, ${clockText(iso)}"
}
