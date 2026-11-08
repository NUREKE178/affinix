// The front door: what a signed-in person sees first. Pure functions (no browser, no network) so the rule is testable.

/** What the app shell does for the current state of the session and of the person's workspace. */
export function gateFor({ configured, sessionLoading, hasSession, orgChecked, orgError, hasOrg }) {
  if (!configured) return "notConfigured";
  if (sessionLoading) return "loadingSession";
  if (!hasSession) return "login";
  if (!orgChecked) return "loadingWorkspace";
  if (orgError) return "error";
  if (!hasOrg) return "onboarding";
  return "app";
}
