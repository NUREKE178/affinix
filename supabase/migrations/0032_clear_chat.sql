-- ============================================================================
-- Affinix: clear a chat (like WhatsApp "Clear chat")
--
-- "Clear" hides the conversation's history FOR ME ONLY: the other person keeps everything and the conversation itself stays.
-- It is one timestamp per person per conversation (conversation_prefs.cleared_at); the messages policy shows a person only the
-- messages newer than it, so search, unread counters, realtime and the thread all agree without any other change.
-- Safe to run twice.
-- ============================================================================

alter table conversation_prefs add column if not exists cleared_at timestamptz;

drop policy if exists messages_select_member on messages;
create policy messages_select_member on messages
  for select to authenticated
  using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id and auth.uid() in (c.user_a, c.user_b)
    )
    and messages.created_at > coalesce(
      (select p.cleared_at from conversation_prefs p where p.conversation_id = messages.conversation_id and p.user_id = auth.uid()),
      '-infinity'::timestamptz
    )
  );

create or replace function clear_conversation(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  at timestamptz := clock_timestamp();
begin
  if me is null or not exists (select 1 from conversations where id = p_conversation_id and me in (user_a, user_b)) then
    raise exception 'not_found';
  end if;
  insert into conversation_prefs (conversation_id, user_id, cleared_at) values (p_conversation_id, me, at)
  on conflict (conversation_id, user_id) do update set cleared_at = excluded.cleared_at, updated_at = now();
  return at;
end $$;

revoke execute on function clear_conversation(uuid) from public, anon;
grant execute on function clear_conversation(uuid) to authenticated;

notify pgrst, 'reload schema';
