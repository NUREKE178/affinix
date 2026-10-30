package space.affinix.app.ui

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.affinix.app.i18n.t
import space.affinix.app.net.Experiment
import space.affinix.app.net.ParticipantSession
import space.affinix.app.net.Question
import space.affinix.app.store.AppModel
import space.affinix.app.store.CrowdModel
import space.affinix.app.store.Member
import space.affinix.app.store.ResearchModel
import space.affinix.app.store.ResearchModel.Section
import space.affinix.app.store.ResearchStats
import space.affinix.app.store.ResearchStats.QuestionStats
import space.affinix.app.store.Tab
import kotlin.math.roundToInt

private fun pct(x: Double?) = if (x == null) "—" else "${(x * 100).roundToInt()}%"
private fun one(x: Double?, digits: Int = 1): String {
    if (x == null) return "—"
    val f = Math.pow(10.0, digits.toDouble()); return ((x * f).roundToInt() / f).toString()
}

/** "2 min 44 s" in the player's language */
@Composable
private fun duration(ms: Double?): String {
    if (ms == null) return "—"
    val total = (ms / 1000).roundToInt(); val m = total / 60; val s = total % 60
    return if (m > 0) "$m ${t("common.unitMin")} $s ${t("common.unitSec")}" else "$s ${t("common.unitSec")}"
}

@Composable
private fun statusText(status: String): String = when (status) {
    "published" -> t("overview.statusActive"); "completed" -> t("overview.statusCompleted"); "draft" -> t("overview.statusDraft"); "paused" -> t("overview.statusPaused"); else -> status
}

private fun statusTone(status: String) = when (status) { "published" -> Tone.Ok; "paused" -> Tone.Warn; else -> Tone.Neutral }

@Composable
private fun researchTypeText(id: String?): String = if (id == null) "" else t("questionTypes.research.$id.label")

/** Research: the experiments of the company, their results, the participants, the crowd tests and the team. */
@Composable
fun ResearchScreen(model: AppModel) {
    val r = model.research
    val c = model.crowd
    LaunchedEffect(Unit) { r.loadOrgs() }
    if (c.view != CrowdModel.View.List) { CrowdFlow(model); return }
    if (r.openId != null) { ExperimentResults(model); return }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { model.tab = Tab.Play })
            Txt(t("research.title"), 24, FontWeight.ExtraBold, C.g50)
        }
        if (r.orgs.size > 1) CompanyPicker(r)
        else r.org?.let { Txt(it.name, 13, FontWeight.Bold, C.g400) }
        Segmented(
            listOf(t("experiments.title"), t("participants.title"), t("crowd.mineTitle"), t("team.title")),
            r.section.ordinal, { r.section = Section.values()[it] },
        )
        r.notice?.let { Chip(t(it), Tone.Info) }
        when {
            r.section == Section.Crowd -> CrowdFlow(model)
            !r.orgsLoaded -> Txt(t("common.loading"), 14, color = C.g500)
            r.orgsFailed -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("research.actionFailed"), 14, color = C.g300); Spacer(Modifier.height(10.dp)); KeyButton(t("people.retry"), { r.loadOrgs() }, compact = true)
            }
            r.org == null -> Plate(Modifier.fillMaxWidth()) { Txt(t("research.noCompany"), 14, color = C.g300) }
            else -> when (r.section) {
                Section.Experiments -> ExperimentsList(model)
                Section.Participants -> ParticipantsList(model)
                Section.Team -> TeamSection(model)
                Section.Crowd -> Unit
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CompanyPicker(r: ResearchModel) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        r.orgs.forEach { o -> Chip(o.name, if (o.id == r.activeOrgId) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { r.pickOrg(o.id) }) }
    }
}

