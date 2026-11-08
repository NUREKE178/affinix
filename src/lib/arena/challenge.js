// Taste Match: a person sends the answers they gave to a handful of duels as a link; a friend plays the same pairs and
// sees how many they picked the same way. Nothing is modelled and nothing is stored on a server: the link carries the
// season, the pairs with their answers, and the sender's first name. This file is pure (no browser), so it is testable.
//
// Link format (all URL-safe):  1.<season>.<entry>-<entry>-...-<entry>.<name>
//   entry = a ledger entry (ledger.js: family, the two specimens, the question, the answer) in base 36
//   name  = the sender's first name, UTF-8, base64url (may be empty)
import { FAMILY_IDS, DIMENSION_IDS, INDEX_LIMIT, isObjective } from "./catalog.js";
import { encodeEntry, decodeEntry, duelCode } from "./ledger.js";

export const CHALLENGE_MIN = 5;
export const CHALLENGE_MAX = 10;
export const NAME_MAX = 24;
const VERSION = "1";
const MAX_ENTRY = 2 ** 29; // ledger entries are below this (ledger.js)

/** The first name only (a link goes to people the sender chose, but a surname is not needed), cleaned of anything that
 * could pretend to be something else on screen: control and invisible characters, direction overrides. */
export function cleanName(raw) {
  const first = String(raw ?? "").normalize("NFC").replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim().split(" ")[0] ?? "";
  return Array.from(first).slice(0, NAME_MAX).join("");
}

const toB64 = (str) => {
  let bin = "";
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function fromB64(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** A taste answer that can travel: a known family and question, two different specimens of the same pool, an answer, and
 * not an eye test (those have a right answer, so matching on them would measure eyesight, not taste). */
export function isShareable(a) {
  return !!a && FAMILY_IDS.includes(a.family) && DIMENSION_IDS.includes(a.dim) && !isObjective(a.dim)
    && Number.isInteger(a.a) && Number.isInteger(a.b) && a.a >= 0 && a.a < a.b && a.b < INDEX_LIMIT && (a.pick === 0 || a.pick === 1);
}

/** The text of a link's `c` parameter, or null when the answers cannot be shared. */
export function encodeChallenge({ season, answers, name }) {
  if (!/^\d{6}$/.test(season ?? "") || !Array.isArray(answers)) return null;
  if (answers.length < CHALLENGE_MIN || answers.length > CHALLENGE_MAX || !answers.every(isShareable)) return null;
  if (new Set(answers.map((a) => duelCode(a.family, a.a, a.b, a.dim))).size !== answers.length) return null;
  const entries = answers.map((a) => encodeEntry(a.family, a.a, a.b, a.dim, a.pick).toString(36)).join("-");
  const who = cleanName(name);
  return `${VERSION}.${season}.${entries}.${who ? toB64(who) : ""}`;
}

/** { season, answers, name } from a link's `c` parameter, or null for anything that is not exactly what encodeChallenge
 * writes: this text comes from the address bar, so it is never trusted. */
export function decodeChallenge(text) {
  if (typeof text !== "string" || text.length > 400) return null;
  const parts = text.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, season, entryText, nameText] = parts;
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(season)) return null;
  if (!/^[0-9a-z]{1,6}(-[0-9a-z]{1,6}){4,9}$/.test(entryText)) return null;
  const answers = [];
  const seen = new Set();
  for (const piece of entryText.split("-")) {
    const code = parseInt(piece, 36);
    if (!Number.isSafeInteger(code) || code >= MAX_ENTRY) return null;
    const e = decodeEntry(code);
    if (!isShareable(e)) return null;
    const id = duelCode(e.family, e.a, e.b, e.dim);
    if (seen.has(id)) return null;
    seen.add(id);
    answers.push(e);
  }
  let name = null;
  if (nameText) {
    const decoded = fromB64(nameText);
    if (decoded === null) return null;
    name = cleanName(decoded) || null;
  }
  return { season, answers, name };
}

/** The `c` value out of a query string ("?c=..."), or null. */
export function challengeParam(search) {
  const v = new URLSearchParams(search ?? "").get("c");
  return v ? v : null;
}

/** The answers of a finished round that can be sent: { season, answers } (answers is empty when too few can). A skipped
 * duel, an eye test and a duel without a recorded answer are left out. */
export function answersOfRound(round) {
  const byId = new Map((round?.duels ?? []).map((d) => [d.id, d]));
  const answers = [];
  for (const r of round?.results ?? []) {
    const d = byId.get(r.duelId);
    if (!d || r.skipped) continue;
    const a = { family: d.family, a: d.a, b: d.b, dim: d.dim, pick: r.pick };
    if (isShareable(a)) answers.push(a);
  }
  const season = round?.season;
  return answers.length >= CHALLENGE_MIN && /^\d{6}$/.test(season ?? "") ? { season, answers: answers.slice(0, CHALLENGE_MAX) } : { season, answers: [] };
}

/** How the second person's picks compare with the first one's, duel by duel. `picks[i]` is 0, 1 or null (skipped) for
 * `answers[i]`. percent is null when nothing was compared. */
export function matchOf(answers, picks) {
  let compared = 0;
  let same = 0;
  const splits = [];
  const sameAt = [];
  answers.forEach((a, i) => {
    const p = picks[i];
    if (p !== 0 && p !== 1) { sameAt.push(null); return; }
    compared++;
    const eq = p === a.pick;
    if (eq) same++; else splits.push(i);
    sameAt.push(eq);
  });
  return { compared, same, percent: compared ? Math.round((100 * same) / compared) : null, splits, sameAt };
}

/** A name for how close two people are: twins / close / mixed / opposite. */
export function matchLabel(percent) {
  if (percent === null || percent === undefined) return "mixed";
  if (percent >= 90) return "twins";
  if (percent >= 70) return "close";
  if (percent >= 40) return "mixed";
  return "opposite";
}

/** A season ("202611") that the server still takes votes for: this month's and last month's. */
export function seasonIsLive(season, now = new Date()) {
  const cur = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prev = `${prevDate.getUTCFullYear()}${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
  return season === cur || season === prev;
}
