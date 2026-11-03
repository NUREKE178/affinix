package space.affinix.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.LocalLang
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Phase
import space.affinix.app.store.Tab
import space.affinix.app.ui.BootScreen
import space.affinix.app.ui.C
import space.affinix.app.ui.BAR_TABS
import space.affinix.app.ui.BottomBar
import space.affinix.app.ui.LoadBar
import space.affinix.app.ui.LocalPreviewTab
import space.affinix.app.ui.LocalStill
import space.affinix.app.ui.Pager
import space.affinix.app.ui.SwipeTarget
import space.affinix.app.ui.barIndexOf
import space.affinix.app.ui.pagerSwipe
import space.affinix.app.ui.LocalSwipeRegistry
import space.affinix.app.ui.SwipeRegistry
import space.affinix.app.ui.Typing
import space.affinix.app.ui.Motion
import space.affinix.app.ui.DuelScreen
import space.affinix.app.ui.ChatsListScreen
import space.affinix.app.ui.FeedScreen
import space.affinix.app.ui.NotificationsScreen
import space.affinix.app.ui.PeopleScreen
import space.affinix.app.ui.QuestsScreen
import space.affinix.app.ui.Pill
import space.affinix.app.ui.ThreadScreen
import space.affinix.app.ui.Ico
import space.affinix.app.ui.HomeScreen
import space.affinix.app.ui.LocalFonts
import space.affinix.app.ui.LoginScreen
import space.affinix.app.ui.ProfileScreen
import space.affinix.app.ui.RankingsScreen
import space.affinix.app.ui.SearchScreen
import space.affinix.app.ui.Txt
import space.affinix.app.ui.key
import space.affinix.app.ui.plate
import space.affinix.app.ui.rememberFonts

@Composable
fun App(model: AppModel) {
    val fonts = rememberFonts()
    CompositionLocalProvider(LocalFonts provides fonts, LocalLang provides model.lang) {
        Box(Modifier.fillMaxSize().background(C.canvas)) {
            if (!model.signedIn) LoginScreen(model) else MainShell(model)
            LoadBar(Modifier.align(Alignment.TopCenter)) // lit while any placeholder is on screen, as on the website
        }
    }
}

