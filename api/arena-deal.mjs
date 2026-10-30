// Deals Arena duels for the native apps, with the very code the website uses (src/lib/arena/sampler.js), so a duel means the same thing everywhere and the
// community's answers pile up on the same pairs:
//   GET  /api/arena-deal?kind=daily&day=2026-10-30&season=202610            the shared daily challenge (10 duels, the same for everybody)
//   GET  /api/arena-deal?kind=set&n=3&day=...&season=...                    an extra set of the day (2..6)
//   POST /api/arena-deal  { kind: "free", day, season, seed, seen: [[pair, dim], ...], recent: [...] }   a free-play round dealt around what the player has answered
// Every duel carries what the screen needs to show and reveal it: both specimens' names, and for an eye test the contrast of each.
import { mulberry32, hashStringToSeed } from "../src/lib/prng.js";
import { planDaily, planSet, planRound, SET_CANDIDATES } from "../src/lib/arena/sampler.js";
import { getStimulus, FAMILY_IDS, DIMENSION_IDS } from "../src/lib/arena/stimuli.js";
import { ROUND_SIZE, DAILY_SET_SIZE } from "../src/lib/arena/rules.js";
import { parsePair, duelCode } from "../src/lib/arena/ledger.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEASON = /^\d{6}$/;

function describe(duel) {
  const sa = getStimulus(duel.season, duel.family, duel.a);
  const sb = getStimulus(duel.season, duel.family, duel.b);
  const side = (s) => ({ name: s.name, ...(s.legibility ? { contrast: Math.round(s.legibility.contrast * 10) / 10, size: Math.round(s.legibility.size * 100) / 100 } : {}) });
  return { ...duel, specimens: [side(sa), side(sb)] };
}

/** [[pair, dim], ...] from the player's answers -> the Set of duel codes the sampler wants. */
function seenCodes(rows) {
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows.slice(0, 20000) : []) {
    const p = parsePair(row?.[0]);
    if (p && DIMENSION_IDS.includes(row[1])) set.add(duelCode(p.family, p.a, p.b, row[1]));
  }
  return set;
}

export function deal(input) {
  const kind = String(input.kind ?? "daily");
  const day = String(input.day ?? "");
  const season = String(input.season ?? "");
  if (!DAY.test(day) || !SEASON.test(season)) throw Object.assign(new Error("bad day or season"), { status: 400 });
  const drops = input.drops !== false && input.drops !== "false";
  if (kind === "daily") return planDaily(day, season, DAILY_SET_SIZE, { drops }).map(describe);
  if (kind === "set") {
    const n = Number(input.n);
    if (!Number.isInteger(n) || n < 2 || n > 6) throw Object.assign(new Error("bad set"), { status: 400 });
    return planSet(day, season, n, SET_CANDIDATES, { drops }).map(describe);
  }
  if (kind === "free") {
    const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) >>> 0 : hashStringToSeed(`${day}/${Math.random()}`);
    const recent = (Array.isArray(input.recent) ? input.recent : []).filter((r) => FAMILY_IDS.includes(r?.family)).slice(-8)
      .map((r) => ({ family: r.family, a: Number(r.a), b: Number(r.b), dim: String(r.dim) }));
    const focus = { eye: !!input.focus?.eye, unseenFamilies: (input.focus?.unseenFamilies ?? []).filter((f) => FAMILY_IDS.includes(f)), unseenDims: (input.focus?.unseenDims ?? []).filter((d) => DIMENSION_IDS.includes(d)) };
    return planRound({ season, rand: mulberry32(seed), size: ROUND_SIZE, seen: seenCodes(input.seen), recent, focus, day, drops, exposure: new Map() }).map(describe);
  }
  throw Object.assign(new Error("bad kind"), { status: 400 });
}

export default async function handler(req, res) {
  try {
    let input = { ...(req.query ?? Object.fromEntries(new URL(req.url, "http://x").searchParams)) };
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      input = { ...input, ...(body ?? {}) };
    }
    const duels = deal(input);
    res.setHeader("Cache-Control", input.kind === "free" || req.method === "POST" ? "no-store" : "public, max-age=300, s-maxage=3600");
    res.status(200).json({ duels });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : "deal failed" });
  }
}
