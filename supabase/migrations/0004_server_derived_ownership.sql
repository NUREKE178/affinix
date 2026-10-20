-- ============================================================================
-- Affinix — derive ownership columns server-side, never trust the client
--
-- `organizations.created_by` was being sent by the client (from
-- supabase.auth.getUser() in src/lib/org.js) and checked against auth.uid()
-- in the INSERT policy. Any staleness between what the client *thinks* its
-- user id is and what the server resolves auth.uid() to for that same
-- request (e.g. a session established moments earlier from an email
-- confirmation redirect) throws "new row violates row-level security
-- policy" even though the user genuinely owns the row. Defaulting the
-- column to auth.uid() and never letting the client set it removes the
-- mismatch as a failure mode entirely -- the same auth.uid() evaluation
-- used for the default is also what the RLS check compares against, in
-- the same statement.
-- ============================================================================

alter table organizations alter column created_by set default auth.uid();
alter table experiments alter column created_by set default auth.uid();

-- The REAL bug behind "new row violates row-level security policy for
-- table organizations" on a perfectly valid insert: Postgres filters
-- `INSERT ... RETURNING` through the table's SELECT policies too, not just
-- the INSERT policy's WITH CHECK -- and supabase-js's .insert().select()
-- always requests the inserted row back (Prefer: return=representation).
-- At the moment a brand-new org is inserted, its creator isn't a member of
-- it yet (that row comes next), so the existing "members can read" SELECT
-- policy (is_org_member(id)) hides the very row that was just correctly
-- inserted -- which Postgres reports as the same generic RLS-violation
-- error as an actual WITH CHECK failure, despite the INSERT itself having
-- fully succeeded by every other measure. Verified locally: the identical
-- insert succeeds with no RETURNING clause and fails with one, which
-- isolates this exactly.
create policy "organizations: creator can read their own new org" on organizations
  for select using (created_by = auth.uid());

-- Replaces the client-side "insert org, then insert membership row" two-step
-- (src/lib/org.js createOrganization) with one atomic, SECURITY INVOKER
-- function: both inserts run in the same statement's auth context, so
-- there's no round-trip in between where a stale client-cached user id
-- could diverge from what the server resolves auth.uid() to. Runs as the
-- CALLER (not definer) specifically so it stays governed by the normal
-- organizations/organization_members RLS policies, not a privilege escalation.
create function create_organization_with_owner(org_name text, org_slug text)
returns organizations
language plpgsql security invoker set search_path = public
as $$
declare
  new_org organizations;
begin
  insert into organizations (name, slug) values (org_name, org_slug) returning * into new_org;
  insert into organization_members (organization_id, user_id, role) values (new_org.id, auth.uid(), 'owner');
  return new_org;
end;
$$;

grant execute on function create_organization_with_owner(text, text) to authenticated;
