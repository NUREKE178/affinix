import { html, useState, useMemo, useEffect } from "../lib/preact.js";
import { useExperiments } from "../lib/experimentsStore.js";
import { fetchSessionsForExperiment, watchExperimentLive } from "../lib/participants.js";
import { navigate } from "../router.js";
import { Card, SectionHeading, StatTile, Badge, Select, Button, EmptyState, LoadingState } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { BarChart, DonutChart, SERIES_COLORS } from "../components/charts.js";
import {
  completedParticipants, experimentSummary, statsForQuestion, segmentBreakdown, responseTimeFor, primarySelectionQuestion,
} from "../lib/stats.js";
import { pct, pts, num, durationFromMs, money } from "../lib/format.js";
import { researchTypeLabel } from "../lib/questionTypes.js";
import { useT } from "../lib/i18n.js";
import { withTimeout } from "../lib/async.js";

const VARIANT_COLORS = SERIES_COLORS;
const STATUS_KEY = { published: "statusActive", completed: "statusCompleted", draft: "statusDraft", paused: "statusPaused" };

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

function QuestionCard({ experiment, participants, question, index, t }) {
  const result = statsForQuestion(experiment, participants, question);
  const segmentOptions = [
    { value: "ageRange", label: t("results.segmentAge") },
    { value: "country", label: t("results.segmentCountry") },
    { value: "language", label: t("results.segmentLanguage") },
  ];
  return html`
    <${Card} className="p-5">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <div class="text-xs text-graphite-500 mb-1">Q${index + 1} · ${question.type.replace("_", " ")}${question.role ? ` · ${question.role}` : ""}</div>
          <div class="font-medium text-graphite-100">${question.prompt || t("results.untitledQuestion")}</div>
        </div>
      </div>

      ${result.kind === "choice" && html`
        <div class="grid sm:grid-cols-2 gap-5">
          <${BarChart}
            labels=${result.data.rows.map((r) => `${r.label}`)}
            data=${result.data.rows.map((r) => Math.round(r.rate * 1000) / 10)}
            colors=${result.data.rows.map((r) => r.color)}
            height=${180}
          />
          <div class="space-y-2">
            ${result.data.rows.map(
              (r) => html`
                <div key=${r.variantId} class="flex items-center justify-between text-sm border-b border-graphite-800/60 pb-2 last:border-0">
                  <span class="text-graphite-300">${r.label} — ${r.name}</span>
                  <span class="text-graphite-400">${pct(r.rate)} <span class="text-graphite-600">(${t("common.ci")} ${pct(r.ci[0])}–${pct(r.ci[1])})</span></span>
                </div>
              `
            )}
            ${!result.data.sufficient && html`<p class="text-xs text-amber-400 mt-1">${t("stats.insufficientSample")}</p>`}
          </div>
        </div>
      `}

      ${result.kind === "rating" && html`
        <${BarChart}
          labels=${result.data.map((r) => r.label ?? r.name)}
          data=${result.data.map((r) => r.mean ? Math.round(r.mean * 100) / 100 : 0)}
          colors=${VARIANT_COLORS}
          suffix=""
          height=${180}
        />
        <div class="flex gap-5 mt-3 text-xs text-graphite-500 flex-wrap">
          ${result.data.map((r) => html`<span key=${r.variantId ?? r.name}>${r.label ?? r.name}: mean ${num(r.mean, 2)}, median ${num(r.median, 1)} (n=${r.n})</span>`)}
        </div>
      `}

      ${result.kind === "yesno" && html`
        <div class="space-y-2">
          ${result.data.map(
            (r) => html`
              <div key=${r.variantId ?? "overall"} class="flex items-center justify-between text-sm">
                <span class="text-graphite-300">${r.label ? `${r.label} — ${r.name}` : t("results.noAnswer")}</span>
                <span class="text-graphite-400">${pct(r.rate)} (n=${r.n})</span>
              </div>
            `
          )}
        </div>
      `}

      ${result.kind === "ranking" && html`
        <div class="space-y-2">
          ${result.data.map(
            (r, i) => html`
              <div key=${r.variantId} class="flex items-center justify-between text-sm">
                <span class="text-graphite-300">#${i + 1} ${r.label} — ${r.name}</span>
                <span class="text-graphite-400">avg. rank ${num(r.avgRank, 2)} (n=${r.n})</span>
              </div>
            `
          )}
        </div>
      `}

      ${result.kind === "distribution" && html`
        <${BarChart}
          labels=${result.data.rows.map((r) => r.option)}
          data=${result.data.rows.map((r) => Math.round(r.rate * 1000) / 10)}
          colors=${result.data.rows.map((_, i) => VARIANT_COLORS[i % VARIANT_COLORS.length])}
          horizontal=${true}
          height=${Math.max(140, result.data.rows.length * 34)}
        />
      `}

      ${result.kind === "price" && html`
        ${result.data.rows
          ? html`<${BarChart} labels=${result.data.rows.map((r) => r.option)} data=${result.data.rows.map((r) => Math.round(r.rate * 1000) / 10)} colors=${VARIANT_COLORS} height=${160} />`
          : html`<p class="text-sm text-graphite-400">${t("results.priceAverage", { mean: money(result.data.mean), median: money(result.data.median), n: result.data.n })}</p>`}
      `}

      ${result.kind === "text" && html`
        <div class="flex flex-wrap gap-2">
          ${result.data.length === 0
            ? html`<p class="text-sm text-graphite-500">${t("results.noResponses")}</p>`
            : result.data.slice(0, 24).map((txt, i) => html`<span key=${i} class="rounded-full bg-graphite-800 px-3 py-1 text-xs text-graphite-300">"${txt}"</span>`)}
        </div>
      `}
    <//>
  `;
}

