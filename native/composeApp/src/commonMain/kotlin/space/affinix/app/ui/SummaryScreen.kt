package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Mode
import space.affinix.app.store.Round

@Composable
private fun Tile(title: String, value: String, hint: String, modifier: Modifier = Modifier) {
    Plate(modifier, radius = 14, pad = 14) {
        Txt(title, 12, FontWeight.Medium, C.g400, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Txt(value, 24, FontWeight.ExtraBold, C.g50, maxLines = 1)
        Txt(hint, 12, color = C.g500, maxLines = 2)
    }
}

@Composable
fun SummaryScreen(model: AppModel, r: Round) {
    val answered = r.results.count { !it.repeat() }
    val eyeAll = r.results.filter { it.eye != null }
    val eyeOk = eyeAll.count { it.eye == true }
    val avg = if (r.results.isEmpty()) 0.0 else r.results.sumOf { it.ms } / r.results.size / 1000.0
    val avgText = ((avg * 10).roundToInt() / 10.0).toString() + " s"
    val entry = if (r.set > 0) model.sets.firstOrNull { it.n == r.set } else null
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var claimNote by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Plate(Modifier.fillMaxWidth(), radius = 18, pad = 22) {
            Txt(
                when {
                    entry != null -> t(if (entry.done) "arena.marathon.setDoneTitle" else "arena.marathon.setPartTitle", "n" to r.set)
                    r.mode == Mode.Daily -> t("arena.summary.dailyTitle")
                    else -> t("arena.summary.title")
                },
                24, FontWeight.ExtraBold, C.g50, align = TextAlign.Start,
            )
            Spacer(Modifier.height(6.dp))
            Txt("+${r.xp} ${t("app.xp")}", 40, FontWeight.ExtraBold, C.signalHi)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Tile(t("arena.summary.answers"), "$answered", t("arena.summary.answersHint", "n" to r.duels.size), Modifier.weight(1f))
            Tile(t("arena.summary.combo"), "${r.bestCombo}", t("arena.summary.comboHint"), Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Tile(t("arena.summary.eye"), if (eyeAll.isEmpty()) "–" else "$eyeOk/${eyeAll.size}", t("arena.summary.eyeHint"), Modifier.weight(1f))
            Tile(t("arena.summary.speed"), avgText, t("arena.summary.speedHint"), Modifier.weight(1f))
        }
        if (entry != null) {
            val th = model.theme
            Plate(Modifier.fillMaxWidth(), radius = 14, pad = 14) {
                Txt(if (entry.done) t("arena.marathon.setNoteDone") else t("arena.marathon.setNoteLeft", "n" to (entry.size - entry.votes)), 13, color = C.g300)
                Spacer(Modifier.height(4.dp))
                Txt(t("arena.marathon.themeLine", "family" to t("arena.family.${th.family}"), "votes" to th.votes, "goal" to th.goal), 13, color = C.g400)
                claimNote?.let { Spacer(Modifier.height(4.dp)); Txt(t(it), 12, FontWeight.Medium, C.bad) }
            }
            if (entry.done && !entry.claimed) KeyButton(t("arena.marathon.claim", "xp" to entry.bonus), { scope.launch { claimNote = model.claim(space.affinix.app.Rules.setQuestId(entry.n)) } }, Modifier.fillMaxWidth(), lit = true)
            if (th.done && !th.claimed) KeyButton(t("arena.marathon.claimTheme", "xp" to th.bonus), { scope.launch { claimNote = model.claim(space.affinix.app.Rules.THEME_QUEST) } }, Modifier.fillMaxWidth())
            if (!entry.done) KeyButton(t("arena.marathon.setContinue"), { model.endRound(); model.startSet(entry.n) }, Modifier.fillMaxWidth(), lit = true, big = true)
            else if (entry.n + 1 in space.affinix.app.Rules.EXTRA_SETS && model.setOpen(entry.n + 1)) KeyButton(t("arena.marathon.nextSet", "n" to entry.n + 1), { model.endRound(); model.startSet(entry.n + 1) }, Modifier.fillMaxWidth(), big = true)
        }
        if (model.game.pendingCount > 0) Chip(t("arena.sync.pending", "n" to model.game.pendingCount), space.affinix.app.ui.Tone.Warn)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KeyButton(t("arena.summary.done"), model::endRound, Modifier.weight(1f))
            if (entry == null) KeyButton(t("arena.summary.again"), { model.endRound(); model.startFree() }, Modifier.weight(1f), lit = true, big = true)
        }
    }
}

private fun space.affinix.app.store.Result.repeat() = duel.repeat
