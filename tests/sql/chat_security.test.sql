-- Chat hardening (migration 0031): blocks, flood limit, picture bucket, one push per message. Own people; runs on tests/sql/run.sh's database.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'c1@x'), ('00000000-0000-0000-0000-0000000000e2', 'c2@x'), ('00000000-0000-0000-0000-0000000000e3', 'c3@x');
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000e1', 'Chat One'), ('00000000-0000-0000-0000-0000000000e2', 'Chat Two'), ('00000000-0000-0000-0000-0000000000e3', 'Chat Three') on conflict (id) do nothing;
-- e1 and e2 are friends with a conversation; e3 is a stranger
insert into friendships (requester_id, addressee_id, status) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'accepted');
insert into conversations (id, user_a, user_b) values ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');

do $$
declare e1 uuid := '00000000-0000-0000-0000-0000000000e1'; e2 uuid := '00000000-0000-0000-0000-0000000000e2'; e3 uuid := '00000000-0000-0000-0000-0000000000e3';
        c uuid := '00000000-0000-0000-0000-00000000cc01'; n int;
begin
  -- ---- the picture bucket
  perform t.ok((select file_size_limit = 2097152 and allowed_mime_types @> array['image/webp','image/jpeg','image/png'] and cardinality(allowed_mime_types) = 3 from storage.buckets where id = 'message-images'),
               'bucket: pictures only (jpeg / png / webp), 2 MB at most');

  -- ---- flood protection (as the sender; the trigger fires for everyone)
  for i in 1..20 loop insert into messages (conversation_id, sender_id, body) values (c, e1, 'm' || i); end loop;
  perform t.ok(t.raises(format($q$insert into messages (conversation_id, sender_id, body) values ('%s', '%s', 'too many')$q$, c, e1)) like '%rate_limited%', 'flood: the 21st message within 10 seconds is refused');
  perform t.ok((select count(*) = 20 from messages where sender_id = e1), 'flood: exactly 20 were stored');
  perform t.ok(t.raises(format($q$insert into messages (conversation_id, sender_id, body) values ('%s', '%s', 'hi')$q$, c, e2)) is null, 'flood: the other person is not affected');
  delete from messages where conversation_id = c;
  perform t.ok((select count(*) = 0 from information_schema.columns where table_name = 'messages' and column_name = 'push_sent_at') is false, 'push_sent_at exists');

  -- ---- blocks
  perform t.as_user(e3);
  perform t.ok(t.raises(format($q$select block_user('%s')$q$, e3)) like '%not_found%', 'block: you cannot block yourself');
  perform t.as_user(null);
  perform t.ok(t.raises(format($q$select block_user('%s')$q$, e1)) like '%not_found%', 'block: signed out is refused');

  perform t.as_user(e1);
  perform block_user(e2);
  perform t.ok(exists (select 1 from user_blocks where blocker_id = e1 and blocked_id = e2), 'block: saved');
  perform t.ok(not exists (select 1 from friendships where user_min = least(e1, e2) and user_max = greatest(e1, e2)), 'block: the friendship ends');
  perform t.ok(exists (select 1 from conversations where id = c), 'block: the conversation and its history stay');
  perform block_user(e2);
  perform t.ok((select count(*) = 1 from user_blocks), 'block: twice is still one row');

  -- the blocked person: cannot message, cannot react, cannot ask to be friends again, and cannot see the block
  perform t.as_user(e2);
  perform t.ok(t.raises(format($q$select send_friend_request('%s')$q$, e1)) like '%User not found%', 'blocked: a friend request is refused and does not say why');
  set local role authenticated;
  perform t.ok(t.raises(format($q$insert into messages (conversation_id, sender_id, body) values ('%s', '%s', 'hello?')$q$, c, e2)) like '%row-level security%', 'blocked: cannot send a message');
  perform t.ok(t.raises(format($q$insert into friendships (requester_id, addressee_id, status) values ('%s', '%s', 'pending')$q$, e2, e1)) like '%row-level security%', 'blocked: a raw friend-request insert is refused too');
  perform t.ok((select count(*) = 0 from user_blocks), 'blocked: cannot see the block');
  reset role;
  perform t.ok(t.raises(format($q$select react_to_message('%s', '👍')$q$, gen_random_uuid())) like '%not_found%', 'blocked: reacting to nothing is just not_found');

  -- unblocking does not bring the friendship back; a new request works again
  perform t.as_user(e1);
  perform unblock_user(e2);
  perform t.ok((select count(*) = 0 from user_blocks), 'unblock: removed');
  perform t.ok(not exists (select 1 from friendships where user_min = least(e1, e2) and user_max = greatest(e1, e2)), 'unblock: the friendship is not restored by itself');
  perform t.as_user(e2);
  perform t.ok((select status from send_friend_request(e1)) = 'pending', 'after unblock: a new friend request goes through');
end $$;
