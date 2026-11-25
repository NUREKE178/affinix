-- ============================================================================
-- Affinix: chat hardening (the audit of the messenger)
--
--   1. Block a person (like WhatsApp / Telegram): they cannot message you, react, or send you a friend request; the friendship ends.
--      The blocked person is not told: they only see that you are no longer friends.
--   2. Flood protection: at most 20 messages in 10 seconds and 500 in an hour per sender (a script cannot spam a friend or fill the table).
--   3. The chat picture bucket accepts only JPEG / PNG / WebP up to 2 MB (before, any file of any size could be uploaded), and only
--      between people who are still friends.
--   4. One push per message: messages.push_sent_at is claimed by the notify-message function, so the sender can no longer replay it.
-- Safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. blocks
-- ----------------------------------------------------------------------------
create table if not exists user_blocks (
  blocker_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

alter table user_blocks enable row level security;
-- you see only who YOU blocked; nobody can learn that they were blocked from this table
drop policy if exists user_blocks_select_own on user_blocks;
create policy user_blocks_select_own on user_blocks for select to authenticated using (blocker_id = auth.uid());
revoke all on user_blocks from anon, authenticated;
grant select on user_blocks to authenticated;

-- "is there a block between these two, either way?" (SECURITY DEFINER so a policy can ask it without reading the other person's list)
create or replace function is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
revoke execute on function is_blocked_between(uuid, uuid) from public, anon;
grant execute on function is_blocked_between(uuid, uuid) to authenticated;

create or replace function block_user(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_found'; end if;
  if p_user_id is null or p_user_id = me or not exists (select 1 from profiles where id = p_user_id) then raise exception 'not_found'; end if;
  insert into user_blocks (blocker_id, blocked_id) values (me, p_user_id) on conflict do nothing;
  -- the friendship (or a pending request either way) ends; the old messages stay
  delete from friendships where user_min = least(me, p_user_id) and user_max = greatest(me, p_user_id);
end $$;

create or replace function unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_found'; end if;
  delete from user_blocks where blocker_id = auth.uid() and blocked_id = p_user_id;
end $$;

revoke execute on function block_user(uuid) from public, anon;
revoke execute on function unblock_user(uuid) from public, anon;
grant execute on function block_user(uuid) to authenticated;
grant execute on function unblock_user(uuid) to authenticated;

-- a blocked person cannot send a friend request (through the function or by a raw insert); the answer does not reveal the block
drop policy if exists friendships_insert_own on friendships;
create policy friendships_insert_own on friendships
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending' and not is_blocked_between(requester_id, addressee_id));

create or replace function send_friend_request(target_id uuid)
returns friendships
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing friendships;
  result friendships;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if target_id = me then
    raise exception 'You cannot send a friend request to yourself.';
  end if;
  if not exists (select 1 from profiles where id = target_id) or is_blocked_between(me, target_id) then
    raise exception 'User not found.';
  end if;

  select * into existing from friendships
    where user_min = least(me, target_id) and user_max = greatest(me, target_id);

  if found then
    if existing.status = 'accepted' then
      raise exception 'You are already friends.';
    elsif existing.requester_id = me then
      raise exception 'Friend request already sent.';
    else
      update friendships set status = 'accepted', responded_at = now()
        where id = existing.id
        returning * into result;
      insert into notifications (recipient_id, actor_id, type)
        values (existing.requester_id, me, 'friend_accept');
      return result;
    end if;
  end if;

  insert into friendships (requester_id, addressee_id, status)
    values (me, target_id, 'pending')
    returning * into result;
  insert into notifications (recipient_id, actor_id, type)
    values (target_id, me, 'friend_request');
  return result;
end;
$$;

-- messages: also refuse while a block exists (the friendship is gone anyway; this is the second lock)
drop policy if exists messages_insert_member on messages;
create policy messages_insert_member on messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and read_at is null
    and (reply_to_id is null or message_in_conversation(reply_to_id, conversation_id))
    and exists (
      select 1
      from conversations c
      join friendships f on f.user_min = c.user_a and f.user_max = c.user_b and f.status = 'accepted'
      where c.id = messages.conversation_id and auth.uid() in (c.user_a, c.user_b)
        and not is_blocked_between(c.user_a, c.user_b)
    )
  );

-- ----------------------------------------------------------------------------
-- 2. flood protection
-- ----------------------------------------------------------------------------
create index if not exists messages_sender_created_idx on messages (sender_id, created_at desc);

create or replace function messages_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (select count(*) from messages where sender_id = new.sender_id and created_at > clock_timestamp() - interval '10 seconds') >= 20
     or (select count(*) from messages where sender_id = new.sender_id and created_at > clock_timestamp() - interval '1 hour') >= 500 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return new;
end $$;

drop trigger if exists messages_rate_limit on messages;
create trigger messages_rate_limit before insert on messages for each row execute function messages_rate_limit();

-- ----------------------------------------------------------------------------
-- 3. the picture bucket
-- ----------------------------------------------------------------------------
update storage.buckets
  set file_size_limit = 2 * 1024 * 1024, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'message-images';

drop policy if exists "message-images: conversation members can upload" on storage.objects;
create policy "message-images: conversation members can upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from conversations c
      join friendships f on f.user_min = c.user_a and f.user_max = c.user_b and f.status = 'accepted'
      where c.id::text = (storage.foldername(name))[1]
        and auth.uid() in (c.user_a, c.user_b)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. one push per message
-- ----------------------------------------------------------------------------
alter table messages add column if not exists push_sent_at timestamptz;

notify pgrst, 'reload schema';
