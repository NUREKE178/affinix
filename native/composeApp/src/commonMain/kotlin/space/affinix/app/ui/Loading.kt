package space.affinix.app.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.painterResource
import space.affinix.app.i18n.t
import space.affinix.app.res.Res
import space.affinix.app.res.logo
import kotlin.math.min

/**
 * The loading kit of the website (styles.css: sk-spinner, sk-dots, sk-skeleton, sk-orbit, sk-loadbar, sk-boot) in the same colours, timings and easings, so that waiting looks the
 * same on every screen of the product. Everything is still when [Motion.enabled] is off (the screenshot tests).
 */
object Loading {
    /** how many placeholders (spinners, skeletons ...) are on screen at this moment; the bar along the top edge is lit while there is one */
    var holds by mutableIntStateOf(0)
}

/** Counts a placeholder as on screen for as long as it is composed. */
@Composable
fun LoadingHold() {
    DisposableEffect(Unit) { Loading.holds++; onDispose { Loading.holds-- } }
}

private val Orange = Color(0xFFFF6A1F)

/** "Loading…" -> ("Loading", true): the trailing ellipsis is drawn as animated dots instead of text. */
internal fun splitEllipsis(label: String): Pair<String, Boolean> {
    val m = Regex("""\s*(…|\.{3})\s*$""").find(label) ?: return label to false
    return label.substring(0, m.range.first) to true
}

/** A ring with a comet-tail arc (sk-spinner): the track and the arc are one sweep gradient; it turns once in 0.8 s. */
@Composable
fun Spinner(size: Dp = 18.dp, modifier: Modifier = Modifier) {
    LoadingHold()
    val angle = if (Motion.enabled) {
        val a by rememberInfiniteTransition(label = "spinner").animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing)), label = "angle")
        a
    } else 0f
    val thickness = if (size <= 16.dp) 2.dp else if (size >= 36.dp) 3.dp else 2.5.dp
    Canvas(modifier.size(size)) {
        val stroke = thickness.toPx()
        val box = Size(this.size.width - stroke, this.size.height - stroke)
        val at = Offset(stroke / 2, stroke / 2)
        drawArc(Color.White.copy(alpha = .09f), 0f, 360f, false, at, box, style = Stroke(stroke))
        rotate(angle) {
            drawArc(
                Brush.sweepGradient(0f to Orange.copy(alpha = 0f), .417f to Orange.copy(alpha = .4f), .917f to Orange, 1f to Color(0xFFFFC09C), center = center),
                0f, 360f, false, at, box, style = Stroke(stroke, cap = StrokeCap.Butt),
            )
        }
    }
}

/** Three dots that rise in turn (sk-dots): the animated "…" of a loading label. */
@Composable
fun Dots(color: Color = C.g500, dot: Dp = 4.dp) {
    Row(Modifier.padding(start = dot), horizontalArrangement = Arrangement.spacedBy(dot * .75f), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until 3) {
            val p = if (Motion.enabled) {
                val v by rememberInfiniteTransition(label = "dot$i").animateFloat(
                    0f, 1f,
                    infiniteRepeatable(keyframes<Float> { durationMillis = 1200; 0f at 0; 1f at 420; 0f at 840; 0f at 1200 }, initialStartOffset = StartOffset(160 * i)),
                    label = "rise",
                )
                v
            } else .6f
            Box(Modifier.size(dot).graphicsLayer { translationY = -p * dot.toPx() * .55f; alpha = .3f + .7f * p }.background(color, CircleShape))
        }
    }
}

/** A loading label whose trailing "…" is drawn as [Dots]. */
@Composable
fun LoadingLabel(label: String, size: Int = 14, color: Color = C.g400, modifier: Modifier = Modifier) {
    val (text, dots) = splitEllipsis(label)
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Txt(text, size, FontWeight.Medium, color)
        if (dots) Dots(color, (size * .3f).dp)
    }
}

/**
 * A placeholder block in the shape of the content to come (sk-skeleton): it breathes a little and a light sweeps across it. Blocks that appear together are given a rising
 * [index], so that they start a beat after one another (a waterfall, not all in step).
 */
