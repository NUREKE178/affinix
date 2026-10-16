-- ============================================================================
-- DecisionOS: chat actions (Messages v2)
--
-- Builds on 0018 (conversations, messages) and 0020 (image attachments, replies):
--   * edit a message (own, within 48 hours)      -> messages.edited_at, edit_message()
--   * delete a message for both people            -> messages.deleted_at, delete_message()
--   * one reaction per person per message         -> message_reactions, react_to_message()
--   * pin / mute a conversation (per person)      -> conversation_prefs, set_conversation_pref()
--   * search the text of my conversations         -> search_messages()
--
-- Every write goes through a SECURITY DEFINER function that checks who the caller is; the tables
-- themselves have no INSERT / UPDATE / DELETE policies for the API roles. Errors are short machine
-- words (edit_expired, not_found, deleted, bad_text, bad_emoji, not_friends) that the client words
-- in the player's language.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. edit and delete
-- ----------------------------------------------------------------------------
alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists deleted_at timestamptz;

-- A deleted message keeps its row (replies that quote it, read receipts, the order of the thread)
-- but loses its text and image, so the "text or image" rule has to let it be empty.
alter table messages drop constraint if exists messages_body_or_attachment_check;
alter table messages add constraint messages_body_or_attachment_check check (
  char_length(btrim(body)) between 0 and 4000
  and (deleted_at is not null or char_length(btrim(body)) > 0 or attachment_path is not null)
);

-- The chat list previews the last message; when that one is deleted it says so instead of showing old text.
alter table conversations add column if not exists last_message_deleted boolean not null default false;

-- A new message is never born edited or deleted, whatever the client sends.
create or replace function messages_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := clock_timestamp();
  new.read_at := null;
  new.edited_at := null;
  new.deleted_at := null;
  new.body := coalesce(btrim(new.body), '');
  if new.attachment_path is not null
     and new.attachment_path !~ ('^' || new.conversation_id::text || '/' || new.sender_id::text || '/[^/]+$') then
    raise exception 'The attachment does not belong to this conversation.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function messages_after_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update conversations
    set last_message_at = new.created_at,
        last_message_body = left(new.body, 140),
        last_message_sender_id = new.sender_id,
        last_message_has_attachment = (new.attachment_path is not null),
        last_message_deleted = false
    where id = new.conversation_id;
  return new;
end;
$$;

create or replace function edit_message(p_message_id uuid, p_body text)
returns messages
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  m messages;
  nb text := coalesce(btrim(p_body), '');
begin
  if me is null then
    raise exception 'not_found';
  end if;
  select * into m from messages where id = p_message_id for update;
  if not found or m.sender_id <> me then
    raise exception 'not_found';
  end if;
  if m.deleted_at is not null then
    raise exception 'deleted';
  end if;
  if m.created_at < now() - interval '48 hours' then
    raise exception 'edit_expired';
  end if;
  if char_length(nb) > 4000 or (nb = '' and m.attachment_path is null) then
    raise exception 'bad_text';
  end if;
  if nb = m.body then
    return m;
  end if;
  update messages set body = nb, edited_at = now() where id = m.id returning * into m;
  update conversations set last_message_body = left(nb, 140)
    where id = m.conversation_id and last_message_at = m.created_at;
  return m;
end;
$$;

