package space.affinix.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import space.affinix.app.ui.Bar
import space.affinix.app.ui.Motion
import space.affinix.app.ui.Plate
import kotlin.test.Test
import kotlin.test.assertTrue

/** The motion is real: a block that has just appeared is still mostly invisible, and a moment later it is fully drawn (so a still screenshot would have caught a screen stuck mid-way). */
@OptIn(ExperimentalComposeUiApi::class)
class MotionScreenshotTest {
    /** how strongly the picture differs from its own background: a card at 2% opacity adds almost nothing, a finished card adds a lot */
    private fun visibility(scene: ImageComposeScene, nanos: Long): Long {
        val img = scene.render(nanos)
        val px = org.jetbrains.skia.Bitmap().also { it.allocN32Pixels(img.width, img.height) }.also { img.readPixels(it) }
        val bg = px.getColor(1, 1)
        fun ch(c: Int, shift: Int) = (c ushr shift) and 0xFF
        var sum = 0L
        for (y in 0 until img.height step 2) for (x in 0 until img.width step 2) {
            val c = px.getColor(x, y)
            sum += kotlin.math.abs(ch(c, 16) - ch(bg, 16)) + kotlin.math.abs(ch(c, 8) - ch(bg, 8)) + kotlin.math.abs(ch(c, 0) - ch(bg, 0))
        }
        return sum
    }

    @Test fun aCardRisesIntoPlaceAndABarGrows() {
        Motion.enabled = true
        try {
            val scene = ImageComposeScene(width = 420, height = 260, density = Density(1f)) {
                Column(Modifier.padding(16.dp)) { Plate(Modifier.fillMaxWidth()) { Bar(0.8f); Bar(0.5f) } }
            }
            try {
                var t = 0L
                fun step(ms: Int) { repeat(ms / 16) { Thread.sleep(6); t += 16_000_000L; scene.render(t) } }
                step(32) // composition and the first frames: the card has only just started to appear
                val early = visibility(scene, t + 1_000_000L)
                step(1600)
                val late = visibility(scene, t + 1_000_000L)
                assertTrue(late > 2000, "the finished card is drawn ($late)")
                assertTrue(early * 2 < late, "it was still mostly invisible at the start (early $early, late $late)")
            } finally { scene.close() }
        } finally { Motion.enabled = false }
    }
}
