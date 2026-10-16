import { requireSupabase } from "./supabaseClient.js";
import { invalidatePosts, fetchAuthorsById, patchPost } from "./postsStore.js";
import { invalidateFavorites, patchFavoritePost } from "./favoritesStore.js";
import { createCommentNotification } from "./notificationsStore.js";

/** Like / save change what the card shows at once (heart filled, count up) and are put back if the server refuses; the
 * quiet refresh that follows brings the real numbers. */
function patchEverywhere(postId, patch) {
  patchPost(postId, patch);
  patchFavoritePost(postId, patch);
}

/** post_likes/post_saves rows are toggled by (post_id, user_id) uniqueness
 * -- the caller already knows the viewer's current state (it came back on
 * the post object from postsStore), so these just flip it rather than
 * reading it back first. user_id is never sent on insert (defaults to
 * auth.uid() server-side, same pattern as posts.author_id); delete relies
 * on RLS to scope "own row only", same as deletePost(). */
export async function toggleLike(postId, currentlyLiked) {
  const sb = requireSupabase();
  const flip = (liked) => (p) => ({ viewerLiked: liked, likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)) });
  patchEverywhere(postId, flip(!currentlyLiked));
  try {
    if (currentlyLiked) {
      const { error } = await sb.from("post_likes").delete().eq("post_id", postId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("post_likes").insert({ post_id: postId });
      if (error) throw error;
    }
  } catch (err) {
    patchEverywhere(postId, flip(currentlyLiked));
    throw err;
  }
  invalidatePosts();
}

export async function toggleSave(postId, currentlySaved) {
  const sb = requireSupabase();
  patchEverywhere(postId, { viewerSaved: !currentlySaved });
  try {
    if (currentlySaved) {
      const { error } = await sb.from("post_saves").delete().eq("post_id", postId);
      if (error) throw error;
    } else {
      const { error } = await sb.from("post_saves").insert({ post_id: postId });
      if (error) throw error;
    }
  } catch (err) {
    patchEverywhere(postId, { viewerSaved: currentlySaved });
    throw err;
  }
  invalidatePosts();
  // A save/unsave can happen from the main feed OR the Favorites page --
  // both stores need to reflect it regardless of which one triggered it.
  invalidateFavorites();
}

function mapComment(row, author) {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorName: author?.full_name ?? null,
    authorUsername: author?.username ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    // role_title/bio are already part of fetchAuthorsById's own select
    // (postsStore.js) -- carried through here too so a comment's author can
    // be opened in the same viewingAuthor popover a post's author already
    // uses, with no separate fetch.
    authorRoleTitle: author?.role_title ?? null,
    authorBio: author?.bio ?? null,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Comments are fetched per-post, on demand (when a thread is expanded in
 * the UI), not folded into the global posts store -- unlike the feed list
 * itself, nothing outside one expanded PostCard ever needs them. */
export async function fetchComments(postId) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const authorsById = await fetchAuthorsById([...new Set(rows.map((r) => r.author_id))]);
  return rows.map((row) => mapComment(row, authorsById[row.author_id]));
}

/** Expects already-moderated text -- callers run moderatePost() themselves
 * and decide what to do with a "block" verdict, same division of
 * responsibility as createPost()/Composer in Feed.js (moderation is a UI
 * concern, not baked into the data layer). postAuthorId comes from the
 * caller's already-loaded post object so this doesn't need an extra
 * round trip just to know who to notify. The notification is a
 * non-critical side effect of a successful comment: if it fails for some
 * unrelated reason, the comment itself still stands. */
export async function createComment({ postId, postAuthorId, body }) {
  const sb = requireSupabase();
  const { data, error } = await sb.from("post_comments").insert({ post_id: postId, body }).select("*").single();
  if (error) throw error;
  try {
    await createCommentNotification({ postId, postAuthorId, commentId: data.id });
  } catch {
    // Non-critical -- the comment itself was posted successfully regardless.
  }
  return data;
}

/** RLS (0014) allows this for the comment's own author OR a profile with
 * is_admin = true, enforced server-side either way -- same shape as
 * deletePost(). */
export async function deleteComment(id) {
  const sb = requireSupabase();
  const { error } = await sb.from("post_comments").delete().eq("id", id);
  if (error) throw error;
}
