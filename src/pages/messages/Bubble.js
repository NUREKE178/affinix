// One message of a conversation: quote, picture, text, time + ticks, reactions, and the ways to reach its actions
// (hover buttons, right click, long press, swipe to reply).
import { html, useRef } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { Spinner } from "../../components/ui.js";
import { timeOf, Ticks, linkify, isEmojiOnly, quoteText, useMessageImage } from "./parts.js";

const SWIPE_TRIGGER = 56;
const LONG_PRESS_MS = 450;

function BubbleImage({ message, ctx }) {
  const { url, failed, retry } = useMessageImage(message.attachmentPath, message.localImage);
  if (failed) {
    return html`<button type="button" class="msg-img-fail" onClick=${retry}><${Icon} name="image" size=${18} /><span>${ctx.t("messages.imageFailed")}</span><b>${ctx.t("common.retry")}</b></button>`;
  }
  if (!url) {
    return html`<div class="msg-img-ph" aria-label=${ctx.t("common.loading")}><${Spinner} size=${16} /></div>`;
  }
  return html`
    <button type="button" class="msg-img" data-testid="chat-image" aria-label=${ctx.t("messages.viewImage")} onClick=${() => ctx.onImage(url, message)}>
      <img src=${url} alt="" draggable="false" onLoad=${ctx.onImageLoad} />
      ${message.status === "sending" && html`<span class="msg-img-sending"><${Spinner} size=${18} /></span>`}
    </button>
  `;
}

function Quote({ message, ctx }) {
  const live = ctx.byId.get(message.replyToId);
  const reply = live
    ? { id: live.id, senderId: live.senderId, body: live.body, hasImage: !!live.attachmentPath, deleted: !!live.deletedAt }
    : message.reply;
  const who = !reply ? ctx.t("messages.quoteTitle") : reply.senderId === ctx.myId ? ctx.t("messages.you") : ctx.otherName ?? ctx.t("feed.unknownAuthor");
  return html`
    <button type="button" class=${`msg-quote ${reply && reply.senderId === ctx.myId ? "own" : ""}`} data-testid="chat-quote" onClick=${() => ctx.onJump(message.replyToId)}>
      <span class="msg-quote-name">${who}</span>
      <span class="msg-quote-text">${quoteText(reply, ctx.t)}</span>
    </button>
  `;
}

function Reactions({ message, ctx }) {
  const groups = new Map();
  for (const r of message.reactions ?? []) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.userId === ctx.myId) g.mine = true;
    groups.set(r.emoji, g);
  }
  if (groups.size === 0) return null;
  return html`
    <div class="msg-reacts" data-testid="chat-reactions">
      ${[...groups.values()].map((g) => html`
        <button key=${g.emoji} type="button" class=${`msg-react ${g.mine ? "mine" : ""}`} data-emoji=${g.emoji}
          aria-pressed=${g.mine} aria-label=${`${g.emoji} ${g.count}`}
          disabled=${!ctx.canReact} onClick=${() => ctx.onReact(message.id, g.emoji)}>
          <span>${g.emoji}</span>${g.count > 1 && html`<b>${g.count}</b>`}
        </button>`)}
    </div>
  `;
}

