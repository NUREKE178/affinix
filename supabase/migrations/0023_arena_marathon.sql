-- ============================================================================
-- Affinix -- the Arena marathon: Stage 3 of the Daily Challenge (migration 0023)
--
--   * extra shared sets: after the day's ten duels there are five more sets of ten (set 2 .. 6). Every vote of an extra
--     set carries its number; ten answered duels make the set claimable once for +40 XP (claim id set_2 .. set_6)
--   * the theme of the week: one design family per ISO week (Monday .. Sunday); answering 60 of its duels in the
--     week is claimable once for +150 XP (claim id week_theme)
--
-- Nothing else changes: votes pay what they paid, the clock is untouched (time still comes only from the slices the
-- browser sends while a Daily Challenge duel is on screen). The numbers are mirrored in src/lib/arena/rules.js.
-- Idempotent: safe to run twice.
-- ============================================================================

alter table arena_daily add column if not exists set_votes int[] not null default '{0,0,0,0,0}';
alter table arena_daily add column if not exists family_votes jsonb not null default '{}'::jsonb;

-- The Monday of the week a day belongs to.
create or replace function arena_week_start(p_day date)
returns date
language sql
immutable
as $$
  select p_day - (extract(isodow from p_day)::int - 1)
$$;

-- The theme family of the week that starts on `p_week_start` (a Monday). Same list and order as FAMILY_IDS in catalog.js.
create or replace function arena_theme_family(p_week_start date)
returns text
language sql
immutable
as $$
  select (array['mark', 'palette', 'button', 'card', 'pack', 'poster', 'appicon'])[1 + (((p_week_start - date '1970-01-01') / 7) % 7)]
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
    'claimed', to_jsonb(d.claimed),
    'setVotes', to_jsonb(d.set_votes),
    'familyVotes', d.family_votes
  )
$$;

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
  vset int;
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
      -- Stage 3 of the Daily Challenge: an extra shared set (2..6). Votes of the first set are `daily`, never both.
      vset := case when coalesce((v->>'set')::int, 0) between 2 and 6 and not is_daily then (v->>'set')::int else 0 end;
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
      dims = arena_arr_add(dims, dm),
      family_votes = jsonb_set(family_votes, array[fam], to_jsonb(coalesce((family_votes->>fam)::int, 0) + 1))
    where user_id = me and day = vday;
    if vset between 2 and 6 then
      update arena_daily set set_votes[vset - 1] = set_votes[vset - 1] + 1 where user_id = me and day = vday;
    end if;

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
  wk date;
  theme text;
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
  elsif p_quest ~ '^set_[2-6]$' then
    -- an extra shared set of Stage 3: ten of its duels answered
    if d.set_votes[substr(p_quest, 5)::int - 1] < 10 then
      return jsonb_build_object('ok', false, 'reason', 'not_done');
    end if;
    reward := 40;
  elsif p_quest = 'week_theme' then
    -- the theme of the week: enough duels of one family between Monday and Sunday, collected once
    wk := arena_week_start(p_day);
    theme := arena_theme_family(wk);
    if exists (select 1 from arena_daily x where x.user_id = me and x.day between wk and wk + 6 and 'week_theme' = any(x.claimed)) then
      return jsonb_build_object('ok', false, 'reason', 'claimed');
    end if;
    if (select coalesce(sum((x.family_votes->>theme)::int), 0) from arena_daily x where x.user_id = me and x.day between wk and wk + 6) < 60 then
      return jsonb_build_object('ok', false, 'reason', 'not_done');
    end if;
    reward := 150;
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

