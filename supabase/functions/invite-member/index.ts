// POST { org_id, email, role }
// Authenticated (Authorization: Bearer <user jwt>, forwarded automatically
// by supabase-js when invoked via supabase.functions.invoke). Only called by
// src/lib/org.js's addMemberByEmail() as a fallback, after add_member_by_email()
// (the normal RPC path) has already raised "No account found for this
// email" -- that RPC stays the only way to add an EXISTING user, since
// it's one round trip with no email involved. This function covers the
// new-user case only: it uses the Supabase Admin API (service-role key,
// never reachable from the browser) to send a real invite email via
// auth.admin.inviteUserByEmail(), then seats the new account in the org
// itself, server-side, right after the auth user exists -- so the Team list
// is accurate as soon as the invite is sent, the same as for an existing
// user. Deliberately NOT done through auth user_metadata + a trigger:
// user_metadata is writable by anyone calling the public signup endpoint,
// so a trigger that trusted it would let a stranger self-seat into an org.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, handleOptions } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "unauthenticated" }, 401);

    const { org_id, email, role } = await req.json();
    if (!org_id || !email || !role) return jsonResponse({ error: "missing_fields" }, 400);
    if (!["admin", "researcher", "viewer"].includes(role) && role !== "owner") {
      return jsonResponse({ error: "invalid_role", message: "Role must be admin, researcher or viewer." }, 400);
    }
    if (role === "owner") {
      return jsonResponse(
        {
          error: "cannot_invite_owner",
          message: "The owner role is assigned automatically to whoever creates an organization -- it cannot be granted to a member.",
        },
        400
      );
    }

    // Caller-scoped client: proves the caller is actually an owner/admin of
    // this org through the normal RLS-gated read ("members: read within own
    // org"), the same pattern generate-insights/index.ts uses for its own
    // org-membership check -- never a hand-rolled authorization check.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: userError } = await callerClient.auth.getUser();
    if (userError || !caller) return jsonResponse({ error: "unauthenticated" }, 401);

    const { data: membership, error: membershipError } = await callerClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", org_id)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (membershipError) return jsonResponse({ error: "lookup_failed", detail: membershipError.message }, 500);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return jsonResponse({ error: "forbidden", message: "Only an owner or admin can invite members." }, 403);
    }

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      const alreadyRegistered = /already.*registered|already.*exists|user.*already/i.test(inviteError.message ?? "");
      return jsonResponse(
        {
          error: alreadyRegistered ? "already_registered" : "invite_failed",
          message: alreadyRegistered
            ? 'This email already has an account. Use "Add existing member" instead.'
            : inviteError.message,
        },
        alreadyRegistered ? 409 : 500
      );
    }

    const invitedUser = inviteData?.user;
    if (!invitedUser) return jsonResponse({ error: "invite_failed", message: "The invite was sent but no user was returned." }, 500);

    // Seat the new account now. The service-role client bypasses RLS, which is fine here: authorization (caller is an
    // owner/admin of org_id) was already established above through the caller-scoped, RLS-gated read, and role can
    // never be 'owner' (rejected earlier). ignoreDuplicates: re-inviting someone who hasn't accepted yet must not
    // error on organization_members' unique (organization_id, user_id).
    const { error: seatError } = await adminClient
      .from("organization_members")
      .upsert({ organization_id: org_id, user_id: invitedUser.id, role }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });
    if (seatError) return jsonResponse({ error: "seat_failed", message: seatError.message }, 500);

    return jsonResponse({ status: "invited", email: invitedUser.email ?? email });
  } catch (err) {
    return jsonResponse({ error: "unexpected", detail: String(err) }, 500);
  }
});
