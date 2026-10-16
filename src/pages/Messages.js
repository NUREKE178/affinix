// Messages: your friends on the left (pinned first, drafts and pictures in the previews, message search), the open
// conversation on the right. The pieces live in pages/messages/; data and realtime in lib/messagesStore.js.
import { html, useState, useEffect, useMemo } from "../lib/preact.js";
import { Icon } from "../components/icons.js";
import { Skeleton, EmptyState, Button, toast, LoadingLabel } from "../components/ui.js";
import { useT, useLocale } from "../lib/i18n.js";
import { useSession } from "../lib/auth.js";
import { useFriends } from "../lib/friendsStore.js";
import {
  useConversations, useMessagingCaps, setActiveConversation, openConversationWith, searchMessages, getDraft,
} from "../lib/messagesStore.js";
import { navigate } from "../router.js";
import { ChatListItem, MessageHit } from "./messages/ChatList.js";
import { ChatPane } from "./messages/ChatPane.js";

export function Messages({ query }) {
  const t = useT();
  const locale = useLocale();
  const { user } = useSession();
  const myId = user?.id ?? null;
  const { conversations, loaded, error, online, typing } = useConversations();
  const caps = useMessagingCaps();
  const { friends, loading: friendsLoading } = useFriends();
  const [selectedId, setSelectedId] = useState(query?.get("c") ?? null);
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState(false);
  const [hits, setHits] = useState({ state: "idle", items: [] });
  const [jumpTarget, setJumpTarget] = useState(null);
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

  // searching the text of the messages (needs the server update 0024; the list still filters by name without it)
  const q = search.trim();
  useEffect(() => {
    if (q.length < 2 || caps.actions === "old") { setHits({ state: caps.actions === "old" && q.length >= 2 ? "old" : "idle", items: [] }); return undefined; }
    let off = false;
    setHits((h) => ({ ...h, state: "loading" }));
    const timer = setTimeout(() => {
      searchMessages(q).then(
        (items) => { if (!off) setHits({ state: "ready", items }); },
        (err) => { if (!off) setHits({ state: err?.code === "updatePending" ? "old" : "error", items: [] }); }
      );
    }, 350);
    return () => { off = true; clearTimeout(timer); };
  }, [q, caps.actions]);

  const items = useMemo(() => {
    const haveConv = new Set(conversations.map((c) => c.otherId));
    const fresh = friends
      .filter((f) => !haveConv.has(f.otherId))
      .map((f) => ({ id: null, otherId: f.otherId, otherName: f.otherName, otherUsername: f.otherUsername, otherAvatarUrl: f.otherAvatarUrl, lastBody: null, lastAt: null, lastSenderId: null, unread: 0 }))
      .sort((a, b) => (a.otherName ?? "").localeCompare(b.otherName ?? ""));
    const needle = q.toLowerCase();
    const all = [...conversations, ...fresh];
    return needle ? all.filter((i) => `${i.otherName ?? ""} ${i.otherUsername ?? ""}`.toLowerCase().includes(needle)) : all;
  }, [conversations, friends, q]);

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

  function openHit(hit) {
    setJumpTarget({ convId: hit.conversationId, messageId: hit.messageId, createdAt: hit.createdAt });
    setSelectedId(hit.conversationId);
  }

  if (error) {
    return html`<${EmptyState} title=${t("messages.loadErrorTitle")} body=${t("messages.loadErrorBody")} icon="chat" />`;
  }

  const listEmpty = loaded && !friendsLoading && conversations.length === 0 && friends.length === 0;
  const hitRows = hits.items.filter((h) => conversations.some((c) => c.id === h.conversationId));
  const nothingFound = loaded && q.length >= 2 && items.length === 0 && hitRows.length === 0 && hits.state !== "loading";

  return html`
    <div class="sk-chat sk-panel" data-pane=${selectedId ? "chat" : "list"}>
      <aside class="sk-chat-list">
        <div class="sk-chat-list-head">
          <h2>${t("messages.title")}</h2>
          <input class="sk-input sk-chat-search" type="search" data-testid="chat-search" placeholder=${t("messages.search")} value=${search} onInput=${(e) => setSearch(e.currentTarget.value)} />
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
              draft=${item.id ? getDraft(item.id) : ""}
              myId=${myId}
              onOpen=${() => openItem(item)}
              t=${t}
              locale=${locale}
            />
          `)}
          ${q.length >= 2 && html`
            <div class="msg-list-section" data-testid="chat-hits">
              ${(hitRows.length > 0 || hits.state === "loading") && html`<div class="msg-list-caption">${t("messages.searchMessagesTitle")}</div>`}
              ${hits.state === "loading" && hitRows.length === 0 && html`<div class="sk-chat-hint"><${LoadingLabel} label=${t("messages.searching")} /></div>`}
              ${hitRows.map((hit) => html`<${MessageHit} key=${hit.messageId} hit=${hit} conv=${conversations.find((c) => c.id === hit.conversationId)} query=${q} myId=${myId} onOpen=${() => openHit(hit)} t=${t} locale=${locale} />`)}
              ${hits.state === "old" && html`<div class="sk-chat-hint">${t("messages.searchPending")}</div>`}
              ${hits.state === "error" && html`<div class="sk-chat-hint">${t("messages.searchFailed")}</div>`}
            </div>`}
          ${q.length === 1 && html`<div class="sk-chat-hint">${t("messages.searchMin")}</div>`}
          ${nothingFound && html`<div class="sk-chat-hint">${t("messages.noResults")}</div>`}
        </div>
      </aside>

      ${selected
        ? html`<${ChatPane} key=${selected.id} conv=${selected} online=${online.has(selected.otherId)} canSend=${canSend} myId=${myId} onBack=${() => setSelectedId(null)} locale=${locale} jumpTarget=${jumpTarget} onJumpDone=${() => setJumpTarget(null)} />`
        : html`
          <section class="sk-chat-pane sk-chat-empty">
            <div class="sk-display mb-4 flex h-16 w-16 items-center justify-center rounded-full text-graphite-600"><${Icon} name="chat" size=${26} strokeWidth=${1.9} /></div>
            <h3 class="text-base font-semibold text-graphite-200">${opening ? html`<${LoadingLabel} label=${t("common.loading")} />` : t("messages.selectTitle")}</h3>
            <p class="text-sm text-graphite-500 mt-1.5 max-w-xs">${t("messages.selectBody")}</p>
          </section>
        `}
    </div>
  `;
}
