-- ============================================================================
-- Affinix -- crowd tests: ask the Arena crowd
--
-- A person puts 2-4 options in front of the community (logo drafts, a poster, a
-- product name, a slogan ...), picks one question ("Which would you trust more?")
-- and the Arena's players answer it as research missions: pairwise duels between
-- the options. The owner reads a verdict with confidence intervals; the players
-- get XP for helping a real person (capped per day, see arena_test_vote).
--
-- What lives here:
--   arena_tests         one row per test: owner, question, status, counters
--   arena_test_items    the 2-4 options: a label and/or an image in the public
--                       'arena-tests' bucket (<owner id>/<uuid>.webp|jpg|png)
--   arena_test_votes    one row per (voter, pair of options): who beat whom
--   arena_test_reports  "this should not be here" flags; three different people
--                       take a test out of circulation until an admin looks at it
--
-- Like the rest of the Arena nothing is readable or writable directly: every
-- table has row level security and no policies, and the SECURITY DEFINER
-- functions below are the only way in or out.
--
-- Time spent on missions is counted by the same time slices as the Daily
-- Challenge (arena_submit); arena_daily only gains two counters for them.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- images: one public bucket, each person writes only inside their own folder
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arena-tests', 'arena-tests', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "arena-tests: public read" on storage.objects;
create policy "arena-tests: public read"
  on storage.objects for select
  using (bucket_id = 'arena-tests');

drop policy if exists "arena-tests: authenticated users upload to their own folder" on storage.objects;
create policy "arena-tests: authenticated users upload to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'arena-tests'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "arena-tests: owners can delete their own files" on storage.objects;
create policy "arena-tests: owners can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'arena-tests'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- tables
-- ----------------------------------------------------------------------------
create table if not exists arena_tests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  dim text not null check (dim in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent')),
  status text not null default 'open' check (status in ('open', 'closed', 'flagged', 'removed')),
  target_votes int not null default 150 check (target_votes between 20 and 2000),
  votes_count int not null default 0,
  voters_count int not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  note text
);
create index if not exists arena_tests_open_idx on arena_tests (votes_count) where status = 'open';
create index if not exists arena_tests_owner_idx on arena_tests (owner_id, created_at desc);

create table if not exists arena_test_items (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references arena_tests(id) on delete cascade,
  pos smallint not null check (pos between 0 and 3),
  label text check (label is null or char_length(label) between 1 and 60),
  image_path text check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  unique (test_id, pos),
  check (label is not null or image_path is not null)
);

create table if not exists arena_test_votes (
  id bigint generated always as identity primary key,
  test_id uuid not null references arena_tests(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  item_lo uuid not null references arena_test_items(id) on delete cascade,
  item_hi uuid not null references arena_test_items(id) on delete cascade,
  winner uuid not null,
  ms int,
  xp int not null default 0,
  created_at timestamptz not null default now(),
  check (item_lo < item_hi),
  check (winner = item_lo or winner = item_hi),
  unique (test_id, voter_id, item_lo, item_hi)
);
create index if not exists arena_test_votes_test_idx on arena_test_votes (test_id);
create index if not exists arena_test_votes_voter_idx on arena_test_votes (voter_id, created_at);

create table if not exists arena_test_reports (
  test_id uuid not null references arena_tests(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (test_id, reporter_id)
);

alter table arena_daily add column if not exists mission_votes int not null default 0;
alter table arena_daily add column if not exists mission_xp int not null default 0;

alter table arena_tests enable row level security;
alter table arena_test_items enable row level security;
alter table arena_test_votes enable row level security;
alter table arena_test_reports enable row level security;


-- ----------------------------------------------------------------------------
-- a test as the browser reads it (camelCase), with each option's record so far
-- ----------------------------------------------------------------------------
create or replace function arena_test_row_json(t arena_tests)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'dim', t.dim,
    'status', t.status,
    'target', t.target_votes,
    'votes', t.votes_count,
    'voters', t.voters_count,
    'createdAt', t.created_at,
    'closedAt', t.closed_at,
    'note', t.note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'pos', i.pos,
        'label', i.label,
        'path', i.image_path,
        'wins', (select count(*) from arena_test_votes v where v.winner = i.id),
        'games', (select count(*) from arena_test_votes v where v.item_lo = i.id or v.item_hi = i.id)
      ) order by i.pos)
      from arena_test_items i where i.test_id = t.id
    ), '[]'::jsonb)
  )
$$;


