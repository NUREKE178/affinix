package space.affinix.app

import androidx.compose.animation.Crossfade
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
    LaunchedEffect(round?.idx, round?.phase, model.profileViewer.isOpen) { runCatching { focus.requestFocus() } }
    // the unread badge on the chats tab
    LaunchedEffect(model.signedIn) { while (true) { model.messages.refresh(); model.notifications.refresh(); kotlinx.coroutines.delay(30_000) } }
    // nothing of its own to show yet (the first read of the player is on its way): the boot screen, as on the website
    val booting = model.profile == null && model.loading && round == null && model.mission.round == null
    val swipes = remember { SwipeRegistry() }
    val pager = remember { Pager() }
    // the pages change without the cross-fade when a swipe has brought the next page in beside the current one (it is already there)
    var paged by remember { androidx.compose.runtime.mutableStateOf(false) }
    LaunchedEffect(pager.committed) { if (pager.committed) paged = true else { kotlinx.coroutines.delay(80); paged = false } }
    Box(Modifier.fillMaxSize()) {
    if (booting) BootScreen(t("common.bootWorkspace")) else CompositionLocalProvider(LocalSwipeRegistry provides swipes) {
    Column(
        Modifier.fillMaxSize()
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { e ->
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
                pager, enabled = !inThread && round == null && mission == null && !model.profileViewer.isOpen && !Typing.active, barIndex = ::barIndexOf,
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
                Box(Modifier.fillMaxSize().graphicsLayer { translationX = pager.dx; alpha = (1f - pager.dim) * pager.hold }, contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp)) {
                        if (mission != null) space.affinix.app.ui.MissionScreen(model, mission)
                        else Crossfade(model.tab, animationSpec = tween(if (Motion.enabled && !paged) 260 else 0), label = "screen") { tab -> TabScreen(model, tab) }
                    }
                }
                // ... and the page that comes is drawn beside it, so that both are seen while the finger is down
                pager.neighbor?.let { next ->
                    Box(Modifier.fillMaxSize().graphicsLayer { translationX = pager.dx + pager.dir * pager.width }, contentAlignment = Alignment.TopCenter) {
                        androidx.compose.runtime.CompositionLocalProvider(LocalSwipeRegistry provides null, LocalPreviewTab provides next) {
                            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp)) { TabScreen(model, next) }
                        }
                    }
                }
            }
        }
        if (round == null && mission == null && !inThread) BottomBar(model, pager)
    }
    }
    space.affinix.app.ui.ProfileViewerHost(model)
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
