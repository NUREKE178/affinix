import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";

function mapPost(row, author, likedIds, savedIds) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: author?.full_name ?? null,
    authorUsername: author?.username ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    authorRoleTitle: author?.role_title ?? null,
    authorBio: author?.bio ?? null,
    body: row.body,
    imageUrl: row.image_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    likeCount: row.post_likes?.[0]?.count ?? 0,
    commentCount: row.post_comments?.[0]?.count ?? 0,
    viewerLiked: likedIds.has(row.id),
    viewerSaved: savedIds.has(row.id),
  };
}

/** profiles' own RLS only lets a user read their own row, so a platform-wide
 * feed can't resolve other authors' names/avatars through it -- every post
 * not authored by the viewer would otherwise show as "unknown". Looked up
 * through profiles_public (migrations 0011 + 0013), a narrow view exposing
 * just the identity-adjacent columns for every user -- scoped to signed-in
 * platform members only (granted to `authenticated`, never `anon`), as a
 * separate query rather than a PostgREST embed (embedding resolves through
 * posts.author_id's real FK, which points at profiles, not at this view). */
export async function fetchAuthorsById(authorIds) {
  if (!authorIds.length) return {};
  const sb = requireSupabase();
  const { data, error } = await sb.from("profiles_public").select("id, full_name, username, avatar_url, role_title, bio").in("id", authorIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((a) => [a.id, a]));
}

/** Which of the given posts the CURRENT viewer has a row for in post_likes
 * or post_saves -- a separate targeted query rather than fighting
 * PostgREST's embedded-resource filter syntax for a per-viewer flag,
 * same "fetch main rows, resolve the rest separately, merge client-side"
 * shape as fetchAuthorsById above. Returns a Set of post ids. */
async function fetchViewerPostIds(table, postIds) {
  const userId = getCurrentUser()?.id;
  if (!userId || !postIds.length) return new Set();
  const sb = requireSupabase();
  const { data, error } = await sb.from(table).select("post_id").eq("user_id", userId).in("post_id", postIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.post_id));
}

async function fetchPosts() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("posts")
    .select("*, post_likes(count), post_comments(count)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  const postIds = rows.map((r) => r.id);
  const [authorsById, likedIds, savedIds] = await Promise.all([
    fetchAuthorsById([...new Set(rows.map((r) => r.author_id))]),
    fetchViewerPostIds("post_likes", postIds),
    fetchViewerPostIds("post_saves", postIds),
  ]);
  return rows.map((row) => mapPost(row, authorsById[row.author_id], likedIds, savedIds));
}

/** author_id is never sent -- the column defaults to auth.uid() server-side
 * (see migration 0009), the same pattern organizations/experiments use.
 * imageUrl is optional; pass the URL uploadPostImage() returns, if any.
 * Doesn't bother resolving the author for its return value -- nothing reads
 * it; invalidatePosts() below triggers the real list refresh. */
export async function createPost(body, imageUrl = null) {
  const sb = requireSupabase();
  const { error } = await sb.from("posts").insert({ body, image_url: imageUrl });
  if (error) throw error;
  invalidatePosts();
}

/** RLS (0009 + 0012) allows this for the post's own author OR a profile
 * with is_admin = true -- enforced server-side either way, so a stray
 * delete button the UI shouldn't have shown still can't delete someone
 * else's post for a non-admin. */
export async function deletePost(id) {
  const sb = requireSupabase();
  const { error } = await sb.from("posts").delete().eq("id", id);
  if (error) throw error;
  invalidatePosts();
}

// --- Reactive cache, shared across every mounted consumer (Feed page, any
// future "latest posts" widget) -- same module-level state + listener-set
// pattern as experimentsStore.js. ---
let state = { posts: [], loading: false, error: null, loaded: false };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function load() {
  state = { ...state, loading: true };
  notify();
  try {
    const posts = await fetchPosts();
    state = { posts, loading: false, error: null, loaded: true };
  } catch (error) {
    state = { posts: [], loading: false, error, loaded: true };
  }
  notify();
}

export function invalidatePosts() {
  load();
}

/** The viewer's saved posts, most recently saved first -- reuses the exact
 * same mapPost()/fetchAuthorsById()/fetchViewerPostIds() helpers fetchPosts()
 * itself uses, so a saved post renders through PostCard identically to one
 * in the main feed (same likes/comments counts, same viewerLiked flag).
 * post_saves is queried first (it's the private, owner-scoped list that
 * actually decides *which* posts and in *what order*), then those ids
 * resolve against posts -- .in() doesn't preserve order, so the save order
 * is reapplied client-side afterward. */
export async function fetchSavedPosts() {
  const userId = getCurrentUser()?.id;
  if (!userId) return [];
  const sb = requireSupabase();
  const { data: savedRows, error: savedError } = await sb
    .from("post_saves")
    .select("post_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (savedError) throw savedError;
  const postIds = (savedRows ?? []).map((r) => r.post_id);
  if (!postIds.length) return [];

  const { data, error } = await sb
    .from("posts")
    .select("*, post_likes(count), post_comments(count)")
    .in("id", postIds);
  if (error) throw error;
  const rows = data ?? [];
  const saveOrder = new Map(postIds.map((id, i) => [id, i]));
  rows.sort((a, b) => saveOrder.get(a.id) - saveOrder.get(b.id));

  const [authorsById, likedIds] = await Promise.all([
    fetchAuthorsById([...new Set(rows.map((r) => r.author_id))]),
    fetchViewerPostIds("post_likes", rows.map((r) => r.id)),
  ]);
  const savedIds = new Set(postIds); // every row here is saved, by construction
  return rows.map((row) => mapPost(row, authorsById[row.author_id], likedIds, savedIds));
}

export function usePosts() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a create/invalidate resolved just before this subscribed
    if (!state.loaded && !state.loading) load();
    return () => listeners.delete(listener);
  }, []);

  return { posts: state.posts, loading: state.loading, error: state.error };
}
