-- Web Push subscriptions (migration 0030). Runs on the database tests/sql/run.sh prepares; uses its own people.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function t.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false) $$;
create or replace function t.raises(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'p1@x'), ('00000000-0000-0000-0000-0000000000d2', 'p2@x');
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000d1', 'Push One'), ('00000000-0000-0000-0000-0000000000d2', 'Push Two') on conflict (id) do nothing;

do $$
declare u1 uuid := '00000000-0000-0000-0000-0000000000d1'; u2 uuid := '00000000-0000-0000-0000-0000000000d2';
        ep text := 'https://push.example.com/send/abcdefghijklmnop'; k text := 'BPabcdefghijklmnopqrstuvwxyz0123456789';
begin
  perform t.as_user(null);
  perform t.ok(t.raises(format($q$select push_subscribe('%s', '%s', 'authsecret123', 'ua')$q$, ep, k)) like '%not_authenticated%', 'signed out: cannot subscribe');

  perform t.as_user(u1);
  perform push_subscribe(ep, k, 'authsecret123', 'Phone A');
  perform t.ok((select count(*) = 1 from push_subscriptions where user_id = u1 and endpoint = ep), 'subscribe: one device saved');
  perform push_subscribe(ep, k, 'authsecret123', 'Phone A');
  perform t.ok((select count(*) = 1 from push_subscriptions), 'subscribe twice: still one row');
  perform t.ok(t.raises(format($q$select push_subscribe('short', '%s', 'authsecret123')$q$, k)) like '%violates check%', 'a bogus endpoint is refused');

  -- RLS: the table is read-only for people, and only their own rows
  set local role authenticated;
  perform t.ok((select count(*) = 1 from push_subscriptions), 'a person sees their own device');
  perform t.ok(t.raises(format($q$insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('%s', 'https://push.example.com/send/another-endpoint-1', '%s', 'authsecret123')$q$, u1, k)) like '%permission denied%', 'no direct insert');
  perform t.ok(t.raises(format($q$delete from push_subscriptions where user_id = '%s'$q$, u1)) like '%permission denied%', 'no direct delete');
  reset role;

  perform t.as_user(u2);
  set local role authenticated;
  perform t.ok((select count(*) = 0 from push_subscriptions), 'another person sees nothing of it');
  reset role;
  perform t.ok(t.raises(format($q$select push_unsubscribe('%s')$q$, ep)) is null, 'unsubscribe of a device that is not yours: no error');
  perform t.ok((select count(*) = 1 from push_subscriptions where user_id = u1), '... and it removes nothing');

  -- the same phone, a different person: the device moves to them
  perform push_subscribe(ep, k, 'authsecret456', 'Phone A');
  perform t.ok((select user_id = u2 and auth = 'authsecret456' from push_subscriptions where endpoint = ep) and (select count(*) = 1 from push_subscriptions), 'the device moves to whoever signs in on it');

  perform push_unsubscribe(ep);
  perform t.ok((select count(*) = 0 from push_subscriptions), 'unsubscribe removes it');
end $$;
