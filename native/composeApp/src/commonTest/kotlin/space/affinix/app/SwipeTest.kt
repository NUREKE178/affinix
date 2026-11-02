package space.affinix.app

import space.affinix.app.store.Tab
import space.affinix.app.ui.BAR_TABS
import space.affinix.app.ui.SwipeRegistry
import space.affinix.app.ui.barIndexOf
import space.affinix.app.ui.fitSp
import space.affinix.app.ui.SwipeRules
import space.affinix.app.ui.splitEllipsis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The decisions of a swipe are those of the website's swipeTabs.js; the touch handling on top of them is checked in SwipeGestureTest (it needs the Skia window). */
class SwipeTest {
    @Test fun aSwipeStartsOnlyWhenItIsMostlySideways() {
        assertTrue(SwipeRules.locks(30f, 5f))
        assertTrue(SwipeRules.locks(-14f, 10f)) // 14 >= 10 * 1.4
        assertFalse(SwipeRules.locks(9f, 0f)) // too short
        assertFalse(SwipeRules.locks(30f, 25f)) // a diagonal is not a swipe
    }

    @Test fun aScrollIsLeftAlone() {
        assertTrue(SwipeRules.gaveUp(4f, 20f))
        assertFalse(SwipeRules.gaveUp(30f, 20f))
        assertFalse(SwipeRules.gaveUp(2f, 11f)) // not yet far enough to be sure
    }

    @Test fun theContentFollowsWithMoreResistanceWhereThereIsNothingToGoTo() {
        assertEquals(55f, SwipeRules.follow(100f, true), 1e-4f)
        assertEquals(20f, SwipeRules.follow(100f, false), 1e-4f)
        assertEquals(-55f, SwipeRules.follow(-100f, true), 1e-4f)
        assertEquals(.4f, SwipeRules.fade(5000f, true), 1e-4f) // never more than 40 %
        assertEquals(.16f, SwipeRules.fade(5000f, false), 1e-4f)
        assertEquals(.1f, SwipeRules.fade(42f, true), 1e-4f)
    }

    @Test fun aSwipeCommitsWhenFarOrQuickAndNeverWithoutAPage() {
        assertTrue(SwipeRules.commits(-100f, 600, 420f, true)) // far: more than 20 % of 420 = 84
        assertFalse(SwipeRules.commits(-70f, 600, 420f, true)) // slow and short
        assertTrue(SwipeRules.commits(-50f, 80, 420f, true)) // short but quick: 50 / 80 = 0.62 per ms
        assertFalse(SwipeRules.commits(-30f, 20, 420f, true)) // under 36 is never quick
        assertFalse(SwipeRules.commits(-300f, 100, 420f, false)) // no page to go to
        assertTrue(SwipeRules.commits(-70f, 600, 300f, true)) // on a narrow screen 64 is the floor: 70 > max(64, 60)
        assertFalse(SwipeRules.commits(-90f, 600, 800f, true)) // on a wide one a fifth of the width is 160
    }

    @Test fun aSwipeToTheLeftGoesToTheNextPage() {
        assertEquals(1, SwipeRules.direction(-40f))
        assertEquals(-1, SwipeRules.direction(40f))
    }

    @Test fun aMessageRepliesWhenLetGoPastTheMarkAndStiffensAfterIt() {
        assertEquals(30f, SwipeRules.replyShift(30f), 1e-4f)
        assertEquals(0f, SwipeRules.replyShift(-20f), 1e-4f) // never to the left
        assertEquals(56f + 40f * .25f, SwipeRules.replyShift(96f), 1e-4f)
        assertEquals(84f, SwipeRules.replyShift(1000f), 1e-4f)
        assertTrue(SwipeRules.replies(60f)); assertFalse(SwipeRules.replies(40f))
    }

    @Test fun aCardIsDismissedByAFarOrQuickPullDown() {
        assertTrue(SwipeRules.dismisses(120f, 900))
        assertFalse(SwipeRules.dismisses(60f, 900))
        assertTrue(SwipeRules.dismisses(60f, 80)) // quick
        assertFalse(SwipeRules.dismisses(30f, 10)) // under 36 is never quick
    }

