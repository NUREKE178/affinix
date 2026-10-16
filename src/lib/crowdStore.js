// Crowd tests ("ask the Arena crowd"): the browser side of migration 0022.
//
// A person puts 2-4 options in front of the community (images and/or short texts) with one question; Arena
// players answer it as research missions (pairwise duels between the options); the owner reads a verdict.
// This module holds the database calls, the image preparation + upload, the verdict maths, and the small
// reactive stores the Research page and the Arena lobby read. The mission round itself lives in arenaStore.js
// (it is a kind of Arena round).
import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { isMissingFunction, rpcHint } from "./rpcErrors.js";
import { withTimeout } from "./async.js";
import { wilsonInterval, MIN_RELIABLE_SAMPLE } from "./stats.js";
import { useArenaLocal, arenaRemote, actions as arenaActions } from "./arenaStore.js";

export const TEST_DIMS = ["preference", "attention", "trust", "quality", "premium", "clarity", "purchaseIntent"];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MIN_TITLE = 3;
export const MAX_TITLE = 80;
export const MAX_LABEL = 60;
/** XP needed before a person may create tests (level 2): play before you ask. Mirrors arena_test_create. */
export const CREATE_MIN_XP = 100;
export const MAX_OPEN_TESTS = 3;

/** Whether the person is still below the level that opens test creation. The Arena profile is local-first: a
 * device that has never synced shows 0 XP for a level-2 player, so the gate is announced only once the server has
 * been asked (never a "play first" notice that is about to vanish). `sync: true` (the create page) asks it when the
 * local copy looks short; the Research page does not, so opening it never starts Arena traffic by itself. */
export function useCreateGate({ sync = false } = {}) {
  const { ready, view } = useArenaLocal();
  const xp = ready && view ? view.xp : null;
  const below = xp !== null && xp < CREATE_MIN_XP;
  const remote = ready ? arenaRemote() : "unknown";
  useEffect(() => {
    if (sync && below && remote === "unknown") arenaActions.syncNow();
  }, [sync, below, remote]);
  return { xp, locked: below && remote === "ready" };
}

const BUCKET = "arena-tests";
const MAX_SIDE = 1024;
const MAX_BYTES = 900 * 1024; // the bucket allows 1 MB
const PICK_TYPES = ["image/jpeg", "image/png", "image/webp"];

// ---------------------------------------------------------------------------
// errors: the database raises them with a short machine-readable hint
// ---------------------------------------------------------------------------

/** Turns whatever came back into an Error with `.hint` (need_level, too_many_open, daily_limit, bad_title,
 * bad_items, bad_image, closed, own, under_review ...) and `.pending` (the migration is not applied yet). */
export function toCrowdError(err) {
  if (err?.crowd) return err;
  const out = new Error(err?.message ?? "Request failed");
  out.crowd = true;
  out.hint = rpcHint(err);
  out.pending = isMissingFunction(err);
  out.code = err?.code;
  return out;
}

async function rpc(name, args = {}) {
  const sb = requireSupabase();
  const { data, error } = await withTimeout(sb.rpc(name, args), 20000);
  if (error) throw toCrowdError(error);
  return data;
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

const clientError = (hint) => Object.assign(new Error(hint), { crowd: true, hint, pending: false });

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Shrinks a picked file to at most 1024 px on its long side and re-encodes it (WebP, else JPEG) under
 * 900 KB, so a phone photo uploads in a moment. Throws an error with hint bad_type / unreadable / too_big. */
export async function prepareImage(file) {
  if (!file || !PICK_TYPES.includes(file.type)) throw clientError("bad_type");
  if (file.size > 25 * 1024 * 1024) throw clientError("too_big");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try { bitmap = await createImageBitmap(file); } catch { throw clientError("unreadable"); }
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const [type, ext] of [["image/webp", "webp"], ["image/jpeg", "jpg"]]) {
    for (const quality of [0.86, 0.76, 0.64, 0.5]) {
      const blob = await canvasBlob(canvas, type, quality);
      // a browser that cannot encode the type hands back a PNG instead: skip to the next type
      if (!blob || blob.type !== type) break;
      if (blob.size <= MAX_BYTES) return { blob, ext, width, height };
    }
  }
  throw clientError("too_big");
}

