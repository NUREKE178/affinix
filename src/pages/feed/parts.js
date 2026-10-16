// Small shared pieces of the Feed: the avatar, text with links / hashtags, "copy link".
import { html } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { splitRichText } from "../../lib/richText.js";
import { toast } from "../../components/ui.js";

function initialsFor(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function Avatar({ name, url, size = 36 }) {
  if (url) {
    return html`<img src=${url} class="rounded-full object-cover shrink-0" style=${{ width: `${size}px`, height: `${size}px` }} />`;
  }
  return html`
    <div class="shrink-0 rounded-full sk-avatar flex items-center justify-center font-semibold"
      style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, size * 0.38)}px` }}>
      ${name ? initialsFor(name) : html`<${Icon} name="user" size=${Math.round(size * 0.55)} />`}
    </div>
  `;
}

/** Text with http(s) links clickable (new tab, no referrer) and, when `onHashtag` is given, hashtags as buttons. */
export function richNodes(text, { onHashtag = null } = {}) {
  return splitRichText(text, { tags: !!onHashtag }).map((tok, i) => {
    if (tok.type === "url") {
      return html`<a key=${i} class="feed-link" href=${tok.href} target="_blank" rel="noopener noreferrer nofollow" onClick=${(e) => e.stopPropagation()}>${tok.value}</a>`;
    }
    if (tok.type === "tag") {
      return html`<button type="button" key=${i} onClick=${() => onHashtag(tok.value)} class="text-signal-300 hover:text-signal-200 font-medium">${tok.value}</button>`;
    }
    return tok.value;
  });
}

/** A link to one post, to paste into a chat or a mail. */
export function postLink(id) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/app/feed?post=${encodeURIComponent(id)}`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function copyPostLink(id, t) {
  const ok = await copyToClipboard(postLink(id));
  toast(ok ? t("feed.linkCopied") : t("feed.linkCopyFailed"), ok ? "emerald" : "rose");
}
