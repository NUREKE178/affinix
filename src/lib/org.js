import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";

function slugify(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яёәіңғүұқөһ]+/giu, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "org"}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Orgs the current user belongs to, with their role in each.
 *
 * `userId` can be passed explicitly (preferred -- currentOrg.js and App.js
 * both already have it resolved when they call this) or omitted to fall
 * back to getCurrentUser(), same as fetchPosts()/fetchNotifications() do
 * elsewhere in this codebase.
 *
 * The .eq("user_id", ...) here is load-bearing, not a micro-optimization:
 * "members: read within own org" (0002_rls.sql) is scoped to `is_org_member
 * (organization_id)`, i.e. ANY row for an org the caller belongs to, not
 * just the caller's own row -- the same shape every co-member's row is
 * readable under. Without this filter, a query for "my orgs" came back
 * with one row per MEMBERSHIP in each of those orgs, every co-member's own
 * role mixed in alongside the caller's -- for an org with several members,
 * .find()-ing "the" row for that org id could just as easily land on
 * someone else's role as the caller's own, which is exactly what surfaced
 * as a non-owner's Profile/Settings page both reading "owner". */
export async function fetchMyOrganizations(userId) {
  const sb = requireSupabase();
  const resolvedUserId = userId ?? getCurrentUser()?.id;
  if (!resolvedUserId) return [];
  const { data, error } = await sb
    .from("organization_members")
    .select("role, organization:organizations(id, name, slug, created_at)")
    .eq("user_id", resolvedUserId)
    .order("created_at", { referencedTable: "organizations", ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row.organization, role: row.role }));
}

/** Creates a new org and seats the creator as its owner, atomically, via the
 * create_organization_with_owner() Postgres function (0004 migration) --
 * both inserts happen server-side in one statement using auth.uid()
 * directly, so there's no client-supplied id to ever drift out of sync with
 * what the server resolves the caller's identity to. */
export async function createOrganization(name) {
  const sb = requireSupabase();
  // create_organization_with_owner() returns a single `organizations` row
  // (not SETOF), so PostgREST already hands it back as one object -- no
  // .single() needed (that's for SETOF-returning calls).
  const { data: org, error } = await sb.rpc("create_organization_with_owner", {
    org_name: name,
    org_slug: slugify(name),
  });
  if (error) throw error;
  return org;
}

/** Members of an org, joined with their profile (name/email) -- relies on
 * the "profiles: org co-members can read" policy (0006_team.sql). */
export async function updateOrganizationName(organizationId, name) {
  const sb = requireSupabase();
  const { error } = await sb.from("organizations").update({ name }).eq("id", organizationId);
  if (error) throw error;
}

export async function fetchOrgMembers(organizationId) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("organization_members")
    .select("id, role, user_id, created_at, profile:profiles(full_name, email)")
    .eq("organization_id", organizationId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    role: row.role,
    name: row.profile?.full_name || row.profile?.email || "—",
    email: row.profile?.email ?? "",
  }));
}

export async function updateMemberRole(memberId, role) {
  const sb = requireSupabase();
  const { error } = await sb.from("organization_members").update({ role }).eq("id", memberId);
  if (error) throw error;
}

export async function removeMember(memberId) {
  const sb = requireSupabase();
  const { error } = await sb.from("organization_members").delete().eq("id", memberId);
  if (error) throw error;
}

/** Adds an EXISTING registered user as a member by email, via the
 * add_member_by_email() SECURITY DEFINER function (0006_team.sql), which
 * enforces owner/admin-only server-side. Inviting someone with no account
 * yet needs an email-sending Edge Function (Admin inviteUserByEmail) -- not
 * implemented; this only covers people who already have a DecisionOS account. */
export async function addMemberByEmail(organizationId, email, role) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("add_member_by_email", {
    org_id: organizationId,
    member_email: email,
    member_role: role,
  });
  if (error) throw error;
  return data;
}
