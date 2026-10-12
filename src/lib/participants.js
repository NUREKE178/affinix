import { requireSupabase } from "./supabaseClient.js";
import { useState, useEffect } from "./preact.js";
import { useCurrentOrg } from "./currentOrg.js";
import { watchTables, debounce } from "./realtime.js";

function mapSession(row) {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    status: row.status,
    isDemo: false,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    consentGiven: row.consent_given,
    variantOrder: row.variant_order ?? [],
    questionOrder: row.question_order ?? [],
    demographics: row.demographics ?? {},
    responses: (row.responses ?? []).map((r) => ({
      questionId: r.question_id,
      variantId: r.variant_id,
      value: r.value,
      responseTimeMs: r.response_time_ms,
      shownAt: r.created_at,
    })),
  };
}

/** All participant sessions for one experiment (with their responses), in
 * the shape lib/stats.js and lib/insights.js already expect. */
export async function fetchSessionsForExperiment(experimentId) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("participant_sessions")
    .select("*, responses(*)")
    .eq("experiment_id", experimentId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSession);
}

/** Every session across every experiment in the org, with the parent
 * experiment's name attached -- used by the Participants page. Does not
 * pull response rows (not needed for that list view). */
export async function fetchSessionsForOrg(orgId) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("participant_sessions")
    .select("*, experiments!inner(id, name, organization_id)")
    .eq("experiments.organization_id", orgId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...mapSession(row), experimentName: row.experiments?.name ?? null }));
}

// --- Shared reactive cache, org-wide sessions (Overview + Participants page) ---
let orgSessionsState = { orgId: null, sessions: [], loading: true, error: null };
const orgSessionsListeners = new Set();
function notifyOrgSessions() {
  for (const l of orgSessionsListeners) l();
}

async function loadOrgSessions(orgId, { silent = false } = {}) {
  if (!silent) {
    orgSessionsState = { ...orgSessionsState, loading: true };
    notifyOrgSessions();
  }
  try {
    const sessions = await fetchSessionsForOrg(orgId);
    orgSessionsState = { orgId, sessions, loading: false, error: null };
  } catch (error) {
    orgSessionsState = silent ? { ...orgSessionsState, loading: false } : { orgId, sessions: [], loading: false, error };
  }
  notifyOrgSessions();
}

// Live: a participant starting or finishing a session updates Overview and
// the Participants page with no refresh. Ref-counted like the feed's socket;
// RLS means only members of the owning org ever receive these events.
let orgLiveUsers = 0;
let orgLiveUnsub = null;
const reloadOrgQuietly = debounce(() => {
  if (orgSessionsState.orgId) loadOrgSessions(orgSessionsState.orgId, { silent: true });
}, 600);
function startOrgLive() {
  orgLiveUsers += 1;
  if (orgLiveUnsub) return;
  orgLiveUnsub = watchTables("org-sessions-live", [{ table: "participant_sessions" }], reloadOrgQuietly,
    (status) => { if (status === "SUBSCRIBED" && orgSessionsState.orgId) reloadOrgQuietly(); });
}
function stopOrgLive() {
  orgLiveUsers = Math.max(0, orgLiveUsers - 1);
  if (orgLiveUsers === 0 && orgLiveUnsub) { orgLiveUnsub(); orgLiveUnsub = null; reloadOrgQuietly.cancel(); }
}

/** Live session list for ONE experiment (the Results page). Returns
 * `{ live }` so the page can show a Live badge; `onChange` is called after
 * every debounced realtime event and should refetch quietly. Watches
 * `responses` as well, because answers arrive as rows after the session
 * row itself already exists. */
export function watchExperimentLive(experimentId, onChange, onLive) {
  const fire = debounce(onChange, 700);
  const unsub = watchTables(
    `results:${experimentId}`,
    [
      { table: "participant_sessions", filter: `experiment_id=eq.${experimentId}` },
      { table: "responses" },
    ],
    fire,
    (status) => {
      onLive?.(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") fire(); // close any gap since the first fetch
    }
  );
  return () => { fire.cancel(); unsub(); };
}

export function invalidateOrgSessions() {
  if (orgSessionsState.orgId) loadOrgSessions(orgSessionsState.orgId);
}

export function useOrgSessions() {
  const { org } = useCurrentOrg();
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    orgSessionsListeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    if (org?.id && orgSessionsState.orgId !== org.id) loadOrgSessions(org.id);
    startOrgLive();
    return () => { orgSessionsListeners.delete(listener); stopOrgLive(); };
  }, [org?.id]);
  return {
    sessions: org && orgSessionsState.orgId === org.id ? orgSessionsState.sessions : [],
    loading: orgSessionsState.loading,
    error: orgSessionsState.error,
  };
}