-- ----------------------------------------------------------------------------
-- arena_test_create: 2-4 options, one question
--   p_items = [{ "label": "Option A", "path": "<my id>/<uuid>.webp" }, ...]  (label and/or path)
-- Gates (so the crowd stays honest): level 2 (100 XP) first, at most 3 open tests,
-- at most 5 new tests per day.
-- ----------------------------------------------------------------------------
create or replace function arena_test_create(p_title text, p_dim text, p_items jsonb, p_target int default 150)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_xp bigint;
  ttl text := btrim(coalesce(p_title, ''));
  n int;
  it jsonb;
  lbl text;
  pth text;
  i int := 0;
  tid uuid;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if char_length(ttl) < 3 or char_length(ttl) > 80 then
    raise exception 'The title needs 3-80 characters.' using hint = 'bad_title';
  end if;
  if p_dim is null or p_dim not in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent') then
    raise exception 'Unknown question.' using hint = 'bad_question';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'The options must be a list.' using hint = 'bad_items';
  end if;
  n := jsonb_array_length(p_items);
  if n < 2 or n > 4 then
    raise exception 'A test needs 2-4 options.' using hint = 'bad_items';
  end if;

  insert into arena_profiles (user_id) values (me) on conflict (user_id) do nothing;
  select xp_total into v_xp from arena_profiles where user_id = me;
  if v_xp < 100 then
    raise exception 'Play a round in the Arena first (level 2).' using hint = 'need_level';
  end if;
  if (select count(*) from arena_tests where owner_id = me and status = 'open') >= 3 then
    raise exception 'You already have 3 open tests.' using hint = 'too_many_open';
  end if;
  if (select count(*) from arena_tests where owner_id = me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Daily limit of new tests reached.' using hint = 'daily_limit';
  end if;

  -- every option is checked before anything is written
  for it in select value from jsonb_array_elements(p_items) loop
    lbl := nullif(btrim(coalesce(it->>'label', '')), '');
    pth := nullif(btrim(coalesce(it->>'path', '')), '');
    if lbl is null and pth is null then
      raise exception 'Every option needs a label or an image.' using hint = 'bad_items';
    end if;
    if lbl is not null and char_length(lbl) > 60 then
      raise exception 'An option label is limited to 60 characters.' using hint = 'bad_items';
    end if;
    if pth is not null and pth !~ ('^' || me::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
      raise exception 'Bad image path.' using hint = 'bad_image';
    end if;
  end loop;

  insert into arena_tests (owner_id, title, dim, target_votes)
    values (me, ttl, p_dim, least(greatest(coalesce(p_target, 150), 20), 1000))
    returning id into tid;
  for it in select value from jsonb_array_elements(p_items) loop
    insert into arena_test_items (test_id, pos, label, image_path)
      values (tid, i, nullif(btrim(coalesce(it->>'label', '')), ''), nullif(btrim(coalesce(it->>'path', '')), ''));
    i := i + 1;
  end loop;
  return jsonb_build_object('id', tid);
end;
$$;


-- ----------------------------------------------------------------------------
-- the owner's side: my tests, one test's verdict material, close / reopen, delete
-- ----------------------------------------------------------------------------
create or replace function arena_test_mine()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  return coalesce((
    select jsonb_agg(arena_test_row_json(t) order by t.created_at desc)
    from arena_tests t where t.owner_id = me
  ), '[]'::jsonb);
end;
$$;

-- one test: the options' records plus every pair's split (who beat whom, how often)
create or replace function arena_test_results(p_test uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t arena_tests;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  select * into t from arena_tests where id = p_test and owner_id = me;
  if not found then
    raise exception 'Not found.';
  end if;
  return jsonb_build_object(
    'test', arena_test_row_json(t),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_object('a', p.item_lo, 'b', p.item_hi, 'aVotes', p.a_votes, 'bVotes', p.b_votes))
      from (
        select item_lo, item_hi,
               count(*) filter (where winner = item_lo) as a_votes,
               count(*) filter (where winner = item_hi) as b_votes
        from arena_test_votes where test_id = p_test
        group by item_lo, item_hi
      ) p
    ), '[]'::jsonb),
    'avgMs', (select round(avg(ms)) from arena_test_votes where test_id = p_test and ms is not null)
  );
end;
$$;

