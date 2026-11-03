package space.affinix.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
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

/**
 * The bottom bar. Its structure follows from the problems of the old one: a flat bar that is as wide as the screen (the old card and its paddings took 36 dp of the width that six
 * labels need), a fixed height of 56 dp, one size for every label that is found by measuring them (the widest must fit its room; nothing is cut with «…»), the same weight and the
 * same icon size for the active tab and the others (so nothing changes its size or shifts when the tab changes: only the colour and the lit pill move), and the system's own
 * navigation inset below it. The lit pill slides to the tab, and while a page is dragged it follows the finger.
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

    Column(
        modifier.fillMaxWidth().background(C.rail).drawBehind { drawLine(C.hair2, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Box(Modifier.fillMaxWidth().height(56.dp).onSizeChanged { barWidth = it.width }) {
            if (itemW > 0 && current >= 0) {
                val pillW = min(52.dp.value * density.density, (itemW - with(density) { 4.dp.toPx() }))
                Box(
                    Modifier.offset { IntOffset((pos * itemW + (itemW - pillW) / 2f).roundToInt(), with(density) { 6.dp.roundToPx() }) }
                        .size(with(density) { pillW.toDp() }, 30.dp).clip(RoundedCornerShape(15.dp)).background(Color.White.copy(alpha = .1f)),
                )
            }
            Row(Modifier.fillMaxSize()) {
                BAR_TABS.forEachIndexed { i, (tab, icon) ->
                    val pulse = rememberPulse(current == i)
                    // how near the lit pill is to this tab (1 under it, 0 a tab away): the colours follow it, so they change with the finger too
                    val near = (1f - abs(pos - i)).coerceIn(0f, 1f).let { if (current < 0) 0f else it }
                    val c = lerp(C.g400, C.g50, near)
                    Column(
                        Modifier.weight(1f).fillMaxHeight()
                            .clickable(remember { MutableInteractionSource() }, null, role = Role.Tab) { pulse.intValue++; model.tab = tab }
                            .padding(top = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Box(Modifier.height(30.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Box(contentAlignment = Alignment.TopEnd) {
                                Ico(icon, color = c, size = 22.dp, pulse = pulse.intValue)
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
                                style = TextStyle(fontSize = sp.sp, fontWeight = FontWeight.Medium, color = c, fontFamily = family, lineHeight = (sp * 1.2f).sp),
                            )
                        }
                    }
                }
            }
        }
    }
}
