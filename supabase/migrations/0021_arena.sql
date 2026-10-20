-- ============================================================================
-- Affinix -- the Arena: design duels with XP, streaks, quests and rankings
--
-- The Arena shows a person two design specimens (a logo, a palette, a button,
-- a pack, a poster ...) and asks one question about them ("Which looks more
-- premium?"). The specimens are NOT stored anywhere: they are generated in the
-- browser from a seed, so the server only ever sees compact keys such as
-- "202610/mark/3-17" (season / family / the two pool indexes, lower first) and
-- which side (0 = the lower index, 1 = the higher) the player picked.
--
-- What lives here:
--   * arena_votes     one row per (player, duel, question). Private: nobody can
--                     read it directly; community numbers come out of aggregate
--                     functions only.
--   * arena_stim      wins / losses of every specimen per question, so a reveal
--                     can say "chosen in 62% of its duels" long before two
--                     players happen to vote on the very same pair.
--   * arena_profiles  a player's running totals (XP, streak, badges ...).
--   * arena_daily     the same per calendar day: feeds the weekly ranking, the
--                     quests and the "time in the Arena" readout.
--   * arena_slices    time-on-task slices, only so a retried request can never
--                     count the same minute twice.
--   * arena_quest_defs  the quest catalogue (mirrors src/lib/arena/rules.js).
--
-- Everything is written through SECURITY DEFINER functions that re-derive XP,
-- streaks, claims and badges from the same rules the browser uses (rules.js), so
-- the ranking can't be forged by editing a request. The browser stays useful
-- without this migration: it keeps its own progress locally and syncs the votes
-- as soon as these functions exist.
--
-- Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tables
-- ----------------------------------------------------------------------------
create table if not exists arena_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  xp_total bigint not null default 0,
  votes_total int not null default 0,
  eye_correct int not null default 0,
  eye_total int not null default 0,
  crowd_hits int not null default 0,
  crowd_total int not null default 0,
  best_combo int not null default 0,
  streak_days int not null default 0,
  best_streak int not null default 0,
  last_day date,
  active_seconds bigint not null default 0,
  best_day_seconds int not null default 0,
  daily_sets int not null default 0,
  families_seen text[] not null default '{}',
  badges text[] not null default '{}',
  show_on_leaderboard boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists arena_votes (
  seq bigint generated always as identity,
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  pair text not null,
  dim text not null,
  pick smallint not null check (pick in (0, 1)),
  ms int,
  day date not null,
  family text not null,
  daily boolean not null default false,
  xp int not null,
  created_at timestamptz not null default now(),
  constraint arena_votes_one_per_duel unique (user_id, pair, dim)
);
create index if not exists arena_votes_pair_dim_idx on arena_votes (pair, dim);
create index if not exists arena_votes_user_seq_idx on arena_votes (user_id, seq);
create index if not exists arena_votes_daily_idx on arena_votes (day, pair, dim) where daily;

create table if not exists arena_stim (
  season text not null,
  stim text not null,
  dim text not null,
  wins int not null default 0,
  losses int not null default 0,
  primary key (season, stim, dim)
);

create table if not exists arena_daily (
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  votes int not null default 0,
  xp int not null default 0,
  active_seconds int not null default 0,
  max_combo int not null default 0,
  eye_correct int not null default 0,
  eye_total int not null default 0,
  crowd_hits int not null default 0,
  crowd_total int not null default 0,
  daily_votes int not null default 0,
  families text[] not null default '{}',
  dims text[] not null default '{}',
  slate text[] not null default '{}',
  claimed text[] not null default '{}',
  primary key (user_id, day)
);
create index if not exists arena_daily_day_idx on arena_daily (day);

create table if not exists arena_slices (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  seconds int not null check (seconds between 1 and 600),
  created_at timestamptz not null default now()
);

create table if not exists arena_quest_defs (
  id text primary key,
  tier text not null check (tier in ('easy', 'medium', 'hard')),
  kind text not null,
  target int not null,
  xp int not null
);

insert into arena_quest_defs (id, tier, kind, target, xp) values
  ('votes_15',  'easy',   'votes',    15,   30),
  ('fam_3',     'easy',   'families', 3,    30),
  ('dims_3',    'easy',   'dims',     3,    30),
  ('time_5',    'easy',   'time',     300,  30),
  ('votes_40',  'medium', 'votes',    40,   60),
  ('fam_5',     'medium', 'families', 5,    60),
  ('dims_5',    'medium', 'dims',     5,    60),
  ('combo_6',   'medium', 'combo',    6,    60),
  ('eye_5',     'medium', 'eye',      5,    60),
  ('time_15',   'medium', 'time',     900,  60),
  ('votes_100', 'hard',   'votes',    100,  120),
  ('combo_12',  'hard',   'combo',    12,   120),
  ('eye_12',    'hard',   'eye',      12,   120),
  ('fam_7',     'hard',   'families', 7,    120),
  ('time_30',   'hard',   'time',     1800, 120),
  ('time_60',   'hard',   'time',     3600, 120)
on conflict (id) do update set tier = excluded.tier, kind = excluded.kind, target = excluded.target, xp = excluded.xp;

-- Row level security with no policies except "read your own totals": the
-- functions below are the only way in or out.
alter table arena_profiles enable row level security;
alter table arena_votes enable row level security;
alter table arena_stim enable row level security;
alter table arena_daily enable row level security;
alter table arena_slices enable row level security;
alter table arena_quest_defs enable row level security;

drop policy if exists arena_profiles_select_own on arena_profiles;
create policy arena_profiles_select_own on arena_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists arena_daily_select_own on arena_daily;
create policy arena_daily_select_own on arena_daily for select to authenticated using (user_id = auth.uid());
drop policy if exists arena_quest_defs_select on arena_quest_defs;
create policy arena_quest_defs_select on arena_quest_defs for select to authenticated using (true);


-- ----------------------------------------------------------------------------
-- the rulebook (mirrors src/lib/arena/rules.js)
-- ----------------------------------------------------------------------------

-- Reaching level L costs 50 * L * (L - 1) XP in total.
create or replace function arena_level(p_xp bigint)
returns int
language sql
immutable
as $$
  select coalesce((select max(l) from generate_series(1, 200) as l where 50::bigint * l * (l - 1) <= greatest(p_xp, 0)), 1)::int
$$;

-- 10 per accepted vote, +1..10 combo bonus for a considered answer, +5 for the first vote on a duel.
create or replace function arena_vote_xp(p_ms int, p_bonus int, p_pioneer boolean)
returns int
language sql
immutable
as $$
  select 10
    + case when coalesce(p_ms, 0) >= 600 then least(greatest(coalesce(p_bonus, 0), 0), 10) else 0 end
    + case when coalesce(p_pioneer, false) then 5 else 0 end
$$;

create or replace function arena_arr_add(arr text[], x text)
returns text[]
language sql
immutable
as $$
  select case when x = any(arr) then arr else arr || x end
$$;

-- The badges a set of totals has earned, in the same order as BADGE_DEFS in rules.js.
create or replace function arena_badges_for(
  p_votes int, p_best_streak int, p_best_combo int, p_xp bigint,
  p_eye_correct int, p_eye_total int, p_crowd_hits int, p_crowd_total int,
  p_families int, p_best_day_seconds int, p_daily_sets int
)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(b.id order by b.ord), '{}'::text[])
  from (values
    (1,  'first_vote',  p_votes >= 1),
    (2,  'votes_100',   p_votes >= 100),
    (3,  'votes_500',   p_votes >= 500),
    (4,  'votes_1000',  p_votes >= 1000),
    (5,  'votes_2500',  p_votes >= 2500),
    (6,  'votes_5000',  p_votes >= 5000),
    (7,  'streak_3',    p_best_streak >= 3),
    (8,  'streak_7',    p_best_streak >= 7),
    (9,  'streak_14',   p_best_streak >= 14),
    (10, 'streak_30',   p_best_streak >= 30),
    (11, 'daily_7',     p_daily_sets >= 7),
    (12, 'daily_30',    p_daily_sets >= 30),
    (13, 'combo_8',     p_best_combo >= 8),
    (14, 'combo_12',    p_best_combo >= 12),
    (15, 'eye_80',      p_eye_total >= 30 and p_eye_correct * 100 >= 80 * p_eye_total),
    (16, 'crowd_70',    p_crowd_total >= 30 and p_crowd_hits * 100 >= 70 * p_crowd_total),
    (17, 'explorer',    p_families >= 7),
    (18, 'level_5',     arena_level(p_xp) >= 5),
    (19, 'level_10',    arena_level(p_xp) >= 10),
    (20, 'level_20',    arena_level(p_xp) >= 20),
    (21, 'level_30',    arena_level(p_xp) >= 30),
    (22, 'hour_1',      p_best_day_seconds >= 3600),
    (23, 'marathon_3h', p_best_day_seconds >= 10800)
  ) as b(ord, id, ok)
  where b.ok
