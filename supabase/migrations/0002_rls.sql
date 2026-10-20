-- ============================================================================
-- Affinix — Row Level Security
--
-- Model:
--   * Every org-owned table is readable by any member of that org, writable
--     only by owner/admin/researcher (viewer is read-only).
--   * organizations/organization_members have their own narrower policies.
--   * Anonymous (anon) participants get NO direct table/view access at all --
--     no SELECT, no INSERT, nothing. A policy like "anon can read published
--     experiments" sounds scoped, but RLS policies for the same command
--     OR-combine across every matching policy on a table regardless of which
--     one you were "thinking about", and a plain SELECT policy with no
--     `to <role>` applies to anon AND authenticated alike -- so a looser
--     anon policy silently widens what every signed-in researcher can see
--     too (which is exactly the cross-tenant leak an earlier draft of this
--     migration had, caught in local testing). It also lets anyone enumerate
--     every org's published experiment names by querying without a slug
--     filter. Simplest correct answer: anon gets nothing here. Every public
--     participant interaction (look up an experiment by slug, fetch its
--     variants/questions, start a session, submit a response) goes through
--     Edge Functions running with the service role (see supabase/functions),
--     which bypasses RLS and does its own validation -- published status,
--     slug-scoped lookups only, duplicate prevention, etc.
-- ============================================================================

alter table profiles enable row level security;
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table experiments enable row level security;
alter table experiment_variants enable row level security;
alter table experiment_questions enable row level security;
alter table experiment_question_options enable row level security;
alter table participant_sessions enable row level security;
alter table responses enable row level security;
alter table response_events enable row level security;
alter table ai_insights enable row level security;
alter table reports enable row level security;

-- ---------------------------------------------------------------- profiles
create policy "profiles: read own" on profiles
  for select using (id = auth.uid());
create policy "profiles: update own" on profiles
  for update using (id = auth.uid());

-- ----------------------------------------------------------- organizations
create policy "organizations: members can read" on organizations
  for select using (is_org_member(id));
create policy "organizations: authenticated users can create" on organizations
  for insert with check (created_by = auth.uid());
create policy "organizations: owner/admin can update" on organizations
  for update using (org_role(id) in ('owner', 'admin'));
create policy "organizations: owner can delete" on organizations
  for delete using (org_role(id) = 'owner');

-- --------------------------------------------------------- org membership
create policy "members: read within own org" on organization_members
  for select using (is_org_member(organization_id));
create policy "members: owner/admin can add" on organization_members
  for insert with check (org_role(organization_id) in ('owner', 'admin'));
create policy "members: owner/admin can change roles" on organization_members
  for update using (org_role(organization_id) in ('owner', 'admin'));
create policy "members: owner/admin can remove, or self can leave" on organization_members
  for delete using (org_role(organization_id) in ('owner', 'admin') or user_id = auth.uid());

-- The very first member of a brand-new org must be insertable by the
-- creator even before any membership row exists (chicken-and-egg): allow a
-- user to insert themselves as 'owner' into an org they just created.
create policy "members: creator can seat themselves as owner" on organization_members
  for insert with check (
    user_id = auth.uid()
    and role = 'owner'
    and is_org_creator(organization_id)
  );

-- ------------------------------------------------------------ experiments
create policy "experiments: org members can read" on experiments
  for select using (is_org_member(organization_id));
create policy "experiments: researcher+ can create" on experiments
  for insert with check (can_manage_org(organization_id) and created_by = auth.uid());
create policy "experiments: researcher+ can update" on experiments
  for update using (can_manage_org(organization_id));
create policy "experiments: researcher+ can delete" on experiments
  for delete using (can_manage_org(organization_id));

-- No anon policy on experiments at all -- see the model note above.
-- Public lookups go through the service-role Edge Functions.

-- ------------------------------------------------- variants / questions / options
create policy "variants: org members can read" on experiment_variants
  for select using (is_org_member((select organization_id from experiments e where e.id = experiment_id)));
create policy "variants: researcher+ can write" on experiment_variants
  for all using (can_manage_org((select organization_id from experiments e where e.id = experiment_id)))
  with check (can_manage_org((select organization_id from experiments e where e.id = experiment_id)));

create policy "questions: org members can read" on experiment_questions
  for select using (is_org_member((select organization_id from experiments e where e.id = experiment_id)));
create policy "questions: researcher+ can write" on experiment_questions
  for all using (can_manage_org((select organization_id from experiments e where e.id = experiment_id)))
  with check (can_manage_org((select organization_id from experiments e where e.id = experiment_id)));

create policy "options: org members can read" on experiment_question_options
  for select using (is_org_member((select organization_id from experiments e join experiment_questions q on q.experiment_id = e.id where q.id = question_id)));
create policy "options: researcher+ can write" on experiment_question_options
  for all using (can_manage_org((select organization_id from experiments e join experiment_questions q on q.experiment_id = e.id where q.id = question_id)))
  with check (can_manage_org((select organization_id from experiments e join experiment_questions q on q.experiment_id = e.id where q.id = question_id)));

-- ---------------------------------------------- sessions / responses / events
-- Org members (researchers) can read their own org's participant data for
-- analysis. No one gets direct INSERT/UPDATE from the client API — those
-- happen only via Edge Functions using the service role (see supabase/functions).
create policy "sessions: org members can read" on participant_sessions
  for select using (is_org_member((select organization_id from experiments e where e.id = experiment_id)));

create policy "responses: org members can read" on responses
  for select using (is_org_member((
    select organization_id from experiments e
    join participant_sessions s on s.experiment_id = e.id
    where s.id = session_id
  )));

create policy "response_events: org members can read" on response_events
  for select using (is_org_member((
    select organization_id from experiments e
    join participant_sessions s on s.experiment_id = e.id
    where s.id = session_id
  )));

-- -------------------------------------------------------- insights / reports
create policy "ai_insights: org members can read" on ai_insights
  for select using (is_org_member((select organization_id from experiments e where e.id = experiment_id)));
create policy "ai_insights: researcher+ can request" on ai_insights
  for insert with check (can_manage_org((select organization_id from experiments e where e.id = experiment_id)));

create policy "reports: org members can read" on reports
  for select using (is_org_member((select organization_id from experiments e where e.id = experiment_id)));
create policy "reports: researcher+ can create" on reports
  for insert with check (can_manage_org((select organization_id from experiments e where e.id = experiment_id)));
