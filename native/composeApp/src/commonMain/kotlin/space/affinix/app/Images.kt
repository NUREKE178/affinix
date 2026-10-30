package space.affinix.app

/** A picture the player chose, as the file holds it. */
class PickedImage(val bytes: ByteArray, val mime: String, val tooBig: Boolean = false)

/** A picture scaled down and re-encoded for upload. */
class ShrunkImage(val bytes: ByteArray, val mime: String, val ext: String)

/** The system's picture chooser and the shrinking of a chosen picture (the website does the same in the browser: imageTools.js). */
expect object Images {
    /** Opens the chooser; null when the player cancelled or the file could not be read. */
    suspend fun pick(): PickedImage?

    /** Scales so the long side is at most [maxSide] px (keeping the photo's own orientation) and encodes JPEG under [maxBytes]; null when the file is not a readable picture. */
    fun shrink(src: ByteArray, maxSide: Int, maxBytes: Int): ShrunkImage?
}

object ImageRules {
    val TYPES = listOf("image/jpeg", "image/png", "image/webp", "image/gif")
    const val MAX_INPUT = 25 * 1024 * 1024
    /** a post's picture (the website sends the original up to 5 MB; the app shrinks, which also saves a phone's data) */
    const val POST_SIDE = 1600
    const val POST_BYTES = 1500 * 1024
    const val CHAT_SIDE = 1600
    const val CHAT_BYTES = 1500 * 1024
    const val AVATAR_SIDE = 512
    const val AVATAR_BYTES = 400 * 1024

    /** null when fine, otherwise the locale key of why not */
    fun check(p: PickedImage): String? = when {
        p.mime !in TYPES -> "messages.err.img_bad_type"
        p.tooBig || p.bytes.size > MAX_INPUT -> "messages.err.img_too_big"
        else -> null
    }

    /** picks, checks and shrinks: the result, or the locale key of what went wrong (null result and null key = cancelled) */
    suspend fun chooseAndShrink(side: Int, bytes: Int): Pair<ShrunkImage?, String?> {
        val p = Images.pick() ?: return null to null
        check(p)?.let { return null to it }
        val s = Images.shrink(p.bytes, side, bytes) ?: return null to "messages.err.img_unreadable"
        if (s.bytes.size > bytes) return null to "messages.err.img_too_big"
        return s to null
    }
}
