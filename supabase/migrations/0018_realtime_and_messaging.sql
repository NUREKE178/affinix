-- ============================================================================
-- Affinix — live updates everywhere + 1:1 messaging between friends
--
-- Two things in one migration, because they share one mechanism (Supabase
-- Realtime's postgres_changes stream, which only carries tables that belong
-- to the `supabase_realtime` publication):
--
--   1. LIVE UPDATES. Adds the tables the UI should react to without a page
--      refresh to the publication: friendships (request / accept / decline),
--      posts + post_likes + post_comments (the feed), participant_sessions +
--      responses (experiment results).  `notifications` is added too, in
--      case 0015 was never applied -- the add is idempotent.
--
--      Realtime enforces RLS per subscriber for INSERT/UPDATE, so nobody
--      receives a row they couldn't already SELECT (e.g. results only reach
--      members of the experiment's organization). DELETE events are the one
--      exception Supabase documents: they carry only the primary key and
--      aren't RLS-filtered, so the client treats a DELETE purely as "reload".
--
--   2. MESSAGING. conversations + messages, WhatsApp/Telegram-style:
--        * one conversation per PAIR of users (user_a < user_b enforced, so
--          there can never be two threads between the same two people);
--        * a conversation can only be CREATED between accepted friends, and a
--          message can only be SENT while they are still friends. History
--          stays readable after an unfriend (like blocking in most
--          messengers keeps old chats), it just can't grow.
--        * read receipts: messages.read_at is set only by the recipient,
--          through mark_conversation_read(). There is deliberately no UPDATE
--          policy, so nobody can edit a message body or fake a read receipt.
--        * conversations.last_message_* is maintained by a trigger so the
--          chat list can sort/preview with one query.
--        * online status and "typing…" are NOT stored here: they ride on
--          Realtime Presence in the browser (lib/messagesStore.js).
--
-- Safe to run more than once (tables/policies/functions are re-created
-- idempotently), and it runs as one transaction in the SQL Editor, so a
-- failure leaves nothing half-applied.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- conversations
-- ----------------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversations_ordered_pair check (user_a < user_b),
  constraint conversations_unique_pair unique (user_a, user_b)
);

create index if not exists conversations_user_a_idx on conversations (user_a, last_message_at desc);
create index if not exists conversations_user_b_idx on conversations (user_b, last_message_at desc);

alter table conversations enable row level security;

-- Only the two people in it. No insert/update/delete policy on purpose:
-- creation goes through get_or_create_conversation() (which checks the
-- friendship), and last_message_* is written by the trigger below.
drop policy if exists conversations_select_own on conversations;
create policy conversations_select_own on conversations
  for select to authenticated
  using (auth.uid() in (user_a, user_b));


-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_conversation_created_idx on messages (conversation_id, created_at desc);
create index if not exists messages_unread_idx on messages (conversation_id) where read_at is null;

alter table messages enable row level security;

drop policy if exists messages_select_member on messages;
create policy messages_select_member on messages
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id and auth.uid() in (c.user_a, c.user_b)
  ));

-- sender must be the caller, must be a member of the conversation, and the
-- two must (still) be accepted friends. conversations.user_a < user_b always
-- holds (check constraint), which is exactly how friendships.user_min/user_max
-- are defined, so the pair can be compared directly.
drop policy if exists messages_insert_member on messages;
create policy messages_insert_member on messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and read_at is null
    and exists (
      select 1
      from conversations c
      join friendships f on f.user_min = c.user_a and f.user_max = c.user_b and f.status = 'accepted'
      where c.id = messages.conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
  );

-- The client may pick the message id (so an optimistic bubble can be matched
-- with its realtime echo), but never the timestamp or the read state.
create or replace function messages_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := clock_timestamp();
  new.read_at := null;
  new.body := btrim(new.body);
  return new;
end;
$$;

drop trigger if exists messages_before_insert on messages;
create trigger messages_before_insert
  before insert on messages
  for each row execute function messages_before_insert();

-- Keeps the chat list's preview/sort key current. SECURITY DEFINER because
-- conversations has no UPDATE policy for clients.
create or replace function messages_after_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update conversations
    set last_message_at = new.created_at,
        last_message_body = left(new.body, 140),
        last_message_sender_id = new.sender_id
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_after_insert on messages;
create trigger messages_after_insert
  after insert on messages
  for each row execute function messages_after_insert();


-- ----------------------------------------------------------------------------
-- functions the client calls
-- ----------------------------------------------------------------------------

-- Open (or create) the thread with `other_id`. Creating needs an accepted
-- friendship; an existing thread is always returned so old history stays
-- reachable even after an unfriend.
create or replace function get_or_create_conversation(other_id uuid)
returns conversations
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  conv conversations;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if other_id is null or other_id = me then
    raise exception 'You cannot message yourself.';
  end if;

  a := least(me, other_id);
  b := greatest(me, other_id);

  select * into conv from conversations where user_a = a and user_b = b;
  if found then
    return conv;
  end if;

  if not exists (
    select 1 from friendships where user_min = a and user_max = b and status = 'accepted'
  ) then
    raise exception 'You can only message your friends.';
  end if;

  -- on conflict covers two people opening the thread at the same instant
  insert into conversations (user_a, user_b) values (a, b)
    on conflict (user_a, user_b) do update set user_a = excluded.user_a
    returning * into conv;
  return conv;
end;
$$;

-- Marks every message the OTHER person sent in this thread as read. Returns
-- how many rows changed. This is the only way read_at is ever written.
create or replace function mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if not exists (
    select 1 from conversations where id = p_conversation_id and me in (user_a, user_b)
  ) then
    raise exception 'Conversation not found.';
  end if;

  update messages
    set read_at = now()
    where conversation_id = p_conversation_id and sender_id <> me and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- One row per conversation that has unread messages for the caller. SECURITY
-- INVOKER (the default): RLS on messages already limits this to the caller's
-- own conversations, so no extra trust is needed.
create or replace function my_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
stable
as $$
  select m.conversation_id, count(*) as unread
  from messages m
  where m.read_at is null and m.sender_id <> auth.uid()
  group by m.conversation_id;
$$;

revoke execute on function get_or_create_conversation(uuid) from public, anon;
revoke execute on function mark_conversation_read(uuid) from public, anon;
revoke execute on function my_unread_counts() from public, anon;
grant execute on function get_or_create_conversation(uuid) to authenticated;
grant execute on function mark_conversation_read(uuid) to authenticated;
grant execute on function my_unread_counts() to authenticated;


-- ----------------------------------------------------------------------------
-- Realtime publication
--
-- Must come last: conversations/messages have to exist first. Each table is
-- added only if it exists and isn't already published, so this is safe to
-- re-run and tolerant of an older database that is missing one of them.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'notifications', 'friendships', 'posts', 'post_likes', 'post_comments',
    'participant_sessions', 'responses', 'conversations', 'messages'
  ] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'realtime: table public.% does not exist, skipped', t;
    elsif not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
