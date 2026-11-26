-- Clear chat (migration 0032): hides the history for the person who cleared it, only. Own people; runs on tests/sql/run.sh's database.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'k1@x'), ('00000000-0000-0000-0000-0000000000f2', 'k2@x'), ('00000000-0000-0000-0000-0000000000f3', 'k3@x');
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000f1', 'Clear One'), ('00000000-0000-0000-0000-0000000000f2', 'Clear Two'), ('00000000-0000-0000-0000-0000000000f3', 'Clear Three') on conflict (id) do nothing;
insert into friendships (requester_id, addressee_id, status) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'accepted');
insert into conversations (id, user_a, user_b) values ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');

do $$
declare f1 uuid := '00000000-0000-0000-0000-0000000000f1'; f2 uuid := '00000000-0000-0000-0000-0000000000f2'; f3 uuid := '00000000-0000-0000-0000-0000000000f3';
        c uuid := '00000000-0000-0000-0000-00000000dd01';
begin
  insert into messages (conversation_id, sender_id, body) values (c, f1, 'old one'), (c, f2, 'old two'), (c, f2, 'old three');

  perform t.as_user(f1);
  set local role authenticated;
  perform t.ok((select count(*) = 3 from messages where conversation_id = c), 'before: both people see all 3 messages');
  perform t.ok((select unread from my_unread_counts() where conversation_id = c) = 2, 'before: 2 unread for the first person');
  reset role;

  perform t.ok(t.raises(format($q$select clear_conversation('%s')$q$, c)) is null, 'clearing is allowed for a member');
  perform clear_conversation(c);
  perform t.as_user(f3);
  perform t.ok(t.raises(format($q$select clear_conversation('%s')$q$, c)) like '%not_found%', 'a stranger cannot clear it');
  perform t.as_user(null);
  perform t.ok(t.raises(format($q$select clear_conversation('%s')$q$, c)) like '%not_found%', 'signed out cannot clear it');

  perform t.as_user(f1);
  set local role authenticated;
  perform t.ok((select count(*) = 0 from messages where conversation_id = c), 'after: the person who cleared sees nothing');
  perform t.ok(not exists (select 1 from my_unread_counts() where conversation_id = c), 'after: and nothing is unread');
  perform t.ok((select count(*) = 0 from search_messages('old', 10)), 'after: search finds nothing of the old history');
  reset role;

  perform t.as_user(f2);
  set local role authenticated;
  perform t.ok((select count(*) = 3 from messages where conversation_id = c), 'the other person still sees all 3');
  reset role;

  -- new messages after clearing show up again, for both
  insert into messages (conversation_id, sender_id, body) values (c, f2, 'new one');
  perform t.as_user(f1);
  set local role authenticated;
  perform t.ok((select count(*) = 1 and min(body) = 'new one' from messages where conversation_id = c), 'a message after clearing is visible again, alone');
  reset role;
  perform t.ok((select count(*) = 1 from conversations where id = c), 'the conversation itself stays');

  -- clearing twice just moves the mark; the other person keeps their own mark (none)
  perform t.as_user(f1);
  perform clear_conversation(c);
  perform t.ok((select count(*) = 1 from conversation_prefs where conversation_id = c and user_id = f1 and cleared_at is not null), 'one mark per person per conversation');
  perform t.ok(not exists (select 1 from conversation_prefs where conversation_id = c and user_id = f2), 'the other person has no mark');
end $$;
