// Plain text -> pieces: links, hashtags, the rest. Pure, so it can be tested without a DOM; the callers turn the pieces
// into elements (Feed posts and comments show links and tags, chat messages show links only).

const TOKEN = /(https?:\/\/[^\s<>"']+)|(#[\p{L}\p{N}_]+)/giu;
const TRAILING = /[.,;:!?)\]}»”]+$/;

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** [{ type: "text" | "url" | "tag", value, href? }]. A link loses trailing punctuation ("see https://x.com/a." -> the dot stays text);
 * a `#` inside a link is part of the link, not a tag; only http(s) links are links. `tags: false` leaves hashtags as text. */
export function splitRichText(text, { tags = true } = {}) {
  const out = [];
  const src = String(text ?? "");
  let last = 0;
  const push = (type, value, extra = {}) => out.push({ type, value, ...extra });
  const re = new RegExp(TOKEN);
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) {
      let raw = m[1];
      const tail = raw.match(TRAILING)?.[0] ?? "";
      raw = tail ? raw.slice(0, -tail.length) : raw;
      const href = safeUrl(raw);
      if (!href) continue;
      if (m.index > last) push("text", src.slice(last, m.index));
      push("url", raw, { href });
      last = m.index + raw.length;
      re.lastIndex = last;
    } else if (tags) {
      // a '#' glued to a word ("C#", "a#b") is not a tag
      if (m.index > 0 && /[\p{L}\p{N}_]/u.test(src[m.index - 1])) continue;
      if (m.index > last) push("text", src.slice(last, m.index));
      push("tag", m[2]);
      last = m.index + m[2].length;
    }
  }
  if (last < src.length) push("text", src.slice(last));
  return out;
}

/** The hashtags of a text, lower-cased and without repeats, in order of appearance. */
export function extractTags(text) {
  const seen = new Set();
  for (const t of splitRichText(text)) if (t.type === "tag") seen.add(t.value.toLowerCase());
  return [...seen];
}

/** True when `text` carries exactly this hashtag (so #ui does not match #uiux). */
export const hasTag = (text, tag) => extractTags(text).includes(String(tag).toLowerCase());