// ---- experiments ---------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExperimentsList(model: AppModel) {
    val r = model.research
    var filter by remember { mutableStateOf("all") }
    var confirm by remember { mutableStateOf<Experiment?>(null) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    LaunchedEffect(r.activeOrgId) { r.loadExperiments() }
    val filters = listOf("all" to "experiments.filters.all", "published" to "experiments.filters.active", "completed" to "experiments.filters.completed", "draft" to "experiments.filters.draft", "paused" to "experiments.filters.paused")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        filters.forEach { (id, key) -> Chip(t(key), if (id == filter) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { filter = id }) }
    }
    val shown = r.experiments.filter { filter == "all" || it.status == filter }.sortedByDescending { space.affinix.app.epochOfIso(it.updatedAt) ?: 0L }
    when {
        r.experimentsFailed && r.experiments.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
            Txt(t("research.actionFailed"), 14, color = C.g300); Spacer(Modifier.height(10.dp)); KeyButton(t("people.retry"), { r.loadExperiments() }, compact = true)
        }
        !r.experimentsLoaded -> Txt(t("common.loading"), 14, color = C.g500)
        shown.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
            Txt(t("experiments.emptyTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("experiments.emptyBody"), 13, color = C.g400)
        }
        else -> shown.forEach { e ->
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(e.name, 16, FontWeight.ExtraBold, C.g50, Modifier.weight(1f), maxLines = 2)
                    Chip(statusText(e.status), statusTone(e.status))
                }
                e.objective?.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(4.dp)); Txt(it, 13, color = C.g400, maxLines = 3) }
                Spacer(Modifier.height(8.dp))
                Txt(listOf(researchTypeText(e.researchType), t("research.metaVariants", "n" to e.variants.size), t("research.metaQuestions", "n" to e.questions.size), t("experiments.updated", "when" to agoText(e.updatedAt))).filter { it.isNotBlank() }.joinToString(" · "), 12, color = C.g500)
                Spacer(Modifier.height(10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (e.status == "draft") KeyButton(t("experiments.publish"), { r.publish(e) }, lit = true, compact = true, enabled = r.busy != e.id)
                    else KeyButton(t("experiments.results"), { r.openExperiment(e.id) }, lit = true, compact = true)
                    if (e.status != "draft") r.publicLink(e)?.let { link -> KeyButton(t("research.copyLink"), { clipboard.setText(androidx.compose.ui.text.AnnotatedString(link)); r.notice = "experiments.linkCopied" }, compact = true) }
                    KeyButton(t("experiments.delete"), { confirm = e }, compact = true, enabled = r.busy != e.id)
                }
                if (confirm?.id == e.id) {
                    Spacer(Modifier.height(10.dp))
                    Txt(t("experiments.confirmDeleteTitle", "name" to e.name), 14, FontWeight.Bold, C.g50)
                    Txt(t("experiments.confirmDeleteBody"), 12, color = C.g400)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        KeyButton(t("common.delete"), { r.delete(e); confirm = null }, lit = true, compact = true)
                        KeyButton(t("common.cancel"), { confirm = null }, compact = true)
                    }
                }
            }
        }
    }
    Txt(t("research.buildOnWeb"), 12, color = C.g500)
}

// ---- results of one experiment -----------------------------------------------------------------------------------------------------

@Composable
private fun Tile(label: String, value: String, hint: String? = null, modifier: Modifier = Modifier) {
    Plate(modifier, radius = 14, pad = 12) {
        Txt(label, 11, FontWeight.Medium, C.g400, maxLines = 2)
        Spacer(Modifier.height(4.dp))
        Txt(value, 20, FontWeight.ExtraBold, C.g50, maxLines = 1)
        if (hint != null) Txt(hint, 11, color = C.g500, maxLines = 2)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExperimentResults(model: AppModel) {
    val r = model.research
    val e = r.openExperiment
    LaunchedEffect(r.openId) { while (true) { delay(20_000); r.loadSessions() } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { r.closeExperiment() })
            Txt(t("results.title"), 22, FontWeight.ExtraBold, C.g50)
        }
        if (e == null) { Txt(t("results.notFoundTitle"), 14, color = C.g400); return@Column }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) { Txt(e.name, 18, FontWeight.ExtraBold, C.g50); Txt(researchTypeText(e.researchType), 12, color = C.g500) }
            Chip(statusText(e.status), statusTone(e.status))
        }
        when {
            r.sessionsFailed && r.sessions.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("results.participantsError"), 14, color = C.bad); Spacer(Modifier.height(10.dp)); KeyButton(t("common.retry"), { r.loadSessions() }, compact = true)
            }
            !r.sessionsLoaded -> Txt(t("common.loading"), 14, color = C.g500)
            else -> {
                val done = remember(r.sessions) { ResearchStats.completed(r.sessions) }
                val sum = remember(r.sessions, e) { ResearchStats.summary(e, r.sessions) }
                val sel = ResearchStats.primarySelectionQuestion(e)
                val rt = sel?.let { ResearchStats.responseTimeFor(done, it.id) }
                if (!sum.sampleSize.sufficient) Chip(t("results.insufficientSample", "n" to sum.sampleSize.n, "threshold" to sum.sampleSize.threshold), Tone.Warn)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Tile(t("results.statCompleted"), "${sum.participantCount}", t("results.statCompletedHint", "target" to e.targetCount), Modifier.weight(1f))
                    Tile(t("results.statCompletionRate"), pct(sum.completion.rate), t("results.statCompletionHint", "total" to sum.completion.total), Modifier.weight(1f))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Tile(t("results.statAvgTime"), duration(sum.avgCompletionTimeMs), null, Modifier.weight(1f))
                    Tile(t("results.statAvgDecisionTime"), rt?.meanMs?.let { duration(it) } ?: "—", t("results.statAvgDecisionHint"), Modifier.weight(1f))
                }
                e.questions.forEachIndexed { i, q -> QuestionCard(e, done, q, i) }
                if (sel != null) SegmentCard(e, done, sel, r)
            }
        }
    }
}