create or replace function arena_test_set_status(p_test uuid, p_status text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t arena_tests;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_status not in ('open', 'closed') then
    raise exception 'Unknown status.';
  end if;
  select * into t from arena_tests where id = p_test and owner_id = me for update;
  if not found then
    raise exception 'Not found.';
  end if;
  if t.status in ('flagged', 'removed') then
    raise exception 'This test is under review.' using hint = 'under_review';
  end if;
  if p_status = 'open' and (select count(*) from arena_tests where owner_id = me and status = 'open' and id <> t.id) >= 3 then
    raise exception 'You already have 3 open tests.' using hint = 'too_many_open';
  end if;
  update arena_tests
    set status = p_status, closed_at = case when p_status = 'closed' then now() else null end
    where id = t.id
    returning * into t;
  return arena_test_row_json(t);
end;
$$;

-- deleting returns the image paths so the browser can remove the files too
create or replace function arena_test_delete(p_test uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  paths jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if not exists (select 1 from arena_tests where id = p_test and owner_id = me) then
    raise exception 'Not found.';
  end if;
  select coalesce(jsonb_agg(image_path), '[]'::jsonb) into paths
    from arena_test_items where test_id = p_test and image_path is not null;
  delete from arena_tests where id = p_test and owner_id = me;
  return jsonb_build_object('paths', paths);
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_test_queue: what a player can help with right now
--   -> { available, missionXp, cap, tests: [{ id, title, dim, owner, items, pairs: [[a, b], ...] }] }
-- Never the player's own tests, never closed / flagged / removed ones, never one the player
-- reported, only pairs not answered yet; the least-answered tests come first.
-- ----------------------------------------------------------------------------
create or replace function arena_test_queue(p_limit int default 3)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 3), 1), 10);
  utc_today date := (now() at time zone 'utc')::date;
  avail int;
  picked jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  with cand as (
    select t.id, t.title, t.dim, t.owner_id, t.votes_count,
           (select count(*) from arena_test_items i where i.test_id = t.id) as n_items,
           (select count(*) from arena_test_votes v where v.test_id = t.id and v.voter_id = me) as my_votes
    from arena_tests t
    where t.status = 'open' and t.owner_id <> me
      and not exists (select 1 from arena_test_reports r where r.test_id = t.id and r.reporter_id = me)
  ), open_cand as (
    select * from cand where n_items >= 2 and my_votes < n_items * (n_items - 1) / 2
  ), chosen as (
    select c.*, row_number() over (order by c.votes_count, random()) as ord
    from (select * from open_cand order by votes_count, random() limit lim) c
  )
  select
    (select count(*) from open_cand),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'dim', c.dim,
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
  return jsonb_build_object(
    'available', avail,
    'missionXp', coalesce((select mission_xp from arena_daily where user_id = me and day = utc_today), 0),
    'cap', 300,
    'tests', picked
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_test_vote: answer duels of one test
--   p_votes = [{ "a": uuid, "b": uuid, "pick": uuid (= a or b), "ms": 1500 }, ...]
-- 12 XP per answer (+20 when the player has now answered every pair of the test),
-- at most 300 XP a day from missions; answers past that still count for the
-- author, they just pay nothing. Answering the same pair twice is refused, so a
-- retried request is harmless.
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

  -- serialises the voters of one test (its counters) and the player's own rows
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
    'missionXp', d.mission_xp,
    'cap', 300,
    'status', (select status from arena_tests where id = p_test),
    'newBadges', to_jsonb(new_badges),
    'state', arena_state_json(me, today),
    'days', coalesce((select jsonb_agg(arena_day_json(x) order by x.day) from arena_daily x where x.user_id = me and x.day = today), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- reports and moderation
-- ----------------------------------------------------------------------------
create or replace function arena_test_report(p_test uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t arena_tests;
  n int;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  select * into t from arena_tests where id = p_test;
  if not found then
    raise exception 'Not found.';
  end if;
  if t.owner_id = me then
    raise exception 'You cannot report your own test.' using hint = 'own';
  end if;
  insert into arena_test_reports (test_id, reporter_id, reason)
    values (p_test, me, left(nullif(btrim(coalesce(p_reason, '')), ''), 200))
    on conflict do nothing;
  select count(*) into n from arena_test_reports where test_id = p_test;
  if n >= 3 and t.status = 'open' then
    update arena_tests set status = 'flagged', note = 'reported by several players' where id = p_test;
  end if;
  return jsonb_build_object('reports', n, 'flagged', n >= 3);
end;
$$;

-- admins: what was reported, and a decision on it
create or replace function arena_test_flagged()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not coalesce((select is_admin from profiles where id = me), false) then
    raise exception 'Not allowed.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'status', t.status,
      'note', t.note,
      'createdAt', t.created_at,
      'reports', (select count(*) from arena_test_reports r where r.test_id = t.id),
      'reasons', coalesce((select jsonb_agg(r.reason) from arena_test_reports r where r.test_id = t.id and r.reason is not null), '[]'::jsonb),
      'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username, 'avatarUrl', p.avatar_url)
                from profiles_public p where p.id = t.owner_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'path', i.image_path) order by i.pos)
                         from arena_test_items i where i.test_id = t.id), '[]'::jsonb)
    ) order by (select count(*) from arena_test_reports r where r.test_id = t.id) desc, t.created_at desc)
    from arena_tests t
    where t.status in ('flagged', 'removed')
       or exists (select 1 from arena_test_reports r where r.test_id = t.id)
  ), '[]'::jsonb);