/** The public URL of an uploaded option image. */
export function imageUrl(path) {
  if (!path) return null;
  return requireSupabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function uploadImage({ blob, ext }) {
  const sb = requireSupabase();
  const uid = getCurrentUser()?.id;
  if (!uid) throw clientError("signed_out");
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { cacheControl: "31536000", upsert: false, contentType: blob.type });
  if (error) throw toCrowdError(error);
  return path;
}

async function removeImages(paths) {
  const list = (paths ?? []).filter(Boolean);
  if (!list.length) return;
  try { await requireSupabase().storage.from(BUCKET).remove(list); } catch { /* the rows are what matters; a stray file is harmless */ }
}

// ---------------------------------------------------------------------------
// the owner's side
// ---------------------------------------------------------------------------

/** Checks the form the same way the database will, so the person hears about a problem before an upload. */
export function validateDraft({ title, dim, options }) {
  const t = (title ?? "").trim();
  if (t.length < MIN_TITLE || t.length > MAX_TITLE) return "bad_title";
  if (!TEST_DIMS.includes(dim)) return "bad_question";
  const filled = (options ?? []).filter((o) => (o.label ?? "").trim() || o.prepared);
  if (filled.length < MIN_OPTIONS || filled.length > MAX_OPTIONS) return "bad_items";
  if (filled.some((o) => (o.label ?? "").trim().length > MAX_LABEL)) return "bad_items";
  return null;
}

/** Uploads the images, then creates the test. options: [{ label, prepared: { blob, ext } | null }].
 * If the database refuses, the uploaded files are removed again. Resolves to the new test's id. */
export async function createTest({ title, dim, options }) {
  const problem = validateDraft({ title, dim, options });
  if (problem) throw clientError(problem);
  const filled = options.filter((o) => (o.label ?? "").trim() || o.prepared);
  const uploaded = [];
  try {
    const items = [];
    for (const o of filled) {
      const label = (o.label ?? "").trim();
      let path = null;
      if (o.prepared) { path = await uploadImage(o.prepared); uploaded.push(path); }
      items.push({ label: label || undefined, path: path ?? undefined });
    }
    const out = await rpc("arena_test_create", { p_title: title.trim(), p_dim: dim, p_items: items });
    invalidateMyTests();
    return out.id;
  } catch (err) {
    await removeImages(uploaded);
    throw toCrowdError(err);
  }
}

export async function fetchResults(id) {
  return rpc("arena_test_results", { p_test: id });
}

export async function setTestStatus(id, status) {
  const out = await rpc("arena_test_set_status", { p_test: id, p_status: status });
  invalidateMyTests();
  return out;
}

export async function deleteTest(id) {
  const out = await rpc("arena_test_delete", { p_test: id });
  await removeImages(out?.paths);
  invalidateMyTests();
}

// ---------------------------------------------------------------------------
// the verdict
// ---------------------------------------------------------------------------

/** Every option's win rate with a 95% Wilson interval, the ranking, and one of:
 *   empty       nobody has answered yet
 *   collecting  the leader has fewer than 30 duels behind it: too early to say
 *   winner      the leader's interval lies wholly above the runner-up's
 *   close       the top options cannot be told apart (yet)
 * Same honesty rule as the rest of the platform: below 30 observations, no verdict. */
export function testVerdict(test) {
  const items = (test.items ?? []).map((it) => {
    const games = it.games ?? 0;
    const wins = it.wins ?? 0;
    return { ...it, games, wins, rate: games ? wins / games : null, ci: games ? wilsonInterval(wins, games) : null };
  });
  const ranked = items.slice().sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.pos - b.pos);
  const lead = ranked[0] ?? null;
  const next = ranked[1] ?? null;
  let state = "empty";
  if ((test.votes ?? 0) > 0) {
    if (!lead || lead.games < MIN_RELIABLE_SAMPLE) state = "collecting";
    else if (next?.ci && lead.ci[0] > next.ci[1]) state = "winner";
    else state = "close";
  }
  return { items, ranked, lead, next, state, progress: test.target ? Math.min(1, (test.votes ?? 0) / test.target) : 0 };
}

