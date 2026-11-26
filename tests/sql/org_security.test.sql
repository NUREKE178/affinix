-- Security fix 0034: nobody who is not an owner / admin of an organisation can add members to it, and anonymous callers cannot call the function at all.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function t.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false) $$;
create or replace function t.raises(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000fa001', 'owner@x'), ('00000000-0000-0000-0000-0000000fa002', 'attacker@x'), ('00000000-0000-0000-0000-0000000fa003', 'friend@x');
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-0000000fa001', 'Owner'), ('00000000-0000-0000-0000-0000000fa002', 'Attacker'), ('00000000-0000-0000-0000-0000000fa003', 'Friend') on conflict (id) do nothing;
insert into organizations (id, name, slug, created_by) values ('00000000-0000-0000-0000-0000000fa0a0', 'Secure Org', 'secure-org', '00000000-0000-0000-0000-0000000fa001');
insert into organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000fa0a0', '00000000-0000-0000-0000-0000000fa001', 'owner');

do $$
declare o uuid := '00000000-0000-0000-0000-0000000fa0a0'; owner uuid := '00000000-0000-0000-0000-0000000fa001'; atk uuid := '00000000-0000-0000-0000-0000000fa002';
begin
  -- an anonymous visitor (the public key) cannot call it at all
  set local role anon;
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'attacker@x', 'admin')$q$, o)) like '%permission denied%', 'anonymous: the function cannot be called');
  reset role;

  -- a signed-in stranger is refused, and learns nothing about other emails
  perform t.as_user(atk);
  set local role authenticated;
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'attacker@x', 'admin')$q$, o)) like '%Only an owner or admin%', 'a stranger cannot add themselves as admin');
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'nobody-registered@x', 'viewer')$q$, o)) like '%Only an owner or admin%', 'a stranger cannot find out whether an email has an account');
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'friend@x', 'viewer')$q$, gen_random_uuid())) like '%Only an owner or admin%', 'a made-up organisation id changes nothing');
  reset role;
  perform t.ok((select count(*) = 1 from organization_members where organization_id = o), 'after the attempts the organisation still has only its owner');

  -- the owner can
  perform t.as_user(owner);
  set local role authenticated;
  perform t.ok((select role from add_member_by_email(o, 'friend@x', 'viewer')) = 'viewer', 'the owner can add a member');
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'attacker@x', 'owner')$q$, o)) like '%owner role%', 'nobody can be made a second owner');
  reset role;
  -- a plain viewer cannot add others
  perform t.as_user('00000000-0000-0000-0000-0000000fa003');
  set local role authenticated;
  perform t.ok(t.raises(format($q$select add_member_by_email('%s', 'attacker@x', 'viewer')$q$, o)) like '%Only an owner or admin%', 'a viewer cannot add members');
  reset role;
end $$;
