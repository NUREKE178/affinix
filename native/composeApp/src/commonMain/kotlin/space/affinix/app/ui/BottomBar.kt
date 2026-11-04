package space.affinix.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab

/** The tabs of the bar in their order, with the icon of each: the same six as before, none renamed or removed. */
val BAR_TABS: List<Pair<Tab, String>> = listOf(
    Tab.Play to "arena", Tab.Feed to "globe", Tab.Chats to "chat", Tab.People to "friends", Tab.Research to "overview", Tab.Profile to "user",
)

/** Where a tab is in the bar: the parts of the Arena stand for «Play», the admin panel for «Profile»; -1 for a screen that has no place in the bar (the bell, the search). */
fun barIndexOf(tab: Tab): Int = when (tab) {
    Tab.Quests, Tab.Rankings -> 0
    Tab.Admin -> 5
    else -> BAR_TABS.indexOfFirst { it.first == tab }
}

/** The largest of the [candidates] at which the widest label still fits the [room] (the last, smallest one when none does): the labels are fitted, never cut. */
fun fitSp(candidates: List<Float>, room: Float, widestAt: (Float) -> Float): Float = candidates.firstOrNull { widestAt(it) <= room } ?: candidates.last()

/**
 * Where the lit pill is, in tabs. While a page is dragged it is between the tab it left and the tab that comes ([amount] of the way). The animated [settled] value that normally holds it
 * is updated one frame after the tab changes, so the frame in which a swipe has just brought the new tab ([committed]) would show the pill back under the old one: it is put under the
 * new tab at once instead.
 */
fun barPosition(current: Int, settled: Float, neighborBar: Int, amount: Float, committed: Boolean): Float = when {
    neighborBar >= 0 -> settled + (neighborBar - settled) * amount
    committed && current >= 0 -> current.toFloat()
    else -> settled
}

private val LabelSizes = listOf(11f, 10.5f, 10f, 9.5f, 9f, 8.5f, 8f)

/** How near the lit key is to tab [i] (1 under it, 0 a tab away or more): the colours of the tab follow it, so they change with the finger too. 0 for every tab when the screen has no place in the bar. */
fun barNear(pos: Float, i: Int, current: Int): Float = if (current < 0) 0f else (1f - abs(pos - i)).coerceIn(0f, 1f)

private val BarTop = Color(0xFF141416)
private val BarBottom = Color(0xFF0F0F11)
private val BarBrush = androidx.compose.ui.graphics.Brush.verticalGradient(listOf(BarTop, BarBottom))
private val KeyShape = RoundedCornerShape(16.dp)
private const val TintResting = .14f
private const val TintLit = .24f

/**
 * The bottom bar. Its structure follows from the problems of the old one: a flat bar that is as wide as the screen (the old card and its paddings took 36 dp of the width that six
 * labels need), a fixed height of 56 dp, one size for every label that is found by measuring them (the widest must fit its room; nothing is cut with «…»), the same weight and the
 * same icon size for the active tab and the others (so nothing changes its size or shifts when the tab changes: only the colour and the lit pill move), and the system's own
 * navigation inset below it. The lit key (a raised key, like every key of the app) slides to the tab, and while a page is dragged it follows the finger; the icon of the lit tab takes the
 * signal colour and a stronger body, its label gets brighter: shape, lightness and hue all say «here», so it does not rest on colour alone.
 */
