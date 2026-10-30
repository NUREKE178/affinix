package space.affinix.app

/** The few things common code needs from the JVM it runs on (both targets are JVM, so the actuals are identical). */
expect object Platform {
    fun nowMillis(): Long
    /** minutes east of UTC at this moment */
    fun tzOffsetMinutes(): Int
    fun uuid(): String
    /** the device's language, e.g. "kk" */
    fun languageTag(): String
    fun sha256(data: ByteArray): ByteArray
    fun randomBytes(n: Int): ByteArray
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

/** Days since 1970-01-01 of a civil date (the inverse of [civil]). */
internal fun daysFromCivil(y0: Int, m: Int, d: Int): Long {
    val y = (if (m <= 2) y0 - 1 else y0).toLong()
    val era = (if (y >= 0) y else y - 399) / 400
    val yoe = y - era * 400
    val doy = (153 * (if (m > 2) m - 3 else m + 9) + 2) / 5 + d - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

private val isoRe = Regex("""(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?""")

/** Epoch milliseconds of an ISO-8601 timestamp as Postgres prints it ("2026-10-30T09:12:36.123456+00:00"), or null. */
fun epochOfIso(s: String): Long? {
    val m = isoRe.find(s) ?: return null
    val g = m.groupValues
    val days = daysFromCivil(g[1].toInt(), g[2].toInt(), g[3].toInt())
    var ms = ((days * 24 + g[4].toInt()) * 60 + g[5].toInt()) * 60_000L + g[6].toInt() * 1000L
    if (g[7].isNotEmpty()) ms += (g[7].padEnd(3, '0').take(3)).toLong()
    val z = g[8]
    if (z.isNotEmpty() && z != "Z") {
        val sign = if (z[0] == '-') -1 else 1
        val digits = z.drop(1).replace(":", "")
        val h = digits.take(2).toInt(); val mi = if (digits.length >= 4) digits.substring(2, 4).toInt() else 0
        ms -= sign * (h * 60 + mi) * 60_000L
    }
    return ms
}

/** percent-encoding of a query value (RFC 3986 unreserved characters stay) */
fun urlEncode(s: String): String = buildString {
    for (b in s.encodeToByteArray()) {
        val c = b.toInt() and 0xFF
        if (c in 'A'.code..'Z'.code || c in 'a'.code..'z'.code || c in '0'.code..'9'.code || c == '-'.code || c == '_'.code || c == '.'.code || c == '~'.code) append(c.toChar())
        else append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
    }
}
