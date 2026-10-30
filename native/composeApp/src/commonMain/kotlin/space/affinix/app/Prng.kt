package space.affinix.app

/** The website's deterministic PRNG (src/lib/prng.js), bit for bit: the same player and day give the same daily quests in the app and on the site. */
object Prng {
    /** FNV-1a over UTF-16 code units, as an unsigned 32-bit number */
    fun hashStringToSeed(str: String): Long {
        var h = 2166136261L.toInt()
        for (c in str) { h = h xor c.code; h *= 16777619 }
        return h.toLong() and 0xFFFFFFFFL
    }

    /** mulberry32: a function returning the next number in [0, 1) */
    fun mulberry32(seed: Long): () -> Double {
        var a = seed.toInt()
        return {
            a += 0x6d2b79f5
            var t = (a xor (a ushr 15)) * (1 or a)
            t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
            ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
        }
    }
}
