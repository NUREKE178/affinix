-- ============================================================================
-- DecisionOS — friendships (requests, accept/decline/cancel/remove) +
-- notifications generalized beyond comments
--
-- friendships is one row per PAIR of users, regardless of who requested
-- whom: user_min/user_max are generated from least()/greatest() of the two
-- real columns, and the unique constraint is on that pair -- so there can
-- never be two contradictory rows between the same two people (A->B pending
-- AND B->A pending at once, or a stray duplicate after a decline-then-
-- re-request cycle). requester_id/addressee_id keep the real direction for
-- everything that cares who asked whom; user_min/user_max exist purely to
-- make "is there already a row for this pair" one clean constraint instead
-- of an application-level race between two SELECTs.
--
-- Three operations need more validation than a column-ownership check can
-- express, so they're SECURITY DEFINER functions rather than raw table
-- access, the same split this schema already uses for add_member_by_email
-- (0006) and the owner-lock fix (0016):
--   * send_friend_request -- also has to notice "they already requested ME"
--     and accept instead of insert, to keep the one-row-per-pair invariant
--     intact rather than erroring on a constraint violation.
--   * accept_friend_request -- the one UPDATE this table ever needs, and
--     the exact kind of narrow transition (addressee only, pending only,
--     status->'accepted' only) that's genuinely awkward to fence with RLS
--     alone: a `with check` on a raw UPDATE policy can't stop a caller from
--     ALSO smuggling a new requester_id into the same statement (the same
--     class of gap 0016 closed on organization_members). There is
--     deliberately no UPDATE RLS policy on this table at all -- accepting
--     only ever happens through this function.
--   * friends_count -- lets a profile's friend count show on ANYONE's view
--     of it (PublicProfile, the author popover) without widening this
--     table's SELECT policy to "anyone can read anyone's friendships",
--     which would leak who has a PENDING request out to a third party.
--
-- Declining, cancelling, and removing a friend are all the same operation
-- underneath (delete a row you're part of) and stay as plain client-side
-- deletes under RLS -- unlike accepting, there's no row left over to leave
-- in a half-valid state, so there's nothing a raw DELETE policy needs help
-- enforcing beyond "only a party to this row".
-- ============================================================================

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  user_min uuid generated always as (least(requester_id, addressee_id)) stored,
  user_max uuid generated always as (greatest(requester_id, addressee_id)) stored,
  constraint friendships_no_self check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (user_min, user_max)
);

create index friendships_requester_idx on friendships (requester_id);
create index friendships_addressee_idx on friendships (addressee_id);

alter table friendships enable row level security;

-- Only the two people involved -- never using (true): an accepted
-- friendship is reasonable to show as a count via friends_count() below,
-- but the raw rows (especially PENDING ones) are nobody else's business.
create policy friendships_select_own on friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- A brand new pending request, always from the caller, always pending --
-- the mutual-request auto-accept case is handled inside send_friend_request
-- below (a plain INSERT can't also decide to UPDATE an existing row
-- instead), so this direct path only ever fires for the "no row exists
-- yet" case the function already checked for.
create policy friendships_insert_own on friendships
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

-- Covers decline (addressee deletes a pending row), cancel (requester
-- deletes a pending row), and remove (either party deletes an accepted
-- row) -- all the same shape of "I'm a party to this row, so I can end it".
create policy friendships_delete_own on friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

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
  if not exists (select 1 from profiles where id = target_id) then
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
      -- They already requested ME -- accept it rather than erroring on the
      -- unique-pair constraint a second insert would hit.
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

grant execute on function send_friend_request(uuid) to authenticated;

create or replace function accept_friend_request(p_friendship_id uuid)
returns friendships
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  result friendships;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  update friendships
    set status = 'accepted', responded_at = now()
    where id = p_friendship_id and addressee_id = me and status = 'pending'
    returning * into result;
  if not found then
    raise exception 'Friend request not found or already handled.';
  end if;
  insert into notifications (recipient_id, actor_id, type)
    values (result.requester_id, me, 'friend_accept');
  return result;
end;
$$;

grant execute on function accept_friend_request(uuid) to authenticated;

-- Read by PublicProfile and the feed's author popover for ANY profile, not
-- just the caller's own -- a count is safe to expose platform-wide (same
-- posture as a like count), unlike the raw friendship rows themselves.
create or replace function friends_count(target_id uuid)
returns bigint
language sql
security definer set search_path = public
stable
as $$
  select count(*) from friendships
    where status = 'accepted' and (requester_id = target_id or addressee_id = target_id);
$$;

grant execute on function friends_count(uuid) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- notifications (0014): generalize beyond "someone commented on your post"
-- so the same bell/realtime/sound/browser-push pipeline also carries friend
-- events, instead of building a second delivery mechanism from scratch.
-- post_id/comment_id go nullable (a friend notification has neither); type
-- discriminates what a row means. The existing insert policy narrows to
-- type = 'comment' explicitly -- friend-type rows are only ever inserted by
-- the SECURITY DEFINER functions above (which bypass RLS internally but
-- re-validate the real authorization themselves), never by a direct client
-- insert, so that policy doesn't need to learn how to validate a
-- friendship's shape too.
-- ----------------------------------------------------------------------------

alter table notifications
  alter column post_id drop not null,
  alter column comment_id drop not null,
  add column type text not null default 'comment' check (type in ('comment', 'friend_request', 'friend_accept'));

drop policy notifications_insert_validated on notifications;
create policy notifications_insert_validated on notifications
  for insert to authenticated
  with check (
    type = 'comment'
    and actor_id = auth.uid()
    and actor_id <> recipient_id
    and recipient_id = (select author_id from posts where id = post_id)
  );
