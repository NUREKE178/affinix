package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import space.affinix.app.i18n.t
import space.affinix.app.net.Duel
import space.affinix.app.store.AppModel
import space.affinix.app.store.Phase
import space.affinix.app.store.Result
import space.affinix.app.store.Round

/** One of the two designs of a duel. [pct] is the share of earlier voters who chose it (shown once you have answered). */
@Composable
private fun SpecimenCard(
    bitmap: ImageBitmap?,
    failed: Boolean,
    label: String,
    onClick: (() -> Unit)?,
    picked: Boolean,
    pct: Int?,
    note: String?,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth()
                .then(if (onClick != null) Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button, onClick = onClick) else Modifier)
                .well(16.dp)
                .border(if (picked) 2.dp else 0.dp, if (picked) C.signal else Color.Transparent, shape)
                .padding(10.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (bitmap != null) {
                Image(bitmap, label, Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat() / bitmap.height.toFloat()), contentScale = ContentScale.Fit)
            } else {
                Box(Modifier.fillMaxWidth().aspectRatio(1.3f), contentAlignment = Alignment.Center) {
                    Txt(if (failed) t("app.imageFailed") else t("common.loading"), 13, color = C.g500, align = TextAlign.Center)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(label, 13, FontWeight.Bold, C.g400)
            if (picked) Chip(t("arena.console.pick"), Tone.Signal)
            if (pct != null) Chip(t("arena.console.stimWin", "pct" to pct), Tone.Neutral)
        }
        note?.let { Txt(it, 12, FontWeight.Medium, C.g500) }
    }
}

private fun pctOf(r: Result, canonical: Int): Int? {
    val tally = r.tally ?: return null
    val total = tally.total
    if (total <= 0) return null
    val n = if (canonical == 0) tally.a else tally.b
    return (n * 100f / total).roundToInt()
}

@Composable
fun DuelScreen(model: AppModel) {
    val round by model.game.round.collectAsState()
    val r = round ?: return
    if (r.phase == Phase.Summary) { SummaryScreen(model, r); return }
    val duel = r.duel ?: return
    androidx.compose.runtime.LaunchedEffect(duel.id) { model.ensureImages(duel) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Header(model, r)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Chip(t("arena.family.${duel.family}"), Tone.Info)
            if (duel.objective) Chip(t("arena.console.eyeTag"), Tone.Warn)
            if (duel.daily) Chip(t("arena.console.dailyTag"), Tone.Neutral)
            if (duel.repeat) Chip(t("arena.console.repeat"), Tone.Neutral)
        }
        Txt(t("arena.q.${duel.dim}"), 22, FontWeight.ExtraBold, C.g50)

        val revealed = r.phase == Phase.Reveal
        val last = r.last
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val wide = maxWidth >= 640.dp
            @Composable
            fun Side(side: Int, m: Modifier) {
                val canonical = if (duel.swap) 1 - side else side
                val idx = if (canonical == 0) duel.a else duel.b
                val key = model.imageKey(duel, idx)
                SpecimenCard(
                    bitmap = model.images[key],
                    failed = model.imageFailed[key] == true,
                    label = t("arena.console.option", "n" to (side + 1)),
                    onClick = if (!revealed) ({ model.vote(side) }) else null,
                    picked = revealed && last?.side == side,
                    pct = if (revealed && last != null) pctOf(last, canonical) else null,
                    note = if (revealed && duel.objective) duel.specimens.getOrNull(canonical)?.contrast?.let { t("arena.console.contrast", "v" to it) } else null,
                    modifier = m,
                )
            }
            if (wide) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) { Side(0, Modifier.weight(1f)); Side(1, Modifier.weight(1f)) }
            else Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) { Side(0, Modifier.fillMaxWidth()); Side(1, Modifier.fillMaxWidth()) }
        }

        if (revealed && last != null) Reveal(last)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!revealed) {
                KeyButton(t("arena.console.skip"), model::skip, Modifier.weight(1f))
            } else {
                KeyButton(t("arena.console.next"), model::next, Modifier.weight(1f), lit = true, big = true)
            }
            KeyButton(t("arena.console.leave"), model::endRound)
        }
    }
}

@Composable
private fun Header(model: AppModel, r: Round) {
    val done = r.idx + (if (r.phase == Phase.Reveal) 1 else 0)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(t("arena.console.progress", "n" to (r.idx + 1), "total" to r.duels.size), 14, FontWeight.Bold, C.g300, Modifier.weight(1f))
            if (r.combo >= 2) Chip("${t("app.xp")} ${r.xp} · x${r.combo}", Tone.Signal) else Chip("${t("app.xp")} ${r.xp}", Tone.Neutral)
        }
        Bar(done / r.duels.size.toFloat())
    }
}

@Composable
private fun Reveal(r: Result) {
    Plate(Modifier.fillMaxWidth(), radius = 14, pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(if (r.xp > 0) "+${r.xp} ${t("app.xp")}" else t("arena.console.repeat"), 20, FontWeight.ExtraBold, if (r.xp > 0) C.g50 else C.g400)
            if (r.bonus > 0) Chip(t("arena.console.flowBonus", "n" to r.bonus), Tone.Signal)
            if (r.pioneer) Chip(t("arena.console.pioneer", "xp" to 5), Tone.Info)
        }
        val chips = buildList<Pair<String, Tone>> {
            r.eye?.let { add((if (it) t("arena.console.eyeRight") else t("arena.console.eyeWrong")) to (if (it) Tone.Ok else Tone.Bad)) }
            r.crowd?.let { add((if (it) t("arena.console.withCrowd") else t("arena.console.againstCrowd")) to (if (it) Tone.Ok else Tone.Warn)) }
        }
        if (chips.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { chips.forEach { Chip(it.first, it.second) } }
        }
        if (r.tally == null || r.tally.total == 0) {
            Spacer(Modifier.height(8.dp))
            Txt(if (r.tally == null) t("arena.console.communityOff") else t("arena.console.communityEmpty"), 12, color = C.g500)
        }
    }
}
