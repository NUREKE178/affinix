// Style insights: what the Arena crowd prefers, for marketers. The server counts how every specimen fared in its duels
// (wins / losses per question); the browser knows each specimen's measured traits (warm, bold, round, airy, vivid, rich,
// dark), because a specimen is a pure function of its key. Putting the two together answers "which STYLE wins when
// people are asked which one feels premium / friendly / natural ...".
//
// The method is deliberately plain and said so on the page: specimens are split into those that lean one way on a trait
// (<= -0.25 or >= +0.25) and the rest of the leaners the other way; the lift is the difference of their win rates, with an
// ordinary two-proportion z. It is a signal about Arena players, not a prediction about a target market.
import { withTimeout } from "./async.js";
import { TRAIT_IDS } from "./arena/traits.js";
import { parseStimulusKey, getStimulus, FAMILY_IDS } from "./arena/stimuli.js";
import { isMissingFunction } from "./rpcErrors.js";

export const LEAN = 0.25;          // |trait| beyond which a specimen "leans" that way
export const MIN_GROUP = 40;       // answers each side needs before a lift means anything
export const MAX_SPECIMENS = 900;  // the most specimens analysed at once (the best-answered ones)

async function rpc(name, args) {
  const { requireSupabase } = await import("./supabaseClient.js"); // loaded on use, so the maths below can run without a browser
  const { data, error } = await withTimeout(requireSupabase().rpc(name, args), 25000);
  if (error) throw error;
  return data;
}

/** Errors become { code }: "updatePending" (migration 0026 missing), "offline" or "generic". */
function failure(err) {
  const e = new Error(isMissingFunction(err) ? "updatePending" : (err?.message ?? "error"));
  e.code = isMissingFunction(err) ? "updatePending" : /fetch|network|timeout|abort/i.test(err?.message ?? "") ? "offline" : "generic";
  return e;
}

/** { season, votes, voters, rows: [{ stim, dim, wins, losses }] } */
export async function fetchStyleReport({ season, dim = null, family = null, min = 4 }) {
  try {
    const data = await rpc("arena_style_report", { p_season: season, p_dim: dim, p_family: family, p_min: min });
    return {
      season: data.season, votes: Number(data.votes ?? 0), voters: Number(data.voters ?? 0),
      rows: (data.rows ?? []).map(([stim, d, wins, losses]) => ({ stim, dim: d, wins: Number(wins), losses: Number(losses) })),
    };
  } catch (err) { throw failure(err); }
}

