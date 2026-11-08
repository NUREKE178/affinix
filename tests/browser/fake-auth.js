// A stand-in for src/lib/auth.js in the browser harness: a signed-in person chosen by ?u=&name=, no network.
const q = new URLSearchParams(location.search);
const user = q.get("u") ? { id: q.get("u"), email: `${q.get("u")}@test.local`, user_metadata: { full_name: q.get("name") ?? "" } } : null;
const session = user ? { user } : null;
export function useSession() { return { session, user, loading: false }; }
export function getCurrentUser() { return user; }
export function takeCallbackError() { return null; }
const no = async () => { throw new Error("not in the harness"); };
export const signUp = no, signIn = no, signInWithGoogle = no, signOut = no, requestPasswordReset = no, updatePassword = no, requestEmailChange = no;
export const friendlyAuthError = (e) => String(e?.message ?? e);
