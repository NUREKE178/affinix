// The ledger: every duel the player has answered, packed into one small integer
// each so a season of play (tens of thousands of answers) still fits comfortably in
// localStorage. It answers two questions: "have I seen this duel?" (to deal fresh
// ones) and "what do my picks say about my taste?" (the Taste DNA).
import { FAMILY_IDS, DIMENSION_IDS, POOL_SIZE } from "./catalog.js";

/** Duel identity without the answer: (family, lower index, higher index, question). */
export function duelCode(family, a, b, dim) {
  const f = FAMILY_IDS.indexOf(family);
  const d = DIMENSION_IDS.indexOf(dim);
  return ((f * POOL_SIZE + a) * POOL_SIZE + b) * 8 + d;
}

/** A ledger entry: the duel code plus which side was picked (0 = lower index, 1 = higher). */
export function encodeEntry(family, a, b, dim, pick) {
  return duelCode(family, a, b, dim) * 2 + (pick ? 1 : 0);
}

export function decodeEntry(code) {
  const pick = code & 1;
  let c = code >> 1;
  const d = c % 8; c = (c - d) / 8;
  const b = c % POOL_SIZE; c = (c - b) / POOL_SIZE;
  const a = c % POOL_SIZE; c = (c - a) / POOL_SIZE;
  return { family: FAMILY_IDS[c], a, b, dim: DIMENSION_IDS[d], pick };
}

/** "202610/mark/3-17" -> parts, or null for anything else. */
export function parsePair(pair) {
  const m = /^(\d{6})\/([a-z]{2,12})\/(\d{1,2})-(\d{1,2})$/.exec(pair ?? "");
  if (!m) return null;
  const [, season, family, a, b] = m;
  if (!FAMILY_IDS.includes(family) || Number(a) >= Number(b) || Number(b) >= POOL_SIZE) return null;
  return { season, family, a: Number(a), b: Number(b) };
}

export const pairKey = (season, family, a, b) => `${season}/${family}/${a}-${b}`;

/** A server row [pair, dim, pick] -> a ledger entry (null if it is not a valid duel). */
export function entryFromRow(row) {
  const p = parsePair(row[0]);
  if (!p || !DIMENSION_IDS.includes(row[1])) return null;
  return { season: p.season, code: encodeEntry(p.family, p.a, p.b, row[1], row[2]) };
}

/** The set of duel codes (answer stripped) in a list of ledger entries. */
export function seenSet(entries) {
  const set = new Set();
  for (const code of entries) set.add(code >> 1);
  return set;
}
