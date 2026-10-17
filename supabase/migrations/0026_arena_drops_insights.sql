-- ============================================================================
-- 0026 -- Arena: daily drops, new families and questions, style insights for marketers
--
--  * Specimen indexes: a specimen index is now `pool * 32 + slot` (pool 0 = the month's classics, pool N = the drop of
--    the N-th day of the month, new every day), so a pair may use indexes up to 1023 (was < 64 and at most 2 digits).
--    arena_submit and arena_tallies are re-created with the wider check; nothing else about them changes.
--  * Questions: four brand-attribute dimensions join the original seven in duels: friendly, modern, natural, energetic.
--    (Crowd tests keep the original seven: their own table check is untouched.)
--  * The week theme rotates through nine families (the two photo-like ones, scene and shot, were added).
--  * New read-only functions for the style-insights page (marketers): arena_style_report (what wins, per specimen) and
--    arena_style_segments (the same per country, only for countries with enough distinct voters).
-- Idempotent: safe to run twice. Apply with `supabase db push`, then `notify pgrst, 'reload schema';`.
-- ============================================================================

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
    if pr is null or dm is null or pr !~ '^[0-9]{6}/[a-z]{2,12}/[0-9]{1,4}-[0-9]{1,4}$' then
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
      if pr !~ '^[0-9]{6}/[a-z]{2,12}/[0-9]{1,4}-[0-9]{1,4}$'
         or dm not in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent', 'friendly', 'modern', 'natural', 'energetic')
         or pk not in (0, 1) then
        raise exception 'invalid';
      end if;
      seas := split_part(pr, '/', 1);
      fam := split_part(pr, '/', 2);
      i := split_part(split_part(pr, '/', 3), '-', 1)::int;
      j := split_part(split_part(pr, '/', 3), '-', 2)::int;
      if i >= j or j >= 1024 or seas not in (cur_season, prev_season) then
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

-- The theme family of the week that starts on `p_week_start` (a Monday). Same list and order as FAMILY_IDS in catalog.js.
create or replace function arena_theme_family(p_week_start date)
returns text
language sql
immutable
as $$
  select (array['mark', 'palette', 'button', 'card', 'pack', 'poster', 'appicon', 'scene', 'shot'])[1 + (((p_week_start - date '1970-01-01') / 7) % 9)]
$$;


-- ----------------------------------------------------------------------------
-- arena_style_report: how every specimen of a season fared, for one question (or all of them) and one family (or all).
-- The traits of a specimen are not stored: the browser rebuilds them from the specimen key, so this returns only counts.
--   returns { season, votes, voters, rows: [[stim, dim, wins, losses], ...] }  (specimens with at least p_min answers)
-- ----------------------------------------------------------------------------
create or replace function arena_style_report(p_season text, p_dim text default null, p_family text default null, p_min int default 6)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  rows_json jsonb;
  total_votes bigint;
  total_voters bigint;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_season is null or p_season !~ '^[0-9]{6}$' then
    raise exception 'Bad season.';
  end if;
  if p_dim is not null and p_dim not in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent', 'friendly', 'modern', 'natural', 'energetic') then
    raise exception 'Bad question.';
  end if;
  if p_family is not null and p_family !~ '^[a-z]{2,12}$' then
    raise exception 'Bad family.';
  end if;
  p_min := least(greatest(coalesce(p_min, 6), 3), 1000);

  select coalesce(jsonb_agg(jsonb_build_array(x.stim, x.dim, x.wins, x.losses)), '[]'::jsonb)
    into rows_json
  from (
    select stim, dim, wins, losses
    from arena_stim
    where season = p_season
      and (p_dim is null or dim = p_dim)
      and (p_family is null or stim like p_family || ':%')
      and wins + losses >= p_min
    order by wins + losses desc, stim
    limit 4000
  ) x;

  select count(*), count(distinct user_id) into total_votes, total_voters
  from arena_votes
  where pair like p_season || '/' || coalesce(p_family, '%') || '/%'
    and (p_dim is null or dim = p_dim);

  return jsonb_build_object('season', p_season, 'votes', total_votes, 'voters', total_voters, 'rows', rows_json);
