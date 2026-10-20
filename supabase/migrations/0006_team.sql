-- ============================================================================
-- Affinix — team visibility + adding an existing user as a member
-- ============================================================================

alter table profiles add column email text;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

-- "profiles: read own" (0001) only lets you see yourself -- the Team page
-- needs to show co-members' names too. Add visibility scoped to shared
-- organization membership (never "every profile", just people you actually
-- work with).
create policy "profiles: org co-members can read" on profiles
  for select using (
    exists (
      select 1 from organization_members mine
      join organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

-- Adding a teammate who already has an account (no email-sending Edge
-- Function yet, so this only covers existing users -- see
-- src/lib/org.js for the "invite someone with no account" TODO).
-- SECURITY DEFINER because `authenticated` cannot read auth.users directly;
-- the function itself enforces owner/admin-only before doing anything, and
-- only reveals "found" vs "not found", not other account details.
create function add_member_by_email(org_id uuid, member_email text, member_role member_role)
returns organization_members
language plpgsql security definer set search_path = public
as $$
declare
  target_id uuid;
  new_member organization_members;
begin
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

grant execute on function add_member_by_email(uuid, text, member_role) to authenticated;
