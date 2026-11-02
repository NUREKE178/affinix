package space.affinix.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import space.affinix.app.Platform
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * Motion: what makes the app feel alive. Blocks rise into place one after another when a screen appears, bars grow, numbers count up, keys give way under a finger, the
 * tab bar's key slides to the new tab, a round that ends throws confetti. Everything is a few lines at the call site (or none: every [Plate] and [Bar] already does it).
 * [enabled] is switched off by the screenshot tests so that a picture is of the finished screen, and by anyone who wants a still app.
 */
object Motion {
    @Volatile var enabled: Boolean = true
}

/** Blocks that appear in the same moment get later and later start times (at most nine steps), so a screen builds itself in a cascade instead of all at once. */
private object Stagger {
    private var last = 0L
    private var n = 0
    @Synchronized fun next(): Int {
        val now = Platform.nowMillis()
        if (now - last > 280) n = 0
        last = now
        return n++
    }
}

/** True inside a page that is drawn beside the current one while it is dragged in: its blocks are all in place at once (they must not start fading in while they are already on the screen). */
val LocalStill = androidx.compose.runtime.staticCompositionLocalOf { false }

/** Fades and slides a block up into place when it first appears; [index] pins its place in the cascade (default: in order of appearance). */
fun Modifier.enter(index: Int? = null, rise: Dp = 16.dp): Modifier = composed {
    val on = Motion.enabled && !LocalStill.current
    val step = remember { index ?: Stagger.next() }
    val a = remember { Animatable(if (on) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (on) { delay(min(step, 9) * 45L); a.animateTo(1f, tween(480, easing = FastOutSlowInEasing)) }
    }
    graphicsLayer {
        val v = a.value
        alpha = v
        translationY = (1f - v) * rise.toPx()
        val s = .97f + .03f * v
        scaleX = s; scaleY = s
    }
}

/** A slow, gentle swell: for the logo and anything else that should look alive while it waits. */
fun Modifier.breathe(amount: Float = .06f, periodMs: Int = 2600): Modifier = composed {
    if (!Motion.enabled) return@composed this
    val s by rememberInfiniteTransition(label = "breathe").animateFloat(1f, 1f + amount, infiniteRepeatable(tween(periodMs, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "scale")
    graphicsLayer { scaleX = s; scaleY = s }
}

/** 0 -> [target] on first showing, and smoothly to any later target; the finished value at once when motion is off. */
@Composable
fun rememberGrow(target: Float, durationMs: Int = 800): Float {
    val on = Motion.enabled && !LocalStill.current
    val a = remember { Animatable(if (on) 0f else target) }
    LaunchedEffect(target) { if (on) a.animateTo(target, tween(durationMs, easing = FastOutSlowInEasing)) else a.snapTo(target) }
    return a.value
}

/** A whole number that counts up from 0 to [target] (and between later targets). */
@Composable
fun rememberCountUp(target: Int, durationMs: Int = 1000): Int = rememberGrow(target.toFloat(), durationMs).roundToInt()

/** 12345 -> "12 345" */
fun grouped(n: Int): String {
    val s = kotlin.math.abs(n).toString().reversed().chunked(3).joinToString(" ").reversed()
    return if (n < 0) "−$s" else s
}

/** A number that counts up, with the thousands grouped. */
@Composable
fun CountText(
    value: Int, size: Int = 24, weight: FontWeight = FontWeight.ExtraBold, color: Color = C.g50, modifier: Modifier = Modifier,
    prefix: String = "", suffix: String = "",
) {
    Txt(prefix + grouped(rememberCountUp(value)) + suffix, size, weight, color, modifier, maxLines = 1)
}

/** A burst of confetti over the parent for a couple of seconds; it starts again when [key] changes. */
@Composable
fun Confetti(modifier: Modifier = Modifier, key: Any = Unit, count: Int = 56) {
    if (!Motion.enabled) return
    val progress = remember(key) { Animatable(0f) }
    LaunchedEffect(key) { progress.snapTo(0f); progress.animateTo(1f, tween(2400, easing = LinearEasing)) }
    val colors = listOf(C.signal, C.signalHi, C.ok, C.info, C.g50, C.warn)
    val parts = remember(key) {
        val rnd = Random(20261101)
        List(count) {
            Particle(
                vx = (rnd.nextFloat() - .5f) * 1.5f, vy = -(.7f + rnd.nextFloat() * 1.1f), spin = (rnd.nextFloat() - .5f) * 900f, phase = rnd.nextFloat() * 360f,
                w = 5f + rnd.nextFloat() * 6f, h = 3f + rnd.nextFloat() * 4f, color = colors[rnd.nextInt(colors.size)],
            )
        }
    }
    Canvas(modifier) {
        val t = progress.value
        if (t >= 1f) return@Canvas
        val gravity = 2.1f
        for (p in parts) {
            val x = size.width * (.5f + p.vx * t)
            val y = size.height * (.12f + (p.vy * t + gravity * t * t) * .55f)
            val fade = if (t > .72f) (1f - t) / .28f else 1f
            rotate(p.phase + p.spin * t, Offset(x, y)) { drawRect(p.color.copy(alpha = fade), Offset(x - p.w / 2, y - p.h / 2), Size(p.w, p.h)) }
        }
    }
}

private class Particle(val vx: Float, val vy: Float, val spin: Float, val phase: Float, val w: Float, val h: Float, val color: Color)
