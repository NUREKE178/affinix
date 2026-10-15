import { html, useState, useEffect, useRef, useMemo } from "../lib/preact.js";
import { Icon } from "../components/icons.js";
import { Avatar } from "../components/avatar.js";
import { Skeleton, EmptyState, Button, toast, Spinner, LoadingLabel } from "../components/ui.js";
import { useT, useLocale } from "../lib/i18n.js";
import { useSession } from "../lib/auth.js";
import { useFriends } from "../lib/friendsStore.js";
import {
  useConversations, useThread, setActiveConversation, sendMessage, retryMessage,
  loadOlderMessages, openConversationWith, signalTyping,
} from "../lib/messagesStore.js";
import { navigate } from "../router.js";

const EMOJI = ["😀", "😂", "😍", "🥰", "😎", "🤔", "😢", "😡", "👍", "👎", "🙏", "👏", "🔥", "🎉", "❤️", "💯", "✅", "👀", "🤝", "💪", "🚀", "☕", "😴", "🙌"];
const DATE_LOCALES = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };

function timeOf(iso, locale) {
  return new Date(iso).toLocaleTimeString(DATE_LOCALES[locale] ?? "en-US", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso, locale, t) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t("messages.today");
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("messages.yesterday");
  return d.toLocaleDateString(DATE_LOCALES[locale] ?? "en-US", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Chat-list timestamp: a clock time today, otherwise a short date. */
function listTime(iso, locale, t) {
  if (!iso) return "";
  if (dayKey(iso) === dayKey(new Date().toISOString())) return timeOf(iso, locale);
  return dayLabel(iso, locale, t);
}

function PersonAvatar({ name, url, size, online }) {
  return html`
    <span class="sk-avatar-wrap">
      <${Avatar} name=${name} url=${url} size=${size} />
      ${online && html`<span class="sk-online-dot"></span>`}
    </span>
  `;
}

/** ✓ sent, ✓✓ read, clock while sending. */
function Ticks({ message }) {
  if (message.status === "sending") return html`<span class="sk-tick"><${Icon} name="clock" size=${13} /></span>`;
  if (message.readAt) return html`<span class="sk-tick sk-tick-read"><${Icon} name="checks" size=${15} /></span>`;
  return html`<span class="sk-tick"><${Icon} name="check" size=${14} /></span>`;
}

function TypingDots() {
  return html`<span class="sk-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function ChatListItem({ item, active, online, typing, myId, onOpen, t, locale }) {
  const preview = typing
    ? html`<span class="sk-chat-typing-text">${t("messages.typing")}</span>`
    : item.lastBody
    ? `${item.lastSenderId === myId ? `${t("messages.you")}: ` : ""}${item.lastBody}`
    : t("messages.startChat");
  return html`
    <button type="button" class=${`sk-chat-item ${active ? "active" : ""}`} onClick=${onOpen}>
      <${PersonAvatar} name=${item.otherName} url=${item.otherAvatarUrl} size=${44} online=${online} />
      <span class="sk-chat-item-main">
        <span class="sk-chat-item-top">
          <span class=${`sk-chat-name ${item.unread > 0 ? "unread" : ""}`}>${item.otherName ?? t("feed.unknownAuthor")}</span>
          <span class="sk-chat-time">${listTime(item.lastAt, locale, t)}</span>
        </span>
        <span class="sk-chat-item-bottom">
          <span class=${`sk-chat-preview ${item.unread > 0 ? "unread" : ""}`}>${preview}</span>
          ${item.unread > 0 && html`<span class="sk-chat-unread">${item.unread > 99 ? "99+" : item.unread}</span>`}
        </span>
      </span>
    </button>
  `;
}

function Bubble({ message, mine, convId, locale, t }) {
  const failed = message.status === "failed";
  return html`
    <div class=${`sk-msg-row ${mine ? "mine" : ""}`}>
      <div class=${`sk-bubble ${mine ? "mine" : ""} ${failed ? "failed" : ""}`}>
        <span class="sk-bubble-text">${message.body}</span>
        <span class="sk-bubble-meta">
          ${timeOf(message.createdAt, locale)}
          ${mine && !failed && html`<${Ticks} message=${message} />`}
        </span>
      </div>
      ${failed && html`
        <button type="button" class="sk-msg-retry" onClick=${() => retryMessage(convId, message.id)}>
          <${Icon} name="shield" size=${13} /> ${t("messages.failedRetry")}
        </button>
      `}
    </div>
  `;
}

function ChatPane({ conv, online, canSend, myId, onBack, t, locale }) {
  const thread = useThread(conv.id);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(null);
  const lastCount = useRef(0);

  // New conversation => start at the newest message and forget the old draft.
  useEffect(() => {
    stickToBottom.current = true;
    lastCount.current = 0;
    prevHeight.current = null;
    setDraft("");
    setEmojiOpen(false);
    inputRef.current?.focus();
  }, [conv.id]);

  const messages = thread.messages;
  const last = messages[messages.length - 1];

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevHeight.current != null) {
      // Older page was prepended: keep the reader where they were.
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stickToBottom.current || (last && last.senderId === myId && messages.length > lastCount.current)) {
      el.scrollTop = el.scrollHeight;
    }
    lastCount.current = messages.length;
  }, [messages.length, last?.id, thread.typing, thread.loaded]);

  function onScroll(e) {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (el.scrollTop < 80 && thread.hasMore && !thread.loadingOlder) {
      prevHeight.current = el.scrollHeight;
      loadOlderMessages(conv.id);
    }
  }

  function autosize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function submit() {
    const body = draft.trim();
    if (!body || !canSend) return;
    sendMessage(conv.id, body);
    setDraft("");
    setEmojiOpen(false);
    stickToBottom.current = true;
    requestAnimationFrame(() => { autosize(); inputRef.current?.focus(); });
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function addEmoji(emoji) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
      autosize();
    });
  }

  const status = thread.typing
    ? html`<span class="sk-chat-typing-text">${t("messages.typing")} <${TypingDots} /></span>`
    : online
    ? html`<span class="sk-status-online">${t("messages.online")}</span>`
    : html`<span class="sk-status-offline">${t("messages.offline")}</span>`;

  let prevDay = null;
  const rows = [];
  for (const m of messages) {
    const k = dayKey(m.createdAt);
    if (k !== prevDay) {
      rows.push(html`<div key=${`d-${k}`} class="sk-chat-day"><span>${dayLabel(m.createdAt, locale, t)}</span></div>`);
      prevDay = k;
    }
    rows.push(html`<${Bubble} key=${m.id} message=${m} mine=${m.senderId === myId} convId=${conv.id} locale=${locale} t=${t} />`);
  }

  return html`
    <section class="sk-chat-pane">
      <header class="sk-chat-head">
        <button type="button" class="sk-chat-back" onClick=${onBack} aria-label=${t("messages.back")}><${Icon} name="arrowLeft" size=${20} /></button>
        <${PersonAvatar} name=${conv.otherName} url=${conv.otherAvatarUrl} size=${40} online=${online} />
        <div class="sk-chat-head-text">
          <div class="sk-chat-head-name">${conv.otherName ?? t("feed.unknownAuthor")}</div>
          <div class="sk-chat-head-status">${status}</div>
        </div>
      </header>

      <div class="sk-chat-scroll" ref=${listRef} onScroll=${onScroll}>
        ${thread.loadingOlder && html`<div class="sk-chat-older"><${Spinner} size=${12} /><${LoadingLabel} label=${t("common.loading")} /></div>`}
        ${!thread.loaded && thread.loading && html`
          <div class="sk-chat-skeleton">
            <${Skeleton} className="h-9 w-48 rounded-2xl" /><${Skeleton} className="h-9 w-64 rounded-2xl self-end" /><${Skeleton} className="h-9 w-40 rounded-2xl" />
          </div>
        `}
        ${thread.loaded && messages.length === 0 && html`<div class="sk-chat-hint">${t("messages.noMessagesYet")}</div>`}
        ${rows}
        ${thread.typing && html`<div class="sk-msg-row"><div class="sk-bubble sk-bubble-typing"><${TypingDots} /></div></div>`}
      </div>

      ${canSend
        ? html`
          <div class="sk-chat-composer">
            ${emojiOpen && html`
              <div class="sk-emoji-panel">
                ${EMOJI.map((e) => html`<button key=${e} type="button" onClick=${() => addEmoji(e)}>${e}</button>`)}
              </div>
            `}
            <button type="button" class="sk-chat-iconbtn" onClick=${() => setEmojiOpen((v) => !v)} aria-label=${t("messages.emoji")}>
              <${Icon} name="smile" size=${22} />
            </button>
            <textarea
              ref=${inputRef}
              rows="1"
              class="sk-input sk-chat-input"
              placeholder=${t("messages.placeholder")}
              maxlength="4000"
              value=${draft}
              onInput=${(e) => { setDraft(e.currentTarget.value); signalTyping(); autosize(); }}
              onKeyDown=${onKeyDown}
            ></textarea>
            <button type="button" class="sk-chat-send" onClick=${submit} disabled=${!draft.trim()} aria-label=${t("messages.send")}>
              <${Icon} name="send" size=${20} />
            </button>
          </div>
        `
        : html`<div class="sk-chat-locked">${t("messages.notFriends")}</div>`}
    </section>
  `;
}

export function Messages({ query }) {
  const t = useT();
  const locale = useLocale();
  const { user } = useSession();
  const myId = user?.id ?? null;
  const { conversations, loaded, error, online, typing } = useConversations();
  const { friends, loading: friendsLoading } = useFriends();
  const [selectedId, setSelectedId] = useState(query?.get("c") ?? null);
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState(false);
  const queryKey = query?.toString() ?? "";

  // ?c=<conversationId> (from a notification) or ?with=<userId> (from a
  // "Message" button) selects -- or, for ?with=, creates -- that thread.
  useEffect(() => {
    const c = query?.get("c");
    const w = query?.get("with");
    if (c) setSelectedId(c);
    if (w) {
      let cancelled = false;
      setOpening(true);
      openConversationWith(w)
        .then((id) => { if (!cancelled) setSelectedId(id); })
        .catch((err) => { if (!cancelled) toast(err.message ?? String(err), "rose"); })
        .finally(() => { if (!cancelled) setOpening(false); });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [queryKey]);

  useEffect(() => {
    setActiveConversation(selectedId);
    return undefined;
  }, [selectedId]);
  useEffect(() => () => setActiveConversation(null), []);

  const items = useMemo(() => {
    const haveConv = new Set(conversations.map((c) => c.otherId));
    const fresh = friends
      .filter((f) => !haveConv.has(f.otherId))
      .map((f) => ({ id: null, otherId: f.otherId, otherName: f.otherName, otherUsername: f.otherUsername, otherAvatarUrl: f.otherAvatarUrl, lastBody: null, lastAt: null, lastSenderId: null, unread: 0 }))
      .sort((a, b) => (a.otherName ?? "").localeCompare(b.otherName ?? ""));
    const q = search.trim().toLowerCase();
    const all = [...conversations, ...fresh];
    return q ? all.filter((i) => `${i.otherName ?? ""} ${i.otherUsername ?? ""}`.toLowerCase().includes(q)) : all;
  }, [conversations, friends, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const friendIds = useMemo(() => new Set(friends.map((f) => f.otherId)), [friends]);
  // Until the friends list has loaded, assume yes (the server is the real gate).
  const canSend = selected ? friendsLoading && friends.length === 0 ? true : friendIds.has(selected.otherId) : false;

  async function openItem(item) {
    if (item.id) { setSelectedId(item.id); return; }
    try {
      setOpening(true);
      setSelectedId(await openConversationWith(item.otherId));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setOpening(false);
    }
  }

  if (error) {
    return html`<${EmptyState} title=${t("messages.loadErrorTitle")} body=${t("messages.loadErrorBody")} icon="chat" />`;
  }

  const listEmpty = loaded && !friendsLoading && conversations.length === 0 && friends.length === 0;

  return html`
    <div class="sk-chat sk-panel" data-pane=${selectedId ? "chat" : "list"}>
      <aside class="sk-chat-list">
        <div class="sk-chat-list-head">
          <h2>${t("messages.title")}</h2>
          <input class="sk-input sk-chat-search" type="search" placeholder=${t("messages.search")} value=${search} onInput=${(e) => setSearch(e.currentTarget.value)} />
        </div>
        <div class="sk-chat-items">
          ${!loaded && html`
            ${[0, 1, 2, 3].map((i) => html`
              <div key=${i} class="sk-chat-item">
                <${Skeleton} className="h-11 w-11 rounded-full shrink-0" />
                <div class="flex-1"><${Skeleton} className="h-4 w-28" /><${Skeleton} className="h-3 w-40 mt-2" /></div>
              </div>
            `)}
          `}
          ${listEmpty && html`
            <div class="sk-chat-hint">
              ${t("messages.noFriendsBody")}
              <div class="mt-3"><${Button} size="sm" onClick=${() => navigate("/app/friends")}>${t("messages.goToFriends")}<//></div>
            </div>
          `}
          ${items.map((item) => html`
            <${ChatListItem}
              key=${item.id ?? `u-${item.otherId}`}
              item=${item}
              active=${item.id && item.id === selectedId}
              online=${online.has(item.otherId)}
              typing=${item.id ? !!typing[item.id] : false}
              myId=${myId}
              onOpen=${() => openItem(item)}
              t=${t}
              locale=${locale}
            />
          `)}
          ${loaded && items.length === 0 && !listEmpty && html`<div class="sk-chat-hint">${t("messages.noResults")}</div>`}
        </div>
      </aside>

      ${selected
        ? html`<${ChatPane} key=${selected.id} conv=${selected} online=${online.has(selected.otherId)} canSend=${canSend} myId=${myId} onBack=${() => setSelectedId(null)} t=${t} locale=${locale} />`
        : html`
          <section class="sk-chat-pane sk-chat-empty">
            <div class="sk-display mb-4 flex h-16 w-16 items-center justify-center rounded-full text-slate-600"><${Icon} name="chat" size=${26} strokeWidth=${1.4} /></div>
            <h3 class="text-base font-semibold text-slate-200">${opening ? html`<${LoadingLabel} label=${t("common.loading")} />` : t("messages.selectTitle")}</h3>
            <p class="text-sm text-slate-500 mt-1.5 max-w-xs">${t("messages.selectBody")}</p>
          </section>
        `}
    </div>
  `;
}
