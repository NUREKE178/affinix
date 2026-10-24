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
import { isMissingFunction, rpcHint } from "./rpcErrors.js";
import { useSession } from "./auth.js";
import { mulberry32, hashStringToSeed } from "./prng.js";
import { t as translate, getLocale } from "./i18n.js";
import { FAMILY_IDS, DIMENSION_IDS } from "./arena/catalog.js";
import { duelCode, encodeEntry, entryFromRow, convertLedgerEntryV1, decodeEntry } from "./arena/ledger.js";
import {
  ROUND_SIZE, CROWD_MIN_VOTES, IDLE_CUTOFF_S, localDay, seasonOf, addDays, flowBonus, isFlowMs, voteXp, pickSlate,
  DAILY_SET_SIZE, QUEST_BY_ID, EXTRA_SETS, SET_SIZE, THEME_QUEST,
} from "./arena/rules.js";
import { emptyBase, emptyProfile, emptyDay, fold, deriveView, claimReward } from "./arena/progress.js";

// The specimen generators and the round planner are the heavy part of the Arena. The app shell only needs to
// know progress and whether there is something to collect, so these load the first time a round starts.
let samplerMod = null;
const loadSampler = async () => (samplerMod ??= await import("./arena/sampler.js"));

const STORAGE_PREFIX = "decisionos_arena_v1:"; // the key kept its name; the payload's own `v` says which layout it is
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
    v: 2,
    userId,
    base: emptyBase(),
    pending: { votes: [], slices: [], claims: [], slate: null },
    sliceAcc: 0,
    ledger: {},                 // season -> [duel code * 2 + pick] (v2 encoding, see arena/ledger.js)
    dnaAgg: null,               // Taste DNA folded so far: { done: { season: entries counted }, all, byDim }
    drops: "unknown",           // unknown | yes | no: whether the server takes the daily-drop specimen indexes (migration 0026)
    dropsAt: 0,                 // when a "no" was last seen (it is asked again after a few minutes)
    pullSeq: {},                // season -> last server seq pulled
    round: null,
    recent: [],
    prefs: { auto: true, sound: false },
    announced: null,            // { badges: [], level } -- what the player has already been told about
    remote: "unknown",          // unknown | ready | unavailable | offline
    setsApi: "unknown",         // unknown | ok | old: whether the server counts the marathon's extra sets (migration 0023)
  };
}

function readLocal(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && (j.v === 1 || j.v === 2) && j.userId === userId ? j : null;
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
    // v1 stored duels of pools of 32 with eight question slots; v2 packs the drop indexes too (and drops the DNA fold,
    // which refers to the old codes -- it is rebuilt once from the ledger)
    ledger: j.v === 1 ? Object.fromEntries(Object.entries(j.ledger ?? {}).map(([k, a]) => [k, a.map(convertLedgerEntryV1)])) : (j.ledger ?? {}),
    dnaAgg: j.v === 1 ? null : (j.dnaAgg ?? null),
    drops: j.drops === "yes" ? "yes" : "unknown",
    dropsAt: 0,
    pullSeq: j.pullSeq ?? {},
    round: j.round ?? null,
    recent: j.recent ?? [],
    prefs: { ...d.prefs, ...(j.prefs ?? {}) },
    announced: j.announced ?? null,
    remote: "unknown",
    setsApi: "unknown",
  };
}

let persistTimer = null;
function persist(now = false) {
  if (!S) return;
  clearTimeout(persistTimer);
  const write = () => {
    persistTimer = null;
    try {
      const { remote, setsApi, ...rest } = S;
      localStorage.setItem(STORAGE_PREFIX + S.userId, JSON.stringify(rest));
    } catch { /* storage full or blocked: the session still works, it just won't survive a reload */ }
  };
  if (now) write(); else persistTimer = setTimeout(write, 450);
}

