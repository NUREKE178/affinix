import { html, useState } from "../lib/preact.js";
import { useExperiments } from "../lib/experimentsStore.js";
import { useOrgSessions } from "../lib/participants.js";
import { useMyProfile } from "../lib/profile.js";
import { useSession } from "../lib/auth.js";
import { useT, useLocale } from "../lib/i18n.js";
import { navigate } from "../router.js";
import { Card, SectionHeading, StatTile, Badge, Button, EmptyState, Skeleton, ProgressBar } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { DonutChart, LineChart, SERIES_COLORS } from "../components/charts.js";
import { experimentSummary, completedParticipants, averageCompletionTimeMs } from "../lib/stats.js";
import { pct, durationFromMs, relativeDate } from "../lib/format.js";
import { researchTypeLabel } from "../lib/questionTypes.js";
import { useArenaLocal } from "../lib/arenaStore.js";
import { CrowdSection } from "./crowd/Section.js";
import { CreateChooser } from "./crowd/Chooser.js";
import { ResearchTabs } from "../components/subNav.js";

/** A doorway to the Arena: today's daily challenge, the streak, one key. Reads local progress only (no network). */
function ArenaCard({ t }) {
  const { view } = useArenaLocal();
  const done = view?.daily.votes ?? 0;
  const size = view?.daily.size ?? 10;
  return html`
    <${Card} className="p-5" data-testid="overview-arena">
      <div class="flex items-center gap-2.5">
        <span class="sk-tile"><${Icon} name="arena" size=${15} /></span>
        <span class="sk-caption">${t("arena.title")}</span>
        ${view && view.streak > 0 && html`<span class="ml-auto inline-flex items-center gap-1.5 text-sm text-graphite-200 sk-num"><${Icon} name="flame" size=${14} className="text-signal-400" />${view.streak}</span>`}
      </div>
      <p class="mt-3 text-sm leading-relaxed text-graphite-300">${t("arena.promo")}</p>
      ${view && html`
        <div class="mt-4 flex items-center gap-3">
          <div class="sk-display h-2 flex-1 overflow-hidden rounded-full"><div class="h-full rounded-full" style=${{ width: `${(Math.min(done, size) / size) * 100}%`, background: "linear-gradient(180deg,#ff8f55,#ff6a1f)" }}></div></div>
          <span class="sk-num text-xs text-graphite-300">${Math.min(done, size)}<span class="sk-unit">/ ${size}</span></span>
        </div>`}
      <div class="mt-4"><${Button} variant="secondary" onClick=${() => navigate("/app/arena")} data-testid="overview-arena-open">${t("arena.promoCta")}<//></div>
    <//>
  `;
}

function firstName(profile, user) {
  const full = profile?.full_name;
  if (full) return full.split(/\s+/)[0];
  return user?.email?.split("@")[0] ?? "";
}

const STATUS_TONE = { published: "emerald", completed: "steel", draft: "neutral", paused: "amber", archived: "neutral" };
const STATUS_KEY = { published: "statusActive", completed: "statusCompleted", draft: "statusDraft", paused: "statusPaused" };

function StatusBadge({ status, t }) {
  return html`<${Badge} tone=${STATUS_TONE[status] ?? "neutral"}>${STATUS_KEY[status] ? t(`overview.${STATUS_KEY[status]}`) : status}<//>`;
}

const DATE_TAGS = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

function dailyCompletionSeries(participants, locale) {
  const days = 14;
  const buckets = new Array(days).fill(0);
  const now = Date.now();
  for (const p of participants) {
    if (p.status !== "completed" || !p.completedAt) continue;
    const diffDays = Math.floor((now - new Date(p.completedAt).getTime()) / 86400000);
    if (diffDays >= 0 && diffDays < days) buckets[days - 1 - diffDays]++;
  }
  const labels = buckets.map((_, i) => {
    const d = new Date(now - (days - 1 - i) * 86400000);
    return d.toLocaleDateString(DATE_TAGS[locale] ?? "ru-RU", { month: "short", day: "numeric" });
  });
  return { labels, data: buckets };
}

