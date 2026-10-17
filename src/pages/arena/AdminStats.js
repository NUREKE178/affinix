// The Arena's usage numbers for admins: how long people stay in the Daily Challenge, and the crowd tests. Part of the admin panel.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Badge, Skeleton } from "../../components/ui.js";
import { useT } from "../../lib/i18n.js";
import { fetchAdminStats } from "../../lib/arenaStore.js";
import { nf } from "./parts.js";

export function AdminStats() {
  const t = useT();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let off = false;
    fetchAdminStats(14)
      .then((data) => !off && setState({ loading: false, data, error: null }))
      .catch((error) => !off && setState({ loading: false, data: null, error }));
    return () => { off = true; };
  }, []);
  if (state.error) return null;
  const days = state.data?.days ?? [];
  const last = days[days.length - 1];
  return html`
    <section class="ar-admin sk-panel" data-testid="arena-admin">
      <div class="ar-admin-head"><span class="sk-caption">${t("arena.admin.title")}</span><${Badge} tone="steel">${t("arena.admin.badge")}<//></div>
      <p class="ar-muted">${t("arena.admin.note")}</p>
      ${state.loading
        ? html`<${Skeleton} className="h-24 w-full rounded-lg" />`
        : html`
          <div class="sk-stat-strip sk-stat-strip-well" style="--cols:4">
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.players")}</div><div class="sk-stat-value">${nf(state.data.players)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.avg")}</div><div class="sk-stat-value">${last ? last.avgMinutes : "—"}<span class="sk-unit">${t("common.unitMin")}</span></div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.over1h")}</div><div class="sk-stat-value">${last ? last.over1h : "—"}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.over3h")}</div><div class="sk-stat-value">${last ? last.over3h : "—"}</div></div>
          </div>
          <div class="sk-stat-strip sk-stat-strip-well" style="--cols:2" data-testid="arena-admin-crowd">
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.tests")}</div><div class="sk-stat-value">${nf(state.data.tests ?? 0)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.testVotes")}</div><div class="sk-stat-value">${nf(state.data.testVotes ?? 0)}</div></div>
          </div>
          <div class="ar-admin-table" role="table">
            <div class="ar-admin-tr ar-admin-th" role="row"><span>${t("arena.admin.day")}</span><span>${t("arena.admin.players")}</span><span>${t("arena.admin.votes")}</span><span>${t("arena.admin.avg")}</span><span>≥1h</span><span>≥3h</span></div>
            ${[...days].reverse().map((d) => html`<div class="ar-admin-tr sk-num" role="row" key=${d.day}><span>${d.day.slice(5)}</span><span>${d.players}</span><span>${d.votes}</span><span>${d.avgMinutes}</span><span>${d.over1h}</span><span>${d.over3h}</span></div>`)}
          </div>`}
    </section>
  `;
}
