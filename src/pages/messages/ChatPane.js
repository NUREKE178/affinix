// One open conversation: header, the messages (day separators, "N unread" line, jump-to-latest), the composer,
// and the things that hang off a message (actions menu, reply, edit, picture viewer, drag & drop of a picture).
import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { Skeleton, toast, Spinner, LoadingLabel } from "../../components/ui.js";
import { PersonLink } from "../../components/profileViewer.js";
import { openProfile } from "../../lib/profileViewer.js";
import { t as translate } from "../../lib/i18n.js";
import {
  useThread, useMessagingCaps, loadOlderMessages, sendMessage, retryMessage, editMessage, deleteMessage, reactToMessage,
  setConversationPref, ensureMessageLoaded, prepareChatImage, signalTyping, getDraft, setDraft, EDIT_WINDOW_MS,
} from "../../lib/messagesStore.js";
import { PersonAvatar, TypingDots, dayKey, dayLabel, quoteText } from "./parts.js";
import { Bubble } from "./Bubble.js";
import { Composer } from "./Composer.js";
import { ActionMenu } from "./ActionMenu.js";

const GROUP_GAP_MS = 5 * 60 * 1000;
const AWAY_PX = 280;
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function copyText(text) {
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

function HeadMenu({ conv, caps, t, errText, onClose }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.("[data-head-menu-btn]")) onClose(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown, true); };
  }, []);
  const run = (fn) => () => { onClose(); fn(); };
  const fail = (res) => { if (!res.ok) toast(errText(res.error), "rose"); };
  return html`
    <div class="msg-head-menu" ref=${ref} role="menu" data-testid="chat-head-menu">
      <button type="button" role="menuitem" class="msg-item" onClick=${run(() => openProfile(conv))}><${Icon} name="user" size=${17} />${t("messages.openProfile")}</button>
      ${caps.actions !== "old" && html`
        <button type="button" role="menuitem" class="msg-item" data-testid="chat-pin" onClick=${run(async () => fail(await setConversationPref(conv.id, { pinned: !conv.pinned })))}>
          <${Icon} name="pin" size=${17} />${conv.pinned ? t("messages.unpin") : t("messages.pin")}
        </button>
        <button type="button" role="menuitem" class="msg-item" data-testid="chat-mute" onClick=${run(async () => fail(await setConversationPref(conv.id, { muted: !conv.muted })))}>
          <${Icon} name=${conv.muted ? "bell" : "bellOff"} size=${17} />${conv.muted ? t("messages.unmute") : t("messages.mute")}
        </button>`}
    </div>
  `;
}

