// The harness never talks to the real project: no client, so the Arena store works from the device only.
export const supabase = null;
export function requireSupabase() { throw Object.assign(new Error("harness: no network"), { code: "NOT_CONFIGURED" }); }
