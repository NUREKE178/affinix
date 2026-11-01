package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.affinix.app.Rules
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.StyleStats
import space.affinix.app.store.StylesModel
import space.affinix.app.store.StylesModel.Status
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

private const val SCALE = 0.3 // a 30-point lift fills half of the bar's track

private fun pts(v: Double) = (if (v >= 0) "+" else "−") + abs((v * 100).roundToInt())

/** "What people love": the first page of the marketers area, as on the website. */
@Composable
internal fun StylesScreen(model: AppModel) {
    val s = model.styles
    LaunchedEffect(Unit) { if (s.status == Status.Idle) s.load() }
    val view = remember(s.data, s.country, s.scopeKind) { s.view() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("styles.title"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f, fill = false))
            Chip(t("styles.pro"), Tone.Signal)
        }
        Txt(t("styles.subtitle"), 12, color = C.g500)
        Filters(s)
        when (s.status) {
            Status.Idle, Status.Loading -> Txt(t("common.loading"), 14, color = C.g500)
            Status.Error -> Plate(Modifier.fillMaxWidth()) {
                val pending = s.error == "updatePending"
                Txt(t(if (pending) "styles.pendingTitle" else "styles.errorTitle"), 15, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t(if (pending) "styles.pendingBody" else "styles.errorBody"), 13, color = C.g400)
                if (!pending) { Spacer(Modifier.height(10.dp)); KeyButton(t("common.retry"), { s.load(force = true) }, compact = true) }
            }
            Status.Ready -> if (view != null) {
                if (!view.enough) Plate(Modifier.fillMaxWidth()) {
                    Txt(t("styles.emptyTitle"), 15, FontWeight.Bold, C.g50)
                    Spacer(Modifier.height(4.dp))
                    Txt(t("styles.emptyBody", "n" to view.duels), 13, color = C.g400)
                } else Ready(model, s, view)
            }
        }
    }
}

@Composable
private fun ChipRow(label: String, items: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 11, FontWeight.Medium, C.g500)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items.forEach { (id, text) ->
                Chip(text, if (id == selected) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { onPick(id) })
            }
        }
    }
}

@Composable
private fun Filters(s: StylesModel) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChipRow(t("styles.question"), Rules.DIMENSIONS.map { it to t("builder.dimensions.$it.label") }, s.dim) { s.pickDim(it) }
            ChipRow(t("styles.family"), listOf("all" to t("styles.all")) + Rules.FAMILY_IDS.map { it to t("arena.family.$it") }, s.family) { s.pickFamily(it) }
            ChipRow(t("styles.scope.label"), listOf("all" to t("styles.scope.all"), "today" to t("styles.scope.today"), "classic" to t("styles.scope.classic")), s.scopeKind) { s.pickScope(it) }
            ChipRow(t("styles.period"), listOf("this" to t("styles.thisMonth"), "last" to t("styles.lastMonth")), if (s.lastMonth) "last" else "this") { s.pickSeason(it == "last") }
            val countries = s.data?.countries.orEmpty()
            if (countries.isNotEmpty()) {
                ChipRow(t("styles.audience"), listOf("all" to t("styles.allCountries")) + countries.map { it.code to "${it.code} · ${t("styles.voters", "n" to it.voters)}" }, s.country) { s.pickCountry(it) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Ready(model: AppModel, s: StylesModel, v: StylesModel.View) {
    val d = s.data ?: return
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatTile(t("styles.sum.answers"), grouped(rememberCountUp(v.duels)), Modifier.weight(1f)); StatTile(t("styles.sum.voters"), grouped(rememberCountUp(d.voters)), Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatTile(t("styles.sum.specimens"), grouped(rememberCountUp(v.specimens)), Modifier.weight(1f)); StatTile(t("styles.sum.reliability"), t("styles.reliability.${v.reliability}"), Modifier.weight(1f))
    }
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(t("styles.recipe.title"), 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(6.dp))
        val traits = v.recipe.map { t("arena.traits.${it.trait}.${if (it.lift >= 0) "hi" else "lo"}").lowercase() }.joinToString(", ")
        Txt(if (v.recipe.isNotEmpty()) t("styles.recipe.lead", "dim" to t("builder.dimensions.${s.dim}.label").lowercase(), "traits" to traits) else t("styles.recipe.none"), 14, color = C.g100)
    }
    if (v.ranked.best.isNotEmpty()) Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(t("styles.loved"), 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            v.ranked.best.forEach { Spec(model, s.season, it, 112.dp) }
        }
        if (v.ranked.worst.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Txt(t("styles.winners.least"), 11, FontWeight.Medium, C.g500)
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                v.ranked.worst.forEach { Spec(model, s.season, it, 72.dp, withFamily = false) }
            }
        }
    }
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(t("styles.fingerprint.title"), 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(2.dp))
        Txt(t("styles.fingerprint.hint", "dim" to t("builder.dimensions.${s.dim}.label").lowercase()), 12, color = C.g500)
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { v.lifts.forEach { Portrait(it) } }
    }
    Txt(t("styles.note", "n" to StyleStats.MIN_GROUP), 11, color = C.g500)
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    Plate(modifier, radius = 14, pad = 12) {
        Txt(label, 11, FontWeight.Medium, C.g400, maxLines = 2)
        Spacer(Modifier.height(4.dp))
        Txt(value, 20, FontWeight.ExtraBold, C.g50, maxLines = 1)
    }
}

