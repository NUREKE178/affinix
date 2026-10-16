// The actions of one message: a quick-reaction row and Reply / Copy / Edit / Delete. A floating menu next to the bubble
// on a wide screen, a sheet from the bottom on a phone. Delete asks once, inside the same menu.
import { html, useState, useEffect, useLayoutEffect, useRef } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { REACTION_SET } from "../../lib/messagesStore.js";

const isPhone = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;

export function ActionMenu({ message, anchor, mine, items, myReaction, onClose, onReact, onReply, onCopy, onEdit, onDelete, onRetry, t }) {
  const ref = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [pos, setPos] = useState(null);
  const phone = isPhone();

  // place the floating menu beside the bubble, flipped above it when there is no room below, and kept on screen
  useLayoutEffect(() => {
    if (phone || !ref.current || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const gap = 6;
    let top = a.bottom + gap;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - gap);
    let left = mine ? a.right - m.width : a.left;
    left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, [anchor, phone, confirming]);

  useLayoutEffect(() => {
    const first = ref.current?.querySelector("button:not([disabled])");
    first?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const list = [...ref.current.querySelectorAll("button:not([disabled])")];
        const i = list.indexOf(document.activeElement);
        list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
        e.preventDefault();
      }
    };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onScroll = () => { if (!phone) onClose(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const style = phone ? undefined : pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { top: "-9999px", left: "-9999px" };
  const act = (fn) => () => { onClose(); fn(); };

  return html`
    <div class=${phone ? "msg-sheet-backdrop" : "msg-menu-layer"} data-phone=${phone ? "true" : "false"}>
      <div class=${phone ? "msg-sheet" : "msg-menu"} ref=${ref} style=${style} role="menu" aria-label=${t("messages.moreActions")} data-testid="chat-menu">
        ${confirming
          ? html`
            <div class="msg-confirm">
              <div class="msg-confirm-title">${t("messages.deleteConfirmTitle")}</div>
              <p>${t("messages.deleteConfirmBody")}</p>
              <div class="msg-confirm-btns">
                <button type="button" class="msg-btn" onClick=${() => setConfirming(false)} data-testid="chat-delete-cancel">${t("common.cancel")}</button>
                <button type="button" class="msg-btn danger" onClick=${act(onDelete)} data-testid="chat-delete-confirm">${t("common.delete")}</button>
              </div>
            </div>`
          : html`
            ${items.react && html`
              <div class="msg-quick" role="group" aria-label=${t("messages.react")}>
                ${REACTION_SET.map((e) => html`<button key=${e} type="button" role="menuitem" class=${`msg-quick-btn ${myReaction === e ? "on" : ""}`} data-emoji=${e} aria-pressed=${myReaction === e} onClick=${act(() => onReact(e))}>${e}</button>`)}
              </div>`}
            <div class="msg-items">
              ${items.retry && html`<button type="button" role="menuitem" class="msg-item" onClick=${act(onRetry)} data-testid="chat-act-retry"><${Icon} name="shield" size=${17} />${t("messages.retry")}</button>`}
              ${items.reply && html`<button type="button" role="menuitem" class="msg-item" onClick=${act(onReply)} data-testid="chat-act-reply"><${Icon} name="reply" size=${17} />${t("messages.reply")}</button>`}
              ${items.copy && html`<button type="button" role="menuitem" class="msg-item" onClick=${act(onCopy)} data-testid="chat-act-copy"><${Icon} name="copy" size=${17} />${t("messages.copy")}</button>`}
              ${items.edit && html`<button type="button" role="menuitem" class="msg-item" onClick=${act(onEdit)} data-testid="chat-act-edit"><${Icon} name="edit" size=${17} />${t("messages.edit")}</button>`}
              ${items.remove && html`<button type="button" role="menuitem" class="msg-item danger" onClick=${() => (message.status ? act(onDelete)() : setConfirming(true))} data-testid="chat-act-delete"><${Icon} name="trash" size=${17} />${t("common.delete")}</button>`}
            </div>`}
      </div>
    </div>
  `;
}