export function Overview() {
  const t = useT();
  const [chooser, setChooser] = useState(false);
  const locale = useLocale();
  const { experiments, loading: experimentsLoading } = useExperiments();
  const { sessions: participants, loading: sessionsLoading } = useOrgSessions();
  const { profile } = useMyProfile();
  const { user } = useSession();

  const activeCount = experiments.filter((e) => e.status === "published").length;
  const completedCount = experiments.filter((e) => e.status === "completed").length;
  const draftCount = experiments.filter((e) => e.status === "draft").length;
  const pausedCount = experiments.filter((e) => e.status === "paused").length;

  const allCompletedParticipants = completedParticipants(participants);
  const totalStarted = participants.length;
  const responseRate = totalStarted ? allCompletedParticipants.length / totalStarted : 0;
  const avgCompletionMs = averageCompletionTimeMs(participants);

  const summaries = experiments.map((e) => ({ experiment: e, summary: experimentSummary(e, participants) }));

  const recent = summaries.slice().sort((a, b) => new Date(b.experiment.updatedAt) - new Date(a.experiment.updatedAt)).slice(0, 5);

  const topVariants = summaries
    .filter((s) => s.summary.topVariant && s.summary.participantCount > 0)
    .map((s) => ({ ...s.summary.topVariant, experimentName: s.experiment.name, experimentId: s.experiment.id, participantCount: s.summary.participantCount, sufficient: s.summary.sampleSize.sufficient }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  const series = dailyCompletionSeries(participants, locale);

  const mostRecentWithResults = summaries
    .filter((s) => s.experiment.status !== "draft" && s.summary.participantCount > 0)
    .sort((a, b) => new Date(b.experiment.updatedAt) - new Date(a.experiment.updatedAt))[0];

  return html`
    <div class="fade-in">
      <${ResearchTabs} current="overview" />
      <${SectionHeading}
        title=${t("overview.welcome", { name: firstName(profile, user) ? `, ${firstName(profile, user)}` : "" })}
        subtitle=${t("overview.subtitle")}
        action=${html`
          <div class="flex flex-wrap items-center gap-2">
            ${mostRecentWithResults && html`
              <${Button} variant="secondary" onClick=${() => navigate(`/app/experiments/${mostRecentWithResults.experiment.id}/results`)}>
                <${Icon} name="results" size=${16}/> ${t("overview.openLatestResults")}
              <//>
            `}
            <${Button} onClick=${() => setChooser(true)} data-testid="overview-new"><${Icon} name="plus" size=${16}/> ${t("overview.newResearch")}<//>
          </div>
        `}
      />

      <${CreateChooser} open=${chooser} onClose=${() => setChooser(false)} />
      <${CrowdSection} />

      <${SectionHeading} title=${t("overview.classicTitle")} subtitle=${t("overview.classicSubtitle")} />
      <div class="sk-stat-strip mb-6">
        <${StatTile} label=${t("overview.stat.active")} value=${activeCount} hint=${t("overview.stat.activeHint", { drafts: draftCount, paused: pausedCount })} />
        <${StatTile} label=${t("overview.stat.completedParticipants")} value=${allCompletedParticipants.length.toLocaleString()} hint=${t("overview.stat.completedHint", { total: totalStarted.toLocaleString() })} />
        <${StatTile} label=${t("overview.stat.completionRate")} value=${pct(responseRate)} hint=${t("overview.stat.completionHint")} />
        <${StatTile} label=${t("overview.stat.avgTime")} value=${durationFromMs(avgCompletionMs)} hint=${t("overview.stat.avgTimeHint")} />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 space-y-5">
          <${Card} className="p-5">
            <${SectionHeading} title=${t("overview.chartTitle")} subtitle=${t("overview.chartSubtitle")} />
            <${LineChart} labels=${series.labels} data=${series.data} color=${SERIES_COLORS[0]} height=${210} />
          <//>

          <${Card} className="p-5">
            <${SectionHeading}
              title=${t("overview.recentTitle")}
              action=${html`<button class="text-sm text-signal-400 hover:text-signal-300" onClick=${() => navigate("/app/experiments")}>${t("overview.recentAll")}<//>`}
            />
            ${experimentsLoading
              ? html`
                <div class="divide-y divide-graphite-800">
                  ${[0, 1, 2].map((i) => html`
                    <div key=${i} class="flex items-center justify-between gap-4 py-3">
                      <div class="min-w-0 flex-1">
                        <${Skeleton} className="h-4 w-48" />
                        <${Skeleton} className="h-3 w-32 mt-2" />
                      </div>
                      <${Skeleton} className="h-4 w-16 shrink-0" />
                    </div>
                  `)}
                </div>
              `
              : recent.length === 0
              ? html`<${EmptyState} title=${t("overview.recentEmptyTitle")} body=${t("overview.recentEmptyBody")} icon="experiments"
                  action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}>${t("overview.recentEmptyCta")}<//>`} />`
              : html`
                <div class="divide-y divide-graphite-800">
                  ${recent.map(
                    ({ experiment: e, summary }) => html`
                      <button key=${e.id} onClick=${() => navigate(e.status === "draft" ? `/app/experiments/${e.id}/edit` : `/app/experiments/${e.id}/results`)}
                        class="flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-graphite-800/40 rounded-lg px-2 -mx-2">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-sm text-graphite-100 truncate">${e.name}</span>
                            <${StatusBadge} status=${e.status} t=${t} />
                          </div>
                          <div class="text-xs text-graphite-500 mt-0.5">${researchTypeLabel(e.researchType, t)} · ${relativeDate(e.updatedAt)}</div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="sk-num text-sm text-graphite-200">${t("overview.participantsOf", { count: summary.participantCount, target: e.participantSettings.targetCount })}</div>
                          <div class="text-xs text-graphite-500">${t("overview.participantsLabel")}</div>
                        </div>
                      </button>
                    `
                  )}
                </div>
              `}
          <//>
        </div>

        <div class="space-y-5">
          <${ArenaCard} t=${t} />
          <${Card} className="p-5">
            <${SectionHeading} title=${t("overview.statusTitle")} />
            <${DonutChart}
              labels=${[t("overview.statusActive"), t("overview.statusCompleted"), t("overview.statusDraft"), t("overview.statusPaused")]}
              data=${[activeCount, completedCount, draftCount, pausedCount]}
              colors=${["#34d399", "#86a5d9", "#4a4d56", "#fbbf24"]}
              height=${170}
              center=${{ label: t("overview.statusTotal") }}
            />
          <//>

          <${Card} className="p-5">
            <${SectionHeading} title=${t("overview.topVariantsTitle")} subtitle=${t("overview.topVariantsSubtitle")} />
            ${sessionsLoading
              ? html`
                <div class="space-y-3">
                  ${[0, 1, 2].map((i) => html`
                    <div key=${i}>
                      <div class="flex items-center justify-between">
                        <${Skeleton} className="h-4 w-36" />
                        <${Skeleton} className="h-4 w-8" />
                      </div>
                      <${Skeleton} className="h-2 w-full rounded-full mt-1.5" />
                    </div>
                  `)}
                </div>
              `
              : topVariants.length === 0
              ? html`<p class="text-sm text-graphite-500">${t("overview.topVariantsEmpty")}</p>`
              : html`
                <div class="space-y-3">
                  ${topVariants.map(
                    (v) => html`
                      <button key=${v.experimentId + v.variantId} onClick=${() => navigate(`/app/experiments/${v.experimentId}/results`)} class="w-full text-left">
                        <div class="flex items-center justify-between text-sm">
                          <span class="text-graphite-200 font-medium truncate pr-2">${v.name} <span class="text-graphite-500">· ${v.experimentName}</span></span>
                          <span class="sk-num text-graphite-300 shrink-0">${pct(v.rate)}</span>
                        </div>
                        <div class="mt-2"><${ProgressBar} value=${v.rate} /></div>
                        ${!v.sufficient && html`<div class="text-[11px] text-amber-400 mt-1">${t("overview.smallSample")}</div>`}
                      </button>
                    `
                  )}
                </div>
              `}
          <//>
        </div>
      </div>
    </div>
  `;
}