@Composable
private fun BarRow(label: String, ratio: Double, right: String, sub: String? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(label, 13, FontWeight.Bold, C.g100, Modifier.weight(1f), maxLines = 2)
            Txt(right, 13, FontWeight.ExtraBold, C.g50)
        }
        Bar(ratio.toFloat().coerceIn(0f, 1f))
        if (sub != null) Txt(sub, 11, color = C.g500)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionCard(e: Experiment, done: List<ParticipantSession>, q: Question, index: Int) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt("Q${index + 1} · ${t("questionTypes.question.${q.type}")}" + (q.role?.let { " · $it" } ?: ""), 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(2.dp))
        Txt(q.prompt.ifBlank { t("results.untitledQuestion") }, 15, FontWeight.Bold, C.g50)
        Spacer(Modifier.height(8.dp))
        when (val s = ResearchStats.forQuestion(e, done, q)) {
            is QuestionStats.ChoiceS -> {
                s.d.rows.forEach { BarRow("${it.label} — ${it.name}", it.rate, pct(it.rate), "${t("common.ci")} ${pct(it.lo)}–${pct(it.hi)} · n=${it.count}") }
                if (!s.d.check.sufficient) Txt(t("stats.insufficientSample"), 12, color = C.warn)
            }
            is QuestionStats.Dist -> s.d.rows.forEach { BarRow(it.option, it.rate, pct(it.rate), "n=${it.count}") }
            is QuestionStats.RatingS -> s.d.forEach { Txt("${it.label ?: it.name}: ${one(it.mean, 2)} (median ${one(it.median)}, n=${it.n})", 13, color = C.g200) }
            is QuestionStats.YesNoS -> s.d.forEach { BarRow(it.label?.let { l -> "$l — ${it.name}" } ?: "—", it.rate, pct(it.rate), "${t("common.ci")} ${pct(it.lo)}–${pct(it.hi)} · n=${it.n}") }
            is QuestionStats.RankS -> s.d.forEachIndexed { i, rr -> Txt("#${i + 1} ${rr.label} — ${rr.name}: ${one(rr.avgRank, 2)} (n=${rr.n})", 13, color = C.g200) }
            is QuestionStats.PriceS -> if (s.d.bands != null) s.d.bands.rows.forEach { BarRow(it.option, it.rate, pct(it.rate), "n=${it.count}") }
                else Txt(t("results.priceAverage", "mean" to one(s.d.mean, 2), "median" to one(s.d.median, 2), "n" to s.d.n), 13, color = C.g200)
            is QuestionStats.TextS -> if (s.d.isEmpty()) Txt(t("results.noResponses"), 13, color = C.g500) else FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { s.d.take(24).forEach { Chip("“$it”") } }
            QuestionStats.Unknown -> Unit
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SegmentCard(e: Experiment, done: List<ParticipantSession>, sel: Question, r: ResearchModel) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(t("results.segmentsTitle"), 15, FontWeight.ExtraBold, C.g50)
        Txt(t("results.segmentsSubtitle"), 12, color = C.g500)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("ageRange" to "results.segmentAge", "country" to "results.segmentCountry", "language" to "results.segmentLanguage").forEach { (k, key) ->
                Chip(t(key), if (k == r.segmentKey) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { r.segmentKey = k })
            }
        }
        Spacer(Modifier.height(8.dp))
        ResearchStats.segments(e, done, sel.id, r.segmentKey).forEach { seg ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Txt(seg.segment, 13, FontWeight.Bold, C.g100, Modifier.weight(1f))
                Txt("n=${seg.choice.n}" + if (!seg.choice.check.sufficient) " · ${t("results.smallSample")}" else "", 12, color = C.g500)
            }
            val top = seg.choice.rows.firstOrNull()
            if (top != null) Txt("${top.label}: ${pct(top.rate)}", 12, color = C.g300)
            Bar((top?.rate ?: 0.0).toFloat())
        }
    }
}

