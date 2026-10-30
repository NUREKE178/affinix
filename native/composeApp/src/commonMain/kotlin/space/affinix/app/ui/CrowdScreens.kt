package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.decodeToImageBitmap
import space.affinix.app.ImageRules
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.CrowdItem
import space.affinix.app.store.CrowdModel
import space.affinix.app.store.CrowdTest
import space.affinix.app.store.CrowdVerdict
import space.affinix.app.store.DraftOption
import space.affinix.app.store.Tab
import kotlin.math.roundToInt

private fun pct(x: Double) = (x * 100).roundToInt()

@Composable
private fun optionName(item: CrowdItem): String = item.label?.takeIf { it.isNotBlank() } ?: t("crowd.optionN", "n" to ('A' + item.pos).toString())

@Composable
private fun StatusChip(status: String) = Chip(
    t("crowd.status.$status"),
    when (status) { "open" -> Tone.Ok; "flagged" -> Tone.Warn; "removed" -> Tone.Bad; else -> Tone.Neutral },
)

/** An option as a small tile: its picture when it has one, else the first letters of its text. */
@Composable
private fun OptionThumb(model: AppModel, item: CrowdItem, size: Dp) {
    val url = model.crowd.imageUrl(item.path)
    LaunchedEffect(url) { model.ensureUrlImage(url) }
    val bmp = url?.let { model.images[it] }
    Box(Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(C.g700), contentAlignment = Alignment.Center) {
        if (bmp != null) Image(bmp, null, Modifier.size(size), contentScale = ContentScale.Crop)
        else if (item.path == null) Txt((item.label ?: "?").trim().take(2), (size.value * .32f).toInt(), FontWeight.ExtraBold, C.g200)
    }
}

@Composable
private fun verdictText(test: CrowdTest): String {
    val v = CrowdVerdict.of(test)
    return when (v.state) {
        "empty" -> t("crowd.verdict.empty")
        "collecting" -> t("crowd.verdict.collecting", "n" to CrowdVerdict.MIN_RELIABLE)
        "winner" -> v.lead!!.let { t("crowd.verdict.winner", "label" to optionName(it.item), "pct" to pct(it.rate ?: 0.0), "lo" to pct(it.lo), "hi" to pct(it.hi)) }
        else -> t("crowd.verdict.close")
    }
}

/** "Ask the Arena crowd": the entry card on the Arena home. */
@Composable
fun CrowdEntryCard(model: AppModel) {
    Plate(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Ico("friends", color = C.signalHi, size = 20.dp)
            Txt(t("crowd.heroTitle"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        Txt(t("crowd.heroBody"), 13, color = C.g400)
        Spacer(Modifier.height(12.dp))
        KeyButton(t("crowd.heroKicker"), { model.tab = Tab.Research }, Modifier.fillMaxWidth())
    }
}

/** The crowd-test screens: the list (a section of Research), the form and one test. */
@Composable
internal fun CrowdFlow(model: AppModel) {
    val c = model.crowd
    LaunchedEffect(Unit) { c.load() }
    when (c.view) {
        CrowdModel.View.List -> CrowdList(model)
        CrowdModel.View.Create -> CrowdCreate(model)
        CrowdModel.View.Detail -> CrowdDetail(model)
    }
}

@Composable
private fun CrowdList(model: AppModel) {
    val c = model.crowd
    // the numbers move while the crowd answers
    LaunchedEffect(Unit) { while (true) { delay(30_000); c.load() } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Plate(Modifier.fillMaxWidth()) {
            Txt(t("crowd.heroBody"), 13, color = C.g400)
            Spacer(Modifier.height(8.dp))
            Txt(t("crowd.useCases"), 12, color = C.g500)
            Spacer(Modifier.height(12.dp))
            KeyButton(t("crowd.create"), { c.view = CrowdModel.View.Create }, Modifier.fillMaxWidth(), lit = !c.locked, enabled = !c.locked)
            if (c.locked) { Spacer(Modifier.height(8.dp)); Txt(t("crowd.gate", "xp" to (model.profile?.xp ?: 0L)), 12, FontWeight.Medium, C.warn) }
        }
        when {
            c.loadError != null && c.tests.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("crowd.loadError"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t(c.loadError!!), 13, color = C.g400)
                Spacer(Modifier.height(10.dp)); KeyButton(t("people.retry"), { c.load() }, compact = true)
            }
            !c.loaded -> Txt(t("common.loading"), 14, color = C.g500)
            c.tests.isEmpty() -> Txt(t("crowd.heroTitle"), 14, color = C.g500)
            else -> c.tests.forEach { test -> TestCard(model, test) }
        }
    }
}

@Composable
private fun TestCard(model: AppModel, test: CrowdTest) {
    val v = CrowdVerdict.of(test)
    Plate(Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { model.crowd.open(test.id) }, pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Txt(test.title, 16, FontWeight.ExtraBold, C.g50, maxLines = 2)
                Txt(t("crowd.q.${test.dim}"), 12, color = C.g500)
            }
            StatusChip(test.status)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { test.items.forEach { OptionThumb(model, it, 40.dp) } }
        Spacer(Modifier.height(10.dp))
        Bar(v.progress)
        Spacer(Modifier.height(4.dp))
        Txt(t("crowd.votesOf", "votes" to test.votes, "target" to test.target), 12, FontWeight.Bold, C.g300)
        Spacer(Modifier.height(4.dp))
        Txt(verdictText(test), 13, color = C.g300)
        Spacer(Modifier.height(6.dp))
        Txt(t("crowd.voters", "n" to test.voters), 12, color = C.g500)
    }
}

