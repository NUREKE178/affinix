-- Arena cash (migration 0027): the money rules, the ledger's guarantees and the admin side, on a real PostgreSQL.
-- Run with tests/sql/run.sh. Every block raises on the first broken expectation.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  perform set_config('t.passed', (coalesce(nullif(current_setting('t.passed', true), ''), '0')::int + 1)::text, false);
end $$;
create or replace function t.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false) $$;
-- expects `sql` to raise; returns the hint (or the message when there is no hint)
create or replace function t.raises(sql text) returns text language plpgsql as $$
declare h text; m text;
begin
  execute sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint, m = message_text;
  return coalesce(nullif(h, ''), m);
end $$;
create or replace function t.vote(u uuid, test uuid, a uuid, b uuid, pick uuid, ms int default 1500) returns jsonb language plpgsql as $$
begin
  perform t.as_user(u);
  return arena_test_vote(test, jsonb_build_array(jsonb_build_object('a', a, 'b', b, 'pick', pick, 'ms', ms)), null);
end $$;
create or replace function t.wallet(u uuid) returns jsonb language plpgsql as $$
begin perform t.as_user(u); return cash_wallet(); end $$;

-- people: an owner (admin + owner), an admin, a test author, two players, a brand-new account
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@x'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@x'),
  ('00000000-0000-0000-0000-0000000000a3', 'author@x'),
  ('00000000-0000-0000-0000-0000000000b1', 'p1@x'),
  ('00000000-0000-0000-0000-0000000000b2', 'p2@x'),
  ('00000000-0000-0000-0000-0000000000b3', 'fresh@x');
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner'), ('00000000-0000-0000-0000-0000000000a2', 'Admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'Author'), ('00000000-0000-0000-0000-0000000000b1', 'Player One'),
  ('00000000-0000-0000-0000-0000000000b2', 'Player Two'), ('00000000-0000-0000-0000-0000000000b3', 'Fresh')
on conflict (id) do nothing;
update profiles set is_admin = true, is_owner = (id = '00000000-0000-0000-0000-0000000000a1')
  where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
-- everybody but "fresh" joined two days ago and has played 40 duels
update profiles set created_at = now() - interval '2 days' where id <> '00000000-0000-0000-0000-0000000000b3';
insert into arena_profiles (user_id, votes_total, xp_total)
  select id, 40, 500 from profiles on conflict (user_id) do update set votes_total = 40, xp_total = 500;

-- tests: T1 (2 options, will be funded), T2 (3 options, never funded), T3 (2 options, for checks)
insert into arena_tests (id, owner_id, title, dim, target_votes) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'Logo A vs B', 'preference', 20),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a3', 'Three names', 'trust', 50),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a3', 'Two posters', 'quality', 50);
insert into arena_test_items (id, test_id, pos, label) values
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 0, 'A'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 1, 'B'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', 0, 'X'),
  ('20000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000002', 1, 'Y'),
  ('20000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000002', 2, 'Z'),
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000003', 0, 'P'),
  ('20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000003', 1, 'Q');

-- no quality checks until the block that tests them; no pacing gap except where it is tested
update cash_settings set check_rate = 0, min_gap_ms = 0;
-- this file is about the mission bonuses of 0027: the XP conversion of 0028 has its own file (cash_xp.test.sql)
do $$ begin if exists (select 1 from information_schema.columns where table_name = 'cash_settings' and column_name = 'xp_per_tenge') then execute 'update cash_settings set xp_per_tenge = 0'; end if; end $$;

