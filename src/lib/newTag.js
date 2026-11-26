// Which things still carry the "New" tag (components/NewBadge.js draws it). Kept apart from the component so it can be tested in plain Node.
const PREFIX = "affinix.seen.";
const NEW_UNTIL = Date.UTC(2027, 0, 15); // the features marked "new" were added in November 2026; nothing stays new forever

export function isNew(id) {
  if (Date.now() > NEW_UNTIL) return false;
  try { return localStorage.getItem(PREFIX + id) !== "1"; } catch { return true; }
}
export function markSeen(id) {
  try { localStorage.setItem(PREFIX + id, "1"); } catch { /* private mode: it just shows again next visit */ }
}
