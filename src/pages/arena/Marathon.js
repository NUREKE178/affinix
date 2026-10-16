// Stage 3 of the Daily Challenge, "the marathon": the theme of the week, five more shared sets of ten duels, and the
// week's table among friends. It opens once the day's ten duels are done. Sets are Daily Challenge rounds, so the
// Arena clock treats them exactly like the first set.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Button, Badge, ProgressBar, Skeleton } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { useT, getLocale } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import { fetchLeaderboard } from "../../lib/arenaStore.js";
import { addDays } from "../../lib/arena/rules.js";
import { nf } from "./parts.js";

/** "12–18 Oct" for the week that starts on `monday`. */
function weekLabel(monday) {
  const a = new Date(`${monday}T12:00:00`);
  const b = new Date(`${addDays(monday, 6)}T12:00:00`);
  const loc = getLocale();
  const sameMonth = a.getMonth() === b.getMonth();
  const day = (d) => d.toLocaleDateString(loc, { day: "numeric" });
  const full = (d) => d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  return sameMonth ? `${day(a)}–${full(b)}` : `${full(a)} – ${full(b)}`;
}

function ThemeCard({ theme, onClaim, t }) {
  return html`
    <article class="ar-theme" data-testid="arena-theme" data-done=${theme.done} data-claimed=${theme.claimed}>
      <div class="ar-mar-cap"><span class="sk-caption">${t("arena.marathon.themeTitle")}</span><span class="ar-mar-week">${weekLabel(theme.weekStart)}</span></div>
      <div class="ar-theme-name" data-testid="arena-theme-name">${t(`arena.family.${theme.family}`)}</div>
      <p class="ar-mi-note">${t("arena.marathon.themeBody", { goal: theme.goal })}</p>
      <div class="ar-theme-prog">
        <${ProgressBar} value=${theme.votes / theme.goal} />
        <span class="sk-num" data-testid="arena-theme-count">${theme.votes}<span class="sk-unit">/ ${theme.goal}</span></span>
      </div>
      <div class="ar-theme-foot">
        ${theme.claimed
          ? html`<${Badge} tone="emerald">${t("arena.marathon.themeDone")}<//>`
          : theme.done
            ? html`<${Button} data-ar-native=${true} onClick=${onClaim} data-testid="arena-theme-claim"><${Icon} name="bolt" size=${14} />${t("arena.marathon.claim", { xp: theme.bonus })}<//>`
            : html`<span class="ar-card-reward sk-num">+${theme.bonus}<span class="sk-unit">XP</span></span>`}
      </div>
    </article>
  `;
}

function SetRow({ entry, open, onPlay, onClaim, t }) {
  const state = entry.claimed ? "claimed" : entry.done ? "ready" : !open ? "locked" : entry.votes > 0 ? "going" : "fresh";
  return html`
    <div class="ar-set-row" data-testid="arena-set" data-set=${entry.n} data-state=${state}>
      <span class="ar-set-n sk-num">${entry.n}</span>
      <div class="ar-set-main">
        <div class="ar-set-title">${t("arena.marathon.setN", { n: entry.n })}</div>
        <div class="ar-set-pips" aria-hidden="true">${Array.from({ length: entry.size }, (_, i) => html`<i key=${i} data-on=${i < entry.votes}></i>`)}</div>
      </div>
      <span class="ar-set-count sk-num">${entry.votes}<span class="sk-unit">/ ${entry.size}</span></span>
      <div class="ar-set-act">
        ${state === "claimed" && html`<${Badge} tone="emerald">${t("arena.marathon.setDone")}<//>`}
        ${state === "ready" && html`<${Button} data-ar-native=${true} size="sm" onClick=${onClaim} data-testid="arena-set-claim"><${Icon} name="bolt" size=${14} />${t("arena.marathon.claim", { xp: entry.bonus })}<//>`}
        ${(state === "fresh" || state === "going") && html`<${Button} data-ar-native=${true} size="sm" variant=${state === "going" ? "primary" : "secondary"} onClick=${onPlay} data-testid="arena-set-play"><${Icon} name="play" size=${14} />${state === "going" ? t("arena.marathon.setContinue") : t("arena.marathon.setPlay", { xp: entry.bonus })}<//>`}
        ${state === "locked" && html`<span class="ar-set-lock"><${Icon} name="lock" size=${13} />${t("arena.marathon.setLocked", { n: entry.n - 1 })}</span>`}
      </div>
    </div>
  `;
}

/** This week's table among friends: you and the people you are friends with, by XP. */
function FriendsRace({ remote, t }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (remote !== "ready") return undefined;
    let off = false;
    fetchLeaderboard("week", true).then((d) => { if (!off) setData(d); }).catch(() => { if (!off) setData({ rows: [], failed: true }); });
    return () => { off = true; };
  }, [remote]);
  if (remote !== "ready") return null;
  const head = html`
    <div class="ar-board-head">
      <span class="sk-caption"><${Icon} name="friends" size=${13} /> ${t("arena.marathon.raceTitle")}</span>
      <button type="button" class="ar-board-link" onClick=${() => navigate("/app/arena?tab=rankings")}>${t("arena.lobby.boardAll")}<${Icon} name="arrowRight" size=${13} /></button>
    </div>`;
  if (!data) return html`<section class="ar-race" data-testid="arena-race">${head}<${Skeleton} className="h-12 w-full rounded-lg" /></section>`;
  const rows = data.rows ?? [];
  const mine = rows.find((r) => r.isMe);
  const list = rows.slice(0, 5);
  if (mine && !list.includes(mine)) list.push(mine);
  if (rows.length < 2) {
    return html`
      <section class="ar-race" data-testid="arena-race" data-empty="true">
        ${head}
        <p class="ar-mi-note">${t("arena.marathon.raceNone")}</p>
        <div><${Button} data-ar-native=${true} variant="secondary" size="sm" onClick=${() => navigate("/app/friends")}><${Icon} name="userPlus" size=${14} />${t("arena.marathon.raceFind")}<//></div>
      </section>`;
  }
  const leader = rows[0];
  const gap = mine && leader ? leader.xp - mine.xp : null;
  return html`
    <section class="ar-race" data-testid="arena-race">
      ${head}
      ${mine && html`<p class="ar-mi-note" data-testid="arena-race-gap">${mine.rank === 1 ? t("arena.marathon.raceLead") : t("arena.marathon.raceGap", { n: gap, name: leader.name ?? t("feed.unknownAuthor") })}</p>`}
      <div class="ar-board-rows">
        ${list.map((r) => html`
          <div class="ar-board-row" key=${r.userId} data-me=${r.isMe} data-testid="arena-race-row">
            <span class="ar-row-rank sk-num">${r.rank}</span>
            <${PersonLink} who=${r} arena=${{ rank: r.rank, level: r.level, xp: r.xp, streak: r.streak, scope: "week" }} className="sk-person-grow">
              <${Avatar} name=${r.name} url=${r.avatarUrl} size=${28} />
              <span class="ar-board-name">${r.name ?? t("feed.unknownAuthor")}${r.isMe ? html` <span class="ar-row-you">${t("arena.rankings.you")}</span>` : null}</span>
            <//>
            <span class="sk-num ar-board-xp">${nf(r.xp)}<span class="sk-unit">XP</span></span>
          </div>`)}
      </div>
    </section>
  `;
}

export function MarathonBlock({ arena, unlocked }) {
  const t = useT();
  const { view, remote, actions } = arena;
  const head = html`
    <div class="ar-mi-head">
      <span class="sk-tile"><${Icon} name="trophy" size=${15} /></span>
      <span class="sk-caption">${t("arena.marathon.stage3")}</span>
    </div>`;
  if (!unlocked) {
    return html`<section class="ar-stage2 ar-stage3 sk-panel" data-testid="arena-marathon" data-unlocked="false">${head}<p class="ar-mi-note" data-testid="marathon-locked">${t("arena.marathon.locked")}</p></section>`;
  }
  if (arena.setsApi === "old") {
    return html`<section class="ar-stage2 ar-stage3 sk-panel" data-testid="arena-marathon" data-unlocked="true" data-api="old">${head}<p class="ar-mi-note" data-testid="marathon-old-db">${t("arena.marathon.oldDb")}</p></section>`;
  }
  return html`
    <section class="ar-stage2 ar-stage3 sk-panel" data-testid="arena-marathon" data-unlocked="true">
      ${head}
      <p class="ar-mi-note">${t("arena.marathon.intro")}</p>
      <div class="ar-mar-grid">
        <div class="ar-mar-left">
          <${ThemeCard} theme=${view.theme} onClaim=${() => actions.claim("week_theme")} t=${t} />
          <${FriendsRace} remote=${remote} t=${t} />
        </div>
        <article class="ar-sets" data-testid="arena-sets">
          <div class="ar-mar-cap"><span class="sk-caption">${t("arena.marathon.setsTitle")}</span><span class="ar-mar-week">${t("arena.marathon.setsHint")}</span></div>
          ${view.sets.map((e, i) => html`<${SetRow} key=${e.n} entry=${e} open=${view.daily.done && (i === 0 || view.sets[i - 1].done)} onPlay=${() => actions.startSet(e.n)} onClaim=${() => actions.claim(`set_${e.n}`)} t=${t} />`)}
        </article>
      </div>
    </section>
  `;
}