end;
$$;

-- ----------------------------------------------------------------------------
-- arena_style_segments: the same counts split by the voter's country (profiles.country), for countries where at least
-- p_min_voters different people answered, so a group is never a handful of identifiable people.
--   returns { countries: [{ code, voters, votes }], rows: [[country, stim, wins, losses], ...] }
-- ----------------------------------------------------------------------------
create or replace function arena_style_segments(p_season text, p_dim text, p_family text default null, p_min_voters int default 8)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  countries_json jsonb;
  rows_json jsonb;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;
  if p_season is null or p_season !~ '^[0-9]{6}$' then
    raise exception 'Bad season.';
  end if;
  if p_dim is null or p_dim not in ('preference', 'attention', 'trust', 'quality', 'premium', 'clarity', 'purchaseIntent', 'friendly', 'modern', 'natural', 'energetic') then
    raise exception 'Bad question.';
  end if;
  if p_family is not null and p_family !~ '^[a-z]{2,12}$' then
    raise exception 'Bad family.';
  end if;
  p_min_voters := least(greatest(coalesce(p_min_voters, 8), 5), 1000);

  with v as materialized (
    select upper(trim(p.country)) as country,
           split_part(av.pair, '/', 2) as fam,
           split_part(split_part(av.pair, '/', 3), '-', 1)::int as i,
           split_part(split_part(av.pair, '/', 3), '-', 2)::int as j,
           av.pick, av.user_id as uid
    from arena_votes av
    join profiles p on p.id = av.user_id
    where av.pair like p_season || '/' || coalesce(p_family, '%') || '/%'
      and av.dim = p_dim
      and p.country is not null and trim(p.country) <> ''
  ), big as (
    select country, count(distinct uid) as voters, count(*) as votes from v group by country having count(distinct uid) >= p_min_voters
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', c.country, 'voters', c.voters, 'votes', c.votes) order by c.voters desc, c.country), '[]'::jsonb)
    into countries_json
  from big c;

  with v as materialized (
    select upper(trim(p.country)) as country,
           split_part(av.pair, '/', 2) as fam,
           split_part(split_part(av.pair, '/', 3), '-', 1)::int as i,
           split_part(split_part(av.pair, '/', 3), '-', 2)::int as j,
           av.pick, av.user_id as uid
    from arena_votes av
    join profiles p on p.id = av.user_id
    where av.pair like p_season || '/' || coalesce(p_family, '%') || '/%'
      and av.dim = p_dim
      and p.country is not null and trim(p.country) <> ''
  ), big as (
    select country from v group by country having count(distinct uid) >= p_min_voters
  )
  select coalesce(jsonb_agg(jsonb_build_array(z.country, z.stim, z.wins, z.losses)), '[]'::jsonb)
    into rows_json
  from (
    select s.country, s.fam || ':' || s.idx as stim, sum(s.won) as wins, sum(1 - s.won) as losses
    from (
      select country, fam, i as idx, case when pick = 0 then 1 else 0 end as won from v
      union all
      select country, fam, j as idx, case when pick = 1 then 1 else 0 end from v
    ) s
    where s.country in (select country from big)
    group by s.country, s.fam, s.idx
    having count(*) >= 3
    order by count(*) desc, s.country, s.fam, s.idx
    limit 6000
  ) z;

  return jsonb_build_object('countries', countries_json, 'rows', rows_json);
end;
$$;

revoke all on function arena_style_report(text, text, text, int) from public, anon;
revoke all on function arena_style_segments(text, text, text, int) from public, anon;
grant execute on function arena_style_report(text, text, text, int) to authenticated;
grant execute on function arena_style_segments(text, text, text, int) to authenticated;
revoke all on function arena_tallies(jsonb) from public, anon;
grant execute on function arena_tallies(jsonb) to authenticated;
revoke all on function arena_submit(jsonb, jsonb, jsonb, date) from public, anon;
grant execute on function arena_submit(jsonb, jsonb, jsonb, date) to authenticated;

notify pgrst, 'reload schema';
