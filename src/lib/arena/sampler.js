// Deals duels. A duel is (family, two specimens, one question); a round is ten
// of them. Free-play rounds are shuffled to be fresh for the player (unseen
// duels, varied families and questions, specimens that are not on screen back to
// back, pairs different enough to be a real choice). The DAILY set is the same ten
// duels for everybody on a given day, so the community's answers pile up on the
// same pairs and can actually be compared.
//
// Specimens live in POOLS of 32 (see catalog.js): pool 0 = the month's classics, pool N = the DROP of the N-th day of
// the month, brand new every day. A duel always pairs two specimens of the same pool. The daily challenge and its extra
// sets are dealt from today's drop; free play mixes today's drop, yesterday's and the classics. When the server cannot
// take drop indexes yet (`drops: false`, migration 0026 not applied) everything is dealt from the classics, as before.
import { mulberry32, hashStringToSeed, shuffle } from "../prng.js";
import { FAMILY_IDS, POOL_SIZE, DIMENSIONS, familyDims, getStimulus, isObjective, legibilityWinner } from "./stimuli.js";
import { CLASSIC_POOL, LEGACY_FAMILY_COUNT, CORE_DIMENSION_IDS, dropPoolForDay, indexOf } from "./catalog.js";
import { duelCode, pairKey } from "./ledger.js";
import { traitDistance } from "./traits.js";
import { ROUND_SIZE, DAILY_SET_SIZE, SET_SIZE, themeIndex } from "./rules.js";

const pickWeighted = (rand, items, weight) => {
  let total = 0;
  const ws = items.map((it) => { const w = Math.max(0.0001, weight(it)); total += w; return w; });
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
};

// A pair is "eye-testable" when one specimen's text clearly wins on contrast and
// is not meaningfully smaller. Cached per pool: 496 pairs, answered once. Keys are slots inside the pool (0..31).
const truthCache = new Map();
function truthMatrix(season, family, pool = CLASSIC_POOL) {
  const key = `${season}/${family}/${pool}`;
  let m = truthCache.get(key);
  if (m) return m;
  m = new Map();
  const specimens = Array.from({ length: POOL_SIZE }, (_, i) => getStimulus(season, family, indexOf(pool, i)));
  for (let a = 0; a < POOL_SIZE; a++) for (let b = a + 1; b < POOL_SIZE; b++) {
    const w = legibilityWinner(specimens[a], specimens[b]);
    if (w !== null) m.set(a * POOL_SIZE + b, w);
  }
  truthCache.set(key, m);
  if (truthCache.size > 120) truthCache.delete(truthCache.keys().next().value);
  return m;
}

/** How many eye-test pairs a pool offers (used to decide whether a family can ask a "clarity" question). */
export function eyePairCount(season, family, pool = CLASSIC_POOL) {
  return truthMatrix(season, family, pool).size;
}

/** The questions a family can ask of a pool. `legacy` (a server that does not know the newer questions yet) keeps to the original seven. */
function dimsFor(season, family, pool = CLASSIC_POOL, legacy = false) {
  return familyDims(family)
    .filter((d) => !legacy || CORE_DIMENSION_IDS.includes(d))
    .filter((d) => !isObjective(d) || eyePairCount(season, family, pool) >= 20);
}
const familiesFor = (legacy) => (legacy ? FAMILY_IDS.slice(0, LEGACY_FAMILY_COUNT) : FAMILY_IDS);