// ---- create --------------------------------------------------------------------------------------------------------------------

private class OptionDraft(label: String = "", image: space.affinix.app.ShrunkImage? = null) {
    var label by mutableStateOf(label)
    var image by mutableStateOf(image)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CrowdCreate(model: AppModel) {
    val c = model.crowd
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var dim by remember { mutableStateOf("preference") }
    val options = remember { mutableStateListOf(OptionDraft(), OptionDraft()) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { c.back() })
            Txt(t("crowd.new.title"), 22, FontWeight.ExtraBold, C.g50)
        }
        Plate(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Field(title, { title = it; error = null }, t("crowd.new.titleLabel"), imeDone = false)
                Txt(t("crowd.new.subtitle"), 12, color = C.g500)
                Txt(t("crowd.new.questionLabel"), 12, FontWeight.Medium, C.g400)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    CrowdModel.DIMS.forEach { d ->
                        Chip(t("crowd.q.$d"), if (d == dim) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { dim = d; error = null })
                    }
                }
            }
        }
        Plate(Modifier.fillMaxWidth()) {
            Txt(t("crowd.new.optionsLabel"), 14, FontWeight.ExtraBold, C.g200)
            Txt(t("crowd.new.optionHint"), 12, color = C.g500)
            Spacer(Modifier.height(10.dp))
            options.forEachIndexed { i, o ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(('A' + i).toString(), 16, FontWeight.ExtraBold, C.signalHi, Modifier.size(20.dp))
                    Box(Modifier.weight(1f)) { Field(o.label, { o.label = it; error = null }, t("crowd.new.optionLabel"), imeDone = false) }
                    val img = o.image
                    if (img != null) PickedPreviewSmall(img) { o.image = null }
                    else IcoAction("image", {
                        scope.launch {
                            val (got, why) = ImageRules.chooseAndShrink(CrowdModel.MAX_SIDE, CrowdModel.MAX_BYTES)
                            if (got != null) { o.image = got; error = null } else if (why != null) error = why
                        }
                    })
                    if (options.size > CrowdModel.MIN_OPTIONS) IcoAction("trash", { options.removeAt(i) })
                }
            }
            if (options.size < CrowdModel.MAX_OPTIONS) KeyButton(t("crowd.new.addOption"), { options.add(OptionDraft()) }, compact = true)
        }
        Txt(t("crowd.new.rules"), 11, color = C.g500)
        error?.let { Txt(t(it), 13, FontWeight.Medium, C.bad) }
        if (done) Txt(t("crowd.created"), 13, FontWeight.Medium, C.ok)
        KeyButton(if (c.busy) t("crowd.new.publishing") else t("crowd.new.publish"), {
            val drafts = options.map { DraftOption(it.label, it.image) }
            val why = c.validate(title, dim, drafts)
            if (why != null) { error = why }
            else scope.launch {
                val e = c.create(title, dim, drafts)
                if (e == null) { done = true; c.back() } else error = e
            }
        }, Modifier.fillMaxWidth(), lit = true, big = true, enabled = !c.busy)
    }
}

@OptIn(org.jetbrains.compose.resources.ExperimentalResourceApi::class)
@Composable
private fun PickedPreviewSmall(img: space.affinix.app.ShrunkImage, onRemove: () -> Unit) {
    val bmp = remember(img) { runCatching { img.bytes.decodeToImageBitmap() }.getOrNull() }
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(C.g700).clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { onRemove() }) {
        if (bmp != null) Image(bmp, null, Modifier.size(44.dp), contentScale = ContentScale.Crop)
    }
}

// ---- one test ----------------------------------------------------------------------------------------------------------------------

