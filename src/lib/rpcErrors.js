// Shared reading of the errors the database functions raise.

/** "The migration has not been applied yet": PostgREST cannot find the function (or Supabase is not configured). */
export const isMissingFunction = (err) =>
  err?.code === "PGRST202" || err?.code === "42883" || err?.code === "NOT_CONFIGURED" || err?.status === 404 ||
  /could not find the function|function .* does not exist/i.test(err?.message ?? "");

/** The short machine-readable hint a database function attached to its error (need_level, closed ...), or null.
 * A network failure arrives with an empty hint and PostgREST's own hints are whole sentences: neither counts. */
export const rpcHint = (err) => (typeof err?.hint === "string" && /^[a-z][a-z_]{2,23}$/.test(err.hint) ? err.hint : null);