function normalizeDay(d) {
  const blank = emptyDay(d.day);
  return { ...blank, ...d, families: d.families ?? [], dims: d.dims ?? [], slate: d.slate ?? [], claimed: d.claimed ?? [], setVotes: d.setVotes ?? blank.setVotes, familyVotes: d.familyVotes ?? {} };
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
function dailyCodes(day, season, planDaily, drops) {
  const key = `${day}/${season}/${drops}`;
  let set = dailyCodeCache.get(key);
  if (!set) {
    const sets = EXTRA_SETS.flatMap((n) => samplerMod.planSet(day, season, n, undefined, { drops }));
    set = new Set([...planDaily(day, season, undefined, { drops }), ...sets].map((d) => duelCode(d.family, d.a, d.b, d.dim)));
    dailyCodeCache.set(key, set);
  }
  return set;
}

const DROPS_RETRY_MS = 10 * 60 * 1000;
/** Does the server take drop specimens (indexes above 31, the newer questions)? Asked once, with a harmless read: an old
 * server's pair check refuses the index and simply leaves the item out. Without an answer (offline) the Arena deals from
 * the classics, exactly as before. */
export async function ensureDrops() {
  if (!S) return false;
  if (S.drops === "yes") return true;
  if (S.drops === "no" && Date.now() - S.dropsAt < DROPS_RETRY_MS) return false;
  const userId = S.userId;
  let ok = false;
  try {
    const season = seasonOf();
    const data = await rpc("arena_tallies", { p_items: [{ pair: `${season}/mark/100-101`, dim: "friendly" }] });
    ok = Array.isArray(data) && data.length === 1;
  } catch { ok = false; }
  if (!S || S.userId !== userId) return false;
  const changed = S.drops !== (ok ? "yes" : "no");
  S.drops = ok ? "yes" : "no";
  S.dropsAt = Date.now();
  persist();
  if (changed) notify();
  return ok;
}

/** Synchronous answer for screens that only render what was already decided. */
export const dropsEnabled = () => S?.drops === "yes";

/** How many times this player has already met each specimen this season (family:index -> n), from the ledger. */
function exposureFor(season) {
  const map = new Map();
  for (const code of S.ledger[season] ?? []) {
    const e = decodeEntry(code);
    for (const i of [e.a, e.b]) map.set(`${e.family}:${i}`, (map.get(`${e.family}:${i}`) ?? 0) + 1);
  }
  return map;
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


function noteFailure(err) {
  if (!S) return;
  S.remote = isMissingFunction(err) ? "unavailable" : "offline";
}

function adopt(profile, days) {
  if (profile) S.base.profile = { ...emptyProfile(), ...profile, families: profile.families ?? [], badges: profile.badges ?? [] };
  for (const d of days ?? []) if (d?.day) S.base.days[d.day] = normalizeDay(d);
  // a server that has not got migration 0023 returns day rows without the sets: do not offer what it cannot keep
  const rows = (days ?? []).filter((d) => d?.day);
  if (rows.length) S.setsApi = rows.every((d) => Array.isArray(d.setVotes)) ? "ok" : "old";
}

let flushing = false;
let flushPromise = null;
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
  return { id: v.id, pair: v.pair, dim: v.dim, pick: v.pick, ms: v.ms, bonus: v.bonus, day: v.day, daily: v.daily, set: v.set || undefined, eye: v.eye, combo: v.combo };
}

/** Sends everything pending, in order: votes + time + the day's quests, then claims.
 * Never overlaps itself or a state refresh: two requests in flight at once could come back in either order,
 * and the older answer would then overwrite the newer one. */
export async function flush({ force = false, fromSync = false } = {}) {
  if (!fromSync && hydrating) await hydrating.catch(() => {});
  if (!S || (!force && S.remote === "unavailable")) return;
  if (flushing) { dirtyAgain = true; return flushPromise; }
  if (!hasPending()) return;
  flushing = true;
  flushPromise = runFlush();
  return flushPromise;
}

async function runFlush() {
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
      // the server did not take it (an older database, a condition not met there): say so instead of leaving a phantom reward
      else if (res && res.reason !== "claimed") pushNotice("warn", tt("arena.toast.claimRefused"));
    }
  } catch (err) {
    if (S && S.userId === userId) {
      noteFailure(err);
      failures++;
      if (S.remote === "offline") scheduleFlush(Math.min(300000, 5000 * 3 ** Math.min(failures, 5)));
    }
  } finally {
    flushing = false;
    flushPromise = null;
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
      // anything still waiting goes first (and an upload already under way finishes first), so the server's numbers include it
      if (flushPromise) await flushPromise.catch(() => {});
      if (hasPending() && S.remote !== "unavailable") await flush({ force: true, fromSync: true });
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
  const drops = await ensureDrops();
  if (!S) return;
  const day = localDay();
  const season = seasonOf();
  ensureSlate(day);
  getView();
  const seen = seenFor(season);
  let duels;
  if (mode === "daily") {
    duels = planDaily(day, season, undefined, { drops }).filter((d) => !seen.has(duelCode(d.family, d.a, d.b, d.dim)));
    if (!duels.length) { S.round = null; notify(); return; }
  } else {
    const rand = mulberry32(hashStringToSeed(`${S.userId}/${day}/${Date.now()}/${Math.random()}`));
    const taken = new Set([...seen, ...dailyCodes(day, season, planDaily, drops)]);
    duels = planRound({ season, rand, size: ROUND_SIZE, seen: taken, recent: S.recent, focus: focusFromView(getView()), day, drops, exposure: exposureFor(season) });
  }
  const now = Date.now();
  S.round = { id: uuid(), mode, day, season, duels, idx: 0, phase: "choose", results: [], combo: 0, startedAt: now, shownAt: now, tallies: {}, last: null };
  persist();
  notify();
  prefetchTallies(S.round);
}