$$;

-- Has a day's counters reached a quest's target?
create or replace function arena_quest_met(p_kind text, p_target int, d arena_daily)
returns boolean
language sql
immutable
as $$
  select case p_kind
    when 'votes' then d.votes >= p_target
    when 'families' then cardinality(d.families) >= p_target
    when 'dims' then cardinality(d.dims) >= p_target
    when 'combo' then d.max_combo >= p_target
    when 'eye' then d.eye_correct >= p_target
    when 'time' then d.active_seconds >= p_target
    else false
  end
$$;


-- ----------------------------------------------------------------------------
-- JSON shapes the browser reads (camelCase, same names as its own state)
-- ----------------------------------------------------------------------------
create or replace function arena_profile_json(p arena_profiles)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'xp', p.xp_total,
    'level', arena_level(p.xp_total),
    'votes', p.votes_total,
    'eyeCorrect', p.eye_correct,
    'eyeTotal', p.eye_total,
    'crowdHits', p.crowd_hits,
    'crowdTotal', p.crowd_total,
    'bestCombo', p.best_combo,
    'streak', p.streak_days,
    'bestStreak', p.best_streak,
    'lastDay', p.last_day,
    'activeSeconds', p.active_seconds,
    'bestDaySeconds', p.best_day_seconds,
    'dailySets', p.daily_sets,
    'families', to_jsonb(p.families_seen),
    'badges', to_jsonb(p.badges),
    'visible', p.show_on_leaderboard
  )
