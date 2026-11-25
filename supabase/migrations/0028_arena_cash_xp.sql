-- ============================================================================
-- Affinix -- Arena cash, part 2: XP turns into tenge, with a monthly limit
--
-- 0027 paid a bonus only for answers to funded missions. Now every XP point a player earns in the Arena (duels, quests,
-- sets, the weekly theme, missions) also earns money at a fixed rate: by default 100 XP = 1 tenge, i.e. 1 XP = 1 tiyn.
-- A person can earn at most monthly_cap a calendar month (UTC), 3 000 tenge by default; a sponsored mission's reward
-- (0027) counts towards the same limit.
--
-- How: every XP change goes through arena_profiles.xp_total, and only upwards, in the SECURITY DEFINER functions that
-- re-derive XP on the server (arena_submit, arena_claim, arena_test_vote). A trigger on that column converts the
-- increase. The browser never says how much XP it earned, so it cannot say how much money either.
--
-- The rest of 0027 applies unchanged: the same eligibility (24 h old account, 30 duels; XP earned before that is not
-- converted), the holding period, review / block, the append-only ledger. A conversion that would cross the daily or the
-- monthly limit is cut to what is left (not refused), and nothing is converted once a limit is reached.
--
-- Ledger rows from XP have kind 'earn' and source 'xp'; mission bonuses have source 'mission' (the source means nothing
-- for adjustment and payout rows, which keep the default).
-- Safe to run more than once.
-- ============================================================================

alter table cash_settings add column if not exists monthly_cap bigint not null default 300000;
alter table cash_settings add column if not exists xp_per_tenge int not null default 100;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cash_settings_monthly_cap_ok') then
    alter table cash_settings add constraint cash_settings_monthly_cap_ok check (monthly_cap between 0 and 100000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_settings_xp_rate_ok') then
    -- 0 switches the XP conversion off; otherwise this many XP make one tenge
    alter table cash_settings add constraint cash_settings_xp_rate_ok check (xp_per_tenge between 0 and 100000);
  end if;
end $$;

alter table cash_ledger add column if not exists source text not null default 'mission';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cash_ledger_source_ok') then
    alter table cash_ledger add constraint cash_ledger_source_ok check (source in ('mission', 'xp'));
  end if;
  -- an earn row belongs to one mission answer, unless it comes from XP
  if exists (select 1 from pg_constraint where conname = 'cash_ledger_check' and conrelid = 'cash_ledger'::regclass) then
    alter table cash_ledger drop constraint cash_ledger_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_ledger_earn_ok') then
    alter table cash_ledger add constraint cash_ledger_earn_ok
      check (kind <> 'earn' or (amount > 0 and ((source = 'mission' and vote_id is not null) or (source = 'xp' and vote_id is null))));
  end if;
end $$;

-- the part of an XP increase that did not make a whole tiyn yet (only when xp_per_tenge is not a divisor of 100)
alter table cash_accounts add column if not exists xp_carry int not null default 0;

create index if not exists cash_ledger_month_idx on cash_ledger (user_id, created_at) where kind = 'earn';


-- ----------------------------------------------------------------------------
-- the ledger guard: the source is as fixed as the amount
-- ----------------------------------------------------------------------------
create or replace function cash_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from profiles where id = old.user_id) then
      raise exception 'cash_ledger rows are never deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind or new.amount <> old.amount
     or new.vote_id is distinct from old.vote_id or new.created_at <> old.created_at or new.source <> old.source then
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


