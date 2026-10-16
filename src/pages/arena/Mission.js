// Research missions: someone's crowd test, played as Stage 2 of the Daily Challenge. The lobby block offers the
// missions, the console is the duel screen with the author's images or texts instead of generated specimens, and
// the summary says what the player just did for the author.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Button, Badge, StatTile, ProgressBar, Skeleton, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { useT } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import { useArenaClock } from "../../lib/arenaStore.js";
import { useMissionQueue, fetchQueue, reportTest } from "../../lib/crowdStore.js";
import { OptionThumb, optionName, safeImageUrl } from "../crowd/parts.js";
import { Specimen, Ladder, nf, clock } from "./parts.js";

const AUTO_MS = 3200;
/** Errors that mean "this mission cannot go on" rather than "try again". */
const TERMINAL = ["closed", "own", "pending"];

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

/** The Stage-2 block under the Daily Challenge: locked until the day's duels are done, then a short list of
 * other people's tests that need an answer. */
export function MissionBlock({ arena, unlocked }) {
  const t = useT();
  const { remote, actions, view } = arena;
  const enabled = unlocked && remote === "ready";
  const q = useMissionQueue(enabled);
  if (remote === "unavailable") return null;

  const head = html`
    <div class="ar-mi-head">
      <span class="sk-tile"><${Icon} name="results" size=${15} /></span>
      <span class="sk-caption">${t("crowd.mission.stage2")}</span>
    </div>`;

  let body;
  if (!unlocked) {
    body = html`<p class="ar-mi-note" data-testid="mission-locked">${t("crowd.mission.locked")}</p>`;
  } else if (remote !== "ready") {
    body = html`<p class="ar-mi-note">${t("crowd.err.offline")}</p>`;
  } else if (q.loading) {
    body = html`<${Skeleton} className="h-16 w-full rounded-xl" />`;
  } else if (q.pending) {
    body = html`<p class="ar-mi-note" data-testid="mission-pending">${t("crowd.mission.unavailable")}</p>`;
  } else if (q.error) {
    body = html`<p class="ar-mi-note">${t("crowd.err.generic")}</p>`;
  } else if (q.tests.length === 0) {
    body = html`
      <p class="ar-mi-note" data-testid="mission-none">${t("crowd.mission.none")}</p>
      <div><${Button} data-ar-native=${true} variant="secondary" size="sm" onClick=${() => navigate("/app/overview")}><${Icon} name="plus" size=${14} />${t("crowd.mission.create")}<//></div>`;
  } else {
    const capped = q.missionXp >= q.cap;
    body = html`
      <p class="ar-mi-note" data-testid="mission-available">${t("crowd.mission.available", { n: q.available, cap: q.cap })}</p>
      <div class="ar-mi-list">
        ${q.tests.map((x) => html`
          <div class="ar-mi-row" key=${x.id} data-testid="mission-row">
            <div class="ar-mi-thumbs">${(x.items ?? []).map((it) => html`<${OptionThumb} key=${it.id} item=${it} size=${38} />`)}</div>
            <div class="ar-mi-main">
              <div class="ar-mi-title">${x.title}</div>
              <div class="ar-mi-sub">${t(`crowd.q.${x.dim}`)}${x.owner?.name ? ` · ${t("crowd.mission.by", { name: x.owner.name })}` : ""}</div>
            </div>
            <${Button} data-ar-native=${true} size="sm" onClick=${() => actions.startMission(x)} data-testid="mission-start">
              <${Icon} name="play" size=${14} />${t("crowd.mission.start")}
            <//>
          </div>`)}
      </div>
      <div class="ar-mi-xp">
        <span class="sk-num">${t("crowd.mission.xpLeft", { xp: q.missionXp, cap: q.cap })}</span>
        <${ProgressBar} value=${Math.min(1, q.missionXp / q.cap)} />
        ${capped && html`<span class="ar-mi-note">${t("crowd.mission.capped")}</span>`}
      </div>`;
  }
  return html`<section class="ar-stage2 sk-panel" data-testid="arena-missions" data-unlocked=${unlocked}>${head}${body}</section>`;
}

// ---------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------

