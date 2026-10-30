package space.affinix.app

/** Which release is newer. Versions look like "0.2.2"; anything that is not numbers counts as 0. */
object Versions {
    fun parse(v: String): List<Int> = v.trim().removePrefix("v").substringBefore('-').substringBefore('+').split('.').map { it.toIntOrNull() ?: 0 }

    fun isNewer(candidate: String, current: String): Boolean {
        val a = parse(candidate); val b = parse(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** from the GitHub releases list: the newest published native release's version ("native-v0.2.2" -> "0.2.2"), or null */
    fun newestNative(tags: List<String>): String? =
        tags.filter { it.startsWith("native-v") }.map { it.removePrefix("native-v") }.filter { parse(it).any { n -> n > 0 } }
            .maxWithOrNull { x, y -> if (isNewer(x, y)) 1 else if (isNewer(y, x)) -1 else 0 }

    const val DOWNLOAD_PAGE = "https://affinix.space/download"
}
