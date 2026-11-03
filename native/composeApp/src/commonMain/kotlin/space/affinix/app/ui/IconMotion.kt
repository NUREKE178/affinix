package space.affinix.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sin

/** How a part of an icon is moved at one moment of its gesture (the numbers are on the icon's 24 x 24 grid, degrees for [rot]). */
internal class Xf(
    val rot: Float = 0f, val sx: Float = 1f, val sy: Float = 1f, val tx: Float = 0f, val ty: Float = 0f, val alpha: Float = 1f,
    val px: Float = 12f, val py: Float = 12f,
)

/**
 * The gesture of every icon: one short move of the whole glyph (or of one of its parts) that plays once when the icon is touched or becomes active, so the glyphs are alive without
 * ever running on their own. The website does the same on a cursor (styles.css, "Icon motion"); a finger has no hover, so the touch and the change to "active" stand for it.
 * Each icon has its own gesture: the hexagon of the Play tab pops and its bolt flashes, the globe turns, the bell swings, the heart beats twice, the gear turns, the chat wobbles ...
 */
internal object IconMotion {
    const val MS = 640

    private fun bump(p: Float) = sin(PI * p).toFloat() // 0 -> 1 -> 0
    private fun damp(p: Float, cycles: Float) = (sin(2.0 * PI * cycles * p) * (1f - p)).toFloat() // a swing that dies away
    private fun out(p: Float) = 1f - (1f - p) * (1f - p) * (1f - p)
    private fun inOut(p: Float) = p * p * (3f - 2f * p)
    private fun pop(p: Float, by: Float = .24f) = 1f + by * bump(p) * (1f - .25f * p)
    private fun scaled(s: Float, px: Float = 12f, py: Float = 12f, rot: Float = 0f, tx: Float = 0f, ty: Float = 0f, alpha: Float = 1f) = Xf(rot, s, s, tx, ty, alpha, px, py)

    /** how the part number [part] of the icon [name] is moved at the moment [p] (0 .. 1) of its gesture */
    fun of(name: String, part: Int, p: Float): Xf = when (name) {
        "arena" -> if (part == 0) scaled(pop(p, .1f), rot = 7f * damp(p, 1f)) // the hexagon swells a little ...
        else scaled(1f + .5f * bump(p), 12f, 12.5f, rot = -12f * bump(p), alpha = 1f - .4f * abs(sin(3.0 * PI * p)).toFloat() * (1f - p)) // ... and the bolt flashes
        "globe" -> Xf(rot = 360f * inOut(p))
        "overview" -> Xf(rot = 90f * inOut(p))
        "settings" -> Xf(rot = 360f * out(p))
        "chat" -> Xf(rot = 9f * damp(p, 2f), sx = pop(p, .1f), sy = pop(p, .1f), px = 6f, py = 18f)
        "comment" -> Xf(rot = 9f * damp(p, 2f), sx = pop(p, .1f), sy = pop(p, .1f), px = 5f, py = 19f)
        "bell", "bellOff" -> Xf(rot = 20f * damp(p, 2.5f), px = 12f, py = 5f)
        "heart" -> scaled(1f + .32f * max(0f, sin(4.0 * PI * p).toFloat()) * (1f - .5f * p)) // two beats
        "bookmark" -> Xf(sx = pop(p, .12f), sy = pop(p, .2f), ty = -2f * bump(p), py = 20f)
        "search" -> Xf(rot = -16f * damp(p, 1.5f), sx = pop(p, .12f), sy = pop(p, .12f), px = 10.5f, py = 10.5f)
        "user", "userPlus", "userCheck" -> Xf(ty = -1.6f * bump(p), sx = pop(p, .12f), sy = pop(p, .12f))
        "trophy", "medal", "crown" -> Xf(rot = 7f * damp(p, 2f), ty = -2.2f * bump(p), px = 12f, py = 20f)
        "flame" -> Xf(sx = 1f - .07f * bump(p), sy = 1f + .16f * bump(p), px = 12f, py = 21f)
        "bolt" -> scaled(pop(p, .3f), rot = -8f * bump(p))
        "send" -> Xf(tx = 2.2f * bump(p), ty = -2.2f * bump(p), sx = pop(p, .1f), sy = pop(p, .1f))
        "arrowRight", "chevronRight", "chevronsRight" -> Xf(tx = 2.2f * bump(p))
        "arrowLeft", "chevronLeft", "chevronsLeft", "reply" -> Xf(tx = -2.2f * bump(p))
        "arrowUp" -> Xf(ty = -2.2f * bump(p))
        "arrowDown", "chevronDown" -> Xf(ty = 2.2f * bump(p))
        "pin" -> Xf(rot = -18f * damp(p, 1.5f), px = 8f, py = 20f)
        "more" -> if (part < 3) Xf(ty = -2.4f * max(0f, sin(2.0 * PI * (p - part * .12f)).toFloat()) * (1f - p)) else Xf()
        else -> scaled(pop(p))
    }
}

/**
 * A counter that goes up each time [on] turns true (not for what is true when the screen opens): the tab that becomes active, the heart that is liked. A caller can also count by
 * hand (a tap on a key that is already lit). Give it to [Ico] as `pulse`.
 */
@Composable
fun rememberPulse(on: Boolean): MutableIntState {
    val n = remember { mutableIntStateOf(0) }
    val first = remember { booleanArrayOf(true) }
    LaunchedEffect(on) {
        if (!first[0] && on) n.intValue++
        first[0] = false
    }
    return n
}
