// One profile popover for the whole app. Anything that shows a person (an
// avatar, a name) calls openProfile(...); ProfileViewerHost, mounted once in
// the shell, renders it. Same module-level store + listener-set shape as the
// other stores, so no page has to own popover state of its own.
import { useState, useEffect } from "./preact.js";
import { toPerson } from "./people.js";

let current = null; // { person, arena } | null
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

/** Opens the profile of `who`: a person, or any author-like object (see
 * toPerson). `extra.arena` ({ rank, level, xp, streak, scope }) adds the
 * Arena strip when the caller already knows those numbers. */
export function openProfile(who, extra = {}) {
  const person = toPerson(who);
  if (!person || (!person.id && !person.name)) return;
  current = { person, arena: extra.arena ?? null };
  notify();
}

export function closeProfile() {
  if (!current) return;
  current = null;
  notify();
}

/** Other global key handlers (the Arena's 1 / 2 / S / Enter / Esc) read this
 * so they stand down while a profile is on screen. */
export function isProfileOpen() {
  return current != null;
}

export function useProfileViewer() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    listener();
    return () => listeners.delete(listener);
  }, []);
  return current;
}
