-- ============================================================================
-- Affinix -- Arena cash, part 3: no daily limit, only the monthly one
--
-- 0027 / 0028 limited a person to 500 tenge a day AND 3 000 tenge a month. The wish: one limit, the monthly one
-- (monthly_cap, 3 000 tenge by default). So the daily limit goes away entirely: the column, the check in the mission
-- reward, the cut of an XP conversion, the 'cap' reason, the wallet's "today" figure and the admin setting.
--
-- What stays: the 3 000 tenge a month (UTC calendar month) for XP and mission rewards together, an XP conversion that
-- crosses it is cut to what is left, a mission reward that does not fit is refused with 'month_cap', and every other rule
-- of 0027 / 0028 (eligibility, speed, holding period, review / block, the append-only ledger).
--
-- Safe to run more than once, and safe whether 0027 / 0028 were applied before or together with this one.
-- ============================================================================

-- what is left under the monthly limit
create or replace function _cash_room(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s cash_settings := _cash_settings();
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  month_sum bigint;
begin
  select coalesce(sum(amount), 0) into month_sum
    from cash_ledger
    where user_id = p_user and kind = 'earn' and state <> 'void' and created_at >= month_start;
  return jsonb_build_object(
    'month', month_sum,
    'monthLeft', greatest(s.monthly_cap - month_sum, 0),
    'room', greatest(s.monthly_cap - month_sum, 0),
    'reason', case when s.monthly_cap - month_sum <= 0 then 'month_cap' else null end
  );
end;
$$;

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

  insert into cash_ledger (user_id, kind, source, amount, state, available_at, test_id, vote_id)
    values (p_user, 'earn', 'mission', v_amount, 'pending', now() + make_interval(days => s.hold_days), p_test, p_vote);
  update arena_tests set cash_spent = cash_spent + v_amount where id = p_test;
  update cash_accounts set
    pending = pending + v_amount, earned_total = earned_total + v_amount, last_paid_at = now(), updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('amount', v_amount, 'reason', null);
end;
$$;

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
    'month', (room->>'month')::bigint,
    'monthLeft', (room->>'monthLeft')::bigint,
    'rules', jsonb_build_object(
      'earningEnabled', s.earning_enabled, 'payoutsEnabled', s.payouts_enabled, 'holdDays', s.hold_days,
      'monthlyCap', s.monthly_cap, 'xpPerTenge', s.xp_per_tenge,
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

create or replace function cash_admin_update_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s cash_settings;
  allowed text[] := array['earning_enabled', 'payouts_enabled', 'hold_days', 'monthly_cap', 'xp_per_tenge',
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
    monthly_cap = s.monthly_cap, xp_per_tenge = s.xp_per_tenge,
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

-- the daily limit is gone for good
alter table cash_settings drop column if exists user_daily_cap;
drop index if exists cash_ledger_day_idx;

revoke all on function _cash_room(uuid) from public, anon, authenticated;
revoke all on function _cash_earn(uuid, uuid, bigint, int) from public, anon, authenticated;
revoke all on function _cash_wallet_json(uuid) from public, anon, authenticated;
revoke all on function cash_admin_update_settings(jsonb) from public, anon;
grant execute on function cash_admin_update_settings(jsonb) to authenticated;
