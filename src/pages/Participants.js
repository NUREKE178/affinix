import { html, useState, useMemo } from "../lib/preact.js";
import { useExperiments } from "../lib/experimentsStore.js";
import { useOrgSessions } from "../lib/participants.js";
import { Card, SectionHeading, StatTile, Badge, Select, Button, Skeleton } from "../components/ui.js";
import { durationFromMs, shortDate } from "../lib/format.js";
import { useT } from "../lib/i18n.js";

const STATUS_TONE = { completed: "emerald", in_progress: "amber", abandoned: "rose" };
const PAGE_SIZE = 20;

export function Participants() {
  const t = useT();
  const { experiments } = useExperiments();
  const { sessions: participants, loading } = useOrgSessions();
  const [experimentFilter, setExperimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);

  const STATUS_LABEL = { completed: t("participants.statusCompleted"), in_progress: t("participants.statusInProgress"), abandoned: t("participants.statusAbandoned") };

  const filtered = useMemo(() => {
    return participants.filter((p) => {
      if (experimentFilter !== "all" && p.experimentId !== experimentFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
  }, [participants, experimentFilter, statusFilter]);

  const sorted = filtered.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const completedCount = participants.filter((p) => p.status === "completed").length;
  const abandonedCount = participants.filter((p) => p.status === "abandoned").length;
  const inProgressCount = participants.length - completedCount - abandonedCount;

  function changeFilter(setter, value) { setter(value); setPage(0); }

  return html`
    <div class="fade-in">
      <${SectionHeading} title=${t("participants.title")} subtitle=${t("participants.subtitle")} />

      ${loading
        ? html`
          <div class="sk-stat-strip mb-6">
            ${[0, 1, 2, 3].map((i) => html`
              <div key=${i} class="sk-stat">
                <${Skeleton} className="h-3 w-24" />
                <${Skeleton} className="h-7 w-16 mt-2.5" />
              </div>
            `)}
          </div>
          <${Card} className="p-5">
            <div class="flex items-center gap-3 mb-4">
              <${Skeleton} className="h-9 w-48 rounded-lg" />
              <${Skeleton} className="h-9 w-40 rounded-lg" />
            </div>
            <div class="space-y-3">
              ${[0, 1, 2, 3, 4].map((i) => html`<${Skeleton} key=${i} className="h-9 w-full" />`)}
            </div>
          <//>
        `
        : html`
        <div class="sk-stat-strip mb-6">
          <${StatTile} label=${t("participants.statTotal")} value=${participants.length.toLocaleString()} />
          <${StatTile} label=${t("participants.statCompleted")} value=${completedCount.toLocaleString()} />
          <${StatTile} label=${t("participants.statInProgress")} value=${inProgressCount.toLocaleString()} />
          <${StatTile} label=${t("participants.statAbandoned")} value=${abandonedCount.toLocaleString()} />
        </div>

        <${Card} className="p-5">
          <div class="flex items-center gap-3 mb-4 flex-wrap">
            <${Select} className="w-auto min-w-[200px]"
              options=${[{ value: "all", label: t("participants.filterAllExperiments") }, ...experiments.map((e) => ({ value: e.id, label: e.name }))]}
              value=${experimentFilter} onChange=${(e) => changeFilter(setExperimentFilter, e.target.value)} />
            <${Select} className="w-auto"
              options=${[{ value: "all", label: t("participants.filterAllStatuses") }, { value: "completed", label: t("participants.statusCompleted") }, { value: "in_progress", label: t("participants.statusInProgress") }, { value: "abandoned", label: t("participants.statusAbandoned") }]}
              value=${statusFilter} onChange=${(e) => changeFilter(setStatusFilter, e.target.value)} />
            <span class="text-sm text-graphite-500 ml-auto">${t("participants.resultsCount", { count: sorted.length })}</span>
          </div>

          <div class="overflow-x-auto -mx-5">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-graphite-500 uppercase tracking-wide border-b border-graphite-800">
                  <th class="px-5 py-2 font-medium">${t("participants.columnExperiment")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnStatus")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnAge")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnCountry")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnLanguage")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnStarted")}</th>
                  <th class="px-3 py-2 font-medium">${t("participants.columnDuration")}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-graphite-800/70">
                ${pageRows.map((p) => {
                  const duration = p.completedAt ? new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime() : null;
                  return html`
                    <tr key=${p.id} class="hover:bg-graphite-800/30">
                      <td class="px-5 py-2.5 text-graphite-200 max-w-[220px] truncate">${p.experimentName ?? "—"}</td>
                      <td class="px-3 py-2.5"><${Badge} tone=${STATUS_TONE[p.status] ?? "neutral"}>${STATUS_LABEL[p.status] ?? p.status}<//></td>
                      <td class="px-3 py-2.5 text-graphite-400">${p.demographics?.ageRange ?? "—"}</td>
                      <td class="px-3 py-2.5 text-graphite-400">${p.demographics?.country ?? "—"}</td>
                      <td class="px-3 py-2.5 text-graphite-400">${p.demographics?.language ?? "—"}</td>
                      <td class="px-3 py-2.5 text-graphite-400">${shortDate(p.startedAt)}</td>
                      <td class="px-3 py-2.5 text-graphite-400">${duration ? durationFromMs(duration) : "—"}</td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between mt-4 pt-3 border-t border-graphite-800">
            <span class="text-xs text-graphite-500">${t("participants.pageOf", { page: page + 1, total: totalPages })}</span>
            <div class="flex gap-2">
              <${Button} size="sm" variant="secondary" disabled=${page === 0} onClick=${() => setPage((p) => p - 1)}>${t("participants.prev")}<//>
              <${Button} size="sm" variant="secondary" disabled=${page >= totalPages - 1} onClick=${() => setPage((p) => p + 1)}>${t("participants.next")}<//>
            </div>
          </div>
        <//>
      `}
    </div>
  `;
}
