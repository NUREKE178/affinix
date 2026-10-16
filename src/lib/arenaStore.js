// The Arena's client store: local-first, with the server as a mirror.
//
// Everything a player does is applied to the screen immediately and written to
// localStorage; votes, active-time slices and quest claims are queued and sent to
// Supabase (migration 0021) in the background. If those functions don't exist yet
// (the migration hasn't been applied) or the network is down, the Arena keeps
// working from the device and catches up later -- see lib/arena/progress.js for how
// "confirmed" and "pending" combine. Same module-level state + listener-set pattern
// as friendsStore.js / postsStore.js.
import { useState, useEffect } from "./preact.js";
import { supabase } from "./supabaseClient.js";
import { useSession } from "./auth.js";
import { mulberry32, hashStringToSeed } from "./prng.js";
import { t as translate, getLocale } from "./i18n.js";
import { FAMILY_IDS, DIMENSION_IDS } from "./arena/catalog.js";
import { duelCode, encodeEntry, entryFromRow } from "./arena/ledger.js";
import {
  ROUND_SIZE, CROWD_MIN_VOTES, IDLE_CUTOFF_S, localDay, seasonOf, addDays, flowBonus, isFlowMs, voteXp, pickSlate,
  DAILY_SET_SIZE, QUEST_BY_ID,
} from "./arena/rules.js";
import { emptyBase, emptyProfile, emptyDay, fold, deriveView, claimReward } from "./arena/progress.js";

// The specimen generators and the round planner are the heavy part of the Arena. The app shell only needs to
// know progress and whether there is something to collect, so these load the first time a round starts.
let samplerMod = null;
const loadSampler = async () => (samplerMod ??= await import("./arena/sampler.js"));

const STORAGE_PREFIX = "decisionos_arena_v1:";
const MAX_PENDING_VOTES = 3000;
const SLICE_SECONDS = 30;
const BATCH = 50;

