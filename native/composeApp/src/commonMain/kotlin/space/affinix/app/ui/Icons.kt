package space.affinix.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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

/** The website's own icon set (see IconData.kt): 2px round strokes on a 24 grid, with a tinted body inside closed shapes. [filled] turns the tint solid (a liked heart). */
@Composable
fun Ico(name: String, modifier: Modifier = Modifier, color: Color = C.g200, size: Dp = 22.dp, filled: Boolean = false) {
    val shapes = remember(name) {
        (ICONS[name] ?: emptyList()).map { s -> s to PathParser().parsePathString(s.d).toPath().also { if (s.evenOdd) it.fillType = PathFillType.EvenOdd } }
    }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        scale(k, k, pivot = Offset.Zero) {
            for ((s, path) in shapes) {
                if (s.fill == 2) drawPath(path, color)
                else if (s.fill == 1) drawPath(path, color.copy(alpha = if (filled) 1f else .2f))
                if (s.stroke) drawPath(path, color, style = Stroke(width = s.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
    }
}

/** An icon with an optional count next to it, as one tap target (like / comment / save). */
@Composable
fun IcoAction(name: String, onClick: () -> Unit, modifier: Modifier = Modifier, count: Int? = null, active: Boolean = false, activeColor: Color = C.signalHi, filled: Boolean = active) {
    val c = if (active) activeColor else C.g400
    Row(
        modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button, onClick = onClick).padding(horizontal = 6.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Ico(name, color = c, filled = filled)
        if (count != null && count > 0) Txt("$count", 13, FontWeight.Bold, c)
    }
}
