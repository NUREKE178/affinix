-- ============================================================================
-- DecisionOS — owner can only ever be the org's own creator
--
-- Team.js's UI already does the right thing: its role dropdown excludes
-- "owner" everywhere (invite modal and the per-member change-role select),
-- and an existing owner's row isn't even shown as editable. But none of
-- that is enforced where it actually matters -- the client is not a
-- trust boundary, and a direct API call bypassing the UI was NOT stopped
-- by the database:
--
--   * "members: owner/admin can change roles" (0002_rls.sql) is an UPDATE
--     policy with a `using` clause but no `with check` -- in Postgres RLS,
--     that means it gates which EXISTING rows can be targeted, but places
--     no constraint at all on the NEW values. Any owner/admin could already
--     `update organization_members set role = 'owner' ...` on themselves or
--     anyone else in their org, in a single request, with nothing server-
--     side to stop it.
--   * add_member_by_email() (0006_team.sql) takes member_role as a raw,
--     unvalidated parameter and inserts it directly -- a direct RPC call
--     with member_role: 'owner' would have succeeded for the same reason.
--
-- Fixed at the only two places a role can currently change. The one path
-- that's deliberately left alone is "members: creator can seat themselves
-- as owner" (0002_rls.sql) -- that's already correctly scoped (only the
-- org's own creator, only themselves, only once at creation), and is
-- genuinely how every org -- not just one -- is meant to get an owner.
-- Locking "owner" to "whoever created this specific org, forever" is what
-- makes this a per-org rule rather than a single platform-wide identity:
-- someone else creating their own, separate organization still correctly
-- becomes its owner the same way every org's creator always has.
-- ============================================================================

-- Reconcile existing data to the invariant below before enforcing it going
-- forward: demote any row that holds 'owner' in an org it didn't create
-- (there shouldn't be any today -- the only insert path for 'owner' was
-- already creator-only -- this is a safety net, not an expected no-op),
-- then make sure every org's actual creator currently holds 'owner'.
update organization_members om
set role = 'admin'
from organizations o
where om.organization_id = o.id
  and om.role = 'owner'
  and om.user_id <> o.created_by;

update organization_members om
set role = 'owner'
from organizations o
where om.organization_id = o.id
  and om.user_id = o.created_by
  and om.role <> 'owner';

-- The owner's own row can no longer be the TARGET of this policy (using),
-- and no update under it can set a NEW role of 'owner' either (with check)
-- -- both directions closed, not just one.
drop policy "members: owner/admin can change roles" on organization_members;
create policy "members: owner/admin can change roles" on organization_members
  for update
  using (org_role(organization_id) in ('owner', 'admin') and role <> 'owner')
  with check (role <> 'owner');

create or replace function add_member_by_email(org_id uuid, member_email text, member_role member_role)
returns organization_members
language plpgsql security definer set search_path = public
as $$
declare
  target_id uuid;
  new_member organization_members;
begin
  if member_role = 'owner' then
    raise exception 'The owner role is assigned automatically to whoever creates an organization -- it cannot be granted to a member.';
  end if;
  if org_role(org_id) not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can add members.';
  end if;
  select id into target_id from auth.users where email = member_email;
  if target_id is null then
    raise exception 'No account found for this email. Ask them to register first.';
  end if;
  if exists (select 1 from organization_members where organization_id = org_id and user_id = target_id) then
    raise exception 'This person is already a member.';
  end if;
  insert into organization_members (organization_id, user_id, role)
    values (org_id, target_id, member_role)
    returning * into new_member;
  return new_member;
end;
$$;
