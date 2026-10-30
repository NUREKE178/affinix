package space.affinix.app

import kotlinx.coroutines.suspendCancellableCoroutine
import org.jetbrains.skia.Bitmap
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Image
import org.jetbrains.skia.Rect
import org.jetbrains.skia.Surface
import java.awt.FileDialog
import java.awt.Frame
import java.io.File
import javax.swing.SwingUtilities
import kotlin.coroutines.resume

actual object Images {
    private val ext = mapOf("jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "webp" to "image/webp", "gif" to "image/gif")

    actual suspend fun pick(): PickedImage? = suspendCancellableCoroutine { cont ->
        SwingUtilities.invokeLater {
            val file: File? = try {
                val d = FileDialog(null as Frame?, "Affinix", FileDialog.LOAD)
                d.setFilenameFilter { _, name -> name.substringAfterLast('.', "").lowercase() in ext }
                d.isVisible = true
                d.file?.let { File(d.directory, it) }
            } catch (e: Exception) { null }
            val picked = file?.let { f ->
                val mime = ext[f.extension.lowercase()] ?: return@let null
                if (f.length() > ImageRules.MAX_INPUT) PickedImage(ByteArray(0), mime, tooBig = true) // reported by the caller without reading it
                else runCatching { PickedImage(f.readBytes(), mime) }.getOrNull()
            }
            if (cont.isActive) cont.resume(picked)
        }
    }

    actual fun shrink(src: ByteArray, maxSide: Int, maxBytes: Int): ShrunkImage? {
        val img = try { Image.makeFromEncoded(src) } catch (e: Exception) { return null }
        val scale = minOf(1.0, maxSide.toDouble() / maxOf(img.width, img.height))
        val w = maxOf(1, Math.round(img.width * scale).toInt()); val h = maxOf(1, Math.round(img.height * scale).toInt())
        val surface = Surface.makeRasterN32Premul(w, h)
        surface.canvas.drawImageRect(img, Rect.makeWH(img.width.toFloat(), img.height.toFloat()), Rect.makeWH(w.toFloat(), h.toFloat()))
        val snap = surface.makeImageSnapshot()
        for (q in listOf(86, 76, 64, 50)) {
            val data = snap.encodeToData(EncodedImageFormat.JPEG, q)?.bytes ?: continue
            if (data.size <= maxBytes) return ShrunkImage(data, "image/jpeg", "jpg")
        }
        return null
    }
}