export function Bubble({ message, mine, grouped, highlighted, ctx }) {
  const { t, locale } = ctx;
  const colRef = useRef(null);
  const touch = useRef(null);
  const failed = message.status === "failed";
  const deleted = !!message.deletedAt;
  const hasImage = !!message.attachmentPath || !!message.localImage;
  const interactive = !deleted;
  const jumbo = !hasImage && !message.replyToId && isEmojiOnly(message.body);

  const openMenu = (e) => {
    if (!interactive) return;
    e.preventDefault?.();
    ctx.onMenu(message, colRef.current?.querySelector(".sk-bubble") ?? e.currentTarget);
  };

  // --- touch: long press opens the actions, a swipe to the right quotes the message ---
  const onTouchStart = (e) => {
    if (!interactive || e.touches.length !== 1) return;
    const p = e.touches[0];
    const timer = setTimeout(() => {
      if (touch.current) { touch.current.fired = true; try { navigator.vibrate?.(10); } catch { /* not supported */ } openMenu({ currentTarget: e.currentTarget }); }
    }, LONG_PRESS_MS);
    touch.current = { x: p.clientX, y: p.clientY, dx: 0, timer, fired: false, swiping: false };
  };
  const onTouchMove = (e) => {
    const s = touch.current;
    if (!s || s.fired) return;
    const p = e.touches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(s.timer);
    if (!s.swiping && dx > 12 && dx > Math.abs(dy) * 1.5) s.swiping = true;
    if (s.swiping && colRef.current) {
      s.dx = Math.max(0, Math.min(dx, 84));
      colRef.current.style.transition = "none";
      colRef.current.style.transform = `translateX(${s.dx}px)`;
      colRef.current.dataset.ready = s.dx >= SWIPE_TRIGGER ? "true" : "false";
    }
  };
  const onTouchEnd = () => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (colRef.current) { colRef.current.style.transition = ""; colRef.current.style.transform = ""; delete colRef.current.dataset.ready; }
    if (s.swiping && s.dx >= SWIPE_TRIGGER && ctx.canReply) ctx.onReply(message);
  };

  const bubbleCls = ["sk-bubble", mine ? "mine" : "", failed ? "failed" : "", deleted ? "deleted" : "", hasImage ? "has-image" : "", jumbo ? "jumbo" : ""].filter(Boolean).join(" ");

  return html`
    <div class=${`sk-msg-row ${mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${highlighted ? "flash" : ""} ${message.reactions?.length ? "has-reacts" : ""}`}
      data-msg-id=${message.id} data-testid="chat-msg" data-mine=${mine ? "true" : "false"} data-status=${message.status ?? ""}>
      <div class="msg-line">
        ${interactive && !message.status && html`
          <div class="msg-tools">
            ${ctx.canReply && html`<button type="button" class="msg-tool" data-testid="chat-tool-reply" aria-label=${t("messages.reply")} title=${t("messages.reply")} onClick=${() => ctx.onReply(message)}><${Icon} name="reply" size=${16} /></button>`}
            <button type="button" class="msg-tool" data-testid="chat-tool-more" aria-label=${t("messages.moreActions")} title=${t("messages.moreActions")} aria-haspopup="menu" onClick=${openMenu}><${Icon} name="more" size=${16} /></button>
          </div>
        `}
        <div class="msg-col" ref=${colRef} onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd} onContextMenu=${interactive ? openMenu : undefined}>
          <div class=${bubbleCls}>
            ${deleted
              ? html`<span class="sk-bubble-text msg-deleted">${mine ? t("messages.deletedMine") : t("messages.deletedTheirs")}</span>`
              : html`
                ${message.replyToId && html`<${Quote} message=${message} ctx=${ctx} />`}
                ${hasImage && html`<${BubbleImage} message=${message} ctx=${ctx} />`}
                ${message.body && html`<span class="sk-bubble-text msg-text" data-testid="chat-text">${linkify(message.body)}</span>`}`}
            <span class="sk-bubble-meta">
              ${message.editedAt && !deleted && html`<span class="msg-edited">${t("messages.edited")}</span>`}
              ${timeOf(message.createdAt, locale)}
              ${mine && !failed && !deleted && html`<${Ticks} message=${message} />`}
            </span>
          </div>
          ${!deleted && html`<${Reactions} message=${message} ctx=${ctx} />`}
          <span class="msg-swipe-ic" aria-hidden="true"><${Icon} name="reply" size=${18} /></span>
        </div>
      </div>
      ${failed && html`
        <button type="button" class="sk-msg-retry" onClick=${() => ctx.onRetry(message.id)}>
          <${Icon} name="shield" size=${13} /> ${t("messages.failedRetry")}
        </button>
      `}
    </div>
  `;
}
