package space.affinix.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.Lang
import space.affinix.app.i18n.LocalLang
import space.affinix.app.i18n.t
import space.affinix.app.i18n.tr
import space.affinix.app.localDay
import space.affinix.app.store.AppModel
import space.affinix.app.store.ResearchInsights
import space.affinix.app.store.ResearchInsights.pct
import space.affinix.app.store.ResearchStats

/** today's date as the website writes it in the report: dd.MM.yyyy in Russian and Kazakh, M/d/yyyy in English */
private fun reportDate(lang: Lang, day: String = localDay()): String {
    val (y, m, d) = day.split("-").map { it.toInt() }
    return if (lang == Lang.En) "$m/$d/$y" else "${d.toString().padStart(2, '0')}.${m.toString().padStart(2, '0')}.$y"
}

@Composable
private fun minutes(ms: Double?): String {
    if (ms == null) return "—"
    val total = (ms / 1000).toInt(); val m = total / 60; val s = total % 60
    return if (m > 0) "$m ${t("common.unitMin")} $s ${t("common.unitSec")}" else "$s ${t("common.unitSec")}"
}

/** Reports: the researcher's report of one experiment (the website's Reports page): numbers, the variants compared, what happened, why it might have, and a recommendation. */
@Composable
internal fun ReportsSection(model: AppModel) {
    val r = model.research
    val lang = LocalLang.current
    LaunchedEffect(r.activeOrgId) { r.loadExperiments() }
    val exp = r.reportExperiment
    LaunchedEffect(exp?.id) { if (exp != null) r.loadReport() }
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(exp?.id) { copied = false }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Txt(t("reports.appSubtitle"), 12, color = C.g500)
        if (exp == null) {
            Plate(Modifier.fillMaxWidth()) {
                Txt(t("reports.emptyTitle"), 15, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t("reports.emptyBody"), 13, color = C.g400)
            }
            return@Column
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            r.reportOptions.forEach { e ->
                Chip(e.name, if (e.id == exp.id) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { r.pickReport(e.id) })
            }
        }
        when {
            !r.reportLoaded -> Txt(t("common.loadingAnswers"), 14, color = C.g500)
            r.reportFailed -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("reports.participantsError"), 14, color = C.g300); Spacer(Modifier.height(10.dp)); KeyButton(t("common.retry"), { r.loadReport() }, compact = true)
            }
            else -> {
                val tr = ResearchInsights.Tr { key, vars -> tr(lang, key, *vars.toTypedArray()) }
                val all = r.reportSessions
                val done = ResearchStats.completed(all)
                val sel = ResearchStats.primarySelectionQuestion(exp)
                val choice = sel?.let { ResearchStats.choice(exp, done, it.id) }
                val segments = sel?.let { ResearchStats.segments(exp, done, it.id, "ageRange") } ?: emptyList()
                val summary = ResearchStats.summary(exp, all)
                val insights = ResearchInsights.generate(exp, all, tr)
                Plate(Modifier.fillMaxWidth(), pad = 14) {
                    Txt(exp.name, 18, FontWeight.ExtraBold, C.g50)
                    Spacer(Modifier.height(2.dp))
                    Txt(ResearchInsights.researchTypeLabel(exp.researchType, tr) + " · " + reportDate(lang), 12, color = C.g500)
                    if (!exp.objective.isNullOrBlank()) { Spacer(Modifier.height(8.dp)); Txt(exp.objective, 13, color = C.g300) }
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ReportTile(t("reports.participants"), "${summary.participantCount}", Modifier.weight(1f))
                        ReportTile(t("reports.completionRate"), pct(summary.completion.rate), Modifier.weight(1f))
                        ReportTile(t("reports.avgTime"), minutes(summary.avgCompletionTimeMs), Modifier.weight(1f))
                    }
                    if (!summary.sampleSize.sufficient) { Spacer(Modifier.height(10.dp)); Txt(t("reports.insufficientSample", "n" to summary.sampleSize.n), 12, color = C.warn) }
                    if (choice != null) {
                        Spacer(Modifier.height(14.dp))
                        Txt(t("reports.comparisonTitle"), 12, FontWeight.Bold, C.g200)
                        Spacer(Modifier.height(4.dp))
                        choice.rows.forEach { row ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Txt("${row.label} — ${row.name}", 13, color = C.g300, modifier = Modifier.weight(1f))
                                Txt("${pct(row.rate)} (${t("common.ci")} ${pct(row.lo)}–${pct(row.hi)})", 12, color = C.g500)
                            }
                        }
                    }
                }
                Plate(Modifier.fillMaxWidth(), pad = 14) {
                    Txt(t("reports.md.keyFindings"), 11, FontWeight.Medium, C.g500)
                    Spacer(Modifier.height(8.dp))
                    Txt(t("reports.md.whatHappened"), 13, FontWeight.Bold, C.g200)
                    insights.whatHappened.forEach { Spacer(Modifier.height(4.dp)); Txt("• $it", 13, color = C.g300) }
                    Spacer(Modifier.height(10.dp))
                    Txt(t("reports.md.whyItMightHaveHappened"), 13, FontWeight.Bold, C.g200)
                    insights.why.forEach { Spacer(Modifier.height(4.dp)); Txt("• $it", 13, color = C.g300) }
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt(t("reports.recommendationTitle"), 13, FontWeight.Bold, C.g200)
                        Chip(t("reports.confidenceLabel", "confidence" to t("insights.confidence.${insights.recommendation.confidence}")), Tone.Signal)
                    }
                    Spacer(Modifier.height(6.dp))
                    Txt(insights.recommendation.text, 14, color = C.g100)
                    Spacer(Modifier.height(10.dp))
                    Txt(insights.disclaimer, 11, color = C.g500)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    KeyButton(t("reports.copy"), {
                        clipboard.setText(AnnotatedString(ResearchInsights.markdown(exp, summary, choice, segments, insights, tr, reportDate(lang))))
                        copied = true
                    }, compact = true)
                    if (copied) Chip(t("reports.copied"), Tone.Ok)
                }
            }
        }
    }
}

@Composable
private fun ReportTile(label: String, value: String, modifier: Modifier = Modifier) {
    Plate(modifier, radius = 12, pad = 10) {
        Txt(label, 10, FontWeight.Medium, C.g400, maxLines = 2)
        Spacer(Modifier.height(3.dp))
        Txt(value, 15, FontWeight.ExtraBold, C.g50, maxLines = 2)
    }
}
