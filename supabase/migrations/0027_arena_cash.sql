-- ============================================================================
-- Affinix -- Arena cash: a money bonus for answering research missions
--
-- Players already answer other people's crowd tests as research missions (0022). This migration lets a mission pay a
-- small money bonus (in tenge) on top of the XP, and keeps an honest account of it, so that later the platform can
-- transfer the balance to the player's bank. Transfers are NOT part of this release: the data model and the request
-- flow are here, but they stay switched off (cash_settings.payouts_enabled = false) until a payment provider is wired up.
--
-- Where the money comes from: a test pays only when an admin has FUNDED it (a reward per answer and a total budget).
-- Today the platform funds tests itself; later a researcher pays for their own test (the Billing page) and the same two
-- columns are filled by that payment. A test nobody funded pays XP only, exactly as before. This rule is also the main
-- defence against "make a test, answer it with five fake accounts": nobody can make money appear by creating a test.
--
-- Amounts are integers in tiyn (1 tenge = 100 tiyn), never floats.
--
-- What lives here:
--   * cash_settings          one row of rules (rates, caps, holding period, the payouts switch). Changed by admins only.
--   * arena_tests.cash_*     the reward per answer, the budget and what has been spent of it.
--   * cash_accounts          one row per player: a cached balance and a quality status (ok / review / blocked).
--   * cash_ledger            append-only money ledger: every bonus, reversal, correction and payout is a row. Amounts are
--                            never edited and rows are never deleted (a trigger refuses it); only the state moves forward
--                            (pending -> available, pending/available -> void, a payout pending -> settled / void).
--   * cash_checks            quality checks: now and then a player meets a pair they answered earlier; a person who
--                            answers it the same way again is reading the options, a random clicker matches only half the
--                            time. Too many mismatches put the account on review: its bonus stops being released.
--   * cash_payout_requests   withdrawal requests (the flow for later; refused while payouts are switched off).
--
-- Money rules, all enforced here (the browser cannot change them):
--   1. only a funded test pays, and only while its budget lasts;
--   2. the player must have an account older than min_account_hours and min_arena_votes duels in the Arena;
--   3. answers faster than min_answer_ms, or less than min_gap_ms after the player's previous paid answer (server
--      clock), pay nothing;
--   4. at most user_daily_cap tiyn a day (UTC);
--   5. a new bonus is "pending" for hold_days, then becomes "available"; an account on review is not released;
--   6. admins can void a bonus or block an account; every admin action is written to admin_audit.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tables
-- ----------------------------------------------------------------------------
create table if not exists cash_settings (
  id boolean primary key default true check (id),
  earning_enabled boolean not null default true,
  payouts_enabled boolean not null default false,
  currency text not null default 'KZT' check (currency = 'KZT'),
  hold_days int not null default 7 check (hold_days between 0 and 90),
  user_daily_cap bigint not null default 50000 check (user_daily_cap between 0 and 10000000),
  max_reward bigint not null default 10000 check (max_reward between 0 and 1000000),
  min_payout bigint not null default 200000 check (min_payout between 100 and 100000000),
  min_answer_ms int not null default 600 check (min_answer_ms between 0 and 10000),
  min_gap_ms int not null default 1500 check (min_gap_ms between 0 and 60000),
  min_account_hours int not null default 24 check (min_account_hours between 0 and 8760),
  min_arena_votes int not null default 30 check (min_arena_votes between 0 and 100000),
  check_rate numeric not null default 0.2 check (check_rate between 0 and 1),
  check_age_minutes int not null default 30 check (check_age_minutes between 0 and 100000),
  check_min int not null default 8 check (check_min between 1 and 1000),
  check_floor numeric not null default 0.6 check (check_floor between 0 and 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
insert into cash_settings (id) values (true) on conflict (id) do nothing;

alter table arena_tests add column if not exists cash_reward bigint not null default 0;
alter table arena_tests add column if not exists cash_budget bigint not null default 0;
alter table arena_tests add column if not exists cash_spent bigint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'arena_tests_cash_ok') then
    alter table arena_tests add constraint arena_tests_cash_ok
      check (cash_reward >= 0 and cash_budget >= 0 and cash_spent >= 0 and cash_spent <= cash_budget);
  end if;
end $$;

create table if not exists cash_accounts (
  user_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'ok' check (status in ('ok', 'review', 'blocked')),
  status_note text check (status_note is null or char_length(status_note) <= 300),
  status_at timestamptz,
  pending bigint not null default 0,
  available bigint not null default 0,
  reserved bigint not null default 0,
  paid_out bigint not null default 0,
  earned_total bigint not null default 0,
  checks_total int not null default 0,
  checks_consistent int not null default 0,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cash_payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  -- How the money is to be sent, filled by the payment provider integration later (a provider token and a masked
  -- account such as "KZ** **** 1234"). Raw card or account numbers are never stored here.
  destination jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null,
  note text check (note is null or char_length(note) <= 300)
);
create unique index if not exists cash_payout_one_open on cash_payout_requests (user_id) where status = 'requested';

create table if not exists cash_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('earn', 'adjustment', 'payout')),
  amount bigint not null check (amount <> 0),
  state text not null check (state in ('pending', 'available', 'void', 'settled')),
  available_at timestamptz,
  test_id uuid references arena_tests(id) on delete set null,
  vote_id bigint,
  payout_id uuid references cash_payout_requests(id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  changed_at timestamptz,
  check (kind <> 'earn' or (amount > 0 and vote_id is not null)),
  check (kind <> 'payout' or amount < 0)
);
-- one bonus per mission answer, whatever is retried
create unique index if not exists cash_ledger_one_earn_per_vote on cash_ledger (vote_id) where kind = 'earn';
create index if not exists cash_ledger_user_idx on cash_ledger (user_id, id desc);
create index if not exists cash_ledger_pending_idx on cash_ledger (user_id, available_at) where state = 'pending';
create index if not exists cash_ledger_day_idx on cash_ledger (created_at) where kind = 'earn';