/** { countries: [{ code, voters, votes }], rows: [{ country, stim, wins, losses }] } -- countries with enough voters only. */
export async function fetchStyleSegments({ season, dim, family = null }) {
  try {
    const data = await rpc("arena_style_segments", { p_season: season, p_dim: dim, p_family: family, p_min_voters: 8 });
    return {
      countries: (data.countries ?? []).map((c) => ({ code: c.code, voters: Number(c.voters), votes: Number(c.votes) })),
      rows: (data.rows ?? []).map(([country, stim, wins, losses]) => ({ country, stim, wins: Number(wins), losses: Number(losses) })),
    };
  } catch (err) { throw failure(err); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Rows -> entries with the specimen's traits. Yields to the browser every few specimens (building one is not free);
 * `onProgress(done, total)` lets the page say it is working. Several dims of one specimen share one build. */
export async function withTraits(rows, season, { onProgress, shouldStop } = {}) {
  const best = new Map();
  for (const r of rows) best.set(r.stim, (best.get(r.stim) ?? 0) + r.wins + r.losses);
  const keep = new Set([...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SPECIMENS).map(([k]) => k));
  const out = [];
  let built = 0;
  const seenKeys = new Set();
  for (const r of rows) {
    if (!keep.has(r.stim)) continue;
    if (!seenKeys.has(r.stim)) {
      seenKeys.add(r.stim);
      if (++built % 24 === 0) { onProgress?.(built, keep.size); await tick(); if (shouldStop?.()) return null; }
    }
    const { family, index } = parseStimulusKey(r.stim);
    if (!FAMILY_IDS.includes(family)) continue;
    out.push({ ...r, family, index, traits: getStimulus(season, family, index).traits });
  }
  onProgress?.(keep.size, keep.size);
  return out;
}

const rate = (w, l) => (w + l > 0 ? w / (w + l) : 0.5);

/** Per trait: how much more often the specimens that lean to one pole win. Positive = the "hi" pole wins.
 * { trait, lift (-1..1), hiRate, loRate, nHi, nLo, z, level: "strong" | "clear" | "hint" | "none" } */
export function traitLifts(entries) {
  return TRAIT_IDS.map((trait) => {
    let hw = 0, hl = 0, lw = 0, ll = 0;
    for (const e of entries) {
      const v = e.traits[trait];
      if (v >= LEAN) { hw += e.wins; hl += e.losses; }
      else if (v <= -LEAN) { lw += e.wins; ll += e.losses; }
    }
    const nHi = hw + hl, nLo = lw + ll;
    const hiRate = rate(hw, hl), loRate = rate(lw, ll);
    const lift = hiRate - loRate;
    const se = Math.sqrt((hiRate * (1 - hiRate)) / Math.max(nHi, 1) + (loRate * (1 - loRate)) / Math.max(nLo, 1));
    const z = nHi >= MIN_GROUP && nLo >= MIN_GROUP && se > 0 ? lift / se : 0;
    const level = Math.abs(z) >= 2.58 ? "strong" : Math.abs(z) >= 1.96 ? "clear" : Math.abs(z) >= 1.28 ? "hint" : "none";
    return { trait, lift, hiRate, loRate, nHi, nLo, z, level };
  });
}

/** The lifts that are at least "clear", strongest first: the recipe of a winning style. */
export function recipeOf(lifts, count = 3) {
  return lifts
    .filter((l) => l.level === "strong" || l.level === "clear")
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, count);
}

/** Lower bound of the 80% Wilson interval of a win rate: ranks a specimen by what it can be trusted to be worth. */
export function wilsonLow(w, n, z = 1.28) {
  if (n <= 0) return 0;
  const p = w / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

/** Specimens merged over questions when several are loaded (one question = one row per specimen), ranked.
 * Returns { best: [...], worst: [...] } of { stim, family, index, wins, losses, n, rate, traits }. */
export function rankSpecimens(entries, { top = 6, bottom = 3, minAnswers = 6 } = {}) {
  const merged = new Map();
  for (const e of entries) {
    const m = merged.get(e.stim) ?? { stim: e.stim, family: e.family, index: e.index, traits: e.traits, wins: 0, losses: 0 };
    m.wins += e.wins; m.losses += e.losses;
    merged.set(e.stim, m);
  }
  const list = [...merged.values()].filter((m) => m.wins + m.losses >= minAnswers).map((m) => ({ ...m, n: m.wins + m.losses, rate: rate(m.wins, m.losses) }));
  const byLow = [...list].sort((a, b) => wilsonLow(b.wins, b.n) - wilsonLow(a.wins, a.n) || b.n - a.n);
  const worst = [...list].sort((a, b) => wilsonLow(a.losses, a.n) - wilsonLow(b.losses, b.n) || b.n - a.n).filter((m) => m.rate < 0.5).slice(0, bottom);
  return { best: byLow.filter((m) => m.rate > 0.5).slice(0, top), worst };
}

/** Lifts per country vs everyone: { code, lifts, delta: { trait: lift - overall lift } }, strongest differences first. */
export function segmentLifts(entriesByCountry, overall) {
  const base = Object.fromEntries(overall.map((l) => [l.trait, l.lift]));
  return Object.entries(entriesByCountry).map(([code, entries]) => {
    const lifts = traitLifts(entries);
    return { code, lifts, delta: Object.fromEntries(lifts.map((l) => [l.trait, l.lift - base[l.trait]])) };
  });
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** A CSV a marketer can open in a spreadsheet: the trait lifts first, then the ranked specimens. */
export function toCsv({ season, dim, family, country, lifts, ranked, votes, voters }) {
  const rows = [
    ["season", season], ["question", dim ?? "all"], ["family", family ?? "all"], ["audience", country ?? "all"], ["answers_in_season", votes], ["voters_in_season", voters], [],
    ["trait", "lift_hi_vs_lo_pct", "hi_win_rate_pct", "lo_win_rate_pct", "answers_hi", "answers_lo", "z", "confidence"],
    ...lifts.map((l) => [l.trait, (l.lift * 100).toFixed(1), (l.hiRate * 100).toFixed(1), (l.loRate * 100).toFixed(1), l.nHi, l.nLo, l.z.toFixed(2), l.level]),
    [],
    ["specimen", "wins", "losses", "win_rate_pct", ...TRAIT_IDS],
    ...[...ranked.best, ...ranked.worst].map((m) => [m.stim, m.wins, m.losses, (m.rate * 100).toFixed(1), ...TRAIT_IDS.map((t) => m.traits[t])]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
