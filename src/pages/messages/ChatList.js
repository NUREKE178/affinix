// The left column: one row per conversation (pinned first), and the rows of a message search.
import { html } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { openProfile } from "../../lib/profileViewer.js";
import { PersonAvatar, listTime, highlightMatch, snippetAround } from "./parts.js";

/** What the second line of a row says: typing, an unsent draft, a deleted message, a picture, or the last text. */
function previewOf(item, { typing, draft, myId, t }) {
  if (typing) return { cls: "typing", node: html`<span class="sk-chat-typing-text">${t("messages.typing")}</span>` };
  if (draft) return { cls: "draft", node: html`<span class="msg-draft">${t("messages.draftLabel")}:</span> ${draft.replace(/\s+/g, " ")}` };
  const mine = item.lastSenderId === myId;
  const you = mine ? `${t("messages.you")}: ` : "";
  if (item.lastDeleted) return { cls: "deleted", node: html`<i>${mine ? t("messages.deletedMine") : t("messages.deletedTheirs")}</i>` };
  if (item.lastHasImage) return { cls: "", node: `${you}📷 ${item.lastBody || t("messages.photo")}` };
  if (item.lastBody) return { cls: "", node: `${you}${item.lastBody}` };
  return { cls: "", node: t("messages.startChat") };
}

export function ChatListItem({ item, active, online, typing, draft, myId, onOpen, t, locale }) {
  const preview = previewOf(item, { typing, draft: active ? "" : draft, myId, t });
  const unread = item.unread > 0;
  // The row opens the chat; the avatar on top of it opens the person's profile (two sibling buttons, like the
  // messengers do it: nothing interactive inside another interactive element).
  return html`
    <div class="sk-chat-row" data-testid="chat-row" data-pinned=${item.pinned ? "true" : "false"} data-muted=${item.muted ? "true" : "false"}>
      <button type="button" class=${`sk-chat-item ${active ? "active" : ""}`} onClick=${onOpen}>
        <span class="sk-chat-item-slot" aria-hidden="true"></span>
        <span class="sk-chat-item-main">
          <span class="sk-chat-item-top">
            <span class=${`sk-chat-name ${unread ? "unread" : ""}`}>${item.otherName ?? t("feed.unknownAuthor")}</span>
            <span class="sk-chat-time">
              ${item.muted && html`<span class="msg-list-flag" title=${t("messages.muted")}><${Icon} name="bellOff" size=${12} /></span>`}
              ${listTime(item.lastAt, locale, t)}
            </span>
          </span>
          <span class="sk-chat-item-bottom">
            <span class=${`sk-chat-preview ${unread ? "unread" : ""} ${preview.cls}`} data-testid="chat-preview">${preview.node}</span>
            ${unread
              ? html`<span class=${`sk-chat-unread ${item.muted ? "muted" : ""}`}>${item.unread > 99 ? "99+" : item.unread}</span>`
              : item.pinned && html`<span class="msg-list-pin" title=${t("messages.pinned")}><${Icon} name="pin" size=${13} /></span>`}
          </span>
        </span>
      </button>
      <button type="button" class="sk-chat-avatar-hit" data-testid="chat-list-avatar"
        title=${t("people.openProfile", { name: item.otherName ?? t("feed.unknownAuthor") })}
        onClick=${() => openProfile(item)}>
        <${PersonAvatar} name=${item.otherName} url=${item.otherAvatarUrl} size=${44} online=${online} />
      </button>
    </div>
  `;
}

/** A found message: who it is with, when, and the text around the match. */
export function MessageHit({ hit, conv, query, myId, onOpen, t, locale }) {
  const name = conv?.otherName ?? t("feed.unknownAuthor");
  const mine = hit.senderId === myId;
  return html`
    <button type="button" class="sk-chat-item msg-hit" data-testid="chat-hit" onClick=${onOpen}>
      <${PersonAvatar} name=${conv?.otherName} url=${conv?.otherAvatarUrl} size=${40} />
      <span class="sk-chat-item-main">
        <span class="sk-chat-item-top">
          <span class="sk-chat-name">${name}</span>
          <span class="sk-chat-time">${listTime(hit.createdAt, locale, t)}</span>
        </span>
        <span class="sk-chat-item-bottom">
          <span class="sk-chat-preview">${mine ? `${t("messages.you")}: ` : ""}${highlightMatch(snippetAround(hit.body, query), query)}</span>
        </span>
      </span>
    </button>
  `;
}
