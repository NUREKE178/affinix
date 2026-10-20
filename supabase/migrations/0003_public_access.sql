-- ============================================================================
-- Affinix — defense-in-depth for the anonymous participant surface
--
-- RLS with no matching anon policy already denies anon everything on these
-- tables. This migration additionally revokes the table-level grants a
-- Supabase project applies by default (ALTER DEFAULT PRIVILEGES ... GRANT
-- ALL ON TABLES TO anon, authenticated, service_role`), so there is no
-- anon-reachable grant on participant-facing tables at all -- not even in
-- the hypothetical case a future migration adds a too-broad policy by
-- accident. Every public participant interaction (look up an experiment by
-- slug, read its variants/questions, start a session, submit a response)
-- goes exclusively through Edge Functions running with the service role
-- (see supabase/functions), which validates everything server-side.
-- ============================================================================

revoke all on experiments, experiment_variants, experiment_questions, experiment_question_options
  from anon;
revoke all on participant_sessions, responses, response_events
  from anon;

-- authenticated users (signed-in researchers) still rely entirely on the
-- RLS policies from 0002_rls.sql for row-level scoping -- their table
-- grants stay as provisioned by default.
