-- Security fix 0035: nobody can write through profiles_public, the anonymous role has no table rights, buckets only take images.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function t.raises(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000d0001', 'door@x');
insert into profiles (id) values ('00000000-0000-0000-0000-0000000d0001') on conflict (id) do nothing;
update profiles set full_name = 'Door Victim' where id = '00000000-0000-0000-0000-0000000d0001';

do $$
declare v uuid := '00000000-0000-0000-0000-0000000d0001';
begin
  set local role anon;
  perform t.ok(t.raises(format($q$update profiles_public set full_name = 'DEFACED' where id = '%s'$q$, v)) like '%permission denied%', 'anonymous cannot deface a profile through the view');
  perform t.ok(t.raises(format($q$delete from profiles_public where id = '%s'$q$, v)) like '%permission denied%', 'anonymous cannot delete a profile through the view');
  perform t.ok(t.raises($q$select * from profiles_public$q$) like '%permission denied%', 'anonymous cannot even read the view');
  reset role;

  set local role authenticated;
  perform t.ok(t.raises(format($q$update profiles_public set full_name = 'DEFACED' where id = '%s'$q$, v)) like '%permission denied%', 'a signed-in person cannot deface a profile through the view');
  perform t.ok(t.raises(format($q$delete from profiles_public where id = '%s'$q$, v)) like '%permission denied%', 'a signed-in person cannot delete a profile through the view');
  perform t.ok(t.raises($q$select count(*) from profiles_public$q$) is null, 'a signed-in person can still read the view');
  perform t.ok(t.raises($q$truncate messages$q$) like '%permission denied%', 'a signed-in person cannot truncate a table');
  reset role;

  perform t.ok((select full_name from profiles where id = v) = 'Door Victim', 'the profile is untouched');
  perform t.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), 'the anonymous role has no right on any table or view of the app');
  perform t.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')), 'signed-in people have no TRUNCATE / REFERENCES / TRIGGER on any table');
  perform t.ok((select bool_and(allowed_mime_types is not null and file_size_limit is not null and not 'text/html' = any (allowed_mime_types) and not 'image/svg+xml' = any (allowed_mime_types))
                from storage.buckets where id in ('avatars', 'post-images', 'variant-assets', 'message-images', 'arena-tests')), 'every picture bucket has a size limit and only image types (no HTML, no SVG)');

  -- spam brakes
  for i in 1..10 loop insert into posts (author_id, body) values (v, 'post ' || i); end loop;
  perform t.ok(t.raises(format($q$insert into posts (author_id, body) values ('%s', 'one too many')$q$, v)) like '%rate_limited%', 'the 11th post within 10 minutes is refused');
  perform t.ok((select count(*) = 10 from posts where author_id = v), 'exactly 10 posts were stored');
  declare p0 uuid := (select id from posts where author_id = v limit 1);
  begin
    for i in 1..40 loop insert into post_comments (post_id, author_id, body) values (p0, v, 'c ' || i); end loop;
    perform t.ok(t.raises(format($q$insert into post_comments (post_id, author_id, body) values ('%s', '%s', 'too many')$q$, p0, v)) like '%rate_limited%', 'the 41st comment within 10 minutes is refused');
  end;
end $$;
