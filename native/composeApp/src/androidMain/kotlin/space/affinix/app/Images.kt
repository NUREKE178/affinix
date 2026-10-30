package space.affinix.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.media.ExifInterface
import kotlinx.coroutines.CompletableDeferred
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** The activity registers the system picker and hands it to this object; nothing else here needs an activity. */
object AndroidImages {
    internal var context: Context? = null
    internal var launch: (() -> Unit)? = null
    private var waiting: CompletableDeferred<PickedImage?>? = null

    internal fun begin(): CompletableDeferred<PickedImage?>? {
        val l = launch ?: return null
        val d = CompletableDeferred<PickedImage?>()
        waiting?.complete(null)
        waiting = d
        l()
        return d
    }

    /** the picker's answer: null when cancelled */
    fun deliver(uri: Uri?) {
        val d = waiting ?: return
        waiting = null
        val ctx = context
        if (uri == null || ctx == null) { d.complete(null); return }
        val picked = runCatching {
            val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
            val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readNBytesCapped(ImageRules.MAX_INPUT + 1) }
            if (bytes == null) null else PickedImage(if (bytes.size > ImageRules.MAX_INPUT) ByteArray(0) else bytes, mime, tooBig = bytes.size > ImageRules.MAX_INPUT)
        }.getOrNull()
        d.complete(picked)
    }

    private fun java.io.InputStream.readNBytesCapped(limit: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < limit) { val n = read(buf, 0, minOf(buf.size, limit - out.size())); if (n < 0) break; out.write(buf, 0, n) }
        return out.toByteArray()
    }
}

actual object Images {
    actual suspend fun pick(): PickedImage? = AndroidImages.begin()?.await()

    actual fun shrink(src: ByteArray, maxSide: Int, maxBytes: Int): ShrunkImage? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(src, 0, src.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        var bmp: Bitmap = BitmapFactory.decodeByteArray(src, 0, src.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val rotation = runCatching {
            when (ExifInterface(ByteArrayInputStream(src)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f
            }
        }.getOrDefault(0f)
        val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
        val m = Matrix().apply { postScale(scale, scale); if (rotation != 0f) postRotate(rotation) }
        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        for (q in listOf(86, 76, 64, 50)) {
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
            if (out.size() <= maxBytes) return ShrunkImage(out.toByteArray(), "image/jpeg", "jpg")
        }
        return null
    }
}
