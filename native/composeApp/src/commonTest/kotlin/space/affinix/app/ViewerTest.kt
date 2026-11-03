package space.affinix.app

import space.affinix.app.store.ImageViewerModel
import space.affinix.app.store.Pic
import space.affinix.app.ui.Drag
import space.affinix.app.ui.MAX_ZOOM
import space.affinix.app.ui.MIN_ZOOM
import space.affinix.app.ui.TAP_ZOOM
import space.affinix.app.ui.Zoom
import space.affinix.app.ui.doubleTapped
import space.affinix.app.ui.dragKind
import space.affinix.app.ui.fitSize
import space.affinix.app.ui.panLimit
import space.affinix.app.ui.transformed
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ViewerTest {
    private fun pics(n: Int) = (1..n).map { Pic("p$it", "https://x/$it.jpg", null, "A", "2026-11-03T10:00:00+00:00", "c$it") }

    // ---- the model --------------------------------------------------------------------------------------------------------------------

    @Test fun openingStartsAtTheTappedPictureAndPagingStopsAtTheEnds() {
        val v = ImageViewerModel()
        assertFalse(v.isOpen); assertNull(v.current)
        v.open(pics(3), "p2")
        assertTrue(v.isOpen); assertEquals("p2", v.current?.key)
        assertTrue(v.go(1)); assertEquals("p3", v.current?.key)
        assertFalse(v.go(1)); assertEquals("p3", v.current?.key) // past the last one it stays, and says so
        assertTrue(v.go(-1)); assertTrue(v.go(-1)); assertFalse(v.go(-1))
        assertEquals("p1", v.current?.key)
    }

    @Test fun anUnknownKeyOpensTheFirstPictureAndNothingToShowStaysClosed() {
        val v = ImageViewerModel()
        v.open(emptyList(), "p1"); assertFalse(v.isOpen)
        v.open(pics(2), "nope"); assertEquals("p1", v.current?.key)
        v.close(); assertFalse(v.isOpen); assertEquals(0, v.index)
    }

    // ---- the zoom -----------------------------------------------------------------------------------------------------------------------

    @Test fun aPictureThatFitsTheScreenCannotBeMovedUntilItIsZoomedPastTheScreen() {
        assertEquals(0f, panLimit(400f, 300f, 1f))
        assertEquals(0f, panLimit(400f, 300f, 1.3f)) // 390 < 400: still inside the screen
        assertEquals(100f, panLimit(400f, 300f, 2f)) // 600 wide on a 400 screen: 100 each way
    }

    @Test fun aPictureIsLaidInsideTheScreenWhole() {
        assertEquals(400f to 200f, fitSize(800f, 400f, 400f, 800f)) // wide picture on a tall screen: width fills
        assertEquals(200f to 400f, fitSize(100f, 200f, 400f, 400f)) // tall picture on a square screen: height fills
        assertEquals(400f to 800f, fitSize(0f, 0f, 400f, 800f)) // not decoded yet: the whole screen
    }

    @Test fun aDoubleTapGoesToTheTapZoomKeepingTheSpotUnderTheFingerAndAnotherOneGoesBack() {
        val z = Zoom(MIN_ZOOM, 0f, 0f)
        val a = doubleTapped(z, 50f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(TAP_ZOOM, a.scale)
        // a point 50px right of the middle stays 50px right of the middle: x*(1-s) + 50*s... = 50 -> x = 50*(1-2.5) = -75
        assertEquals(-75f, a.x)
        val back = doubleTapped(a, 0f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(MIN_ZOOM, back.scale); assertEquals(0f, back.x); assertEquals(0f, back.y)
    }

    @Test fun aDoubleTapNearTheEdgeIsKeptInsideTheLimits() {
        val a = doubleTapped(Zoom(MIN_ZOOM, 0f, 0f), 195f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(panLimit(400f, 400f, TAP_ZOOM), -a.x) // moved as far as it may go, not further
    }

    @Test fun pinchingNeverGoesPastTheLimitsAndAFingerPanMovesThePictureWhenZoomed() {
        var z = Zoom(MIN_ZOOM, 0f, 0f)
        z = transformed(z, 100f, 0f, 0f, 0f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(MAX_ZOOM, z.scale)
        z = transformed(z, .001f, 0f, 0f, 0f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(MIN_ZOOM, z.scale); assertEquals(0f, z.x)
        val two = transformed(Zoom(2f, 0f, 0f), 1f, 0f, 0f, 30f, -20f, 400f, 800f, 400f, 800f)
        assertEquals(30f, two.x); assertEquals(-20f, two.y)
        val far = transformed(Zoom(2f, 0f, 0f), 1f, 0f, 0f, 9999f, 0f, 400f, 800f, 400f, 800f)
        assertEquals(panLimit(400f, 400f, 2f), far.x)
    }

    @Test fun aDragOfAPictureThatIsNotZoomedPagesOrClosesOrWaits() {
        assertEquals(Drag.None, dragKind(3f, 4f, 10f)) // still inside the touch slop
        assertEquals(Drag.Page, dragKind(-40f, 12f, 10f)) // along the screen, either way
        assertEquals(Drag.Page, dragKind(40f, -12f, 10f))
        assertEquals(Drag.Close, dragKind(5f, 30f, 10f)) // down
        assertEquals(Drag.None, dragKind(5f, -30f, 10f)) // up decides nothing
    }
}