/** Stage 3 of the Daily Challenge: extra shared set `n` (2..6). It is a Daily Challenge round (mode "daily"), so the
 * Arena clock treats it exactly like the first set: nothing about time changes. Sets open one after another, and a
 * set left half-way continues with the duels it still lacks. */
export async function startSet(n) {
  if (!S || !EXTRA_SETS.includes(n)) return false;
  const { planSet } = await loadSampler();
  const drops = await ensureDrops();
  if (!S) return false;
  const day = localDay();
  const season = seasonOf();
  ensureSlate(day);
  const v = getView();
  const open = v.daily.done && (n === 2 || v.sets[n - 3].done);
  const entry = v.sets[n - 2];
  if (!open || entry.done) return false;
  const seen = seenFor(season);
  const duels = planSet(day, season, n, undefined, { drops }).filter((d) => !seen.has(duelCode(d.family, d.a, d.b, d.dim))).slice(0, SET_SIZE - entry.votes);
  if (!duels.length) return false;
  const now = Date.now();
  S.round = { id: uuid(), mode: "daily", set: n, day, season, duels, idx: 0, phase: "choose", results: [], combo: 0, startedAt: now, shownAt: now, tallies: {}, last: null };
  persist();
  notify();
  prefetchTallies(S.round);
  return true;
}

/** Display side (0 = left, 1 = right) -> the canonical side the server stores. */
const canonicalSide = (duel, side) => (duel.swap ? 1 - side : side);

export function vote(side) {
  const r = S?.round;
  if (!r || r.phase !== "choose") return;
  if (r.mode === "mission") { voteMission(side); return; }
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
    S.pending.votes.push({ id: uuid(), pair: duel.pair, dim: duel.dim, pick, ms, bonus, day, daily: duel.daily, set: duel.set ?? 0, eye, combo, family: duel.family, xp, crowd });
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
  if (r.mode === "mission") {
    // a mission answer must reach the server before the next duel: wait for it, or let the player retry
    if (r.last?.pending) return;
    if (r.last?.error) { if (MISSION_STOPS.includes(r.last.error)) endRound(); return; }
  }
  advance();
}

