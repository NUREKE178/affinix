package space.affinix.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import space.affinix.app.ui.C
import space.affinix.app.ui.DuelScreen
import space.affinix.app.ui.HomeScreen
import space.affinix.app.ui.LocalFonts
import space.affinix.app.ui.LoginScreen
import space.affinix.app.ui.ProfileScreen
import space.affinix.app.ui.RankingsScreen
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
        }
    }
}

@Composable
private fun MainShell(model: AppModel) {
    val round by model.game.round.collectAsState()
    val focus = remember { FocusRequester() }
    LaunchedEffect(round?.idx, round?.phase) { runCatching { focus.requestFocus() } }
    Column(
        Modifier.fillMaxSize()
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { e ->
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
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp)) {
                if (round != null) DuelScreen(model)
                else when (model.tab) {
                    Tab.Play -> HomeScreen(model)
                    Tab.Rankings -> RankingsScreen(model)
                    Tab.Profile -> ProfileScreen(model)
                }
            }
        }
        if (round == null) TabBar(model)
    }
}

@Composable
private fun TabBar(model: AppModel) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Row(Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp).plate(18.dp).padding(6.dp)) {
            for ((tab, label) in listOf(Tab.Play to t("arena.tabs.play"), Tab.Rankings to t("arena.tabs.rankings"), Tab.Profile to t("arena.tabs.profile"))) {
                val on = model.tab == tab
                Box(
                    Modifier.weight(1f)
                        .then(if (on) Modifier.key(12.dp) else Modifier)
                        .clickable(remember { MutableInteractionSource() }, null, role = Role.Tab) { model.tab = tab }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Txt(label, 14, if (on) FontWeight.ExtraBold else FontWeight.Medium, if (on) C.g50 else C.g500, maxLines = 1) }
            }
        }
    }
}