create table if not exists cash_checks (
  user_id uuid not null references profiles(id) on delete cascade,
  test_id uuid not null references arena_tests(id) on delete cascade,
  item_lo uuid not null,
  item_hi uuid not null,
  issued_at timestamptz not null default now(),
  answered_at timestamptz,
  first_winner uuid not null,
  second_winner uuid,
  consistent boolean,
  primary key (user_id, test_id, item_lo, item_hi)
);
create index if not exists cash_checks_open_idx on cash_checks (user_id) where answered_at is null;

-- Row level security: a player reads their own account and ledger rows; everything else goes through the functions.
alter table cash_settings enable row level security;
alter table cash_accounts enable row level security;
alter table cash_ledger enable row level security;
alter table cash_checks enable row level security;
alter table cash_payout_requests enable row level security;

drop policy if exists cash_accounts_select_own on cash_accounts;
create policy cash_accounts_select_own on cash_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists cash_ledger_select_own on cash_ledger;
create policy cash_ledger_select_own on cash_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists cash_payouts_select_own on cash_payout_requests;
create policy cash_payouts_select_own on cash_payout_requests for select to authenticated using (user_id = auth.uid());
-- no insert / update / delete policy anywhere: the API roles cannot write these tables


-- ----------------------------------------------------------------------------
-- the ledger is append-only: amounts never change, rows are never deleted, a state only moves forward
-- ----------------------------------------------------------------------------
create or replace function cash_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- the only way a row goes: its person's account is deleted (profiles -> cascade)
    if exists (select 1 from profiles where id = old.user_id) then
      raise exception 'cash_ledger rows are never deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind or new.amount <> old.amount
     or new.vote_id is distinct from old.vote_id or new.created_at <> old.created_at then
    raise exception 'cash_ledger amounts and owners never change' using errcode = '42501';
  end if;
  if new.state <> old.state and not (
       (old.state = 'pending' and new.state in ('available', 'void', 'settled'))
    or (old.state = 'available' and new.state = 'void')
  ) then
    raise exception 'cash_ledger: % -> % is not allowed', old.state, new.state using errcode = '42501';
  end if;
  if new.state = 'settled' and old.kind <> 'payout' then
    raise exception 'cash_ledger: only a payout is settled' using errcode = '42501';
  end if;
  if new.state = 'available' and old.kind = 'payout' then
    raise exception 'cash_ledger: a payout is settled or void, never available' using errcode = '42501';
  end if;
  new.changed_at := now();
  return new;
end;
$$;

drop trigger if exists cash_ledger_guard on cash_ledger;
create trigger cash_ledger_guard before update or delete on cash_ledger
  for each row execute function cash_ledger_guard();


-- ----------------------------------------------------------------------------
-- helpers (internal: not callable from the API)
-- ----------------------------------------------------------------------------
create or replace function _cash_settings()
returns cash_settings
language sql
stable
security definer set search_path = public
as $$
  select s from cash_settings s where id
$$;

-- Recomputes the cached balance of one account from its ledger. The ledger is the truth; this is a cache.
create or replace function _cash_recompute(p_user uuid)
returns cash_accounts
language plpgsql
security definer set search_path = public
as $$
declare
  a cash_accounts;
begin
  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  update cash_accounts c set
    pending = coalesce((select sum(amount) from cash_ledger l where l.user_id = p_user and l.kind = 'earn' and l.state = 'pending'), 0),
    available = coalesce((select sum(amount) from cash_ledger l where l.user_id = p_user and (
                  (l.kind in ('earn', 'adjustment') and l.state = 'available')
               or (l.kind = 'payout' and l.state in ('pending', 'settled')))), 0),
    reserved = coalesce((select -sum(amount) from cash_ledger l where l.user_id = p_user and l.kind = 'payout' and l.state = 'pending'), 0),
    paid_out = coalesce((select -sum(amount) from cash_ledger l where l.user_id = p_user and l.kind = 'payout' and l.state = 'settled'), 0),
    earned_total = coalesce((select sum(amount) from cash_ledger l where l.user_id = p_user and l.kind = 'earn' and l.state <> 'void'), 0),
    updated_at = now()
  where c.user_id = p_user
  returning * into a;
  return a;
end;
$$;

-- Bonuses whose holding period is over become available, unless the account is on review or blocked.
create or replace function _cash_release(p_user uuid)
returns cash_accounts
language plpgsql
security definer set search_path = public
as $$
declare
  st text;
begin
  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select status into st from cash_accounts where user_id = p_user for update;
  if st = 'ok' then
    update cash_ledger set state = 'available'
      where user_id = p_user and kind = 'earn' and state = 'pending' and available_at <= now();
  end if;
  return _cash_recompute(p_user);
end;
$$;