@Composable
private fun CrowdDetail(model: AppModel) {
    val c = model.crowd
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(c.openId) { while (true) { delay(20_000); c.loadResult() } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        IcoAction("arrowLeft", { c.back() })
        val r = c.result
        when {
            r == null && c.resultError != null -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("crowd.loadError"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t(c.resultError!!), 13, color = C.g400)
            }
            r == null -> Txt(t("common.loading"), 14, color = C.g500)
            else -> {
                val test = r.test
                val v = CrowdVerdict.of(test)
                val reviewing = test.status == "flagged" || test.status == "removed"
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) { Txt(test.title, 22, FontWeight.ExtraBold, C.g50); Txt(t("crowd.q.${test.dim}"), 13, color = C.g500) }
                    StatusChip(test.status)
                }
                if (reviewing) Txt(t("crowd.err.under_review") + (test.note?.let { " · $it" } ?: ""), 13, FontWeight.Medium, C.warn)
                Plate(Modifier.fillMaxWidth()) {
                    Txt("${t("crowd.status.${test.status}")} · ${t("crowd.votesOf", "votes" to test.votes, "target" to test.target)}", 12, FontWeight.Bold, C.g400)
                    Spacer(Modifier.height(6.dp))
                    Txt(verdictText(test), 16, FontWeight.Bold, C.g50)
                    Spacer(Modifier.height(10.dp))
                    Bar(v.progress)
                    Spacer(Modifier.height(8.dp))
                    Txt(t("crowd.voters", "n" to test.voters) + (r.avgMs?.let { " · " + t("crowd.res.avgTime", "s" to ((it / 100).roundToInt() / 10.0).toString()) } ?: ""), 12, color = C.g500)
                }
                Plate(Modifier.fillMaxWidth(), pad = 12) {
                    v.ranked.forEachIndexed { i, row ->
                        val lead = v.state == "winner" && i == 0
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Txt("${i + 1}", 16, FontWeight.ExtraBold, C.g500, Modifier.size(18.dp))
                            OptionThumb(model, row.item, 52.dp)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Txt(optionName(row.item), 15, FontWeight.ExtraBold, if (lead) C.signalHi else C.g50, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                                    if (lead) Chip(t("crowd.res.leader"), Tone.Signal)
                                }
                                Bar(((row.rate ?: 0.0)).toFloat())
                                Txt(
                                    if (row.rate != null) "${t("crowd.res.rate", "pct" to pct(row.rate))} · ${t("crowd.res.ci", "lo" to pct(row.lo), "hi" to pct(row.hi))} · ${t("crowd.res.duels", "n" to row.item.games)}" else "—",
                                    11, color = C.g500,
                                )
                            }
                            Txt(if (row.rate != null) "${pct(row.rate)}%" else "—", 18, FontWeight.ExtraBold, C.g50)
                        }
                    }
                }
                if (r.pairs.isNotEmpty()) Plate(Modifier.fillMaxWidth()) {
                    Txt(t("crowd.res.pairs"), 13, FontWeight.ExtraBold, C.g400)
                    Spacer(Modifier.height(6.dp))
                    val names = test.items.associate { it.id to it }
                    // the server keys a pair by the lower item id; people read it in the order the options were entered
                    r.pairs.map { p -> if ((names[p.a]?.pos ?: 0) > (names[p.b]?.pos ?: 0)) space.affinix.app.store.CrowdPair(p.b, p.a, p.bVotes, p.aVotes) else p }
                        .sortedWith(compareBy({ names[it.a]?.pos ?: 0 }, { names[it.b]?.pos ?: 0 })).forEach { p ->
                            val a = names[p.a]; val b = names[p.b]
                            Txt(t("crowd.res.pairLine", "a" to (a?.let { optionName(it) } ?: "?"), "b" to (b?.let { optionName(it) } ?: "?"), "av" to p.aVotes, "bv" to p.bVotes), 13, color = C.g300)
                        }
                }
                Txt(t("crowd.res.note"), 12, color = C.g500)
                error?.let { Txt(t(it), 13, FontWeight.Medium, C.bad) }
                if (!reviewing) KeyButton(if (test.status == "open") t("crowd.closeTest") else t("crowd.reopen"), { scope.launch { error = c.setStatus(test, test.status != "open") } }, Modifier.fillMaxWidth(), enabled = !c.busy)
                if (!confirm) KeyButton(t("crowd.delete"), { confirm = true }, Modifier.fillMaxWidth(), enabled = !c.busy)
                else Plate(Modifier.fillMaxWidth(), pad = 14) {
                    Txt(t("crowd.deleteConfirm"), 13, color = C.g300)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        KeyButton(t("crowd.delete"), { scope.launch { error = c.delete(test); confirm = false } }, lit = true, compact = true, enabled = !c.busy)
                        KeyButton(t("common.cancel"), { confirm = false }, compact = true)
                    }
                }
            }
        }
    }
}
