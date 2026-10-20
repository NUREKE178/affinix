-- ============================================================================
-- Affinix — initial schema
-- Users/orgs/experiments/variants/questions/sessions/responses/insights/reports
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type member_role as enum ('owner', 'admin', 'researcher', 'viewer');
create type experiment_status as enum ('draft', 'published', 'paused', 'completed', 'archived');
create type question_type as enum (
  'single_choice', 'multiple_choice', 'rating', 'ranking',
  'yes_no', 'recall', 'open_text', 'price_perception'
);
create type question_applies_to as enum ('variants', 'general');
create type session_status as enum ('in_progress', 'completed', 'abandoned');

-- ----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  locale text not null default 'ru' check (locale in ('ru', 'kk', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- organizations / membership
-- ----------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'researcher',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_idx on organization_members(user_id);

-- Helper functions used throughout RLS policies below.
-- SECURITY DEFINER + fixed search_path so they can't be hijacked, and so they
-- bypass RLS on organization_members themselves (avoids infinite recursion).
create function is_org_member(org_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

create function org_role(org_id uuid)
returns member_role
language sql security definer stable set search_path = public
as $$
  select role from organization_members
  where organization_id = org_id and user_id = auth.uid()
  limit 1;
$$;

create function can_manage_org(org_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select org_role(org_id) in ('owner', 'admin', 'researcher');
$$;

-- SECURITY DEFINER so it bypasses `organizations`' own RLS: used only to let
-- a brand-new org's creator seat themselves as its first member (see
-- organization_members insert policy below) before any membership row --
-- and therefore no RLS visibility into the org -- exists yet.
create function is_org_creator(org_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from organizations where id = org_id and created_by = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- experiments
-- ----------------------------------------------------------------------------
create table experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  objective text,
  category text,
  language text not null default 'ru',
  target_audience text,
  research_type text,
  participant_limit integer,
  status experiment_status not null default 'draft',
  public_slug text unique,
  settings jsonb not null default '{}'::jsonb,
  participant_settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz
);

create index experiments_org_idx on experiments(organization_id);
create unique index experiments_slug_idx on experiments(public_slug) where public_slug is not null;

-- ----------------------------------------------------------------------------
-- variants
-- ----------------------------------------------------------------------------
create table experiment_variants (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  label text not null,
  name text not null,
  description text,
  asset_url text,
  asset_type text,
  color text,
  "position" integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index variants_experiment_idx on experiment_variants(experiment_id);

-- ----------------------------------------------------------------------------
-- questions + fixed-choice options
-- ----------------------------------------------------------------------------
create table experiment_questions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  type question_type not null,
  applies_to question_applies_to not null default 'general',
  role text,
  prompt text not null,
  scale jsonb,
  required boolean not null default true,
  "position" integer not null default 0,
  created_at timestamptz not null default now()
);

create index questions_experiment_idx on experiment_questions(experiment_id);

create table experiment_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references experiment_questions(id) on delete cascade,
  label text not null,
  "position" integer not null default 0
);

create index question_options_question_idx on experiment_question_options(question_id);

-- ----------------------------------------------------------------------------
-- participant sessions / responses / behavioral events
-- Note: anonymous participants never talk to these tables directly over the
-- client RLS surface. All writes go through Edge Functions (service role),
-- which validate the experiment is published, assign server-side
-- randomization, and enforce one-response-per-question. See supabase/functions.
-- ----------------------------------------------------------------------------
create table participant_sessions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  status session_status not null default 'in_progress',
  variant_order jsonb not null default '[]'::jsonb,
  question_order jsonb not null default '[]'::jsonb,
  demographics jsonb not null default '{}'::jsonb,
  consent_given boolean not null default false,
  consent_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  client_token uuid not null default gen_random_uuid()
);

create index sessions_experiment_idx on participant_sessions(experiment_id);
create unique index sessions_client_token_idx on participant_sessions(client_token);

create table responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references participant_sessions(id) on delete cascade,
  question_id uuid not null references experiment_questions(id) on delete cascade,
  variant_id uuid references experiment_variants(id) on delete set null,
  value jsonb not null,
  response_time_ms integer,
  "position" integer not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create index responses_session_idx on responses(session_id);
create index responses_question_idx on responses(question_id);

create table response_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references participant_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index response_events_session_idx on response_events(session_id);

-- ----------------------------------------------------------------------------
-- AI insights + reports
-- ----------------------------------------------------------------------------
create table ai_insights (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  generated_at timestamptz not null default now(),
  model text,
  input_summary jsonb not null,
  output jsonb,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'not_configured')),
  created_by uuid references auth.users(id)
);

create index ai_insights_experiment_idx on ai_insights(experiment_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  generated_at timestamptz not null default now(),
  content jsonb not null,
  created_by uuid references auth.users(id)
);

create index reports_experiment_idx on reports(experiment_id);

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger experiments_set_updated_at before update on experiments
  for each row execute function set_updated_at();
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
