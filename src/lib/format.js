import { getLocale, t } from "./i18n.js";

export function pct(x, digits = 0) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function pts(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${x.toFixed(digits)} pts`;
}

export function num(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

export function money(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return "—";
  return `$${x.toFixed(digits)}`;
}

/** "2 min 44 s" in the app's language (the unit words come from the locale files). */
export function durationFromMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const locale = getLocale();
  const min = t(locale, "common.unitMin");
  const sec = t(locale, "common.unitSec");
  return m > 0 ? `${m} ${min} ${s} ${sec}` : `${s} ${sec}`;
}

export function relativeDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  const locale = getLocale();
  if (days <= 0) return t(locale, "common.today");
  if (days === 1) return t(locale, "common.yesterday");
  if (days < 30) return t(locale, "common.daysAgo", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t(locale, "common.monthsAgo", { n: months });
  return t(locale, "common.yearsAgo", { n: Math.floor(months / 12) });
}

const DATE_LOCALES = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

export function shortDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(DATE_LOCALES[getLocale()] ?? "ru-RU", { month: "short", day: "numeric", year: "numeric" });
}
