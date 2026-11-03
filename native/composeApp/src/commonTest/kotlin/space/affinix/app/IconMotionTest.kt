package space.affinix.app

import space.affinix.app.ui.ICONS
import space.affinix.app.ui.IconMotion
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The gesture of every icon: it starts and ends at rest (so nothing jumps when it begins or stops) and never throws a glyph out of its grid. */
class IconMotionTest {
    private fun rest(name: String, part: Int, p: Float) {
        val x = IconMotion.of(name, part, p)
        val turn = abs(x.rot % 90f).let { minOf(it, 90f - it) } // a quarter turn of the grid of squares, or a whole turn of a globe or gear, looks the same as rest
        assertTrue(turn < 1e-2f, "$name part $part at $p turned by ${x.rot}")
        assertTrue(abs(x.sx - 1f) < 1e-3f && abs(x.sy - 1f) < 1e-3f, "$name part $part at $p scaled to ${x.sx} x ${x.sy}")
        assertTrue(abs(x.tx) < 1e-3f && abs(x.ty) < 1e-3f, "$name part $part at $p moved by ${x.tx}, ${x.ty}")
        assertTrue(abs(x.alpha - 1f) < 1e-3f, "$name part $part at $p faded to ${x.alpha}")
    }

    @Test fun everyGestureStartsAndEndsAtRest() {
        for ((name, shapes) in ICONS) for (part in shapes.indices) { rest(name, part, 0f); rest(name, part, 1f) }
    }

    @Test fun noGestureThrowsAGlyphOutOfItsGrid() {
        for ((name, shapes) in ICONS) for (part in shapes.indices) {
            var p = 0f
            while (p <= 1f) {
                val x = IconMotion.of(name, part, p)
                val all = listOf(x.rot, x.sx, x.sy, x.tx, x.ty, x.alpha, x.px, x.py)
                assertTrue(all.all { it.isFinite() }, "$name part $part at $p: $all")
                assertTrue(x.sx in .5f..1.8f && x.sy in .5f..1.8f, "$name part $part at $p scaled to ${x.sx} x ${x.sy}")
                assertTrue(abs(x.tx) <= 4f && abs(x.ty) <= 4f, "$name part $part at $p moved by ${x.tx}, ${x.ty}")
                assertTrue(x.alpha in 0f..1f, "$name part $part at $p faded to ${x.alpha}")
                p += .02f
            }
        }
    }

    /** the Play tab is a hexagon with a bold bolt in it: two parts, the bolt solid (its gesture moves the two parts apart) */
    @Test fun thePlayIconIsAHexagonWithABolt() {
        val shapes = ICONS.getValue("arena")
        assertEquals(2, shapes.size)
        assertTrue(shapes[0].fill == 1 && shapes[0].stroke, "the hexagon is a tinted body with an outline")
        assertTrue(shapes[1].fill == 2 && !shapes[1].stroke, "the bolt is solid")
        val flash = IconMotion.of("arena", 1, .5f)
        assertTrue(flash.sx > 1.3f, "the bolt swells in the middle of its gesture: ${flash.sx}")
    }

    @Test fun theBellSwingsFromItsTop() {
        val x = IconMotion.of("bell", 0, .1f)
        assertTrue(abs(x.rot) > 1f && x.py < 8f, "the bell turns around a point near the top: ${x.rot} at ${x.px}, ${x.py}")
    }
}