// ---- participants ----------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ParticipantsList(model: AppModel) {
    val r = model.research
    var status by remember { mutableStateOf("all") }
    var experiment by remember { mutableStateOf("all") }
    var shown by remember { mutableStateOf(20) }
    LaunchedEffect(r.activeOrgId) { r.loadOrgSessions(); r.loadExperiments() }
    val all = r.orgSessions
    val completed = all.count { it.status == "completed" }; val abandoned = all.count { it.status == "abandoned" }
    if (!r.orgSessionsLoaded) { Txt(t("common.loading"), 14, color = C.g500); return }
    if (r.orgSessionsFailed && all.isEmpty()) { Plate(Modifier.fillMaxWidth()) { Txt(t("research.actionFailed"), 14, color = C.g300); Spacer(Modifier.height(10.dp)); KeyButton(t("people.retry"), { r.loadOrgSessions() }, compact = true) }; return }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile(t("participants.statTotal"), "${all.size}", null, Modifier.weight(1f)); Tile(t("participants.statCompleted"), "$completed", null, Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Tile(t("participants.statInProgress"), "${all.size - completed - abandoned}", null, Modifier.weight(1f)); Tile(t("participants.statAbandoned"), "$abandoned", null, Modifier.weight(1f))
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("all" to t("participants.filterAllStatuses"), "completed" to t("participants.statusCompleted"), "in_progress" to t("participants.statusInProgress"), "abandoned" to t("participants.statusAbandoned")).forEach { (k, label) ->
            Chip(label, if (k == status) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { status = k; shown = 20 })
        }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Chip(t("participants.filterAllExperiments"), if (experiment == "all") Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { experiment = "all"; shown = 20 })
        r.experiments.forEach { e -> Chip(e.name, if (experiment == e.id) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { experiment = e.id; shown = 20 }) }
    }
    val rows = all.filter { (status == "all" || it.status == status) && (experiment == "all" || it.experimentId == experiment) }
    Txt(t("participants.resultsCount", "count" to rows.size), 12, color = C.g500)
    rows.take(shown).forEach { p ->
        Plate(Modifier.fillMaxWidth(), radius = 12, pad = 12) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(p.experimentName ?: "—", 14, FontWeight.Bold, C.g50, Modifier.weight(1f), maxLines = 1)
                Chip(t("participants.status" + p.status.split("_").joinToString("") { it.replaceFirstChar { c -> c.uppercase() } }), if (p.status == "completed") Tone.Ok else if (p.status == "abandoned") Tone.Bad else Tone.Warn)
            }
            val d = p.demographics
            Txt(listOf(d["ageRange"], d["country"], d["language"]).filterNotNull().joinToString(" · ").ifEmpty { "—" }, 12, color = C.g400)
            val dur = p.completedAt?.let { c -> (space.affinix.app.epochOfIso(c) ?: 0L) - (space.affinix.app.epochOfIso(p.startedAt) ?: 0L) }?.takeIf { it > 0 }
            Txt(agoText(p.startedAt) + (dur?.let { " · " + duration(it.toDouble()) } ?: ""), 11, color = C.g500)
        }
    }
    if (rows.size > shown) KeyButton(t("research.loadMore"), { shown += 20 }, Modifier.fillMaxWidth(), compact = true)
}

