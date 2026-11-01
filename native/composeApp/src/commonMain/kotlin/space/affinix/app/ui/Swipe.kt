package space.affinix.app.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.ScrollState
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * What a swipe means, apart from the touch handling so that it can be tested. These are the rules of the website's swipeTabs.js (lengths in dp, time in ms): a swipe
 * must be mostly sideways to start, the content follows the finger with some resistance (more where there is nothing to go to), and it commits when it went far enough
 * or was quick enough.
 */
object SwipeRules {
    /** the screen edges belong to the system's own back gesture */
    const val EDGE = 24f
    const val LOCK_AT = 10f
    const val GIVE_UP_AT = 12f

    /** a mostly vertical movement is a scroll: the swipe leaves it alone */
    fun gaveUp(dx: Float, dy: Float) = abs(dy) > GIVE_UP_AT && abs(dy) > abs(dx)

    /** the movement is sideways enough (and long enough) to be a swipe */
    fun locks(dx: Float, dy: Float) = abs(dx) >= LOCK_AT && abs(dx) >= abs(dy) * 1.4f

    /** how far the content moves for a finger that moved [dx]: the resistance is 0.55, and 0.2 at the first / last page where there is nothing to go to */
    fun follow(dx: Float, hasTarget: Boolean) = dx * (if (hasTarget) .55f else .2f)

    /** how transparent the content gets (0 .. 0.4) */
    fun fade(dx: Float, hasTarget: Boolean) = min(abs(dx) / 420f, .4f) * (if (hasTarget) 1f else .4f)

    /** goes to the next page: far (a fifth of the width, at least 64) or quick (over 36 at more than 0.45 per ms) */
    fun commits(dx: Float, ms: Long, widthDp: Float, hasTarget: Boolean): Boolean {
        if (!hasTarget) return false
        val far = abs(dx) > max(64f, widthDp * .2f)
        val quick = abs(dx) > 36f && abs(dx) / max(ms, 1L) > .45f
        return far || quick
    }

    /** which page a swipe of [dx] asks for: a swipe to the left (negative) goes to the next one (+1), to the right to the previous (-1) */
    fun direction(dx: Float) = if (dx < 0) 1 else -1

    // ---- swipe to reply (a message dragged to the right) ----
    const val REPLY_AT = 56f
    const val REPLY_MAX = 84f

    /** the message follows the finger, and stiffens after the point where letting go replies */
    fun replyShift(dx: Float): Float = if (dx <= REPLY_AT) max(dx, 0f) else min(REPLY_AT + (dx - REPLY_AT) * .25f, REPLY_MAX)

    fun replies(dx: Float) = dx >= REPLY_AT

    // ---- swipe down to dismiss (a card) ----
    fun dismisses(dy: Float, ms: Long) = dy > 90f || (dy > 36f && dy / max(ms, 1L) > .5f)
}

/** The pages a screen has inside itself (the tabs of the Arena, the sections of the marketers' tab ...) registered by the screen, so that one gesture handler above can use them. */
class SwipeRegistry {
    class Sections(val index: Int, val count: Int, val go: (Int) -> Unit)

    private val entries = ArrayList<Pair<Any, Sections>>()

    /** keeps the place of the owner in the order of first registration: a screen that fades out re-registering itself must not push the screen that replaced it aside */
    fun set(owner: Any, sections: Sections) {
        val i = entries.indexOfFirst { it.first === owner }
        if (i >= 0) entries[i] = owner to sections else entries += owner to sections
    }

    fun remove(owner: Any) { entries.removeAll { it.first === owner } }

    /** what a swipe in direction [dir] (+1 next, -1 previous) does inside the newest registered screen, or null when it has no such page */
    fun target(dir: Int): (() -> Unit)? {
        val s = entries.lastOrNull()?.second ?: return null
        val to = s.index + dir
        return if (to in 0 until s.count) ({ s.go(to) }) else null
    }
}

val LocalSwipeRegistry = staticCompositionLocalOf<SwipeRegistry?> { null }

/** A screen that has pages inside itself says so: [index] of [count], and how to go to another. A swipe past the last page goes on to the next tab of the bar. */
@Composable
fun SwipeSections(index: Int, count: Int, go: (Int) -> Unit) {
    val reg = LocalSwipeRegistry.current ?: return
    val owner = remember { Any() }
    val goNow by rememberUpdatedState(go)
    DisposableEffect(index, count) { reg.set(owner, SwipeRegistry.Sections(index, count) { goNow(it) }); onDispose { } }
    DisposableEffect(Unit) { onDispose { reg.remove(owner) } }
}

private val SettleEase = CubicBezierEasing(.22f, .9f, .3f, 1f)