$$;

create or replace function arena_day_json(d arena_daily)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'day', d.day,
    'votes', d.votes,
    'xp', d.xp,
    'sec', d.active_seconds,
    'maxCombo', d.max_combo,
    'eyeCorrect', d.eye_correct,
    'eyeTotal', d.eye_total,
    'crowdHits', d.crowd_hits,
    'crowdTotal', d.crowd_total,
    'dailyVotes', d.daily_votes,
    'families', to_jsonb(d.families),
    'dims', to_jsonb(d.dims),
    'slate', to_jsonb(d.slate),
    'claimed', to_jsonb(d.claimed)
  )
$$;

create or replace function arena_state_json(p_user uuid, p_day date, p_history int default 0)
returns jsonb
language plpgsql
stable
as $$
declare
  prof arena_profiles;
  d arena_daily;
  days jsonb := '[]'::jsonb;
begin
  select * into prof from arena_profiles where user_id = p_user;
  select * into d from arena_daily where user_id = p_user and day = p_day;
  if p_history > 0 then
    select coalesce(jsonb_agg(arena_day_json(x) order by x.day), '[]'::jsonb) into days
      from arena_daily x
      where x.user_id = p_user and x.day > p_day - p_history;
  end if;
  return jsonb_build_object(
    'profile', case when prof.user_id is null then null else arena_profile_json(prof) end,
    'today', case when d.user_id is null then null else arena_day_json(d) end,
    'serverDay', (now() at time zone 'utc')::date,
    'days', days
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_state: everything the browser needs on load
-- ----------------------------------------------------------------------------
create or replace function arena_state(p_day date default null, p_history int default 84)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  today date := coalesce(p_day, utc_today);
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if today < utc_today - 1 or today > utc_today + 1 then
    today := utc_today;
  end if;
  insert into arena_profiles (user_id) values (me) on conflict (user_id) do nothing;
  return arena_state_json(me, today, least(greatest(coalesce(p_history, 0), 0), 400));
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_tallies: community numbers for the duels about to be shown
--   p_items = [{ "pair": "202610/mark/3-17", "dim": "trust" }, ...]
--   -> [{ pair, dim, a, b, sa: {w, l}, sb: {w, l} }]  (a / b = votes for the lower / higher index;
--      sa / sb = how that specimen has fared across every duel of that question)
-- ----------------------------------------------------------------------------
create or replace function arena_tallies(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  item jsonb;
  pr text;
  dm text;
  seas text;
  fam text;
  i int;
  j int;
  a int;
  b int;
  sa_w int; sa_l int; sb_w int; sb_l int;
  out jsonb := '[]'::jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'Too many items.';
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pr := item->>'pair';
    dm := item->>'dim';
    if pr is null or dm is null or pr !~ '^[0-9]{6}/[a-z]{2,12}/[0-9]{1,2}-[0-9]{1,2}$' then
      continue;
    end if;
    seas := split_part(pr, '/', 1);
    fam := split_part(pr, '/', 2);
    i := split_part(split_part(pr, '/', 3), '-', 1)::int;
    j := split_part(split_part(pr, '/', 3), '-', 2)::int;
    select count(*) filter (where pick = 0), count(*) filter (where pick = 1) into a, b
      from arena_votes where pair = pr and dim = dm;
    select coalesce(max(wins), 0), coalesce(max(losses), 0) into sa_w, sa_l
      from arena_stim where season = seas and stim = fam || ':' || i and dim = dm;
    select coalesce(max(wins), 0), coalesce(max(losses), 0) into sb_w, sb_l
      from arena_stim where season = seas and stim = fam || ':' || j and dim = dm;
    out := out || jsonb_build_object(
      'pair', pr, 'dim', dm, 'a', a, 'b', b,
      'sa', jsonb_build_object('w', sa_w, 'l', sa_l),
      'sb', jsonb_build_object('w', sb_w, 'l', sb_l)
    );
  end loop;
  return out;
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_submit: the one write path
--   p_votes  [{ id uuid, pair, dim, pick 0|1, ms, bonus, day, daily, eye bool|null, combo }]
--   p_slices [{ id uuid, day, sec }]               time spent in the Arena since the last send
--   p_slate  { day, ids: [quest ids] }              today's three quests (set once per day)
--   p_day    the player's local date (default: UTC today)
-- Retrying the same request is harmless: votes and slices are keyed by the
-- client's UUIDs, and a duel can only ever be answered once per question.
-- ----------------------------------------------------------------------------
create or replace function arena_submit(
  p_votes jsonb default '[]'::jsonb,
  p_slices jsonb default '[]'::jsonb,
  p_slate jsonb default null,
  p_day date default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  cur_season text := to_char(now() at time zone 'utc', 'YYYYMM');
  prev_season text := to_char((now() at time zone 'utc') - interval '1 month', 'YYYYMM');
  today date := coalesce(p_day, (now() at time zone 'utc')::date);
  prof arena_profiles;
  old_badges text[];
  new_badges text[];
  v jsonb;
  s jsonb;
  results jsonb := '[]'::jsonb;
  vid uuid;
  pr text;
  dm text;
  pk int;
  ms int;
  bonus int;
  combo int;
  vday date;
  fam text;
  seas text;
  i int;
  j int;
  is_daily boolean;
  eye boolean;
  a_before int;
  b_before int;
  pioneer boolean;
  crowd boolean;
  majority int;
  vxp int;
  existing arena_votes;
  day_votes int;
  got uuid;
  sid uuid;
  sday date;
  ssec int;
  slate_day date;
  slate_ids text[];
  touched date[] := array[]::date[];
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if jsonb_typeof(coalesce(p_votes, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_votes, '[]'::jsonb)) > 100 then
    raise exception 'Too many votes in one request.';
  end if;
  if jsonb_typeof(coalesce(p_slices, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_slices, '[]'::jsonb)) > 100 then
    raise exception 'Too many time slices in one request.';
  end if;
  if today < utc_today - 1 or today > utc_today + 1 then
    today := utc_today;
  end if;
  touched := array[today];

  insert into arena_profiles (user_id) values (me) on conflict (user_id) do nothing;
  -- Serialises two devices submitting at once.
  select * into prof from arena_profiles where user_id = me for update;
  old_badges := prof.badges;

  -- ---- votes ----
  for v in select value from jsonb_array_elements(coalesce(p_votes, '[]'::jsonb)) loop
    begin
      vid := (v->>'id')::uuid;
      pr := v->>'pair';
      dm := v->>'dim';
      pk := (v->>'pick')::int;
      ms := least(greatest(coalesce((v->>'ms')::int, 0), 0), 600000);
      bonus := coalesce((v->>'bonus')::int, 0);
      combo := least(greatest(coalesce((v->>'combo')::int, 0), 0), 1000);
      vday := coalesce((v->>'day')::date, today);
      is_daily := coalesce((v->>'daily')::boolean, false);
      eye := case when dm = 'clarity' and jsonb_typeof(v->'eye') = 'boolean' then (v->>'eye')::boolean else null end;
      if pr !~ '^[0-9]{6}/[a-z]{2,12}/[0-9]{1,2}-[0-9]{1,2}$'
         or dm not in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent')
         or pk not in (0, 1) then
        raise exception 'invalid';
      end if;
      seas := split_part(pr, '/', 1);
      fam := split_part(pr, '/', 2);
      i := split_part(split_part(pr, '/', 3), '-', 1)::int;
      j := split_part(split_part(pr, '/', 3), '-', 2)::int;
      if i >= j or j >= 64 or seas not in (cur_season, prev_season) then
        raise exception 'invalid';
      end if;
    exception when others then
      results := results || jsonb_build_object('id', v->>'id', 'accepted', false, 'reason', 'invalid');
      continue;
    end;

    if vday < utc_today - 2 or vday > utc_today + 1 then
      vday := today;
    end if;

    -- A retried request: the same vote id again.
    select * into existing from arena_votes where id = vid;
    if found then
      if existing.user_id = me then
        results := results || jsonb_build_object('id', vid, 'accepted', true, 'dup', true, 'xp', existing.xp);
      else
        results := results || jsonb_build_object('id', vid, 'accepted', false, 'reason', 'invalid');
      end if;
      continue;
    end if;

    -- The same duel answered before (e.g. on another device).
    if exists (select 1 from arena_votes where user_id = me and pair = pr and dim = dm) then
      results := results || jsonb_build_object('id', vid, 'accepted', false, 'reason', 'duplicate');
      continue;
    end if;

    select votes into day_votes from arena_daily where user_id = me and day = vday;
    if coalesce(day_votes, 0) >= 3000 then
      results := results || jsonb_build_object('id', vid, 'accepted', false, 'reason', 'cap');
      continue;
    end if;

    -- Community state BEFORE this vote: first-vote bonus and "did you match the crowd".
    select count(*) filter (where pick = 0), count(*) filter (where pick = 1) into a_before, b_before
      from arena_votes where pair = pr and dim = dm;
    pioneer := (a_before + b_before) = 0;
    crowd := null;
    if (a_before + b_before) >= 5 and a_before <> b_before then
      majority := case when a_before > b_before then 0 else 1 end;
      crowd := (pk = majority);
    end if;

    vxp := arena_vote_xp(ms, bonus, pioneer);

    insert into arena_votes (id, user_id, pair, dim, pick, ms, day, family, daily, xp)
      values (vid, me, pr, dm, pk, ms, vday, fam, is_daily, vxp)
      on conflict do nothing
      returning id into got;
    if got is null then
      results := results || jsonb_build_object('id', vid, 'accepted', false, 'reason', 'duplicate');
      continue;
    end if;

    -- How each specimen fares across all of its duels.
    insert into arena_stim (season, stim, dim, wins, losses)
      values (seas, fam || ':' || i, dm, case when pk = 0 then 1 else 0 end, case when pk = 0 then 0 else 1 end)
      on conflict (season, stim, dim) do update set wins = arena_stim.wins + excluded.wins, losses = arena_stim.losses + excluded.losses;
    insert into arena_stim (season, stim, dim, wins, losses)
      values (seas, fam || ':' || j, dm, case when pk = 1 then 1 else 0 end, case when pk = 1 then 0 else 1 end)
      on conflict (season, stim, dim) do update set wins = arena_stim.wins + excluded.wins, losses = arena_stim.losses + excluded.losses;

    -- The day.
    if not (vday = any(touched)) then touched := touched || vday; end if;
    insert into arena_daily (user_id, day) values (me, vday) on conflict (user_id, day) do nothing;
    update arena_daily set
      votes = votes + 1,
      xp = xp + vxp,
      max_combo = greatest(max_combo, least(combo, votes + 1)),
      eye_total = eye_total + case when eye is null then 0 else 1 end,
      eye_correct = eye_correct + case when eye then 1 else 0 end,
      crowd_total = crowd_total + case when crowd is null then 0 else 1 end,
      crowd_hits = crowd_hits + case when crowd then 1 else 0 end,
      daily_votes = daily_votes + case when is_daily then 1 else 0 end,
      families = arena_arr_add(families, fam),
      dims = arena_arr_add(dims, dm)
    where user_id = me and day = vday;

    -- The player.
    prof.xp_total := prof.xp_total + vxp;
    prof.votes_total := prof.votes_total + 1;
    if eye is not null then
      prof.eye_total := prof.eye_total + 1;
      if eye then prof.eye_correct := prof.eye_correct + 1; end if;
    end if;
    if crowd is not null then
      prof.crowd_total := prof.crowd_total + 1;
      if crowd then prof.crowd_hits := prof.crowd_hits + 1; end if;
    end if;
    prof.best_combo := greatest(prof.best_combo, least(combo, prof.votes_total));
    prof.families_seen := arena_arr_add(prof.families_seen, fam);
    if prof.last_day is null then
      prof.streak_days := 1;
      prof.last_day := vday;
    elsif vday = prof.last_day then
      prof.streak_days := greatest(prof.streak_days, 1);
    elsif vday = prof.last_day + 1 then
      prof.streak_days := prof.streak_days + 1;
      prof.last_day := vday;
    elsif vday > prof.last_day + 1 then
      prof.streak_days := 1;
      prof.last_day := vday;
    end if;
    prof.best_streak := greatest(prof.best_streak, prof.streak_days);

    results := results || jsonb_build_object('id', vid, 'accepted', true, 'xp', vxp, 'pioneer', pioneer, 'crowd', crowd);
  end loop;

  -- ---- time slices ----
  for s in select value from jsonb_array_elements(coalesce(p_slices, '[]'::jsonb)) loop
    begin
      sid := (s->>'id')::uuid;
      sday := coalesce((s->>'day')::date, today);
      ssec := (s->>'sec')::int;
      if ssec < 1 or ssec > 600 then
        raise exception 'invalid';
      end if;
    exception when others then
      continue;
    end;
    if sday < utc_today - 2 or sday > utc_today + 1 then
      sday := today;
    end if;
    got := null;
    insert into arena_slices (id, user_id, day, seconds) values (sid, me, sday, ssec)
      on conflict do nothing
      returning id into got;
    if got is not null then
      if not (sday = any(touched)) then touched := touched || sday; end if;
      insert into arena_daily (user_id, day) values (me, sday) on conflict (user_id, day) do nothing;
      update arena_daily set active_seconds = active_seconds + ssec where user_id = me and day = sday;
      prof.active_seconds := prof.active_seconds + ssec;
      prof.best_day_seconds := greatest(prof.best_day_seconds, (select active_seconds from arena_daily where user_id = me and day = sday));
    end if;
  end loop;

  -- ---- today's quests (chosen by the browser, validated here, fixed for the day) ----
  if p_slate is not null and jsonb_typeof(p_slate) = 'object' then
    begin
      slate_day := (p_slate->>'day')::date;
      select array_agg(value) into slate_ids from jsonb_array_elements_text(p_slate->'ids');
    exception when others then
      slate_day := null;
    end;
    if slate_day is not null
       and slate_day between utc_today - 1 and utc_today + 1
       and cardinality(coalesce(slate_ids, '{}')) = 3
       and (select count(*) from arena_quest_defs q where q.id = any(slate_ids)) = 3
       and (select count(distinct q.tier) from arena_quest_defs q where q.id = any(slate_ids)) = 3
       and (select count(distinct q.kind) from arena_quest_defs q where q.id = any(slate_ids)) = 3 then
      if not (slate_day = any(touched)) then touched := touched || slate_day; end if;
      insert into arena_daily (user_id, day) values (me, slate_day) on conflict (user_id, day) do nothing;
      update arena_daily set slate = slate_ids where user_id = me and day = slate_day and cardinality(slate) = 0;
    end if;
  end if;

  -- ---- badges (never taken away) ----
  prof.badges := (
    select coalesce(array_agg(distinct b), '{}'::text[])
    from unnest(prof.badges || arena_badges_for(
      prof.votes_total, prof.best_streak, prof.best_combo, prof.xp_total, prof.eye_correct, prof.eye_total,
      prof.crowd_hits, prof.crowd_total, cardinality(prof.families_seen), prof.best_day_seconds, prof.daily_sets
    )) as b
  );
  new_badges := array(select unnest(prof.badges) except select unnest(old_badges));

  update arena_profiles set
    xp_total = prof.xp_total, votes_total = prof.votes_total,
    eye_correct = prof.eye_correct, eye_total = prof.eye_total,
    crowd_hits = prof.crowd_hits, crowd_total = prof.crowd_total,
    best_combo = prof.best_combo, streak_days = prof.streak_days, best_streak = prof.best_streak,
    last_day = prof.last_day, active_seconds = prof.active_seconds, best_day_seconds = prof.best_day_seconds,
    families_seen = prof.families_seen, badges = prof.badges, updated_at = now()
  where user_id = me;

  return jsonb_build_object(
    'results', results,
    'newBadges', to_jsonb(new_badges),
    'state', arena_state_json(me, today),
    'days', coalesce((select jsonb_agg(arena_day_json(d) order by d.day) from arena_daily d where d.user_id = me and d.day = any(touched)), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_claim: collect a finished quest, the daily challenge, or the daily clear
-- ----------------------------------------------------------------------------
create or replace function arena_claim(p_day date, p_quest text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  prof arena_profiles;
  d arena_daily;
  def arena_quest_defs;
  reward int;
  old_badges text[];
  new_badges text[];
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 then
    return jsonb_build_object('ok', false, 'reason', 'day');
  end if;
  insert into arena_profiles (user_id) values (me) on conflict (user_id) do nothing;
  select * into prof from arena_profiles where user_id = me for update;
  old_badges := prof.badges;
  select * into d from arena_daily where user_id = me and day = p_day for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_done');
  end if;
  if p_quest = any(d.claimed) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;

  if p_quest = 'daily_set' then
    if d.daily_votes < 10 then
      return jsonb_build_object('ok', false, 'reason', 'not_done');
    end if;
    reward := 100;
  elsif p_quest = 'daily_clear' then
    if cardinality(d.slate) <> 3 or not (d.slate <@ d.claimed) then
      return jsonb_build_object('ok', false, 'reason', 'not_done');
    end if;
    reward := 50;
  else
    select * into def from arena_quest_defs where id = p_quest;
    if not found or not (p_quest = any(d.slate)) then
      return jsonb_build_object('ok', false, 'reason', 'unknown');
    end if;
    if not arena_quest_met(def.kind, def.target, d) then
      return jsonb_build_object('ok', false, 'reason', 'not_done');
    end if;
    reward := def.xp;
  end if;

  update arena_daily set claimed = claimed || p_quest, xp = xp + reward where user_id = me and day = p_day;
  prof.xp_total := prof.xp_total + reward;
  if p_quest = 'daily_set' then
    prof.daily_sets := prof.daily_sets + 1;
  end if;
  prof.badges := (
    select coalesce(array_agg(distinct b), '{}'::text[])
    from unnest(prof.badges || arena_badges_for(
      prof.votes_total, prof.best_streak, prof.best_combo, prof.xp_total, prof.eye_correct, prof.eye_total,
      prof.crowd_hits, prof.crowd_total, cardinality(prof.families_seen), prof.best_day_seconds, prof.daily_sets
    )) as b
  );
  new_badges := array(select unnest(prof.badges) except select unnest(old_badges));
  update arena_profiles set
    xp_total = prof.xp_total, daily_sets = prof.daily_sets, badges = prof.badges, updated_at = now()
  where user_id = me;

  return jsonb_build_object('ok', true, 'xp', reward, 'newBadges', to_jsonb(new_badges), 'state', arena_state_json(me, p_day));
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_my_votes: the caller's own answers for a season, so a new device can
-- rebuild "what have I already seen" and the Taste DNA. Paged by seq.
-- ----------------------------------------------------------------------------
create or replace function arena_my_votes(p_season text, p_after bigint default 0, p_limit int default 5000)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 5000), 1), 10000);
  rows jsonb;
  last_seq bigint;
  n int;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_season is null or p_season !~ '^[0-9]{6}$' then
    raise exception 'Bad season.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(t.pair, t.dim, t.pick) order by t.seq), '[]'::jsonb), max(t.seq), count(*)
    into rows, last_seq, n
  from (
    select seq, pair, dim, pick from arena_votes
    where user_id = me and seq > coalesce(p_after, 0) and pair like p_season || '/%'
    order by seq
    limit lim
  ) t;
  return jsonb_build_object('rows', rows, 'last', coalesce(last_seq, p_after, 0), 'more', n = lim);
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_leaderboard: weekly / all-time XP, optionally friends only
-- ----------------------------------------------------------------------------
create or replace function arena_leaderboard(p_scope text default 'week', p_friends boolean default false)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  week_start date := date_trunc('week', (now() at time zone 'utc')::date)::date;
  result jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_scope not in ('week', 'all') then
    raise exception 'Unknown scope.';
  end if;

  with scores as (
    select p.user_id, p.xp_total, p.streak_days, p.last_day,
           case when p_scope = 'week'
                then coalesce((select sum(d.xp) from arena_daily d where d.user_id = p.user_id and d.day >= week_start), 0)
                else p.xp_total end as xp
    from arena_profiles p
    where (p.show_on_leaderboard or p.user_id = me)
      and (not coalesce(p_friends, false) or p.user_id = me or exists (
        select 1 from friendships f
        where f.status = 'accepted' and f.user_min = least(me, p.user_id) and f.user_max = greatest(me, p.user_id)
      ))
  ), ranked as (
    select s.*, rank() over (order by s.xp desc) as rnk
    from scores s
    where s.xp > 0
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rnk,
        'userId', r.user_id,
        'name', pp.full_name,
        'username', pp.username,
        'avatarUrl', pp.avatar_url,
        'xp', r.xp,
        'level', arena_level(r.xp_total),
        'streak', case when r.last_day >= utc_today - 1 then r.streak_days else 0 end,
        'isMe', r.user_id = me
      ) order by r.rnk, r.user_id)
      from (select * from ranked order by rnk, user_id limit 50) r
      left join profiles_public pp on pp.id = r.user_id
    ), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rk.rnk, 'xp', rk.xp) from ranked rk where rk.user_id = me),
    'weekStart', week_start
  ) into result;

  return result;