@Composable
private fun MainShell(model: AppModel) {
    val round by model.game.round.collectAsState()
    val focus = remember { FocusRequester() }
    LaunchedEffect(round?.idx, round?.phase, model.profileViewer.isOpen, model.imageViewer.isOpen) { runCatching { focus.requestFocus() } }
    // the unread badge on the chats tab
    LaunchedEffect(model.signedIn) { while (true) { model.messages.refresh(); model.notifications.refresh(); kotlinx.coroutines.delay(30_000) } }
    // nothing of its own to show yet (the first read of the player is on its way): the boot screen, as on the website
    val booting = model.profile == null && model.loading && round == null && model.mission.round == null
    val swipes = remember { SwipeRegistry() }
    val pager = remember { Pager() }
    val keyScope = androidx.compose.runtime.rememberCoroutineScope()
    val keyGlide = remember { space.affinix.app.ui.KeyGlide(keyScope, 0) }
    // the flag that says a swipe has just changed the tab is cleared here, two frames later, when the page and the bar have both read it (the bar's tab may not change at all: Play -> Quests)
    LaunchedEffect(model.tab) { if (pager.committed) { androidx.compose.runtime.withFrameNanos { }; androidx.compose.runtime.withFrameNanos { }; pager.committed = false } }
    // the pages that are on the screen: the current one, the one that is dragged in beside it and, for a moment after a tap, the one that fades out. Every page is one composition that keeps
    // its place under its own key, so when the page beside becomes the current one nothing is moved or built again (the runtime refused to move a composition: «Cannot insert LayoutNode ...
    // because it already has a parent», which stopped the whole screen after the first swipe)
    val visible = remember { androidx.compose.runtime.mutableStateListOf(model.tab) }
    val shownOnce = remember { booleanArrayOf(false) }
    Box(Modifier.fillMaxSize()) {
    if (booting) BootScreen(t("common.bootWorkspace")) else CompositionLocalProvider(LocalSwipeRegistry provides swipes, space.affinix.app.ui.LocalPager provides pager, space.affinix.app.ui.LocalKeyGlide provides keyGlide) {
    Column(
        Modifier.fillMaxSize()
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { e ->
                // an open picture takes Esc and the arrows (and nothing else gets through while it is up)
                if (model.imageViewer.isOpen) {
                    if (e.type == KeyEventType.KeyDown) when (e.key) {
                        Key.Escape -> { model.imageViewer.close(); return@onPreviewKeyEvent true }
                        Key.DirectionLeft -> { model.imageViewer.go(-1); return@onPreviewKeyEvent true }
                        Key.DirectionRight -> { model.imageViewer.go(1); return@onPreviewKeyEvent true }
                    }
                    return@onPreviewKeyEvent false
                }
                // an open profile card takes Esc (and nothing else gets through while it is up)
                if (model.profileViewer.isOpen) {
                    if (e.type == KeyEventType.KeyDown && e.key == Key.Escape) { model.profileViewer.close(); return@onPreviewKeyEvent true }
                    return@onPreviewKeyEvent false
                }
                // desktop: ← / → choose the left / right design, Enter or Space goes on
                val r = model.game.round.value
                if (r == null || e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    r.phase == Phase.Choose && e.key == Key.DirectionLeft -> { model.vote(0); true }
                    r.phase == Phase.Choose && e.key == Key.DirectionRight -> { model.vote(1); true }
                    r.phase == Phase.Reveal && (e.key == Key.Enter || e.key == Key.Spacebar || e.key == Key.NumPadEnter) -> { model.next(); true }
                    else -> false
                }
            },
    ) {
        val mission = model.mission.round
        val inThread = round == null && mission == null && model.tab == Tab.Chats && model.messages.open != null
        Box(
            // the keyboard is up (a text field has the focus): drags belong to the text, not to the tabs
            Modifier.weight(1f).fillMaxWidth().clipToBounds().pagerSwipe(
                pager, enabled = !inThread && round == null && mission == null && !model.profileViewer.isOpen && !model.imageViewer.isOpen && !Typing.active, barIndex = ::barIndexOf,
            ) { dir ->
                // a swipe goes to the next page inside the screen (the Arena's tabs, the sections ...) and, past its last page, to the next tab of the bar
                swipes.target(dir) ?: barIndexOf(model.tab).takeIf { it >= 0 }?.let { BAR_TABS.getOrNull(it + dir)?.first }?.let { next -> SwipeTarget(next) { model.tab = next } }
            },
        ) {
            if (inThread) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) { Box(Modifier.widthIn(max = 760.dp).fillMaxWidth()) { ThreadScreen(model) } }
            } else if (round != null) {
                // a round is a full-screen flow: it fits the screen and keeps its actions at the bottom (no scrolling to reach «Next»)
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) { Box(Modifier.widthIn(max = 760.dp).fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp)) { DuelScreen(model) } }
            } else {
                // the page that is shown follows the finger ...
                Box(Modifier.fillMaxSize()) {
                    if (mission != null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                        Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp)) { space.affinix.app.ui.MissionScreen(model, mission) }
                    }
                    else {
                        // the first page the screen shows is there at once; a page that a tap brings fades in over the one that leaves
                        val firstShow = !shownOnce[0]
                        androidx.compose.runtime.SideEffect { shownOnce[0] = true }
                        pager.neighbor?.let { if (it !in visible) visible.add(it) }
                        if (model.tab !in visible) visible.add(model.tab)
                        // a swipe has already brought the page in (or there is no motion): only the wanted pages stay, at once, with no cross-fade
                        if (pager.committed || !Motion.enabled) visible.retainAll { it == model.tab || it == pager.neighbor }
                        // ... and the page that comes is drawn beside it (it is later in the list, so on top), so that both are seen while the finger is down
                        for (tab in visible.toList()) androidx.compose.runtime.key(tab) {
                            PageLayer(model, tab, swipes, pager, startFull = firstShow || tab == pager.neighbor || !Motion.enabled) { gone ->
                                if (gone != model.tab && gone != pager.neighbor) visible.remove(gone)
                            }
                        }
                    }
                }
            }
        }
        if (round == null && mission == null && !inThread) BottomBar(model, pager)
    }
    }
    space.affinix.app.ui.ProfileViewerHost(model)
    space.affinix.app.ui.ImageViewerHost(model)
    }
}