/**
 * Swiping the content sideways goes to the next / previous page (the website's swipeTabs.js): the content follows the finger with some resistance, and slides out when the
 * swipe is far or quick enough; where there is no page the content stretches a little and springs back. Only touch counts (not a mouse), the screen edges are left to the
 * system, and a drag that a scroller, a strip or a field has already taken is not touched.
 * [target] answers which action a swipe in a direction (+1 next, -1 previous) has, or null.
 */
fun Modifier.swipeNavigate(enabled: Boolean, target: (dir: Int) -> (() -> Unit)?): Modifier = composed {
    if (!enabled) return@composed this
    val density = LocalDensity.current.density
    val scope = rememberCoroutineScope()
    val targetNow by rememberUpdatedState(target)
    var shift by remember { mutableFloatStateOf(0f) }  // px
    var dim by remember { mutableFloatStateOf(0f) }
    var hold by remember { mutableFloatStateOf(1f) }
    val job = remember { arrayOfNulls<Job>(1) }

    this
        .graphicsLayer { translationX = shift; alpha = (1f - dim) * hold }
        .pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                if (down.type != PointerType.Touch) return@awaitEachGesture
                if (down.position.x < SwipeRules.EDGE * density || down.position.x > size.width - SwipeRules.EDGE * density) return@awaitEachGesture
                job[0]?.cancel(); job[0] = null
                shift = 0f; dim = 0f; hold = 1f
                var locked = false
                var action: (() -> Unit)? = null
                var dxDp = 0f
                var ms = 1L
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    if (!locked && change.isConsumed) return@awaitEachGesture // a scroller, a strip or a field took it
                    dxDp = (change.position.x - down.position.x) / density
                    val dyDp = (change.position.y - down.position.y) / density
                    ms = change.uptimeMillis - down.uptimeMillis
                    if (!change.pressed) break
                    if (!locked) {
                        if (SwipeRules.gaveUp(dxDp, dyDp)) return@awaitEachGesture
                        if (!SwipeRules.locks(dxDp, dyDp)) continue
                        locked = true
                    }
                    action = targetNow(SwipeRules.direction(dxDp))
                    shift = SwipeRules.follow(dxDp, action != null) * density
                    dim = SwipeRules.fade(dxDp, action != null)
                    change.consume()
                }
                if (!locked) return@awaitEachGesture
                val widthDp = size.width / density
                val go = action
                val startShift = shift
                val startDim = dim
                val dir = SwipeRules.direction(dxDp)
                if (go != null && SwipeRules.commits(dxDp, ms, widthDp, true)) {
                    job[0] = scope.launch {
                        if (Motion.enabled) {
                            // out: slide a little further in the direction of the swipe and fade; then the page changes and the new one fades in
                            animate(0f, 1f, animationSpec = tween(130, easing = FastOutLinearInEasing)) { p, _ ->
                                shift = startShift + (-dir * 44f * density - startShift) * p; hold = 1f - p; dim = startDim * (1f - p)
                            }
                        }
                        go()
                        shift = 0f; dim = 0f; hold = if (Motion.enabled) 0f else 1f
                        if (Motion.enabled) animate(0f, 1f, animationSpec = tween(220)) { p, _ -> hold = p }
                    }
                } else {
                    job[0] = scope.launch {
                        if (Motion.enabled) animate(0f, 1f, animationSpec = tween(240, easing = SettleEase)) { p, _ -> shift = startShift * (1f - p); dim = startDim * (1f - p) }
                        shift = 0f; dim = 0f
                    }
                }
            }
        }
}

/**
 * A message that is dragged to the right shows a reply arrow and, let go past the mark, answers it (the message springs back either way). Only a mostly sideways drag counts,
 * so scrolling the chat is not disturbed.
 */
@Composable
fun SwipeToReply(enabled: Boolean, onReply: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    if (!enabled) { Box(modifier) { content() }; return }
    val density = LocalDensity.current.density
    val scope = rememberCoroutineScope()
    val replyNow by rememberUpdatedState(onReply)
    var shift by remember { mutableFloatStateOf(0f) }  // dp
    val job = remember { arrayOfNulls<Job>(1) }
    Box(
        modifier.pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                if (down.type != PointerType.Touch) return@awaitEachGesture
                job[0]?.cancel(); job[0] = null
                shift = 0f
                var locked = false
                var dxDp = 0f
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    if (!locked && change.isConsumed) return@awaitEachGesture
                    dxDp = (change.position.x - down.position.x) / density
                    val dyDp = (change.position.y - down.position.y) / density
                    if (!change.pressed) break
                    if (!locked) {
                        if (SwipeRules.gaveUp(dxDp, dyDp) || dxDp < -SwipeRules.LOCK_AT) return@awaitEachGesture // vertical, or to the left: not ours
                        if (!SwipeRules.locks(dxDp, dyDp) || dxDp <= 0f) continue
                        locked = true
                    }
                    shift = SwipeRules.replyShift(dxDp)
                    change.consume()
                }
                if (!locked) return@awaitEachGesture
                val reply = SwipeRules.replies(dxDp)
                val from = shift
                job[0] = scope.launch {
                    if (reply) replyNow()
                    if (Motion.enabled) animate(from, 0f, animationSpec = tween(220, easing = SettleEase)) { v, _ -> shift = v } else shift = 0f
                }
            }
        },
    ) {
        val reach = (shift / SwipeRules.REPLY_AT).coerceIn(0f, 1f)
        Box(Modifier.align(Alignment.CenterStart).padding(start = 8.dp).graphicsLayer { alpha = reach; val s = .6f + .4f * reach; scaleX = s; scaleY = s }) {
            Ico("reply", color = if (reach >= 1f) C.signalHi else C.g500, size = 22.dp)
        }
        Box(Modifier.graphicsLayer { translationX = shift * density }) { content() }
    }
}