@Composable
fun BottomBar(model: AppModel, pager: Pager, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    val family = LocalFonts.current.family
    val measurer = rememberTextMeasurer()
    val labels = listOf(t("arena.tabs.play"), t("feed.title"), t("shell.tabbar.messages"), t("friends.title"), t("shell.tabbar.marketers"), t("arena.tabs.profile"))
    val current = barIndexOf(model.tab)
    var barWidth by remember { mutableIntStateOf(0) }
    val itemW = if (barWidth > 0) barWidth / BAR_TABS.size else 0

    // one label size for all, the largest at which the widest label fits (3 dp of air on each side of it)
    val room = (itemW - with(density) { 6.dp.toPx() }).coerceAtLeast(1f)
    val sp = remember(labels, room, family, density.density, density.fontScale) {
        if (itemW == 0) 10f
        else fitSp(LabelSizes, room) { size ->
            labels.maxOf { measurer.measure(it, TextStyle(fontSize = size.sp, fontWeight = FontWeight.Medium, fontFamily = family), softWrap = false, maxLines = 1).size.width }.toFloat()
        }
    }

    // where the lit pill is, in tabs: it slides to the tab that is chosen (at once when a swipe has brought it there) and follows the finger while a page is dragged
    val settled = remember { Animatable(current.coerceAtLeast(0).toFloat()) }
    LaunchedEffect(current) {
        val to = current.coerceAtLeast(0).toFloat()
        if (pager.committed || !Motion.enabled) settled.snapTo(to) else settled.animateTo(to, tween(260, easing = FastOutSlowInEasing))
    }
    val pos = barPosition(current, settled.value, pager.neighborBar, pager.amount, pager.committed)

    // which tab is being pressed (-1: none): the lit key sinks a little when it is the lit one
    var pressed by remember { mutableIntStateOf(-1) }

    Column(
        modifier.fillMaxWidth().background(BarBrush).drawBehind { drawLine(C.hair2, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Box(Modifier.fillMaxWidth().height(56.dp).onSizeChanged { barWidth = it.width }) {
            if (itemW > 0 && current >= 0) {
                val pillW = min(52.dp.value * density.density, (itemW - with(density) { 4.dp.toPx() }))
                val sink = if (pressed >= 0 && pressed == current) 1.dp else 0.dp
                Box(
                    Modifier.offset { IntOffset((pos * itemW + (itemW - pillW) / 2f).roundToInt(), with(density) { (6.dp + sink).roundToPx() }) }
                        .size(with(density) { pillW.toDp() }, 32.dp)
                        .raisedKey(sink == 0.dp),
                )
            }
            Row(Modifier.fillMaxSize()) {
                BAR_TABS.forEachIndexed { i, (tab, icon) ->
                    val pulse = rememberPulse(current == i)
                    val near = barNear(pos, i, current)
                    val iconColor = lerp(C.g400, C.signalHi, near)
                    val labelColor = lerp(C.g400, C.g50, near)
                    val src = remember { MutableInteractionSource() }
                    val down by src.collectIsPressedAsState()
                    LaunchedEffect(down) { if (down) pressed = i else if (pressed == i) pressed = -1 }
                    // a press shrinks the icon a little (only while there is motion)
                    val squeeze by animateFloatAsState(if (down && Motion.enabled) .9f else 1f, tween(110), label = "barPress")
                    Column(
                        Modifier.weight(1f).fillMaxHeight()
                            .semantics { selected = current == i }
                            .clickable(src, null, role = Role.Tab) { pulse.intValue++; model.tab = tab }
                            .padding(top = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(Modifier.height(32.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Box(Modifier.graphicsLayer { scaleX = squeeze; scaleY = squeeze }, contentAlignment = Alignment.TopEnd) {
                                Ico(icon, color = iconColor, size = 22.dp, pulse = pulse.intValue, tint = TintResting + (TintLit - TintResting) * near)
                                if (tab == Tab.Chats && model.messages.unreadTotal > 0) {
                                    Box(
                                        Modifier.offset(x = 9.dp, y = (-5).dp).defaultMinSize(minWidth = 16.dp, minHeight = 16.dp).clip(Pill).background(C.signal)
                                            .border(2.dp, C.rail, Pill).padding(horizontal = 3.dp),
                                        contentAlignment = Alignment.Center,
                                    ) { BasicText("${model.messages.unreadTotal}", style = TextStyle(fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, color = C.signalInk)) }
                                }
                            }
                        }
                        Box(Modifier.padding(top = 3.dp)) {
                            BasicText(
                                labels[i], maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
                                style = TextStyle(fontSize = sp.sp, fontWeight = FontWeight.Medium, color = labelColor, fontFamily = family, lineHeight = (sp * 1.2f).sp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The lit key of the bar: a raised key like the keys of the app ([KeyBrush] colours, a black edge, a light line inside its top edge, a soft shadow below). [raised] false = pressed: the
 * darker key brush and no shadow, so that it looks pushed in.
 */
private fun Modifier.raisedKey(raised: Boolean): Modifier = this.drawBehind {
    val r = androidx.compose.ui.geometry.CornerRadius(16.dp.toPx())
    if (raised) {
        // a soft shadow: three rounded rectangles, each lower, wider and fainter than the one before
        listOf(Triple(1.dp, 0.dp, .30f), Triple(2.dp, 1.dp, .18f), Triple(3.dp, 2.dp, .10f)).forEach { (dy, grow, a) ->
            drawRoundRect(Color.Black.copy(alpha = a), topLeft = Offset(-grow.toPx(), dy.toPx() - grow.toPx()), size = androidx.compose.ui.geometry.Size(size.width + 2 * grow.toPx(), size.height + 2 * grow.toPx()), cornerRadius = androidx.compose.ui.geometry.CornerRadius(r.x + grow.toPx()))
        }
    }
    drawRoundRect(brush = if (raised) KeyBrush else KeyDownBrush, cornerRadius = r)
    if (raised) drawLine(Color.White.copy(alpha = .10f), Offset(r.x, 1.dp.toPx()), Offset(size.width - r.x, 1.dp.toPx()), 1.dp.toPx())
}.border(1.dp, Color.Black.copy(alpha = .55f), KeyShape)
