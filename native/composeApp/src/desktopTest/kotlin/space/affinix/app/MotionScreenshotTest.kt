package space.affinix.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
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
import space.affinix.app.ui.Skeleton
import space.affinix.app.ui.Spinner
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

    /** how many pixels differ between two frames */
    private fun changedPixels(a: org.jetbrains.skia.Bitmap, b: org.jetbrains.skia.Bitmap): Int {
        var n = 0
        for (y in 0 until a.height) for (x in 0 until a.width) if (a.getColor(x, y) != b.getColor(x, y)) n++
        return n
    }

    private fun frame(scene: ImageComposeScene, nanos: Long): org.jetbrains.skia.Bitmap {
        val img = scene.render(nanos)
        return org.jetbrains.skia.Bitmap().also { it.allocN32Pixels(img.width, img.height) }.also { img.readPixels(it) }
    }

    @Test fun theSpinnerTurnsAndASkeletonSweeps() {
        Motion.enabled = true
        try {
            val scene = ImageComposeScene(width = 220, height = 100, density = Density(1f)) {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) { Spinner(56.dp); Skeleton(Modifier.size(100.dp, 56.dp)) }
            }
            try {
                var t = 0L
                fun step(ms: Int) { repeat(ms / 16) { Thread.sleep(6); t += 16_000_000L; scene.render(t) } }
                step(160)
                val a = frame(scene, t + 1_000_000L)
                step(240)
                val b = frame(scene, t + 1_000_000L)
                assertTrue(changedPixels(a, b) > 150, "something moved between the two frames (the ring turned, the light swept)")
            } finally { scene.close() }
        } finally { Motion.enabled = false }
    }
}