/** One option inside its well: the author's image (with its caption when it has both) or the text alone. */
function MissionArt({ item, t }) {
  const url = item.path ? safeImageUrl(item.path) : null;
  if (url) {
    return html`<span class="ar-mi-art"><img src=${url} alt="" draggable="false" />${item.label && html`<span class="ar-mi-cap">${item.label}</span>`}</span>`;
  }
  return html`<span class="ar-mi-art ar-mi-art-text"><b>${optionName(item, t)}</b></span>`;
}

function SideFoot({ last, side, left, right, picked, t }) {
  if (last.pending) return html`<span class="ar-spec-sub">${t("crowd.mission.sending")}</span>`;
  if (last.error) return html`<span class="ar-spec-sub">${picked ? t("arena.console.pick") : ""}</span>`;
  const tl = last.tally;
  const item = side === 0 ? left : right;
  const votes = tl ? (item === last.a ? tl.a : tl.b) : null;
  const total = tl ? tl.a + tl.b : 0;
  const pct = total ? Math.round((votes / total) * 100) : 0;
  return html`
    <span class="ar-spec-foot" data-picked=${picked}>
      ${tl && total > 1
        ? html`
          <span class="ar-spec-split"><b class="sk-num ar-spec-pct">${pct}<span class="sk-unit">%</span></b><span class="ar-spec-bar"><i style=${{ width: `${pct}%` }}></i></span></span>
          <span class="ar-spec-sub">${t("arena.console.votes")}: ${votes}</span>`
        : html`<span class="ar-spec-sub">${tl ? t("crowd.mission.firstOnes") : ""}</span>`}
      ${picked && html`<span class="ar-spec-chip">${t("arena.console.pick")}</span>`}
    </span>`;
}

function ResultStrip({ last, round, t }) {
  const parts = [];
  if (last.pending) {
    parts.push(html`<span class="ar-res-note ar-res-muted" key="p" data-testid="mission-sending">${t("crowd.mission.sending")}</span>`);
  } else if (last.error) {
    const terminal = TERMINAL.includes(last.error);
    parts.push(html`<span class="ar-res-note ar-mi-fail" key="e" role="alert" data-testid="mission-error">${terminal ? t(last.error === "pending" ? "crowd.err.pending" : "crowd.mission.closed") : t("crowd.mission.sendFailed")}</span>`);
  } else {
    parts.push(html`<span class="ar-res ar-res-xp sk-num" key="xp" data-testid="arena-xp">+${last.xp ?? 0}<span class="sk-unit">XP</span></span>`);
    if (last.bonus > 0) parts.push(html`<span class="ar-res-note" key="b">${t("crowd.mission.bonus", { xp: last.bonus })}</span>`);
    if (last.capped) parts.push(html`<${Badge} key="c" tone="steel">${t("crowd.mission.capped")}<//>`);
    if (round.testStatus && round.testStatus !== "open") parts.push(html`<span class="ar-res-note ar-res-muted" key="cl">${t("crowd.mission.closed")}</span>`);
  }
  return html`<div class="ar-result" role="status" data-testid="arena-result">${parts}</div>`;
}

/** The Arena clock chip, lit: a mission is part of the Daily Challenge. */
function ClockChip() {
  const t = useT();
  const seconds = useArenaClock();
  return html`
    <span class="ar-clock" data-on="true" title=${t("arena.console.clockOnTitle")} data-testid="arena-clock">
      <i class="sk-led" aria-hidden="true"></i><b class="sk-num" data-testid="arena-clock-value">${clock(seconds)}</b><span>${t("arena.console.clockOn")}</span>
    </span>`;
}

