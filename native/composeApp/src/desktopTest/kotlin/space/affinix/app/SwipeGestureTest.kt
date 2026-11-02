package space.affinix.app

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.unit.Density
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.MemoryKeyValueStore
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Person
import space.affinix.app.net.Session
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab
import space.affinix.app.ui.Motion
import space.affinix.app.ui.SwipeTrace
import space.affinix.app.ui.Typing
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Real touches on the real screen (the Skia window): a swipe changes the tab, chains out of the Arena's tabs, and leaves alone what is not a swipe. */
@OptIn(ExperimentalComposeUiApi::class)
class SwipeGestureTest {
    @BeforeTest fun still() { Motion.enabled = false; SwipeTrace.clear() }

    /** what the app was doing, for the message of a swipe that did not happen */
    private fun AppModel.state() = "tab=$tab typing=${Typing.fields} viewer=${profileViewer.isOpen} round=${game.round.value != null} mission=${mission.round != null} thread=${messages.open != null} trace=[${SwipeTrace.text()}]"

    private fun model(): AppModel {
        val engine = MockEngine { respond("{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }
        val api = Api(HttpClient(engine), Config(), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "u1", "me@affinix.space")))
        return AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), MemoryKeyValueStore())
    }

    private class Finger(val scene: ImageComposeScene) {
        var nanos = 0L
        fun frames(n: Int) { repeat(n) { Thread.sleep(16); nanos += 16_000_000L; scene.render(nanos) } }
        /** presses and moves without letting go, then writes what is on the screen */
        fun holdAndShoot(name: String, x0: Float, y0: Float, x1: Float, y1: Float) {
            send(PointerEventType.Press, x0, y0, PointerType.Touch); frames(1)
            for (i in 1..10) { send(PointerEventType.Move, x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10, PointerType.Touch); frames(2) }
            frames(8)
            val img = scene.render(nanos + 16_000_000L)
            java.io.File(System.getProperty("shots") ?: "build/shots").also { it.mkdirs() }.resolve("$name.png").writeBytes(img.encodeToData(org.jetbrains.skia.EncodedImageFormat.PNG)!!.bytes)
        }
        private fun send(type: PointerEventType, x: Float, y: Float, pointer: PointerType) =
            scene.sendPointerEvent(type, Offset(x, y), timeMillis = nanos / 1_000_000L, type = pointer)

        /** presses at (x0, y0), moves in small steps to (x1, y1) and lets go */
        fun drag(x0: Float, y0: Float, x1: Float, y1: Float, pointer: PointerType = PointerType.Touch, steps: Int = 10) {
            send(PointerEventType.Press, x0, y0, pointer); frames(1)
            for (i in 1..steps) { send(PointerEventType.Move, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, pointer); frames(1) }
            send(PointerEventType.Release, x1, y1, pointer); frames(6)
        }
    }

    private fun withApp(m: AppModel, block: (Finger) -> Unit) {
        val scene = ImageComposeScene(width = 420, height = 900, density = Density(1f)) { App(m) }
        try {
            val f = Finger(scene)
            f.frames(30) // fonts and resources load asynchronously
            var waited = 0
            while (m.loading && waited++ < 200) f.frames(1) // the first read of the player
            f.frames(10)
            block(f)
        } finally { scene.close() }
    }

    @Test fun aSwipeToTheLeftGoesToTheNextTab() {
        val m = model(); m.tab = Tab.People
        withApp(m) { f ->
            f.drag(330f, 700f, 130f, 710f)
            assertEquals(Tab.Research, m.tab, "swiped left from the friends")
        }
    }

    @Test fun aSwipeToTheRightGoesBack() {
        val m = model(); m.tab = Tab.Chats
        withApp(m) { f ->
            f.drag(100f, 700f, 300f, 700f)
            assertEquals(Tab.Feed, m.tab, "swiped right from the chats")
        }
    }

    /** one swipe after the other, in both directions, over the middle of the bar (the Styles page, where the marketers' tab opens, has a strip that keeps its own drag, so it is not used here) */
    @Test fun swipesGoBackAndForthAlongTheBar() {
        val m = model(); m.tab = Tab.Chats
        withApp(m) { f ->
            f.drag(330f, 700f, 130f, 700f); assertEquals(Tab.People, m.tab, "Chats -> People")
            f.drag(100f, 700f, 300f, 700f); assertEquals(Tab.Chats, m.tab, "People -> Chats ${m.state()}")
            f.drag(100f, 700f, 300f, 700f); assertEquals(Tab.Feed, m.tab, "Chats -> Feed")
        }
    }

    @Test fun thereIsNothingBeforeTheFirstTab() {
        val m = model(); m.tab = Tab.Play
        withApp(m) { f ->
            f.drag(100f, 400f, 330f, 400f)
            assertEquals(Tab.Play, m.tab, "the first page stretches and springs back")
        }
    }

    @Test fun theArenasOwnTabsComeFirstAndThenTheBar() {
        val m = model(); m.tab = Tab.Play
        withApp(m) { f ->
            f.drag(330f, 400f, 130f, 400f); assertEquals(Tab.Quests, m.tab, "Play -> Quests")
            f.drag(330f, 400f, 130f, 400f); assertEquals(Tab.Rankings, m.tab, "Quests -> Rankings ${m.state()}")
            f.drag(330f, 400f, 130f, 400f); assertEquals(Tab.Feed, m.tab, "past the last Arena tab the bar goes on")
        }
    }

    @Test fun aScrollAMouseAndTheScreenEdgeAreNotSwipes() {
        val m = model(); m.tab = Tab.People
        withApp(m) { f ->
            f.drag(200f, 700f, 215f, 300f); assertEquals(Tab.People, m.tab, "a vertical drag is a scroll")
            f.drag(330f, 400f, 130f, 400f, pointer = PointerType.Mouse); assertEquals(Tab.People, m.tab, "a mouse drag is not a swipe")
            f.drag(8f, 400f, 250f, 400f); assertEquals(Tab.People, m.tab, "from the screen edge the system's own back gesture takes it")
            f.drag(330f, 400f, 300f, 402f); assertEquals(Tab.People, m.tab, "a short drag is not far enough")
        }
    }

    @Test fun theProfileCardIsPulledDownToClose() {
        val m = model(); m.tab = Tab.People
        withApp(m) { f ->
            m.profileViewer.open(Person("u2", "Dias", "dias", null)); f.frames(20)
            assertTrue(m.profileViewer.isOpen)
            f.drag(210f, 440f, 215f, 700f)
            assertTrue(!m.profileViewer.isOpen, "pulled down far enough: the card is gone")
        }
    }

    /** the pager: halfway through a swipe both pages are on the screen, side by side (the picture shows it) */
    @Test fun halfwayThroughASwipeBothPagesAreSeen() {
        val m = model(); m.tab = Tab.Chats
        withApp(m) { f ->
            f.holdAndShoot("48-pager-mid-phone", 330f, 600f, 150f, 604f)
            assertEquals(Tab.Chats, m.tab, "nothing has changed until the finger is lifted")
        }
    }
}
