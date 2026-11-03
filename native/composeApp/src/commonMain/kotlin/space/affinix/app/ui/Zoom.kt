package space.affinix.app.ui

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// The arithmetic of the picture viewer's zoom, apart from the gestures, so that it can be tested: a picture is drawn scaled about the middle of the screen and then moved by an offset.

const val MIN_ZOOM = 1f
const val MAX_ZOOM = 5f
/** where a double tap goes */
const val TAP_ZOOM = 2.5f

/** How far (each way) the picture may be moved on one axis: [view] = the size of the screen, [content] = the size the picture has at scale 1. A picture smaller than the screen cannot be moved. */
fun panLimit(view: Float, content: Float, scale: Float): Float = max(0f, (content * scale - view) / 2f)

/** The size of [iw] x [ih] pixels laid inside [vw] x [vh] whole (like ContentScale.Fit): width and height. */
fun fitSize(iw: Float, ih: Float, vw: Float, vh: Float): Pair<Float, Float> {
    if (iw <= 0f || ih <= 0f || vw <= 0f || vh <= 0f) return vw to vh
    val k = min(vw / iw, vh / ih)
    return iw * k to ih * k
}

class Zoom(val scale: Float, val x: Float, val y: Float) {
    val zoomed: Boolean get() = scale > MIN_ZOOM + .01f
    operator fun component1() = scale
    operator fun component2() = x
    operator fun component3() = y
}

private fun Zoom.clamped(vw: Float, vh: Float, cw: Float, ch: Float): Zoom {
    val s = scale.coerceIn(MIN_ZOOM, MAX_ZOOM)
    val lx = panLimit(vw, cw, s); val ly = panLimit(vh, ch, s)
    return Zoom(s, x.coerceIn(-lx, lx), y.coerceIn(-ly, ly))
}

/**
 * One step of a pinch / drag: the picture is zoomed by [zoomBy] about the finger's middle ([cx], [cy], measured from the middle of the screen) and moved by ([panX], [panY]); the point under
 * the fingers stays under them. The result is kept inside the limits.
 */
fun transformed(z: Zoom, zoomBy: Float, cx: Float, cy: Float, panX: Float, panY: Float, vw: Float, vh: Float, cw: Float, ch: Float): Zoom {
    val s = (z.scale * zoomBy).coerceIn(MIN_ZOOM, MAX_ZOOM)
    val k = s / z.scale
    return Zoom(s, cx * (1f - k) + z.x * k + panX, cy * (1f - k) + z.y * k + panY).clamped(vw, vh, cw, ch)
}

/** A double tap at ([tx], [ty], from the middle of the screen): out to [TAP_ZOOM] with that spot staying under the finger, or back to the whole picture when it is already zoomed. */
fun doubleTapped(z: Zoom, tx: Float, ty: Float, vw: Float, vh: Float, cw: Float, ch: Float): Zoom =
    if (z.zoomed) Zoom(MIN_ZOOM, 0f, 0f)
    else Zoom(TAP_ZOOM, tx * (1f - TAP_ZOOM), ty * (1f - TAP_ZOOM)).clamped(vw, vh, cw, ch)

/** What a drag of a picture that is not zoomed turns into: a swipe along the screen pages through the pictures, a swipe down closes the viewer. Decided once, when the finger has left the touch slop. */
enum class Drag { None, Page, Close }

fun dragKind(dx: Float, dy: Float, slop: Float): Drag = when {
    abs(dx) < slop && abs(dy) < slop -> Drag.None
    abs(dx) > abs(dy) -> Drag.Page
    dy > 0f -> Drag.Close
    else -> Drag.None // a drag up decides nothing (it may still turn downwards)
}
