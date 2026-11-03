package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** One picture the viewer can show: a plain link ([url], a post's picture) or a private path in the bucket that has to be signed first ([path], a picture of a chat). */
data class Pic(val key: String, val url: String?, val path: String?, val who: String, val at: String, val caption: String, val messageId: String? = null)

/**
 * The full-screen picture viewer of the whole app (like the profile card, one for everything): a tap on a picture calls [open] with the pictures that belong together (all the pictures
 * of the chat, the picture of a post) and the one that was tapped; the viewer pages through them and closes with [close].
 */
class ImageViewerModel {
    var pics by mutableStateOf<List<Pic>>(emptyList())
        private set
    var index by mutableStateOf(0)
        private set

    val isOpen: Boolean get() = pics.isNotEmpty()
    val current: Pic? get() = pics.getOrNull(index)

    /** Shows [pics] starting at the one with [key] (the first one if there is no such picture). Nothing to show: stays closed. */
    fun open(pics: List<Pic>, key: String) {
        if (pics.isEmpty()) return
        this.pics = pics
        index = pics.indexOfFirst { it.key == key }.coerceAtLeast(0)
    }

    /** The next (+1) or the previous (-1) picture; past the ends it stays where it is and says so (false), so that the viewer can bounce instead. */
    fun go(delta: Int): Boolean {
        val to = index + delta
        if (to !in pics.indices) return false
        index = to
        return true
    }

    fun close() { pics = emptyList(); index = 0 }
}