-- ---------------------------------------------------------------------------
-- 1. an unfunded test pays XP only
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; p1 uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  r := t.vote(p1, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000021');
  perform t.ok((r->'results'->0->>'accepted')::boolean, 'unfunded: answer accepted');
  perform t.ok((r->'results'->0->>'cash')::bigint = 0, 'unfunded: pays 0');
  perform t.ok(r->'results'->0->'cashReason' = 'null'::jsonb, 'unfunded: no reason shown (nothing was on offer)');
  perform t.ok((r->'results'->0->>'xp')::int = 12, 'unfunded: XP as before');
  perform t.ok(r->'wallet' = 'null'::jsonb, 'unfunded: the reply carries no wallet');
  perform t.ok(not exists (select 1 from cash_ledger), 'unfunded: ledger stays empty');
end $$;

-- ---------------------------------------------------------------------------
-- 2. funding: admins only, within the limits, audited
-- ---------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  perform t.as_user('00000000-0000-0000-0000-0000000000b1');
  perform t.ok(t.raises($q$select cash_admin_fund_test('10000000-0000-0000-0000-000000000001', 1000, 3000)$q$) = 'not_admin', 'fund: a player is refused');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok(t.raises($q$select cash_admin_fund_test('10000000-0000-0000-0000-000000000001', 999999, 3000)$q$) = 'bad_reward', 'fund: reward above max_reward refused');
  perform t.ok(t.raises($q$select cash_admin_fund_test('10000000-0000-0000-0000-000000000001', 1000, -1)$q$) = 'bad_budget', 'fund: negative budget refused');
  r := cash_admin_fund_test('10000000-0000-0000-0000-000000000001', 1000, 3000);
  perform t.ok((r->>'reward')::bigint = 1000 and (r->>'budget')::bigint = 3000, 'fund: 10 tenge per answer, 30 tenge budget');
  perform t.ok(exists (select 1 from admin_audit where action = 'cash_fund_test'), 'fund: audited');
  perform t.as_user('00000000-0000-0000-0000-0000000000b2');
  r := arena_test_queue(5);
  perform t.ok((select (e->>'reward')::bigint from jsonb_array_elements(r->'tests') e where e->>'id' = '10000000-0000-0000-0000-000000000001') = 1000, 'queue: shows the reward');
  perform t.ok((r->'tests'->0->>'id') = '10000000-0000-0000-0000-000000000001', 'queue: the funded test comes first');
end $$;

-- ---------------------------------------------------------------------------
-- 3. who may earn: an account older than a day with 30 duels behind it
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; fresh uuid := '00000000-0000-0000-0000-0000000000b3';
begin
  r := t.vote(fresh, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000011');
  perform t.ok((r->'results'->0->>'accepted')::boolean and (r->'results'->0->>'cash')::bigint = 0, 'new account: answer counts, pays 0');
  perform t.ok(r->'results'->0->>'cashReason' = 'new_account', 'new account: reason new_account');
  perform t.ok(r->'wallet'->'eligibility'->>'reason' = 'new_account', 'new account: the wallet says why');
  update profiles set created_at = now() - interval '3 days' where id = fresh;
  update arena_profiles set votes_total = 5 where user_id = fresh;
  perform t.ok(t.wallet(fresh)->'eligibility'->>'reason' = 'need_play', 'few duels: reason need_play');
  perform t.ok((t.wallet(fresh)->'eligibility'->>'needVotes')::int = 30, 'few duels: says how many are needed');
  update arena_profiles set votes_total = 40 where user_id = fresh;
  perform t.ok((t.wallet(fresh)->'eligibility'->>'ok')::boolean, 'eligible once both are met');
  perform t.ok((select cash_spent from arena_tests where id = '10000000-0000-0000-0000-000000000001') = 0, 'nothing spent on refused bonuses');
end $$;

-- ---------------------------------------------------------------------------
-- 4. a paid answer, the budget, retries and speed
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; p1 uuid := '00000000-0000-0000-0000-0000000000b1'; p2 uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  r := t.vote(p1, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000012');
  perform t.ok((r->'results'->0->>'cash')::bigint = 1000, 'paid: 1000 tiyn');
  perform t.ok((r->>'cash')::bigint = 1000, 'paid: total in the reply');
  perform t.ok((r->'wallet'->>'pending')::bigint = 1000 and (r->'wallet'->>'available')::bigint = 0, 'paid: pending, not yet available');
  perform t.ok((select count(*) from cash_ledger where user_id = p1 and kind = 'earn' and state = 'pending') = 1, 'paid: one ledger row');
  perform t.ok((select available_at::date from cash_ledger where user_id = p1) = (now() + interval '7 days')::date, 'paid: released after 7 days');
  perform t.ok((select cash_spent from arena_tests where id = '10000000-0000-0000-0000-000000000001') = 1000, 'paid: budget spent');
  -- the same answer again (a retried request): refused, not paid twice
  r := t.vote(p1, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000012');
  perform t.ok(r->'results'->0->>'reason' = 'duplicate', 'retry: duplicate');
  perform t.ok((select count(*) from cash_ledger where user_id = p1) = 1, 'retry: still one bonus');
  -- too fast: under min_answer_ms (600)
  r := t.vote(p2, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000011', 200);
  perform t.ok((r->'results'->0->>'accepted')::boolean and r->'results'->0->>'cashReason' = 'too_fast', 'too fast: answer counts, no bonus');
  perform t.ok((select count(*) from cash_ledger where user_id = p2) = 0, 'too fast: no ledger row');
end $$;

-- pacing on the server clock: a paid answer less than min_gap_ms after the previous one pays nothing
do $$
declare r jsonb; p1 uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  update cash_settings set min_gap_ms = 60000;
  insert into arena_tests (id, owner_id, title, dim, target_votes, cash_reward, cash_budget) values
    ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a3', 'Pacing', 'preference', 20, 500, 5000);
  insert into arena_test_items (id, test_id, pos, label) values
    ('20000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000004', 0, 'L'),
    ('20000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000004', 1, 'R');
  r := t.vote(p1, '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000041');
  perform t.ok(r->'results'->0->>'cashReason' = 'too_fast' and (r->'results'->0->>'cash')::bigint = 0, 'gap: within a minute of the last paid answer, no bonus');
  update cash_settings set min_gap_ms = 0;
end $$;

-- budget: 3000 / 1000 = three paid answers in all, then the test still collects answers but pays nothing
do $$
declare r jsonb; p2 uuid := '00000000-0000-0000-0000-0000000000b2'; fresh uuid := '00000000-0000-0000-0000-0000000000b3';
begin
  -- p2 already answered T1's only pair (too fast); fresh did too (new account). Spend the budget with new people.
  insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'x' || g || '@x' from generate_series(1, 4) g;
  insert into profiles (id, full_name, created_at) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'P' || g, now() - interval '2 days' from generate_series(1, 4) g on conflict (id) do update set created_at = excluded.created_at;
  insert into arena_profiles (user_id, votes_total) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 40 from generate_series(1, 4) g on conflict (user_id) do update set votes_total = 40;
  for i in 1..4 loop
    r := t.vote(('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, '10000000-0000-0000-0000-000000000001',
                '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000011');
    if i <= 2 then
      perform t.ok((r->'results'->0->>'cash')::bigint = 1000, format('budget: answer %s paid', i));
    else
      perform t.ok((r->'results'->0->>'cash')::bigint = 0 and r->'results'->0->>'cashReason' = 'budget', format('budget: answer %s over budget', i));
    end if;
  end loop;
  perform t.ok((select cash_spent = cash_budget from arena_tests where id = '10000000-0000-0000-0000-000000000001'), 'budget: spent exactly');
  perform t.as_user('00000000-0000-0000-0000-000000000099');
end $$;

-- ---------------------------------------------------------------------------
-- 5. the monthly limit (the only limit: there is no daily one) as seen by a mission reward
-- ---------------------------------------------------------------------------
do $$
declare r jsonb; p2 uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  update arena_tests set cash_reward = 700, cash_budget = 100000 where id = '10000000-0000-0000-0000-000000000002';
  update cash_settings set monthly_cap = 1000;
  r := t.vote(p2, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000022');
  perform t.ok((r->'results'->0->>'cash')::bigint = 700, 'month: first answer paid');
  r := t.vote(p2, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000023');
  perform t.ok((r->'results'->0->>'cash')::bigint = 0 and r->'results'->0->>'cashReason' = 'month_cap', 'month: 700 + 700 > 1000, refused with month_cap');
  perform t.ok((r->'wallet'->>'month')::bigint = 700 and (r->'wallet'->>'monthLeft')::bigint = 300, 'month: the wallet says 700 earned, 300 left');
  perform t.ok(not (r->'wallet') ? 'today' and not (r->'wallet'->'rules') ? 'dailyCap', 'month: the wallet has no daily figures any more');
  update cash_settings set monthly_cap = 300000;
end $$;

-- ---------------------------------------------------------------------------
-- 6. the holding period and the review freeze
-- ---------------------------------------------------------------------------
do $$
declare w jsonb; p1 uuid := '00000000-0000-0000-0000-0000000000b1'; p2 uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  -- a row whose 7 days are over (moved back by the test: the database owner may move available_at, nobody else can)
  update cash_ledger set available_at = now() - interval '1 minute' where user_id = p1;
  w := t.wallet(p1);
  perform t.ok((w->>'available')::bigint = 1000 and (w->>'pending')::bigint = 0, 'hold: released after the period');
  perform t.ok((select state from cash_ledger where user_id = p1) = 'available', 'hold: ledger row moved to available');
  -- on review nothing is released
  update cash_accounts set status = 'review' where user_id = p2;
  update cash_ledger set available_at = now() - interval '1 minute' where user_id = p2;
  w := t.wallet(p2);
  perform t.ok((w->>'available')::bigint = 0 and (w->>'pending')::bigint = 700, 'review: matured bonus stays pending');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform cash_admin_set_status(p2, 'ok', 'checked by hand');
  w := t.wallet(p2);
  perform t.ok((w->>'available')::bigint = 700, 'review cleared: released');
  perform t.ok(exists (select 1 from admin_audit where action = 'cash_status' and meta->>'from' = 'review' and meta->>'to' = 'ok'), 'review cleared: audited with from/to');
end $$;

-- ---------------------------------------------------------------------------
-- 7. the ledger cannot be rewritten
-- ---------------------------------------------------------------------------
do $$
declare id1 bigint;
begin
  select id into id1 from cash_ledger where user_id = '00000000-0000-0000-0000-0000000000b1' limit 1;
  perform t.ok(t.raises(format('update cash_ledger set amount = 999999 where id = %s', id1)) like '%never change%', 'ledger: amount cannot change');
  perform t.ok(t.raises(format($q$update cash_ledger set state = 'pending' where id = %s$q$, id1)) like '%not allowed%', 'ledger: available -> pending refused');
  perform t.ok(t.raises(format($q$update cash_ledger set state = 'settled' where id = %s$q$, id1)) like '%not allowed%', 'ledger: an earn is never settled');
  perform t.ok(t.raises(format('delete from cash_ledger where id = %s', id1)) like '%never deleted%', 'ledger: rows are never deleted');
  perform t.ok(t.raises($q$insert into cash_ledger (user_id, kind, amount, state) values ('00000000-0000-0000-0000-0000000000b1', 'earn', 5, 'available')$q$) like '%violates check%', 'ledger: an earn without its answer is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 8. what the API roles can touch directly (RLS + grants)
-- ---------------------------------------------------------------------------
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
do $$
begin
  perform t.ok((select count(*) from cash_ledger) = 1, 'rls: a player sees only their own ledger');
  perform t.ok((select count(*) from cash_accounts) = 1, 'rls: and only their own account');
  perform t.ok(t.raises($q$select * from cash_settings$q$) like '%permission denied%', 'rls: settings are not readable directly');
  perform t.ok(t.raises($q$select * from cash_checks$q$) like '%permission denied%', 'rls: checks are not readable');
  perform t.ok(t.raises($q$insert into cash_ledger (user_id, kind, amount, state, vote_id) values ('00000000-0000-0000-0000-0000000000b1', 'earn', 100000, 'available', 1)$q$) like '%permission denied%', 'rls: no inserts');
  perform t.ok(t.raises($q$update cash_accounts set available = 99999999$q$) like '%permission denied%', 'rls: no updates');
  perform t.ok(t.raises($q$select _cash_earn('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 1, 5000)$q$) like '%permission denied%', 'grants: internal helpers are not callable');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 9. payouts: closed today; the whole flow works once the owner opens them
-- ---------------------------------------------------------------------------
do $$
declare w jsonb; p1 uuid := '00000000-0000-0000-0000-0000000000b1'; req uuid;
begin
  perform t.as_user(p1);
  perform t.ok(t.raises('select cash_request_payout(1000)') = 'payouts_closed', 'payout: closed by default');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok(t.raises($q$select cash_admin_update_settings('{"payouts_enabled": true}')$q$) = 'not_owner', 'payout: only the owner opens payouts');
  perform t.ok(t.raises($q$select cash_admin_update_settings('{"min_gap": 1}')$q$) = 'bad_patch', 'settings: unknown keys refused');
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform cash_admin_update_settings('{"payouts_enabled": true, "min_payout": 500}');
  perform t.as_user(p1);
  perform t.ok(t.raises('select cash_request_payout(100)') = 'below_min', 'payout: below the minimum');
  perform t.ok(t.raises('select cash_request_payout(5000)') = 'too_much', 'payout: more than available');
  w := cash_request_payout(800);
  perform t.ok((w->>'available')::bigint = 200 and (w->>'reserved')::bigint = 800, 'payout: amount reserved');
  perform t.ok((w->'openPayout'->>'amount')::bigint = 800, 'payout: the wallet shows the open request');
  perform t.ok(t.raises('select cash_request_payout(500)') in ('open_request', 'too_much'), 'payout: one open request at a time');
  select id into req from cash_payout_requests where user_id = p1;
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform cash_admin_decide_payout(req, 'rejected', 'bank details missing');
  w := t.wallet(p1);
  perform t.ok((w->>'available')::bigint = 1000 and (w->>'reserved')::bigint = 0, 'payout rejected: money back');
  perform t.as_user(p1);
  perform cash_request_payout(1000);
  select id into req from cash_payout_requests where user_id = p1 and status = 'requested';
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform cash_admin_decide_payout(req, 'paid', 'test transfer');
  w := t.wallet(p1);
  perform t.ok((w->>'available')::bigint = 0 and (w->>'paidOut')::bigint = 1000 and (w->>'earnedTotal')::bigint = 1000, 'payout paid: balance moved to paid out');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok(t.raises(format($q$select cash_admin_decide_payout('%s', 'rejected')$q$, req)) = 'not_found', 'payout: decided only once');
  perform t.ok((select count(*) from admin_audit where action like 'cash_payout_%') = 2, 'payout: both decisions audited');
  perform t.as_user('00000000-0000-0000-0000-0000000000a1');
  perform cash_admin_update_settings('{"payouts_enabled": false, "min_payout": 200000}');
end $$;

-- ---------------------------------------------------------------------------
-- 10. reversing: void one bonus, block an account
-- ---------------------------------------------------------------------------
do $$
declare w jsonb; p2 uuid := '00000000-0000-0000-0000-0000000000b2'; e bigint; r jsonb;
begin
  select id into e from cash_ledger where user_id = p2 and kind = 'earn';
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok(t.raises(format('select cash_admin_void(%s, %L)', e, '')) = 'note_required', 'void: a reason is required');
  perform cash_admin_void(e, 'answers copied from another account');
  w := t.wallet(p2);
  perform t.ok((w->>'available')::bigint = 0 and (w->>'earnedTotal')::bigint = 0, 'void: balance back to 0');
  perform t.ok(w->'history'->0->>'note' is null, 'void: the earn row keeps no admin note in the player view');
  -- block: pending bonuses are voided and earning stops
  update arena_tests set cash_budget = 100000 where id = '10000000-0000-0000-0000-000000000003';
  update arena_tests set cash_reward = 300 where id = '10000000-0000-0000-0000-000000000003';
  r := t.vote(p2, '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000031');
  perform t.ok((r->'results'->0->>'cash')::bigint = 300, 'block: a pending bonus first');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  r := cash_admin_set_status(p2, 'blocked', 'fraud');
  perform t.ok((r->>'voided')::bigint = 300 and (r->>'pending')::bigint = 0, 'block: pending voided');
  perform t.ok((t.wallet(p2)->'eligibility'->>'reason') = 'blocked', 'block: cannot earn');
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform cash_admin_set_status(p2, 'ok', null);
end $$;

-- ---------------------------------------------------------------------------
-- 11. quality checks: a pair comes back; mismatching too often puts the account on review
-- ---------------------------------------------------------------------------
do $$
declare q jsonb; r jsonb; e jsonb; tid uuid; p uuid := '00000000-0000-0000-0000-000000000104'; i int; lo uuid; hi uuid; first uuid; other uuid;
begin
  update cash_settings set check_rate = 1, check_age_minutes = 0, check_min = 3, check_floor = 0.6;
  -- P4 answered T1's pair (over budget). Give P4 a few more answered pairs on T2 to draw checks from.
  for i in 1..3 loop
    lo := case i when 1 then '20000000-0000-0000-0000-000000000021'::uuid when 2 then '20000000-0000-0000-0000-000000000021' else '20000000-0000-0000-0000-000000000022' end;
    hi := case i when 1 then '20000000-0000-0000-0000-000000000022'::uuid when 2 then '20000000-0000-0000-0000-000000000023' else '20000000-0000-0000-0000-000000000023' end;
    perform t.vote(p, '10000000-0000-0000-0000-000000000002', lo, hi, lo);
  end loop;
  -- 1st check: answered the same way
  perform t.as_user(p);
  q := arena_test_queue(3);
  e := (select x from jsonb_array_elements(q->'tests') x
        where x->>'id' = (select test_id::text from cash_checks where user_id = p and answered_at is null) limit 1);
  perform t.ok(e is not null, 'check: the queue brings an answered pair back');
  perform t.ok((e->>'reward')::bigint = 0 and (e->>'total')::int = 1 and (e->>'done')::int = 0, 'check: looks like any one-pair mission');
  perform t.ok((select count(*) from cash_checks where user_id = p and answered_at is null) = 1, 'check: one open check');
  perform t.ok(arena_test_queue(3)->'tests' @> jsonb_build_array(jsonb_build_object('id', e->>'id', 'total', 1)), 'check: the same check until answered');
  perform t.ok((select count(*) from cash_checks where user_id = p) = 1, 'check: not re-issued on every queue read');
  select item_lo, item_hi, first_winner into lo, hi, first from cash_checks where user_id = p and answered_at is null;
  r := t.vote(p, (e->>'id')::uuid, lo, hi, first);
  perform t.ok((r->'results'->0->>'accepted')::boolean and (r->'results'->0->>'cash')::bigint = 0, 'check: accepted, pays no money');
  perform t.ok((r->'results'->0->>'xp')::int = 12, 'check: the usual XP, so it looks like any answer');
  perform t.ok(r->'results'->0 ? 'aVotes' and r->'results'->0 ? 'bVotes', 'check: the usual split comes back');
  perform t.ok((select consistent from cash_checks where user_id = p and item_lo = lo and item_hi = hi), 'check: consistent recorded');
  perform t.ok((select votes_count from arena_tests where id = (e->>'id')::uuid) = (select count(*) from arena_test_votes where test_id = (e->>'id')::uuid), 'check: the author''s counts do not move');
  -- 2nd and 3rd: answered the other way -> 1 of 3 < 0.6 -> review
  for i in 1..2 loop
    perform t.as_user(p);
    q := arena_test_queue(3);
    lo := null;
    select item_lo, item_hi, first_winner, test_id into lo, hi, first, tid from cash_checks where user_id = p and answered_at is null;
    perform t.ok(lo is not null, format('check %s issued', i + 1));
    other := case when first = lo then hi else lo end;
    r := t.vote(p, tid, lo, hi, other);
    perform t.ok((r->'results'->0->>'accepted')::boolean, format('check %s answered', i + 1));
  end loop;
  perform t.ok((select checks_total = 3 and checks_consistent = 1 from cash_accounts where user_id = p), 'check: 1 of 3 consistent');
  perform t.ok((select status = 'review' and status_note = 'auto 1/3' from cash_accounts where user_id = p), 'check: account put on review automatically');
  update cash_settings set check_rate = 0;
end $$;

-- ---------------------------------------------------------------------------
-- 12. the cache always equals the ledger; deleting a person still works
-- ---------------------------------------------------------------------------
do $$
declare a record; b cash_accounts;
begin
  for a in select * from cash_accounts loop
    b := _cash_recompute(a.user_id);
    perform t.ok(a.pending = b.pending and a.available = b.available and a.reserved = b.reserved and a.paid_out = b.paid_out,
                 format('cache matches ledger for %s', a.user_id));
  end loop;
  perform t.as_user('00000000-0000-0000-0000-0000000000a2');
  perform t.ok((cash_admin_overview()->>'paidOut')::bigint = 1000, 'overview: paid out total');
  perform t.ok(jsonb_array_length(cash_admin_accounts(null, 50)) >= 3, 'overview: accounts listed');
  perform t.ok(cash_admin_accounts(null, 50)->0->>'status' = 'review', 'overview: review first');
  perform t.ok(jsonb_array_length(cash_admin_tests('', 30)) >= 3, 'overview: tests listed');
  delete from profiles where id = '00000000-0000-0000-0000-000000000101';
  perform t.ok(not exists (select 1 from cash_ledger where user_id = '00000000-0000-0000-0000-000000000101'), 'account deletion removes that person''s rows');
end $$;

do $$ begin raise notice 'cash: % assertions passed', current_setting('t.passed'); end $$;
