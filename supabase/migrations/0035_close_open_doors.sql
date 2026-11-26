-- ============================================================================
-- Affinix: SECURITY FIX -- doors that were open to everybody
--
-- 1. THE VIEW profiles_public (0011) is a plain, automatically updatable view that runs with its owner's rights (it skips row security), and it was
--    granted the default "everything" to the anonymous (public key) role and to every signed-in person. So any visitor could rename (deface) or
--    DELETE any person's profile through it:   delete from profiles_public where id = '...'   (the delete cascades to everything that person owns).
--    Proved on a test database before this fix. Now: nobody can write through it; only signed-in people can read it.
-- 2. THE ANONYMOUS ROLE gets no rights on any table or sequence of the app (data is reached through signed-in access, the edge functions and
--    the few public functions, not through direct table access), and nobody signed in keeps TRUNCATE / REFERENCES / TRIGGER (row security does not apply
--    to TRUNCATE). New tables made later start without those rights too.
-- 3. THE PICTURE BUCKETS avatars, post-images and variant-assets accepted any file of any size (the limits lived only in the browser): now images only
--    (JPEG / PNG / WebP, GIF for the last two) and 3 / 5 / 5 MB, enforced by the storage server.
-- Safe to run twice.
-- ============================================================================

-- 1. the view
revoke all on table profiles_public from anon, public;
revoke insert, update, delete, truncate, references, trigger on table profiles_public from authenticated;
grant select on table profiles_public to authenticated;

-- 2. no direct table access for the anonymous role; no TRUNCATE for signed-in people
do $$
declare r record;
begin
  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S')
  loop
    execute format('revoke all on %s public.%I from anon', case when r.relkind = 'S' then 'sequence' else 'table' end, r.relname);
    if r.relkind <> 'S' then
      execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.relname);
    end if;
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- 3. the picture buckets
update storage.buckets set file_size_limit = 3 * 1024 * 1024, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'avatars';
update storage.buckets set file_size_limit = 5 * 1024 * 1024, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'] where id in ('post-images', 'variant-assets');

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 4. spam brakes: nobody can flood the feed, the comments, the notifications of someone else or the friend requests
--    (the chat already has its own limit, 0031). One small trigger per table; the limits are generous for a real person.
-- ----------------------------------------------------------------------------
create or replace function _flood_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  who uuid;
  n bigint;
begin
  -- TG_ARGV: [0] the column that holds the author, [1] seconds of the window, [2] how many are allowed in it
  execute format('select ($1).%I', tg_argv[0]) into who using new;
  if who is null then return new; end if;
  execute format('select count(*) from %I.%I where %I = $1 and created_at > now() - make_interval(secs => $2)', tg_table_schema, tg_table_name, tg_argv[0])
    into n using who, (tg_argv[1])::int;
  if n >= (tg_argv[2])::int then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return new;
end $$;

revoke execute on function _flood_guard() from public, anon, authenticated;

drop trigger if exists posts_flood_guard on posts;
create trigger posts_flood_guard before insert on posts for each row execute function _flood_guard('author_id', '600', '10');
drop trigger if exists post_comments_flood_guard on post_comments;
create trigger post_comments_flood_guard before insert on post_comments for each row execute function _flood_guard('author_id', '600', '40');
drop trigger if exists notifications_flood_guard on notifications;
create trigger notifications_flood_guard before insert on notifications for each row execute function _flood_guard('actor_id', '600', '80');
drop trigger if exists friendships_flood_guard on friendships;
create trigger friendships_flood_guard before insert on friendships for each row execute function _flood_guard('requester_id', '3600', '30');
