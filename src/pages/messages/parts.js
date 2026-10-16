// Small shared pieces of the Messages page: times, text rendering (links, emoji-only), the picture of a bubble.
import { html, useState, useEffect, useCallback } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { Avatar } from "../../components/avatar.js";
import { getImageUrl, cachedImageUrl } from "../../lib/messagesStore.js";

export const EMOJI = ["😀", "😂", "😍", "🥰", "😎", "🤔", "😢", "😡", "👍", "👎", "🙏", "👏", "🔥", "🎉", "❤️", "💯", "✅", "👀", "🤝", "💪", "🚀", "☕", "😴", "🙌"];
export const DATE_LOCALES = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

export function timeOf(iso, locale) {
  return new Date(iso).toLocaleTimeString(DATE_LOCALES[locale] ?? "en-US", { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso, locale, t) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t("messages.today");
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("messages.yesterday");
  return d.toLocaleDateString(DATE_LOCALES[locale] ?? "en-US", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Chat-list timestamp: a clock time today, otherwise a short date. */
export function listTime(iso, locale, t) {
  if (!iso) return "";
  if (dayKey(iso) === dayKey(new Date().toISOString())) return timeOf(iso, locale);
  return dayLabel(iso, locale, t);
}

export function PersonAvatar({ name, url, size, online }) {
  return html`
    <span class="sk-avatar-wrap">
      <${Avatar} name=${name} url=${url} size=${size} />
      ${online && html`<span class="sk-online-dot"></span>`}
    </span>
  `;
}

/** ✓ sent, ✓✓ read, clock while sending. */
export function Ticks({ message }) {
  if (message.status === "sending") return html`<span class="sk-tick"><${Icon} name="clock" size=${13} /></span>`;
  if (message.readAt) return html`<span class="sk-tick sk-tick-read"><${Icon} name="checks" size=${15} /></span>`;
  return html`<span class="sk-tick"><${Icon} name="check" size=${14} /></span>`;
}

export function TypingDots() {
  return html`<span class="sk-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

// --- text ---------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Text with http(s) links made clickable (opening in a new tab, no referrer); everything else stays plain text. */
export function linkify(text) {
  const out = [];
  let last = 0;
  const re = new RegExp(URL_RE);
  let m;
  while ((m = re.exec(text))) {
    let raw = m[0];
    const tail = raw.match(TRAILING)?.[0] ?? "";
    raw = tail ? raw.slice(0, -tail.length) : raw;
    const href = safeUrl(raw);
    if (!href) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(html`<a key=${`${m.index}-${raw}`} class="msg-link" href=${href} target="_blank" rel="noopener noreferrer nofollow">${raw}</a>`);
    last = m.index + raw.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u;
/** One to three emoji and nothing else: shown large, like the messengers do. */
export function isEmojiOnly(text) {
  const s = (text ?? "").trim();
  if (!s || !EMOJI_ONLY.test(s)) return false;
  const count = [...s.matchAll(/\p{Extended_Pictographic}/gu)].length;
  return count >= 1 && count <= 3;
}

/** Splits `text` around case-insensitive matches of `query` and wraps those in <mark>. */
export function highlightMatch(text, query) {
  const q = (query ?? "").trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts = [];
  let from = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, from)) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(html`<mark key=${i}>${text.slice(i, i + needle.length)}</mark>`);
    from = i + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** A window of `text` around the first match, so a long message shows what was found. */
export function snippetAround(text, query, radius = 40) {
  const i = text.toLowerCase().indexOf((query ?? "").trim().toLowerCase());
  if (i <= radius) return text;
  return `…${text.slice(i - radius)}`;
}

/** One line for a quoted / replied-to message. */
export function quoteText(reply, t) {
  if (!reply) return t("messages.quoteMissing");
  if (reply.deleted) return t("messages.deleted");
  if (reply.body) return reply.body;
  return reply.hasImage ? `📷 ${t("messages.photo")}` : t("messages.quoteMissing");
}

// --- pictures -------------------------------------------------------------------
/** The URL of a bubble's picture: the local preview while it is being sent, otherwise a signed link (reloaded on demand). */
export function useMessageImage(path, localUrl) {
  const [url, setUrl] = useState(() => localUrl || (path ? cachedImageUrl(path) : null));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (localUrl) { setUrl(localUrl); setFailed(false); return undefined; }
    if (!path) { setUrl(null); return undefined; }
    const cached = cachedImageUrl(path);
    if (cached) { setUrl(cached); setFailed(false); return undefined; }
    let off = false;
    setFailed(false);
    getImageUrl(path).then((u) => { if (!off) setUrl(u); }, () => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [path, localUrl, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { url, failed, retry };
}
