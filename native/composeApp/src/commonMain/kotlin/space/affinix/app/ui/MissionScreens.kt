package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.CrowdItem
import space.affinix.app.store.MissionModel
import space.affinix.app.store.MissionResult
import space.affinix.app.store.MissionRound
import space.affinix.app.store.MissionTest
import space.affinix.app.store.Phase
import kotlin.math.roundToInt

@Composable
private fun optionLabel(item: CrowdItem): String = item.label?.takeIf { it.isNotBlank() } ?: t("crowd.optionN", "n" to ('A' + item.pos).toString())

/** The Stage-2 block under the Daily Challenge: locked until the day's duels are done, then a short list of other people's tests that need an answer. */
@Composable
fun MissionPlate(model: AppModel) {
    val m = model.mission
    LaunchedEffect(model.dailyComplete) { if (model.dailyComplete) m.loadQueue() }
    Plate(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Ico("results", color = C.signalHi, size = 20.dp)
            Txt(t("crowd.mission.stage2"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        val q = m.queue
        when {
            !model.dailyComplete -> Txt(t("crowd.mission.locked"), 14, color = C.g400)
            m.queueError == "pending" -> Txt(t("crowd.mission.unavailable"), 14, color = C.g400)
            m.queueError != null && q == null -> Txt(t("crowd.err.generic"), 14, color = C.g400)
            q == null -> Txt(t("common.loading"), 13, color = C.g500)
            q.tests.isEmpty() -> {
                Txt(t("crowd.mission.none"), 14, color = C.g400); Spacer(Modifier.height(10.dp))
                KeyButton(t("crowd.mission.create"), { model.research.section = space.affinix.app.store.ResearchModel.Section.Crowd; model.tab = space.affinix.app.store.Tab.Research }, compact = true)
            }
            else -> {
                Txt(t("crowd.mission.available", "n" to q.available, "cap" to q.cap), 13, color = C.g400)
                q.tests.forEach { x ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Txt(x.title, 15, FontWeight.ExtraBold, C.g50, maxLines = 2)
                            Txt(t("crowd.q.${x.dim}") + (x.owner?.name?.let { " · " + t("crowd.mission.by", "name" to it) } ?: ""), 12, color = C.g500, maxLines = 1)
                        }
                        KeyButton(t("crowd.mission.start"), { m.start(x) }, lit = true, compact = true)
                    }
                }
                Spacer(Modifier.height(6.dp))
                Txt(t("crowd.mission.xpLeft", "xp" to q.missionXp, "cap" to q.cap), 12, FontWeight.Bold, C.g300)
                Spacer(Modifier.height(4.dp))
                Bar((q.missionXp / q.cap.toFloat()).coerceIn(0f, 1f))
                if (q.missionXp >= q.cap) Txt(t("crowd.mission.capped"), 12, color = C.g500)
            }
        }
    }
}