function advance() {
  const r = S.round;
  // a mission whose test closed (its vote target was reached) is over, whatever pairs are left
  const testClosed = r.mode === "mission" && !!r.testStatus && r.testStatus !== "open";
  if (r.idx + 1 >= r.duels.length || testClosed) {
    r.phase = "summary";
    if (r.mode !== "mission") S.recent = [...S.recent, ...r.duels.map((d) => ({ family: d.family, a: d.a, b: d.b, dim: d.dim }))].slice(-8);
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

/** The number (2..6) of the extra set on screen, 0 for any other round. */
export function roundSet() {
  return S?.round?.set ?? 0;
}

/** "daily" | "free" | "mission" | null (no round on screen). */
export function roundMode() {
  return S?.round?.mode ?? null;
}

// ---------------------------------------------------------------------------
// research missions: the duels of someone's crowd test (migration 0022), played inside the Daily Challenge
// ---------------------------------------------------------------------------

/** Errors that end a mission instead of offering a retry (see arena_test_vote). */
const MISSION_STOPS = ["closed", "own", "pending"];

/** Starts a mission from a queue entry (crowdStore.fetchQueue): the pairs this player still owes, in random
 * order and with random sides. Answers go to the server one by one, which pays the XP and returns the split. */
export function startMission(test) {
  if (!S || !test?.pairs?.length) return false;
  const now = Date.now();
  const rand = mulberry32(hashStringToSeed(`${S.userId}/${test.id}/${now}/${Math.random()}`));
  const order = test.pairs.map((_, i) => ({ i, k: rand() })).sort((x, y) => x.k - y.k);
  const duels = order.map(({ i }) => ({ id: `${test.pairs[i][0]}|${test.pairs[i][1]}`, a: test.pairs[i][0], b: test.pairs[i][1], swap: rand() < 0.5 }));
  const items = Object.fromEntries((test.items ?? []).map((it) => [it.id, it]));
  S.round = {
    id: uuid(), mode: "mission", day: localDay(), season: seasonOf(),
    test: { id: test.id, title: test.title, dim: test.dim, owner: test.owner ?? null, items },
    duels, idx: 0, phase: "choose", results: [], combo: 0, startedAt: now, shownAt: now, tallies: {}, last: null, missionXp: null,
  };
  persist();
  notify();
  return true;
}

function voteMission(side) {
  const r = S.round;
  const duel = r.duels[r.idx];
  if (!duel) return;
  const left = duel.swap ? duel.b : duel.a;
  const right = duel.swap ? duel.a : duel.b;
  const pick = side === 0 ? left : right;
  const ms = Math.max(0, Date.now() - r.shownAt);
  const result = { duelId: duel.id, pick, side, ms, a: duel.a, b: duel.b, xp: null, bonus: 0, pending: true, error: null, tally: null, capped: false };
  r.phase = "reveal";
  r.results.push(result);
  r.last = result;
  notify();
  persist();
  sendMissionVote(r, result);
}

/** One answer to the server. Also the retry: a failed answer stays on the reveal screen with a button. */
async function sendMissionVote(r, result) {
  result.pending = true;
  result.error = null;
  notify();
  const userId = S?.userId;
  try {
    const res = await rpc("arena_test_vote", { p_test: r.test.id, p_votes: [{ a: result.a, b: result.b, pick: result.pick, ms: result.ms }], p_day: localDay() });
    if (!S || S.userId !== userId) return;
    const out = res?.results?.[0] ?? {};
    result.pending = false;
    result.accepted = !!out.accepted;
    result.xp = out.xp ?? 0;
    result.bonus = out.bonus ?? 0;
    result.capped = !!out.capped;
    result.reason = out.reason ?? null;
    // the server sends the votes for the lower item id (a) and the higher (b); the screen needs them per item
    const aIsLow = result.a < result.b;
    const lowVotes = out.aVotes ?? null;
    const highVotes = out.bVotes ?? null;
    result.tally = lowVotes === null ? null : (aIsLow ? { a: lowVotes, b: highVotes } : { a: highVotes, b: lowVotes });
    r.missionXp = res.missionXp ?? r.missionXp;
    r.testStatus = res.status ?? r.testStatus;
    adopt(res.state?.profile, res.days);
    S.remote = "ready";
    announceServerBadges(res.newBadges);
  } catch (err) {
    if (S && S.userId === userId) {
      result.pending = false;
      const hint = isMissingFunction(err) ? "pending" : rpcHint(err);
      result.error = hint ?? "offline";
      if (!hint) S.remote = "offline";
    }
  } finally {
    if (S) { persist(); notify(); }
  }
}

/** Sends the current reveal's answer again (after "no connection"). */
export function retryMissionVote() {
  const r = S?.round;
  if (r?.mode !== "mission" || r.phase !== "reveal" || !r.last?.error) return;
  sendMissionVote(r, r.last);
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
  else if (questId === THEME_QUEST) ok = v.theme.done && !v.theme.claimed;
  else if (/^set_[2-6]$/.test(questId)) { const e = v.sets.find((x) => `set_${x.n}` === questId); ok = !!e && e.done && !e.claimed; }
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

/** Rounds whose time counts. Time in the Arena is the time spent in the Daily Challenge (its ten shared duels and,
 * after them, the research missions); free play, the lobby and the other tabs never move the clock. */
const TIMED_MODES = ["daily", "mission"];

/** Is a timed duel on screen right now (read straight from the store, never a render behind)? */
export function clockRunning() {
  const r = S?.round;
  return !!r && TIMED_MODES.includes(r.mode) && (r.phase === "choose" || r.phase === "reveal");
}

/** Counts a second whenever the player is actually here (tab visible, input within IDLE_CUTOFF_S) AND is
 * inside the Daily Challenge. */
export function startActivityTracking() {
  let last = Date.now();
  const touch = () => { last = Date.now(); };
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
  for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - last > IDLE_CUTOFF_S * 1000) return;
    if (!clockRunning()) return;
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
  const before = S.base.profile.visible;
  S.base.profile.visible = !!visible;
  notify();
  try { await rpc("arena_set_visibility", { p_visible: !!visible }); } catch (err) {
    noteFailure(err);
    S.base.profile.visible = before; // the server did not take it: show the truth, not the optimistic flip
    notify();
    // `serverPending`: the Arena migration has not been applied yet (PostgREST: "Could not find the function ... in the schema cache")
    throw Object.assign(new Error(err?.message ?? String(err)), { code: err?.code, serverPending: isMissingFunction(err) });
  }
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
  const { extendDna } = await import("./arena/dna.js");
  if (!S || S.userId !== userId) return null;
  // folded once and then only extended with the answers given since: a player who has answered thousands of duels
  // (each of them on specimens that may never be seen again) must not make the profile page rebuild all of them
  S.dnaAgg = extendDna(S.dnaAgg, S.ledger);
  persist();
  const dna = { all: S.dnaAgg.all, byDim: S.dnaAgg.byDim };
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

/** "ready" once the server has been asked, "offline" / "unavailable" when it could not answer, "unknown" before. */
export function arenaRemote() {
  return S?.remote ?? "unknown";
}

export const actions = { startRound, startSet, startMission, retryMissionVote, vote, skip, next, endRound, claim, setPref, syncNow, flush };

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
    setsApi: ready ? S.setsApi : "unknown",
    drops: ready ? S.drops === "yes" : false,
    dropsOff: ready ? S.drops === "no" : false, // the probe ran and the server refused: migration 0026 is not applied
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
