import { useState, useEffect } from "./preact.js";
import { useSession } from "./auth.js";
import { fetchMyOrganizations } from "./org.js";

let state = { orgs: [], activeOrgId: null, loading: true, loadedForUser: null };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function reload(userId) {
  state = { ...state, loading: true };
  notify();
  try {
    const orgs = await fetchMyOrganizations(userId);
    const stillValid = state.activeOrgId && orgs.some((o) => o.id === state.activeOrgId);
    state = { orgs, activeOrgId: stillValid ? state.activeOrgId : orgs[0]?.id ?? null, loading: false, loadedForUser: userId };
  } catch {
    state = { orgs: [], activeOrgId: null, loading: false, loadedForUser: userId };
  }
  notify();
}

export function setActiveOrgId(id) {
  state = { ...state, activeOrgId: id };
  notify();
}

export function invalidateOrgs() {
  if (state.loadedForUser) reload(state.loadedForUser);
}

/** { org, orgs, loading } -- `org` is the active organization (role included), defaults to the first one the user belongs to. */
export function useCurrentOrg() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    if (userId && state.loadedForUser !== userId) reload(userId);
    return () => listeners.delete(listener);
  }, [userId]);

  const org = state.orgs.find((o) => o.id === state.activeOrgId) ?? null;
  return { org, orgs: state.orgs, loading: state.loading };
}
