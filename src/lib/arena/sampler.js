// Deals duels. A duel is (family, two specimens, one question); a round is ten
// of them. Free-play rounds are shuffled to be fresh for the player (unseen
// duels, varied families and questions, specimens that are not on screen back to
// back, pairs different enough to be a real choice). The DAILY set is the same ten
// duels for everybody on a given day, so the community's answers pile up on the
// same pairs and can actually be compared.
import { mulberry32, hashStringToSeed, shuffle } from "../prng.js";
import { FAMILY_IDS, POOL_SIZE, DIMENSIONS, familyDims, getStimulus, isObjective, legibilityWinner } from "./stimuli.js";
import { duelCode, pairKey } from "./ledger.js";
import { traitDistance } from "./traits.js";
import { ROUND_SIZE, DAILY_SET_SIZE } from "./rules.js";

const pickWeighted = (rand, items, weight) => {
  let total = 0;
  const ws = items.map((it) => { const w = Math.max(0.0001, weight(it)); total += w; return w; });
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
};

// A pair is "eye-testable" when one specimen's text clearly wins on contrast and
// is not meaningfully smaller. Cached per pool: 496 pairs, answered once.
const truthCache = new Map();
function truthMatrix(season, family) {
  const key = `${season}/${family}`;
  let m = truthCache.get(key);
  if (m) return m;
  m = new Map();
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => getStimulus(season, family, i));
  for (let a = 0; a < POOL_SIZE; a++) for (let b = a + 1; b < POOL_SIZE; b++) {
    const w = legibilityWinner(pool[a], pool[b]);
    if (w !== null) m.set(a * POOL_SIZE + b, w);
  }
  truthCache.set(key, m);
  return m;
}

/** How many eye-test pairs a pool offers (used to decide whether a family can ask a "clarity" question). */
export function eyePairCount(season, family) {
  return truthMatrix(season, family).size;
}

function dimsFor(season, family) {
  return familyDims(family).filter((d) => !isObjective(d) || eyePairCount(season, family) >= 20);
}

/** The best of a few random candidate pairs. `seen` holds duel codes already answered. */
function pickPair(rand, { season, family, dim, seen, avoid }) {
  const objective = isObjective(dim);
  const truth = objective ? truthMatrix(season, family) : null;
  const found = [];
  let relaxed = false;
  for (let attempt = 0; attempt < 90 && found.length < 10; attempt++) {
    let a = Math.floor(rand() * POOL_SIZE);
    let b = Math.floor(rand() * (POOL_SIZE - 1));
    if (b >= a) b++;
    if (a > b) [a, b] = [b, a];
    if (truth && !truth.has(a * POOL_SIZE + b)) continue;
    if (seen && seen.has(duelCode(family, a, b, dim))) continue;
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
    const sa = getStimulus(season, family, a), sb = getStimulus(season, family, b);
    const dist = traitDistance(sa.traits, sb.traits);
    // A real choice: different enough to decide, not so different it is a caricature.
    let score = -Math.abs(dist - 1.7) + rand() * 0.6;
    if (avoid?.has(`${family}:${a}`)) score -= 1.2;
    if (avoid?.has(`${family}:${b}`)) score -= 1.2;
    if (score > bestScore) { bestScore = score; best = [a, b]; }
  }
  return { a: best[0], b: best[1], repeat: relaxed };
}

function buildDuel(rand, { season, family, dim, a, b, repeat = false, daily = false }) {
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
  };
  if (duel.objective) duel.truth = truthMatrix(season, family).get(a * POOL_SIZE + b);
  return duel;
}

/**
 * One free-play round.
 * @param rand       seeded PRNG
 * @param seen       Set of duel codes the player has already answered this season
 * @param recent     the last few duels dealt ({ family, a, b, dim }), oldest first
 * @param focus      { eye: bool, unseenFamilies: string[], unseenDims: string[] } -- what today's quests ask for
 */
export function planRound({ season, rand, size = ROUND_SIZE, seen, recent = [], focus = {} }) {
  const duels = [];
  const history = recent.slice(-8);
  const taken = new Set(seen ?? []);
  for (let k = 0; k < size; k++) {
    const last = (duels[k - 1] ?? history[history.length - 1]) || null;
    const last2 = (duels[k - 2] ?? history[history.length - 2]) || null;
    const family = pickWeighted(rand, FAMILY_IDS, (f) => {
      let w = 1;
      if (last?.family === f) w *= 0.3;
      if (last2?.family === f) w *= 0.65;
      if (focus.unseenFamilies?.includes(f)) w *= 1.8;
      if (dimsFor(season, f).length === 0) w = 0;
      return w;
    });
    const dims = dimsFor(season, family);
    const dim = pickWeighted(rand, dims, (d) => {
      let w = 1;
      if (last?.dim === d) w *= 0.35;
      if (isObjective(d)) w *= focus.eye ? 2.6 : 0.85;
      if (focus.unseenDims?.includes(d)) w *= 1.7;
      return w;
    });
    const avoid = new Set([...history, ...duels].slice(-8).flatMap((d) => [`${d.family}:${d.a}`, `${d.family}:${d.b}`]));
    const pair = pickPair(rand, { season, family, dim, seen: taken, avoid });
    if (!pair.repeat) taken.add(duelCode(family, pair.a, pair.b, dim)); // never deal the same duel twice in one go
    duels.push(buildDuel(rand, { season, family, dim, ...pair }));
  }
  return duels;
}

/** The shared daily challenge for a day: the same duels for every player. Two of the ten are eye tests. */
export function planDaily(day, season, size = DAILY_SET_SIZE) {
  const rand = mulberry32(hashStringToSeed(`daily/${day}/${season}`));
  const families = shuffle(rand, FAMILY_IDS);
  const eyeFamilies = families.filter((f) => dimsFor(season, f).some(isObjective)).slice(0, 2);
  const eyeSlots = new Map([[3, eyeFamilies[0]], [8, eyeFamilies[1]]]);
  // the other eight slots: every family once, then the eye families and the first of the rest again -- nobody appears three times
  const others = families.filter((f) => !eyeFamilies.includes(f));
  const cycle = [...others, ...eyeFamilies, others[0]];
  const duels = [];
  let cursor = 0;
  for (let k = 0; k < size; k++) {
    const eyeFamily = eyeSlots.get(k);
    const family = eyeFamily ?? cycle[cursor++ % cycle.length];
    const dims = dimsFor(season, family);
    const pool = eyeFamily ? dims.filter(isObjective) : dims.filter((d) => !isObjective(d));
    const dim = pool[Math.floor(rand() * pool.length)] ?? dims[0];
    const pair = pickPair(rand, { season, family, dim, seen: null, avoid: null });
    duels.push(buildDuel(rand, { season, family, dim, a: pair.a, b: pair.b, daily: true }));
  }
  return duels;
}

export { DIMENSIONS };
