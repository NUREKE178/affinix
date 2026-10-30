package space.affinix.app

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalComposeUiApi::class)
class ScreenshotTest {
    @Test
    fun appRendersOffscreen() {
        val scene = ImageComposeScene(width = 900, height = 640, density = Density(1f)) { App() }
        // resources load asynchronously: give the scene a few frames
        var img = scene.render(0)
        for (i in 1..40) { Thread.sleep(40); img = scene.render(i * 40_000_000L) }
        val data = img.encodeToData(EncodedImageFormat.PNG)!!
        val out = File(System.getProperty("shots", "build/shots")).also { it.mkdirs() }.resolve("app.png")
        out.writeBytes(data.bytes)
        assertTrue(out.length() > 5_000)
        scene.close()
    }
}
