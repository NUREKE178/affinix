// Money in the Arena (migration 0027): amounts are integers in tiyn (1 tenge = 100 tiyn), never floats.
// Pure helpers with no browser or network dependency, so plain Node can test them (tests/money.test.js).

export const TIYN_PER_TENGE = 100;

/** Why an answer paid nothing (the `cashReason` of arena_test_vote), as the key of a sentence the player can act on. */
export const CASH_REASONS = ["budget", "cap", "month_cap", "too_fast", "need_play", "new_account", "blocked", "off"];

// ---------------------------------------------------------------------------
// money formatting (pure, tested)
// ---------------------------------------------------------------------------

/** 125050 tiyn -> "1 250,50 ₸" (ru/kk) / "1,250.50 ₸" (en). Whole amounts drop the decimals: 120000 -> "1 200 ₸".
 * The sign always follows the number (the way prices are written in Kazakhstan), the same in every browser: the engines'
 * own currency patterns disagree (Chromium puts ₸ first for kk-KZ, Node after). */
export function formatMoney(tiyn, locale = "ru") {
  const n = Number.isFinite(Number(tiyn)) ? Math.trunc(Number(tiyn)) : 0;
  const whole = n % TIYN_PER_TENGE === 0;
  const tag = locale === "en" ? "en-US" : "ru-RU"; // kk uses the same grouping and decimal comma as ru
  let num;
  try {
    num = new Intl.NumberFormat(tag, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n / TIYN_PER_TENGE);
  } catch {
    num = (n / TIYN_PER_TENGE).toFixed(whole ? 0 : 2);
  }
  return `${num}\u00a0₸`;
}

/** A tenge amount typed by an admin ("10", "10,5", "1 250.75") -> tiyn, or null when it is not a valid amount. */
export function parseTenge(text) {
  const s = String(text ?? "").replace(/[\s ₸]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  return Number(int) * TIYN_PER_TENGE + Number((frac + "00").slice(0, 2));
}

/** How far the available balance is from the minimum withdrawal: { ratio 0..1, missing (tiyn), ready }. */
export function payoutProgress(wallet) {
  const min = Number(wallet?.rules?.minPayout ?? 0);
  const have = Number(wallet?.available ?? 0);
  if (!min) return { ratio: 0, missing: 0, ready: false };
  return { ratio: Math.min(1, have / min), missing: Math.max(0, min - have), ready: have >= min };
}

/** Whole days until `iso` (rounded up; 0 when it is due). */
export function daysUntil(iso, now = Date.now()) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}


// ---------------------------------------------------------------------------
// count-up (pure): the number the screen shows while a balance rolls to its new value
// ---------------------------------------------------------------------------

/** Ease-out cubic: fast at first, settling softly. t in 0..1. */
export const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** The whole-tiyn value shown `t` (0..1) of the way from `from` to `to`. Always ends exactly on `to`. */
export function countUpAt(from, to, t) {
  const a = Number.isFinite(Number(from)) ? Number(from) : 0;
  const b = Number.isFinite(Number(to)) ? Number(to) : 0;
  if (t >= 1) return Math.trunc(b);
  return Math.trunc(a + (b - a) * easeOut(t));
}
