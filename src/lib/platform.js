// The admin panel's data layer (migration 0025). Every call is answered only to platform admins; the owner is one too.
// Errors arrive as short words (not_admin, not_owner, is_owner, not_found); a server that has not got the migration yet
// answers "updatePending" so the page can say so instead of showing a raw error.
import { requireSupabase } from "./supabaseClient.js";
import { isMissingFunction } from "./rpcErrors.js";
import { withTimeout } from "./async.js";

const KNOWN = new Set(["not_admin", "not_owner", "is_owner", "not_found"]);

/** not_admin | not_owner | is_owner | not_found | updatePending | generic */
export function adminErrorCode(err) {
  if (isMissingFunction(err)) return "updatePending";
  const m = typeof err?.message === "string" ? err.message.trim() : "";
  return KNOWN.has(m) ? m : "generic";
}

async function rpc(name, args = {}) {
  const sb = requireSupabase();
  const { data, error } = await withTimeout(sb.rpc(name, args), 20000);
  if (error) throw Object.assign(new Error(adminErrorCode(error)), { code: adminErrorCode(error), cause: error });
  return data;
}

/** { users, newUsers7d, active7d, admins, companies, experiments, responses, posts, comments, messages7d, friendships,
 *    arenaPlayers, testsOpen, testsFlagged } */
export const fetchAdminOverview = () => rpc("admin_overview");

/** { rows: [{ id, name, username, email, avatarUrl, isAdmin, isOwner, joinedAt, company, companyRole, posts, xp }], total } */
export async function fetchAdminUsers({ query = "", limit = 30, offset = 0 } = {}) {
  const data = (await rpc("admin_users", { p_query: query, p_limit: limit, p_offset: offset })) ?? [];
  return {
    total: data.length ? Number(data[0].total) : 0,
    rows: data.map((r) => ({
      id: r.id, name: r.full_name, username: r.username, email: r.email, avatarUrl: r.avatar_url,
      isAdmin: !!r.is_admin, isOwner: !!r.is_owner, joinedAt: r.created_at,
      company: r.org_name, companyRole: r.org_role, posts: Number(r.posts ?? 0), xp: Number(r.xp ?? 0),
    })),
  };
}

/** Only the owner may do this (the database checks): makes `userId` a platform admin, or takes that away. */
export const setPlatformAdmin = (userId, makeAdmin) => rpc("admin_set_admin", { p_user: userId, p_admin: !!makeAdmin });

/** [{ id, action, at, actor: { id, name }, target: { id, name }, meta }], newest first. */
export async function fetchAdminLog(limit = 60) {
  const data = (await rpc("admin_audit_list", { p_limit: limit })) ?? [];
  return data.map((r) => ({
    id: r.id, action: r.action, at: r.created_at,
    actor: { id: r.actor_id, name: r.actor_name }, target: { id: r.target_id, name: r.target_name }, meta: r.meta ?? {},
  }));
}

/** The newest posts and comments, for the moderation tab (plain reads: RLS lets every member read them). */
export async function fetchRecentContent(limit = 20) {
  const sb = requireSupabase();
  const [posts, comments] = await Promise.all([
    withTimeout(sb.from("posts").select("id, author_id, body, image_url, created_at").order("created_at", { ascending: false }).limit(limit), 15000),
    withTimeout(sb.from("post_comments").select("id, post_id, author_id, body, created_at").order("created_at", { ascending: false }).limit(limit), 15000),
  ]);
  if (posts.error) throw posts.error;
  if (comments.error) throw comments.error;
  return { posts: posts.data ?? [], comments: comments.data ?? [] };
}

/** An admin removes someone else's post / comment (RLS: posts_delete_admin, post_comments_delete_admin; the database logs it). */
export async function removeContent(kind, id) {
  const sb = requireSupabase();
  const { error } = await sb.from(kind === "post" ? "posts" : "post_comments").delete().eq("id", id);
  if (error) throw error;
}
