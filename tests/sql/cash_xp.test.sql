-- Arena cash part 2 (migration 0028): XP turns into tenge (100 XP = 1 tenge = 100 tiyn), at most 3 000 tenge a month.
-- Runs after cash.test.sql on the same database (tests/sql/run.sh); uses its own people.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
select set_config('t.passed', '0', false);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'xp1@x'), ('00000000-0000-0000-0000-0000000000c2', 'xp2@x'),
  ('00000000-0000-0000-0000-0000000000c3', 'xpnew@x'), ('00000000-0000-0000-0000-0000000000c4', 'xp4@x');
insert into profiles (id, full_name, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'Xp One', now() - interval '5 days'),
  ('00000000-0000-0000-0000-0000000000c2', 'Xp Two', now() - interval '5 days'),
  ('00000000-0000-0000-0000-0000000000c3', 'Xp New', now()),
  ('00000000-0000-0000-0000-0000000000c4', 'Xp Four', now() - interval '5 days')
on conflict (id) do update set created_at = excluded.created_at;
insert into arena_profiles (user_id, votes_total, xp_total) values
  ('00000000-0000-0000-0000-0000000000c1', 40, 1000), ('00000000-0000-0000-0000-0000000000c2', 40, 1000),
  ('00000000-0000-0000-0000-0000000000c3', 40, 1000), ('00000000-0000-0000-0000-0000000000c4', 10, 1000)
on conflict (user_id) do nothing;
-- the defaults of 0028 (cash.test.sql switched the conversion off for its own blocks)
update cash_settings set xp_per_tenge = 100, monthly_cap = 300000, user_daily_cap = 50000, earning_enabled = true, check_rate = 0, min_gap_ms = 0;

do $$
declare c1 uuid := '00000000-0000-0000-0000-0000000000c1'; w jsonb;
begin
  perform t.ok((select monthly_cap = 300000 and xp_per_tenge = 100 from cash_settings), 'defaults: 3 000 tenge a month, 100 XP = 1 tenge');
  perform t.ok(not exists (select 1 from cash_ledger where user_id = c1), 'XP earned before is not converted retroactively');
  update arena_profiles set xp_total = xp_total + 500 where user_id = c1;
  perform t.ok((select count(*) = 1 and sum(amount) = 500 from cash_ledger where user_id = c1 and source = 'xp' and kind = 'earn' and state = 'pending'),
               '500 XP -> 500 tiyn (5 tenge), pending');
  w := t.wallet(c1);
  perform t.ok((w->>'pending')::bigint = 500 and (w->>'month')::bigint = 500 and (w->>'monthLeft')::bigint = 299500, 'wallet: pending, this month, left this month');
  perform t.ok((w->'rules'->>'monthlyCap')::bigint = 300000 and (w->'rules'->>'xpPerTenge')::int = 100, 'wallet: the rules say the rate and the limit');
  perform t.ok(t.raises(format($q$update cash_ledger set source = 'mission' where user_id = '%s'$q$, c1)) like '%never change%', 'ledger: the source never changes');
  perform t.ok(t.raises(format($q$insert into cash_ledger (user_id, kind, source, amount, state, vote_id) values ('%s', 'earn', 'xp', 5, 'pending', 1)$q$, c1)) like '%violates check%', 'ledger: an XP row has no answer');
end $$;

-- the real path: an Arena vote re-derived by arena_submit, its XP converted 1:1 into tiyn
do $$
declare c1 uuid := '00000000-0000-0000-0000-0000000000c1'; r jsonb; vxp int; before bigint;
begin
  select coalesce(sum(amount), 0) into before from cash_ledger where user_id = c1;
  perform t.as_user(c1);
  r := arena_submit(jsonb_build_array(jsonb_build_object(
         'id', gen_random_uuid(), 'pair', to_char(now() at time zone 'utc', 'YYYYMM') || '/mark/1-2', 'dim', 'preference',
         'pick', 0, 'ms', 2000, 'bonus', 3, 'combo', 1)), '[]'::jsonb, null, null);
  perform t.ok((r->'results'->0->>'accepted')::boolean, 'arena_submit: vote accepted');
  vxp := (r->'results'->0->>'xp')::int;
  perform t.ok(vxp between 10 and 25, 'arena_submit: XP re-derived on the server');
  perform t.ok((select sum(amount) from cash_ledger where user_id = c1) - before = vxp, format('arena_submit: %s XP -> %s tiyn', vxp, vxp));
end $$;

-- another rate: 200 XP = 1 tenge, the remainder is carried
do $$
declare c2 uuid := '00000000-0000-0000-0000-0000000000c2';
begin
  update cash_settings set xp_per_tenge = 200;
  update arena_profiles set xp_total = xp_total + 150 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 75, 'rate 200: 150 XP -> 75 tiyn');
  update arena_profiles set xp_total = xp_total + 3 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 76 and (select xp_carry from cash_accounts where user_id = c2) = 100, 'rate 200: 3 XP -> 1 tiyn, half a tiyn carried');
  update arena_profiles set xp_total = xp_total + 1 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 77 and (select xp_carry from cash_accounts where user_id = c2) = 0, 'rate 200: the carry completes a tiyn');
  update cash_settings set xp_per_tenge = 0;
  update arena_profiles set xp_total = xp_total + 1000 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 77, 'rate 0: conversion off');
  update cash_settings set xp_per_tenge = 100;
end $$;

