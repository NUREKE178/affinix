import { html, useState, useMemo, useEffect } from "../lib/preact.js";
import { useExperiments } from "../lib/experimentsStore.js";
import { fetchSessionsForExperiment } from "../lib/participants.js";
import { navigate } from "../router.js";
import { Card, SectionHeading, StatTile, Badge, Select, Button, EmptyState, LoadingState } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { experimentSummary, choiceStatsForQuestion, primarySelectionQuestion, completedParticipants, segmentBreakdown } from "../lib/stats.js";
import { generateInsights } from "../lib/insights.js";
import { pct, durationFromMs, shortDate } from "../lib/format.js";
import { researchTypeLabel } from "../lib/questionTypes.js";
import { useT, useLocale } from "../lib/i18n.js";
import { withTimeout } from "../lib/async.js";

const DATE_LOCALE = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

function buildMarkdownReport(experiment, summary, choice, segments, insights, t, locale) {
  const lines = [];
  lines.push(`# ${experiment.name}`);
  lines.push("");
  lines.push(`*${t("reports.md.generatedOn", { type: researchTypeLabel(experiment.researchType, t), date: new Date().toLocaleDateString(DATE_LOCALE[locale] ?? "ru-RU") })}*`);
  lines.push("");
  lines.push(`## ${t("reports.md.objective")}`);
  lines.push(experiment.objective || "—");
  lines.push("");
  lines.push(`## ${t("reports.md.methodology")}`);
  lines.push(t("reports.md.methodologyBody", {
    variants: experiment.variants.length,
    questions: experiment.questions.length,
    randomized: experiment.settings.randomizeVariantOrder ? t("reports.md.randomized") : t("reports.md.fixed"),
  }));
  lines.push("");
  lines.push(`## ${t("reports.md.sample")}`);
  lines.push(`- ${t("reports.md.sampleParticipants", { count: summary.participantCount, target: experiment.participantSettings.targetCount })}`);
  lines.push(`- ${t("reports.md.sampleCompletion", { rate: pct(summary.completion.rate) })}`);
  lines.push(`- ${t("reports.md.sampleSize", { status: summary.sampleSize.sufficient ? t("reports.md.sampleSufficient") : t("reports.md.sampleInsufficient"), n: summary.sampleSize.n })}`);
  lines.push("");
  if (choice) {
    lines.push(`## ${t("reports.md.comparison")}`);
    for (const row of choice.rows) {
      lines.push(`- ${t("reports.md.comparisonRow", { label: row.label, name: row.name, rate: pct(row.rate), ciLow: pct(row.ci[0]), ciHigh: pct(row.ci[1]), n: row.count })}`);
    }
    lines.push("");
  }
  if (segments?.length) {
    lines.push(`## ${t("reports.md.segments")}`);
    for (const seg of segments) {
      const leader = seg.rows[0];
      lines.push(`- ${t("reports.md.segmentRow", { segment: seg.segment, n: seg.n, smallSample: !seg.sufficient ? t("reports.md.smallSampleSuffix") : "", label: leader.label, rate: pct(leader.rate) })}`);
    }
    lines.push("");
  }
  lines.push(`## ${t("reports.md.keyFindings")}`);
  lines.push(`**${t("reports.md.whatHappened")}**`);
  insights.whatHappened.forEach((l) => lines.push(`- ${l}`));
  lines.push(`\n**${t("reports.md.whyItMightHaveHappened")}**`);
  insights.whyMightHaveHappened.forEach((l) => lines.push(`- ${l}`));
  lines.push(`\n**${t("reports.md.recommendationHeading", { confidence: t(`insights.confidence.${insights.recommendation.confidence}`) })}**\n${insights.recommendation.text}`);
  lines.push("");
  lines.push(`## ${t("reports.md.limitations")}`);
  lines.push(`- ${t("reports.md.limitation1")}`);
  lines.push(`- ${t("reports.md.limitation2")}`);
  if (!summary.sampleSize.sufficient) lines.push(`- ${t("reports.md.limitation3")}`);
  lines.push("");
  lines.push(`## ${t("reports.md.nextExperiment")}`);
  lines.push(summary.sampleSize.sufficient
    ? t("reports.md.nextExperimentSufficient")
    : t("reports.md.nextExperimentInsufficient", { n: Math.max(0, 30 - summary.sampleSize.n) }));
  lines.push(`\n---\n${insights.disclaimer}`);
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const t = useT();
  const locale = useLocale();
  const { experiments, loading: experimentsLoading } = useExperiments();
  const eligible = experiments.filter((e) => e.status !== "draft");
  const [selectedId, setSelectedId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [participantsError, setParticipantsError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const experiment = useMemo(() => experiments.find((e) => e.id === selectedId) ?? eligible[0] ?? null, [experiments, selectedId]);

  useEffect(() => {
    if (!experiment) { setParticipants([]); setLoadingParticipants(false); setParticipantsError(false); return; }
    let cancelled = false;
    setLoadingParticipants(true);
    setParticipantsError(false);
    withTimeout(fetchSessionsForExperiment(experiment.id), 15000)
      .then((sessions) => { if (!cancelled) { setParticipants(sessions); setLoadingParticipants(false); } })
      .catch(() => { if (!cancelled) { setLoadingParticipants(false); setParticipantsError(true); } });
    return () => { cancelled = true; };
  }, [experiment?.id, retryTick]);

  const completed = useMemo(() => completedParticipants(participants), [participants]);
  const selQ = experiment ? primarySelectionQuestion(experiment) : null;
  const choice = experiment && selQ ? choiceStatsForQuestion(experiment, completed, selQ.id) : null;
  const segments = experiment && selQ ? segmentBreakdown(experiment, completed, selQ.id, "ageRange") : [];
  const summary = experiment ? experimentSummary(experiment, participants) : null;
  const insights = experiment && !loadingParticipants && !participantsError ? generateInsights(experiment, participants, locale) : null;

  if (experimentsLoading) return html`<${LoadingState} label=${t("common.loading")} />`;
  if (eligible.length === 0) {
    return html`<${EmptyState} title=${t("reports.emptyTitle")} body=${t("reports.emptyBody")} icon="reports"
      action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}>${t("reports.emptyCta")}<//>`} />`;
  }

  return html`
    <div class="fade-in max-w-3xl">
      <${SectionHeading}
        title=${t("reports.title")}
        subtitle=${t("reports.subtitle")}
        action=${html`
          <${Select} className="w-auto min-w-[240px]" options=${eligible.map((e) => ({ value: e.id, label: e.name }))} value=${experiment?.id} onChange=${(e) => setSelectedId(e.target.value)} />
        `}
      />

      ${experiment && (participantsError
        ? html`
        <div class="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <span>${t("reports.participantsError")}</span>
          <button class="font-medium underline shrink-0" onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}</button>
        </div>
      `
        : loadingParticipants
        ? html`<${LoadingState} label=${t("common.loadingAnswers")} />`
        : html`
        <${Card} className="p-6">
          <div class="flex items-start justify-between gap-3 mb-5 flex-wrap">
            <div>
              <h3 class="text-lg font-semibold text-graphite-100">${experiment.name}</h3>
              <p class="text-sm text-graphite-500 mt-1">${researchTypeLabel(experiment.researchType, t)} · ${shortDate(new Date().toISOString())}</p>
            </div>
            <${Button} size="sm" variant="secondary" onClick=${() => downloadText(`${experiment.name.replace(/\s+/g, "-").toLowerCase()}-report.md`, buildMarkdownReport(experiment, summary, choice, segments, insights, t, locale))}>
              <${Icon} name="reports" size=${14} /> ${t("reports.download")}
            <//>
          </div>

          <p class="text-sm text-graphite-300 mb-5">${experiment.objective}</p>

          <div class="sk-stat-strip sk-stat-strip-well mb-6" style="--cols:3">
            <${StatTile} label=${t("reports.participants")} value=${summary.participantCount} />
            <${StatTile} label=${t("reports.completionRate")} value=${pct(summary.completion.rate)} />
            <${StatTile} label=${t("reports.avgTime")} value=${durationFromMs(summary.avgCompletionTimeMs)} />
          </div>

          ${!summary.sampleSize.sufficient && html`
            <div class="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">${t("reports.insufficientSample", { n: summary.sampleSize.n })}</div>
          `}

          ${choice && html`
            <h4 class="text-sm font-semibold text-graphite-200 mb-2">${t("reports.comparisonTitle")}</h4>
            <div class="space-y-1.5 mb-6">
              ${choice.rows.map((r) => html`<div key=${r.variantId} class="flex justify-between text-sm"><span class="text-graphite-300">${r.label} — ${r.name}</span><span class="text-graphite-500">${pct(r.rate)} (${t("common.ci")} ${pct(r.ci[0])}–${pct(r.ci[1])})</span></div>`)}
            </div>
          `}

          <h4 class="text-sm font-semibold text-graphite-200 mb-2">${t("reports.recommendationTitle")}</h4>
          <div class="flex items-center gap-2 mb-2"><${Badge} tone="signal">${t("reports.confidenceLabel", { confidence: t(`insights.confidence.${insights.recommendation.confidence}`) })}<//></div>
          <p class="text-sm text-graphite-300">${insights.recommendation.text}</p>
          <p class="text-xs text-graphite-500 mt-4 italic">${insights.disclaimer}</p>
        <//>
      `)}
    </div>
  `;
}