    @Test fun aScreenWithPagesInsideItAnswersBeforeTheBar() {
        val reg = SwipeRegistry()
        assertNull(reg.target(1)) // nothing registered: the tab bar decides
        var went = -1
        val arena = Any()
        reg.set(arena, SwipeRegistry.Sections(index = 0, count = 3) { went = it })
        assertNull(reg.target(-1)) // first page: nothing before it, so the bar's previous tab takes the swipe
        reg.target(1)!!.invoke(); assertEquals(1, went)
        reg.set(arena, SwipeRegistry.Sections(index = 2, count = 3) { went = it })
        assertNull(reg.target(1)) // last page: the next tab of the bar
        reg.target(-1)!!.invoke(); assertEquals(1, went)
    }

    @Test fun aScreenThatIsFadingOutDoesNotPushTheOneThatReplacedItAside() {
        val reg = SwipeRegistry()
        val old = Any(); val new = Any()
        var who = ""
        reg.set(old, SwipeRegistry.Sections(0, 3) { who = "old" })
        reg.set(new, SwipeRegistry.Sections(0, 6) { who = "new" })
        reg.set(old, SwipeRegistry.Sections(0, 3) { who = "old" }) // the old screen recomposes while it fades
        reg.target(1)!!.invoke(); assertEquals("new", who)
        reg.remove(old)
        assertNotNull(reg.target(1)) // the new one is still there
        reg.remove(new)
        assertNull(reg.target(1))
    }

    @Test fun aTrailingEllipsisBecomesAnimatedDots() {
        assertEquals("Loading" to true, splitEllipsis("Loading…"))
        assertEquals("Загрузка" to true, splitEllipsis("Загрузка..."))
        assertEquals("Opening your workspace" to true, splitEllipsis("Opening your workspace … "))
        assertEquals("Done" to false, splitEllipsis("Done"))
        assertEquals("A…B" to false, splitEllipsis("A…B")) // only a trailing one
    }

    @Test fun theLabelsOfTheBarAreFittedNotCut() {
        val sizes = listOf(11f, 10.5f, 10f, 9.5f, 9f, 8.5f, 8f)
        // a label of 9 letters that is 5.6 px wide per letter at 10 sp: 56 px at 10, 61.6 at 11
        fun widest(sp: Float) = 9 * (sp * .56f)
        assertEquals(11f, fitSp(sizes, 70f) { widest(it) })
        assertEquals(10f, fitSp(sizes, 52f) { widest(it) })
        assertEquals(9f, fitSp(sizes, 46f) { widest(it) })
        assertEquals(8f, fitSp(sizes, 10f) { widest(it) }) // when nothing fits, the smallest (never a size that is skipped for being too big)
        assertEquals(10.5f, fitSp(sizes, 53f) { widest(it) }) // 10.5 sp -> 52.9
    }

    @Test fun everyScreenHasItsPlaceInTheBarOrNone() {
        assertEquals(6, BAR_TABS.size)
        assertEquals(listOf(Tab.Play, Tab.Feed, Tab.Chats, Tab.People, Tab.Research, Tab.Profile), BAR_TABS.map { it.first })
        assertEquals(0, barIndexOf(Tab.Play)); assertEquals(0, barIndexOf(Tab.Quests)); assertEquals(0, barIndexOf(Tab.Rankings)) // the Arena is one tab
        assertEquals(5, barIndexOf(Tab.Profile)); assertEquals(5, barIndexOf(Tab.Admin)) // the admin panel opens from the profile
        assertEquals(-1, barIndexOf(Tab.Notifications)); assertEquals(-1, barIndexOf(Tab.Search)) // the bell and the search are not tabs
    }

    @Test fun theArenasPagesAreDrawnBesideEachOtherWhileTheyAreDragged() {
        val reg = SwipeRegistry()
        val arena = Any()
        val parts = listOf(Tab.Play, Tab.Quests, Tab.Rankings)
        reg.set(arena, SwipeRegistry.Sections(index = 0, count = 3, preview = { parts[it] }) { })
        assertEquals(Tab.Quests, reg.target(1)!!.preview)
        reg.set(arena, SwipeRegistry.Sections(index = 1, count = 3, preview = { parts[it] }) { })
        assertEquals(Tab.Play, reg.target(-1)!!.preview); assertEquals(Tab.Rankings, reg.target(1)!!.preview)
        reg.set(arena, SwipeRegistry.Sections(index = 1, count = 3) { }) // pages that cannot be drawn beside (the feed's modes): nothing to preview
        assertNull(reg.target(1)!!.preview)
    }
}
