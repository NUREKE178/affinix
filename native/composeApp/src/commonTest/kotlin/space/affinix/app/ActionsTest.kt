package space.affinix.app

import space.affinix.app.ui.countLabel
import kotlin.test.Test
import kotlin.test.assertEquals

class ActionsTest {
    @Test fun theCountOnTheBellKeepsItsSize() {
        assertEquals("1", countLabel(1))
        assertEquals("12", countLabel(12))
        assertEquals("99", countLabel(99))
        assertEquals("99+", countLabel(100))
        assertEquals("99+", countLabel(5000))
    }
}