-- the monthly limit: an increase that crosses it is cut to what is left; after that nothing is converted
do $$
declare c2 uuid := '00000000-0000-0000-0000-0000000000c2'; r jsonb;
begin
  update cash_settings set monthly_cap = 1000;
  update arena_profiles set xp_total = xp_total + 5000 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 1000, 'month: 77 + 5000 cut to the 1000-tiyn limit');
  update arena_profiles set xp_total = xp_total + 300 where user_id = c2;
  perform t.ok((select sum(amount) from cash_ledger where user_id = c2) = 1000, 'month: nothing more once reached');
  perform t.ok((t.wallet(c2)->>'monthLeft')::bigint = 0, 'month: wallet says 0 left');
  -- a funded mission reward over the monthly limit is refused with its own reason
  r := t.vote(c2, '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000031');
  perform t.ok((r->'results'->0->>'accepted')::boolean and r->'results'->0->>'cashReason' = 'month_cap' and (r->'results'->0->>'cash')::bigint = 0, 'month: mission reward refused, reason month_cap');
  -- last month's money does not count against this month
  insert into cash_ledger (user_id, kind, source, amount, state, available_at, created_at)
    values ('00000000-0000-0000-0000-0000000000c1', 'earn', 'xp', 900, 'available', now() - interval '20 days',
            date_trunc('month', now() at time zone 'utc') at time zone 'utc' - interval '1 day');
  perform t.ok((t.wallet('00000000-0000-0000-0000-0000000000c1')->>'month')::bigint < 900, 'month: last month''s rows are not counted');
  update cash_settings set monthly_cap = 300000;
end $$;

-- the daily limit cuts the same way
do $$
declare c1 uuid := '00000000-0000-0000-0000-0000000000c1'; today bigint;
begin
  today := (t.wallet(c1)->>'today')::bigint;
  update cash_settings set user_daily_cap = today + 100;
  update arena_profiles set xp_total = xp_total + 400 where user_id = c1;
  perform t.ok((t.wallet(c1)->>'today')::bigint = today + 100, 'day: cut to the daily limit');
  update cash_settings set user_daily_cap = 50000;
end $$;

-- who earns nothing: a new account, too few duels, a blocked account, bonuses paused
do $$
declare c3 uuid := '00000000-0000-0000-0000-0000000000c3'; c4 uuid := '00000000-0000-0000-0000-0000000000c4'; c1 uuid := '00000000-0000-0000-0000-0000000000c1'; n bigint;
begin
  update arena_profiles set xp_total = xp_total + 500 where user_id in (c3, c4);
  perform t.ok(not exists (select 1 from cash_ledger where user_id in (c3, c4)), 'new account / under 30 duels: no conversion');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform cash_admin_set_status(c1, 'blocked', 'test');
  select count(*) into n from cash_ledger where user_id = c1 and state <> 'void' and created_at > now() - interval '1 day';
  update arena_profiles set xp_total = xp_total + 500 where user_id = c1;
  perform t.ok((select count(*) from cash_ledger where user_id = c1 and state <> 'void' and created_at > now() - interval '1 day') = n, 'blocked: no conversion');
  perform cash_admin_set_status(c1, 'ok', null);
  update cash_settings set earning_enabled = false;
  select count(*) into n from cash_ledger where user_id = c1;
  update arena_profiles set xp_total = xp_total + 500 where user_id = c1;
  perform t.ok((select count(*) from cash_ledger where user_id = c1) = n, 'paused: no conversion');
  update cash_settings set earning_enabled = true;
end $$;

-- the wallet shows the XP of a day as one line; admins can change the two new rules, players cannot
do $$
declare c1 uuid := '00000000-0000-0000-0000-0000000000c1'; w jsonb; lines int;
begin
  update arena_profiles set xp_total = xp_total + 10 where user_id = c1;
  update arena_profiles set xp_total = xp_total + 20 where user_id = c1;
  w := t.wallet(c1);
  select count(*) into lines from jsonb_array_elements(w->'history') e
    where e->>'kind' = 'xp' and e->>'state' = 'pending' and (e->>'at')::timestamptz > now() - interval '1 hour';
  perform t.ok(lines = 1, 'history: today''s pending XP is one line');
  perform t.ok((select (e->>'amount')::bigint from jsonb_array_elements(w->'history') e where e->>'kind' = 'xp' and e->>'state' = 'pending' order by e->>'at' desc limit 1)
               = (select sum(amount) from cash_ledger where user_id = c1 and source = 'xp' and state = 'pending' and (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date),
               'history: the line is the sum of the day');
  perform t.as_user(c1);
  perform t.ok(t.raises($q$select cash_admin_update_settings('{"xp_per_tenge": 1}')$q$) = 'not_admin', 'settings: a player cannot change the rate');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok((cash_admin_update_settings('{"monthly_cap": 500000, "xp_per_tenge": 50}')->>'monthly_cap')::bigint = 500000, 'settings: an admin changes the limit and the rate');
  perform t.ok(t.raises($q$select cash_admin_update_settings('{"monthly_cap": -1}')$q$) like '%violates check%', 'settings: a negative limit is refused');
  perform cash_admin_update_settings('{"monthly_cap": 300000, "xp_per_tenge": 100}');
  -- the cache still equals the ledger for everyone
  perform t.ok(not exists (
    select 1 from cash_accounts a, lateral (select * from _cash_recompute(a.user_id)) b
    where a.pending <> b.pending or a.available <> b.available), 'cache matches ledger');
end $$;

do $$ begin raise notice 'cash_xp: % assertions passed', current_setting('t.passed'); end $$;
