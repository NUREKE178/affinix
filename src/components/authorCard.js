import { html } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { Card } from "./ui.js";
import { Avatar } from "./avatar.js";
import { FriendButton } from "./friendButton.js";

/** The shared "who is this" popover -- a post/comment author in Feed.js and
 * Favorites.js (both reuse PostCard/CommentThread, which already call
 * onAuthorClick with the post/comment object itself), and a friend or a
 * pending request's other party in Friends.js. Takes that same
 * author-shaped object (authorId/authorName/authorAvatarUrl/
 * authorRoleTitle/authorBio) rather than this component learning several
 * different field-naming conventions -- a caller whose own data uses a
 * different shape (Friends.js's otherId/otherName/...) adapts it into this
 * one when it opens the popover. */
export function AuthorCard({ author, mounted, phase, onClose, t }) {
  if (!mounted || !author) return null;
  return html`
    <div class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" data-state=${phase} onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <${Card} className="sk-overlay-anim sk-overlay-anim-center max-w-sm w-full p-5" data-state=${phase}>
        <div class="flex items-start gap-3">
          <${Avatar} name=${author.authorName} url=${author.authorAvatarUrl} size=${48} />
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="font-semibold text-slate-100 truncate">${author.authorName}</div>
            ${author.authorRoleTitle && html`<div class="text-sm text-slate-400 truncate">${author.authorRoleTitle}</div>`}
          </div>
          <button type="button" onClick=${onClose} aria-label=${t("common.close")} class="shrink-0 text-slate-500 hover:text-slate-300">
            <${Icon} name="close" size=${16} />
          <//>
        </div>
        <p class="text-sm mt-4 leading-relaxed whitespace-pre-wrap ${author.authorBio ? "text-slate-300" : "text-slate-500 italic"}">
          ${author.authorBio || t("feed.noBio")}
        </p>
        ${author.authorId && html`
          <div class="mt-4 pt-4 border-t border-black/30">
            <${FriendButton} targetUserId=${author.authorId} />
          </div>
        `}
      <//>
    </div>
  `;
}
