// Taste Match on screen: the one-screen welcome (own, or from a friend's link), the share card after a round, and the
// match after a friend's challenge. The logic is in lib/arena/challenge.js; this file only draws it.
import { html, useMemo } from "../../lib/preact.js";
import { Button, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { useMyProfile } from "../../lib/profile.js";
import { useSession } from "../../lib/auth.js";
import { Thumb } from "./parts.js";
import { actions } from "../../lib/arenaStore.js";
import { encodeChallenge, answersOfRound, matchOf, matchLabel, cleanName, seasonIsLive } from "../../lib/arena/challenge.js";
import { forgetChallenge, snoozeChallenge, markFirstLookSeen } from "../../lib/arena/inbox.js";

const initialOf = (name) => (Array.from(name ?? "")[0] ?? "?").toUpperCase();

/** This person's first name: from the profile once it has loaded, from what they typed at sign-up until then (no flicker). */
function useMyName() {
  const { profile } = useMyProfile();
  const { user } = useSession();
  return cleanName(profile?.full_name ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name);
}

/** Starts the waiting challenge. It is forgotten only once the round is really open, so a failed start loses nothing. */
export async function playChallenge(challenge) {
  const ok = await actions.startChallenge(challenge);
  if (ok) forgetChallenge();
  return ok;
}

/** The first thing a new person sees in the Arena: no questions, one button. `challenge` is a friend's waiting link (or null). */
export function FirstLook({ userId, challenge, onDone }) {
  const t = useT();
  const mine = useMyName();
  const from = challenge ? (challenge.name ?? t("arena.challenge.someone")) : null;

  async function start() {
    markFirstLookSeen(userId);
    if (challenge) await playChallenge(challenge);
    else await actions.startRound("daily");
    onDone?.();
  }
  function later() {
    markFirstLookSeen(userId);
    if (challenge) snoozeChallenge();
    onDone?.();
  }

  return html`
    <div class="ar-first" data-testid="arena-firstlook" data-kind=${challenge ? "challenge" : "own"}>
      <section class="ar-first-card sk-panel">
        ${challenge
          ? html`<span class="ar-first-avatar" aria-hidden="true">${initialOf(from)}</span>`
          : html`<span class="ar-first-mark" aria-hidden="true"><${Icon} name="sparkle" size=${26} /></span>`}
        <h2 class="ar-first-title">${challenge ? t("arena.challenge.title", { name: from }) : mine ? t("arena.firstLook.title", { name: mine }) : t("arena.firstLook.titleNoName")}</h2>
        <p class="ar-first-body">${challenge ? t("arena.challenge.body") : t("arena.firstLook.body")}</p>
        ${challenge
          ? html`
            <div class="ar-first-dots" aria-hidden="true">${challenge.answers.map((_, i) => html`<i key=${i}>?</i>`)}</div>
            <div class="ar-first-fact">${t("arena.challenge.hidden")}</div>`
          : html`
            <div class="ar-first-facts"><span>${t("arena.firstLook.fact1")}</span><i></i><span>${t("arena.firstLook.fact2")}</span><i></i><span>${t("arena.firstLook.fact3")}</span></div>`}
        ${challenge && !seasonIsLive(challenge.season) && html`<p class="ar-first-old" data-testid="arena-challenge-old">${t("arena.challenge.oldSeason")}</p>`}
        <${Button} size="lg" className="ar-first-start" onClick=${start} data-testid="arena-firstlook-start">${challenge ? t("arena.challenge.play") : t("arena.firstLook.start")}<//>
        <button type="button" class="ar-first-later" onClick=${later} data-testid="arena-firstlook-later">${challenge ? t("arena.challenge.later") : t("arena.firstLook.later")}</button>
      </section>
      <p class="ar-first-note">${challenge ? t("arena.challenge.keep") : t("arena.firstLook.note")}</p>
    </div>
  `;
}

/** "Challenge a friend": the answers of the round that was just played, as a link. mode "after" (a normal round) or "own"
 * (after a friend's challenge: the same pairs, with this person's answers, for somebody else). */
export function ChallengeShare({ round, mode = "after" }) {
  const t = useT();
  const myName = useMyName();
  const picked = useMemo(() => answersOfRound(round), [round.id]);
  const n = picked.answers.length;
  const text = useMemo(() => (n ? encodeChallenge({ season: picked.season, answers: picked.answers, name: myName }) : null), [round.id, myName]);
  if (!n || !text) return null;
  const url = `${location.origin}/?c=${text}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("arena.challenge.copied"), "emerald");
    } catch {
      toast(t("arena.challenge.copyFailed"), "rose");
    }
  }
  async function share() {
    if (!navigator.share) { await copy(); return; }
    try {
      await navigator.share({ title: t("arena.challenge.shareHeading"), text: t("arena.challenge.shareText", { n }), url });
    } catch (err) {
      if (err?.name !== "AbortError") await copy(); // the person closing the share sheet is not an error
    }
  }

  return html`
    <section class="ar-share sk-panel" data-testid="arena-share-card">
      <div class="ar-share-head">
        <span class="sk-tile"><${Icon} name="send" size=${16} /></span>
        <h3>${mode === "own" ? t("arena.match.sendOwn") : t("arena.challenge.shareTitle")}</h3>
      </div>
      <p class="ar-share-body">${mode === "own" ? t("arena.match.sendOwnBody", { n }) : t("arena.challenge.shareBody", { n })}</p>
      <div class="ar-share-link"><span data-testid="arena-share-url">${url}</span><button type="button" onClick=${copy}>${t("arena.challenge.copy")}</button></div>
      <${Button} onClick=${share} data-testid="arena-share"><${Icon} name="send" size=${14} />${t("arena.challenge.shareCta")}<//>
      <p class="ar-share-note">${t("arena.challenge.privacy", { n })}</p>
    </section>
  `;
}

/** The result of a friend's challenge: the percentage, one segment per duel, and the pairs where the two people split. */
export function MatchBlock({ round }) {
  const t = useT();
  const myName = useMyName();
  const ch = round.challenge;
  const m = useMemo(() => matchOf(ch.answers, round.duels.map((_, i) => (round.results[i]?.skipped ? null : round.results[i]?.pick ?? null))), [round.id]);
  const them = ch.from ?? t("arena.challenge.someone");
  const me = myName || t("arena.match.you");
  const label = matchLabel(m.percent);
  const shown = m.splits.slice(0, 4);
  return html`
    <section class="ar-match sk-panel" data-testid="arena-match" data-percent=${m.percent ?? ""}>
      <div class="ar-match-names">${t("arena.match.vs", { a: me, b: them })}</div>
      ${m.percent === null
        ? html`<div class="ar-match-pct">—</div>`
        : html`
          <div class="ar-match-pct sk-num" data-testid="arena-match-pct">${m.percent}<span>%</span></div>
          <div class="ar-match-label">${t("arena.match.label")}</div>
          <div class="ar-match-line">${t("arena.match.line", { same: m.same, total: m.compared })} <b data-testid="arena-match-band">${t(`arena.match.${label}`)}</b></div>`}
      <div class="ar-match-segs" role="img" aria-label=${t("arena.match.line", { same: m.same, total: m.compared })}>
        ${m.sameAt.map((eq, i) => html`<span key=${i} data-state=${eq === null ? "skip" : eq ? "same" : "split"}><i></i><em>${i + 1}</em></span>`)}
      </div>
      <h3 class="ar-match-h">${t("arena.match.splits")}</h3>
      ${shown.length === 0
        ? html`<p class="ar-match-none">${t("arena.match.noSplits")}</p>`
        : html`
          <div class="ar-match-splits">
            ${shown.map((i) => {
              const d = round.duels[i];
              const mineSide = round.results[i].pick;
              const theirSide = ch.answers[i].pick;
              return html`
                <div class="ar-match-split" key=${i} data-testid="arena-match-split">
                  <span class="ar-match-n">${i + 1}</span>
                  ${[d.a, d.b].map((idx, side) => html`
                    <span class="ar-match-pick" key=${side} data-me=${mineSide === side} data-them=${theirSide === side}>
                      <${Thumb} season=${d.season} family=${d.family} index=${idx} size=${56} />
                      <b>${mineSide === side ? t("arena.match.you") : initialOf(them)}</b>
                    </span>`)}
                </div>`;
            })}
            ${m.splits.length > shown.length && html`<p class="ar-match-more">${t("arena.match.more", { n: m.splits.length - shown.length })}</p>`}
          </div>`}
    </section>
  `;
}
