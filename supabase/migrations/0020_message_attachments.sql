-- ============================================================================
-- DecisionOS — image attachments and reply-to for 1:1 messaging
--
-- Extends messages (0018_realtime_and_messaging.sql) with the two
-- WhatsApp/Telegram-style features that weren't there yet: sharing an image
-- in a conversation, and replying to a specific earlier message with a
-- quoted reference. Read receipts (read_at) and the realtime plumbing
-- already exist and are untouched here.
--
-- Storage path convention for a chat image (the policies and the trigger
-- below both depend on it):
--   <conversation_id>/<uploader_id>/<random>.<ext>      in bucket "message-images"
-- ============================================================================

alter table messages add column if not exists attachment_path text;
alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;

-- Deleting a message (e.g. a whole conversation cascading away) has to find
-- the replies pointing at it to null them out; without an index that is a
-- sequential scan per deleted row.
create index if not exists messages_reply_to_idx on messages (reply_to_id) where reply_to_id is not null;

-- A message used to always need real text (1-4000 chars); it may now be
-- image-only, but never neither. The original check was an unnamed inline
-- CREATE TABLE constraint, so its auto-generated name isn't guaranteed --
-- find whatever it's actually called rather than guessing.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%body%'
  loop
    execute format('alter table messages drop constraint %I', r.conname);
  end loop;
end $$;

alter table messages add constraint messages_body_or_attachment_check check (
  char_length(btrim(body)) between 0 and 4000
  and (char_length(btrim(body)) > 0 or attachment_path is not null)
);

alter table messages drop constraint if exists messages_attachment_path_check;
alter table messages add constraint messages_attachment_path_check check (
  attachment_path is null or char_length(attachment_path) between 1 and 300
);

-- The chat list previews the last message from conversations.last_message_*.
-- An image-only message has an empty body, so the list needs to be told it was
-- a photo (the client shows a localized "Photo" label) rather than guess from
-- an empty string.
alter table conversations add column if not exists last_message_has_attachment boolean not null default false;

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
        last_message_has_attachment = (new.attachment_path is not null)
    where id = new.conversation_id;
  return new;
end;
$$;

-- messages_before_insert force-trims body server-side -- an image-only
-- message sends body: "" from the client; coalesce guards against a null
-- ever reaching the check above (btrim(null) is null, and char_length(null)
-- is null, not 0, which would make the check's result unknown rather than
-- a clean reject).
--
-- An attachment must be an object the SENDER uploaded into THIS
-- conversation's folder: otherwise a message could point at some other path
-- (another conversation's image, a made-up key) and the recipient's client
-- would be asked to render it.
create or replace function messages_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := clock_timestamp();
  new.read_at := null;
  new.body := coalesce(btrim(new.body), '');
  if new.attachment_path is not null
     and new.attachment_path !~ ('^' || new.conversation_id::text || '/' || new.sender_id::text || '/[^/]+$') then
    raise exception 'The attachment does not belong to this conversation.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Replying across conversations would only ever render as a dangling quote
-- for the other participant (messages_select_member already blocks reading
-- a row from a conversation you're not in), but reject it outright at
-- insert time rather than let a confusing cross-conversation reference
-- exist at all.
--
-- A helper rather than an inline subquery: a policy on messages that selects
-- from messages re-applies the same policy to that subquery ("infinite
-- recursion detected in policy"). SECURITY DEFINER reads past RLS and only
-- answers "is message X in conversation Y".
create or replace function message_in_conversation(p_message_id uuid, p_conversation_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from messages where id = p_message_id and conversation_id = p_conversation_id);
$$;

revoke execute on function message_in_conversation(uuid, uuid) from public, anon;
grant execute on function message_in_conversation(uuid, uuid) to authenticated;

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
    )
  );

-- Private storage bucket for chat images -- NOT public-read like
-- post-images (0010_post_images.sql): a DM's content must only be visible
-- to the two people in that conversation. Keyed by conversation first, so
-- EITHER participant can read it regardless of who sent it, and by uploader
-- second, so each person can only add or remove their own files. The folder
-- is compared as text (never cast to uuid): a cast on an arbitrary path
-- segment can throw before the other conditions get to say "no".
insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', false)
on conflict (id) do nothing;

drop policy if exists "message-images: conversation members can read" on storage.objects;
create policy "message-images: conversation members can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and exists (
      select 1 from conversations c
      where c.id::text = (storage.foldername(name))[1]
        and auth.uid() in (c.user_a, c.user_b)
    )
  );

drop policy if exists "message-images: conversation members can upload" on storage.objects;
create policy "message-images: conversation members can upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from conversations c
      where c.id::text = (storage.foldername(name))[1]
        and auth.uid() in (c.user_a, c.user_b)
    )
  );

drop policy if exists "message-images: uploaders can delete their own" on storage.objects;
drop policy if exists "message-images: conversation members can delete" on storage.objects;
create policy "message-images: uploaders can delete their own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from conversations c
      where c.id::text = (storage.foldername(name))[1]
        and auth.uid() in (c.user_a, c.user_b)
    )
  );

-- Private bucket: the client must render attachments through signed URLs
-- (storage.createSignedUrls()), never getPublicUrl() (that 403s here).