/** One option: the author's picture (with its caption when it has both) or the text alone. */
@Composable
private fun OptionArt(model: AppModel, item: CrowdItem) {
    val url = model.mission.imageUrl(item.path)
    LaunchedEffect(url) { model.ensureUrlImage(url) }
    val bmp = url?.let { model.images[it] }
    Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(C.g800), contentAlignment = Alignment.Center) {
        if (bmp != null) Image(bmp, null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit)
        else if (item.path != null) Txt(t("common.loading"), 12, color = C.g500)
        else Txt(optionLabel(item), 22, FontWeight.ExtraBold, C.g50, align = TextAlign.Center, modifier = Modifier.padding(12.dp))
        if (item.path != null && !item.label.isNullOrBlank()) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(C.canvas.copy(alpha = .7f)).padding(6.dp)) {
            Txt(item.label, 13, FontWeight.Bold, C.g50, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun MissionScreen(model: AppModel, r: MissionRound) {
    val m = model.mission
    if (r.phase == Phase.Summary) { MissionSummary(model, r); return }
    val d = r.duel ?: return
    val items = r.test.items.associateBy { it.id }
    val left = items[if (d.swap) d.b else d.a]; val right = items[if (d.swap) d.a else d.b]
    val last = r.last.takeIf { r.phase == Phase.Reveal }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { m.end() })
            Column(Modifier.weight(1f)) {
                Txt(r.test.title, 16, FontWeight.ExtraBold, C.g50, maxLines = 1)
                Txt(t("crowd.mission.tag") + r.test.owner?.name?.let { " · " + t("crowd.mission.by", "name" to it) }.orEmpty(), 12, color = C.g500, maxLines = 1)
            }
            Txt("${r.idx + 1} / ${r.duels.size}", 13, FontWeight.Bold, C.g300)
        }
        Bar((r.idx + if (r.phase == Phase.Reveal) 1 else 0) / r.duels.size.toFloat())
        Txt(t("crowd.q.${r.test.dim}"), 18, FontWeight.ExtraBold, C.g50, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf(left to 0, right to 1).forEach { (item, side) ->
                if (item == null) return@forEach
                val picked = last != null && last.side == side
                Column(
                    Modifier.weight(1f).then(if (r.phase == Phase.Choose) Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { m.vote(side) } else Modifier),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    OptionArt(model, item)
                    if (last != null) {
                        val tl = last.tally
                        val votes = tl?.let { if (item.id == last.duel.a) it.first else it.second }
                        val total = tl?.let { it.first + it.second } ?: 0
                        if (last.pending) Txt(t("crowd.mission.sending"), 12, color = C.g500, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                        else if (last.error == null) {
                            if (picked) Chip(t("arena.console.pick"), Tone.Signal, Modifier.align(Alignment.CenterHorizontally))
                            if (tl != null && total > 1) {
                                val pct = (votes!! * 100.0 / total).roundToInt()
                                Txt("$pct%", 20, FontWeight.ExtraBold, C.g50, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                                Bar(pct / 100f)
                                Txt("${t("arena.console.votes")}: $votes", 11, color = C.g500, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                            } else Txt(if (tl != null) t("crowd.mission.firstOnes") else "", 11, color = C.g500, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
        if (last != null) {
            when {
                last.pending -> Unit
                last.error != null -> {
                    val terminal = last.error in MissionModel.TERMINAL
                    Txt(if (terminal) t(if (last.error == "pending") "crowd.err.pending" else "crowd.mission.closed") else t("crowd.mission.sendFailed"), 13, FontWeight.Medium, C.bad)
                    if (!terminal) KeyButton(t("crowd.mission.retry"), { m.retry() }, Modifier.fillMaxWidth()) else KeyButton(t("arena.console.leave"), { m.end() }, Modifier.fillMaxWidth())
                }
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Chip("+${last.xp} ${t("app.xp")}", Tone.Signal)
                        if (last.bonus > 0) Chip(t("crowd.mission.bonus", "xp" to last.bonus), Tone.Ok)
                        if (last.capped) Txt(t("crowd.mission.capped"), 12, color = C.g500, modifier = Modifier.weight(1f))
                    }
                    KeyButton(t("arena.console.next"), { m.next() }, Modifier.fillMaxWidth(), lit = true, big = true)
                }
            }
        }
    }
}

@Composable
private fun MissionSummary(model: AppModel, r: MissionRound) {
    val m = model.mission
    val owner = r.test.owner?.name ?: t("feed.unknownAuthor")
    val answered = r.results.count { it.error == null && !it.pending }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Plate(Modifier.fillMaxWidth(), radius = 18, pad = 22) {
            Txt(t("crowd.mission.doneTitle"), 24, FontWeight.ExtraBold, C.g50)
            Spacer(Modifier.height(4.dp))
            Txt(t("crowd.mission.doneBody", "name" to owner), 14, color = C.g400)
            Spacer(Modifier.height(10.dp))
            Txt("+${r.xp} ${t("app.xp")}", 40, FontWeight.ExtraBold, C.signalHi)
            Txt("${t("crowd.mission.answered")}: $answered", 13, FontWeight.Bold, C.g300)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KeyButton(t("crowd.mission.report"), { m.report(r.test) }, Modifier.weight(1f), enabled = !m.reported)
            KeyButton(t("crowd.mission.lobby"), { m.end() }, Modifier.weight(1f), lit = true)
        }
        if (m.reported) Txt(t("crowd.mission.reported"), 12, FontWeight.Medium, C.ok)
    }
}
