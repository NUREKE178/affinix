package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
fun SummaryScreen(model: AppModel, r: Round) {
    val answered = r.results.count { !it.repeat() }
    val eyeAll = r.results.filter { it.eye != null }
    val eyeOk = eyeAll.count { it.eye == true }
    val avg = if (r.results.isEmpty()) 0.0 else r.results.sumOf { it.ms } / r.results.size / 1000.0
    val avgText = ((avg * 10).roundToInt() / 10.0).toString() + " s"
    val entry = if (r.set > 0) model.sets.firstOrNull { it.n == r.set } else null
    val prog = space.affinix.app.Rules.levelProgress(model.profile?.xp ?: 0)
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var claimNote by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    // the figures scroll; the two keys of the end stay at the bottom, where the thumb is
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (r.mode == Mode.Challenge) MatchBlock(model, r)
            Box(Modifier.fillMaxWidth()) {
                Column(
                    Modifier.fillMaxWidth().enter().plate(22.dp).clip(RoundedCornerShape(22.dp))
                        .drawBehind { drawRect(Brush.radialGradient(0f to C.signal.copy(alpha = .24f), 1f to Color.Transparent, center = Offset(size.width / 2f, size.height * .32f), radius = size.width * .75f)) }
                        .padding(horizontal = 22.dp, vertical = 26.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Txt(
                        when {
                            entry != null -> t(if (entry.done) "arena.marathon.setDoneTitle" else "arena.marathon.setPartTitle", "n" to r.set)
                            r.mode == Mode.Daily -> t("arena.summary.dailyTitle")
                            r.mode == Mode.Challenge -> t("arena.match.roundTitle")
                            else -> t("arena.summary.title")
                        },
                        T.Heading, FontWeight.ExtraBold, C.g200, align = TextAlign.Center,
                    )
                    CountText(r.xp, 58, FontWeight.ExtraBold, C.signalHi, prefix = "+", suffix = " ${t("app.xp")}")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Chip("${t("arena.level")} ${prog.level}", Tone.Signal)
                        Chip(t("arena.rank.${space.affinix.app.Rules.rankForLevel(prog.level)}"), Tone.Neutral)
                    }
                    Spacer(Modifier.height(4.dp))
                    Bar(prog.ratio)
                    Txt("${prog.into} / ${prog.span} ${t("app.xp")}", T.Small - 1, FontWeight.Medium, C.g400)
                }
                Confetti(Modifier.matchParentSize(), key = r)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(t("arena.summary.answers"), grouped(rememberCountUp(answered)), Modifier.weight(1f), t("arena.summary.answersHint", "n" to r.duels.size))
                StatTile(t("arena.summary.combo"), grouped(rememberCountUp(r.bestCombo, 700)), Modifier.weight(1f), t("arena.summary.comboHint"))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(t("arena.summary.eye"), if (eyeAll.isEmpty()) "–" else "$eyeOk/${eyeAll.size}", Modifier.weight(1f), t("arena.summary.eyeHint"))
                StatTile(t("arena.summary.speed"), avgText, Modifier.weight(1f), t("arena.summary.speedHint"))
            }
            if (r.set == 0) ChallengeShareCard(model, r, own = r.mode == Mode.Challenge)
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
        }
        ActionDock {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KeyButton(t("arena.summary.done"), model::endRound, Modifier.weight(1f))
                if (entry == null) KeyButton(t("arena.summary.again"), { model.endRound(); model.startFree() }, Modifier.weight(1f), lit = true, big = true)
            }
        }
    }
}

private fun space.affinix.app.store.Result.repeat() = duel.repeat
