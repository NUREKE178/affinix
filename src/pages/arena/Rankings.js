// Rankings tab: weekly / all-time XP, everyone or friends, plus (for admins) how long people actually stay.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Badge, Skeleton, Switch, Tabs, Button, EmptyState } from "../../components/ui.js";
import { Avatar } from "../../components/avatar.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { useMyProfile } from "../../lib/profile.js";
import { fetchLeaderboard, setLeaderboardVisibility, fetchAdminStats } from "../../lib/arenaStore.js";
import { toast } from "../../components/ui.js";
import { nf } from "./parts.js";

function Row({ r, t }) {
  return html`
    <div class="ar-row" data-me=${r.isMe} data-top=${r.rank <= 3} data-testid="arena-row">
      <span class="ar-row-rank sk-num">${r.rank}</span>
      <${Avatar} name=${r.name} url=${r.avatarUrl} size=${34} />
      <div class="ar-row-who">
        <div class="ar-row-name">${r.name ?? t("feed.unknownAuthor")}${r.isMe ? html` <span class="ar-row-you">${t("arena.rankings.you")}</span>` : null}</div>
        ${r.username && html`<div class="ar-row-user">@${r.username}</div>`}
      </div>
      ${r.streak > 0 && html`<span class="ar-row-streak sk-num" title=${t("arena.quests.streakTitle")}><${Icon} name="flame" size=${13} />${r.streak}</span>`}
      <span class="ar-row-level sk-num"><span class="sk-caption">${t("arena.level")}</span> ${r.level}</span>
      <span class="ar-row-xp sk-num">${nf(r.xp)}<span class="sk-unit">XP</span></span>
    </div>
  `;
}

function AdminStats() {
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
      ${state.loading
        ? html`<${Skeleton} className="h-24 w-full rounded-lg" />`
        : html`
          <div class="sk-stat-strip sk-stat-strip-well" style="--cols:4">
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.players")}</div><div class="sk-stat-value">${nf(state.data.players)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.avg")}</div><div class="sk-stat-value">${last ? last.avgMinutes : "—"}<span class="sk-unit">${t("common.unitMin")}</span></div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.over1h")}</div><div class="sk-stat-value">${last ? last.over1h : "—"}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("arena.admin.over3h")}</div><div class="sk-stat-value">${last ? last.over3h : "—"}</div></div>
          </div>
          <div class="ar-admin-table" role="table">
            <div class="ar-admin-tr ar-admin-th" role="row"><span>${t("arena.admin.day")}</span><span>${t("arena.admin.players")}</span><span>${t("arena.admin.votes")}</span><span>${t("arena.admin.avg")}</span><span>≥1h</span><span>≥3h</span></div>
            ${[...days].reverse().map((d) => html`<div class="ar-admin-tr sk-num" role="row" key=${d.day}><span>${d.day.slice(5)}</span><span>${d.players}</span><span>${d.votes}</span><span>${d.avgMinutes}</span><span>${d.over1h}</span><span>${d.over3h}</span></div>`)}
          </div>`}
    </section>
  `;
}

export function RankingsTab({ arena }) {
  const t = useT();
  const { profile } = useMyProfile();
  const { view, remote } = arena;
  const [scope, setScope] = useState("week");
  const [friends, setFriends] = useState(false);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: !s.data, error: null }));
    fetchLeaderboard(scope, friends)
      .then((data) => !off && setState({ loading: false, data, error: null }))
      .catch((error) => !off && setState({ loading: false, data: null, error }));
    return () => { off = true; };
  }, [scope, friends, tick, remote === "unavailable"]);

  // keep it fresh while you look at it
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") setTick((n) => n + 1); }, 60000);
    return () => clearInterval(id);
  }, []);

  async function toggleVisible(v) {
    try { await setLeaderboardVisibility(v); setTick((n) => n + 1); } catch (e) { toast(e.message ?? String(e), "rose"); }
  }

  const rows = state.data?.rows ?? [];
  const me = state.data?.me;
  const meInList = rows.some((r) => r.isMe);
  const unavailable = !!state.error;

  return html`
    <div class="ar-rankings">
      <div class="ar-rank-bar">
        <${Tabs} tabs=${[{ id: "week", label: t("arena.rankings.week") }, { id: "all", label: t("arena.rankings.all") }]} active=${scope} onChange=${setScope} />
        <${Tabs} tabs=${[{ id: "everyone", label: t("arena.rankings.everyone") }, { id: "friends", label: t("arena.rankings.friends") }]} active=${friends ? "friends" : "everyone"} onChange=${(id) => setFriends(id === "friends")} />
      </div>

      <section class="sk-panel ar-rank-list" data-testid="arena-rankings">
        ${state.loading
          ? [0, 1, 2, 3].map((i) => html`<div class="ar-row" key=${i}><${Skeleton} className="h-4 w-full" /></div>`)
          : unavailable
            ? html`<div class="ar-rank-empty"><${EmptyState} icon="trophy" title=${t("arena.rankings.offlineTitle")} body=${t("arena.rankings.offlineBody")} action=${html`<${Button} variant="secondary" size="sm" onClick=${() => setTick((n) => n + 1)}>${t("arena.rankings.retry")}<//>`} /></div>`
            : rows.length === 0
              ? html`<div class="ar-rank-empty"><${EmptyState} icon="trophy" title=${t(friends ? "arena.rankings.emptyFriendsTitle" : "arena.rankings.emptyTitle")} body=${t(friends ? "arena.rankings.emptyFriendsBody" : "arena.rankings.emptyBody")} /></div>`
              : html`
                ${rows.map((r) => html`<${Row} key=${r.userId} r=${r} t=${t} />`)}
                ${me && !meInList && html`<div class="ar-row ar-row-gap" data-me="true"><span class="ar-row-rank sk-num">${me.rank}</span><div class="ar-row-who"><div class="ar-row-name">${t("arena.rankings.you")}</div></div><span class="ar-row-xp sk-num">${nf(me.xp)}<span class="sk-unit">XP</span></span></div>`}`}
      </section>

      <div class="ar-rank-foot">
        <${Switch} checked=${view?.visible !== false} onChange=${toggleVisible} label=${t("arena.rankings.visible")} />
        <p class="ar-muted">${t("arena.rankings.visibleHint")}</p>
      </div>

      ${profile?.is_admin && html`<${AdminStats} />`}
    </div>
  `;
}
