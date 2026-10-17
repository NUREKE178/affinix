// What admins did, newest first: roles given and taken, posts and comments removed. Written by the database itself.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Skeleton, EmptyState } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { timeAgo } from "../../lib/format.js";
import { fetchAdminLog } from "../../lib/platform.js";
import { AdminError } from "./parts.js";

const ICON = { admin_granted: "userPlus", admin_revoked: "userCheck", post_removed: "trash", comment_removed: "trash", owner_set: "crown" };

export function AdminLog() {
  const t = useT();
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    setState({ loading: true, rows: [], error: null });
    fetchAdminLog(60).then((rows) => !off && setState({ loading: false, rows, error: null }), (error) => !off && setState({ loading: false, rows: [], error }));
    return () => { off = true; };
  }, [tick]);

  if (state.error) return html`<${AdminError} error=${state.error} t=${t} onRetry=${() => setTick((n) => n + 1)} />`;
  if (state.loading) return html`<div class="space-y-2">${[0, 1, 2].map((i) => html`<${Skeleton} key=${i} className="h-14 w-full rounded-xl" />`)}</div>`;
  if (state.rows.length === 0) return html`<${EmptyState} title=${t("admin.log.emptyTitle")} body=${t("admin.log.emptyBody")} icon="clock" />`;
  return html`
    <div class="adm-list sk-panel" data-testid="admin-log">
      ${state.rows.map((r) => html`
        <div class="adm-log" key=${r.id} data-testid="admin-log-row" data-action=${r.action}>
          <span class="adm-log-ic"><${Icon} name=${ICON[r.action] ?? "shield"} size=${16} /></span>
          <div class="adm-log-main">
            <div class="adm-log-title">${t(`admin.log.actions.${r.action}`) === `admin.log.actions.${r.action}` ? r.action : t(`admin.log.actions.${r.action}`)}</div>
            <div class="adm-log-sub">
              ${r.action !== "owner_set" && html`<span>${t("admin.log.by")}: <b>${r.actor.name ?? t("admin.log.system")}</b></span>`}
              <span>${t(r.action.endsWith("_removed") ? "admin.log.author" : "admin.log.target")}: <b>${r.target.name ?? "—"}</b></span>
            </div>
            ${r.meta?.excerpt && html`<p class="adm-log-quote">“${r.meta.excerpt}”</p>`}
          </div>
          <span class="adm-log-time" title=${new Date(r.at).toLocaleString()}>${timeAgo(r.at)}</span>
        </div>`)}
    </div>
  `;
}
