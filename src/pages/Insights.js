import { html, useState, useMemo, useEffect } from "../lib/preact.js";
import { useExperiments } from "../lib/experimentsStore.js";
import { fetchSessionsForExperiment } from "../lib/participants.js";
import { fetchLatestAiInsight, generateAiInsight } from "../lib/experiments.js";
import { navigate } from "../router.js";
import { Card, SectionHeading, Badge, Select, Button, EmptyState, ConfidenceBadge, LoadingState, Spinner } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { generateInsights } from "../lib/insights.js";
import { researchTypeLabel } from "../lib/questionTypes.js";
import { useT, useLocale } from "../lib/i18n.js";
import { withTimeout } from "../lib/async.js";

function AiSummaryCard({ experimentId, t }) {
  const [row, setRow] = useState(undefined); // undefined = loading, null = none yet
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRow(undefined);
    setError(null);
    fetchLatestAiInsight(experimentId)
      .then((r) => { if (!cancelled) setRow(r); })
      .catch(() => { if (!cancelled) setRow(null); });
    return () => { cancelled = true; };
  }, [experimentId]);

  async function onGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateAiInsight(experimentId);
      setRow(result.row ?? null);
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setGenerating(false);
    }
  }

  const formattedDate = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return html`
    <${Card} className="p-5 mb-5 border-teal-500/25 bg-teal-500/[0.03]">
      <div class="flex items-center gap-2 mb-3">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300"><${Icon} name="sparkle" size=${15} /></div>
        <h3 class="font-semibold text-slate-100">${t("insights.aiSummary.title")}</h3>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t("insights.aiSummary.subtitle")}</p>

      ${row === undefined && html`
        <div class="flex items-center gap-2 text-sm text-slate-500"><${Spinner} size=${14} /> ${t("common.loading")}</div>
      `}

      ${row !== undefined && generating && html`
        <div class="flex items-center gap-2 text-sm text-slate-400"><${Spinner} size=${14} /> ${t("insights.aiSummary.generating")}</div>
      `}

      ${row !== undefined && !generating && error && html`
        <div class="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3.5 py-3 text-sm text-rose-300 mb-3">${t("insights.aiSummary.failedTitle")}: ${error}</div>
      `}

      ${row !== undefined && !generating && !error && (!row || row.status === "failed") && html`
        <${Button} size="sm" onClick=${onGenerate}>${t("insights.aiSummary.generateCta")}<//>
      `}

      ${row !== undefined && !generating && !error && row?.status === "not_configured" && html`
        <div class="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-sm text-amber-200/90">
          <p class="font-medium mb-1">${t("insights.aiSummary.notConfiguredTitle")}</p>
          <p class="text-xs text-amber-200/70">${t("insights.aiSummary.notConfiguredBody")}</p>
        </div>
      `}

      ${row !== undefined && !generating && !error && row?.status === "ready" && html`
        <div>
          <p class="text-sm text-slate-200 leading-relaxed whitespace-pre-line">${row.output?.text}</p>
          <div class="flex items-center justify-between mt-4 pt-3 border-t border-black/30">
            <span class="text-[11px] text-slate-600">${t("insights.aiSummary.generatedAt", { date: formattedDate(row.generated_at), model: row.model ?? "" })}</span>
            <button class="text-xs text-teal-400 hover:text-teal-300" onClick=${onGenerate}>${t("insights.aiSummary.regenerateCta")}</button>
          </div>
        </div>
      `}
    <//>
  `;
}

function ExperimentPicker({ experiments, selectedId, onChange }) {
  return html`
    <${Select}
      className="w-auto min-w-[260px]"
      options=${experiments.map((e) => ({ value: e.id, label: `${e.name} (${e.status})` }))}
      value=${selectedId}
      onChange=${(e) => onChange(e.target.value)}
    />
  `;
}