-- ----------------------------------------------------------------------------
-- what is left under the limits: min(daily room, monthly room), never below 0
-- ----------------------------------------------------------------------------
create or replace function _cash_room(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  day_start timestamptz := ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  today_sum bigint;
  month_sum bigint;
begin
  select coalesce(sum(amount) filter (where created_at >= day_start), 0), coalesce(sum(amount), 0)
    into today_sum, month_sum
    from cash_ledger
    where user_id = p_user and kind = 'earn' and state <> 'void' and created_at >= least(day_start, month_start);
  return jsonb_build_object(
    'today', today_sum, 'month', month_sum,
    'day', greatest(s.user_daily_cap - today_sum, 0),
    'monthLeft', greatest(s.monthly_cap - month_sum, 0),
    'room', greatest(least(s.user_daily_cap - today_sum, s.monthly_cap - month_sum), 0),
    'reason', case when s.monthly_cap - month_sum <= 0 then 'month_cap' when s.user_daily_cap - today_sum <= 0 then 'cap' else null end
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- XP -> tiyn
-- ----------------------------------------------------------------------------
create or replace function _cash_accrue_xp(p_user uuid, p_xp bigint)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  a cash_accounts;
  units bigint;
  amount_t bigint;
  room jsonb;
begin
  if p_xp is null or p_xp <= 0 or s.xp_per_tenge <= 0 or not s.earning_enabled then
    return 0;
  end if;
  insert into cash_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into a from cash_accounts where user_id = p_user for update;
  if not (_cash_eligibility(p_user)->>'ok')::boolean then
    return 0;
  end if;
  -- XP * 100 tiyn / xp_per_tenge, the remainder carried to the next increase
  units := a.xp_carry + p_xp * 100;
  amount_t := units / s.xp_per_tenge;
  room := _cash_room(p_user);
  if amount_t > (room->>'room')::bigint then
    amount_t := (room->>'room')::bigint;
    units := amount_t * s.xp_per_tenge; -- the cut part is gone, not carried
  end if;
  update cash_accounts set xp_carry = least((units - amount_t * s.xp_per_tenge), 2147483647)::int where user_id = p_user;
  if amount_t <= 0 then
    return 0;
  end if;
  insert into cash_ledger (user_id, kind, source, amount, state, available_at)
    values (p_user, 'earn', 'xp', amount_t, 'pending', now() + make_interval(days => s.hold_days));
  update cash_accounts set pending = pending + amount_t, earned_total = earned_total + amount_t, updated_at = now()
    where user_id = p_user;
  return amount_t;
end;
$$;

create or replace function cash_on_xp()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.xp_total > old.xp_total then
    perform _cash_accrue_xp(new.user_id, new.xp_total - old.xp_total);
  end if;
  return new;
end;
$$;

drop trigger if exists cash_on_xp on arena_profiles;
create trigger cash_on_xp after update of xp_total on arena_profiles
  for each row when (new.xp_total > old.xp_total) execute function cash_on_xp();


-- ----------------------------------------------------------------------------
-- a funded mission's reward: as in 0027, plus the monthly limit (refused with 'month_cap', not cut: a reward is one sum)
-- ----------------------------------------------------------------------------
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
  room jsonb;
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
  room := _cash_room(p_user);
  if (room->>'monthLeft')::bigint < v_amount then
    return jsonb_build_object('amount', 0, 'reason', 'month_cap');
  end if;
  if (room->>'day')::bigint < v_amount then
    return jsonb_build_object('amount', 0, 'reason', 'cap');
  end if;

  insert into cash_ledger (user_id, kind, source, amount, state, available_at, test_id, vote_id)
    values (p_user, 'earn', 'mission', v_amount, 'pending', now() + make_interval(days => s.hold_days), p_test, p_vote);
  update arena_tests set cash_spent = cash_spent + v_amount where id = p_test;
  update cash_accounts set
    pending = pending + v_amount, earned_total = earned_total + v_amount, last_paid_at = now(), updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('amount', v_amount, 'reason', null);
end;
$$;


-- ----------------------------------------------------------------------------
-- the wallet: this month and its limit, the XP rate, and the XP rows of a day shown as one line
-- ----------------------------------------------------------------------------
create or replace function _cash_wallet_json(p_user uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  a cash_accounts;
  room jsonb;
begin
  a := _cash_release(p_user);
  room := _cash_room(p_user);
  return jsonb_build_object(
    'currency', s.currency,
    'status', a.status,
    'available', a.available,
    'pending', a.pending,
    'reserved', a.reserved,
    'paidOut', a.paid_out,
    'earnedTotal', a.earned_total,
    'today', (room->>'today')::bigint,
    'month', (room->>'month')::bigint,
    'monthLeft', (room->>'monthLeft')::bigint,
    'rules', jsonb_build_object(
      'earningEnabled', s.earning_enabled, 'payoutsEnabled', s.payouts_enabled, 'holdDays', s.hold_days,
      'dailyCap', s.user_daily_cap, 'monthlyCap', s.monthly_cap, 'xpPerTenge', s.xp_per_tenge,
      'minPayout', s.min_payout, 'minArenaVotes', s.min_arena_votes, 'minAccountHours', s.min_account_hours),
    'eligibility', _cash_eligibility(p_user),
    'nextRelease', (select jsonb_build_object('at', min(available_at), 'amount', sum(amount))
                      from cash_ledger where user_id = p_user and kind = 'earn' and state = 'pending'
                      having count(*) > 0),
    'openPayout', (select jsonb_build_object('id', r.id, 'amount', r.amount, 'createdAt', r.created_at)
                     from cash_payout_requests r where r.user_id = p_user and r.status = 'requested'),
    'history', coalesce((
      select jsonb_agg(h.j order by h.at desc, h.id desc)
      from (
        -- XP of one UTC day in one state: a single line ("Arena XP"), whatever number of rows it is made of
        select max(l.id) as id, max(l.created_at) as at, jsonb_build_object(
          'id', 'xp-' || (l.created_at at time zone 'utc')::date || '-' || l.state, 'kind', 'xp', 'amount', sum(l.amount),
          'state', l.state, 'at', max(l.created_at), 'availableAt', max(l.available_at), 'note', null, 'test', null) as j
        from cash_ledger l
        where l.user_id = p_user and l.kind = 'earn' and l.source = 'xp' and l.created_at > now() - interval '120 days'
        group by (l.created_at at time zone 'utc')::date, l.state
        union all
        select l.id, l.created_at, jsonb_build_object(
          'id', l.id, 'kind', l.kind, 'amount', l.amount, 'state', l.state, 'at', l.created_at,
          'availableAt', l.available_at, 'note', case when l.kind = 'earn' then null else l.note end,
          'test', case when t.id is null then null else jsonb_build_object('id', t.id, 'title', t.title) end)
        from (select * from cash_ledger where user_id = p_user and not (kind = 'earn' and source = 'xp') order by id desc limit 50) l
        left join arena_tests t on t.id = l.test_id
        order by 2 desc
        limit 50
      ) h
    ), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- admins: the two new rules can be changed like the others
-- ----------------------------------------------------------------------------
create or replace function cash_admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings;
  allowed text[] := array['earning_enabled', 'payouts_enabled', 'hold_days', 'user_daily_cap', 'monthly_cap', 'xp_per_tenge',
                          'max_reward', 'min_payout', 'min_answer_ms', 'min_gap_ms', 'min_account_hours', 'min_arena_votes',
                          'check_rate', 'check_age_minutes', 'check_min', 'check_floor'];
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
    user_daily_cap = s.user_daily_cap, monthly_cap = s.monthly_cap, xp_per_tenge = s.xp_per_tenge,
    max_reward = s.max_reward, min_payout = s.min_payout,
    min_answer_ms = s.min_answer_ms, min_gap_ms = s.min_gap_ms, min_account_hours = s.min_account_hours,
    min_arena_votes = s.min_arena_votes, check_rate = s.check_rate, check_age_minutes = s.check_age_minutes,
    check_min = s.check_min, check_floor = s.check_floor, updated_at = now(), updated_by = auth.uid()
  where id
  returning * into s;
  perform _admin_log('cash_settings', null, p_patch);
  return to_jsonb(s) - 'id' - 'updated_by';
end;
$$;

revoke all on function _cash_room(uuid) from public, anon, authenticated;
revoke all on function _cash_accrue_xp(uuid, bigint) from public, anon, authenticated;
revoke all on function cash_on_xp() from public, anon, authenticated;
revoke all on function _cash_earn(uuid, uuid, bigint, int) from public, anon, authenticated;
revoke all on function _cash_wallet_json(uuid) from public, anon, authenticated;
revoke all on function cash_admin_update_settings(jsonb) from public, anon;
grant execute on function cash_admin_update_settings(jsonb) to authenticated;