/**
 * One page on the screen. Its role is read from the state: the current page (follows the finger), the page beside it (comes in from the side; its blocks are all in place at once, and it
 * does not take part in the swipes of the screen), or a page that is leaving after a tap (fades out where it is). A page keeps its composition when its role changes.
 */
@Composable
private fun PageLayer(model: AppModel, tab: Tab, swipes: SwipeRegistry, pager: Pager, startFull: Boolean, onGone: (Tab) -> Unit) {
    val isCurrent = tab == model.tab
    val isBeside = !isCurrent && tab == pager.neighbor
    val role = if (isCurrent) 2 else if (isBeside) 1 else 0
    val before = remember { intArrayOf(role) }
    val roleBefore = before[0]
    androidx.compose.runtime.SideEffect { before[0] = role }
    // dragged in beside the current page and then not wanted (the swipe was brought back): it is gone at once, from where it is, not faded
    if (role == 0 && roleBefore == 1) { androidx.compose.runtime.SideEffect { onGone(tab) }; return }
    val fadeIn = remember { androidx.compose.animation.core.Animatable(if (startFull) 1f else 0f) }
    val instant = pager.committed || !Motion.enabled
    LaunchedEffect(role != 0, instant) {
        val to = if (role != 0) 1f else 0f
        if (instant) fadeIn.snapTo(to) else fadeIn.animateTo(to, tween(260))
        if (to == 0f) onGone(tab)
    }
    Box(
        Modifier.fillMaxSize()
            .graphicsLayer {
                alpha = fadeIn.value * (if (isCurrent) (1f - pager.dim) * pager.hold else 1f)
                translationX = if (isCurrent) pager.dx else if (isBeside) pager.dx + pager.dir * pager.width else 0f
            }
            // the page that leaves darkens a little: a cue of depth
            .drawWithContent { drawContent(); if (isCurrent && pager.neighbor != null) drawRect(Color.Black.copy(alpha = .24f * pager.amount)) },
    ) {
        CompositionLocalProvider(LocalSwipeRegistry provides (if (isCurrent) swipes else null), LocalPreviewTab provides (if (isCurrent) null else tab), LocalStill provides !isCurrent) {
            Page(model, tab)
        }
    }
}

/** A page of the shell: the screen of a tab on its own scroll. */
@Composable
private fun Page(model: AppModel, tab: Tab) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp)) { TabScreen(model, tab) }
    }
}

/** The screen of a tab. */
@Composable
private fun TabScreen(model: AppModel, tab: Tab) {
    when (tab) {
        Tab.Play -> HomeScreen(model)
        Tab.Quests -> QuestsScreen(model)
        Tab.Feed -> FeedScreen(model)
        Tab.Chats -> ChatsListScreen(model)
        Tab.People -> PeopleScreen(model)
        Tab.Rankings -> RankingsScreen(model)
        Tab.Profile -> ProfileScreen(model)
        Tab.Notifications -> NotificationsScreen(model)
        Tab.Search -> SearchScreen(model)
        Tab.Research -> space.affinix.app.ui.ResearchScreen(model)
        Tab.Admin -> space.affinix.app.ui.AdminScreen(model)
    }
}
