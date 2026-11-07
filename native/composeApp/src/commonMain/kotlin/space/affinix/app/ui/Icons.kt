package space.affinix.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * An icon is always drawn at [size] (`requiredSize`, not `size`): the drawing is scaled by its canvas, so a row that has no room left must not be able to shrink the canvas and with it the glyph (the 0.13 bell
 * was drawn at 70 % of the magnifier beside it for that reason, see IconSizeTest); a row that is too narrow overlaps instead, which is visible and gets fixed where the layout is wrong.
 *
 * The website's own icon set (see IconData.kt): 2px round strokes on a 24 grid, with a tinted body inside closed shapes ([tint] is how strong it is, 20 % by default). [filled] turns the tint solid (a liked heart). [pulse] is a counter
 * (see [rememberPulse]): each time it changes the icon plays its gesture once ([IconMotion]); a page that is drawn beside the current one keeps still.
 */
@Composable
fun Ico(name: String, modifier: Modifier = Modifier, color: Color = C.g200, size: Dp = 22.dp, filled: Boolean = false, pulse: Int = 0, tint: Float = .2f) {
    val shapes = remember(name) {
        (ICONS[name] ?: emptyList()).map { s -> s to PathParser().parsePathString(s.d).toPath().also { if (s.evenOdd) it.fillType = PathFillType.EvenOdd } }
    }
    val still = LocalStill.current
    val seen = remember { intArrayOf(pulse) }
    val progress = remember { Animatable(1f) }
    LaunchedEffect(pulse) {
        if (pulse != seen[0]) {
            seen[0] = pulse
            if (Motion.enabled && !still) { progress.snapTo(0f); progress.animateTo(1f, tween(IconMotion.MS, easing = LinearEasing)) }
        }
    }
    Canvas(modifier.requiredSize(size)) { drawIco(name, shapes, color, filled, progress.value, tint) }
}

/** An icon caught at one moment [progress] (0 .. 1) of its gesture: the screenshots of the gestures use it. */
@Composable
internal fun IcoAt(name: String, progress: Float, modifier: Modifier = Modifier, color: Color = C.g50, size: Dp = 22.dp) {
    val shapes = remember(name) {
        (ICONS[name] ?: emptyList()).map { s -> s to PathParser().parsePathString(s.d).toPath().also { if (s.evenOdd) it.fillType = PathFillType.EvenOdd } }
    }
    Canvas(modifier.requiredSize(size)) { drawIco(name, shapes, color, false, progress) }
}

private fun DrawScope.drawIco(name: String, shapes: List<Pair<IcShape, Path>>, color: Color, filled: Boolean, progress: Float, tint: Float = .2f) {
    val k = this.size.width / 24f
    scale(k, k, pivot = Offset.Zero) {
        shapes.forEachIndexed { idx, (s, path) ->
            val xf = if (progress >= 1f) null else IconMotion.of(name, idx, progress)
            val c = if (xf != null && xf.alpha < 1f) color.copy(alpha = color.alpha * xf.alpha) else color
            val paint = {
                if (s.fill == 2) drawPath(path, c)
                else if (s.fill == 1) drawPath(path, c.copy(alpha = if (filled) c.alpha else c.alpha * tint))
                if (s.stroke) drawPath(path, c, style = Stroke(width = s.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            if (xf == null) paint()
            else withTransform({
                translate(xf.tx, xf.ty)
                rotate(xf.rot, Offset(xf.px, xf.py))
                scale(xf.sx, xf.sy, Offset(xf.px, xf.py))
            }) { paint() }
        }
    }
}

/** An icon with an optional count next to it, as one tap target (like / comment / save). */
@Composable
fun IcoAction(name: String, onClick: () -> Unit, modifier: Modifier = Modifier, count: Int? = null, active: Boolean = false, activeColor: Color = C.signalHi, filled: Boolean = active) {
    val c = if (active) activeColor else C.g400
    val pulse = rememberPulse(active)
    Row(
        modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { pulse.intValue++; onClick() }.padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Ico(name, color = c, filled = filled, pulse = pulse.intValue)
        if (count != null && count > 0) Txt("$count", 13, FontWeight.Bold, c)
    }
}