/** The best of a few random candidate pairs of one pool. `seen` holds duel codes already answered. Returns absolute indexes. */
function pickPair(rand, { season, family, dim, seen, avoid, pool = CLASSIC_POOL, exposure = null }) {
  const base = indexOf(pool, 0);
  const objective = isObjective(dim);
  const truth = objective ? truthMatrix(season, family, pool) : null;
  const found = [];
  let relaxed = false;
  for (let attempt = 0; attempt < 160 && found.length < 24; attempt++) {
    let a = Math.floor(rand() * POOL_SIZE);
    let b = Math.floor(rand() * (POOL_SIZE - 1));
    if (b >= a) b++;
    if (a > b) [a, b] = [b, a];
    if (truth && !truth.has(a * POOL_SIZE + b)) continue;
    if (seen && seen.has(duelCode(family, base + a, base + b, dim))) continue;
    found.push([a, b]);
  }
  if (!found.length) {
    // Everything of this kind has been answered: deal a repeat (it earns nothing, and says so).
    relaxed = true;
    for (let attempt = 0; attempt < 60 && found.length < 6; attempt++) {
      let a = Math.floor(rand() * POOL_SIZE);
      let b = Math.floor(rand() * (POOL_SIZE - 1));
      if (b >= a) b++;
      if (a > b) [a, b] = [b, a];
      if (truth && !truth.has(a * POOL_SIZE + b)) continue;
      found.push([a, b]);
    }
    if (!found.length) found.push([0, 1]);
  }
  let best = null, bestScore = -Infinity;
  for (const [a, b] of found) {
    const sa = getStimulus(season, family, base + a), sb = getStimulus(season, family, base + b);
    const dist = traitDistance(sa.traits, sb.traits);
    // A real choice: different enough to decide, not so different it is a caricature.
    // (the distance preference alone kept choosing the same "ideal" specimens: a specimen this player has already met many times is
    // penalised, and a wider random term lets fresh ones win)
    let score = -Math.abs(dist - 1.7) * 0.7 + rand() * 1.1;
    if (avoid?.has(`${family}:${base + a}`)) score -= 1.2;
    if (avoid?.has(`${family}:${base + b}`)) score -= 1.2;
    if (exposure) score -= 0.55 * (Math.min(exposure.get(`${family}:${base + a}`) ?? 0, 5) + Math.min(exposure.get(`${family}:${base + b}`) ?? 0, 5));
    if (score > bestScore) { bestScore = score; best = [a, b]; }
  }
  return { a: base + best[0], b: base + best[1], repeat: relaxed };
}

function buildDuel(rand, { season, family, dim, a, b, repeat = false, daily = false, set = 0, pool = CLASSIC_POOL }) {
  const duel = {
    id: `${family}-${a}-${b}-${dim}`,
    season,
    family,
    dim,
    a,
    b,
    pair: pairKey(season, family, a, b),
    swap: rand() < 0.5, // which side the lower index is shown on
    objective: isObjective(dim),
    repeat,
    daily,
    set,
    pool,
  };
  if (duel.objective) {
    const base = indexOf(pool, 0);
    duel.truth = truthMatrix(season, family, pool).get((a - base) * POOL_SIZE + (b - base));
  }
  return duel;
}

/**
 * One free-play round.
 * @param rand       seeded PRNG
 * @param seen       Set of duel codes the player has already answered this season
 * @param recent     the last few duels dealt ({ family, a, b, dim }), oldest first
 * @param focus      { eye: bool, unseenFamilies: string[], unseenDims: string[] } -- what today's quests ask for
 * @param day        the player's local day "YYYY-MM-DD" (picks today's and yesterday's drop); omitted = classics only
 * @param drops      false when the server cannot take drop indexes yet: deal from the classics
 */
export function planRound({ season, rand, size = ROUND_SIZE, seen, recent = [], focus = {}, day = null, drops = true, exposure = null }) {
  const duels = [];
  // the pools this round may draw from, and how often: today's drop most, the classics and yesterday's drop sometimes
  const legacy = !drops;
  const today = day && drops ? dropPoolForDay(day) : null;
  // a server that cannot take drops still accepts indexes below 64: the second pool doubles what free play can show
  const pools = today === null ? (legacy ? [[CLASSIC_POOL, 1], [1, 1]] : [[CLASSIC_POOL, 1]]) : [[today, 0.7], [CLASSIC_POOL, 0.18], ...(today > 1 ? [[today - 1, 0.12]] : [])];
  const history = recent.slice(-8);
  const taken = new Set(seen ?? []);
  for (let k = 0; k < size; k++) {
    const last = (duels[k - 1] ?? history[history.length - 1]) || null;
    const last2 = (duels[k - 2] ?? history[history.length - 2]) || null;
    const pool = pickWeighted(rand, pools, (p) => p[1])[0];
    const family = pickWeighted(rand, familiesFor(legacy), (f) => {
      let w = 1;
      if (last?.family === f) w *= 0.3;
      if (last2?.family === f) w *= 0.65;
      if (focus.unseenFamilies?.includes(f)) w *= 1.8;
      if (dimsFor(season, f, pool, legacy).length === 0) w = 0;
      return w;
    });
    const dims = dimsFor(season, family, pool, legacy);
    const dim = pickWeighted(rand, dims, (d) => {
      let w = 1;
      if (last?.dim === d) w *= 0.35;
      if (isObjective(d)) w *= focus.eye ? 2.6 : 0.85;
      if (focus.unseenDims?.includes(d)) w *= 1.7;
      return w;
    });
    const avoid = new Set([...history, ...duels].slice(-8).flatMap((d) => [`${d.family}:${d.a}`, `${d.family}:${d.b}`]));
    const pair = pickPair(rand, { season, family, dim, seen: taken, avoid, pool, exposure });
    if (!pair.repeat) taken.add(duelCode(family, pair.a, pair.b, dim)); // never deal the same duel twice in one go
    if (exposure) for (const i of [pair.a, pair.b]) exposure.set(`${family}:${i}`, (exposure.get(`${family}:${i}`) ?? 0) + 1); // and within this round too
    duels.push(buildDuel(rand, { season, family, dim, pool, ...pair }));
  }
  return duels;
}

