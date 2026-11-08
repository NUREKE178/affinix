// A stand-in for src/lib/org.js: a person with no workspace until ensureWorkspace is called (and how many times it was).
const org = { id: "o1", name: "Workspace", slug: "w", role: "owner" };
let made = false;
window.__workspaceCalls = 0;
export async function fetchMyOrganizations() { return made ? [org] : []; }
export function ensureWorkspace(user) {
  window.__workspaceCalls++;
  window.__workspaceUser = user?.user_metadata?.full_name ?? null;
  return new Promise((res) => setTimeout(() => { made = true; res(org); }, 150));
}
export async function createOrganization() { made = true; return org; }
export async function updateOrganizationName() {}
export async function fetchOrgMembers() { return []; }
export async function updateMemberRole() {}
export async function removeMember() {}
export async function addMemberByEmail() { return { status: "invited" }; }
