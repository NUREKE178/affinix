package space.affinix.app.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** The edges of the lit key of a strip, in units of labels: the label number i is the span [i, i + 1]. */
class KeyEdges(val l: Float, val r: Float) {
    companion object { fun at(i: Int) = KeyEdges(i.toFloat(), i + 1f) }
}

/**
 * How the key of a segmented control travels, the way the website's one raised key does (lib/thumb.js): it does not blink off one label and on another, it stretches over both while it
 * goes (the edge it moves towards leads, the other stays behind until 42 % of the way) and then tightens on the new label.
 */
object KeyGeometry {
    const val STRETCH = .42f

    /** the key a fraction [q] (0 .. 1) of the way from [from] to [to] */
    fun between(from: KeyEdges, to: KeyEdges, q: Float): KeyEdges {
        val t = q.coerceIn(0f, 1f)
        if (t >= 1f || (to.l == from.l && to.r == from.r)) return to
        if (t <= 0f) return from
        val lead = (t / STRETCH).coerceAtMost(1f)
        val trail = ((t - STRETCH) / (1f - STRETCH)).coerceAtLeast(0f)
        return if (to.l >= from.l) KeyEdges(from.l + (to.l - from.l) * trail, from.r + (to.r - from.r) * lead) // to the right: the right edge leads
        else KeyEdges(from.l + (to.l - from.l) * lead, from.r + (to.r - from.r) * trail) // to the left: the left edge leads
    }

    /** how much of the label number [i] the key covers (0 .. 1) */
    fun cover(e: KeyEdges, i: Int): Float = (minOf(e.r, i + 1f) - maxOf(e.l, i.toFloat())).coerceIn(0f, 1f)
}

/** The website's easing for the key (400 ms, cubic-bezier(.3, .9, .3, 1)). */
val KeyEase = CubicBezierEasing(.3f, .9f, .3f, 1f)
const val KEY_MS = 400

/**
 * The travelling of a key. A strip that stays on its page owns one; the three parts of the Arena share one that lives in the shell, because the strip is drawn by the page that leaves and
 * the page that comes at once and the key has to be the same on both.
 */
class KeyGlide(private val scope: CoroutineScope? = null, start: Int = 0) {
    private var from by mutableStateOf(KeyEdges.at(start))
    private var to by mutableStateOf(KeyEdges.at(start))
    var q by mutableFloatStateOf(1f)
        private set
    private var job: Job? = null

    /** where the key is now; [settled] is where it rests when it is not travelling (null: where the last glide ended) */
    fun edges(settled: Int? = null): KeyEdges = if (q < 1f) KeyGeometry.between(from, to, q) else if (settled != null) KeyEdges.at(settled) else to

    /** travels to the label [target] from where the key is seen now (so a change in the middle of a glide re-aims it, and the key never jumps) */
    suspend fun run(target: Int, start: KeyEdges = edges()) {
        val aim = KeyEdges.at(target)
        if (!Motion.enabled || (start.l == aim.l && start.r == aim.r)) { from = aim; to = aim; q = 1f; return }
        from = start; to = aim; q = 0f
        animate(0f, 1f, animationSpec = tween(KEY_MS, easing = KeyEase)) { v, _ -> q = v }
        q = 1f
    }

    /** the same, started from a tap (the strip may be gone before the glide ends, so it runs in the shell's scope) */
    fun launchTo(target: Int, start: KeyEdges) {
        job?.cancel()
        job = scope?.launch { run(target, start) }
    }
}

/** The page-drag state of the shell, for what has to follow the finger (the key of the Arena's strip). */
val LocalPager = staticCompositionLocalOf<Pager?> { null }

/** The key shared by the three parts of the Arena (null outside the shell). */
val LocalKeyGlide = staticCompositionLocalOf<KeyGlide?> { null }

/**
 * A segmented control: a well holding flat labels, and ONE raised key under the chosen one. The key glides to a new choice as on the website; where the key is can also be given from
 * outside ([keyAt], in units of labels: the Arena's strip lets it follow the finger while a page is dragged), and [beforePick] says a tap is coming (to start a glide that outlives the strip).
 * Up to three labels share the row; with more the labels keep their own width and the row scrolls sideways, so none is cut off (the key scrolls with them).
 */
@Composable
fun Segmented(
    labels: List<String>, selected: Int, onPick: (Int) -> Unit, modifier: Modifier = Modifier,
    keyAt: (() -> KeyEdges)? = null, beforePick: ((Int) -> Unit)? = null,
) {
    val n = labels.size
    val scrolls = n >= 4
    val own = remember { KeyGlide(null, selected) }
    LaunchedEffect(selected) { if (keyAt == null) own.run(selected) }
    val edges = keyAt?.invoke() ?: own.edges()
    val pad = with(LocalDensity.current) { 4.dp.roundToPx() }
    Box(modifier.fillMaxWidth().well(14.dp)) {
        Layout(
            content = {
                Box(Modifier.key(10.dp, down = false)) // the key, under the labels
                labels.forEachIndexed { i, label ->
                    val cover = KeyGeometry.cover(edges, i)
                    Box(
                        Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Tab) { beforePick?.invoke(i); onPick(i) }
                            .padding(vertical = 10.dp, horizontal = if (scrolls) 14.dp else 0.dp),
                        contentAlignment = Alignment.Center,
                    ) { Txt(label, 14, if (cover > .5f) FontWeight.Bold else FontWeight.Medium, lerp(C.g400, C.g50, cover), maxLines = 1) }
                }
            },
            modifier = if (scrolls) Modifier.horizontalScroll(rememberScrollState()) else Modifier.fillMaxWidth(),
        ) { measurables, constraints ->
            val items = measurables.drop(1)
            val itemW = if (constraints.hasBoundedWidth && !scrolls && n > 0) ((constraints.maxWidth - 2 * pad - (n - 1) * pad) / n).coerceAtLeast(0) else null
            val placed = items.map { it.measure(if (itemW != null) Constraints.fixedWidth(itemW) else Constraints()) }
            val h = placed.maxOfOrNull { it.height } ?: 0
            val lefts = IntArray(n)
            val rights = IntArray(n)
            var x = pad
            placed.forEachIndexed { i, p -> lefts[i] = x; rights[i] = x + p.width; x += p.width + pad }
            val width = if (itemW != null) constraints.maxWidth else x
            layout(width, h + 2 * pad) {
                val left = at(lefts, edges.l)
                val right = at(rights, edges.r - 1f)
                val key = measurables[0].measure(Constraints.fixed((right - left).roundToInt().coerceAtLeast(0), h))
                key.place(left.roundToInt(), pad)
                placed.forEachIndexed { i, p -> p.place(lefts[i], pad) }
            }
        }
    }
}

/** the pixel place that belongs to the fractional label position [u] (between the places of the labels around it) */
private fun at(places: IntArray, u: Float): Float {
    if (places.isEmpty()) return 0f
    val c = u.coerceIn(0f, (places.size - 1).toFloat())
    val i = c.toInt()
    return if (i >= places.size - 1) places[places.size - 1].toFloat() else places[i] + (places[i + 1] - places[i]) * (c - i)
}
