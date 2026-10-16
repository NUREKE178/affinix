import { html, useState } from "../lib/preact.js";
import { useExperiments, invalidateExperiments } from "../lib/experimentsStore.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { deleteExperiment as deleteExperimentApi, duplicateExperiment as duplicateExperimentApi, publishExperiment } from "../lib/experiments.js";
import { navigate } from "../router.js";
import { Card, SectionHeading, Badge, Button, EmptyState, Tabs, toast, Skeleton } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { relativeDate } from "../lib/format.js";
import { researchTypeLabel } from "../lib/questionTypes.js";
import { useT } from "../lib/i18n.js";

const STATUS_TONE = { published: "emerald", completed: "steel", draft: "neutral", paused: "amber", archived: "neutral" };
const STATUS_KEY = { published: "statusActive", completed: "statusCompleted", draft: "statusDraft", paused: "statusPaused" };

export function ExperimentsList({ query }) {
  const t = useT();
  const { org } = useCurrentOrg();
  const { experiments, loading } = useExperiments();
  const [filter, setFilter] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const q = (query?.get("q") ?? "").trim().toLowerCase();

  const FILTERS = [
    { id: "all", label: t("experiments.filters.all") },
    { id: "published", label: t("experiments.filters.active") },
    { id: "completed", label: t("experiments.filters.completed") },
    { id: "draft", label: t("experiments.filters.draft") },
    { id: "paused", label: t("experiments.filters.paused") },
  ];

  const filtered = filter === "all" ? experiments : experiments.filter((e) => e.status === filter);
  const searched = q ? filtered.filter((e) => e.name.toLowerCase().includes(q) || e.objective?.toLowerCase().includes(q)) : filtered;
  const sorted = searched.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  async function duplicate(e) {
    setBusyId(e.id);
    try {
      const copy = await duplicateExperimentApi(org.id, e);
      invalidateExperiments();
      navigate(`/app/experiments/${copy.id}/edit`);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusyId(null);
    }
  }

  async function publish(e) {
    setBusyId(e.id);
    try {
      await publishExperiment(e.id);
      invalidateExperiments();
      toast(t("experiments.published"));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(e) {
    setBusyId(e.id);
    try {
      await deleteExperimentApi(e);
      invalidateExperiments();
      setConfirmDelete(null);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusyId(null);
    }
  }

  return html`
    <div class="fade-in">
      <${SectionHeading}
        title=${t("experiments.title")}
        subtitle=${t("experiments.subtitle")}
        action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}><${Icon} name="plus" size=${16}/> ${t("experiments.newExperiment")}<//>`}
      />
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <${Tabs} tabs=${FILTERS} active=${filter} onChange=${setFilter} />
        ${q && html`
          <div class="flex items-center gap-2 text-sm text-graphite-400">
            ${t("experiments.searchPrefix")} <span class="text-graphite-200">«${q}»</span>
            <button class="text-signal-400 hover:text-signal-300" onClick=${() => navigate("/app/experiments")}>${t("experiments.searchReset")}<//>
          </div>
        `}
      </div>

      ${loading
        ? html`
          <div class="space-y-3">
            ${[0, 1, 2].map((i) => html`
              <${Card} key=${i} className="p-4 sm:p-5">
                <div class="flex items-center gap-2">
                  <${Skeleton} className="h-4 w-48" />
                  <${Skeleton} className="h-5 w-16 rounded-full" />
                </div>
                <${Skeleton} className="h-3 w-72 mt-2.5 max-w-full" />
                <div class="flex items-center gap-4 mt-3">
                  <${Skeleton} className="h-3 w-20" />
                  <${Skeleton} className="h-3 w-16" />
                  <${Skeleton} className="h-3 w-16" />
                  <${Skeleton} className="h-3 w-24" />
                </div>
              <//>
            `)}
          </div>
        `
        : sorted.length === 0
        ? html`<${EmptyState} title=${t("experiments.emptyTitle")} body=${t("experiments.emptyBody")} icon="experiments"
            action=${html`<${Button} onClick=${() => navigate("/app/experiments/new")}>${t("experiments.emptyCta")}<//>`} />`
        : html`
          <div class="space-y-3">
            ${sorted.map((e) => html`
              <${Card} key=${e.id} className="p-4 sm:p-5">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <button class="font-semibold text-graphite-100 hover:text-signal-300 text-left" onClick=${() => navigate(e.status === "draft" ? `/app/experiments/${e.id}/edit` : `/app/experiments/${e.id}/results`)}>${e.name}</button>
                      <${Badge} tone=${STATUS_TONE[e.status]}>${STATUS_KEY[e.status] ? t(`overview.${STATUS_KEY[e.status]}`) : e.status}<//>
                    </div>
                    <p class="text-sm text-graphite-500 mt-1 max-w-2xl">${e.objective}</p>
                    <div class="flex items-center gap-4 mt-3 text-xs text-graphite-500 flex-wrap">
                      <span>${researchTypeLabel(e.researchType, t)}</span>
                      <span>${t("experiments.variantsCount", { count: e.variants.length })}</span>
                      <span>${t("experiments.questionsCount", { count: e.questions.length })}</span>
                      <span>${t("experiments.updated", { when: relativeDate(e.updatedAt) })}</span>
                    </div>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0">
                    ${e.status === "draft"
                      ? html`
                        <${Button} size="sm" variant="secondary" disabled=${busyId===e.id} onClick=${() => navigate(`/app/experiments/${e.id}/edit`)}><${Icon} name="edit" size=${14}/> ${t("experiments.edit")}<//>
                        <${Button} size="sm" variant="primary" disabled=${busyId===e.id} onClick=${() => publish(e)}><${Icon} name="play" size=${14}/> ${t("experiments.publish")}<//>
                      `
                      : html`<${Button} size="sm" variant="secondary" onClick=${() => navigate(`/app/experiments/${e.id}/results`)}><${Icon} name="results" size=${14}/> ${t("experiments.results")}<//>`}
                    ${e.status !== "draft" && html`<button title=${t("experiments.copyLink")} class="p-2 rounded-lg text-graphite-400 hover:text-graphite-200 hover:bg-graphite-800" onClick=${() => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/research/${e.publicSlug}`); toast(t("experiments.linkCopied")); }}><${Icon} name="external" size=${15} /></button>`}
                    <button title=${t("experiments.duplicate")} disabled=${busyId===e.id} class="p-2 rounded-lg text-graphite-400 hover:text-graphite-200 hover:bg-graphite-800" onClick=${() => duplicate(e)}><${Icon} name="copy" size=${15} /></button>
                    <button title=${t("experiments.delete")} disabled=${busyId===e.id} class="p-2 rounded-lg text-graphite-400 hover:text-rose-400 hover:bg-graphite-800" onClick=${() => setConfirmDelete(e)}><${Icon} name="trash" size=${15} /></button>
                  </div>
                </div>
              <//>
            `)}
          </div>
        `}

      ${confirmDelete && html`
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-4" onClick=${(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <${Card} className="max-w-sm p-5">
            <div class="font-semibold text-graphite-100">${t("experiments.confirmDeleteTitle", { name: confirmDelete.name })}</div>
            <p class="text-sm text-graphite-500 mt-1.5">${t("experiments.confirmDeleteBody")}</p>
            <div class="flex justify-end gap-2 mt-5">
              <${Button} variant="secondary" size="sm" onClick=${() => setConfirmDelete(null)}>${t("common.cancel")}<//>
              <${Button} variant="danger" size="sm" disabled=${busyId===confirmDelete.id} onClick=${() => doDelete(confirmDelete)}>${t("common.delete")}<//>
            </div>
          <//>
        </div>
      `}
    </div>
  `;
}
