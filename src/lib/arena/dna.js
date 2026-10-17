// Taste DNA: how consistently a player's picks lean along each of the seven
// trait axes, computed from the ledger and the specimens' own measured traits.
//
// For every answer the pick-minus-other difference on each trait is added to a
// signed sum and its size to an absolute sum. The lean on a trait is
// signed / (absolute + prior): +1 would mean "always the warmer / bolder / ...
// whenever the two differed", 0 means no preference, and the prior pulls a
// handful of votes towards 0 so one lucky pair doesn't make a personality.
import { TRAIT_IDS } from "./traits.js";
import { getStimulus } from "./stimuli.js";
import { decodeEntry } from "./ledger.js";

const PRIOR = 3;
export const MIN_VOTES_FOR_TYPE = 20;
export const FULL_CONFIDENCE_VOTES = 80;

export function emptyDna() {
  const z = () => Object.fromEntries(TRAIT_IDS.map((t) => [t, 0]));
  return { n: 0, s: z(), a: z() };
}

export function addToDna(dna, chosen, other) {
  dna.n++;
  for (const t of TRAIT_IDS) {
    const d = chosen[t] - other[t];
    dna.s[t] += d;
    dna.a[t] += Math.abs(d);
  }
}

/** { trait: lean in [-1, 1] } */
export function leanOf(dna) {
  const out = {};
  for (const t of TRAIT_IDS) out[t] = dna.s[t] / (dna.a[t] + PRIOR);
  return out;
}

export const confidenceOf = (dna) => Math.min(1, dna.n / FULL_CONFIDENCE_VOTES);

/** Builds { all, byDim } from { season: [codes] }. Heavy on first call (it generates specimens), cheap after. */
export function dnaFromLedger(ledgerBySeason) {
  const all = emptyDna();
  const byDim = {};
  for (const [season, codes] of Object.entries(ledgerBySeason)) {
    for (const code of codes) {
      const e = decodeEntry(code);
      if (!e.family) continue;
      const sa = getStimulus(season, e.family, e.a);
      const sb = getStimulus(season, e.family, e.b);
      const [chosen, other] = e.pick === 0 ? [sa, sb] : [sb, sa];
      addToDna(all, chosen.traits, other.traits);
      addToDna((byDim[e.dim] ??= emptyDna()), chosen.traits, other.traits);
    }
  }
  return { all, byDim };
}

/** Folds the answers given since `agg` was last extended: { done: { season: entries counted }, all, byDim }.
 * Starts from nothing when there is no `agg` or the ledger of a season is shorter than what was counted (it was
 * rebuilt), so the fold never double counts. Seasons that were pruned from the ledger stay counted. */
export function extendDna(agg, ledgerBySeason) {
  let cur = agg;
  if (cur) for (const [season, codes] of Object.entries(ledgerBySeason)) if ((cur.done[season] ?? 0) > codes.length) { cur = null; break; }
  cur ??= { done: {}, all: emptyDna(), byDim: {} };
  for (const [season, codes] of Object.entries(ledgerBySeason)) {
    for (let i = cur.done[season] ?? 0; i < codes.length; i++) {
      const e = decodeEntry(codes[i]);
      if (!e.family) continue;
      const sa = getStimulus(season, e.family, e.a);
      const sb = getStimulus(season, e.family, e.b);
      const [chosen, other] = e.pick === 0 ? [sa, sb] : [sb, sa];
      addToDna(cur.all, chosen.traits, other.traits);
      addToDna((cur.byDim[e.dim] ??= emptyDna()), chosen.traits, other.traits);
    }
    cur.done[season] = codes.length;
  }
  return cur;
}

/** "No lean / slight / clear / strong" from |lean|. */
export function leanStrength(v) {
  const m = Math.abs(v);
  if (m < 0.12) return "none";
  if (m < 0.3) return "slight";
  if (m < 0.55) return "clear";
  return "strong";
}

// Prototype vectors of the nine taste "types". A player is the type whose
// prototype is nearest to their lean (scaled up, since real leans rarely reach +-1).
export const ARCHETYPES = [
  { id: "minimalist", v: { warm: 0, bold: -0.4, round: 0.1, airy: 0.8, vivid: -0.6, rich: -0.8, dark: -0.2 } },
  { id: "expressionist", v: { warm: 0.4, bold: 0.8, round: 0.2, airy: -0.5, vivid: 0.8, rich: 0.5, dark: 0 } },
  { id: "craftsman", v: { warm: 0.8, bold: 0.1, round: 0.5, airy: 0, vivid: -0.3, rich: 0.5, dark: -0.1 } },
  { id: "technologist", v: { warm: -0.7, bold: 0.2, round: -0.6, airy: 0.2, vivid: 0.1, rich: -0.3, dark: 0.7 } },
  { id: "luxe", v: { warm: 0.2, bold: 0.3, round: -0.2, airy: 0.4, vivid: -0.6, rich: -0.1, dark: 0.9 } },
  { id: "optimist", v: { warm: 0.7, bold: 0.3, round: 0.7, airy: 0.1, vivid: 0.8, rich: 0.1, dark: -0.7 } },
  { id: "modernist", v: { warm: -0.2, bold: 0.7, round: -0.8, airy: 0.6, vivid: 0.2, rich: -0.6, dark: 0 } },
  { id: "dreamer", v: { warm: 0.2, bold: -0.6, round: 0.8, airy: 0.6, vivid: -0.3, rich: 0, dark: -0.4 } },
  { id: "maximalist", v: { warm: 0.3, bold: 0.6, round: 0.2, airy: -0.9, vivid: 0.6, rich: 0.9, dark: 0.1 } },
];

const LEAN_SCALE = 1.8;

/** The nearest archetype id for a lean vector, with how close it is (0..1). */
export function archetypeOf(lean) {
  let best = null, bestD = Infinity;
  for (const a of ARCHETYPES) {
    let s = 0;
    for (const t of TRAIT_IDS) s += (Math.max(-1, Math.min(1, lean[t] * LEAN_SCALE)) - a.v[t]) ** 2;
    const d = Math.sqrt(s);
    if (d < bestD) { bestD = d; best = a; }
  }
  return { id: best.id, fit: Math.max(0, Math.min(1, 1 - bestD / 3.2)) };
}

/** The traits a player leans on hardest: [{ trait, lean }] sorted by |lean|. */
export function topTraits(lean, count = 3) {
  return TRAIT_IDS.map((t) => ({ trait: t, lean: lean[t] })).sort((x, y) => Math.abs(y.lean) - Math.abs(x.lean)).slice(0, count);
}

/** The biggest difference between how a player judges one question and their overall lean:
 * { dim, trait, delta } or null. Needs enough votes in that question to mean anything. */
export function standoutDifference(dna, minVotes = 15) {
  const base = leanOf(dna.all);
  let best = null;
  for (const [dim, d] of Object.entries(dna.byDim)) {
    if (d.n < minVotes) continue;
    const l = leanOf(d);
    for (const t of TRAIT_IDS) {
      const delta = l[t] - base[t];
      if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { dim, trait: t, delta, lean: l[t] };
    }
  }
  return best && Math.abs(best.delta) >= 0.25 ? best : null;
}