-- Whether a person may earn at all: { ok, reason, votes, needVotes, readyAt }.
create or replace function _cash_eligibility(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  joined timestamptz;
  votes int;
  st text;
begin
  select created_at into joined from profiles where id = p_user;
  select coalesce(votes_total, 0) into votes from arena_profiles where user_id = p_user;
  select status into st from cash_accounts where user_id = p_user;
  votes := coalesce(votes, 0);
  return jsonb_build_object(
    'ok', s.earning_enabled and coalesce(st, 'ok') <> 'blocked'
          and joined is not null and joined <= now() - make_interval(hours => s.min_account_hours)
          and votes >= s.min_arena_votes,
    'reason', case
      when not s.earning_enabled then 'off'
      when coalesce(st, 'ok') = 'blocked' then 'blocked'
      when joined is null or joined > now() - make_interval(hours => s.min_account_hours) then 'new_account'
      when votes < s.min_arena_votes then 'need_play'
      else null end,
    'votes', votes,
    'needVotes', s.min_arena_votes,
    'readyAt', case when joined is null then null else joined + make_interval(hours => s.min_account_hours) end
  );
end;
$$;

-- Pays the bonus for one accepted mission answer, if every rule allows it. Called by arena_test_vote with the test row
-- already locked. Returns { amount, reason }: amount 0 with a reason when nothing was paid.
create or replace function _cash_earn(p_user uuid, p_test uuid, p_vote bigint, p_ms int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  t arena_tests;
  a cash_accounts;
  elig jsonb;
  utc_today date := (now() at time zone 'utc')::date;
  today_sum bigint;
  v_amount bigint;
begin
  select * into t from arena_tests where id = p_test;
  if not found or t.cash_reward <= 0 then
    return jsonb_build_object('amount', 0, 'reason', null);
  end if;
  v_amount := least(t.cash_reward, s.max_reward);
  if not s.earning_enabled then
    return jsonb_build_object('amount', 0, 'reason', 'off');
  end if;
  if t.cash_budget - t.cash_spent < v_amount then
    return jsonb_build_object('amount', 0, 'reason', 'budget');
  end if;

  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  -- serialises this player's paid answers (pacing and the daily cap are read and written under this lock)
  select * into a from cash_accounts where user_id = p_user for update;

  elig := _cash_eligibility(p_user);
  if not (elig->>'ok')::boolean then
    return jsonb_build_object('amount', 0, 'reason', elig->>'reason');
  end if;
  if coalesce(p_ms, 0) < s.min_answer_ms then
    return jsonb_build_object('amount', 0, 'reason', 'too_fast');
  end if;
  if a.last_paid_at is not null and a.last_paid_at > now() - make_interval(secs => s.min_gap_ms / 1000.0) then
    return jsonb_build_object('amount', 0, 'reason', 'too_fast');
  end if;
  select coalesce(sum(amount), 0) into today_sum
    from cash_ledger
    where user_id = p_user and kind = 'earn' and state <> 'void'
      and created_at >= (utc_today::timestamp at time zone 'utc');
  if today_sum + v_amount > s.user_daily_cap then
    return jsonb_build_object('amount', 0, 'reason', 'cap');
  end if;

  insert into cash_ledger (user_id, kind, amount, state, available_at, test_id, vote_id)
    values (p_user, 'earn', v_amount, 'pending', now() + make_interval(days => s.hold_days), p_test, p_vote);
  update arena_tests set cash_spent = cash_spent + v_amount where id = p_test;
  update cash_accounts set
    pending = pending + v_amount, earned_total = earned_total + v_amount, last_paid_at = now(), updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('amount', v_amount, 'reason', null);
end;
$$;

-- The second answer to a quality check. Updates the account's consistency and puts it on review when it falls below
-- the floor (after at least check_min checks). Returns true when it was a check.
create or replace function _cash_answer_check(p_user uuid, p_test uuid, p_lo uuid, p_hi uuid, p_winner uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  c cash_checks;
  a cash_accounts;
  same boolean;
begin
  select * into c from cash_checks
    where user_id = p_user and test_id = p_test and item_lo = p_lo and item_hi = p_hi and answered_at is null
    for update;
  if not found then
    return false;
  end if;
  same := (p_winner = c.first_winner);
  update cash_checks set answered_at = now(), second_winner = p_winner, consistent = same
    where user_id = p_user and test_id = p_test and item_lo = p_lo and item_hi = p_hi;
  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  update cash_accounts set
    checks_total = checks_total + 1,
    checks_consistent = checks_consistent + case when same then 1 else 0 end,
    updated_at = now()
  where user_id = p_user
  returning * into a;
  if a.status = 'ok' and a.checks_total >= s.check_min
     and a.checks_consistent::numeric / a.checks_total < s.check_floor then
    update cash_accounts set status = 'review', status_at = now(),
      status_note = format('auto %s/%s', a.checks_consistent, a.checks_total)
    where user_id = p_user;
  end if;
  return true;
end;
$$;

-- What the player's wallet screen reads. Releases matured bonuses first.
create or replace function _cash_wallet_json(p_user uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  a cash_accounts;
  utc_today date := (now() at time zone 'utc')::date;
begin
  a := _cash_release(p_user);
  return jsonb_build_object(
    'currency', s.currency,
    'status', a.status,
    'available', a.available,
    'pending', a.pending,
    'reserved', a.reserved,
    'paidOut', a.paid_out,
    'earnedTotal', a.earned_total,
    'today', coalesce((select sum(amount) from cash_ledger where user_id = p_user and kind = 'earn' and state <> 'void'
                         and created_at >= (utc_today::timestamp at time zone 'utc')), 0),
    'rules', jsonb_build_object(
      'earningEnabled', s.earning_enabled, 'payoutsEnabled', s.payouts_enabled, 'holdDays', s.hold_days,
      'dailyCap', s.user_daily_cap, 'minPayout', s.min_payout, 'minArenaVotes', s.min_arena_votes,
      'minAccountHours', s.min_account_hours),
    'eligibility', _cash_eligibility(p_user),
    'nextRelease', (select jsonb_build_object('at', min(available_at), 'amount', sum(amount))
                      from cash_ledger where user_id = p_user and kind = 'earn' and state = 'pending'
                      having count(*) > 0),
    'openPayout', (select jsonb_build_object('id', r.id, 'amount', r.amount, 'createdAt', r.created_at)
                     from cash_payout_requests r where r.user_id = p_user and r.status = 'requested'),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'amount', l.amount, 'state', l.state, 'at', l.created_at,
        'availableAt', l.available_at, 'note', case when l.kind = 'earn' then null else l.note end,
        'test', case when t.id is null then null else jsonb_build_object('id', t.id, 'title', t.title) end
      ) order by l.id desc)
      from (select * from cash_ledger where user_id = p_user order by id desc limit 50) l
      left join arena_tests t on t.id = l.test_id
    ), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- the player's side
-- ----------------------------------------------------------------------------
create or replace function cash_wallet()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  return _cash_wallet_json(auth.uid());
end;
$$;

-- Asks for the available balance (or part of it) to be transferred. Refused while payouts are switched off; when they are
-- on, the amount is reserved at once (a pending payout row) and an admin settles or rejects it.
create or replace function cash_request_payout(p_amount bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s cash_settings := _cash_settings();
  a cash_accounts;
  req uuid;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if not s.payouts_enabled then
    raise exception 'Payouts are not open yet.' using hint = 'payouts_closed';
  end if;
  a := _cash_release(me);
  select * into a from cash_accounts where user_id = me for update;
  if a.status <> 'ok' then
    raise exception 'This account cannot withdraw now.' using hint = 'not_allowed';
  end if;
  if p_amount is null or p_amount < s.min_payout then
    raise exception 'Below the minimum withdrawal.' using hint = 'below_min';
  end if;
  if p_amount > a.available then
    raise exception 'More than the available balance.' using hint = 'too_much';
  end if;
  if exists (select 1 from cash_payout_requests where user_id = me and status = 'requested') then
    raise exception 'A withdrawal is already waiting.' using hint = 'open_request';
  end if;
  insert into cash_payout_requests (user_id, amount) values (me, p_amount) returning id into req;
  insert into cash_ledger (user_id, kind, amount, state, payout_id) values (me, 'payout', -p_amount, 'pending', req);
  perform _cash_recompute(me);
  return _cash_wallet_json(me);
end;
$$;


-- ----------------------------------------------------------------------------
-- missions: the queue now says what a test pays and sometimes brings a quality check back
-- ----------------------------------------------------------------------------
create or replace function arena_test_queue(p_limit int default 3)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  s cash_settings := _cash_settings();
  lim int := least(greatest(coalesce(p_limit, 3), 1), 10);
  utc_today date := (now() at time zone 'utc')::date;
  avail int;
  picked jsonb;
  chk cash_checks;
  chk_entry jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  with cand as (
    select t.id, t.title, t.dim, t.owner_id, t.votes_count,
           case when s.earning_enabled and t.cash_reward > 0 and t.cash_budget - t.cash_spent >= least(t.cash_reward, s.max_reward)
                then least(t.cash_reward, s.max_reward) else 0 end as reward,
           (select count(*) from arena_test_items i where i.test_id = t.id) as n_items,
           (select count(*) from arena_test_votes v where v.test_id = t.id and v.voter_id = me) as my_votes
    from arena_tests t
    where t.status = 'open' and t.owner_id <> me
      and not exists (select 1 from arena_test_reports r where r.test_id = t.id and r.reporter_id = me)
  ), open_cand as (
    select * from cand where n_items >= 2 and my_votes < n_items * (n_items - 1) / 2
  ), chosen as (
    -- funded tests first (someone is paying for answers), then the ones with the fewest answers
    select c.*, row_number() over (order by (c.reward > 0) desc, c.votes_count, random()) as ord
    from (select * from open_cand order by (reward > 0) desc, votes_count, random() limit lim) c
  )
  select
    (select count(*) from open_cand),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'dim', c.dim,
        'reward', c.reward,
        'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username, 'avatarUrl', p.avatar_url)
                  from profiles_public p where p.id = c.owner_id),
        'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'pos', i.pos, 'label', i.label, 'path', i.image_path) order by i.pos)
                  from arena_test_items i where i.test_id = c.id),
        'pairs', (select coalesce(jsonb_agg(jsonb_build_array(a.id, b.id)), '[]'::jsonb)
                  from arena_test_items a
                  join arena_test_items b on b.test_id = a.test_id and a.id < b.id
                  where a.test_id = c.id
                    and not exists (select 1 from arena_test_votes v
                                    where v.test_id = c.id and v.voter_id = me and v.item_lo = a.id and v.item_hi = b.id)),
        'done', c.my_votes,
        'total', c.n_items * (c.n_items - 1) / 2
      ) order by c.ord)
      from chosen c
    ), '[]'::jsonb)
  into avail, picked;

  -- A quality check: a pair this player answered a while ago, offered again like any other mission. Only for people who
  -- can earn (the check protects the money, nobody else needs it). One open check at a time; it stays until answered.
  if (_cash_eligibility(me)->>'ok')::boolean then
    select * into chk from cash_checks c
      where c.user_id = me and c.answered_at is null
        and exists (select 1 from arena_tests t where t.id = c.test_id and t.status = 'open')
      order by c.issued_at limit 1;
    if not found and random() < s.check_rate then
      insert into cash_checks (user_id, test_id, item_lo, item_hi, first_winner)
        select v.voter_id, v.test_id, v.item_lo, v.item_hi, v.winner
        from arena_test_votes v
        join arena_tests t on t.id = v.test_id and t.status = 'open'
        where v.voter_id = me and v.created_at <= now() - make_interval(mins => s.check_age_minutes)
          and not exists (select 1 from cash_checks c where c.user_id = me and c.test_id = v.test_id
                            and c.item_lo = v.item_lo and c.item_hi = v.item_hi)
        order by random() limit 1
        on conflict do nothing
        returning * into chk;
    end if;
    if chk.user_id is not null then
      select jsonb_build_object(
        'id', t.id, 'title', t.title, 'dim', t.dim, 'reward', 0,
        'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username, 'avatarUrl', p.avatar_url)
                  from profiles_public p where p.id = t.owner_id),
        'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'pos', i.pos, 'label', i.label, 'path', i.image_path) order by i.pos)
                  from arena_test_items i where i.test_id = t.id and i.id in (chk.item_lo, chk.item_hi)),
        'pairs', jsonb_build_array(jsonb_build_array(chk.item_lo, chk.item_hi)),
        'done', 0,
        'total', 1
      ) into chk_entry
      from arena_tests t where t.id = chk.test_id;
      if chk_entry is not null and jsonb_array_length(picked) < lim + 1 then
        -- somewhere in the list, not always last
        picked := (
          select jsonb_agg(x.e order by x.k)
          from (
            select e, ord::numeric as k from jsonb_array_elements(picked) with ordinality as p(e, ord)
            union all
            select chk_entry, random() * (jsonb_array_length(picked) + 1) + 0.5
          ) x
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'available', avail,
    'missionXp', coalesce((select mission_xp from arena_daily where user_id = me and day = utc_today), 0),
    'cap', 300,
    'tests', picked
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_test_vote: as in 0022, plus the money (per answer `cash` and `cashReason`, and the wallet in the reply) and the
-- second answer to a quality check (accepted, pays nothing, does not count twice for the author)
-- ----------------------------------------------------------------------------
create or replace function arena_test_vote(p_test uuid, p_votes jsonb, p_day date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  today date := coalesce(p_day, (now() at time zone 'utc')::date);
  t arena_tests;
  prof arena_profiles;
  d arena_daily;
  old_badges text[];
  new_badges text[];
  v jsonb;
  va uuid;
  vb uuid;
  vwin uuid;
  vms int;
  lo uuid;
  hi uuid;
  n_items int;
  n_pairs int;
  my_pairs int;
  results jsonb := '[]'::jsonb;
  first_vote boolean;
  room int;
  base_xp int;
  bonus int;
  gained int;
  got bigint;
  a_votes int;
  b_votes int;
  total_xp int := 0;
  accepted int := 0;
  earned jsonb;
  cash_total bigint := 0;
  touched_cash boolean := false;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_votes is null or jsonb_typeof(p_votes) <> 'array' or jsonb_array_length(p_votes) > 12 then
    raise exception 'Too many votes in one request.';
  end if;
  if today < utc_today - 1 or today > utc_today + 1 then
    today := utc_today;
  end if;

  -- serialises the voters of one test (its counters and its cash budget) and the player's own rows
  select * into t from arena_tests where id = p_test for update;
  if not found or t.status <> 'open' then
    raise exception 'This test is not open.' using hint = 'closed';
  end if;
  if t.owner_id = me then
    raise exception 'You cannot answer your own test.' using hint = 'own';
  end if;

  insert into arena_profiles (user_id) values (me) on conflict (user_id) do nothing;
  select * into prof from arena_profiles where user_id = me for update;
  old_badges := prof.badges;
  insert into arena_daily (user_id, day) values (me, today) on conflict (user_id, day) do nothing;
  select * into d from arena_daily where user_id = me and day = today for update;
  select count(*) into n_items from arena_test_items where test_id = t.id;
  n_pairs := n_items * (n_items - 1) / 2;

  for v in select value from jsonb_array_elements(p_votes) loop
    begin
      va := (v->>'a')::uuid;
      vb := (v->>'b')::uuid;
      vwin := (v->>'pick')::uuid;
      vms := least(greatest(coalesce((v->>'ms')::int, 0), 0), 600000);
      if va = vb or vwin not in (va, vb) then
        raise exception 'invalid';
      end if;
      lo := least(va, vb);
      hi := greatest(va, vb);
      if (select count(*) from arena_test_items where test_id = t.id and id in (lo, hi)) <> 2 then
        raise exception 'invalid';
      end if;
    exception when others then
      results := results || jsonb_build_object('accepted', false, 'reason', 'invalid');
      continue;
    end;

    -- The second answer to a quality check: recorded, never paid in money, never counted twice for the author. It earns
    -- the usual XP, so on screen it is an answer like any other (a "+0 XP" would give the check away).
    if exists (select 1 from arena_test_votes where test_id = t.id and voter_id = me and item_lo = lo and item_hi = hi) then
      if _cash_answer_check(me, t.id, lo, hi, vwin) then
        touched_cash := true;
        room := greatest(300 - d.mission_xp, 0);
        base_xp := least(12, room);
        d.mission_votes := d.mission_votes + 1;
        d.mission_xp := d.mission_xp + base_xp;
        total_xp := total_xp + base_xp;
        accepted := accepted + 1;
        select count(*) filter (where winner = lo), count(*) filter (where winner = hi)
          into a_votes, b_votes
          from arena_test_votes where test_id = t.id and item_lo = lo and item_hi = hi;
        results := results || jsonb_build_object(
          'accepted', true, 'xp', base_xp, 'bonus', 0, 'capped', base_xp < 12, 'cash', 0, 'cashReason', null,
          'a', lo, 'b', hi, 'aVotes', a_votes, 'bVotes', b_votes
        );
      else
        results := results || jsonb_build_object('accepted', false, 'reason', 'duplicate');
      end if;
      continue;
    end if;

    if d.mission_votes >= 500 then
      results := results || jsonb_build_object('accepted', false, 'reason', 'cap');
      continue;
    end if;

    first_vote := not exists (select 1 from arena_test_votes where test_id = t.id and voter_id = me);
    room := greatest(300 - d.mission_xp, 0);
    base_xp := least(12, room);
    got := null;
    insert into arena_test_votes (test_id, voter_id, item_lo, item_hi, winner, ms, xp)
      values (t.id, me, lo, hi, vwin, vms, base_xp)
      on conflict do nothing
      returning id into got;
    if got is null then
      results := results || jsonb_build_object('accepted', false, 'reason', 'duplicate');
      continue;
    end if;

    -- the finishing touch: every pair of this test answered
    select count(*) into my_pairs from arena_test_votes where test_id = t.id and voter_id = me;
    bonus := 0;
    if my_pairs >= n_pairs then
      bonus := least(20, greatest(room - base_xp, 0));
      if bonus > 0 then
        update arena_test_votes set xp = xp + bonus where id = got;
      end if;
    end if;
    gained := base_xp + bonus;

    -- the money (only a funded test pays; every rule is checked inside)
    earned := _cash_earn(me, t.id, got, vms);
    if (earned->>'amount')::bigint > 0 or t.cash_reward > 0 then
      touched_cash := true;
    end if;
    cash_total := cash_total + (earned->>'amount')::bigint;

    update arena_tests
      set votes_count = votes_count + 1,
          voters_count = voters_count + case when first_vote then 1 else 0 end
      where id = t.id
      returning * into t;
    if t.votes_count >= t.target_votes then
      update arena_tests set status = 'closed', closed_at = now() where id = t.id and status = 'open';
    end if;

    d.mission_votes := d.mission_votes + 1;
    d.mission_xp := d.mission_xp + gained;
    total_xp := total_xp + gained;
    accepted := accepted + 1;

    select count(*) filter (where winner = lo), count(*) filter (where winner = hi)
      into a_votes, b_votes
      from arena_test_votes where test_id = t.id and item_lo = lo and item_hi = hi;
    results := results || jsonb_build_object(
      'accepted', true, 'xp', gained, 'bonus', bonus, 'capped', base_xp < 12,
      'cash', (earned->>'amount')::bigint, 'cashReason', earned->'reason',
      'a', lo, 'b', hi, 'aVotes', a_votes, 'bVotes', b_votes
    );
  end loop;

  if accepted > 0 then
    update arena_daily
      set mission_votes = d.mission_votes, mission_xp = d.mission_xp, xp = xp + total_xp
      where user_id = me and day = today;
    prof.xp_total := prof.xp_total + total_xp;
    -- a day with a mission in it is an active day
    if prof.last_day is null then
      prof.streak_days := 1;
      prof.last_day := today;
    elsif today = prof.last_day then
      prof.streak_days := greatest(prof.streak_days, 1);
    elsif today = prof.last_day + 1 then
      prof.streak_days := prof.streak_days + 1;
      prof.last_day := today;
    elsif today > prof.last_day + 1 then
      prof.streak_days := 1;
      prof.last_day := today;
    end if;
    prof.best_streak := greatest(prof.best_streak, prof.streak_days);
    prof.badges := (
      select coalesce(array_agg(distinct b), '{}'::text[])
      from unnest(prof.badges || arena_badges_for(
        prof.votes_total, prof.best_streak, prof.best_combo, prof.xp_total, prof.eye_correct, prof.eye_total,
        prof.crowd_hits, prof.crowd_total, cardinality(prof.families_seen), prof.best_day_seconds, prof.daily_sets
      )) as b
    );
    new_badges := array(select unnest(prof.badges) except select unnest(old_badges));
    update arena_profiles set
      xp_total = prof.xp_total, streak_days = prof.streak_days, best_streak = prof.best_streak,
      last_day = prof.last_day, badges = prof.badges, updated_at = now()
    where user_id = me;
  else
    new_badges := '{}';
  end if;

  return jsonb_build_object(
    'results', results,
    'xp', total_xp,
    'cash', cash_total,
    'missionXp', d.mission_xp,
    'cap', 300,
    'status', (select status from arena_tests where id = p_test),
    'newBadges', to_jsonb(new_badges),
    'wallet', case when touched_cash then _cash_wallet_json(me) else null end,
    'state', arena_state_json(me, today),
    'days', coalesce((select jsonb_agg(arena_day_json(x) order by x.day) from arena_daily x where x.user_id = me and x.day = today), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- admins: fund tests, watch the money, review accounts, (later) settle payouts. Every change is audited.
-- ----------------------------------------------------------------------------
create or replace function cash_admin_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  utc_today date := (now() at time zone 'utc')::date;
begin
  perform _require_admin();
  return jsonb_build_object(
    'settings', to_jsonb(s) - 'id' - 'updated_by',
    -- what the platform owes players: pending (holding period), available (could be withdrawn), reserved (requested)
    'pending', coalesce((select sum(amount) from cash_ledger where kind = 'earn' and state = 'pending'), 0),
    'available', coalesce((select sum(amount) from cash_ledger where (kind in ('earn', 'adjustment') and state = 'available')
                                                                  or (kind = 'payout' and state in ('pending', 'settled'))), 0),
    'reserved', coalesce((select -sum(amount) from cash_ledger where kind = 'payout' and state = 'pending'), 0),
    'paidOut', coalesce((select -sum(amount) from cash_ledger where kind = 'payout' and state = 'settled'), 0),
    'earnedToday', coalesce((select sum(amount) from cash_ledger where kind = 'earn' and state <> 'void'
                               and created_at >= (utc_today::timestamp at time zone 'utc')), 0),
    'earned7d', coalesce((select sum(amount) from cash_ledger where kind = 'earn' and state <> 'void'
                            and created_at >= now() - interval '7 days'), 0),
    'earners7d', (select count(distinct user_id) from cash_ledger where kind = 'earn' and created_at >= now() - interval '7 days'),
    'budgetLeft', coalesce((select sum(cash_budget - cash_spent) from arena_tests where status = 'open' and cash_reward > 0), 0),
    'fundedOpen', (select count(*) from arena_tests where status = 'open' and cash_reward > 0 and cash_budget > cash_spent),
    'review', (select count(*) from cash_accounts where status = 'review'),
    'blocked', (select count(*) from cash_accounts where status = 'blocked'),
    'openPayouts', (select count(*) from cash_payout_requests where status = 'requested')
  );
end;
$$;

-- Tests an admin may fund: open ones first, with their answers and funding.
create or replace function cash_admin_tests(p_query text default '', p_limit int default 30)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(x.j order by x.o1, x.o2 desc)
    from (
      select jsonb_build_object(
        'id', t.id, 'title', t.title, 'dim', t.dim, 'status', t.status,
        'votes', t.votes_count, 'target', t.target_votes, 'createdAt', t.created_at,
        'reward', t.cash_reward, 'budget', t.cash_budget, 'spent', t.cash_spent,
        'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username) from profiles p where p.id = t.owner_id)
      ) as j,
      case when t.status = 'open' then 0 else 1 end as o1, t.created_at as o2
      from arena_tests t
      where t.status in ('open', 'closed')
        and (q = '' or lower(t.title) like '%' || q || '%')
      order by case when t.status = 'open' then 0 else 1 end, t.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Sets what a test pays per answer and its total budget (both in tiyn). Budget 0 / reward 0 stops the paying; the budget
-- can never go below what has already been paid out of it.
create or replace function cash_admin_fund_test(p_test uuid, p_reward bigint, p_budget bigint)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  t arena_tests;
begin
  perform _require_admin();
  select * into t from arena_tests where id = p_test for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p_reward is null or p_reward < 0 or p_reward > s.max_reward then
    raise exception 'bad_reward';
  end if;
  if p_budget is null or p_budget < t.cash_spent or p_budget > 100000000 then
    raise exception 'bad_budget';
  end if;
  update arena_tests set cash_reward = p_reward, cash_budget = p_budget where id = p_test returning * into t;
  perform _admin_log('cash_fund_test', t.owner_id, jsonb_build_object('test', t.id, 'title', t.title, 'reward', p_reward, 'budget', p_budget, 'spent', t.cash_spent));
  return jsonb_build_object('id', t.id, 'reward', t.cash_reward, 'budget', t.cash_budget, 'spent', t.cash_spent);
end;
$$;

-- Accounts: everyone on review first, then the biggest balances.
create or replace function cash_admin_accounts(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', a.user_id, 'name', p.full_name, 'username', p.username, 'status', a.status, 'note', a.status_note,
      'statusAt', a.status_at, 'pending', a.pending, 'available', a.available, 'reserved', a.reserved,
      'paidOut', a.paid_out, 'earnedTotal', a.earned_total, 'checks', a.checks_total, 'consistent', a.checks_consistent,
      'lastPaidAt', a.last_paid_at
    ) order by case a.status when 'review' then 0 when 'blocked' then 1 else 2 end, a.pending + a.available desc)
    from (
      select * from cash_accounts
      where (p_status is null or status = p_status) and (earned_total > 0 or status <> 'ok' or checks_total > 0)
      order by case status when 'review' then 0 when 'blocked' then 1 else 2 end, pending + available desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) a
    join profiles p on p.id = a.user_id
  ), '[]'::jsonb);
end;
$$;

-- ok: clears a review (matured bonuses are released on the next read). review: freezes the releases.
-- blocked: no more earning; every pending bonus is voided, and the available ones too when p_void_available.
create or replace function cash_admin_set_status(p_user uuid, p_status text, p_note text default null, p_void_available boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a cash_accounts;
  old_status text;
  voided bigint := 0;
begin
  perform _require_admin();
  if p_status not in ('ok', 'review', 'blocked') then
    raise exception 'bad_status';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'not_found';
  end if;
  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select status into old_status from cash_accounts where user_id = p_user for update;
  update cash_accounts set status = p_status, status_note = left(nullif(trim(coalesce(p_note, '')), ''), 300), status_at = now(), updated_at = now()
    where user_id = p_user;
  if p_status = 'blocked' then
    with v as (
      update cash_ledger set state = 'void', note = coalesce(note, 'blocked')
      where user_id = p_user and kind = 'earn' and (state = 'pending' or (p_void_available and state = 'available'))
      returning amount
    ) select coalesce(sum(amount), 0) into voided from v;
  end if;
  a := case when p_status = 'ok' then _cash_release(p_user) else _cash_recompute(p_user) end;
  perform _admin_log('cash_status', p_user, jsonb_build_object('from', old_status, 'to', p_status, 'note', p_note, 'voided', voided));
  return jsonb_build_object('userId', p_user, 'status', a.status, 'pending', a.pending, 'available', a.available, 'voided', voided);
end;
$$;

-- Takes one bonus back (pending or available), with a reason the player sees.
create or replace function cash_admin_void(p_entry bigint, p_note text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  l cash_ledger;
begin
  perform _require_admin();
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'note_required';
  end if;
  select * into l from cash_ledger where id = p_entry for update;
  if not found or l.kind <> 'earn' or l.state not in ('pending', 'available') then
    raise exception 'not_found';
  end if;
  update cash_ledger set state = 'void', note = left(trim(p_note), 300) where id = p_entry;
  perform _cash_recompute(l.user_id);
  perform _admin_log('cash_void', l.user_id, jsonb_build_object('entry', l.id, 'amount', l.amount, 'note', p_note));
  return jsonb_build_object('id', l.id, 'state', 'void');
end;
$$;

-- Changes the rules. Opening payouts is for the owner only, and only once a payment provider exists.
create or replace function cash_admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings;
  allowed text[] := array['earning_enabled', 'payouts_enabled', 'hold_days', 'user_daily_cap', 'max_reward', 'min_payout',
                          'min_answer_ms', 'min_gap_ms', 'min_account_hours', 'min_arena_votes', 'check_rate',
                          'check_age_minutes', 'check_min', 'check_floor'];
  k text;
begin
  perform _require_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'bad_patch';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'bad_patch';
    end if;
  end loop;
  if p_patch ? 'payouts_enabled' and not coalesce((select is_owner from profiles where id = auth.uid()), false) then
    raise exception 'not_owner';
  end if;
  select * into s from cash_settings where id for update;
  s := jsonb_populate_record(s, p_patch);
  update cash_settings set
    earning_enabled = s.earning_enabled, payouts_enabled = s.payouts_enabled, hold_days = s.hold_days,
    user_daily_cap = s.user_daily_cap, max_reward = s.max_reward, min_payout = s.min_payout,
    min_answer_ms = s.min_answer_ms, min_gap_ms = s.min_gap_ms, min_account_hours = s.min_account_hours,
    min_arena_votes = s.min_arena_votes, check_rate = s.check_rate, check_age_minutes = s.check_age_minutes,
    check_min = s.check_min, check_floor = s.check_floor, updated_at = now(), updated_by = auth.uid()
  where id
  returning * into s;
  perform _admin_log('cash_settings', null, p_patch);
  return to_jsonb(s) - 'id' - 'updated_by';
end;
$$;

create or replace function cash_admin_payouts(p_status text default 'requested', p_limit int default 50)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'userId', r.user_id, 'name', p.full_name, 'username', p.username, 'amount', r.amount,
      'status', r.status, 'createdAt', r.created_at, 'decidedAt', r.decided_at, 'note', r.note
    ) order by r.created_at)
    from (select * from cash_payout_requests where p_status is null or status = p_status
          order by created_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) r
    join profiles p on p.id = r.user_id
  ), '[]'::jsonb);
