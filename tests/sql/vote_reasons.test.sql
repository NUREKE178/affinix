-- Vote reasons (migration 0036): saved once, only for my own votes, counted per chosen specimen, never for a single person.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function t.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false) $$;
create or replace function t.raises(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000e0001', 'r1@x'), ('00000000-0000-0000-0000-0000000e0002', 'r2@x'), ('00000000-0000-0000-0000-0000000e0003', 'r3@x'), ('00000000-0000-0000-0000-0000000e0004', 'r4@x');
insert into profiles (id) select id from auth.users where email in ('r1@x', 'r2@x', 'r3@x', 'r4@x') on conflict (id) do nothing;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000e0001'; u2 uuid := '00000000-0000-0000-0000-0000000e0002';
  u3 uuid := '00000000-0000-0000-0000-0000000e0003'; u4 uuid := '00000000-0000-0000-0000-0000000e0004';
  v1 uuid := '10000000-0000-0000-0000-0000000e0001'; v2 uuid := '10000000-0000-0000-0000-0000000e0002'; v3 uuid := '10000000-0000-0000-0000-0000000e0003'; v4 uuid := '10000000-0000-0000-0000-0000000e0004';
  r jsonb;
begin
  -- four people chose the specimen 7 (pick 0 = the first of "7-9") of the family "poster" in the same season
  insert into arena_votes (id, user_id, pair, dim, pick, ms, day, family, xp) values
    (v1, u1, '202611/poster/7-9', 'preference', 0, 1500, '2026-11-20', 'poster', 5),
    (v2, u2, '202611/poster/7-9', 'preference', 0, 1500, '2026-11-20', 'poster', 5),
    (v3, u3, '202611/poster/7-9', 'preference', 0, 1500, '2026-11-20', 'poster', 5),
    (v4, u4, '202611/poster/7-9', 'preference', 1, 1500, '2026-11-20', 'poster', 5);

  perform t.as_user(null);
  perform t.ok(t.raises($q$select arena_set_reasons('[]')$q$) like '%Not signed in%', 'signed out: refused');

  perform t.as_user(u1);
  perform t.ok(arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v1, 'reason', 'color'))) = 1, 'my own vote gets its reason');
  perform t.ok(arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v1, 'reason', 'type'))) = 0, 'a reason is kept once: the second one is ignored');
  perform t.ok((select reason from arena_votes where id = v1) = 'color', '... and the first one stays');
  perform t.ok(arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v2, 'reason', 'color'))) = 0, 'somebody else''s vote cannot be changed');
  perform t.ok(arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v4, 'reason', 'mood'), jsonb_build_object('id', 'not-a-uuid', 'reason', 'color'), jsonb_build_object('id', gen_random_uuid(), 'reason', 'nonsense'))) = 0, 'junk is ignored without an error');
  perform t.ok(t.raises(format($q$select arena_set_reasons('%s')$q$, (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'reason', 'color')) from generate_series(1, 101)))) like '%Too many%', 'at most 100 reasons per request');

  perform t.as_user(u2);
  perform arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v2, 'reason', 'color')));
  perform t.as_user(u3);
  perform arena_set_reasons(jsonb_build_array(jsonb_build_object('id', v3, 'reason', 'layout')));
  r := arena_reason_report('202611', 'preference', 'poster');
  perform t.ok((r->>'total')::int = 3, 'the report counts the 3 reasons given');
  perform t.ok((r->'byReason'->>'color')::int = 2 and (r->'byReason'->>'layout')::int = 1, 'overall: colour 2, layout 1');
  perform t.ok(jsonb_array_length(r->'bySpecimen') = 1 and r->'bySpecimen'->0->>0 = 'poster:7' and r->'bySpecimen'->0->>1 = 'color' and (r->'bySpecimen'->0->>2)::int = 2, 'per specimen: poster:7, most often colour (2)');
  perform t.ok(jsonb_array_length(arena_reason_report('202611', 'trust', 'poster')->'bySpecimen') = 0, 'another question: nothing');
  perform t.ok(jsonb_array_length(arena_reason_report('202610', null, null)->'bySpecimen') = 0, 'another month: nothing');
  -- a specimen with fewer than 3 reasons is never listed (a person cannot be singled out)
  perform t.ok(not exists (select 1 from jsonb_array_elements(arena_reason_report('202611', null, null)->'bySpecimen') e where e->>0 = 'poster:9'), 'a specimen with a single reason is not listed');
  perform t.as_user(null);
  perform t.ok(t.raises($q$select arena_reason_report('202611')$q$) like '%Not signed in%', 'the report needs a signed-in person');
end $$;
