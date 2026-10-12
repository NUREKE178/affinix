import { html } from "../lib/preact.js";
import { Icon } from "./icons.js";

function initialsFor(nameOrEmail) {
  if (!nameOrEmail) return "?";
  const parts = nameOrEmail.split(/[\s@._]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

/** A shared avatar renderer for new, cross-page UI (AuthorCard, FriendButton
 * callers, Friends.js) -- Feed.js and shell.js each already have their own
 * file-local Avatar, left as-is rather than risking a cross-file refactor
 * of already-shipped, already-tested code for this round's sake. */
export function Avatar({ name, url, size = 36 }) {
  if (url) {
    return html`<img src=${url} class="rounded-full object-cover shrink-0" style=${{ width: `${size}px`, height: `${size}px` }} />`;
  }
  return html`
    <div class="shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center font-semibold text-white"
      style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, size * 0.38)}px` }}>
      ${name ? initialsFor(name) : html`<${Icon} name="user" size=${Math.round(size * 0.55)} />`}
    </div>
  `;
}