@Composable
private fun Spec(model: AppModel, season: String, m: StyleStats.Spec, size: Dp, withFamily: Boolean = true) {
    val key = model.thumbKey(season, m.family, m.index)
    LaunchedEffect(key) { model.ensureSpecimenThumb(season, m.family, m.index) }
    val bmp = model.images[key]
    Column(Modifier.width(size), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(size).well(12.dp).padding(5.dp), contentAlignment = Alignment.Center) {
            if (bmp != null) Image(bmp, t("arena.family.${m.family}"), Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else Txt("…", 14, color = C.g500)
        }
        Txt("${(m.rate * 100).roundToInt()}%", 14, FontWeight.ExtraBold, C.g50)
        Txt((if (withFamily) t("arena.family.${m.family}") + " · " else "") + t("styles.winners.answers", "n" to m.n), 10, color = C.g500, maxLines = 2)
    }
}

/** one trait axis of the style portrait: how much more often the specimens that lean to the right pole win (a bar to the right) or to the left */
@Composable
private fun Portrait(l: StyleStats.Lift) {
    val frac = min(1.0, abs(l.lift) / SCALE).toFloat()
    val hi = l.lift >= 0
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Txt(t("arena.traits.${l.trait}.lo"), 12, if (l.level != "none" && !hi) FontWeight.ExtraBold else FontWeight.Medium, if (l.level != "none" && !hi) C.g50 else C.g400, Modifier.weight(1f))
            Txt(t("arena.traits.${l.trait}.hi"), 12, if (l.level != "none" && hi) FontWeight.ExtraBold else FontWeight.Medium, if (l.level != "none" && hi) C.g50 else C.g400, Modifier.weight(1f), align = TextAlign.End)
        }
        Box(Modifier.fillMaxWidth().height(10.dp).well(5.dp)) {
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) { if (!hi && frac > 0f) Box(Modifier.fillMaxWidth(frac).fillMaxHeight().lit(5.dp)) }
                Box(Modifier.width(2.dp).fillMaxHeight().background(C.g500))
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) { if (hi && frac > 0f) Box(Modifier.fillMaxWidth(frac).fillMaxHeight().lit(5.dp)) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt("${pts(l.lift)} ${t("styles.fingerprint.pts")}", 13, FontWeight.ExtraBold, C.g50)
            Chip(t("styles.level.${l.level}"), when (l.level) { "strong" -> Tone.Ok; "clear" -> Tone.Signal; "hint" -> Tone.Warn; else -> Tone.Neutral })
        }
    }
}