end;
$$;

create or replace function arena_test_moderate(p_test uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t arena_tests;
begin
  if me is null or not coalesce((select is_admin from profiles where id = me), false) then
    raise exception 'Not allowed.';
  end if;
  if p_action not in ('remove', 'restore') then
    raise exception 'Unknown action.';
  end if;
  select * into t from arena_tests where id = p_test for update;
  if not found then
    raise exception 'Not found.';
  end if;
  if p_action = 'remove' then
    update arena_tests set status = 'removed', closed_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 200)
      where id = p_test returning * into t;
  else
    delete from arena_test_reports where test_id = p_test;
    update arena_tests set status = 'open', closed_at = null, note = null where id = p_test returning * into t;
  end if;
  return arena_test_row_json(t);
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_admin_stats, extended: the crowd side next to the Daily Challenge time
-- (same signature, so this replaces the 0021 version)
-- ----------------------------------------------------------------------------
create or replace function arena_admin_stats(p_days int default 14)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
begin
  if me is null or not coalesce((select is_admin from profiles where id = me), false) then
    raise exception 'Not allowed.';
  end if;
  return jsonb_build_object(
    'players', (select count(*) from arena_profiles where votes_total > 0),
    'votes', (select coalesce(sum(votes_total), 0) from arena_profiles),
    'tests', (select count(*) from arena_tests where status <> 'removed'),
    'testVotes', (select count(*) from arena_test_votes),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', s.day, 'players', s.players, 'votes', s.votes, 'missions', s.missions,
        'avgMinutes', round(s.avg_sec / 60.0, 1), 'over1h', s.over1h, 'over3h', s.over3h
      ) order by s.day)
      from (
        select d.day,
               count(*) as players,
               sum(d.votes) as votes,
               sum(d.mission_votes) as missions,
               avg(d.active_seconds) as avg_sec,
               count(*) filter (where d.active_seconds >= 3600) as over1h,
               count(*) filter (where d.active_seconds >= 10800) as over3h
        from arena_daily d
        where d.day > utc_today - least(greatest(coalesce(p_days, 14), 1), 90)
          and (d.votes > 0 or d.active_seconds > 0 or d.mission_votes > 0)
        group by d.day
      ) s
    ), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- who may call what: signed-in users only (every function also checks auth.uid())
-- ----------------------------------------------------------------------------
revoke all on function arena_test_row_json(arena_tests) from public, anon, authenticated;
revoke all on function arena_test_create(text, text, jsonb, int) from public, anon;
revoke all on function arena_test_mine() from public, anon;
revoke all on function arena_test_results(uuid) from public, anon;
revoke all on function arena_test_set_status(uuid, text) from public, anon;
revoke all on function arena_test_delete(uuid) from public, anon;
revoke all on function arena_test_queue(int) from public, anon;
revoke all on function arena_test_vote(uuid, jsonb, date) from public, anon;
revoke all on function arena_test_report(uuid, text) from public, anon;
revoke all on function arena_test_flagged() from public, anon;
revoke all on function arena_test_moderate(uuid, text, text) from public, anon;
revoke all on function arena_admin_stats(int) from public, anon;

grant execute on function arena_test_create(text, text, jsonb, int) to authenticated;
grant execute on function arena_test_mine() to authenticated;
grant execute on function arena_test_results(uuid) to authenticated;
grant execute on function arena_test_set_status(uuid, text) to authenticated;
grant execute on function arena_test_delete(uuid) to authenticated;
grant execute on function arena_test_queue(int) to authenticated;
grant execute on function arena_test_vote(uuid, jsonb, date) to authenticated;
grant execute on function arena_test_report(uuid, text) to authenticated;
grant execute on function arena_test_flagged() to authenticated;
grant execute on function arena_test_moderate(uuid, text, text) to authenticated;
grant execute on function arena_admin_stats(int) to authenticated;

notify pgrst, 'reload schema';
