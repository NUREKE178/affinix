package space.affinix.app

import kotlinx.coroutines.test.runTest
import space.affinix.app.ui.KeyEdges
import space.affinix.app.ui.KeyGeometry
import space.affinix.app.ui.KeyGlide
import space.affinix.app.ui.Motion
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The key of a segmented control: how it travels between labels (the website's one raised key), and how the labels read where it is. */
class StripTest {
    private fun near(a: Float, b: Float, msg: String = "") = assertTrue(kotlin.math.abs(a - b) < 1e-4f, "$msg expected $b but was $a")

    @Test fun theKeyStartsAndEndsOnItsLabels() {
        val from = KeyEdges.at(0); val to = KeyEdges.at(1)
        val a = KeyGeometry.between(from, to, 0f); val b = KeyGeometry.between(from, to, 1f)
        near(a.l, 0f); near(a.r, 1f); near(b.l, 1f); near(b.r, 2f)
    }

    /** to the right the right edge leads: it is at the new label after 42 % of the way, and the left edge has not started yet; then the key tightens */
    @Test fun movingRightTheRightEdgeLeadsAndTheKeyStretches() {
        val from = KeyEdges.at(0); val to = KeyEdges.at(2)
        val early = KeyGeometry.between(from, to, KeyGeometry.STRETCH)
        near(early.l, 0f, "left edge waits"); near(early.r, 3f, "right edge has arrived")
        val half = KeyGeometry.between(from, to, KeyGeometry.STRETCH / 2)
        near(half.l, 0f); near(half.r, 2f)
        val late = KeyGeometry.between(from, to, .71f)
        assertTrue(late.l > 0f && late.l < 2f && late.r == 3f, "the left edge catches up: $late")
    }

    @Test fun movingLeftTheLeftEdgeLeads() {
        val from = KeyEdges.at(2); val to = KeyEdges.at(0)
        val early = KeyGeometry.between(from, to, KeyGeometry.STRETCH)
        near(early.l, 0f, "left edge has arrived"); near(early.r, 3f, "right edge waits")
    }

    @Test fun theKeyIsNeverNarrowerThanALabel() {
        for (target in 0..2) for (start in 0..2) {
            var q = 0f
            while (q <= 1f) {
                val e = KeyGeometry.between(KeyEdges.at(start), KeyEdges.at(target), q)
                assertTrue(e.r - e.l >= 1f - 1e-4f && e.l >= 0f && e.r <= 3f, "from $start to $target at $q: $e")
                q += .05f
            }
        }
    }

    @Test fun theLabelsReadWhereTheKeyIs() {
        val e = KeyEdges(.5f, 1.5f)
        near(KeyGeometry.cover(e, 0), .5f); near(KeyGeometry.cover(e, 1), .5f); near(KeyGeometry.cover(e, 2), 0f)
        near(KeyGeometry.cover(KeyEdges.at(1), 1), 1f); near(KeyGeometry.cover(KeyEdges.at(1), 0), 0f)
        // stretched over two labels: both are covered
        near(KeyGeometry.cover(KeyEdges(0f, 2f), 0), 1f); near(KeyGeometry.cover(KeyEdges(0f, 2f), 1), 1f)
    }

    /** without motion (a test, reduced motion) the key is simply where it is told to be */
    @Test fun withoutMotionTheKeySnaps() = runTest {
        val was = Motion.enabled
        Motion.enabled = false
        try {
            val glide = KeyGlide(null, 0)
            glide.run(2)
            val e = glide.edges()
            near(e.l, 2f); near(e.r, 3f)
            assertEquals(1f, glide.q)
            // it rests where the shell says when it is not travelling
            val rest = glide.edges(1)
            near(rest.l, 1f); near(rest.r, 2f)
        } finally { Motion.enabled = was }
    }
}
