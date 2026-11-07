package space.affinix.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import space.affinix.app.ui.Ico
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * An icon is as big as it was asked to be, wherever it stands.
 *
 * The bug (a phone photo of the level card, 0.13): the bell was drawn at 70 % of the magnifier beside it. Both were `Ico(size = 22.dp)`, but the bell was the last child of a row whose
 * earlier children (the level, a long rank chip, the magnifier) had already taken the width: the row handed it what was left, `Modifier.size` obeys the incoming constraint, and the icon
 * is drawn at `canvas width / 24` – so a squeezed canvas drew a smaller bell instead of an overlapping one. These tests measure the drawn pixels, not the layout box.
 */
@OptIn(ExperimentalComposeUiApi::class)
class IconSizeTest {
    /** the box around everything that was drawn lighter than the black ground: its width and height in pixels */
    private class Ink(val w: Int, val h: Int) { override fun toString() = "$w x $h px" }

    private fun ink(sceneWidth: Int, content: @Composable () -> Unit): Ink {
        val scene = ImageComposeScene(width = sceneWidth, height = 60, density = Density(1f)) { Box(Modifier.fillMaxSize().background(Color.Black)) { content() } }
        try {
            val img = scene.render(0L)
            val px = org.jetbrains.skia.Bitmap().also { it.allocN32Pixels(img.width, img.height) }.also { img.readPixels(it) }
            var x0 = Int.MAX_VALUE; var x1 = -1; var y0 = Int.MAX_VALUE; var y1 = -1
            for (y in 0 until px.height) for (x in 0 until px.width) {
                val c = px.getColor(x, y)
                val light = (((c ushr 16) and 0xFF) + ((c ushr 8) and 0xFF) + (c and 0xFF)) / 3
                if (light > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
            }
            check(x1 >= 0) { "nothing was drawn" }
            return Ink(x1 - x0 + 1, y1 - y0 + 1)
        } finally { scene.close() }
    }

    private fun alone(name: String) = ink(120) { Row(Modifier.width(100.dp)) { Ico(name, color = Color.White) } }

    /** the same icon in a row that has only 16 dp left for it (as in the photo) */
    private fun squeezed(name: String) = ink(120) { Row(Modifier.width(30.dp)) { Spacer(Modifier.width(14.dp)); Ico(name, color = Color.White) } }

    @Test fun aBellInANarrowRowIsStillTheSizeOfABellInARoomyOne() {
        val free = alone("bell"); val tight = squeezed("bell")
        assertTrue(abs(free.w - tight.w) <= 1 && abs(free.h - tight.h) <= 1, "the bell keeps its size when its row is narrow (roomy $free, narrow $tight)")
    }

    @Test fun aMagnifierInANarrowRowIsStillTheSizeOfAMagnifierInARoomyOne() {
        val free = alone("search"); val tight = squeezed("search")
        assertTrue(abs(free.w - tight.w) <= 1 && abs(free.h - tight.h) <= 1, "the magnifier keeps its size when its row is narrow (roomy $free, narrow $tight)")
    }

    /** what the user compared by eye: the bell and the magnifier, drawn the same, fill the same box (the bell is a little taller by design: it has a clapper) */
    @Test fun theBellAndTheMagnifierFillTheSameBox() {
        val bell = alone("bell"); val glass = alone("search")
        assertTrue(abs(bell.w - glass.w) <= 1, "the same width (bell $bell, magnifier $glass)")
        assertTrue(abs(bell.h - glass.h) <= 3, "a similar height (bell $bell, magnifier $glass)")
        assertTrue(bell.w >= 16 && glass.w >= 16, "and both are a full 22 dp glyph, not a shrunken one (bell $bell, magnifier $glass)")
    }
}