/** The shared daily challenge for a day: the same duels for every player. Two of the ten are eye tests. */
export function planDaily(day, season, size = DAILY_SET_SIZE, { drops = true } = {}) {
  const legacy = !drops;
  const pool = legacy ? CLASSIC_POOL : dropPoolForDay(day);
  // the seed of the original (classics-only) plan is kept as it was, so a server without drops still deals what it always did
  const rand = mulberry32(hashStringToSeed(legacy ? `daily/${day}/${season}` : `daily2/${day}/${season}`));
  const families = shuffle(rand, familiesFor(legacy));
  const eyeFamilies = families.filter((f) => dimsFor(season, f, pool, legacy).some(isObjective)).slice(0, 2);
  const eyeSlots = new Map([[3, eyeFamilies[0]], [8, eyeFamilies[1]]]);
  // the other eight slots: every family once, then the eye families and the first of the rest again -- nobody appears three times
  const others = families.filter((f) => !eyeFamilies.includes(f));
  const cycle = [...others, ...eyeFamilies, others[0]];
  const duels = [];
  let cursor = 0;
  for (let k = 0; k < size; k++) {
    const eyeFamily = eyeSlots.get(k);
    const family = eyeFamily ?? cycle[cursor++ % cycle.length];
    const dims = dimsFor(season, family, pool, legacy);
    const candidates = eyeFamily ? dims.filter(isObjective) : dims.filter((d) => !isObjective(d));
    const dim = candidates[Math.floor(rand() * candidates.length)] ?? dims[0];
    const pair = pickPair(rand, { season, family, dim, seen: null, avoid: null, pool });
    duels.push(buildDuel(rand, { season, family, dim, a: pair.a, b: pair.b, daily: true, pool }));
  }
  return duels;
}

/** The design family that is the theme of the week `day` falls in. */
export function themeFamilyFor(day, { drops = true } = {}) {
  const list = familiesFor(!drops);
  return list[themeIndex(day, list.length)];
}

/** How many candidates an extra set is dealt: a few more than it needs, so a player who has already met one of its
 * duels (in an earlier season-day) still gets a full set of ten, and almost everyone sees the same ten. */
export const SET_CANDIDATES = SET_SIZE + 4;

/** Extra set `n` (2..6) of a day: the same duels for every player, mostly of the theme family of the week.
 * Slots 2, 5 and 8 are other families, slot 6 is an eye test when the family offers one. */
export function planSet(day, season, n, size = SET_CANDIDATES, { drops = true } = {}) {
  const legacy = !drops;
  const pool = legacy ? CLASSIC_POOL : dropPoolForDay(day);
  const rand = mulberry32(hashStringToSeed(legacy ? `set/${day}/${season}/${n}` : `set2/${day}/${season}/${n}`));
  const theme = themeFamilyFor(day, { drops });
  const others = shuffle(rand, familiesFor(legacy).filter((f) => f !== theme && dimsFor(season, f, pool, legacy).length > 0));
  const taken = new Set();
  const duels = [];
  let cursor = 0;
  for (let k = 0; k < size; k++) {
    const guest = k % 3 === 2;
    const family = guest ? others[cursor++ % others.length] : theme;
    const dims = dimsFor(season, family, pool, legacy);
    const wantEye = k === 5 && dims.some(isObjective);
    const candidates = wantEye ? dims.filter(isObjective) : dims.filter((d) => !isObjective(d));
    const dim = candidates[Math.floor(rand() * candidates.length)] ?? dims[0];
    const avoid = new Set(duels.slice(-6).flatMap((d) => [`${d.family}:${d.a}`, `${d.family}:${d.b}`]));
    const pair = pickPair(rand, { season, family, dim, seen: taken, avoid, pool });
    taken.add(duelCode(family, pair.a, pair.b, dim));
    duels.push(buildDuel(rand, { season, family, dim, a: pair.a, b: pair.b, set: n, pool }));
  }
  return duels;
}

export { DIMENSIONS };
