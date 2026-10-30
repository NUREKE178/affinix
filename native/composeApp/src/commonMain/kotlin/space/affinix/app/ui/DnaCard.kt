package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Taste
import space.affinix.app.Rules
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val SHOW_SCALE = 1.8 // real leans rarely reach +-1; the faders stretch them

/** One trait: the two poles, the lean as a number and a fader with a knob. */
@Composable
private fun Fader(trait: String, lean: Double) {
    val v = max(-1.0, min(1.0, lean * SHOW_SCALE))
    val strength = Taste.strength(lean)
    val pole = if (lean >= 0) "hi" else "lo"
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Txt(t("arena.traits.$trait.lo"), 12, if (strength != "none" && lean < 0) FontWeight.ExtraBold else FontWeight.Medium, if (strength != "none" && lean < 0) C.signalHi else C.g500, Modifier.weight(1f), maxLines = 1)
            Txt((if (lean >= 0) "+" else "−") + ((abs(lean) * 100).toInt() / 100.0).toString().padEnd(4, '0').take(4), 12, FontWeight.Bold, C.g300)
            Txt(t("arena.traits.$trait.hi"), 12, if (strength != "none" && lean > 0) FontWeight.ExtraBold else FontWeight.Medium, if (strength != "none" && lean > 0) C.signalHi else C.g500, Modifier.weight(1f), align = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1)
        }
        // the track: a sunken bar, the middle mark, the lit part from the middle to the knob
        Layout(
            content = {
                Box(Modifier.fillMaxWidth().height(8.dp).well(6.dp))
                Box(Modifier.height(8.dp).lit(6.dp))
                Box(Modifier.size(16.dp).background(C.g50, CircleShape))
            },
            modifier = Modifier.fillMaxWidth().height(16.dp),
        ) { measurables, c ->
            val w = c.maxWidth
            val knob = 16.dp.roundToPx()
            val pos = (((v + 1) / 2) * (w - knob)).toInt()
            val mid = w / 2
            val litLeft = min(pos + knob / 2, mid); val litW = abs(pos + knob / 2 - mid)
            val track = measurables[0].measure(c.copy(minWidth = w, maxWidth = w))
            val lit = measurables[1].measure(c.copy(minWidth = litW, maxWidth = litW, minHeight = 0))
            val dot = measurables[2].measure(c.copy(minWidth = 0, maxWidth = knob, minHeight = 0))
            layout(w, knob) {
                track.placeRelative(0, (knob - track.height) / 2)
                lit.placeRelative(litLeft, (knob - lit.height) / 2)
                dot.placeRelative(pos, 0)
            }
        }
        Txt(
            if (strength == "none") t("arena.dna.noLean") else t("arena.dna.lean.$strength", "pole" to t("arena.traits.$trait.$pole").lowercase()),
            12, color = C.g500,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DnaCard(model: AppModel) {
    LaunchedEffect(model.profile?.votes) { model.loadDna() }
    val scope = rememberCoroutineScope()
    var dim by remember { mutableStateOf("all") }
    var shared by remember { mutableStateOf<String?>(null) }
    val d = model.dna
    val current = if (d == null) null else if (dim == "all") d.all else d.byDim[dim]
    Plate(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Txt(t("arena.dna.title"), 16, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
            if (current != null) Txt("${current.n} ${t("arena.dna.votesUnit")}", 12, FontWeight.Bold, C.g500)
        }
        Spacer(Modifier.height(10.dp))
        when {
            d == null && model.dnaFailed -> {
                Txt(t("app.noNetwork"), 13, color = C.g400); Spacer(Modifier.height(8.dp)); KeyButton(t("people.retry"), { model.loadDna() }, compact = true)
            }
            d == null -> Txt(t("common.loading"), 13, color = C.g500)
            d.all.n == 0 -> Txt(t("arena.dna.empty"), 13, color = C.g400)
            else -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val dims = listOf("all") + space.affinix.app.Rules.DIMENSIONS.filter { it in d.byDim }
                    for (x in dims) Chip(
                        if (x == "all") t("arena.dna.allQuestions") else t("builder.dimensions.$x.label"),
                        if (x == dim) Tone.Signal else Tone.Neutral,
                        Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { dim = x },
                    )
                }
                Spacer(Modifier.height(14.dp))
                val lean = Taste.leanOf(current ?: Taste.Dna())
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { Taste.TRAITS.forEachIndexed { i, tr -> Fader(tr, lean[i]) } }
                Taste.standout(d)?.let {
                    Spacer(Modifier.height(12.dp))
                    Txt(t("arena.dna.standout", "dim" to t("builder.dimensions.${it.dim}.label"), "pole" to t("arena.traits.${it.trait}.${if (it.delta >= 0) "hi" else "lo"}").lowercase()), 12, color = C.g400)
                }
                Spacer(Modifier.height(16.dp))
                Archetype(model, d.all) { text -> scope.launch { shared = model.feed.publish(text) ?: "arena.share.done" } }
                shared?.let { Spacer(Modifier.height(6.dp)); Txt(t(it), 12, FontWeight.Medium, C.g400) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Archetype(model: AppModel, all: Taste.Dna, share: (String) -> Unit) {
    Well(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(t("arena.dna.typeTitle"), 12, FontWeight.Bold, C.g400)
            if (all.n < Taste.MIN_VOTES_FOR_TYPE) {
                Txt(t("arena.dna.calibrating"), 20, FontWeight.ExtraBold, C.g50)
                Txt(t("arena.dna.calibratingBody", "n" to Taste.MIN_VOTES_FOR_TYPE), 13, color = C.g400)
                Bar(all.n / Taste.MIN_VOTES_FOR_TYPE.toFloat())
                Txt("${all.n} / ${Taste.MIN_VOTES_FOR_TYPE}", 12, FontWeight.Bold, C.g300)
            } else {
                val lean = Taste.leanOf(all)
                val type = Taste.archetypeOf(lean)
                val tops = Taste.topTraits(lean, 3).filter { Taste.strength(it.lean) != "none" }
                Txt(t("arena.archetype.${type.id}.name"), 20, FontWeight.ExtraBold, C.g50)
                Txt(t("arena.archetype.${type.id}.body"), 13, color = C.g300)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    tops.forEach { Chip(t("arena.traits.${it.trait}.${if (it.lean >= 0) "hi" else "lo"}")) }
                }
                val conf = Taste.confidenceOf(all)
                Txt("${t("arena.dna.basedOn", "n" to all.n)} · ${t(if (conf >= 1.0) "arena.dna.confFull" else if (conf >= 0.5) "arena.dna.confGood" else "arena.dna.confLow")}", 12, color = C.g500)
                val traitsText = tops.map { t("arena.traits.${it.trait}.${if (it.lean >= 0) "hi" else "lo"}").lowercase() }.joinToString(", ")
                val level = Rules.levelForXp(model.profile?.xp ?: 0L)
                val shareText = t("arena.share.text", "type" to t("arena.archetype.${type.id}.name"), "traits" to traitsText, "level" to level, "streak" to (model.profile?.streak ?: 0))
                KeyButton(t("arena.share.cta"), { share(shareText) }, compact = true)
            }
        }
    }
}
