-- ============================================================================
-- Affinix — profile system (avatar, username, bio, preferences) +
-- optional public researcher profile + avatar storage bucket.
--
-- Public profiles are opt-in (public_profile_enabled defaults to false) and
-- exposed through a SECURITY DEFINER function rather than a relaxed RLS
-- policy or a plain view: profiles already holds private data (email), and
-- the lesson from 0002/0004 is that a loosened policy on a shared table
-- leaks sideways in ways that are easy to miss. get_public_profile() instead
-- returns an explicit, narrow column list, and only for rows that opted in.
-- ============================================================================

alter table profiles
  add column username text,
  add column bio text,
  add column role_title text,
  add column country text,
  add column timezone text,
  add column research_interests text[] not null default '{}'::text[],
  add column public_profile_enabled boolean not null default false,
  add column notify_email_responses boolean not null default true,
  add column notify_email_digest boolean not null default true;

create unique index profiles_username_key on profiles (lower(username)) where username is not null;

alter table profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,30}$');

create or replace function get_public_profile(p_username text)
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  role_title text,
  bio text,
  research_interests text[],
  org_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id, p.username, p.full_name, p.avatar_url, p.role_title, p.bio, p.research_interests,
    (
      select o.name from organization_members om
      join organizations o on o.id = om.organization_id
      where om.user_id = p.id
      order by om.created_at asc
      limit 1
    ) as org_name
  from profiles p
  where lower(p.username) = lower(p_username) and p.public_profile_enabled = true;
$$;

grant execute on function get_public_profile(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- avatars bucket -- public read (avatars render in the shell/topbar and on
-- opted-in public profiles), writes restricted to the owning user's own
-- folder (<user_id>/...), same shape as variant-assets but keyed by user
-- rather than by org.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: user can upload own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

create policy "avatars: user can update own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );

create policy "avatars: user can delete own"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid()
  );
