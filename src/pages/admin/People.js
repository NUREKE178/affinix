// Everyone on the platform: find a person, see who they are, and (the owner only) make or remove administrators.
import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { Button, Modal, Skeleton, EmptyState, toast } from "../../components/ui.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { PlatformBadge } from "../../components/platformBadge.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { shortDate } from "../../lib/format.js";
import { fetchAdminUsers, setPlatformAdmin } from "../../lib/platform.js";
import { nf, AdminError } from "./parts.js";

const PAGE = 30;

export function AdminPeople({ isOwner, meId }) {
  const t = useT();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: true, rows: [], total: 0, error: null, loadingMore: false });
  const [confirm, setConfirm] = useState(null); // { row, grant }
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  // the box is read after a short pause in typing
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchAdminUsers({ query, limit: PAGE, offset: 0 }).then(
      (r) => { if (seq.current === mine) setState({ loading: false, rows: r.rows, total: r.total, error: null, loadingMore: false }); },
      (error) => { if (seq.current === mine) setState({ loading: false, rows: [], total: 0, error, loadingMore: false }); }
    );
  }, [query, tick]);

  async function loadMore() {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const r = await fetchAdminUsers({ query, limit: PAGE, offset: state.rows.length });
      if (seq.current === mine) setState((s) => ({ ...s, rows: [...s.rows, ...r.rows.filter((x) => !s.rows.some((y) => y.id === x.id))], total: r.total, loadingMore: false }));
    } catch (error) {
      if (seq.current === mine) { setState((s) => ({ ...s, loadingMore: false })); toast(t("admin.errorBody"), "rose"); }
    }
  }

  async function apply() {
    const { row, grant } = confirm;
    setBusy(true);
    try {
      await setPlatformAdmin(row.id, grant);
      setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, isAdmin: grant } : r)) }));
      toast(t(grant ? "admin.people.granted" : "admin.people.revoked", { name: row.name ?? row.username ?? row.email }), "emerald");
      setConfirm(null);
    } catch (err) {
      toast(t(`admin.people.err.${err.code ?? "generic"}`), "rose");
    } finally {
      setBusy(false);
    }
  }

  if (state.error) return html`<${AdminError} error=${state.error} t=${t} onRetry=${() => setTick((n) => n + 1)} />`;
  const nameOf = (r) => r.name || r.username || r.email || "—";

  return html`
    <div class="adm-stack" data-testid="admin-people">
      <div class="adm-toolbar">
        <div class="adm-search sk-display">
          <${Icon} name="search" size=${16} />
          <input type="search" value=${text} onInput=${(e) => setText(e.currentTarget.value)} placeholder=${t("admin.people.search")} aria-label=${t("admin.people.search")} data-testid="admin-people-search" />
        </div>
        <span class="adm-count" data-testid="admin-people-count">${t("admin.people.found", { count: nf(state.total) })}</span>
      </div>
      ${!isOwner && html`<p class="adm-note">${t("admin.people.onlyOwner")}</p>`}

      ${state.loading && state.rows.length === 0
        ? html`<div class="space-y-2">${[0, 1, 2, 3].map((i) => html`<${Skeleton} key=${i} className="h-16 w-full rounded-xl" />`)}</div>`
        : state.rows.length === 0
          ? html`<${EmptyState} title=${t("admin.people.emptyTitle")} body=${t("admin.people.emptyBody")} icon="search" />`
          : html`
            <div class="adm-list sk-panel sk-stagger" data-testid="admin-people-list">
              ${state.rows.map((r) => html`
                <div class="adm-person" key=${r.id} data-testid="admin-person" data-username=${r.username ?? ""} data-admin=${r.isAdmin} data-owner=${r.isOwner}>
                  <${PersonLink} who=${{ id: r.id, name: r.name, username: r.username, avatarUrl: r.avatarUrl }} className="adm-person-who">
                    <${Avatar} name=${r.name ?? r.email} url=${r.avatarUrl} size=${38} />
                    <span class="adm-person-text">
                      <span class="adm-person-name sk-person-name">${nameOf(r)}${r.id === meId ? html` <i class="adm-you">${t("admin.people.you")}</i>` : null}</span>
                      <span class="adm-person-sub">${r.username ? `@${r.username} · ` : ""}${r.email ?? ""}</span>
                    </span>
                  <//>
                  <div class="adm-person-meta">
                    ${r.company && html`<span class="adm-chip" title=${t("admin.people.company")}>${r.company}${r.companyRole ? ` · ${t(`team.roles.${r.companyRole}`)}` : ""}</span>`}
                    <span class="adm-stat sk-num">${t("admin.people.posts", { n: nf(r.posts) })}</span>
                    <span class="adm-stat sk-num">${nf(r.xp)} XP</span>
                    <span class="adm-stat">${t("admin.people.joined", { date: shortDate(r.joinedAt) })}</span>
                  </div>
                  <div class="adm-person-act">
                    <${PlatformBadge} role=${r.isOwner ? "owner" : r.isAdmin ? "admin" : null} />
                    ${isOwner && !r.isOwner && html`
                      <${Button} size="sm" variant="secondary" data-testid=${r.isAdmin ? "admin-revoke" : "admin-grant"} onClick=${() => setConfirm({ row: r, grant: !r.isAdmin })}>
                        ${t(r.isAdmin ? "admin.people.revoke" : "admin.people.grant")}
                      <//>`}
                  </div>
                </div>`)}
            </div>
            ${state.rows.length < state.total && html`<div class="adm-more"><${Button} variant="secondary" size="sm" loading=${state.loadingMore} onClick=${loadMore} data-testid="admin-people-more">${t("admin.people.loadMore")}<//></div>`}`}

      <${Modal} open=${!!confirm} onClose=${() => !busy && setConfirm(null)} title=${confirm ? t(confirm.grant ? "admin.people.confirmGrantTitle" : "admin.people.confirmRevokeTitle", { name: nameOf(confirm.row) }) : ""}
        footer=${html`<${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => setConfirm(null)}>${t("common.cancel")}<//><${Button} size="sm" loading=${busy} onClick=${apply} data-testid="admin-confirm">${t("common.continue")}<//>`}>
        <p class="text-sm text-graphite-400">${confirm ? t(confirm.grant ? "admin.people.confirmGrantBody" : "admin.people.confirmRevokeBody") : ""}</p>
      <//>
    </div>
  `;
}
