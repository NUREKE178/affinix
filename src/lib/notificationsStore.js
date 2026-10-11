import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { fetchAuthorsById } from "./postsStore.js";
import { t as translate, getLocale } from "./i18n.js";
import { navigate } from "../router.js";

function mapNotification(row, actor) {
  return {
    id: row.id,
    postId: row.post_id,
    commentId: row.comment_id,
    actorId: row.actor_id,
    actorName: actor?.full_name ?? null,
    actorAvatarUrl: actor?.avatar_url ?? null,
    commentBody: row.comment?.body ?? null,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

/** comment:post_comments(body) is a real PostgREST embed (comment_id has an
 * actual FK to post_comments) -- unlike the actor, which has to be
 * resolved as a separate query through profiles_public, same reasoning as
 * fetchAuthorsById's own comment in postsStore.js (posts.author_id's FK
 * points at profiles, not at the public view, so embedding under an alias
 * isn't supported there either). */
async function fetchNotifications() {
  const userId = getCurrentUser()?.id;
  if (!userId) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("notifications")
    .select("*, comment:post_comments(body)")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  const rows = data ?? [];
  const actorsById = await fetchAuthorsById([...new Set(rows.map((r) => r.actor_id))]);
  return rows.map((row) => mapNotification(row, actorsById[row.actor_id]));
}

/** Fires a notification to a post's author when someone comments, skipping
 * silently when the commenter IS the author -- notifying yourself about
 * your own comment is noise, not a feature. The insert policy
 * (notifications_insert_validated, migration 0014) enforces the same
 * actor_id <> recipient_id rule server-side regardless, so this check is
 * a UX optimization (skip a request that would fail anyway), not the real
 * security boundary -- that's the RLS policy, which also validates
 * recipient_id against the post's true author instead of trusting it from
 * the caller. */
export async function createCommentNotification({ postId, postAuthorId, commentId }) {
  const actorId = getCurrentUser()?.id;
  if (!actorId || actorId === postAuthorId) return;
  const sb = requireSupabase();
  const { error } = await sb.from("notifications").insert({ recipient_id: postAuthorId, post_id: postId, comment_id: commentId });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const userId = getCurrentUser()?.id;
  if (!userId) return;
  const sb = requireSupabase();
  const { error } = await sb.from("notifications").update({ is_read: true }).eq("recipient_id", userId).eq("is_read", false);
  if (error) throw error;
  invalidateNotifications();
}

/** A short, synthesized two-tone chime -- no external audio asset, same
 * "hand-built, no CDN" posture as the hand-drawn icon set. Wrapped in
 * try/catch: browsers that block audio before any user gesture, or lack
 * Web Audio entirely, should degrade to silence, never an uncaught error
 * that breaks the notification itself. */
function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1175, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
    osc.onended = () => ctx.close();
  } catch {
    // Autoplay restrictions or no Web Audio support -- silence is an
    // acceptable fallback, never worth surfacing as an error.
  }
}

/** Asks for OS-notification permission once per browser profile -- never
 * re-prompts after the first decision, since Notification.permission is
 * only ever "default" before the user has answered at all (it becomes
 * "granted" or "denied" permanently after, both of which short-circuit
 * this). Called from useNotifications()'s mount effect, the same moment
 * notifications become relevant to the signed-in visitor. */
function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** The OS-level popup companion to the in-app bell, for a visitor who
 * isn't looking at the tab. Reuses the same resolved shell.notifications.commentOn
 * copy as the dropdown (translate() is the plain, non-hook form i18n.js
 * exports for exactly this -- code running outside component render) so
 * the two channels never say different things for the same event. */
function maybeShowBrowserNotification(n) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const locale = getLocale();
    const title = translate(locale, "shell.notifications.commentOn", { name: n.actorName ?? translate(locale, "feed.unknownAuthor") });
    const popup = new Notification(title, {
      body: n.commentBody ? `«${n.commentBody}»` : "",
      icon: "/favicon.svg",
      tag: n.id,
    });
    popup.onclick = () => {
      window.focus();
      navigate("/app/feed");
      popup.close();
    };
  } catch {
    // Some platforms (notably iOS Safari) accept the permission grant but
    // throw on `new Notification(...)` itself -- the in-app bell already
    // covers this visitor either way, so this channel failing is a no-op,
    // not an error worth surfacing.
  }
}

