// Admins: crowd tests that players reported (three different reports hide a test until someone decides).
import { html, useState, useEffect } from "../../lib/preact.js";
import { Button, Badge, Skeleton, toast } from "../../components/ui.js";
import { useT } from "../../lib/i18n.js";
import { fetchFlagged, moderateTest } from "../../lib/crowdStore.js";
import { StatusBadge, OptionThumb } from "./parts.js";

export function CrowdModeration() {
  const t = useT();
  const [state, setState] = useState({ loading: true, list: [], error: null });
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      setState({ loading: false, list: (await fetchFlagged()) ?? [], error: null });
    } catch (error) {
      setState({ loading: false, list: [], error });
    }
  }
  useEffect(() => { load(); }, []);

  async function decide(x, action) {
    setBusy(x.id);
    try {
      await moderateTest(x.id, action);
      await load();
    } catch {
      toast(t("crowd.err.generic"), "rose");
    } finally {
      setBusy(null);
    }
  }

  if (state.error) return null; // the migration is not applied yet: nothing to moderate
  return html`
    <section class="ar-admin sk-panel" data-testid="crowd-moderation">
      <div class="ar-admin-head"><span class="sk-caption">${t("crowd.admin.title")}</span><${Badge} tone="steel">${t("arena.admin.badge")}<//></div>
      ${state.loading
        ? html`<${Skeleton} className="h-16 w-full rounded-lg" />`
        : state.list.length === 0
          ? html`<p class="ar-muted" data-testid="crowd-moderation-empty">${t("crowd.admin.empty")}</p>`
          : html`
            <div class="cr-mod-list">
              ${state.list.map((x) => html`
                <div class="cr-mod-row" key=${x.id} data-testid="crowd-moderation-row" data-status=${x.status}>
                  <div class="cr-mod-thumbs">${(x.items ?? []).map((it, i) => html`<${OptionThumb} key=${it.id} item=${{ ...it, pos: i }} size=${40} />`)}</div>
                  <div class="cr-mod-main">
                    <div class="cr-mod-title">${x.title} <${StatusBadge} status=${x.status} t=${t} /></div>
                    <div class="cr-mod-sub">${x.owner?.name ?? "—"} · ${t("crowd.admin.reports", { n: x.reports })}${(x.reasons ?? []).length ? ` · ${x.reasons.map((r) => `“${r}”`).join(" ")}` : ""}</div>
                  </div>
                  <div class="cr-mod-actions">
                    ${x.status !== "removed" && html`<${Button} size="sm" variant="danger" loading=${busy === x.id} onClick=${() => decide(x, "remove")} data-testid="crowd-moderation-remove">${t("crowd.admin.remove")}<//>`}
                    ${(x.status === "removed" || x.status === "flagged" || x.reports > 0) && html`<${Button} size="sm" variant="secondary" disabled=${busy === x.id} onClick=${() => decide(x, "restore")} data-testid="crowd-moderation-restore">${t("crowd.admin.restore")}<//>`}
                  </div>
                </div>`)}
            </div>`}
    </section>
  `;
}