end;
$$;

-- paid: the transfer went through (the reserved amount leaves the balance for good). rejected: it did not (the amount
-- comes back to the available balance).
create or replace function cash_admin_decide_payout(p_request uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r cash_payout_requests;
begin
  perform _require_admin();
  if p_decision not in ('paid', 'rejected') then
    raise exception 'bad_decision';
  end if;
  select * into r from cash_payout_requests where id = p_request for update;
  if not found or r.status <> 'requested' then
    raise exception 'not_found';
  end if;
  update cash_payout_requests set status = p_decision, decided_at = now(), decided_by = auth.uid(),
    note = left(nullif(trim(coalesce(p_note, '')), ''), 300)
  where id = p_request;
  update cash_ledger set state = case when p_decision = 'paid' then 'settled' else 'void' end,
    note = left(nullif(trim(coalesce(p_note, '')), ''), 300)
  where payout_id = p_request and kind = 'payout' and state = 'pending';
  perform _cash_recompute(r.user_id);
  perform _admin_log('cash_payout_' || p_decision, r.user_id, jsonb_build_object('request', r.id, 'amount', r.amount, 'note', p_note));
  return jsonb_build_object('id', r.id, 'status', p_decision);
end;
$$;


-- ----------------------------------------------------------------------------
-- who may call what
-- ----------------------------------------------------------------------------
revoke all on function cash_ledger_guard() from public, anon, authenticated;
revoke all on function _cash_settings() from public, anon, authenticated;
revoke all on function _cash_recompute(uuid) from public, anon, authenticated;
revoke all on function _cash_release(uuid) from public, anon, authenticated;
revoke all on function _cash_eligibility(uuid) from public, anon, authenticated;
revoke all on function _cash_earn(uuid, uuid, bigint, int) from public, anon, authenticated;
revoke all on function _cash_answer_check(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function _cash_wallet_json(uuid) from public, anon, authenticated;
revoke all on function cash_wallet() from public, anon;
revoke all on function cash_request_payout(bigint) from public, anon;
revoke all on function arena_test_queue(int) from public, anon;
revoke all on function arena_test_vote(uuid, jsonb, date) from public, anon;
revoke all on function cash_admin_overview() from public, anon;
revoke all on function cash_admin_tests(text, int) from public, anon;
revoke all on function cash_admin_fund_test(uuid, bigint, bigint) from public, anon;
revoke all on function cash_admin_accounts(text, int) from public, anon;
revoke all on function cash_admin_set_status(uuid, text, text, boolean) from public, anon;
revoke all on function cash_admin_void(bigint, text) from public, anon;
revoke all on function cash_admin_update_settings(jsonb) from public, anon;
revoke all on function cash_admin_payouts(text, int) from public, anon;
revoke all on function cash_admin_decide_payout(uuid, text, text) from public, anon;
grant execute on function cash_wallet() to authenticated;
grant execute on function cash_request_payout(bigint) to authenticated;
grant execute on function arena_test_queue(int) to authenticated;
grant execute on function arena_test_vote(uuid, jsonb, date) to authenticated;
grant execute on function cash_admin_overview() to authenticated;
grant execute on function cash_admin_tests(text, int) to authenticated;
grant execute on function cash_admin_fund_test(uuid, bigint, bigint) to authenticated;
grant execute on function cash_admin_accounts(text, int) to authenticated;
grant execute on function cash_admin_set_status(uuid, text, text, boolean) to authenticated;
grant execute on function cash_admin_void(bigint, text) to authenticated;
grant execute on function cash_admin_update_settings(jsonb) to authenticated;
grant execute on function cash_admin_payouts(text, int) to authenticated;
grant execute on function cash_admin_decide_payout(uuid, text, text) to authenticated;
-- the tables themselves: reads go through RLS (own rows only), writes only through the functions above
revoke insert, update, delete, truncate on cash_settings, cash_accounts, cash_ledger, cash_checks, cash_payout_requests from anon, authenticated;
revoke select on cash_settings, cash_checks from anon, authenticated;
