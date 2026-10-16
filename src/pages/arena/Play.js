// The Play tab: lobby (daily challenge + free play), the duel console, the round summary.
import { html, useState, useEffect, useMemo, useRef } from "../../lib/preact.js";
import { Button, Badge, StatTile, ProgressBar, Switch, Skeleton } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT, getLocale } from "../../lib/i18n.js";
import { getStimulus, renderSvg } from "../../lib/arena/stimuli.js";
import { TRAIT_IDS } from "../../lib/arena/traits.js";
import { flowBonus, DAILY_SET_BONUS, DAILY_SET_SIZE, MAX_FLOW_BONUS, XP_BASE, PIONEER_BONUS, seasonOf } from "../../lib/arena/rules.js";
import { summarize, useArenaClock, roundPhase, fetchLeaderboard } from "../../lib/arenaStore.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { isProfileOpen } from "../../lib/profileViewer.js";
import { navigate } from "../../router.js";
import { Specimen, Ladder, nf, clock } from "./parts.js";
import { DailyReport } from "./DailyReport.js";

const AUTO_MS = 2600;

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

function useArenaKeys(arena, onStart) {
  const { actions } = arena;
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isProfileOpen()) return; // a profile is on screen: 1 / 2 / S / Enter must not play behind it
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // a focused key (Start, Next ...) already handles Enter / Space itself
      if (el?.closest?.("[data-ar-native]") && (e.key === "Enter" || e.key === " ")) return;
      const k = e.key;
      const phase = roundPhase(); // read at the moment of the key press, never from a stale render
      if ((phase === "choose" || phase === "reveal") && k === "Escape") { e.preventDefault(); actions.endRound(); return; }
      if (phase === "choose") {
        if (k === "1" || k === "ArrowLeft") { e.preventDefault(); actions.vote(0); }
        else if (k === "2" || k === "ArrowRight") { e.preventDefault(); actions.vote(1); }
        else if (k === "s" || k === "S") { e.preventDefault(); actions.skip(); }
      } else if (phase === "reveal") {
        if (k === " " || k === "Enter" || k === "ArrowRight") { e.preventDefault(); actions.next(); }
      } else if (phase === "summary") {
        if (k === "Enter") { e.preventDefault(); startRef.current("free"); }
      } else if (phase === "lobby") {
        if (k === "Enter") { e.preventDefault(); startRef.current(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

function untilMidnight() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const m = Math.max(1, Math.round((end - now) / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "October 2026": the month whose designs are on the table (every season re-draws all specimens). */
function seasonName() {
  const id = seasonOf();
  const d = new Date(Number(id.slice(0, 4)), Number(id.slice(4)) - 1, 1);
  const name = d.toLocaleDateString(getLocale(), { month: "long", year: "numeric" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function SyncBadge({ remote, pending }) {
  const t = useT();
  const tone = remote === "ready" ? "emerald" : remote === "offline" ? "amber" : "steel";
  const label = remote === "ready" ? (pending > 0 ? t("arena.sync.pending", { n: pending }) : t("arena.sync.ready"))
    : remote === "offline" ? t("arena.sync.offline")
    : remote === "unavailable" ? t("arena.sync.device") : t("arena.sync.checking");
  return html`<span title=${remote === "unavailable" ? t("arena.sync.deviceHint") : undefined} data-testid="arena-sync" data-remote=${remote}><${Badge} tone=${tone}>${label}<//></span>`;
}

/** The top of this week's table, right in the lobby: a reason to play one more round. */
function LobbyBoard({ t, remote }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (remote !== "ready") return undefined;
    let off = false;
    fetchLeaderboard("week", false).then((d) => { if (!off) setData(d); }).catch(() => {});
    return () => { off = true; };
  }, [remote]);
  const rows = data?.rows ?? [];
  if (rows.length < 2) return null;
  const me = rows.find((r) => r.isMe);
  return html`
    <section class="ar-board sk-panel" data-testid="arena-lobby-board">
      <div class="ar-board-head">
        <span class="sk-caption">${t("arena.lobby.boardTitle")}</span>
        <button type="button" class="ar-board-link" onClick=${() => navigate("/app/arena?tab=rankings")}>${t("arena.lobby.boardAll")}<${Icon} name="arrowRight" size=${13} /></button>
      </div>
      <div class="ar-board-rows">
        ${rows.slice(0, 3).map((r) => html`
          <div class="ar-board-row" key=${r.userId} data-me=${r.isMe}>
            <span class="ar-row-rank sk-num">${r.rank}</span>
            <${PersonLink} who=${r} arena=${{ rank: r.rank, level: r.level, xp: r.xp, streak: r.streak, scope: "week" }} className="sk-person-grow">
              <${Avatar} name=${r.name} url=${r.avatarUrl} size=${28} />
              <span class="ar-board-name">${r.name ?? t("feed.unknownAuthor")}${r.isMe ? html` <span class="ar-row-you">${t("arena.rankings.you")}</span>` : null}</span>
            <//>
            <span class="sk-num ar-board-xp">${nf(r.xp)}<span class="sk-unit">XP</span></span>
          </div>`)}
        ${data?.me && !me && rows.length >= 3 && html`<div class="ar-board-row ar-board-me" data-me="true"><span class="ar-row-rank sk-num">${data.me.rank}</span><span class="ar-board-name">${t("arena.rankings.you")}</span><span class="sk-num ar-board-xp">${nf(data.me.xp)}<span class="sk-unit">XP</span></span></div>`}
      </div>
    </section>
  `;
}

function Intro() {
  const t = useT();
  const steps = [
    { icon: "arena", key: "s1" },
    { icon: "bolt", key: "s2" },
    { icon: "sliders", key: "s3" },
  ];
  return html`
    <div class="ar-intro sk-panel" data-testid="arena-intro">
      <div class="ar-intro-title">${t("arena.intro.title")}</div>
      <div class="ar-intro-steps">
        ${steps.map((s, i) => html`
          <div class="ar-intro-step" key=${s.key}>
            <span class="sk-tile"><${Icon} name=${s.icon} size=${15} /></span>
            <div>
              <div class="ar-intro-step-title">${t(`arena.intro.${s.key}.title`)}</div>
              <div class="ar-intro-step-body">${t(`arena.intro.${s.key}.body`)}</div>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

function Lobby({ arena, onStart }) {
  const t = useT();
  const { view, remote, pendingCount, prefs, actions } = arena;
  const seconds = useArenaClock();
  const [report, setReport] = useState(false);
  const daily = view.daily;
  const dailyLead = !daily.done;
  const eyePct = view.eye.total >= 5 ? `${Math.round((view.eye.correct / view.eye.total) * 100)}%` : "—";

  if (report) {
    return html`
      <div class="ar-lobby">
        <div class="ar-back"><${Button} variant="secondary" size="sm" onClick=${() => setReport(false)}><${Icon} name="arrowLeft" size=${14} />${t("arena.back")}<//></div>
        <${DailyReport} day=${view.today.day} />
      </div>
    `;
  }

  return html`
    <div class="ar-lobby">
      ${view.votes === 0 && html`<${Intro} />`}
      <div class="ar-lobby-grid">
        <article class="ar-card sk-panel" data-testid="arena-daily-card">
          <div class="ar-card-top">
            <span class="sk-tile"><${Icon} name="target" size=${15} /></span>
            <span class="sk-caption">${t("arena.lobby.dailyTitle")}</span>
            <span class="ar-card-reward sk-num">+${DAILY_SET_BONUS}<span class="sk-unit">XP</span></span>
          </div>
          <p class="ar-card-body">${t("arena.lobby.dailyBody", { size: DAILY_SET_SIZE })}</p>
          <div class="ar-card-prog">
            <${Ladder} total=${DAILY_SET_SIZE} idx=${-1} results=${Array.from({ length: daily.votes }, () => ({}))} phase="choose" />
            <span class="sk-num ar-card-count">${daily.votes}<span class="sk-unit">/ ${DAILY_SET_SIZE}</span></span>
          </div>
          <div class="ar-card-foot">
            ${!daily.done && html`
              <${Button} data-ar-native=${true} variant=${dailyLead ? "primary" : "secondary"} onClick=${() => onStart("daily")} data-testid="arena-start-daily">
                <${Icon} name="play" size=${14} />${daily.votes > 0 ? t("arena.lobby.dailyContinue", { done: daily.votes, size: DAILY_SET_SIZE }) : t("arena.lobby.dailyStart")}
              <//>`}
            ${daily.done && !daily.claimed && html`
              <${Button} data-ar-native=${true} onClick=${() => actions.claim("daily_set")} data-testid="arena-claim-daily"><${Icon} name="bolt" size=${14} />${t("arena.lobby.dailyClaim", { xp: DAILY_SET_BONUS })}<//>`}
            ${daily.done && daily.claimed && html`<${Badge} tone="emerald">${t("arena.lobby.dailyDone")}<//>`}
            ${daily.done && html`<${Button} data-ar-native=${true} variant="secondary" onClick=${() => setReport(true)} data-testid="arena-daily-results">${t("arena.lobby.dailyResults")}<//>`}
            <span class="ar-card-note">${t("arena.lobby.resets", { time: untilMidnight() })}</span>
          </div>
        </article>

        <article class="ar-card sk-panel" data-testid="arena-free-card">
          <div class="ar-card-top">
            <span class="sk-tile"><${Icon} name="arena" size=${15} /></span>
            <span class="sk-caption">${t("arena.lobby.freeTitle")}</span>
          </div>
          <p class="ar-card-body">${t("arena.lobby.freeBody")}</p>
          <p class="ar-card-season" data-testid="arena-season">${t("arena.lobby.season", { name: seasonName() })}</p>
          <div class="ar-card-goal">
            <div class="ar-card-goal-row"><span class="sk-caption">${t("arena.lobby.goal")}</span><span class="sk-num">${view.goal.done}<span class="sk-unit">/ ${view.goal.target}</span></span></div>
            <${ProgressBar} value=${view.goal.done / view.goal.target} />
          </div>
          <div class="ar-card-foot">
            <${Button} data-ar-native=${true} variant=${dailyLead ? "secondary" : "primary"} onClick=${() => onStart("free")} data-testid="arena-start-free"><${Icon} name="play" size=${14} />${t("arena.lobby.freeStart")}<//>
            <span class="ar-card-note"><span class="sk-kbd">Enter</span></span>
          </div>
        </article>
      </div>

      <div class="sk-stat-strip" style="--cols:4">
        <${StatTile} label=${t("arena.lobby.statDuels")} value=${`${view.today.votes}`} hint=${t("arena.lobby.statDuelsHint", { n: view.votes })} />
        <${StatTile} label=${t("arena.lobby.statStreak")} value=${`${view.streak}`} hint=${view.streakAtRisk ? t("arena.lobby.streakRisk") : view.streakDoneToday ? t("arena.lobby.streakSafe") : t("arena.lobby.streakStart")} />
        <${StatTile} label=${t("arena.lobby.statTime")} value=${html`<span data-testid="arena-time">${clock(seconds)}</span>`} hint=${t("arena.lobby.statTimeHint")} />
        <${StatTile} label=${t("arena.lobby.statEye")} value=${eyePct} hint=${t("arena.lobby.statEyeHint", { c: view.eye.correct, n: view.eye.total })} />
      </div>
      <${LobbyBoard} t=${t} remote=${remote} />
      <div class="ar-lobby-meta"><${SyncBadge} remote=${remote} pending=${pendingCount} /></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------

/** Numbers for the reveal: community split (including this vote) and each specimen's overall record. */
function revealInfo(duel, last, stims) {
  const tl = last.tally;
  const votes = [(tl?.a ?? 0) + (last.pick === 0 ? 1 : 0), (tl?.b ?? 0) + (last.pick === 1 ? 1 : 0)];
  const total = votes[0] + votes[1];
  const sides = [0, 1].map((c) => {
    const st = c === 0 ? tl?.sa : tl?.sb;
    const w = (st?.w ?? 0) + (last.pick === c ? 1 : 0);
    const l = (st?.l ?? 0) + (last.pick === c ? 0 : 1);
    const n = w + l;
    return {
      votes: votes[c],
      pct: total ? Math.round((votes[c] / total) * 100) : 0,
      rate: tl && n >= 8 ? Math.round((w / n) * 100) : null,
      contrast: stims[c].legibility?.contrast ?? null,
      winner: duel.objective ? duel.truth === c : null,
    };
  });
  return { total, hasTally: !!tl, known: !!tl && total > 1, first: !!tl && tl.a + tl.b === 0, sides };
}

function SpecFoot({ info, c, picked, duel, t }) {
  const s = info.sides[c];
  return html`
    <span class="ar-spec-foot" data-picked=${picked}>
      ${info.known
        ? html`
          <span class="ar-spec-split"><b class="sk-num ar-spec-pct">${s.pct}<span class="sk-unit">%</span></b><span class="ar-spec-bar"><i style=${{ width: `${s.pct}%` }}></i></span></span>
          <span class="ar-spec-sub">${t("arena.console.votes")}: ${s.votes}${s.rate !== null ? html` · ${t("arena.console.stimWin", { pct: s.rate })}` : null}</span>`
        : html`<span class="ar-spec-sub">${s.rate !== null ? t("arena.console.stimWin", { pct: s.rate }) : ""}</span>`}
      ${duel.objective && s.contrast !== null && html`
        <span class="ar-spec-fact" data-win=${s.winner}>
          <i class="sk-led" aria-hidden="true"></i>${t("arena.console.contrast", { v: s.contrast })}
        </span>`}
      ${picked && html`<span class="ar-spec-chip">${t("arena.console.pick")}</span>`}
    </span>
  `;
}

function FlowMeter({ combo }) {
  const t = useT();
  const bonus = flowBonus(combo);
  return html`
    <div class="ar-flow" data-on=${bonus > 0} title=${t("arena.console.flowHint")}>
      <span class="sk-caption">${t("arena.console.flow")}</span>
      <span class="ar-flow-segs" aria-hidden="true">${Array.from({ length: MAX_FLOW_BONUS }, (_, i) => html`<i key=${i} data-on=${i < bonus}></i>`)}</span>
      <span class="sk-num ar-flow-mult">×${(1 + bonus / 10).toFixed(1)}</span>
    </div>
  `;
}

/** What the pick says about the player: the trait on which the chosen specimen differs most from the other one. */
function pickInsight(stims, pick) {
  const [chosen, other] = pick === 0 ? [stims[0], stims[1]] : [stims[1], stims[0]];
  let best = null;
  for (const tr of TRAIT_IDS) {
    const d = chosen.traits[tr] - other.traits[tr];
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { trait: tr, d };
  }
  return best && Math.abs(best.d) >= 0.6 ? best : null;
}

function ResultStrip({ last, duel, info, remote, t, insight }) {
  const parts = [];
  parts.push(html`<span class="ar-res ar-res-xp sk-num" key="xp" data-testid="arena-xp">${last.repeat ? "+0" : `+${last.xp}`}<span class="sk-unit">XP</span></span>`);
  if (last.repeat) parts.push(html`<${Badge} key="rep" tone="steel">${t("arena.console.repeat")}<//>`);
  if (!last.repeat && last.bonus > 0) parts.push(html`<span class="ar-res-note" key="fl">${t("arena.console.flowBonus", { n: last.bonus })}</span>`);
  if (!last.repeat && last.pioneer) parts.push(html`<span class="ar-res-note" key="pi">${t("arena.console.pioneer", { xp: PIONEER_BONUS })}</span>`);
  if (duel.objective) parts.push(html`<${Badge} key="eye" tone=${last.eye ? "emerald" : "rose"}>${last.eye ? t("arena.console.eyeRight") : t("arena.console.eyeWrong")}<//>`);
  if (last.crowd !== null && last.crowd !== undefined) parts.push(html`<${Badge} key="cr" tone=${last.crowd ? "emerald" : "steel"}>${last.crowd ? t("arena.console.withCrowd") : t("arena.console.againstCrowd")}<//>`);
  if (insight && !duel.objective && !last.repeat) parts.push(html`<span class="ar-res-note ar-res-insight" key="in" data-testid="arena-insight-pick">${t("arena.console.insight", { pole: t(`arena.traits.${insight.trait}.${insight.d >= 0 ? "hi" : "lo"}`).toLowerCase() })}</span>`);
  if (!info.hasTally) parts.push(html`<span class="ar-res-note ar-res-muted" key="cm">${remote === "unavailable" ? t("arena.console.communityOff") : ""}</span>`);
  else if (info.first) parts.push(html`<span class="ar-res-note ar-res-muted" key="cf">${t("arena.console.communityEmpty")}</span>`);
  return html`<div class="ar-result" role="status" data-testid="arena-result">${parts}</div>`;
}

/** The Arena clock in the console: lit and counting in the Daily Challenge, paused (and saying why) in free play. */
function ClockChip({ on }) {
  const t = useT();
  const seconds = useArenaClock();
  return html`
    <span class="ar-clock" data-on=${on} title=${t(on ? "arena.console.clockOnTitle" : "arena.console.clockOffTitle")} data-testid="arena-clock">
      <i class="sk-led" aria-hidden="true"></i>
      ${on ? html`<b class="sk-num" data-testid="arena-clock-value">${clock(seconds)}</b>` : null}
      <span>${t(on ? "arena.console.clockOn" : "arena.console.clockOff")}</span>
    </span>
  `;
}

function Console({ arena }) {
  const t = useT();
  const { round, prefs, actions, remote } = arena;
  const duel = round.duels[round.idx];
  const revealing = round.phase === "reveal";
  const stims = useMemo(() => [getStimulus(duel.season, duel.family, duel.a), getStimulus(duel.season, duel.family, duel.b)], [duel.id, duel.season]);
  const order = duel.swap ? [1, 0] : [0, 1]; // canonical index shown on [left, right]
  const svgs = useMemo(() => order.map((c) => renderSvg(stims[c])), [duel.id, duel.season]);
  const last = revealing ? round.last : null;
  const info = last ? revealInfo(duel, last, stims) : null;
  const insight = last && !last.skipped ? pickInsight(stims, last.pick) : null;

  // auto-advance after the reveal
  useEffect(() => {
    if (!revealing || !prefs.auto) return undefined;
    const id = setTimeout(() => actions.next(), AUTO_MS);
    return () => clearTimeout(id);
  }, [round.id, round.idx, revealing, prefs.auto]);

  const kbdFor = (side) => (side === 0 ? "1" : "2");
  return html`
    <section class="ar-console sk-panel" data-phase=${round.phase} data-mode=${round.mode} data-testid="arena-console">
      <header class="ar-console-head">
        <div class="ar-q">
          <span class="ar-q-meta">
            <i class="sk-led" aria-hidden="true"></i>${t(`arena.family.${duel.family}`)} · ${t(`builder.dimensions.${duel.dim}.label`)}
            ${duel.objective && html`<span class="ar-q-tag" data-tag="eye">${t("arena.console.eyeTag")}</span>`}
            ${round.mode === "daily" && html`<span class="ar-q-tag">${t("arena.console.dailyTag")}</span>`}
          </span>
          <h3 class="ar-q-text" data-testid="arena-question">${t(`arena.q.${duel.dim}`)}</h3>
        </div>
        <div class="ar-console-side">
          <div class="ar-console-side-top">
            <${Ladder} total=${round.duels.length} idx=${round.idx} results=${round.results} phase=${round.phase} />
            <button type="button" class="ar-leave" onClick=${actions.endRound} aria-label=${t("arena.console.leave")} title=${`${t("arena.console.leave")}  Esc`} data-testid="arena-leave"><${Icon} name="close" size=${14} /></button>
          </div>
          <span class="ar-round-count sk-num" data-testid="arena-progress">${round.idx + 1}<span class="sk-unit">/ ${round.duels.length}</span></span>
          <${ClockChip} on=${round.mode === "daily" || round.mode === "mission"} />
        </div>
      </header>

      <div class="ar-stage" role="group" aria-label=${t("arena.console.stage")}>
        ${[0, 1].map((side) => {
          const c = order[side];
          const picked = last ? last.side === side : false;
          const state = !revealing ? "idle" : picked ? "picked" : "other";
          return html`
            <${Specimen}
              key=${`${duel.id}-${side}`}
              stim=${stims[c]}
              svg=${svgs[side]}
              side=${side}
              state=${state}
              kbd=${kbdFor(side)}
              name=${t("arena.console.option", { n: side === 0 ? "A" : "B" })}
              onPick=${actions.vote}
            >
              ${revealing && html`<${SpecFoot} info=${info} c=${c} picked=${picked} duel=${duel} t=${t} />`}
            <//>
          `;
        })}
        <span class="ar-vs sk-num" aria-hidden="true">VS</span>
      </div>

      <footer class="ar-console-foot">
        ${revealing
          ? html`<${ResultStrip} last=${last} duel=${duel} info=${info} remote=${remote} t=${t} insight=${insight} />`
          : html`<${FlowMeter} combo=${round.combo} />`}
        <div class="ar-foot-actions">
          <label class="ar-auto" title=${t("arena.console.autoHint")}>
            <span>${t("arena.console.auto")}</span>
            <button type="button" role="switch" aria-checked=${!!prefs.auto} data-on=${!!prefs.auto} data-ar-native=${true} class="sk-switch-track relative h-5 w-9 shrink-0 rounded-full"
              onClick=${(e) => { actions.setPref("auto", !prefs.auto); if (e.detail > 0) e.currentTarget.blur(); }} data-testid="arena-auto">
              <span class="sk-switch-knob absolute top-0.5 left-0.5 h-4 w-4 rounded-full" style=${{ transform: prefs.auto ? "translateX(16px)" : "translateX(0)" }}></span>
            </button>
          </label>
          ${revealing
            ? html`<${Button} data-ar-native=${true} className="ar-next" onClick=${actions.next} data-testid="arena-next">
                ${t("arena.console.next")}<span class="sk-kbd ar-next-kbd">Space</span>
                ${prefs.auto && html`<i class="ar-next-timer" style=${{ animationDuration: `${AUTO_MS}ms` }} key=${`${round.id}-${round.idx}`}></i>`}
              <//>`
            : html`<${Button} data-ar-native=${true} variant="secondary" onClick=${actions.skip} data-testid="arena-skip">${t("arena.console.skip")}<span class="sk-kbd">S</span><//>`}
        </div>
      </footer>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

function Summary({ arena, onStart }) {
  const t = useT();
  const { round, view, actions } = arena;
  const s = useMemo(() => summarize(round), [round.id]);
  const daily = round.mode === "daily";
  const [showReport, setShowReport] = useState(daily);
  return html`
    <div class="ar-summary-wrap">
      <section class="ar-summary sk-panel" data-testid="arena-summary">
        <div class="ar-summary-top">
          <span class="sk-caption">${daily ? t("arena.summary.dailyTitle") : t("arena.summary.title")}</span>
          <div class="ar-summary-xp sk-num" data-testid="arena-summary-xp">+${nf(s.xp)}<span class="sk-unit">XP</span></div>
          <div class="ar-summary-level">
            <span class="sk-caption">${t("arena.level")} ${view.level} · ${t(`arena.rank.${view.rank}`)}</span>
            <${ProgressBar} value=${view.levelRatio} />
            <span class="sk-num ar-level-xp">${nf(view.levelInto)}<span class="sk-unit">/ ${nf(view.levelSpan)} XP</span></span>
          </div>
        </div>
        <div class="sk-stat-strip sk-stat-strip-well" style="--cols:4">
          <${StatTile} label=${t("arena.summary.answers")} value=${`${s.answered}`} hint=${t("arena.summary.answersHint", { n: round.duels.length })} />
          <${StatTile} label=${t("arena.summary.combo")} value=${`${s.bestCombo}`} hint=${t("arena.summary.comboHint")} />
          <${StatTile} label=${t("arena.summary.eye")} value=${s.eye.total ? `${s.eye.correct}/${s.eye.total}` : "—"} hint=${t("arena.summary.eyeHint")} />
          <${StatTile} label=${t("arena.summary.speed")} value=${s.avgMs ? `${(s.avgMs / 1000).toFixed(1)} ${t("common.unitSec")}` : "—"} hint=${t("arena.summary.speedHint")} />
        </div>
        <div class="ar-summary-actions">
          ${daily
            ? html`
              ${view.daily.done && !view.daily.claimed && html`<${Button} data-ar-native=${true} onClick=${() => actions.claim("daily_set")} data-testid="arena-claim-daily"><${Icon} name="bolt" size=${14} />${t("arena.lobby.dailyClaim", { xp: DAILY_SET_BONUS })}<//>`}
              <${Button} data-ar-native=${true} variant=${view.daily.done && !view.daily.claimed ? "secondary" : "primary"} onClick=${() => onStart("free")} data-testid="arena-again"><${Icon} name="play" size=${14} />${t("arena.summary.again")}<//>`
            : html`<${Button} data-ar-native=${true} onClick=${() => onStart("free")} data-testid="arena-again"><${Icon} name="play" size=${14} />${t("arena.summary.again")}<span class="sk-kbd">Enter</span><//>`}
          <${Button} data-ar-native=${true} variant="secondary" onClick=${() => actions.endRound()} data-testid="arena-done">${t("arena.summary.done")}<//>
          <${Button} data-ar-native=${true} variant="secondary" onClick=${() => navigate("/app/arena?tab=profile")}><${Icon} name="sliders" size=${14} />${t("arena.summary.dna")}<//>
        </div>
      </section>
      ${daily && showReport && html`<${DailyReport} day=${round.day} season=${round.season} />`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// tab
// ---------------------------------------------------------------------------

export function PlayTab({ arena }) {
  const { ready, view, round, actions } = arena;
  const start = useMemo(() => (mode) => {
    // Enter in the lobby starts whichever mode is the lit key
    actions.startRound(mode ?? (arena.view && !arena.view.daily.done ? "daily" : "free"));
  }, [actions, arena.view?.daily.done]);
  useArenaKeys(arena, start);

  if (!ready || !view) {
    return html`<div class="ar-lobby"><${Skeleton} className="h-40 w-full rounded-xl" /><${Skeleton} className="h-24 w-full rounded-xl" /></div>`;
  }
  if (!round) return html`<${Lobby} arena=${arena} onStart=${start} />`;
  if (round.phase === "summary") return html`<${Summary} arena=${arena} onStart=${start} />`;
  return html`<${Console} arena=${arena} />`;
}

export { AUTO_MS };