export function Results({ params }) {
  const t = useT();
  const { experiments, loading: experimentsLoading } = useExperiments();
  const eligible = experiments.filter((e) => e.status !== "draft");
  const [selectedId, setSelectedId] = useState(params?.id ?? null);
  const [segmentKey, setSegmentKey] = useState("ageRange");
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [participantsError, setParticipantsError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [live, setLive] = useState(false);

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

  // Live results: a participant finishing (or answering) shows up here by
  // itself. Refetches quietly -- no spinner, and a failed background refresh
  // keeps the numbers already on screen.
  useEffect(() => {
    if (!experiment?.id) { setLive(false); return undefined; }
    let cancelled = false;
    const unsub = watchExperimentLive(
      experiment.id,
      () => {
        fetchSessionsForExperiment(experiment.id)
          .then((sessions) => { if (!cancelled) { setParticipants(sessions); setParticipantsError(false); } })
          .catch(() => {});
      },
      (isLive) => { if (!cancelled) setLive(isLive); }
    );
    return () => { cancelled = true; setLive(false); unsub(); };
  }, [experiment?.id]);

  const completed = useMemo(() => completedParticipants(participants), [participants]);

  if (experimentsLoading) return html`<${LoadingState} label=${t("common.loading")} />`;
  if (eligible.length === 0) {
    return html`<${EmptyState} title=${t("results.emptyTitle")} body=${t("results.emptyBody")} icon="results"
      action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}>${t("results.emptyCta")}<//>`} />`;
  }
  if (!experiment) {
    return html`<${EmptyState} title=${t("results.notFoundTitle")} body=${t("results.notFoundBody")} icon="results" />`;
  }

  const summary = experimentSummary(experiment, participants);
  const selQ = primarySelectionQuestion(experiment);
  const segments = selQ ? segmentBreakdown(experiment, completed, selQ.id, segmentKey) : [];
  const rt = selQ ? responseTimeFor(completed, selQ.id) : null;
  const SEGMENT_OPTIONS = [
    { value: "ageRange", label: t("results.segmentAge") },
    { value: "country", label: t("results.segmentCountry") },
    { value: "language", label: t("results.segmentLanguage") },
  ];

  return html`
    <div class="fade-in">
      <${SectionHeading}
        title=${t("results.title")}
        subtitle=${t("results.subtitle")}
        action=${!params?.id && html`<${ExperimentPicker} experiments=${eligible} selectedId=${experiment.id} onChange=${setSelectedId} />`}
      />

      <div class="flex items-center gap-2 mb-4 flex-wrap">
        <span class="font-medium text-graphite-200">${experiment.name}</span>
        <${Badge} tone=${experiment.status === "published" ? "emerald" : "steel"}>${STATUS_KEY[experiment.status] ? t(`overview.${STATUS_KEY[experiment.status]}`) : experiment.status}<//>
        <span class="text-sm text-graphite-500">${researchTypeLabel(experiment.researchType, t)}</span>
        ${live && html`<span class="sk-live-badge" title=${t("results.liveHint")}><span class="sk-live-dot"></span>${t("results.live")}</span>`}
      </div>

      ${participantsError
        ? html`
        <div class="mb-5 flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <span class="flex items-center gap-2"><${Icon} name="shield" size=${16} /> ${t("results.participantsError")}</span>
          <button class="font-medium underline shrink-0" onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}</button>
        </div>
      `
        : loadingParticipants
        ? html`<${LoadingState} label=${t("common.loadingAnswers")} className="mb-4" />`
        : !summary.sampleSize.sufficient && html`
        <div class="mb-5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <${Icon} name="shield" size=${16} /> ${t("results.insufficientSample", { n: summary.sampleSize.n, threshold: summary.sampleSize.threshold })}
        </div>
      `}

      <div class="sk-stat-strip mb-6">
        <${StatTile} label=${t("results.statCompleted")} value=${summary.participantCount} hint=${t("results.statCompletedHint", { target: experiment.participantSettings.targetCount })} />
        <${StatTile} label=${t("results.statCompletionRate")} value=${pct(summary.completion.rate)} hint=${t("results.statCompletionHint", { total: summary.completion.total })} />
        <${StatTile} label=${t("results.statAvgTime")} value=${durationFromMs(summary.avgCompletionTimeMs)} />
        <${StatTile} label=${t("results.statAvgDecisionTime")} value=${rt ? durationFromMs(rt.meanMs) : "—"} hint=${t("results.statAvgDecisionHint")} />
      </div>

      <div class="space-y-5">
        ${experiment.questions.map((q, i) => html`<${QuestionCard} key=${q.id} experiment=${experiment} participants=${completed} question=${q} index=${i} t=${t} />`)}

        <${Card} className="p-5">
          <${SectionHeading}
            title=${t("results.segmentsTitle")}
            subtitle=${t("results.segmentsSubtitle")}
            action=${html`<${Select} className="w-auto" options=${SEGMENT_OPTIONS} value=${segmentKey} onChange=${(e) => setSegmentKey(e.target.value)} />`}
          />
          <div class="space-y-4">
            ${segments.map(
              (seg) => html`
                <div key=${seg.segment}>
                  <div class="flex items-center justify-between text-sm mb-1.5">
                    <span class="text-graphite-300 font-medium">${seg.segment}</span>
                    <span class="text-graphite-500">n=${seg.n}${!seg.sufficient ? ` · ${t("results.smallSample")}` : ""}</span>
                  </div>
                  <div class="sk-display flex h-2.5 w-full overflow-hidden rounded-full">
                    ${seg.rows.map((r) => html`<div key=${r.variantId} style=${{ width: `${r.rate * 100}%`, background: r.color }} title=${`${r.label}: ${pct(r.rate)}`}></div>`)}
                  </div>
                </div>
              `
            )}
          </div>
        <//>
      </div>
    </div>
  `;
}