@Composable
fun Skeleton(modifier: Modifier = Modifier, radius: Dp = 6.dp, index: Int = 0) {
    LoadingHold()
    val delay = min(index, 5) * 120
    val on = Motion.enabled
    val tr = rememberInfiniteTransition(label = "skeleton")
    val pulse = tr.animateFloat(1f, .72f, infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Reverse, StartOffset(delay)), label = "pulse")
    val sweep = tr.animateFloat(-1f, 1f, infiniteRepeatable(tween(1700, easing = CubicBezierEasing(.4f, 0f, .2f, 1f)), initialStartOffset = StartOffset(delay)), label = "sweep")
    Box(
        modifier
            .graphicsLayer { alpha = if (on) pulse.value else 1f }
            .clip(RoundedCornerShape(radius))
            .background(Color(0xFF0D0D0F))
            .drawWithContent {
                drawContent()
                if (on) {
                    val x = sweep.value * size.width
                    drawRect(
                        Brush.horizontalGradient(
                            0f to Color.Transparent, .32f to Color.White.copy(alpha = .03f), .5f to Color.White.copy(alpha = .07f), .68f to Color.White.copy(alpha = .03f), 1f to Color.Transparent,
                            startX = x, endX = x + size.width,
                        ),
                    )
                }
            },
    )
}

/** Rows of a list (a picture and two lines of text) while the list is on its way. */
@Composable
fun SkeletonList(rows: Int = 4, modifier: Modifier = Modifier, avatar: Boolean = true) {
    Plate(modifier.fillMaxWidth(), pad = 14) {
        for (i in 0 until rows) {
            Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (avatar) Skeleton(Modifier.size(44.dp), radius = 22.dp, index = i)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Skeleton(Modifier.fillMaxWidth(if (i % 2 == 0) .55f else .42f).height(14.dp), index = i)
                    Skeleton(Modifier.fillMaxWidth(if (i % 2 == 0) .35f else .5f).height(11.dp), index = i + 1)
                }
            }
        }
    }
}

/** Posts of the feed while they are on their way. */
@Composable
fun SkeletonPosts(count: Int = 3) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for (i in 0 until count) {
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Skeleton(Modifier.size(40.dp), radius = 20.dp, index = i)
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Skeleton(Modifier.width(130.dp).height(14.dp), index = i)
                        Skeleton(Modifier.width(80.dp).height(11.dp), index = i + 1)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Skeleton(Modifier.fillMaxWidth().height(13.dp), index = i + 1)
                    Skeleton(Modifier.fillMaxWidth(.92f).height(13.dp), index = i + 2)
                    Skeleton(Modifier.fillMaxWidth(.6f).height(13.dp), index = i + 3)
                }
                if (i == 0) { Spacer(Modifier.height(12.dp)); Skeleton(Modifier.fillMaxWidth().height(150.dp), radius = 12.dp, index = 4) }
            }
        }
    }
}

/** The messages of a chat while they are on their way: bubbles on both sides. */
@Composable
fun SkeletonBubbles() {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val widths = listOf(210, 150, 240, 120, 190)
        for ((i, w) in widths.withIndex()) {
            Box(Modifier.fillMaxWidth(), contentAlignment = if (i % 2 == 0) Alignment.CenterStart else Alignment.CenterEnd) {
                Skeleton(Modifier.width(w.dp).height(if (i == 2) 62.dp else 42.dp), radius = 16.dp, index = i)
            }
        }
    }
}

/**
 * What a screen shows while it waits for its data. Full size (sk-orbit): the ring of the spinner turns around the mark of the logo, with the label and its dots under it.
 * [compact]: a small ring and the label on one line, for a corner of a screen.
 */
@Composable
fun LoadingState(label: String = t("common.loading"), modifier: Modifier = Modifier, compact: Boolean = false) {
    LoadingHold()
    if (compact) {
        Row(modifier.fillMaxWidth().padding(vertical = 14.dp), Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), Alignment.CenterVertically) {
            Spinner(16.dp)
            LoadingLabel(label, 13, C.g500)
        }
    } else {
        Column(modifier.fillMaxWidth().padding(vertical = 56.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
                Spinner(52.dp)
                Image(painterResource(Res.drawable.logo), null, Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)))
            }
            LoadingLabel(label, 14, C.g400)
        }
    }
}

/**
 * The thin orange bar along the top edge (sk-loadbar), lit while any placeholder is on screen. Debounced both ways: a read that settles in a blink never flashes it
 * (it waits 140 ms), and it fades out (after 220 ms) instead of cutting off.
 */
