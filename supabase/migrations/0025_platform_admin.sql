-- ============================================================================
-- Affinix: platform owner, platform admins, the admin panel (migration 0025)
--
-- Two different things were both called "owner":
--   * the ROLE IN A COMPANY (organization_members.role = owner / admin / researcher / viewer): every person who
--     signs up founds their own company and is its owner; this stays as it is and now reads "founder" in the app;
--   * the role on the PLATFORM: one owner (the person who runs Affinix) and any number of platform admins
--     (moderators). That is what profiles.is_owner / is_admin mean.
--
-- A hole that is closed here: "profiles: update own" (0002) lets a signed-in user update ANY column of their own
-- row, so anyone could have set is_admin = true on themselves from the browser. A trigger now refuses a change of
-- is_admin / is_owner from the API roles; only the database owner (migrations, SQL editor) and the SECURITY DEFINER
-- functions below can change them.
--
-- The owner is given by USERNAME, once, at the end of this file: bootstrap_platform_owner('nu4lan').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. the flags
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists is_owner boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_owner_is_admin') then
    alter table profiles add constraint profiles_owner_is_admin check (not is_owner or is_admin);
  end if;
end $$;

-- at most one owner, ever
create unique index if not exists profiles_single_owner on profiles ((true)) where is_owner;

create or replace function profiles_guard_platform_flags()
returns trigger
language plpgsql
as $$
begin
  if (new.is_admin is distinct from old.is_admin or new.is_owner is distinct from old.is_owner)
     and current_user in ('authenticated', 'anon') then
    raise exception 'platform_flags_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_platform_flags on profiles;
create trigger profiles_guard_platform_flags
  before update on profiles
  for each row execute function profiles_guard_platform_flags();

-- ----------------------------------------------------------------------------
-- 2. what other people may see: only that someone is the owner / an admin
-- ----------------------------------------------------------------------------
create or replace view profiles_public as
  select id, full_name, username, avatar_url, bio, role_title,
         case when is_owner then 'owner' when is_admin then 'admin' else null end as platform_role
  from profiles;

grant select on profiles_public to authenticated;

drop function if exists get_public_profile(text);
create function get_public_profile(p_username text)
returns table (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  role_title text,
  bio text,
  research_interests text[],
  org_name text,
  platform_role text
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
    ) as org_name,
    case when p.is_owner then 'owner' when p.is_admin then 'admin' else null end as platform_role
  from profiles p
  where lower(p.username) = lower(p_username) and p.public_profile_enabled = true;
$$;

