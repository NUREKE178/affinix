// The bottom bar of a conversation: text box, emoji, picture, send; plus the "replying to" / "editing" strip and the
// preview of a picture that is about to be sent. It holds no state of its own: the chat pane owns the text.
import { html, useRef, useEffect } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { Spinner } from "../../components/ui.js";
import { EMOJI } from "./parts.js";

const MAX_LEN = 4000;

export function Composer({
  t, value, onChange, onSubmit, onKeyDown, inputRef, emojiOpen, setEmojiOpen,
  replyInfo, onCancelReply, editing, onCancelEdit,
  attachment, preparing, canAttach, onPickFiles, onRemoveAttachment, onPaste,
}) {
  const fileRef = useRef(null);
  const nothing = !value.trim() && !attachment;

  function autosize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }
  // the box grows with the text and shrinks back after a send, an edit or a draft restored
  useEffect(autosize, [value]);

  function addEmoji(emoji) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
      autosize();
    });
  }

  return html`
    <div class="msg-composer-wrap" data-testid="chat-composer">
      ${replyInfo && !editing && html`
        <div class="msg-ctxbar" data-testid="chat-replybar">
          <${Icon} name="reply" size=${18} />
          <div class="msg-ctxbar-main">
            <span class="msg-ctxbar-title">${t("messages.replyingTo", { name: replyInfo.name })}</span>
            <span class="msg-ctxbar-text">${replyInfo.text}</span>
          </div>
          <button type="button" class="msg-ctxbar-x" onClick=${onCancelReply} aria-label=${t("messages.cancelReply")}><${Icon} name="close" size=${16} /></button>
        </div>`}
      ${editing && html`
        <div class="msg-ctxbar editing" data-testid="chat-editbar">
          <${Icon} name="edit" size=${18} />
          <div class="msg-ctxbar-main">
            <span class="msg-ctxbar-title">${t("messages.editing")}</span>
            <span class="msg-ctxbar-text">${editing.body || `📷 ${t("messages.photo")}`}</span>
          </div>
          <button type="button" class="msg-ctxbar-x" onClick=${onCancelEdit} aria-label=${t("messages.cancelEdit")}><${Icon} name="close" size=${16} /></button>
        </div>`}
      ${(attachment || preparing) && html`
        <div class="msg-attach" data-testid="chat-attachment">
          ${attachment
            ? html`<img src=${attachment.previewUrl} alt="" /><button type="button" class="msg-attach-x" onClick=${onRemoveAttachment} aria-label=${t("messages.removeImage")} data-testid="chat-attachment-remove"><${Icon} name="close" size=${14} /></button>`
            : html`<span class="msg-attach-busy"><${Spinner} size=${16} /></span>`}
        </div>`}
      <div class="sk-chat-composer">
        ${emojiOpen && html`
          <div class="sk-emoji-panel">
            ${EMOJI.map((e) => html`<button key=${e} type="button" onClick=${() => addEmoji(e)}>${e}</button>`)}
          </div>
        `}
        <button type="button" class="sk-chat-iconbtn" onClick=${() => setEmojiOpen(!emojiOpen)} aria-label=${t("messages.emoji")} aria-expanded=${emojiOpen}>
          <${Icon} name="smile" size=${22} />
        </button>
        ${canAttach && !editing && html`
          <button type="button" class="sk-chat-iconbtn" onClick=${() => fileRef.current?.click()} aria-label=${t("messages.attach")} title=${t("messages.attach")} data-testid="chat-attach">
            <${Icon} name="image" size=${22} />
          </button>
          <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp" class="hidden" data-testid="chat-file"
            onChange=${(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; onPickFiles(files); }} />`}
        <div class="msg-input-wrap">
          <textarea
            ref=${inputRef}
            rows="1"
            class="sk-input sk-chat-input"
            data-testid="chat-input"
            placeholder=${attachment ? t("messages.captionPlaceholder") : t("messages.placeholder")}
            maxlength=${MAX_LEN}
            value=${value}
            onInput=${(e) => { onChange(e.currentTarget.value); autosize(); }}
            onKeyDown=${(e) => { onKeyDown(e); requestAnimationFrame(autosize); }}
            onPaste=${onPaste}
          ></textarea>
          ${value.length > 3600 && html`<span class="msg-count">${value.length}/${MAX_LEN}</span>`}
        </div>
        <button type="button" class="sk-chat-send" data-testid="chat-send" onClick=${onSubmit} disabled=${nothing || preparing} aria-label=${editing ? t("messages.save") : t("messages.send")}>
          <${Icon} name=${editing ? "check" : "send"} size=${20} />
        </button>
      </div>
    </div>
  `;
}