@Composable
fun LoadBar(modifier: Modifier = Modifier) {
    if (!Motion.enabled) return
    val holding = Loading.holds > 0
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(holding) { delay(if (holding) 140L else 220L); shown = holding }
    val a by animateFloatAsState(if (shown) 1f else 0f, tween(250), label = "loadbar")
    if (a <= 0.01f) return
    val p by rememberInfiniteTransition(label = "loadbar").animateFloat(0f, 1f, infiniteRepeatable(tween(1250, easing = CubicBezierEasing(.65f, 0f, .35f, 1f))), label = "bead")
    Box(
        modifier.fillMaxWidth().height(2.dp).graphicsLayer { alpha = a }.clip(RoundedCornerShape(0.dp)).drawBehind {
            val w = size.width * .38f
            val x = -w + p * w * 3.9f // from -100% to 290% of its own width
            drawRect(
                Brush.horizontalGradient(0f to Orange.copy(alpha = 0f), .45f to Orange, .88f to Color(0xFFFFB089), 1f to Color.White, startX = x, endX = x + w),
                Offset(x, 0f), Size(w, size.height),
            )
        },
    )
}

/**
 * The full-screen loader (sk-boot): the mark with its LED breathing, the wordmark, a bead travelling along a slot, and what the app is doing now. Shown while the app has
 * nothing of its own to show yet.
 */
@Composable
fun BootScreen(label: String) {
    LoadingHold()
    val on = Motion.enabled
    val tr = rememberInfiniteTransition(label = "boot")
    val led = tr.animateFloat(0f, 1f, infiniteRepeatable(tween(1050, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "led")
    val bead = tr.animateFloat(0f, 1f, infiniteRepeatable(tween(1700, easing = CubicBezierEasing(.65f, 0f, .35f, 1f)), RepeatMode.Reverse), label = "bead")
    Box(
        Modifier.fillMaxSize().background(Color(0xFF0E0E10)).drawBehind {
            // one overhead light on the matte surface
            drawRect(Brush.radialGradient(0f to Color.White.copy(alpha = .05f), .45f to Color.White.copy(alpha = .02f), 1f to Color.Transparent, center = Offset(size.width * .5f, size.height * .36f), radius = size.width * .6f))
        },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(88.dp)) {
                    Image(painterResource(Res.drawable.logo), null, Modifier.size(88.dp).clip(RoundedCornerShape(20.dp)))
                    // the LED of the mark breathes: a soft orange halo over the dot (49.3 % / 74.7 % of the tile)
                    Canvas(Modifier.size(88.dp)) {
                        val v = if (on) led.value else .6f
                        val r = size.width * .27f * (.78f + .28f * v)
                        drawCircle(
                            Brush.radialGradient(0f to Orange.copy(alpha = .7f), .38f to Orange.copy(alpha = .3f), .66f to Orange.copy(alpha = .1f), 1f to Orange.copy(alpha = 0f), center = Offset(size.width * .493f, size.height * .747f), radius = r),
                            r, Offset(size.width * .493f, size.height * .747f), alpha = (.12f + .88f * v).coerceIn(0f, 1f), blendMode = BlendMode.Screen,
                        )
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt("affinix", 22, FontWeight.W600, Color(0xFFF5F5F6), spacing = -.66f)
                Txt(".space", 22, FontWeight.W600, Orange, spacing = -.66f)
            }
            Spacer(Modifier.height(24.dp))
            // an inset slot with a lit bead travelling along it
            Box(Modifier.width(168.dp).height(6.dp).clip(CircleShape).background(Brush.verticalGradient(listOf(Color(0xFF09090B), Color(0xFF0D0D0F))))) {
                Box(
                    Modifier.padding(1.dp).fillMaxWidth(.34f).height(4.dp).graphicsLayer { translationX = (if (on) bead.value else .4f) * 1.9f * size.width }
                        .clip(CircleShape).background(Brush.verticalGradient(listOf(Color(0xFFFF9560), Orange, Color(0xFFF0550F)))),
                )
            }
            Spacer(Modifier.height(18.dp))
            Crossfade(label, animationSpec = tween(if (on) 400 else 0), label = "bootLabel") { text ->
                val (shownText, dots) = splitEllipsis(text)
                Row(verticalAlignment = Alignment.Bottom) {
                    Txt(shownText.uppercase(), 11, FontWeight.W600, Color(0xFF868993), spacing = 1.3f)
                    if (dots) Dots(Color(0xFF868993), 3.dp)
                }
            }
        }
    }
}