// ---- team --------------------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TeamSection(model: AppModel) {
    val r = model.research
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("researcher") }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Member?>(null) }
    LaunchedEffect(r.activeOrgId) { r.loadMembers() }
    Txt(t("team.subtitle"), 13, color = C.g400)
    if (r.canManage) Plate(Modifier.fillMaxWidth()) {
        Txt(t("team.modalTitle"), 15, FontWeight.ExtraBold, C.g50)
        Txt(t("team.inviteHint"), 12, color = C.g500)
        Spacer(Modifier.height(8.dp))
        Field(email, { email = it; note = null }, t("team.emailLabel"), email = true, imeDone = false)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { ResearchModel.ROLES.forEach { x -> Chip(t("team.roles.$x"), if (x == role) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { role = x }) } }
        note?.let { (txt, ok) -> Spacer(Modifier.height(6.dp)); Txt(txt, 12, FontWeight.Medium, if (ok) C.ok else C.bad) }
        Spacer(Modifier.height(8.dp))
        val added = t("team.memberAdded"); val invited = t("team.inviteSent", "email" to email.trim())
        KeyButton(if (busy) t("team.adding") else t("team.addMember"), {
            if (email.isNotBlank() && !busy) {
                busy = true
                scope.launch {
                    val res = r.addMember(email, role)
                    note = when { res == "added" -> added to true; res == "invited" -> invited to true; else -> (res.removePrefix("error:").ifBlank { null } ?: "!") to false }
                    if (res == "added" || res == "invited") email = ""
                    busy = false
                }
            }
        }, Modifier.fillMaxWidth(), lit = true, enabled = !busy && email.contains('@'))
    }
    when {
        r.membersFailed && r.members.isEmpty() -> Txt(t("research.noMembers"), 13, color = C.g400)
        !r.membersLoaded -> Txt(t("common.loading"), 14, color = C.g500)
        else -> Plate(Modifier.fillMaxWidth(), pad = 12) {
            r.members.forEach { m ->
                val mine = m.userId == model.api.session?.userId
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(model, space.affinix.app.net.Person(m.userId, m.name, null, m.avatarUrl), 40.dp)
                        Column(Modifier.weight(1f)) {
                            Txt(m.name + if (mine) " · ${t("team.you")}" else "", 15, FontWeight.ExtraBold, C.g50, maxLines = 1)
                            if (m.email.isNotBlank()) Txt(m.email, 12, color = C.g500, maxLines = 1)
                            m.joinedAt?.let { Txt(t("team.since", "date" to agoText(it)), 11, color = C.g500) }
                        }
                        if (m.role == "owner" || !r.canManage) Chip(t("team.roles.${m.role}"), if (m.role == "owner") Tone.Signal else Tone.Neutral)
                        if (r.canManage && m.role != "owner" && !mine) IcoAction("trash", { confirm = m })
                    }
                    if (r.canManage && m.role != "owner" && !mine) {
                        Spacer(Modifier.height(6.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { ResearchModel.ROLES.forEach { x -> Chip(t("team.roles.$x"), if (x == m.role) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { if (x != m.role) r.setRole(m, x) }) } }
                    }
                    if (confirm?.id == m.id) {
                        Spacer(Modifier.height(8.dp))
                        Txt(t("team.removeTitle", "name" to m.name), 13, FontWeight.Bold, C.g50)
                        Txt(t("team.removeBody"), 12, color = C.g400)
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { KeyButton(t("research.removeMember"), { r.remove(m); confirm = null }, lit = true, compact = true); KeyButton(t("common.cancel"), { confirm = null }, compact = true) }
                    }
                }
            }
        }
    }
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Txt(t("billing.currentPlan"), 12, color = C.g400); Txt(t("billing.planName"), 15, FontWeight.ExtraBold, C.g50) }
            Chip(t("billing.planActive"), Tone.Ok)
        }
        Spacer(Modifier.height(6.dp))
        Txt(t("billing.emptyBody"), 12, color = C.g500)
    }
}
