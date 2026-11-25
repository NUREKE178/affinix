// Arena cash: the browser side of migration 0027.
//
// Research missions can pay a small money bonus (in tenge) on top of the XP. The server decides everything: which test
// pays (an admin funded it), whether this answer pays (eligibility, speed, the daily cap, the budget), when a bonus
// becomes available (after the holding period) and, later, the transfer to a bank. This module only reads the wallet,
// keeps it in one small reactive store (the Arena header, the wallet tab and the mission screens share it) and formats
// money. Amounts arrive as integers in tiyn (1 tenge = 100 tiyn) and are never computed with floats here.
import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { isMissingFunction, rpcHint } from "./rpcErrors.js";
import { withTimeout } from "./async.js";

export { TIYN_PER_TENGE, CASH_REASONS, formatMoney, parseTenge, payoutProgress, daysUntil } from "./money.js";

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/** An Error with `.hint` (payouts_closed, below_min, too_much, open_request, not_allowed, not_admin, not_owner,
 * bad_reward, bad_budget, note_required, not_found ...) and `.pending` (migration 0027 is not applied yet). */
export function toCashError(err) {
  if (err?.cash) return err;
  const out = new Error(err?.message ?? "Request failed");
  out.cash = true;
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  out.hint = rpcHint(err) ?? (/^[a-z][a-z_]{2,23}$/.test(msg) ? msg : null);
  out.pending = isMissingFunction(err);
  return out;
}

async function rpc(name, args = {}) {
  const sb = requireSupabase();
  const { data, error } = await withTimeout(sb.rpc(name, args), 20000);
  if (error) throw toCashError(error);
  return data;
}

// ---------------------------------------------------------------------------
// the wallet: one reactive store
// ---------------------------------------------------------------------------

let state = { wallet: null, loading: false, loaded: false, error: null, pending: false, forUser: undefined };
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

async function load({ silent = false } = {}) {
  const uid = getCurrentUser()?.id ?? null;
  if (!uid) { state = { wallet: null, loading: false, loaded: true, error: null, pending: false, forUser: null }; notify(); return; }
  if (!silent) { state = { ...state, loading: true, forUser: uid }; notify(); }
  try {
    const wallet = await rpc("cash_wallet");
    if ((getCurrentUser()?.id ?? null) !== uid) return;
    state = { wallet, loading: false, loaded: true, error: null, pending: false, forUser: uid };
  } catch (err) {
    state = { ...state, loading: false, loaded: true, error: err, pending: !!err.pending, forUser: uid, wallet: err.pending ? null : state.wallet };
  }
  notify();
}

/** Takes the wallet a mission answer came back with (arena_test_vote), so the header updates without another call. */
export function applyWallet(wallet) {
  if (!wallet || typeof wallet !== "object") return;
  state = { ...state, wallet, loaded: true, error: null, pending: false, forUser: getCurrentUser()?.id ?? state.forUser };
  notify();
}

export function refreshWallet() {
  return load({ silent: !!state.wallet });
}

/** { wallet, loading, loaded, error, pending, reload } -- `pending`: migration 0027 has not been applied yet. */
export function useWallet() {
  const [, setTick] = useState(0);
  const { user, loading: sessionLoading } = useSession();
  const uid = user?.id ?? null;
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  useEffect(() => {
    if (sessionLoading) return;
    if (!state.loading && state.forUser !== uid) load();
  }, [sessionLoading, uid]);
  return { ...state, loading: state.loading || !state.loaded, reload: () => load() };
}

/** Asks for `amount` tiyn to be transferred. Refused by the server while payouts are switched off. */
export async function requestPayout(amount) {
  const wallet = await rpc("cash_request_payout", { p_amount: amount });
  applyWallet(wallet);
  return wallet;
}

// ---------------------------------------------------------------------------
// admins (every call is refused to anybody else by the database)
// ---------------------------------------------------------------------------

export const fetchCashOverview = () => rpc("cash_admin_overview");
export const fetchCashTests = (query = "", limit = 30) => rpc("cash_admin_tests", { p_query: query, p_limit: limit });
export const fundTest = (testId, reward, budget) => rpc("cash_admin_fund_test", { p_test: testId, p_reward: reward, p_budget: budget });
export const fetchCashAccounts = (status = null, limit = 50) => rpc("cash_admin_accounts", { p_status: status, p_limit: limit });
export const setCashStatus = (userId, status, note = null, voidAvailable = false) =>
  rpc("cash_admin_set_status", { p_user: userId, p_status: status, p_note: note, p_void_available: voidAvailable });
export const voidCashEntry = (entryId, note) => rpc("cash_admin_void", { p_entry: entryId, p_note: note });
export const updateCashSettings = (patch) => rpc("cash_admin_update_settings", { p_patch: patch });
export const fetchPayouts = (status = "requested", limit = 50) => rpc("cash_admin_payouts", { p_status: status, p_limit: limit });
export const decidePayout = (requestId, decision, note = null) => rpc("cash_admin_decide_payout", { p_request: requestId, p_decision: decision, p_note: note });
