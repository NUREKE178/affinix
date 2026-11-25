// A stand-in for src/lib/supabaseClient.js whose database calls go to a REAL PostgreSQL (tests/browser/cash.e2e.cjs runs the
// migrations on a local server and answers POST /__rpc by calling the function as the signed-in person: auth.uid() = ?u=).
const uid = new URLSearchParams(location.search).get("u");
async function rpc(name, args = {}) {
  try {
    const res = await fetch("/__rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args, uid }) });
    const out = await res.json();
    return out.error ? { data: null, error: out.error } : { data: out.data, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err?.message ?? err) } };
  }
}
const storageBucket = { getPublicUrl: (path) => ({ data: { publicUrl: `/__h/missing/${path}` } }), upload: async () => ({ error: { message: "no storage in the harness" } }), remove: async () => ({}) };
const channel = () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} });
export const supabase = { rpc, storage: { from: () => storageBucket }, channel, removeChannel() {} };
export function requireSupabase() { return supabase; }