/** Bumped on every live arrival, separate from `state` (which `load()`
 * replaces wholesale) so it survives that replacement untouched. Exposed
 * through useNotifications() purely as a change signal -- shell.js's bell
 * diffs it against the previous value it saw to replay the ring animation,
 * never reads the number itself for anything meaningful. */
let ringSeq = 0;

/** A realtime INSERT on `notifications` means a brand new row the current
 * viewer didn't have a moment ago -- reload the resolved list (same
 * reload-on-change shape every other mutation in this store already uses)
 * rather than hand-assembling the new row's author/comment text from the
 * bare payload, then fire the sound + OS popup + bell-ring signal using
 * the freshly-resolved copy of it. */
async function handleLiveNotification(payload) {
  await load();
  const fresh = state.notifications.find((n) => n.id === payload.new?.id);
  if (!fresh) return;
  playNotificationSound();
  maybeShowBrowserNotification(fresh);
  ringSeq += 1;
  notify();
}

/** One channel for the lifetime of the tab, not one per useNotifications()
 * caller -- guarded by the module-level `realtimeChannel` so a second
 * mount (or a second component ever calling useNotifications()) reuses
 * it instead of opening a duplicate socket. Filtered to this viewer's own
 * recipient_id as a cheap narrowing up front; notifications_select_own
 * (0014) is the real boundary regardless, so a subscriber can never
 * actually receive anyone else's row even if this filter were wrong. Not
 * re-subscribed on sign-out/sign-in-as-a-different-user within the same
 * tab -- the rest of this codebase's reactive stores (postsStore.js
 * included) don't handle that either; worst case there, the bell just
 * goes back to updating on next load instead of live, not a wrong-user
 * leak.
 *
 * Takes userId as a parameter rather than reading getCurrentUser() itself
 * -- auth.js's own session hydration is async (a localStorage/IndexedDB
 * read), and on a cold load it has not necessarily resolved yet by the
 * time a mount effect first runs (the exact race auth.js's useSession()
 * comment documents for the same reason). A synchronous getCurrentUser()
 * call here would silently see no user and never subscribe at all.
 * useNotifications() below instead drives this off useSession()'s
 * reactive `user`, so it fires once the id is actually known, the same
 * fix profile.js's useMyProfile() already applies to this identical race. */
let realtimeChannel = null;
function subscribeToLiveNotifications(userId) {
  if (realtimeChannel || !userId) return;
  const sb = requireSupabase();
  realtimeChannel = sb
    .channel(`notifications:${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, handleLiveNotification)
    .subscribe();
}

// --- Reactive cache, same module-level state + listener-set pattern as
// postsStore.js. ---
let state = { notifications: [], loading: false, error: null, loaded: false };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function load() {
  state = { ...state, loading: true };
  notify();
  try {
    const notifications = await fetchNotifications();
    state = { notifications, loading: false, error: null, loaded: true };
  } catch (error) {
    state = { notifications: [], loading: false, error, loaded: true };
  }
  notify();
}

export function invalidateNotifications() {
  load();
}

export function useNotifications() {
  const [, setTick] = useState(0);
  const { user } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    if (!state.loaded && !state.loading) load();
    return () => listeners.delete(listener);
  }, []);

  // Separate from the effect above and keyed on userId: useSession()'s own
  // session hydration is async, so this re-runs once it actually resolves
  // instead of only ever checking at this component's first mount.
  useEffect(() => {
    if (!userId) return;
    subscribeToLiveNotifications(userId);
    requestNotificationPermission();
  }, [userId]);

  const unreadCount = state.notifications.filter((n) => !n.isRead).length;
  return { notifications: state.notifications, loading: state.loading, error: state.error, unreadCount, ringSeq };
}