export function ChatPane({ conv, online, canSend, myId, onBack, locale, jumpTarget, onJumpDone }) {
  // one translate function per language, so the memoised bubble list below is not rebuilt on every render
  const t = useMemo(() => (key, vars) => translate(locale, key, vars), [locale]);
  const thread = useThread(conv.id);
  const caps = useMessagingCaps();
  const [text, setText] = useState(() => getDraft(conv.id));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [menu, setMenu] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [away, setAway] = useState({ show: false, count: 0 });
  const [dragging, setDragging] = useState(false);
  const [headMenu, setHeadMenu] = useState(false);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stick = useRef(true);
  const prevHeight = useRef(null);
  const lastCount = useRef(0);
  const lastId = useRef(null);
  const initialDone = useRef(false);
  const stash = useRef("");
  const attachRef = useRef(null);
  const dragDepth = useRef(0);

  const messages = thread.messages;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  attachRef.current = attachment;

  // a picture that was picked but never sent must not keep its preview alive
  useEffect(() => () => { if (attachRef.current?.previewUrl) { try { URL.revokeObjectURL(attachRef.current.previewUrl); } catch { /* gone */ } } }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const errText = (code) => {
    const key = `messages.err.${code}`;
    const s = t(key);
    return s === key ? t("messages.err.generic") : s;
  };

  // --- scrolling ---------------------------------------------------------------
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    if (smooth && !prefersReducedMotion()) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (!initialDone.current) {
      if (!thread.loaded || !thread.dividerReady) return;
      initialDone.current = true;
      const divider = el.querySelector("[data-testid=chat-unread-divider]");
      if (divider) el.scrollTop = Math.max(0, divider.offsetTop - 72);
      else el.scrollTop = el.scrollHeight;
      stick.current = !divider;
      lastCount.current = messages.length;
      lastId.current = last?.id ?? null;
      return;
    }
    if (prevHeight.current != null) {
      // Older page was prepended: keep the reader where they were.
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (last && last.id !== lastId.current) {
      const at = messages.findIndex((m) => m.id === lastId.current);
      const fresh = at === -1 ? [last] : messages.slice(at + 1);
      if (stick.current || last.senderId === myId) {
        scrollToBottom();
      } else {
        const incoming = fresh.filter((m) => m.senderId !== myId).length;
        if (incoming) setAway((a) => ({ show: true, count: a.count + incoming }));
      }
    }
    lastCount.current = messages.length;
    lastId.current = last?.id ?? null;
  }, [messages.length, messages[messages.length - 1]?.id, thread.typing, thread.loaded, thread.dividerReady]);

  function onScroll(e) {
    const el = e.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 90;
    setAway((a) => (dist > AWAY_PX ? (a.show ? a : { ...a, show: true }) : a.show || a.count ? { show: false, count: 0 } : a));
    if (el.scrollTop < 80 && thread.hasMore && !thread.loadingOlder) {
      prevHeight.current = el.scrollHeight;
      loadOlderMessages(conv.id);
    }
  }

  const onImageLoad = useCallback(() => { if (stick.current) scrollToBottom(); }, []);

  // when the visible stretch changes size (a reply strip opens, a keyboard comes up) the reader stays at the bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const jumpTo = useCallback(async (id, createdAt) => {
    const ok = await ensureMessageLoaded(conv.id, id, createdAt);
    if (!ok) { toast(t("messages.quoteMissing"), "amber"); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-msg-id="${id}"]`);
      if (!el) return;
      stick.current = false;
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      setHighlightId(id);
      setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1800);
    }));
  }, [conv.id, locale]);

  useEffect(() => {
    if (jumpTarget && jumpTarget.convId === conv.id && thread.loaded) {
      jumpTo(jumpTarget.messageId, jumpTarget.createdAt);
      onJumpDone?.();
    }
  }, [jumpTarget, thread.loaded]);

  // --- composing ---------------------------------------------------------------
  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  function changeText(v) {
    setText(v);
    if (!editing) { setDraft(conv.id, v); signalTyping(); }
  }

  const editable = (m) =>
    m.senderId === myId && !m.deletedAt && !m.status && caps.actions !== "old" && Date.now() - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;

  function startReply(m) {
    if (!canSend) return;
    setEditing(null);
    setReplyTo(m);
    focusInput();
  }

  function startEdit(m) {
    if (!editable(m)) return;
    if (!editing) stash.current = text;
    setEditing(m);
    setReplyTo(null);
    removeAttachment();
    setText(m.body);
    focusInput();
  }

  function endEdit() {
    setEditing(null);
    setText(stash.current ?? "");
    focusInput();
  }

  function removeAttachment() {
    const a = attachRef.current;
    if (a?.previewUrl) { try { URL.revokeObjectURL(a.previewUrl); } catch { /* gone */ } }
    attachRef.current = null;
    setAttachment(null);
  }

  async function addFiles(files) {
    const file = files.find((f) => f.type?.startsWith("image/"));
    if (!file || !canSend || editing || caps.images === "old") return;
    setPreparing(true);
    try {
      const img = await prepareChatImage(file);
      removeAttachment();
      attachRef.current = img;
      setAttachment(img);
      focusInput();
    } catch (err) {
      toast(t(`messages.err.img_${err?.hint ?? "unreadable"}`), "rose");
    } finally {
      setPreparing(false);
    }
  }

  async function saveEdit() {
    const target = editing;
    const res = await editMessage(conv.id, target.id, text);
    if (!res.ok) {
      toast(errText(res.error), "rose");
      if (res.error !== "bad_text") endEdit();
      return;
    }
    endEdit();
  }

  function submit() {
    if (!canSend || preparing) return;
    if (editing) { saveEdit(); return; }
    const body = text.trim();
    if (!body && !attachment) return;
    const image = attachment;
    attachRef.current = null; // the store owns the preview from here
    sendMessage(conv.id, body, { replyToId: replyTo?.id ?? null, image });
    setText("");
    setDraft(conv.id, "");
    setReplyTo(null);
    setAttachment(null);
    setEmojiOpen(false);
    stick.current = true;
    focusInput();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      if (emojiOpen) setEmojiOpen(false);
      else if (editing) endEdit();
      else if (replyTo) setReplyTo(null);
      else if (attachment) removeAttachment();
    } else if (e.key === "ArrowUp" && !text && !editing && !attachment && canSend) {
      const mine = [...messages].reverse().find(editable);
      if (mine) { e.preventDefault(); startEdit(mine); }
    }
  }

  function onPaste(e) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some((f) => f.type?.startsWith("image/"))) {
      e.preventDefault();
      addFiles(files);
    }
  }

  // --- drag & drop of a picture over the whole pane --------------------------------
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const onDragEnter = (e) => { if (!hasFiles(e) || !canSend || editing || caps.images === "old") return; e.preventDefault(); dragDepth.current += 1; setDragging(true); };
  const onDragOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const onDragLeave = (e) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles([...e.dataTransfer.files]); };

  // --- actions on a message ----------------------------------------------------
  const ctx = useMemo(() => ({
    t, locale, myId, byId, otherName: conv.otherName,
    canReply: canSend, canReact: canSend && caps.actions !== "old",
    onMenu: (message, anchor) => setMenu({ message, anchor }),
    onReply: startReply,
    onReact: async (id, emoji) => { const r = await reactToMessage(conv.id, id, emoji); if (!r.ok) toast(errText(r.error), "rose"); },
    onJump: (id) => jumpTo(id),
    onImage: (url, message) => setLightbox({ url, message }),
    onImageLoad,
    onRetry: (id) => retryMessage(conv.id, id),
  }), [t, locale, myId, byId, conv.id, conv.otherName, canSend, caps.actions]);

  const menuItems = (m) => {
    const mine = m.senderId === myId;
    const confirmed = !m.status;
    return {
      react: canSend && confirmed && caps.actions !== "old",
      reply: canSend && confirmed,
      copy: !!m.body,
      edit: mine && editable(m),
      remove: mine && (confirmed ? caps.actions !== "old" : m.status === "failed"),
      retry: m.status === "failed",
    };
  };

  async function runDelete(m) {
    const res = await deleteMessage(conv.id, m.id);
    if (!res.ok) toast(errText(res.error), "rose");
  }

  async function runReact(m, emoji) {
    const res = await reactToMessage(conv.id, m.id, emoji);
    if (!res.ok) toast(errText(res.error), "rose");
  }

  async function runCopy(m) {
    toast(t((await copyText(m.body)) ? "messages.copied" : "messages.err.generic"), "emerald");
  }

  // the lightbox closes on Esc (a layout effect, so the key works the instant the viewer is on screen)
  useLayoutEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setLightbox(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // --- rows --------------------------------------------------------------------
  const status = thread.typing
    ? html`<span class="sk-chat-typing-text">${t("messages.typing")} <${TypingDots} /></span>`
    : online
    ? html`<span class="sk-status-online">${t("messages.online")}</span>`
    : html`<span class="sk-status-offline">${t("messages.offline")}</span>`;

  // the list of bubbles is rebuilt only when messages change, not on every keystroke in the composer
  const rows = useMemo(() => {
    let prevDay = null;
    let prev = null;
    const out = [];
    for (const m of messages) {
      const k = dayKey(m.createdAt);
      const newDay = k !== prevDay;
      if (newDay) {
        out.push(html`<div key=${`d-${k}`} class="sk-chat-day"><span>${dayLabel(m.createdAt, locale, t)}</span></div>`);
        prevDay = k;
      }
      const isDivider = !!thread.divider && thread.divider.id === m.id;
      if (isDivider) {
        out.push(html`<div key="unread-divider" class="msg-divider" data-testid="chat-unread-divider"><span>${t("messages.unreadDivider", { count: thread.divider.count })}</span></div>`);
      }
      const grouped = !!prev && !newDay && !isDivider && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_GAP_MS;
      out.push(html`<${Bubble} key=${m.id} message=${m} mine=${m.senderId === myId} grouped=${grouped} highlighted=${highlightId === m.id} ctx=${ctx} />`);
      prev = m;
    }
    return out;
  }, [messages, thread.divider, highlightId, ctx, locale, t, myId]);

  const replyInfo = replyTo && {
    name: replyTo.senderId === myId ? t("messages.you") : conv.otherName ?? t("feed.unknownAuthor"),
    text: quoteText({ body: replyTo.body, hasImage: !!replyTo.attachmentPath, deleted: !!replyTo.deletedAt }, t),
  };
  const myReaction = (m) => m.reactions?.find((r) => r.userId === myId)?.emoji ?? null;

  return html`
    <section class="sk-chat-pane" onDragEnter=${onDragEnter} onDragOver=${onDragOver} onDragLeave=${onDragLeave} onDrop=${onDrop} data-testid="chat-pane">
      <header class="sk-chat-head">
        <button type="button" class="sk-chat-back" onClick=${onBack} aria-label=${t("messages.back")}><${Icon} name="arrowLeft" size=${20} /></button>
        <${PersonLink} who=${conv} className="sk-chat-head-who">
          <${PersonAvatar} name=${conv.otherName} url=${conv.otherAvatarUrl} size=${40} online=${online} />
          <div class="sk-chat-head-text">
            <div class="sk-chat-head-name">${conv.otherName ?? t("feed.unknownAuthor")}</div>
            <div class="sk-chat-head-status">${status}</div>
          </div>
        <//>
        <div class="msg-head-tools">
          ${conv.muted && html`<span class="msg-head-flag" title=${t("messages.muted")}><${Icon} name="bellOff" size=${15} /></span>`}
          ${conv.pinned && html`<span class="msg-head-flag" title=${t("messages.pinned")}><${Icon} name="pin" size=${15} /></span>`}
          <button type="button" class="sk-chat-iconbtn" data-head-menu-btn data-testid="chat-head-more" aria-label=${t("messages.chatOptions")} aria-haspopup="menu" aria-expanded=${headMenu} onClick=${() => setHeadMenu((v) => !v)}>
            <${Icon} name="more" size=${20} />
          </button>
          ${headMenu && html`<${HeadMenu} conv=${conv} caps=${caps} t=${t} errText=${errText} onClose=${() => setHeadMenu(false)} />`}
        </div>
      </header>

      <div class="sk-chat-scroll" ref=${listRef} onScroll=${onScroll} data-testid="chat-scroll">
        ${thread.loadingOlder && html`<div class="sk-chat-older"><${Spinner} size=${12} /><${LoadingLabel} label=${t("common.loading")} /></div>`}
        ${!thread.loaded && thread.loading && html`
          <div class="sk-chat-skeleton">
            <${Skeleton} className="h-9 w-48 rounded-2xl" /><${Skeleton} className="h-9 w-64 rounded-2xl self-end" /><${Skeleton} className="h-9 w-40 rounded-2xl" />
          </div>
        `}
        ${thread.loaded && messages.length === 0 && html`<div class="sk-chat-hint">${t("messages.noMessagesYet")}</div>`}
        ${rows}
        ${thread.typing && html`<div class="sk-msg-row"><div class="sk-bubble sk-bubble-typing"><${TypingDots} /></div></div>`}
        ${away.show && html`
          <div class="msg-jump-wrap">
            <button type="button" class="msg-jump" data-testid="chat-jump" onClick=${() => { scrollToBottom(true); setAway({ show: false, count: 0 }); }} aria-label=${t("messages.jumpLatest")}>
              <${Icon} name="arrowDown" size=${18} />
              ${away.count > 0 && html`<b data-testid="chat-jump-count">${away.count > 99 ? "99+" : away.count}</b>`}
            </button>
          </div>`}
      </div>

      ${canSend
        ? html`<${Composer}
            t=${t} value=${text} onChange=${changeText} onSubmit=${submit} onKeyDown=${onKeyDown} inputRef=${inputRef}
            emojiOpen=${emojiOpen} setEmojiOpen=${setEmojiOpen}
            replyInfo=${replyInfo} onCancelReply=${() => setReplyTo(null)} editing=${editing} onCancelEdit=${endEdit}
            attachment=${attachment} preparing=${preparing} canAttach=${caps.images !== "old"} onPickFiles=${addFiles} onRemoveAttachment=${removeAttachment} onPaste=${onPaste} />`
        : html`<div class="sk-chat-locked">${t("messages.notFriends")}</div>`}

      ${dragging && html`<div class="msg-drop" data-testid="chat-drop"><${Icon} name="image" size=${34} /><span>${t("messages.dropImage")}</span></div>`}

      ${menu && html`
        <${ActionMenu}
          message=${menu.message} anchor=${menu.anchor} mine=${menu.message.senderId === myId} items=${menuItems(menu.message)}
          myReaction=${myReaction(menu.message)} t=${t} onClose=${() => setMenu(null)}
          onReact=${(e) => runReact(menu.message, e)} onReply=${() => startReply(menu.message)} onCopy=${() => runCopy(menu.message)}
          onEdit=${() => startEdit(menu.message)} onDelete=${() => runDelete(menu.message)} onRetry=${() => retryMessage(conv.id, menu.message.id)} />`}

      ${lightbox && html`
        <div class="msg-lightbox" data-testid="chat-lightbox" onClick=${(e) => e.target === e.currentTarget && setLightbox(null)}>
          <button type="button" class="msg-lightbox-x" onClick=${() => setLightbox(null)} aria-label=${t("common.close")} data-testid="chat-lightbox-close"><${Icon} name="close" size=${20} /></button>
          <img src=${lightbox.url} alt="" />
        </div>`}
    </section>
  `;
}
