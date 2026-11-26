-- ============================================================================
-- Affinix: SECURITY FIX -- add_member_by_email let anybody add anybody to any organisation
--
-- The check was   if org_role(org_id) not in ('owner', 'admin') then raise ...
-- org_role() returns NULL for someone who is not a member, and  NULL not in (...)  is NULL, which an IF treats as "false": the check was skipped.
-- The function is SECURITY DEFINER (it bypasses row security), and it was executable by everybody including the anonymous (public key) role, so
-- any visitor could call it with an organisation id and the email of a registered person and make that person an admin of ANY organisation
-- (reading its experiments and results), and could also find out whether an email has an account. Proved on a test database before this fix.
--
-- Chat messages were NOT affected (their access rules do not use this function).
-- Fix: the check treats "no role" as "not allowed", and the function is no longer executable by anonymous callers.
-- Safe to run twice.
-- ============================================================================

create or replace function add_member_by_email(org_id uuid, member_email text, member_role member_role)
returns organization_members
language plpgsql
security definer set search_path = public
as $$
declare
  target_id uuid;
  new_member organization_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if member_role = 'owner' then
    raise exception 'The owner role is assigned automatically to whoever creates an organization -- it cannot be granted to a member.';
  end if;
  -- no role at all (not a member) must count as "not allowed": compare as text with a default
  if coalesce(org_role(org_id)::text, '') not in ('owner', 'admin') then
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

revoke execute on function add_member_by_email(uuid, text, member_role) from public, anon;
grant execute on function add_member_by_email(uuid, text, member_role) to authenticated;

notify pgrst, 'reload schema';
