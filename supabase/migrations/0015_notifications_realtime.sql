-- ============================================================================
-- DecisionOS — live delivery for notifications
--
-- Without this, the bell only ever reflects notifications as of the last
-- page load/mount -- someone has to refresh to see a new one arrive. Adding
-- the table to Supabase's realtime publication lets the client subscribe to
-- INSERT events on it directly (lib/notificationsStore.js) instead of
-- polling.
--
-- No RLS change needed: Realtime's postgres_changes stream is filtered by
-- the same RLS policies the table already has (notifications_select_own,
-- 0014_post_interactions.sql) -- a subscriber only ever receives rows they
-- could already SELECT, i.e. only notifications addressed to them. Equivalent
-- to toggling this table on under Database -> Replication in the dashboard,
-- if that's easier than running SQL.
-- ============================================================================

alter publication supabase_realtime add table notifications;
