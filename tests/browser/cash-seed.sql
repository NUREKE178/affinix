-- People and tests for tests/browser/cash.e2e.cjs (applied after the migrations on a fresh database).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'owner@e2e'), ('00000000-0000-0000-0000-00000000e002', 'author@e2e'),
  ('00000000-0000-0000-0000-00000000e003', 'aigerim@e2e'), ('00000000-0000-0000-0000-00000000e004', 'new@e2e'),
  ('00000000-0000-0000-0000-00000000e005', 'dauren@e2e');
insert into profiles (id, full_name, created_at) values
  ('00000000-0000-0000-0000-00000000e001', 'Нурлан Ж.', now() - interval '30 days'),
  ('00000000-0000-0000-0000-00000000e002', 'Aruzhan Studio', now() - interval '30 days'),
  ('00000000-0000-0000-0000-00000000e003', 'Айгерим', now() - interval '10 days'),
  ('00000000-0000-0000-0000-00000000e004', 'Жаңа ойыншы', now()),
  ('00000000-0000-0000-0000-00000000e005', 'Даурен', now() - interval '20 days')
on conflict (id) do update set full_name = excluded.full_name, created_at = excluded.created_at;
update profiles set is_admin = true, is_owner = true where id = '00000000-0000-0000-0000-00000000e001';
insert into arena_profiles (user_id, votes_total, xp_total) values
  ('00000000-0000-0000-0000-00000000e001', 120, 1500), ('00000000-0000-0000-0000-00000000e002', 80, 900),
  ('00000000-0000-0000-0000-00000000e003', 45, 700), ('00000000-0000-0000-0000-00000000e004', 40, 400),
  ('00000000-0000-0000-0000-00000000e005', 60, 800)
on conflict (user_id) do update set votes_total = excluded.votes_total, xp_total = excluded.xp_total;
-- today's Daily Challenge set is done, so the research missions (stage 2) are open
insert into arena_daily (user_id, day, votes, daily_votes)
  select id, (now() at time zone 'utc')::date, 10, 10 from profiles
on conflict (user_id, day) do update set votes = 10, daily_votes = 10;

insert into arena_tests (id, owner_id, title, dim, target_votes, cash_reward, cash_budget) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e002', 'Кофехана логотипі', 'preference', 150, 1000, 50000),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e002', 'Шай брендінің атауы', 'trust', 150, 0, 0);
insert into arena_test_items (id, test_id, pos, label) values
  ('e1000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000001', 0, 'Қара тостаған'),
  ('e1000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000001', 1, 'Жасыл жапырақ'),
  ('e1000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000002', 0, 'Шайхана'),
  ('e1000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000002', 1, 'Дала шайы'),
  ('e1000000-0000-0000-0000-000000000023', 'e0000000-0000-0000-0000-000000000002', 2, 'Көк кесе');

-- Dauren has a history already (an older bonus that is available, one still pending) and is on review after the checks
insert into arena_test_votes (id, test_id, voter_id, item_lo, item_hi, winner, ms, xp) overriding system value values
  (900001, 'e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e005', 'e1000000-0000-0000-0000-000000000021', 'e1000000-0000-0000-0000-000000000022', 'e1000000-0000-0000-0000-000000000021', 1800, 12),
  (900002, 'e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e005', 'e1000000-0000-0000-0000-000000000021', 'e1000000-0000-0000-0000-000000000023', 'e1000000-0000-0000-0000-000000000023', 2100, 12);
insert into cash_ledger (user_id, kind, amount, state, available_at, test_id, vote_id, created_at) values
  ('00000000-0000-0000-0000-00000000e005', 'earn', 1500, 'available', now() - interval '2 days', 'e0000000-0000-0000-0000-000000000002', 900001, now() - interval '9 days'),
  ('00000000-0000-0000-0000-00000000e005', 'earn', 1500, 'pending', now() + interval '4 days', 'e0000000-0000-0000-0000-000000000002', 900002, now() - interval '3 days');
insert into cash_accounts (user_id, status, status_note, checks_total, checks_consistent) values
  ('00000000-0000-0000-0000-00000000e005', 'review', 'auto 3/9', 9, 3)
on conflict (user_id) do nothing;
select _cash_recompute('00000000-0000-0000-0000-00000000e005');
update arena_tests set cash_spent = 3000, cash_budget = 3000 where id = 'e0000000-0000-0000-0000-000000000002';
update arena_tests set cash_reward = 0 where id = 'e0000000-0000-0000-0000-000000000002';
-- no quality check is drawn during the walk (it would make the queue random)
update cash_settings set check_rate = 0;
