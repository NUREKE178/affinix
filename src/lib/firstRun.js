// The front door: what a signed-in person sees first. Pure functions (no browser, no network) so the rule is testable.

/** What the app shell does for the current state of the session and of the person's workspace. */
export function gateFor({ configured, sessionLoading, hasSession, orgChecked, orgError, hasOrg }) {
  if (!configured) return "notConfigured";
  if (sessionLoading) return "loadingSession";
  if (!hasSession) return "login";
  if (!orgChecked) return "loadingWorkspace";
  if (orgError) return "error";
  if (!hasOrg) return "provision"; // a workspace is made for them (org.js ensureWorkspace); they are never asked to name one
  return "app";
}

/** The name of the workspace made silently for a new person: their own name (a researcher renames it in Settings), else the part of the email before "@". */
export function workspaceNameFor({ fullName, email } = {}) {
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const cut = (v) => Array.from(v).slice(0, 60).join("");
  const name = clean(fullName);
  if (name) return cut(name);
  const local = clean(String(email ?? "").split("@")[0]);
  return local ? cut(local) : "Workspace";
}

/** Should the one-screen welcome be shown in the Arena? Only to someone who has not answered a duel yet and has not been through it. */
export function firstLookDue({ votes, seen }) {
  return votes === 0 && !seen;
}
