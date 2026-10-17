// Rankings tab: weekly / all-time XP, everyone or friends. (The numbers about how long people stay are in the admin panel.)
import { html, useState, useEffect } from "../../lib/preact.js";
import { Skeleton, Switch, Tabs, Button, EmptyState } from "../../components/ui.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { fetchLeaderboard, setLeaderboardVisibility } from "../../lib/arenaStore.js";
import { toast } from "../../components/ui.js";
import { nf } from "./parts.js";

function Row({ r, t, scope }) {
  // the avatar and the name are one button: it opens this player's profile, with the numbers already on the row
  const arena = { rank: r.rank, level: r.level, xp: r.xp, streak: r.streak, scope };
  return html`
    <div class="ar-row" data-me=${r.isMe} data-top=${r.rank <= 3} data-testid="arena-row">
      <span class="ar-row-rank sk-num">${r.rank}</span>
      <${PersonLink} who=${r} arena=${arena} className="sk-person-grow">
        <${Avatar} name=${r.name} url=${r.avatarUrl} size=${34} />
        <div class="ar-row-who">
          <div class="ar-row-name">${r.name ?? t("feed.unknownAuthor")}${r.isMe ? html` <span class="ar-row-you">${t("arena.rankings.you")}</span>` : null}</div>
          ${r.username && html`<div class="ar-row-user">@${r.username}</div>`}
        </div>
      <//>
      ${r.streak > 0 && html`<span class="ar-row-streak sk-num" title=${t("arena.quests.streakTitle")}><${Icon} name="flame" size=${13} />${r.streak}</span>`}
      <span class="ar-row-level sk-num"><span class="sk-caption">${t("arena.level")}</span> ${r.level}</span>
      <span class="ar-row-xp sk-num">${nf(r.xp)}<span class="sk-unit">XP</span></span>
    </div>
  `;
}

export function RankingsTab({ arena }) {
  const t = useT();
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
    try { await setLeaderboardVisibility(v); setTick((n) => n + 1); } catch (e) { toast(t(e.serverPending ? "arena.rankings.serverPending" : "arena.rankings.saveFailed"), "rose"); }
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
            ? html`<div class="ar-rank-empty"><${EmptyState} icon="trophy" title=${t("arena.rankings.offlineTitle")} body=${t("arena.rankings.offlineBody")} action=${html`<${Button} variant="secondary" size="sm" onClick=${() => { arena.actions.syncNow().finally(() => setTick((n) => n + 1)); }}>${t("arena.rankings.retry")}<//>`} /></div>`
            : rows.length === 0
              ? html`<div class="ar-rank-empty"><${EmptyState} icon="trophy" title=${t(friends ? "arena.rankings.emptyFriendsTitle" : "arena.rankings.emptyTitle")} body=${t(friends ? "arena.rankings.emptyFriendsBody" : "arena.rankings.emptyBody")} /></div>`
              : html`
                ${rows.map((r) => html`<${Row} key=${r.userId} r=${r} t=${t} scope=${scope} />`)}
                ${me && !meInList && html`<div class="ar-row ar-row-gap" data-me="true"><span class="ar-row-rank sk-num">${me.rank}</span><div class="ar-row-who"><div class="ar-row-name">${t("arena.rankings.you")}</div></div><span class="ar-row-xp sk-num">${nf(me.xp)}<span class="sk-unit">XP</span></span></div>`}`}
      </section>

      <div class="ar-rank-foot">
        <${Switch} checked=${view?.visible !== false} onChange=${toggleVisible} label=${t("arena.rankings.visible")} />
        <p class="ar-muted">${t("arena.rankings.visibleHint")}</p>
      </div>

    </div>
  `;
}