grant execute on function get_public_profile(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. the log of what admins did
-- ----------------------------------------------------------------------------
create table if not exists admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  target_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on admin_audit (created_at desc);

-- no policies at all: nobody reads or writes it directly, only the functions below
alter table admin_audit enable row level security;

create or replace function _admin_log(p_action text, p_target uuid, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer set search_path = public
as $$
  insert into admin_audit (actor_id, action, target_id, meta) values (auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb));
$$;
revoke all on function _admin_log(text, uuid, jsonb) from public, anon, authenticated;

-- A post or a comment removed by somebody other than its author is a moderation action: it is logged by the database
-- itself, whichever screen the admin used (RLS lets only the author or an admin delete).
create or replace function audit_content_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- comments that go away together with their post are part of the post's removal, already logged once
  if tg_table_name = 'post_comments' then
    if not exists (select 1 from posts where id = (to_jsonb(old) ->> 'post_id')::uuid) then
      return old;
    end if;
  end if;
  if auth.uid() is not null and auth.uid() <> old.author_id then
    insert into admin_audit (actor_id, action, target_id, meta)
    values (auth.uid(), tg_argv[0], old.author_id, jsonb_build_object('id', old.id, 'excerpt', left(old.body, 140)));
  end if;
  return old;
end;
$$;

drop trigger if exists posts_audit_delete on posts;
create trigger posts_audit_delete after delete on posts
  for each row execute function audit_content_delete('post_removed');
drop trigger if exists comments_audit_delete on post_comments;
create trigger comments_audit_delete after delete on post_comments
  for each row execute function audit_content_delete('comment_removed');

-- ----------------------------------------------------------------------------
-- 4. the admin panel's data (admins only; the owner is an admin too)
-- ----------------------------------------------------------------------------
create or replace function _require_admin()
returns void
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null or not coalesce((select is_admin from profiles where id = auth.uid()), false) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;
revoke all on function _require_admin() from public, anon, authenticated;

-- a count that is 0 instead of an error when an optional part of the app (a later migration) is not there yet
create or replace function _admin_count(p_sql text)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare n bigint;
begin
  execute p_sql into n;
  return coalesce(n, 0);
exception when undefined_table or undefined_column then
  return 0;
end;
$$;
revoke all on function _admin_count(text) from public, anon, authenticated;

create or replace function admin_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform _require_admin();
  return jsonb_build_object(
    'users', _admin_count('select count(*) from profiles'),
    'newUsers7d', _admin_count($q$select count(*) from profiles where created_at > now() - interval '7 days'$q$),
    'active7d', _admin_count($q$select count(*) from (
        select author_id as u from posts where created_at > now() - interval '7 days'
        union select author_id from post_comments where created_at > now() - interval '7 days'
        union select sender_id from messages where created_at > now() - interval '7 days'
        union select user_id from arena_daily where day >= (now() at time zone 'utc')::date - 6
      ) x$q$),
    'admins', _admin_count('select count(*) from profiles where is_admin'),
    'companies', _admin_count('select count(*) from organizations'),
    'experiments', _admin_count('select count(*) from experiments'),
    'responses', _admin_count('select count(*) from responses'),
    'posts', _admin_count('select count(*) from posts'),
    'comments', _admin_count('select count(*) from post_comments'),
    'messages7d', _admin_count($q$select count(*) from messages where created_at > now() - interval '7 days'$q$),
    'friendships', _admin_count($q$select count(*) from friendships where status = 'accepted'$q$),
    'arenaPlayers', _admin_count('select count(*) from arena_profiles where votes_total > 0'),
    'testsOpen', _admin_count($q$select count(*) from arena_tests where status = 'open'$q$),
    'testsFlagged', _admin_count($q$select count(*) from arena_tests where status = 'flagged'$q$)
  );
end;
$$;

create or replace function admin_users(p_query text default '', p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid, full_name text, username text, email text, avatar_url text,
  is_admin boolean, is_owner boolean, created_at timestamptz,
  org_name text, org_role text, posts bigint, xp bigint, total bigint
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
  off int := greatest(coalesce(p_offset, 0), 0);
  base text;
  xp_expr text;
begin
  perform _require_admin();
  base := $sql$
    select p.id, p.full_name, p.username, p.email, p.avatar_url, p.is_admin, p.is_owner, p.created_at,
      (select o.name from organization_members om join organizations o on o.id = om.organization_id where om.user_id = p.id order by om.created_at limit 1),
      (select om.role::text from organization_members om where om.user_id = p.id order by om.created_at limit 1),
      (select count(*) from posts x where x.author_id = p.id),
      %s,
      count(*) over ()
    from profiles p
    where $1 = '' or strpos(lower(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '') || ' ' || coalesce(p.email, '')), $1) > 0
    order by p.is_owner desc, p.is_admin desc, p.created_at desc
    limit $2 offset $3
  $sql$;
  xp_expr := '(select a.xp_total from arena_profiles a where a.user_id = p.id)::bigint';
  begin
    return query execute format(base, xp_expr) using q, lim, off;
  exception when undefined_table then
    return query execute format(base, '0::bigint') using q, lim, off;
  end;
end;
$$;

-- who may do what: only the owner makes or removes admins; the owner cannot be changed by anyone
create or replace function admin_set_admin(p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t profiles;
begin
  if me is null or not coalesce((select is_owner from profiles where id = me), false) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select * into t from profiles where id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
  if t.is_owner then
    raise exception 'is_owner';
  end if;
  if t.is_admin = coalesce(p_admin, false) then
    return;
  end if;
  update profiles set is_admin = coalesce(p_admin, false) where id = p_user;
  perform _admin_log(case when p_admin then 'admin_granted' else 'admin_revoked' end, p_user, '{}'::jsonb);
end;
$$;

create or replace function admin_audit_list(p_limit integer default 50)
returns table (
  id bigint, action text, created_at timestamptz,
  actor_id uuid, actor_name text, target_id uuid, target_name text, meta jsonb
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform _require_admin();
  return query
    select a.id, a.action, a.created_at, a.actor_id,
           coalesce(ap.full_name, ap.username, ap.email), a.target_id,
           coalesce(tp.full_name, tp.username, tp.email), a.meta
    from admin_audit a
    left join profiles ap on ap.id = a.actor_id
    left join profiles tp on tp.id = a.target_id
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- the person who runs the platform. Callable only from migrations / the SQL editor.
create or replace function bootstrap_platform_owner(p_username text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  target uuid;
begin
  if exists (select 1 from profiles where is_owner) then
    return 'owner already set';
  end if;
  select id into target from profiles where lower(username) = lower(p_username);
  if target is null then
    return 'no such username';
  end if;
  update profiles set is_admin = true, is_owner = true where id = target;
  insert into admin_audit (actor_id, action, target_id) values (null, 'owner_set', target);
  return 'owner set';
end;
$$;
revoke all on function bootstrap_platform_owner(text) from public, anon, authenticated;

revoke all on function admin_overview() from public, anon;
revoke all on function admin_users(text, integer, integer) from public, anon;
revoke all on function admin_set_admin(uuid, boolean) from public, anon;
revoke all on function admin_audit_list(integer) from public, anon;
grant execute on function admin_overview() to authenticated;
grant execute on function admin_users(text, integer, integer) to authenticated;
grant execute on function admin_set_admin(uuid, boolean) to authenticated;
grant execute on function admin_audit_list(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. the owner: the account behind decisionos.app/u/nu4lan
-- ----------------------------------------------------------------------------
do $$ begin perform bootstrap_platform_owner('nu4lan'); end $$;

notify pgrst, 'reload schema';
