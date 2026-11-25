-- Push notifications for new chat messages (Web Push: they reach the phone even when the site is closed).
--
-- A device that agrees to notifications gets a "subscription" from its browser: an endpoint (a private URL at Google / Apple / Mozilla)
-- plus two keys. We keep it here, one row per device. The edge function `notify-message` reads these rows with the service role and
-- sends the push; a person can only see and manage their own devices.
--
-- Nothing here stores message text: the text travels in the push itself (encrypted for the one device by the push service protocol).
-- Safe to run twice.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- read your own devices; every write goes through the two functions below (or the service role in the edge function)
drop policy if exists push_subscriptions_select_own on push_subscriptions;
create policy push_subscriptions_select_own on push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

revoke all on push_subscriptions from anon, authenticated;
grant select on push_subscriptions to authenticated;

-- One device = one endpoint. If someone else signs in on the same phone, the device simply moves to them
-- (otherwise the first person would keep receiving the second person's messages).
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now();
end $$;

create or replace function push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function push_subscribe(text, text, text, text) from public, anon;
revoke all on function push_unsubscribe(text) from public, anon;
grant execute on function push_subscribe(text, text, text, text) to authenticated;
grant execute on function push_unsubscribe(text) to authenticated;
