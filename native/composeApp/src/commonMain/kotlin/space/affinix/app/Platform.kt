package space.affinix.app

/** The few things common code needs from the JVM it runs on (both targets are JVM, so the actuals are identical). */
expect object Platform {
    fun nowMillis(): Long
    /** minutes east of UTC at this moment */
    fun tzOffsetMinutes(): Int
    fun uuid(): String
}

/** Civil date (proleptic Gregorian) of a day number counted from 1970-01-01. */
internal fun civil(daysSinceEpoch: Long): Triple<Int, Int, Int> {
    val z = daysSinceEpoch + 719468
    val era = (if (z >= 0) z else z - 146096) / 146097
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
    val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
    return Triple(y, m, d)
}

private fun two(n: Int) = n.toString().padStart(2, '0')

/** The player's own calendar day as YYYY-MM-DD (their midnight, not UTC's). */
fun localDay(nowMillis: Long = Platform.nowMillis(), tzOffsetMinutes: Int = Platform.tzOffsetMinutes()): String {
    val (y, m, d) = civil((nowMillis + tzOffsetMinutes * 60_000L).floorDiv(86_400_000L))
    return "$y-${two(m)}-${two(d)}"
}

/** The season (a UTC month) a moment falls in: "202610". */
fun seasonOf(nowMillis: Long = Platform.nowMillis()): String {
    val (y, m, _) = civil((nowMillis).floorDiv(86_400_000L))
    return "$y${two(m)}"
}
