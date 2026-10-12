import { requireSupabase } from "./supabaseClient.js";

/** Trailing-edge debounce with a cancel(): a burst of realtime events (a
 * participant answering 8 questions = 8 `responses` inserts) collapses into
 * one refetch instead of eight. */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

/** Subscribes to postgres_changes for a list of `{ table, event?, filter? }`
 * specs on ONE channel and calls `onChange(payload)` for each event.
 * `onStatus(status)` (optional) receives Supabase's channel status strings
 * ("SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED") so a caller can
 * show a Live indicator.
 *
 * Returns an unsubscribe function. Never throws -- realtime is an
 * enhancement, so if the socket can't open (offline, blocked, table not in
 * the publication yet) the page just keeps working with the data it
 * already loaded. */
export function watchTables(channelName, specs, onChange, onStatus) {
  let sb;
  let channel;
  try {
    sb = requireSupabase();
    channel = sb.channel(channelName);
    for (const { table, event = "*", filter } of specs) {
      const cfg = { event, schema: "public", table };
      if (filter) cfg.filter = filter;
      channel.on("postgres_changes", cfg, onChange);
    }
    channel.subscribe((status) => { try { onStatus?.(status); } catch { /* UI callback must not break the socket */ } });
  } catch {
    return () => {};
  }
  return () => {
    try { sb.removeChannel(channel); } catch { /* already closed */ }
  };
}