/** How far a card is pulled down (dp); [pullOffset] shows it, [pullToDismiss] changes it. */
class PullState { var shift by mutableFloatStateOf(0f) }

@Composable
fun rememberPull(): PullState = remember { PullState() }

/** Moves the card with the finger. It goes OUTSIDE a scroller (a scroller clips what is inside it, and the card must be free to leave). */
fun Modifier.pullOffset(pull: PullState): Modifier = graphicsLayer { translationY = pull.shift.dp.toPx() }

/**
 * A card that is dragged down follows the finger and, let go far or quickly enough, goes away ([onDismiss]); otherwise it springs back. It only starts when [scroll] is at its
 * top, so that a card that scrolls can still be scrolled. [onPull] says how far it is pulled (0 .. 1), for the dim behind it.
 * It goes INSIDE the scroller ([Modifier.verticalScroll] before it): the events reach it first, and a drag it has taken is not scrolled.
 */
fun Modifier.pullToDismiss(pull: PullState, scroll: ScrollState, onPull: (Float) -> Unit, onDismiss: () -> Unit): Modifier = composed {
    val density = LocalDensity.current.density
    val scope = rememberCoroutineScope()
    val dismissNow by rememberUpdatedState(onDismiss)
    val pullNow by rememberUpdatedState(onPull)
    val job = remember { arrayOfNulls<Job>(1) }
    this.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (down.type != PointerType.Touch || scroll.value > 0) return@awaitEachGesture
            job[0]?.cancel(); job[0] = null
            pull.shift = 0f
            var locked = false
            var dyDp = 0f
            var ms = 1L
            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (!locked && change.isConsumed) return@awaitEachGesture
                val dxDp = (change.position.x - down.position.x) / density
                dyDp = (change.position.y - down.position.y) / density
                ms = change.uptimeMillis - down.uptimeMillis
                if (!change.pressed) break
                if (!locked) {
                    if (abs(dxDp) > SwipeRules.GIVE_UP_AT && abs(dxDp) > abs(dyDp) || dyDp < -SwipeRules.GIVE_UP_AT) return@awaitEachGesture // sideways, or upwards: not ours
                    if (dyDp < SwipeRules.LOCK_AT || dyDp < abs(dxDp) * 1.4f) continue
                    locked = true
                }
                pull.shift = max(dyDp, 0f)
                pullNow((pull.shift / 260f).coerceIn(0f, 1f))
                change.consume()
            }
            if (!locked) return@awaitEachGesture
            val gone = SwipeRules.dismisses(dyDp, ms)
            val from = pull.shift
            job[0] = scope.launch {
                if (gone) {
                    if (Motion.enabled) animate(from, from + 320f, animationSpec = tween(160, easing = FastOutLinearInEasing)) { v, _ -> pull.shift = v; pullNow(1f) }
                    dismissNow()
                    pull.shift = 0f; pullNow(0f)
                } else {
                    if (Motion.enabled) animate(from, 0f, animationSpec = tween(240, easing = SettleEase)) { v, _ -> pull.shift = v; pullNow((v / 260f).coerceIn(0f, 1f)) }
                    pull.shift = 0f; pullNow(0f)
                }
            }
        }
    }
}

/** Whether a text field has the focus (the keyboard is up): then a sideways drag belongs to the text and never changes the tab. */
object Typing {
    var fields by mutableIntStateOf(0)
    val active: Boolean get() = fields > 0
}

/** Put on every text field: it tells [Typing] while it has the focus. */
fun Modifier.trackTyping(): Modifier = composed {
    var focused by remember { mutableStateOf(false) }
    DisposableEffect(focused) { if (focused) Typing.fields++; onDispose { if (focused) Typing.fields-- } }
    onFocusChanged { focused = it.isFocused }
}
