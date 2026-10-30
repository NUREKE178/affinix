package space.affinix.app.ui

import space.affinix.app.res.Res
import space.affinix.app.res.rubik_bold
import space.affinix.app.res.rubik_extrabold
import space.affinix.app.res.rubik_medium
import space.affinix.app.res.rubik_regular
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.jetbrains.compose.resources.Font as ResFont

/** The "Instrument" language of the website, as native colours: graphite, one orange signal, raised keys, sunken wells. */
object C {
    val canvas = Color(0xFF0E0E10)
    val rail = Color(0xFF111113)
    val g50 = Color(0xFFF5F5F6)
    val g100 = Color(0xFFECECEE)
    val g200 = Color(0xFFDCDDE1)
    val g300 = Color(0xFFC3C5CB)
    val g400 = Color(0xFFA2A5AE)
    val g500 = Color(0xFF868993)
    val g600 = Color(0xFF565963)
    val g700 = Color(0xFF3A3C43)
    val g800 = Color(0xFF26282D)
    val g900 = Color(0xFF18191C)

    val signal = Color(0xFFFF6A1F)
    val signalHi = Color(0xFFFF8438)
    val signalLo = Color(0xFFF0550F)
    val signalInk = Color(0xFF1D0D04)
    val ok = Color(0xFF34D399)
    val warn = Color(0xFFFBBF24)
    val bad = Color(0xFFFB7185)
    val info = Color(0xFF86A5D9)
    val teal = Color(0xFF2DD4BF)
    val off = Color(0xFF565963)

    val hair = Color.White.copy(alpha = .06f)
    val hair2 = Color.White.copy(alpha = .11f)
    val edge = Color.Black.copy(alpha = .6f)

    val plateTop = Color(0xFF1C1D21)
    val plateBottom = Color(0xFF17181B)
    val wellTop = Color(0xFF09090B)
    val wellBottom = Color(0xFF0D0D0F)
    val keyTop = Color(0xFF34363C)
    val keyBottom = Color(0xFF26282D)
    val keyHoverTop = Color(0xFF3B3D44)
    val keyHoverBottom = Color(0xFF2B2D33)
    val keyDownTop = Color(0xFF212327)
    val litTop = Color(0xFFFF8F55)
    val litMid = Color(0xFFFF6A1F)
    val litBottom = Color(0xFFF65C12)
}

val PlateBrush = Brush.verticalGradient(listOf(C.plateTop, C.plateBottom))
val WellBrush = Brush.verticalGradient(listOf(C.wellTop, C.wellBottom))
val KeyBrush = Brush.verticalGradient(listOf(C.keyTop, C.keyBottom))
val KeyHoverBrush = Brush.verticalGradient(listOf(C.keyHoverTop, C.keyHoverBottom))
val KeyDownBrush = Brush.verticalGradient(listOf(C.keyDownTop, C.keyBottom))
val LitBrush = Brush.verticalGradient(listOf(C.litTop, C.litMid, C.litBottom))
val LitDownBrush = Brush.verticalGradient(listOf(Color(0xFFEE5812), Color(0xFFF26017)))

@Immutable
class Fonts(val family: FontFamily)

/** Rubik, the website's typeface, bundled with the app (Latin, Cyrillic and the Kazakh letters in one file per weight). */
@Composable
fun rememberFonts(): Fonts {
    val regular = ResFont(Res.font.rubik_regular, FontWeight.Normal)
    val medium = ResFont(Res.font.rubik_medium, FontWeight.Medium)
    val bold = ResFont(Res.font.rubik_bold, FontWeight.Bold)
    val extra = ResFont(Res.font.rubik_extrabold, FontWeight.ExtraBold)
    return remember(regular, medium, bold, extra) { Fonts(FontFamily(regular, medium, bold, extra)) }
}

val LocalFonts = androidx.compose.runtime.staticCompositionLocalOf<Fonts> { error("no fonts") }

fun ts(size: Int, weight: FontWeight = FontWeight.Normal, color: Color = C.g100, family: FontFamily? = null, spacing: Float = 0f, line: Float = 1.35f) =
    TextStyle(fontSize = size.sp, fontWeight = weight, color = color, fontFamily = family, letterSpacing = spacing.sp, lineHeight = (size * line).sp)

/** Raised panel: the website's `sk-panel`. */
fun Modifier.plate(radius: Dp = 16.dp): Modifier = this.drawBehind {
    val r = CornerRadius(radius.toPx())
    drawRoundRect(brush = PlateBrush, cornerRadius = r)
}.border(1.dp, C.hair, RoundedCornerShape(radius))

/** Sunken well: the website's `sk-well`. */
fun Modifier.well(radius: Dp = 14.dp): Modifier = this.drawBehind {
    val r = CornerRadius(radius.toPx())
    drawRoundRect(brush = WellBrush, cornerRadius = r)
}.border(1.dp, Color.Black.copy(alpha = .55f), RoundedCornerShape(radius))

fun Modifier.key(radius: Dp = 11.dp, down: Boolean = false, hover: Boolean = false): Modifier = this.drawBehind {
    val r = CornerRadius(radius.toPx())
    drawRoundRect(brush = if (down) KeyDownBrush else if (hover) KeyHoverBrush else KeyBrush, cornerRadius = r)
}.border(1.dp, Color.Black.copy(alpha = .55f), RoundedCornerShape(radius))

fun Modifier.lit(radius: Dp = 11.dp, down: Boolean = false): Modifier = this.drawBehind {
    val r = CornerRadius(radius.toPx())
    drawRoundRect(brush = if (down) LitDownBrush else LitBrush, cornerRadius = r)
}.border(1.dp, Color(0xFF6D2606).copy(alpha = .55f), RoundedCornerShape(radius))

val Pill: Shape = RoundedCornerShape(999.dp)

object Pad {
    val screen = PaddingValues(horizontal = 16.dp)
}