export function MissionConsole({ arena }) {
  const t = useT();
  const { round, prefs, actions } = arena;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const duel = round.duels[round.idx];
  const test = round.test;
  const revealing = round.phase === "reveal";
  const last = revealing ? round.last : null;
  const settled = !!last && !last.pending && !last.error;
  const blocked = !!last?.error && TERMINAL.includes(last.error);
  const leftId = duel.swap ? duel.b : duel.a;
  const rightId = duel.swap ? duel.a : duel.b;
  const sides = [test.items[leftId], test.items[rightId]];

  useEffect(() => { setAsking(false); }, [round.idx]);

  // auto-advance, but only once the answer is safely on the server
  useEffect(() => {
    if (!settled || !prefs.auto) return undefined;
    const id = setTimeout(() => actions.next(), AUTO_MS);
    return () => clearTimeout(id);
  }, [round.id, round.idx, settled, prefs.auto]);

  async function report() {
    setBusy(true);
    try {
      await reportTest(test.id);
      toast(t("crowd.mission.reported"), "emerald");
      actions.endRound();
    } catch {
      toast(t("crowd.err.generic"), "rose");
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <section class="ar-console ar-mission sk-panel" data-phase=${round.phase} data-mode="mission" data-testid="arena-console">
      <header class="ar-console-head">
        <div class="ar-q">
          <span class="ar-q-meta">
            <i class="sk-led" aria-hidden="true"></i>${test.title}
            <span class="ar-q-tag" data-testid="mission-tag">${t("crowd.mission.tag")}</span>
          </span>
          <h3 class="ar-q-text" data-testid="arena-question">${t(`crowd.q.${test.dim}`)}</h3>
          ${test.owner && html`
            <${PersonLink} who=${test.owner} className="ar-mi-owner">
              <${Avatar} name=${test.owner.name} url=${test.owner.avatarUrl} size=${20} />
              <span>${t("crowd.mission.by", { name: test.owner.name ?? t("feed.unknownAuthor") })}</span>
            <//>`}
        </div>
        <div class="ar-console-side">
          <div class="ar-console-side-top">
            <${Ladder} total=${round.duels.length} idx=${round.idx} results=${round.results} phase=${round.phase} />
            <button type="button" class="ar-leave" onClick=${actions.endRound} aria-label=${t("arena.console.leave")} title=${`${t("arena.console.leave")}  Esc`} data-testid="arena-leave"><${Icon} name="close" size=${14} /></button>
          </div>
          <span class="ar-round-count sk-num" data-testid="arena-progress">${round.idx + 1}<span class="sk-unit">/ ${round.duels.length}</span></span>
          <${ClockChip} />
        </div>
      </header>

      <div class="ar-stage" role="group" aria-label=${t("arena.console.stage")}>
        ${[0, 1].map((side) => {
          const picked = last ? last.side === side : false;
          const state = !revealing ? "idle" : picked ? "picked" : "other";
          return html`
            <${Specimen}
              key=${`${duel.id}-${side}`}
              art=${html`<${MissionArt} item=${sides[side]} t=${t} />`}
              side=${side}
              state=${state}
              kbd=${side === 0 ? "1" : "2"}
              name=${optionName(sides[side], t)}
              onPick=${actions.vote}
            >
              ${revealing && html`<${SideFoot} last=${last} side=${side} left=${leftId} right=${rightId} picked=${picked} t=${t} />`}
            <//>`;
        })}
        <span class="ar-vs sk-num" aria-hidden="true">VS</span>
      </div>

      <footer class="ar-console-foot">
        ${revealing
          ? html`<${ResultStrip} last=${last} round=${round} t=${t} />`
          : html`<span class="ar-mi-foot-note">${t("crowd.mission.title")}</span>`}
        <div class="ar-foot-actions">
          ${asking
            ? html`
              <span class="ar-mi-ask">${t("crowd.mission.reportConfirm")}</span>
              <${Button} data-ar-native=${true} size="sm" variant="danger" loading=${busy} onClick=${report} data-testid="mission-report-yes">${t("crowd.mission.report")}<//>
              <${Button} data-ar-native=${true} size="sm" variant="secondary" disabled=${busy} onClick=${() => setAsking(false)}>${t("common.cancel")}<//>`
            : html`
              <button type="button" class="cr-link ar-mi-report" data-ar-native=${true} onClick=${() => setAsking(true)} data-testid="mission-report">${t("crowd.mission.report")}</button>
              <label class="ar-auto" title=${t("arena.console.autoHint")}>
                <span>${t("arena.console.auto")}</span>
                <button type="button" role="switch" aria-checked=${!!prefs.auto} data-on=${!!prefs.auto} data-ar-native=${true} class="sk-switch-track relative h-5 w-9 shrink-0 rounded-full"
                  onClick=${(e) => { actions.setPref("auto", !prefs.auto); if (e.detail > 0) e.currentTarget.blur(); }} data-testid="arena-auto">
                  <span class="sk-switch-knob absolute top-0.5 left-0.5 h-4 w-4 rounded-full" style=${{ transform: prefs.auto ? "translateX(16px)" : "translateX(0)" }}></span>
                </button>
              </label>
              ${revealing
                ? last.error && !blocked
                  ? html`<${Button} data-ar-native=${true} onClick=${actions.retryMissionVote} data-testid="mission-retry"><${Icon} name="send" size=${14} />${t("crowd.mission.retry")}<//>`
                  : html`<${Button} data-ar-native=${true} className="ar-next" disabled=${!!last.pending} onClick=${actions.next} data-testid="arena-next">
                      ${blocked ? t("crowd.mission.lobby") : t("arena.console.next")}${!blocked && html`<span class="sk-kbd ar-next-kbd">Space</span>`}
                      ${settled && prefs.auto && html`<i class="ar-next-timer" style=${{ animationDuration: `${AUTO_MS}ms` }} key=${`${round.id}-${round.idx}`}></i>`}
                    <//>`
                : html`<${Button} data-ar-native=${true} variant="secondary" onClick=${actions.skip} data-testid="arena-skip">${t("arena.console.skip")}<span class="sk-kbd">S</span><//>`}`}
        </div>
      </footer>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

export function MissionSummary({ arena }) {
  const t = useT();
  const { round, view, actions } = arena;
  const [loading, setLoading] = useState(false);
  const done = round.results.filter((x) => !x.skipped && x.accepted);
  const xp = done.reduce((s, x) => s + (x.xp ?? 0), 0);
  const bonus = done.reduce((s, x) => s + (x.bonus ?? 0), 0);
  const avgMs = done.length ? Math.round(done.reduce((s, x) => s + (x.ms ?? 0), 0) / done.length) : 0;
  const owner = round.test.owner?.name ?? t("feed.unknownAuthor");

  async function another() {
    setLoading(true);
    try {
      const q = await fetchQueue(1);
      const x = q?.tests?.[0];
      if (x) { actions.startMission(x); return; }
      toast(t("crowd.mission.none"), "amber");
      actions.endRound();
    } catch {
      toast(t("crowd.err.generic"), "rose");
      setLoading(false);
    }
  }

  return html`
    <div class="ar-summary-wrap">
      <section class="ar-summary sk-panel" data-testid="arena-summary" data-mode="mission">
        <div class="ar-summary-top">
          <span class="sk-caption">${t("crowd.mission.doneTitle")}</span>
          <div class="ar-summary-xp sk-num" data-testid="arena-summary-xp">+${nf(xp)}<span class="sk-unit">XP</span></div>
          <p class="ar-mi-note" data-testid="mission-done-body">${t("crowd.mission.doneBody", { name: owner })}</p>
          <div class="ar-summary-level">
            <span class="sk-caption">${t("arena.level")} ${view.level} · ${t(`arena.rank.${view.rank}`)}</span>
            <${ProgressBar} value=${view.levelRatio} />
            <span class="sk-num ar-level-xp">${nf(view.levelInto)}<span class="sk-unit">/ ${nf(view.levelSpan)} XP</span></span>
          </div>
        </div>
        <div class="sk-stat-strip sk-stat-strip-well" style="--cols:3">
          <${StatTile} label=${t("crowd.mission.answered")} value=${`${done.length}`} hint=${t("arena.summary.answersHint", { n: round.duels.length })} />
          <${StatTile} label=${t("arena.summary.speed")} value=${avgMs ? `${(avgMs / 1000).toFixed(1)} ${t("common.unitSec")}` : "—"} hint=${t("arena.summary.speedHint")} />
          <${StatTile} label="XP" value=${`${xp}`} hint=${bonus > 0 ? t("crowd.mission.bonus", { xp: bonus }) : t("crowd.mission.xpLeft", { xp: round.missionXp ?? 0, cap: 300 })} />
        </div>
        <div class="ar-summary-actions">
          <${Button} data-ar-native=${true} loading=${loading} onClick=${another} data-testid="mission-next"><${Icon} name="play" size=${14} />${t("crowd.mission.next")}<//>
          <${Button} data-ar-native=${true} variant="secondary" onClick=${() => actions.endRound()} data-testid="arena-done">${t("crowd.mission.lobby")}<span class="sk-kbd">Enter</span><//>
        </div>
      </section>
    </div>
  `;
}
