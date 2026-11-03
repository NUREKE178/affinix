package space.affinix.app.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Pic
import kotlin.math.abs
import kotlin.math.max

/**
 * The full-screen picture viewer, mounted once over the whole shell (like the profile card): a black scrim, the picture, a bar with who and when above it and the place among the
 * pictures below it. Pinch or double-tap to zoom and move it about; a swipe along the screen goes to the next picture; a swipe down, the close key, Esc and Back close it.
 */
@Composable
fun ImageViewerHost(model: AppModel) {
    val iv = model.imageViewer
    val open = iv.isOpen
    val target = if (open) 1f else 0f
    val animated by animateFloatAsState(target, tween(220, easing = FastOutSlowInEasing), label = "viewer")
    val p = if (Motion.enabled) animated else target
    // what was shown last, so that the viewer can fade out with its picture instead of going blank first
    val held = remember { arrayOfNulls<Pic>(1) }
    val pic = iv.current ?: held[0]
    if (iv.current != null) held[0] = iv.current
    if (pic == null || (p <= 0f && !open)) return
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var zoom by remember { mutableStateOf(Zoom(MIN_ZOOM, 0f, 0f)) }
    var pageX by remember { mutableFloatStateOf(0f) }   // how far the picture is dragged along the screen (px)
    var pullY by remember { mutableFloatStateOf(0f) }   // how far it is dragged down (px)
    var chrome by remember { mutableStateOf(true) }
    var hint by remember(open) { mutableStateOf(true) }
    LaunchedEffect(open) { if (open) { delay(3200); hint = false } }
    LaunchedEffect(pic.key) { zoom = Zoom(MIN_ZOOM, 0f, 0f); chrome = true }

    // the picture itself: a link, or a private path that is signed first
    var url by remember(pic.key) { mutableStateOf(pic.url) }
    LaunchedEffect(pic.key) {
        if (url == null && pic.path != null) url = model.messages.attachmentUrl(pic.path)
        model.ensureUrlImage(url)
    }
    val bmp = url?.let { model.images[it] }
    val failed = url?.let { model.imageFailed[it] == true } == true

    BoxWithConstraints(Modifier.fillMaxSize().graphicsLayer { alpha = p }) {
        val vw = with(density) { maxWidth.toPx() }; val vh = with(density) { maxHeight.toPx() }
        val (cw, ch) = if (bmp != null) fitSize(bmp.width.toFloat(), bmp.height.toFloat(), vw, vh) else (vw to vh)
        val pull = (pullY / (vh * .4f)).coerceIn(0f, 1f)
        val slop = with(density) { 10.dp.toPx() }
        val closeAt = with(density) { 120.dp.toPx() }
        val pageAt = vw * .2f

        fun animateZoom(to: Zoom) {
            val from = zoom
            scope.launch { animate(0f, 1f, animationSpec = tween(if (Motion.enabled) 240 else 1, easing = FastOutSlowInEasing)) { f, _ ->
                zoom = Zoom(from.scale + (to.scale - from.scale) * f, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f)
            } }
        }
        fun settlePage(dir: Int) { // dir: +1 = to the next picture (the picture goes out to the left), -1 = to the previous one, 0 = back
            scope.launch {
                val from = pageX
                if (dir == 0) {
                    animate(from, 0f, animationSpec = tween(200, easing = FastOutSlowInEasing)) { v, _ -> pageX = v }
                    return@launch
                }
                val out = -dir * vw
                animate(from, out, animationSpec = tween(160, easing = FastOutSlowInEasing)) { v, _ -> pageX = v }
                iv.go(dir)
                pageX = -out
                animate(-out, 0f, animationSpec = tween(200, easing = FastOutSlowInEasing)) { v, _ -> pageX = v }
            }
        }

        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = .96f * (1f - .75f * pull)))
                .pointerInput(pic.key, cw, ch) {
                    detectTapGestures(
                        onDoubleTap = { o -> animateZoom(doubleTapped(zoom, o.x - vw / 2f, o.y - vh / 2f, vw, vh, cw, ch)) },
                        onTap = { chrome = !chrome },
                    )
                }
                .pointerInput(pic.key, cw, ch) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var kind = Drag.None
                        var tx = 0f; var ty = 0f
                        var transforming = false
                        do {
                            val ev = awaitPointerEvent()
                            val fingers = ev.changes.count { it.pressed }
                            if (fingers >= 2 || zoom.zoomed || transforming) {
                                transforming = true
                                val z = ev.calculateZoom(); val pan = ev.calculatePan(); val c = ev.calculateCentroid()
                                if (z != 1f || pan != Offset.Zero) {
                                    zoom = transformed(zoom, z, c.x - vw / 2f, c.y - vh / 2f, pan.x, pan.y, vw, vh, cw, ch)
                                    ev.changes.forEach { if (it.positionChanged()) it.consume() }
                                }
                            } else {
                                val pan = ev.calculatePan()
                                tx += pan.x; ty += pan.y
                                if (kind == Drag.None) kind = dragKind(tx, ty, slop)
                                when (kind) {
                                    Drag.Page -> { pageX = tx; ev.changes.forEach(PointerInputChange::consume) }
                                    Drag.Close -> { pullY = max(0f, ty); pageX = tx * .3f; ev.changes.forEach(PointerInputChange::consume) }
                                    Drag.None -> {}
                                }
                            }
                        } while (ev.changes.any { it.pressed })
                        when {
                            transforming && zoom.scale < MIN_ZOOM + .01f -> animateZoom(Zoom(MIN_ZOOM, 0f, 0f))
                            kind == Drag.Page -> settlePage(if (abs(tx) < pageAt) 0 else if (tx < 0f) (if (iv.index + 1 in iv.pics.indices) 1 else 0) else (if (iv.index - 1 in iv.pics.indices) -1 else 0))
                            kind == Drag.Close -> if (pullY > closeAt) iv.close() else scope.launch {
                                val y0 = pullY; val x0 = pageX
                                animate(0f, 1f, animationSpec = tween(200, easing = FastOutSlowInEasing)) { f, _ -> pullY = y0 * (1f - f); pageX = x0 * (1f - f) }
                            }
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (bmp != null) Image(
                bmp, pic.caption.ifBlank { t("messages.photo") },
                Modifier.fillMaxSize().graphicsLayer {
                    scaleX = zoom.scale; scaleY = zoom.scale
                    translationX = zoom.x + pageX; translationY = zoom.y + pullY
                },
                contentScale = ContentScale.Fit,
            )
            else if (failed) Txt(t("app.imageFailed"), 14, color = C.g400, align = TextAlign.Center)
            else Spinner(28.dp)
        }

        val showChrome = chrome && !zoom.zoomed && pullY < 4f
        val chromeA by animateFloatAsState(if (showChrome) 1f else 0f, tween(180), label = "viewerChrome")
        // not composed at all while it is hidden, so that its keys cannot catch a tap that was meant for the picture
        if (chromeA > .01f) Column(Modifier.fillMaxSize().graphicsLayer { alpha = chromeA }) {
            Row(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .85f), Color.Transparent))).statusBarsPadding().padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoundKey("close", { iv.close() }, description = t("viewer.close"))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    if (pic.who.isNotBlank()) Txt(pic.who, 15, FontWeight.Bold, C.g50, maxLines = 1)
                    if (pic.at.isNotBlank()) Txt(momentText(pic.at), 12, color = C.g400, maxLines = 1)
                }
                Box(Modifier.width(44.dp)) // as wide as the close key, so that the name stays in the middle
            }
            Box(Modifier.weight(1f))
            Column(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .9f), Color.Black.copy(alpha = .9f)))).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 40.dp, bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (pic.caption.isNotBlank()) Txt(pic.caption, 14, color = C.g100, maxLines = 4)
                if (iv.pics.size > 1) Dots(iv.pics.size, iv.index)
                val msg = pic.messageId?.let { id -> model.messages.thread.firstOrNull { it.id == id } }
                if (msg != null && !msg.deleted && msg.status == null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    KeyButton(t("messages.reply"), { model.messages.replyTo = msg; model.messages.editing = null; iv.close() }, compact = true)
                }
                if (hint) Txt(t("viewer.hint"), 12, color = C.g500, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The place among the pictures: small dots, the current one a long pill. */
@Composable
private fun Dots(count: Int, at: Int) {
    val said = t("viewer.position", "i" to at + 1, "n" to count)
    Row(
        Modifier.fillMaxWidth().semantics { contentDescription = said },
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(minOf(count, 12)) { i ->
            val w by animateDpAsState(if (i == at) 22.dp else 6.dp, tween(200), label = "dot")
            Box(Modifier.width(w).height(6.dp).background(if (i == at) C.g50 else Color.White.copy(alpha = .35f), RoundedCornerShape(3.dp)))
        }
    }
}