export function uuid() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const h = (n) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${h(8)}-${h(4)}-4${h(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${h(3)}-${h(12)}`;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let S = null;                 // the loaded player's state; null until a user is known
let version = 0;
let viewMemo = { version: -1, day: "", view: null, folded: null };
const listeners = new Set();
const clockListeners = new Set();

function notify() {
  version++;
  for (const l of listeners) l();
}

function defaults(userId) {
  return {
    v: 1,
    userId,
    base: emptyBase(),
    pending: { votes: [], slices: [], claims: [], slate: null },
    sliceAcc: 0,
    ledger: {},                 // season -> [duel code * 2 + pick]
    pullSeq: {},                // season -> last server seq pulled
    round: null,
    recent: [],
    prefs: { auto: true, sound: false },
    announced: null,            // { badges: [], level } -- what the player has already been told about
    remote: "unknown",          // unknown | ready | unavailable | offline
  };
}

function readLocal(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.v === 1 && j.userId === userId ? j : null;
  } catch { return null; }
}

function hydrateLocal(userId) {
  const d = defaults(userId);
  const j = readLocal(userId);
  if (!j) return d;
  const base = emptyBase();
  base.profile = { ...emptyProfile(), ...(j.base?.profile ?? {}) };
  for (const [k, day] of Object.entries(j.base?.days ?? {})) base.days[k] = normalizeDay(day);
  return {
    ...d,
    base,
    pending: { votes: j.pending?.votes ?? [], slices: j.pending?.slices ?? [], claims: j.pending?.claims ?? [], slate: j.pending?.slate ?? null },
    sliceAcc: j.sliceAcc ?? 0,
    ledger: j.ledger ?? {},
    pullSeq: j.pullSeq ?? {},
    round: j.round ?? null,
    recent: j.recent ?? [],
    prefs: { ...d.prefs, ...(j.prefs ?? {}) },
    announced: j.announced ?? null,
    remote: "unknown",
  };
}

let persistTimer = null;
function persist(now = false) {
  if (!S) return;
  clearTimeout(persistTimer);
  const write = () => {
    persistTimer = null;
    try {
      const { remote, ...rest } = S;
      localStorage.setItem(STORAGE_PREFIX + S.userId, JSON.stringify(rest));
    } catch { /* storage full or blocked: the session still works, it just won't survive a reload */ }
  };
  if (now) write(); else persistTimer = setTimeout(write, 450);
}

function normalizeDay(d) {
  return { ...emptyDay(d.day), ...d, families: d.families ?? [], dims: d.dims ?? [], slate: d.slate ?? [], claimed: d.claimed ?? [] };
}

// ---------------------------------------------------------------------------
// derived data
// ---------------------------------------------------------------------------

function foldedState() {
  return fold(S.base, S.pending);
}

export function getView() {
  if (!S) return null;
  const today = localDay();
  if (viewMemo.version !== version || viewMemo.day !== today) {
    const folded = foldedState();
    viewMemo = { version, day: today, view: deriveView(folded, today), folded };
  }
  return viewMemo.view;
}

function seenFor(season) {
  S._seen ??= {};
  if (!S._seen[season] || S._seen[season].n !== (S.ledger[season]?.length ?? 0)) {
    const set = new Set();
    for (const code of S.ledger[season] ?? []) set.add(code >> 1);
    S._seen[season] = { set, n: S.ledger[season]?.length ?? 0 };
  }
  return S._seen[season].set;
}

const dailyCodeCache = new Map();
function dailyCodes(day, season, planDaily) {
  const key = `${day}/${season}`;
  let set = dailyCodeCache.get(key);
  if (!set) {
    set = new Set(planDaily(day, season).map((d) => duelCode(d.family, d.a, d.b, d.dim)));
    dailyCodeCache.set(key, set);
  }
  return set;
}

function addToLedger(season, code) {
  (S.ledger[season] ??= []).push(code);
  seenFor(season).add(code >> 1);
}

function pruneLedger(current) {
  const prev = seasonOf(new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(4)) - 2, 15)));
  for (const k of Object.keys(S.ledger)) if (k !== current && k !== prev) delete S.ledger[k];
  for (const k of Object.keys(S.pullSeq)) if (k !== current && k !== prev) delete S.pullSeq[k];
}

// ---------------------------------------------------------------------------
// quests
// ---------------------------------------------------------------------------

/** Today's three quests: the server's if it already has them, otherwise picked here (and sent with the next batch). */
function ensureSlate(day) {
  const have = S.base.days[day]?.slate ?? [];
  if (have.length === 3) { if (S.pending.slate?.day === day) S.pending.slate = null; return; }
  if (S.pending.slate?.day === day) return;
  const ids = pickSlate(mulberry32(hashStringToSeed(`${S.userId}/${day}/slate`)));
  S.pending.slate = { day, ids };
}

function focusFromView(v) {
  const open = v.quests.filter((q) => !q.done);
  const focus = { eye: open.some((q) => q.kind === "eye"), unseenFamilies: [], unseenDims: [] };
  if (open.some((q) => q.kind === "families")) focus.unseenFamilies = FAMILY_IDS.filter((f) => !v.today.families.includes(f));
  if (open.some((q) => q.kind === "dims")) focus.unseenDims = DIMENSION_IDS.filter((d) => !v.today.dims.includes(d));
  return focus;
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

async function rpc(name, args) {
  if (!supabase) throw Object.assign(new Error("Supabase is not configured."), { code: "NOT_CONFIGURED" });
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const isMissingFunction = (err) =>
  err?.code === "PGRST202" || err?.code === "42883" || err?.code === "NOT_CONFIGURED" || err?.status === 404 ||
  /could not find the function|function .* does not exist/i.test(err?.message ?? "");

function noteFailure(err) {
  if (!S) return;
  S.remote = isMissingFunction(err) ? "unavailable" : "offline";
}

function adopt(profile, days) {
  if (profile) S.base.profile = { ...emptyProfile(), ...profile, families: profile.families ?? [], badges: profile.badges ?? [] };
  for (const d of days ?? []) if (d?.day) S.base.days[d.day] = normalizeDay(d);
}

let flushing = false;
let dirtyAgain = false;
let flushTimer = null;
let failures = 0;

function hasPending() {
  const p = S.pending;
  return p.votes.length > 0 || p.slices.length > 0 || p.claims.length > 0 || !!p.slate;
}

export function scheduleFlush(ms = 3500) {
  if (!S || S.remote === "unavailable") return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(), ms);
}

function wireVote(v) {
  return { id: v.id, pair: v.pair, dim: v.dim, pick: v.pick, ms: v.ms, bonus: v.bonus, day: v.day, daily: v.daily, eye: v.eye, combo: v.combo };
}

/** Sends everything pending, in order: votes + time + the day's quests, then claims. */
export async function flush({ force = false } = {}) {
  if (!S || (!force && S.remote === "unavailable")) return;
  if (flushing) { dirtyAgain = true; return; }
  if (!hasPending()) return;
  flushing = true;
  const userId = S.userId;
  try {
    ensureSlate(localDay());
    let guard = 0;
    while (S && S.userId === userId && (S.pending.votes.length || S.pending.slices.length || S.pending.slate) && guard++ < 60) {
      const votes = S.pending.votes.slice(0, BATCH);
      const slices = S.pending.slices.slice(0, BATCH);
      const slate = S.pending.slate;
      const res = await rpc("arena_submit", { p_votes: votes.map(wireVote), p_slices: slices, p_slate: slate, p_day: localDay() });
      if (!S || S.userId !== userId) return;
      const sentV = new Set(votes.map((v) => v.id));
      const sentS = new Set(slices.map((s) => s.id));
      S.pending.votes = S.pending.votes.filter((v) => !sentV.has(v.id));
      S.pending.slices = S.pending.slices.filter((s) => !sentS.has(s.id));
      adopt(res.state?.profile, res.days);
      if (slate && (S.base.days[slate.day]?.slate.length ?? 0) > 0) S.pending.slate = null;
      S.remote = "ready";
      failures = 0;
      announceServerBadges(res.newBadges);
    }
    while (S && S.userId === userId && S.pending.claims.length) {
      const c = S.pending.claims[0];
      const res = await rpc("arena_claim", { p_day: c.day, p_quest: c.quest });
      if (!S || S.userId !== userId) return;
      S.pending.claims = S.pending.claims.filter((x) => !(x.day === c.day && x.quest === c.quest));
      if (res?.state) adopt(res.state.profile, [res.state.today].filter(Boolean));
      if (res?.ok) announceServerBadges(res.newBadges);
    }
  } catch (err) {
    if (S && S.userId === userId) {
      noteFailure(err);
      failures++;
      if (S.remote === "offline") scheduleFlush(Math.min(300000, 5000 * 3 ** Math.min(failures, 5)));
    }
  } finally {
    flushing = false;
    if (S) { persist(); notify(); }
    if (dirtyAgain) { dirtyAgain = false; scheduleFlush(800); }
  }
}

function announceServerBadges(ids) {
  if (!S?.announced || !ids?.length) return;
  for (const id of ids) if (!S.announced.badges.includes(id)) announceBadge(id);
}

let hydrating = null;

/** Asks the server for the authoritative state; falls back quietly to the device when it can't answer. */
export function syncNow() {
  if (!S) return Promise.resolve();
  if (hydrating) return hydrating;
  const userId = S.userId;
  hydrating = (async () => {
    try {
      // anything still waiting goes first, so the server's numbers include it
      if (hasPending() && S.remote !== "unavailable") await flush({ force: true });
      const data = await rpc("arena_state", { p_day: localDay(), p_history: 84 });
      if (!S || S.userId !== userId) return;
      const base = emptyBase();
      S.base = base;
      adopt(data.profile, [...(data.days ?? []), data.today].filter(Boolean));
      S.remote = "ready";
      failures = 0;
      ensureSlate(localDay());
      await pullLedger(data.profile?.votes ?? 0);
      if (hasPending()) scheduleFlush(300);
    } catch (err) {
      if (S && S.userId === userId) noteFailure(err);
    } finally {
      hydrating = null;
      if (S) {
        initAnnounced();
        persist();
        notify();
      }
    }
  })();
  return hydrating;
}

/** A new device has none of the player's earlier answers: fetch this and last season's. */
async function pullLedger(serverVotes) {
  const season = seasonOf();
  pruneLedger(season);
  const have = Object.values(S.ledger).reduce((n, a) => n + a.length, 0);
  const prev = seasonOf(new Date(Date.UTC(Number(season.slice(0, 4)), Number(season.slice(4)) - 2, 15)));
  for (const s of [prev, season]) {
    if (S.pullSeq[s] !== undefined && serverVotes <= have + 3) continue;
    let after = S.pullSeq[s] ?? 0;
    const known = new Set((S.ledger[s] ?? []).map((c) => c));
    for (let page = 0; page < 12; page++) {
      const res = await rpc("arena_my_votes", { p_season: s, p_after: after, p_limit: 5000 });
      for (const row of res.rows ?? []) {
        const e = entryFromRow(row);
        if (e && !known.has(e.code)) { known.add(e.code); (S.ledger[s] ??= []).push(e.code); }
      }
      after = res.last ?? after;
      if (!res.more) break;
    }
    S.pullSeq[s] = after;
    delete S._seen;
  }
}

async function prefetchTallies(round) {
  if (!S || S.remote === "unavailable" || !supabase) return;
  const items = round.duels.filter((d) => !d.repeat).map((d) => ({ pair: d.pair, dim: d.dim }));
  if (!items.length) return;
  try {
    const data = await rpc("arena_tallies", { p_items: items });
    if (!S || S.round?.id !== round.id) return;
    for (const t of data ?? []) S.round.tallies[`${t.pair}|${t.dim}`] = t;
    persist();
    notify();
  } catch (err) {
    if (S) noteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// announcements
// ---------------------------------------------------------------------------

function tt(key, vars) {
  return translate(getLocale(), key, vars);
}

// Level-ups, badges and claimed rewards show as small notices inside the Arena page (not the app-wide toast,
// which sits on top of the Next key at the bottom of the console).
let notices = [];
let noticeSeq = 0;

export function dismissNotice(id) {
  notices = notices.filter((n) => n.id !== id);
  notify();
}

function pushNotice(kind, text) {
  const id = ++noticeSeq;
  notices = [...notices, { id, kind, text }].slice(-3);
  notify();
  setTimeout(() => dismissNotice(id), 4800);
}

function badgeLabel(id) {
  const m = /^(votes|streak|daily|level)_(\d+)$/.exec(id);
  return m ? tt(`arena.badgeName.${m[1]}`, { n: new Intl.NumberFormat(getLocale()).format(Number(m[2])) }) : tt(`arena.badge.${id}.name`);
}

function announceBadge(id) {
  if (!S.announced.badges.includes(id)) S.announced.badges.push(id);
  pushNotice("badge", tt("arena.toast.badge", { name: badgeLabel(id) }));
}

/** First load for a player: whatever they already have is not news. */
function initAnnounced() {
  if (S.announced) return;
  const v = getView();
  S.announced = { badges: v.badges.filter((b) => b.unlocked).map((b) => b.id), level: v.level };
}

function checkMilestones(before, after) {
  if (!S.announced) { initAnnounced(); return; }
  if (after.level > before.level && after.level > (S.announced.level ?? 1)) {
    S.announced.level = after.level;
    pushNotice("level", tt("arena.toast.levelUp", { level: after.level, rank: tt(`arena.rank.${after.rank}`) }));
  }
  for (const b of after.badges) if (b.unlocked && !S.announced.badges.includes(b.id)) announceBadge(b.id);
}

// ---------------------------------------------------------------------------
// rounds
// ---------------------------------------------------------------------------

export async function startRound(mode = "free") {
  if (!S) return;
  const { planRound, planDaily } = await loadSampler();
  if (!S) return;
  const day = localDay();
  const season = seasonOf();
  ensureSlate(day);
  getView();
  const seen = seenFor(season);
  let duels;
  if (mode === "daily") {
    duels = planDaily(day, season).filter((d) => !seen.has(duelCode(d.family, d.a, d.b, d.dim)));
    if (!duels.length) { S.round = null; notify(); return; }
  } else {
    const rand = mulberry32(hashStringToSeed(`${S.userId}/${day}/${Date.now()}/${Math.random()}`));
    const taken = new Set([...seen, ...dailyCodes(day, season, planDaily)]);
    duels = planRound({ season, rand, size: ROUND_SIZE, seen: taken, recent: S.recent, focus: focusFromView(getView()) });
  }
  const now = Date.now();
  S.round = { id: uuid(), mode, day, season, duels, idx: 0, phase: "choose", results: [], combo: 0, startedAt: now, shownAt: now, tallies: {}, last: null };
  persist();
  notify();
  prefetchTallies(S.round);
}

/** Display side (0 = left, 1 = right) -> the canonical side the server stores. */
const canonicalSide = (duel, side) => (duel.swap ? 1 - side : side);

export function vote(side) {
  const r = S?.round;
  if (!r || r.phase !== "choose") return;
  const duel = r.duels[r.idx];
  if (!duel) return;
  const before = getView();
  const pick = canonicalSide(duel, side);
  const ms = Math.max(0, Date.now() - r.shownAt);
  const tally = r.tallies[`${duel.pair}|${duel.dim}`] ?? null;
  const total = tally ? tally.a + tally.b : null;
  const pioneer = total === 0;
  const crowd = tally && total >= CROWD_MIN_VOTES && tally.a !== tally.b ? pick === (tally.a > tally.b ? 0 : 1) : null;
  const combo = duel.repeat ? r.combo : isFlowMs(ms) ? r.combo + 1 : 0;
  const bonus = flowBonus(combo);
  const eye = duel.objective ? pick === duel.truth : null;
  const xp = duel.repeat ? 0 : voteXp({ ms, bonus, pioneer });

  if (!duel.repeat) {
    const day = localDay();
    S.pending.votes.push({ id: uuid(), pair: duel.pair, dim: duel.dim, pick, ms, bonus, day, daily: duel.daily, eye, combo, family: duel.family, xp, crowd });
    addToLedger(duel.season, encodeEntry(duel.family, duel.a, duel.b, duel.dim, pick));
    compactPending();
    scheduleFlush();
  }
  r.combo = combo;
  r.phase = "reveal";
  const result = { duelId: duel.id, pick, side, xp, bonus, combo, eye, crowd, pioneer, ms, repeat: duel.repeat, tally };
  r.results.push(result);
  r.last = result;
  notify();
  const after = getView();
  checkMilestones(before, after);
  persist();
}

export function skip() {
  const r = S?.round;
  if (!r || r.phase !== "choose") return;
  r.results.push({ duelId: r.duels[r.idx].id, skipped: true, xp: 0 });
  r.combo = 0;
  advance();
}

export function next() {
  const r = S?.round;
  if (!r || r.phase !== "reveal") return;
  advance();
}

function advance() {
  const r = S.round;
  if (r.idx + 1 >= r.duels.length) {
    r.phase = "summary";
    S.recent = [...S.recent, ...r.duels.map((d) => ({ family: d.family, a: d.a, b: d.b, dim: d.dim }))].slice(-8);
    flush();
  } else {
    r.idx++;
    r.phase = "choose";
    r.shownAt = Date.now();
  }
  persist();
  notify();
}

/** Leaves the round screen (the summary's "done"). */
export function endRound() {
  if (!S) return;
  S.round = null;
  persist();
  notify();
}

/** The current screen of the Play tab, read straight from the store so a key handler is never a render behind. */
export function roundPhase() {
  return S?.round?.phase ?? "lobby";
}

export function summarize(round) {
  const played = round.results.filter((x) => !x.skipped && !x.repeat);
  const eyeRes = played.filter((x) => x.eye !== null && x.eye !== undefined);
  const crowdRes = played.filter((x) => x.crowd !== null && x.crowd !== undefined);
  return {
    answered: played.length,
    xp: played.reduce((s, x) => s + x.xp, 0),
    bestCombo: Math.max(0, ...played.map((x) => x.combo)),
    eye: { correct: eyeRes.filter((x) => x.eye).length, total: eyeRes.length },
    crowd: { hits: crowdRes.filter((x) => x.crowd).length, total: crowdRes.length },
    avgMs: played.length ? Math.round(played.reduce((s, x) => s + x.ms, 0) / played.length) : 0,
    seconds: Math.round((Date.now() - round.startedAt) / 1000),
  };
}

function compactPending() {
  if (S.pending.votes.length > MAX_PENDING_VOTES) {
    const old = S.pending.votes.splice(0, 500);
    S.base = fold(S.base, { votes: old });
  }
}

// ---------------------------------------------------------------------------
// quests
// ---------------------------------------------------------------------------

export function claim(questId) {
  if (!S) return false;
  const day = localDay();
  const v = getView();
  let ok = false;
  if (questId === "daily_set") ok = v.daily.done && !v.daily.claimed;
  else if (questId === "daily_clear") ok = v.clear.ready;
  else {
    const q = v.quests.find((x) => x.id === questId);
    ok = !!q && q.done && !q.claimed && !!QUEST_BY_ID[questId];
  }
  if (!ok) return false;
  const before = v;
  S.pending.claims.push({ day, quest: questId });
  notify();
  checkMilestones(before, getView());
  pushNotice("xp", tt("arena.toast.claimed", { xp: claimReward(questId) }));
  persist();
  flush({ force: true });
  return true;
}

// ---------------------------------------------------------------------------
// time in the Arena
// ---------------------------------------------------------------------------

function cutSlice() {
  if (!S || S.sliceAcc < 1) return;
  S.pending.slices.push({ id: uuid(), day: localDay(), sec: Math.min(600, Math.round(S.sliceAcc)) });
  S.sliceAcc = 0;
  if (S.pending.slices.length > 400) {
    // keep the list short while offline: one slice per day
    const byDay = new Map();
    for (const s of S.pending.slices) byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.sec);
    S.pending.slices = [...byDay].flatMap(([day, sec]) => { const out = []; for (let left = sec; left > 0; left -= 600) out.push({ id: uuid(), day, sec: Math.min(600, left) }); return out; });
  }
  scheduleFlush(6000);
  notify();
}

function tickSecond() {
  if (!S) return;
  S.sliceAcc += 1;
  if (S.sliceAcc >= SLICE_SECONDS) { cutSlice(); persist(); }
  for (const l of clockListeners) l();
}

/** Seconds of play today, to the second (confirmed + queued + the slice being counted). */
export function secondsToday() {
  if (!S) return 0;
  return (getView()?.today.sec ?? 0) + (S.sliceAcc ?? 0);
}

/** Counts a second whenever the player is actually here: tab visible, window focused, input within IDLE_CUTOFF_S. */
export function startActivityTracking() {
  let last = Date.now();
  const touch = () => { last = Date.now(); };
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
  for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - last > IDLE_CUTOFF_S * 1000) return;
    tickSecond();
  }, 1000);
  return () => {
    clearInterval(timer);
    for (const e of events) window.removeEventListener(e, touch, { capture: true });
    cutSlice();
    persist(true);
    flush();
  };
}

// ---------------------------------------------------------------------------
// preferences, visibility, reports
// ---------------------------------------------------------------------------

export function setPref(key, value) {
  if (!S) return;
  S.prefs = { ...S.prefs, [key]: value };
  persist();
  notify();
}

export async function setLeaderboardVisibility(visible) {
  if (!S) return;
  S.base.profile.visible = !!visible;
  notify();
  try { await rpc("arena_set_visibility", { p_visible: !!visible }); } catch (err) { noteFailure(err); notify(); throw err; }
  persist();
}

export async function fetchLeaderboard(scope, friends) {
  await flush({ force: true }).catch(() => {});
  return rpc("arena_leaderboard", { p_scope: scope, p_friends: !!friends });
}

export async function fetchDailyReport(day) {
  await flush({ force: true }).catch(() => {});
  return rpc("arena_daily_report", { p_day: day });
}

export async function fetchAdminStats(days = 14) {
  return rpc("arena_admin_stats", { p_days: days });
}

/** Taste DNA from the player's ledger (heavy the first time: it builds the specimens it refers to). */
let dnaMemo = null;
export async function computeDna() {
  if (!S) return null;
  const n = Object.values(S.ledger).reduce((s, a) => s + a.length, 0);
  if (dnaMemo && dnaMemo.userId === S.userId && dnaMemo.n === n) return dnaMemo.dna;
  const userId = S.userId;
  const { dnaFromLedger } = await import("./arena/dna.js");
  if (!S || S.userId !== userId) return null;
  const dna = dnaFromLedger(S.ledger);
  dnaMemo = { userId, n, dna };
  return dna;
}

/** Which side (0 = lower index) the player picked on a duel, from the local ledger; null if never answered. */
export function answeredPick(season, family, a, b, dim) {
  if (!S) return null;
  const code = duelCode(family, a, b, dim);
  const arr = S.ledger[season] ?? [];
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >> 1 === code) return arr[i] & 1;
  return null;
}

export function ledgerSize() {
  return S ? Object.values(S.ledger).reduce((s, a) => s + a.length, 0) : 0;
}

// ---------------------------------------------------------------------------
// the hook
// ---------------------------------------------------------------------------

let bootedFor = null;
let globalHandlersAttached = false;

function ensureLoaded(userId) {
  if (S && S.userId === userId) return;
  if (S) { persist(true); }
  S = hydrateLocal(userId);
  viewMemo = { version: -1, day: "", view: null, folded: null };
  dnaMemo = null;
  bootedFor = userId;
  ensureSlate(localDay());
  pruneLedger(seasonOf());
  initAnnounced();
  if (!globalHandlersAttached) {
    globalHandlersAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && S) { cutSlice(); persist(true); flush(); }
    });
    window.addEventListener("pagehide", () => { if (S) { cutSlice(); persist(true); } });
    window.addEventListener("online", () => { if (S && S.remote === "offline") { failures = 0; flush(); } });
  }
  notify();
  // anything a previous visit left unsent goes out even if the player never opens the Arena this time
  if (hasPending()) scheduleFlush(2500);
}

/** The first Arena visit of a page load asks the server for the authoritative numbers. */
function ensureSynced() {
  if (!S || S._synced) return;
  S._synced = true;
  syncNow();
  // a round left open from an earlier visit: re-fetch its community numbers
  if (S.round && S.round.phase !== "summary") prefetchTallies(S.round);
}

export const actions = { startRound, vote, skip, next, endRound, claim, setPref, syncNow, flush };

export function useArena() {
  const [, setTick] = useState(0);
  const { user } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    l();
    return () => listeners.delete(l);
  }, []);

  useEffect(() => {
    if (userId) { ensureLoaded(userId); ensureSynced(); }
  }, [userId]);

  const ready = !!S && S.userId === userId;
  return {
    ready,
    view: ready ? getView() : null,
    round: ready ? S.round : null,
    prefs: ready ? S.prefs : { auto: true, sound: false },
    remote: ready ? S.remote : "unknown",
    pendingCount: ready ? S.pending.votes.length : 0,
    notices,
    actions,
  };
}

/** Progress without any network: for the app shell and the dashboard card, where the Arena is only a doorway. */
export function useArenaLocal() {
  const [, setTick] = useState(0);
  const { user } = useSession();
  const userId = user?.id ?? null;
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    l();
    return () => listeners.delete(l);
  }, []);
  useEffect(() => {
    if (userId) ensureLoaded(userId);
  }, [userId]);
  const ready = !!S && S.userId === userId;
  return { ready, view: ready ? getView() : null };
}

/** How many things are waiting for a player who has already played: today's daily challenge and rewards to collect. */
export function arenaAttention(view) {
  if (!view || view.votes === 0) return 0;
  const claimable = view.quests.filter((q) => q.done && !q.claimed).length + (view.daily.done && !view.daily.claimed ? 1 : 0) + (view.clear.ready ? 1 : 0);
  return (view.daily.done ? 0 : 1) + claimable;
}

/** Re-renders every second: for the live "time today" readout only. */
export function useArenaClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    clockListeners.add(l);
    return () => clockListeners.delete(l);
  }, []);
  return secondsToday();
}

export { localDay, addDays, DAILY_SET_SIZE };
