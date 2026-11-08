// A Taste Match link that has reached this browser but has not been played yet. It survives sign-up and sign-in (the link
// is opened first, the account comes after), so it is kept in localStorage; everything read back is checked again, because
// storage can hold anything.
import { decodeChallenge, challengeParam } from "./challenge.js";

const KEY = "affinix.challenge";
const SEEN_PREFIX = "affinix.firstLook.";
let snoozed = false; // "Later" hides the welcome for this visit only; the challenge itself stays

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just will not persist */ } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* same */ } };

/** Keeps the link's text if it is a valid challenge. */
export function rememberChallenge(raw) {
  if (decodeChallenge(raw)) write(KEY, raw);
}

/** The waiting challenge, decoded, or null (a stored value that no longer decodes is thrown away). */
export function pendingChallenge() {
  const raw = read(KEY);
  if (!raw) return null;
  const ch = decodeChallenge(raw);
  if (!ch) drop(KEY);
  return ch;
}

export function forgetChallenge() {
  drop(KEY);
  snoozed = false;
}

export function snoozeChallenge() {
  snoozed = true;
}

/** The challenge to show now: waiting and not put off for this visit. */
export function activeChallenge() {
  return snoozed ? null : pendingChallenge();
}

/** At the start of the page: a `?c=` in the address is remembered and removed from the address bar. */
export function captureChallengeFromUrl() {
  if (typeof location === "undefined") return;
  const raw = challengeParam(location.search);
  if (!raw) return;
  rememberChallenge(raw);
  try {
    const url = new URL(location.href);
    url.searchParams.delete("c");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch { /* the address stays as it is */ }
}

/** Has this person already seen (and answered) the first welcome? */
export const firstLookSeen = (userId) => !!userId && read(SEEN_PREFIX + userId) === "1";
export const markFirstLookSeen = (userId) => { if (userId) write(SEEN_PREFIX + userId, "1"); };