-- Returns the storage path of the image that was attached (or null) so that the client can remove the file;
-- the uploader is allowed to delete their own object by the storage policy of 0020.
create or replace function delete_message(p_message_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  m messages;
  old_path text;
begin
  if me is null then
    raise exception 'not_found';
  end if;
  select * into m from messages where id = p_message_id for update;
  if not found or m.sender_id <> me then
    raise exception 'not_found';
  end if;
  if m.deleted_at is not null then
    return null;
  end if;
  old_path := m.attachment_path;
  update messages set body = '', attachment_path = null, deleted_at = now() where id = m.id;
  delete from message_reactions where message_id = m.id;
  update conversations
    set last_message_body = '', last_message_has_attachment = false, last_message_deleted = true
    where id = m.conversation_id and last_message_at = m.created_at;
  return old_path;
end;
$$;

-- Messages that were deleted before being read no longer count as unread.
create or replace function my_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
stable
as $$
  select m.conversation_id, count(*) as unread
  from messages m
  where m.read_at is null and m.sender_id <> auth.uid() and m.deleted_at is null
  group by m.conversation_id;
$$;

-- ----------------------------------------------------------------------------
-- 2. reactions (one per person per message, like WhatsApp)
-- ----------------------------------------------------------------------------
create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table message_reactions enable row level security;

-- Visible to the two people of the conversation the message belongs to (messages has its own policy,
-- so this subquery sees only rows of my conversations anyway).
drop policy if exists message_reactions_select_member on message_reactions;
create policy message_reactions_select_member on message_reactions
  for select to authenticated
  using (exists (select 1 from messages m where m.id = message_reactions.message_id));

-- p_emoji null, or the same emoji again, removes my reaction; another emoji replaces it. Returns what I have now.
create or replace function react_to_message(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  m messages;
  c conversations;
  cur text;
begin
  if me is null then
    raise exception 'not_found';
  end if;
  select * into m from messages where id = p_message_id;
  if not found then
    raise exception 'not_found';
  end if;
  select * into c from conversations where id = m.conversation_id;
  if not found or me not in (c.user_a, c.user_b) then
    raise exception 'not_found';
  end if;
  if m.deleted_at is not null then
    raise exception 'deleted';
  end if;
  select emoji into cur from message_reactions where message_id = m.id and user_id = me;
  if p_emoji is null or p_emoji = cur then
    delete from message_reactions where message_id = m.id and user_id = me;
    return null;
  end if;
  if p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'bad_emoji';
  end if;
  if not exists (select 1 from friendships where user_min = c.user_a and user_max = c.user_b and status = 'accepted') then
    raise exception 'not_friends';
  end if;
  insert into message_reactions (message_id, user_id, emoji) values (m.id, me, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return p_emoji;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. pin / mute (per person, never visible to the other one)
-- ----------------------------------------------------------------------------
create table if not exists conversation_prefs (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  pinned_at timestamptz,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table conversation_prefs enable row level security;

drop policy if exists conversation_prefs_select_own on conversation_prefs;
create policy conversation_prefs_select_own on conversation_prefs
  for select to authenticated
  using (user_id = auth.uid());

-- Each argument that is null leaves that setting as it is.
create or replace function set_conversation_pref(p_conversation_id uuid, p_pinned boolean default null, p_muted boolean default null)
returns conversation_prefs
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  r conversation_prefs;
begin
  if me is null or not exists (select 1 from conversations where id = p_conversation_id and me in (user_a, user_b)) then
    raise exception 'not_found';
  end if;
  insert into conversation_prefs (conversation_id, user_id, pinned_at, muted)
  values (
    p_conversation_id, me,
    case when p_pinned is true then now() else null end,
    coalesce(p_muted, false)
  )
  on conflict (conversation_id, user_id) do update set
    pinned_at = case when p_pinned is null then conversation_prefs.pinned_at when p_pinned then coalesce(conversation_prefs.pinned_at, now()) else null end,
    muted = coalesce(p_muted, conversation_prefs.muted),
    updated_at = now()
  returning * into r;
  return r;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. search the text of my conversations (RLS on messages decides which rows I may see)
-- ----------------------------------------------------------------------------
create or replace function search_messages(p_query text, p_limit integer default 30)
returns table (message_id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql
stable
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
  from messages m
  where char_length(btrim(coalesce(p_query, ''))) >= 2
    and m.deleted_at is null
    and strpos(lower(m.body), lower(btrim(p_query))) > 0
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

-- ----------------------------------------------------------------------------
-- 5. grants and realtime
-- ----------------------------------------------------------------------------
revoke execute on function edit_message(uuid, text) from public, anon;
revoke execute on function delete_message(uuid) from public, anon;
revoke execute on function react_to_message(uuid, text) from public, anon;
revoke execute on function set_conversation_pref(uuid, boolean, boolean) from public, anon;
revoke execute on function search_messages(text, integer) from public, anon;
grant execute on function edit_message(uuid, text) to authenticated;
grant execute on function delete_message(uuid) to authenticated;
grant execute on function react_to_message(uuid, text) to authenticated;
grant execute on function set_conversation_pref(uuid, boolean, boolean) to authenticated;
grant execute on function search_messages(text, integer) to authenticated;

-- Reactions travel to the other person's open chat over Realtime (RLS above decides who receives a row).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$$;

notify pgrst, 'reload schema';
