import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { fetchAuthorsById } from "./postsStore.js";

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

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    if (!state.loaded && !state.loading) load();
    return () => listeners.delete(listener);
  }, []);

  const unreadCount = state.notifications.filter((n) => !n.isRead).length;
  return { notifications: state.notifications, loading: state.loading, error: state.error, unreadCount };
}