end;
$$;

create or replace function arena_set_visibility(p_visible boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  insert into arena_profiles (user_id, show_on_leaderboard) values (me, coalesce(p_visible, true))
    on conflict (user_id) do update set show_on_leaderboard = coalesce(p_visible, true), updated_at = now();
  return coalesce(p_visible, true);
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_daily_report: how everyone answered the shared daily challenge, and
-- who thinks most like you (agreement on the duels you both answered that day)
-- ----------------------------------------------------------------------------
create or replace function arena_daily_report(p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  mine jsonb;
  split jsonb;
  twins jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_day is null or p_day < utc_today - 7 or p_day > utc_today + 1 then
    raise exception 'Bad day.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('pair', pair, 'dim', dim, 'pick', pick) order by seq), '[]'::jsonb)
    into mine
  from arena_votes where user_id = me and day = p_day and daily;

  select coalesce(jsonb_agg(jsonb_build_object('pair', m.pair, 'dim', m.dim, 'a', c.a, 'b', c.b) order by m.seq), '[]'::jsonb)
    into split
  from arena_votes m
  cross join lateral (
    select count(*) filter (where v.pick = 0) as a, count(*) filter (where v.pick = 1) as b
    from arena_votes v where v.pair = m.pair and v.dim = m.dim
  ) c
  where m.user_id = me and m.day = p_day and m.daily;

  with overlap as (
    select o.user_id, count(*) as shared, count(*) filter (where o.pick = m.pick) as same
    from arena_votes m
    join arena_votes o on o.pair = m.pair and o.dim = m.dim and o.user_id <> me and o.day = p_day and o.daily
    where m.user_id = me and m.day = p_day and m.daily
    group by o.user_id
    having count(*) >= 6
  ), shown as (
    select ov.*, exists (
      select 1 from friendships f
      where f.status = 'accepted' and f.user_min = least(me, ov.user_id) and f.user_max = greatest(me, ov.user_id)
    ) as is_friend
    from overlap ov
    join arena_profiles ap on ap.user_id = ov.user_id
    where ap.show_on_leaderboard or exists (
      select 1 from friendships f
      where f.status = 'accepted' and f.user_min = least(me, ov.user_id) and f.user_max = greatest(me, ov.user_id)
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', x.user_id, 'name', pp.full_name, 'username', pp.username, 'avatarUrl', pp.avatar_url,
      'shared', x.shared, 'agree', x.same, 'isFriend', x.is_friend
    ) order by x.same::numeric / x.shared desc, x.shared desc, x.user_id), '[]'::jsonb)
    into twins
  from (select * from shown order by same::numeric / shared desc, shared desc, user_id limit 5) x
  left join profiles_public pp on pp.id = x.user_id;

  return jsonb_build_object('day', p_day, 'mine', mine, 'split', split, 'twins', twins);
end;
$$;


-- ----------------------------------------------------------------------------
-- arena_admin_stats: for admins only -- how long people actually stay
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
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', s.day, 'players', s.players, 'votes', s.votes,
        'avgMinutes', round(s.avg_sec / 60.0, 1), 'over1h', s.over1h, 'over3h', s.over3h
      ) order by s.day)
      from (
        select d.day,
               count(*) as players,
               sum(d.votes) as votes,
               avg(d.active_seconds) as avg_sec,
               count(*) filter (where d.active_seconds >= 3600) as over1h,
               count(*) filter (where d.active_seconds >= 10800) as over3h
        from arena_daily d
        where d.day > utc_today - least(greatest(coalesce(p_days, 14), 1), 90) and (d.votes > 0 or d.active_seconds > 0)
        group by d.day
      ) s
    ), '[]'::jsonb)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- who may call what: signed-in users only (every function also checks auth.uid())
-- ----------------------------------------------------------------------------
revoke all on function arena_state(date, int) from public, anon;
revoke all on function arena_tallies(jsonb) from public, anon;
revoke all on function arena_submit(jsonb, jsonb, jsonb, date) from public, anon;
revoke all on function arena_claim(date, text) from public, anon;
revoke all on function arena_my_votes(text, bigint, int) from public, anon;
revoke all on function arena_leaderboard(text, boolean) from public, anon;
revoke all on function arena_set_visibility(boolean) from public, anon;
revoke all on function arena_daily_report(date) from public, anon;
revoke all on function arena_admin_stats(int) from public, anon;

grant execute on function arena_state(date, int) to authenticated;
grant execute on function arena_tallies(jsonb) to authenticated;
grant execute on function arena_submit(jsonb, jsonb, jsonb, date) to authenticated;
grant execute on function arena_claim(date, text) to authenticated;
grant execute on function arena_my_votes(text, bigint, int) to authenticated;
grant execute on function arena_leaderboard(text, boolean) to authenticated;
grant execute on function arena_set_visibility(boolean) to authenticated;
grant execute on function arena_daily_report(date) to authenticated;
grant execute on function arena_admin_stats(int) to authenticated;
