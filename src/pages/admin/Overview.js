// How the platform is doing: people, content, research, the Arena, and what needs a decision.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Skeleton, Button } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { fetchAdminOverview } from "../../lib/platform.js";
import { AdminStats } from "../arena/AdminStats.js";
import { nf, AdminError } from "./parts.js";

function Strip({ title, items, testid }) {
  return html`
    <section class="adm-group" data-testid=${testid}>
      <div class="sk-caption mb-2">${title}</div>
      <div class="sk-stat-strip sk-stat-strip-well" style=${`--cols:${items.length}`}>
        ${items.map(([label, value, id]) => html`<div class="sk-stat" key=${label} data-testid=${id}><div class="sk-stat-label">${label}</div><div class="sk-stat-value">${nf(value)}</div></div>`)}
      </div>
    </section>
  `;
}

export function AdminOverview({ onOpenTab }) {
  const t = useT();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    setState({ loading: true, data: null, error: null });
    fetchAdminOverview().then((data) => !off && setState({ loading: false, data, error: null }), (error) => !off && setState({ loading: false, data: null, error }));
    return () => { off = true; };
  }, [tick]);

  if (state.error) return html`<${AdminError} error=${state.error} t=${t} onRetry=${() => setTick((n) => n + 1)} />`;
  if (state.loading) return html`<div class="space-y-4"><${Skeleton} className="h-20 w-full rounded-xl" /><${Skeleton} className="h-20 w-full rounded-xl" /><${Skeleton} className="h-20 w-full rounded-xl" /></div>`;
  const d = state.data;
  return html`
    <div class="adm-stack" data-testid="admin-overview">
      <section class="adm-attention sk-panel" data-testid="admin-attention" data-flagged=${d.testsFlagged}>
        <${Icon} name=${d.testsFlagged > 0 ? "shield" : "check"} size=${20} />
        <div class="adm-attention-text">
          <div class="adm-attention-title">${t("admin.overview.attention")}</div>
          <div class="adm-attention-body">${d.testsFlagged > 0 ? t("admin.overview.flaggedBody", { n: d.testsFlagged }) : t("admin.overview.allClear")}</div>
        </div>
        ${d.testsFlagged > 0 && html`<${Button} size="sm" onClick=${() => onOpenTab("moderation")} data-testid="admin-open-moderation">${t("admin.overview.openModeration")}<//>`}
      </section>

      <${Strip} testid="admin-kpi-people" title=${t("admin.overview.people")} items=${[
        [t("admin.overview.users"), d.users, "kpi-users"], [t("admin.overview.newUsers"), d.newUsers7d, "kpi-new"],
        [t("admin.overview.active"), d.active7d, "kpi-active"], [t("admin.overview.admins"), d.admins, "kpi-admins"]]} />
      <${Strip} testid="admin-kpi-content" title=${t("admin.overview.content")} items=${[
        [t("admin.overview.posts"), d.posts, "kpi-posts"], [t("admin.overview.comments"), d.comments, "kpi-comments"],
        [t("admin.overview.messages"), d.messages7d, "kpi-messages"], [t("admin.overview.friendships"), d.friendships, "kpi-friendships"]]} />
      <${Strip} testid="admin-kpi-research" title=${t("admin.overview.research")} items=${[
        [t("admin.overview.companies"), d.companies, "kpi-companies"], [t("admin.overview.experiments"), d.experiments, "kpi-experiments"],
        [t("admin.overview.responses"), d.responses, "kpi-responses"]]} />
      <${Strip} testid="admin-kpi-arena" title=${t("admin.overview.arena")} items=${[
        [t("admin.overview.players"), d.arenaPlayers, "kpi-players"], [t("admin.overview.testsOpen"), d.testsOpen, "kpi-tests"],
        [t("admin.overview.testsFlagged"), d.testsFlagged, "kpi-flagged"]]} />

      <${AdminStats} />
    </div>
  `;
}