export function Insights({ params }) {
  const t = useT();
  const locale = useLocale();
  const { experiments, loading: experimentsLoading } = useExperiments();
  const eligible = experiments.filter((e) => e.status !== "draft");
  const [selectedId, setSelectedId] = useState(params?.id ?? null);
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [participantsError, setParticipantsError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const experiment = useMemo(
    () => experiments.find((e) => e.id === (params?.id ?? selectedId)) ?? (!params?.id ? eligible[0] : null),
    [experiments, params?.id, selectedId]
  );

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

  const insights = useMemo(
    () => (experiment && !loadingParticipants && !participantsError ? generateInsights(experiment, participants, locale) : null),
    [experiment, participants, loadingParticipants, participantsError, locale]
  );

  if (experimentsLoading) return html`<${LoadingState} label=${t("common.loading")} />`;
  if (eligible.length === 0) {
    return html`<${EmptyState} title=${t("insights.emptyTitle")} body=${t("insights.emptyBody")} icon="insights"
      action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}>${t("insights.emptyCta")}<//>`} />`;
  }
  if (!experiment) {
    return html`<${EmptyState} title=${t("insights.notFoundTitle")} icon="insights" />`;
  }
  if (participantsError) {
    return html`<${EmptyState} title=${t("insights.participantsError")} icon="shield"
      action=${html`<${Button} onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}<//>`} />`;
  }
  if (loadingParticipants || !insights) {
    return html`<${LoadingState} label=${t("common.loadingAnswers")} />`;
  }

  return html`
    <div class="fade-in max-w-3xl">
      <${SectionHeading}
        title=${t("insights.title")}
        subtitle=${t("insights.subtitle")}
        action=${!params?.id && html`<${ExperimentPicker} experiments=${eligible} selectedId=${experiment.id} onChange=${setSelectedId} />`}
      />

      <div class="flex items-center gap-2 mb-6 flex-wrap">
        <span class="font-medium text-slate-200">${experiment.name}</span>
        <${Badge} tone="indigo">${researchTypeLabel(experiment.researchType, t)}<//>
        <button class="ml-auto text-sm text-indigo-400 hover:text-indigo-300" onClick=${() => navigate(`/app/experiments/${experiment.id}/results`)}>${t("insights.allResults")}</button>
      </div>

      <div class="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-xs text-amber-200/90 mb-6 flex gap-2">
        <${Icon} name="shield" size=${15} className="shrink-0 mt-0.5" />
        <span>${insights.disclaimer}</span>
      </div>

      <${AiSummaryCard} experimentId=${experiment.id} t=${t} />

      <${Card} className="p-5 mb-5">
        <div class="flex items-center gap-2 mb-3">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300"><${Icon} name="results" size=${15} /></div>
          <h3 class="font-semibold text-slate-100">${t("insights.whatHappened")}</h3>
        </div>
        <ul class="space-y-2.5">
          ${insights.whatHappened.map((line, i) => html`<li key=${i} class="flex gap-2.5 text-sm text-slate-300"><span class="text-indigo-400 mt-0.5">•</span><span>${line}</span></li>`)}
        </ul>
      <//>

      <${Card} className="p-5 mb-5">
        <div class="flex items-center gap-2 mb-3">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300"><${Icon} name="sparkle" size=${15} /></div>
          <h3 class="font-semibold text-slate-100">${t("insights.whyItMightHaveHappened")}</h3>
        </div>
        <ul class="space-y-2.5">
          ${insights.whyMightHaveHappened.map((line, i) => html`<li key=${i} class="flex gap-2.5 text-sm text-slate-300"><span class="text-teal-400 mt-0.5">•</span><span>${line}</span></li>`)}
        </ul>
        <p class="text-xs text-slate-500 mt-4 italic">${t("insights.causalDisclaimer")}</p>
      <//>

      <${Card} className="p-5 border-indigo-500/30 bg-indigo-500/[0.04]">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300"><${Icon} name="check" size=${15} /></div>
            <h3 class="font-semibold text-slate-100">${t("insights.recommendationTitle")}</h3>
          </div>
          <${ConfidenceBadge} confidence=${insights.recommendation.confidence} t=${t} />
        </div>
        <p class="text-sm text-slate-200 leading-relaxed">${insights.recommendation.text}</p>
      <//>
    </div>
  `;
}
