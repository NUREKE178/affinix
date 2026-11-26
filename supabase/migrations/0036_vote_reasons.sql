-- ============================================================================
-- Affinix: "why did you choose this one?" (the reason behind a duel vote)
--
-- After a duel the player may tap ONE short reason (colour, type, layout, clarity, trust, mood). It is optional, it never blocks the next duel and it is
-- not part of the response-time measurement. The marketer's page ("What people love") shows, per question, why people chose what they chose.
--
--   arena_votes.reason            the reason of a vote (null = none given)
--   arena_set_reasons(jsonb)      [{ "id": <vote id>, "reason": "color" }]  the browser sends them after the votes themselves are saved; only my
--                                 own votes, only once per vote, unknown ids / words are ignored
--   arena_reason_report(season, dim, family)
--                                 counts of reasons for the specimens that WON a duel in that season / question / family: overall, and per
--                                 specimen (only specimens with at least 3 reasons, so nobody can be singled out)
-- Safe to run twice.
-- ============================================================================

alter table arena_votes add column if not exists reason text;
alter table arena_votes drop constraint if exists arena_votes_reason_check;
alter table arena_votes add constraint arena_votes_reason_check check (reason is null or reason in ('color', 'type', 'layout', 'clear', 'trust', 'mood'));

create or replace function arena_set_reasons(p_reasons jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  item jsonb;
  n integer := 0;
  c integer;
begin
  if me is null then raise exception 'Not signed in.'; end if;
  if jsonb_typeof(coalesce(p_reasons, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_reasons, '[]'::jsonb)) > 100 then
    raise exception 'Too many reasons in one request.';
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb)) loop
    continue when coalesce(item->>'reason', '') not in ('color', 'type', 'layout', 'clear', 'trust', 'mood');
    continue when coalesce(item->>'id', '') !~ '^[0-9a-fA-F-]{36}$';
    update arena_votes set reason = item->>'reason'
      where id = (item->>'id')::uuid and user_id = me and reason is null;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;

create or replace function arena_reason_report(p_season text, p_dim text default null, p_family text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  total_n bigint;
  by_reason jsonb;
  by_stim jsonb;
begin
  if me is null then raise exception 'Not signed in.'; end if;
  if p_season is null or p_season !~ '^[0-9]{6}$' then raise exception 'Bad season.'; end if;
  if p_dim is not null and p_dim !~ '^[A-Za-z]{2,20}$' then raise exception 'Bad question.'; end if;
  if p_family is not null and p_family !~ '^[a-z]{2,12}$' then raise exception 'Bad family.'; end if;

  with chosen as (
    select av.reason,
           split_part(av.pair, '/', 2) || ':' ||
             case when av.pick = 0 then split_part(split_part(av.pair, '/', 3), '-', 1) else split_part(split_part(av.pair, '/', 3), '-', 2) end as stim
    from arena_votes av
    where av.reason is not null
      and split_part(av.pair, '/', 1) = p_season
      and (p_dim is null or av.dim = p_dim)
      and (p_family is null or split_part(av.pair, '/', 2) = p_family)
  )
  select count(*) into total_n from chosen;

  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) into by_reason
  from (select reason, count(*) as n from (
          select av.reason from arena_votes av
          where av.reason is not null and split_part(av.pair, '/', 1) = p_season
            and (p_dim is null or av.dim = p_dim) and (p_family is null or split_part(av.pair, '/', 2) = p_family)
        ) r group by reason) x;

  select coalesce(jsonb_agg(jsonb_build_array(stim, reason, n)), '[]'::jsonb) into by_stim
  from (
    select stim, reason, n from (
      select stim, reason, count(*) as n, sum(count(*)) over (partition by stim) as stim_total,
             row_number() over (partition by stim order by count(*) desc, reason) as rk
      from (
        select split_part(av.pair, '/', 2) || ':' ||
               case when av.pick = 0 then split_part(split_part(av.pair, '/', 3), '-', 1) else split_part(split_part(av.pair, '/', 3), '-', 2) end as stim,
               av.reason
        from arena_votes av
        where av.reason is not null and split_part(av.pair, '/', 1) = p_season
          and (p_dim is null or av.dim = p_dim) and (p_family is null or split_part(av.pair, '/', 2) = p_family)
      ) c group by stim, reason
    ) z where rk = 1 and stim_total >= 3
    order by stim_total desc limit 400
  ) y;

  return jsonb_build_object('season', p_season, 'total', total_n, 'byReason', by_reason, 'bySpecimen', by_stim);
end $$;

revoke execute on function arena_set_reasons(jsonb) from public, anon;
revoke execute on function arena_reason_report(text, text, text) from public, anon;
grant execute on function arena_set_reasons(jsonb) to authenticated;
grant execute on function arena_reason_report(text, text, text) to authenticated;

notify pgrst, 'reload schema';