// ---------------------------------------------------------------------------
// my tests: one reactive list, same module-level pattern as the other stores
// ---------------------------------------------------------------------------

let mine = { tests: [], loading: false, loaded: false, error: null, pending: false, forUser: undefined };
const mineListeners = new Set();
const notifyMine = () => { for (const l of mineListeners) l(); };

async function loadMyTests({ silent = false } = {}) {
  const uid = getCurrentUser()?.id ?? null;
  if (!uid) { mine = { tests: [], loading: false, loaded: true, error: null, pending: false, forUser: null }; notifyMine(); return; }
  if (!silent) { mine = { ...mine, loading: true }; notifyMine(); }
  try {
    const tests = await rpc("arena_test_mine");
    mine = { tests: tests ?? [], loading: false, loaded: true, error: null, pending: false, forUser: uid };
  } catch (err) {
    mine = silent
      ? { ...mine, loading: false }
      : { tests: [], loading: false, loaded: true, error: err, pending: !!err.pending, forUser: uid };
  }
  notifyMine();
}

export function invalidateMyTests() {
  loadMyTests({ silent: true });
}

/** { tests, loading, loaded, error, pending, reload } -- `pending`: migration 0022 has not been applied yet. */
export function useMyTests({ poll = false } = {}) {
  const [, setTick] = useState(0);
  const { user, loading: sessionLoading } = useSession();
  const uid = user?.id ?? null;
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    mineListeners.add(l);
    return () => mineListeners.delete(l);
  }, []);
  useEffect(() => {
    if (sessionLoading) return;
    if (!mine.loading && mine.forUser !== uid) loadMyTests();
  }, [sessionLoading, uid]);
  useEffect(() => {
    if (!poll || !uid) return undefined;
    const id = setInterval(() => { if (document.visibilityState === "visible") loadMyTests({ silent: true }); }, 30000);
    return () => clearInterval(id);
  }, [poll, uid]);
  return { tests: mine.tests, loading: mine.loading || !mine.loaded, loaded: mine.loaded, error: mine.error, pending: mine.pending, reload: () => loadMyTests() };
}

// ---------------------------------------------------------------------------
// the players' side
// ---------------------------------------------------------------------------

/** What a player can help with now: { available, missionXp, cap, tests: [{ id, title, dim, owner, items, pairs }] }. */
export async function fetchQueue(limit = 3) {
  return rpc("arena_test_queue", { p_limit: limit });
}

/** The queue as a hook for the Arena lobby: refetched when `reloadKey` changes. */
export function useMissionQueue(enabled, reloadKey = 0) {
  const { user } = useSession();
  const uid = user?.id ?? null;
  const [state, setState] = useState({ loading: true, available: 0, tests: [], missionXp: 0, cap: 300, error: null, pending: false });
  useEffect(() => {
    if (!enabled || !uid) return undefined;
    let off = false;
    setState((s) => ({ ...s, loading: true }));
    fetchQueue(3)
      .then((q) => { if (!off) setState({ loading: false, available: q?.available ?? 0, tests: q?.tests ?? [], missionXp: q?.missionXp ?? 0, cap: q?.cap ?? 300, error: null, pending: false }); })
      .catch((error) => { if (!off) setState({ loading: false, available: 0, tests: [], missionXp: 0, cap: 300, error, pending: !!error.pending }); });
    return () => { off = true; };
  }, [enabled, uid, reloadKey]);
  return state;
}

export async function reportTest(id, reason) {
  return rpc("arena_test_report", { p_test: id, p_reason: reason ?? null });
}

// ---------------------------------------------------------------------------
// moderation (admins)
// ---------------------------------------------------------------------------

export async function fetchFlagged() {
  return rpc("arena_test_flagged");
}

export async function moderateTest(id, action, note) {
  return rpc("arena_test_moderate", { p_test: id, p_action: action, p_note: note ?? null });
}
