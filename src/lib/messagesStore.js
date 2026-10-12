import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { fetchAuthorsById } from "./postsStore.js";
import { watchTables, debounce } from "./realtime.js";
import { t as translate, getLocale } from "./i18n.js";
import { playNotificationSound } from "./notificationsStore.js";
import { toast } from "../components/ui.js";
import { navigate } from "../router.js";

// ============================================================================
// 1:1 messaging between accepted friends (migration 0018).
//
// Delivery is Supabase Realtime `postgres_changes` on `messages` (INSERT =
// new message, UPDATE = read receipt) and `conversations`. RLS decides what
// each browser receives, so a subscriber can only ever get rows from
// conversations they're in. Online dots use one Presence channel; the
// "typing…" signal is a Broadcast on a per-conversation channel (nothing
// sensitive travels on either -- message text only ever flows through the
// RLS-protected table).
// ============================================================================

const PAGE_SIZE = 40;

function newId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* insecure context */ }
  // RFC4122 v4 fallback for browsers/contexts without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    status: null, // null = confirmed by the server; "sending" | "failed" = local only
  };
}

function compareMessages(a, b) {
  const d = new Date(a.createdAt) - new Date(b.createdAt);
  return d !== 0 ? d : a.id < b.id ? -1 : 1;
}

function compareConversations(a, b) {
  const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
  const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
  if (ta !== tb) return tb - ta;
  return (a.otherName ?? "").localeCompare(b.otherName ?? "");
}

// --- Reactive state ---------------------------------------------------------
let state = {
  loaded: false,
  loading: false,
  error: null,
  conversations: [],
  online: new Set(),
  typing: {}, // conversationId -> true while the other person is typing
};
const threads = new Map(); // conversationId -> { messages, loaded, loading, loadingOlder, hasMore }
const listeners = new Set();
let myId = null;
let activeConvId = null;

function notify() {
  for (const l of listeners) l();
}
function setState(patch) {
  state = { ...state, ...patch };
  notify();
}
function emptyThread() {
  return { messages: [], loaded: false, loading: false, loadingOlder: false, hasMore: false };
}
function patchThread(convId, patch) {
  threads.set(convId, { ...(threads.get(convId) ?? emptyThread()), ...patch });
  notify();
}
function patchConversation(convId, patch) {
  setState({
    conversations: state.conversations
      .map((c) => (c.id === convId ? { ...c, ...patch } : c))
      .sort(compareConversations),
  });
}

function pageIsVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// --- Conversations list -----------------------------------------------------
async function fetchConversations() {
  const sb = requireSupabase();
  const me = getCurrentUser()?.id;
  if (!me) return [];
  const [convRes, unreadRes] = await Promise.all([
    sb.from("conversations").select("*").order("last_message_at", { ascending: false, nullsFirst: false }),
    sb.rpc("my_unread_counts"),
  ]);
  if (convRes.error) throw convRes.error;
  const rows = convRes.data ?? [];
  const unreadByConv = new Map((unreadRes.error ? [] : unreadRes.data ?? []).map((r) => [r.conversation_id, Number(r.unread)]));
  const otherIds = [...new Set(rows.map((r) => (r.user_a === me ? r.user_b : r.user_a)))];
  const people = await fetchAuthorsById(otherIds);
  return rows
    .map((r) => {
      const otherId = r.user_a === me ? r.user_b : r.user_a;
      const p = people[otherId];
      return {
        id: r.id,
        otherId,
        otherName: p?.full_name ?? null,
        otherUsername: p?.username ?? null,
        otherAvatarUrl: p?.avatar_url ?? null,
        lastBody: r.last_message_body ?? null,
        lastAt: r.last_message_at ?? null,
        lastSenderId: r.last_message_sender_id ?? null,
        unread: unreadByConv.get(r.id) ?? 0,
      };
    })
    .sort(compareConversations);
}

async function loadConversations({ silent = false } = {}) {
  if (!silent) setState({ loading: true });
  try {
    const conversations = await fetchConversations();
    // Never let a slow refetch clobber a thread the user is reading right now:
    // if the open conversation has no unread rows locally, keep it at zero.
    const merged = conversations.map((c) => (c.id === activeConvId && pageIsVisible() ? { ...c, unread: 0 } : c));
    setState({ conversations: merged, loading: false, loaded: true, error: null });
    if (activeConvId && pageIsVisible()) {
      const open = merged.find((c) => c.id === activeConvId);
      if (open && conversations.find((c) => c.id === activeConvId)?.unread) markReadDebounced(activeConvId);
    }
  } catch (error) {
    setState(silent ? { loading: false } : { loading: false, loaded: true, error, conversations: [] });
  }
}
const loadConversationsQuietly = debounce(() => loadConversations({ silent: true }), 300);

// --- Threads ----------------------------------------------------------------
function upsertMessage(convId, msg) {
  const thread = threads.get(convId) ?? emptyThread();
  const i = thread.messages.findIndex((m) => m.id === msg.id);
  let messages;
  if (i === -1) {
    messages = [...thread.messages, msg].sort(compareMessages);
  } else {
    const prev = thread.messages[i];
    // An out-of-order echo must never "un-read" a message.
    const merged = { ...msg, readAt: msg.readAt ?? prev.readAt };
    messages = thread.messages.slice();
    messages[i] = merged;
    messages.sort(compareMessages);
  }
  threads.set(convId, { ...thread, messages });
  notify();
}

async function loadThread(convId) {
  const existing = threads.get(convId);
  if (existing?.loading) return;
  patchThread(convId, { loading: true });
  try {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (error) throw error;
    const fetched = (data ?? []).map(mapMessage);
    // Keep local-only messages (still sending / failed) the server doesn't know yet.
    const pending = (threads.get(convId)?.messages ?? []).filter((m) => m.status);
    const byId = new Map([...fetched, ...pending].map((m) => [m.id, m]));
    patchThread(convId, {
      messages: [...byId.values()].sort(compareMessages),
      loaded: true,
      loading: false,
      hasMore: fetched.length === PAGE_SIZE,
    });
  } catch {
    patchThread(convId, { loading: false, loaded: true });
  }
}

export async function loadOlderMessages(convId) {
  const thread = threads.get(convId);
  if (!thread || thread.loadingOlder || !thread.hasMore || thread.messages.length === 0) return;
  patchThread(convId, { loadingOlder: true });
  try {
    const sb = requireSupabase();
    const oldest = thread.messages.find((m) => !m.status)?.createdAt ?? thread.messages[0].createdAt;
    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (error) throw error;
    const older = (data ?? []).map(mapMessage);
    const current = threads.get(convId) ?? thread;
    const byId = new Map([...older, ...current.messages].map((m) => [m.id, m]));
    patchThread(convId, {
      messages: [...byId.values()].sort(compareMessages),
      loadingOlder: false,
      hasMore: older.length === PAGE_SIZE,
    });
  } catch {
    patchThread(convId, { loadingOlder: false });
  }
}

// --- Sending ----------------------------------------------------------------
async function insertMessage(convId, id, body) {
  const sb = requireSupabase();
  const { data, error } = await sb.from("messages").insert({ id, conversation_id: convId, body }).select().single();
  if (error) throw error;
  return mapMessage(data);
}

function bumpPreview(convId, body, createdAt) {
  if (!state.conversations.some((c) => c.id === convId)) return;
  patchConversation(convId, { lastBody: body.slice(0, 140), lastAt: createdAt, lastSenderId: myId });
}

/** Optimistic send: the bubble appears instantly with a clock, then flips to
 * ✓ when the server confirms (or "failed — tap to retry"). The client picks
 * the row id, so the realtime echo of this same insert merges into the
 * bubble instead of duplicating it. */
export async function sendMessage(convId, rawBody) {
  const body = (rawBody ?? "").trim().slice(0, 4000);
  const me = getCurrentUser()?.id;
  if (!body || !me) return;
  stopTyping();
  const id = newId();
  const createdAt = new Date().toISOString();
  upsertMessage(convId, { id, conversationId: convId, senderId: me, body, createdAt, readAt: null, status: "sending" });
  bumpPreview(convId, body, createdAt);
  try {
    upsertMessage(convId, await insertMessage(convId, id, body));
  } catch {
    const cur = threads.get(convId)?.messages.find((m) => m.id === id);
    if (cur) upsertMessage(convId, { ...cur, status: "failed" });
  }
}

export async function retryMessage(convId, messageId) {
  const msg = threads.get(convId)?.messages.find((m) => m.id === messageId);
  if (!msg || msg.status !== "failed") return;
  upsertMessage(convId, { ...msg, status: "sending" });
  try {
    upsertMessage(convId, await insertMessage(convId, msg.id, msg.body));
  } catch {
    upsertMessage(convId, { ...msg, status: "failed" });
  }
}

/** Opens (creating if needed) the thread with a friend. The server refuses
 * unless you're accepted friends or the thread already exists. */
export async function openConversationWith(otherId) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("get_or_create_conversation", { other_id: otherId });
  if (error) throw error;
  const conv = Array.isArray(data) ? data[0] : data;
  if (!state.conversations.some((c) => c.id === conv.id)) await loadConversations({ silent: true });
  return conv.id;
}

// --- Read receipts ----------------------------------------------------------
async function markRead(convId) {
  if (!convId || !pageIsVisible()) return;
  const thread = threads.get(convId);
  const conv = state.conversations.find((c) => c.id === convId);
  const hasUnreadLocally = (conv?.unread ?? 0) > 0 || thread?.messages.some((m) => m.senderId !== myId && !m.readAt);
  if (!hasUnreadLocally) return;
  // Optimistic: clear the badge now; the server's UPDATE events then flip the
  // sender's ticks to ✓✓.
  if (conv) patchConversation(convId, { unread: 0 });
  if (thread) {
    const now = new Date().toISOString();
    patchThread(convId, { messages: thread.messages.map((m) => (m.senderId !== myId && !m.readAt ? { ...m, readAt: now } : m)) });
  }
  try {
    const sb = requireSupabase();
    const { error } = await sb.rpc("mark_conversation_read", { p_conversation_id: convId });
    if (error) throw error;
  } catch {
    loadConversationsQuietly(); // resync the badge from the server
  }
}
const markReadDebounced = debounce((convId) => markRead(convId), 250);

// --- Typing indicator (Broadcast on a per-conversation channel) -------------
let dmChannel = null;
let dmReady = false;
let lastTypingSentAt = 0;
let typingStopTimer = null;
const typingClearTimers = new Map();

function leaveDmChannel() {
  if (dmChannel) {
    try { requireSupabase().removeChannel(dmChannel); } catch { /* already closed */ }
  }
  dmChannel = null;
  dmReady = false;
  clearTimeout(typingStopTimer);
  lastTypingSentAt = 0;
}

function joinDmChannel(convId) {
  leaveDmChannel();
  try {
    const sb = requireSupabase();
    const ch = sb.channel(`dm:${convId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (!payload || payload.from === myId) return;
      clearTimeout(typingClearTimers.get(convId));
      if (payload.typing) {
        setState({ typing: { ...state.typing, [convId]: true } });
        // Safety net: if the "stopped" event is lost, don't type forever.
        typingClearTimers.set(convId, setTimeout(() => setState({ typing: { ...state.typing, [convId]: false } }), 5000));
      } else {
        setState({ typing: { ...state.typing, [convId]: false } });
      }
    });
    ch.subscribe((status) => { dmReady = status === "SUBSCRIBED"; });
    dmChannel = ch;
  } catch {
    dmChannel = null;
  }
}

function sendTypingEvent(typing) {
  if (!dmChannel || !dmReady) return;
  try { dmChannel.send({ type: "broadcast", event: "typing", payload: { from: myId, typing } }); } catch { /* best effort */ }
}

/** Call on every keystroke: sends "typing" at most every 2s and a "stopped"
 * event after 3s of silence. */
export function signalTyping() {
  const now = Date.now();
  if (now - lastTypingSentAt > 2000) {
    lastTypingSentAt = now;
    sendTypingEvent(true);
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(stopTyping, 3000);
}
export function stopTyping() {
  clearTimeout(typingStopTimer);
  if (lastTypingSentAt) {
    lastTypingSentAt = 0;
    sendTypingEvent(false);
  }
}

// --- Active conversation (set by the Messages page) -------------------------
export function setActiveConversation(convId) {
  if (activeConvId === convId) return;
  stopTyping();
  activeConvId = convId;
  if (!convId) {
    leaveDmChannel();
    return;
  }
  joinDmChannel(convId);
  loadThread(convId).then(() => markReadDebounced(convId));
  markReadDebounced(convId);
}

// --- Incoming-message side effects ------------------------------------------
function previewText(body) {
  return body.length > 90 ? `${body.slice(0, 90)}…` : body;
}

function announceIncoming(conv, row) {
  const locale = getLocale();
  const name = conv?.otherName ?? translate(locale, "feed.unknownAuthor");
  const openIt = () => {
    try { window.focus(); } catch { /* ignore */ }
    navigate(`/app/messages?c=${row.conversation_id}`);
  };
  playNotificationSound();
  if (pageIsVisible()) {
    toast(`${name}: ${previewText(row.body)}`, "slate");
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const popup = new Notification(name, { body: previewText(row.body), icon: "/favicon.svg", tag: `dm:${row.conversation_id}` });
    popup.onclick = () => { openIt(); popup.close(); };
  } catch { /* some platforms throw on `new Notification` -- the in-app badge still shows */ }
}

async function onIncomingInsert(row) {
  const convId = row.conversation_id;
  const fromMe = row.sender_id === myId;
  if (threads.has(convId)) upsertMessage(convId, mapMessage(row));

  let conv = state.conversations.find((c) => c.id === convId);
  if (!conv) {
    // First message of a brand-new thread: fetch it (with the sender's name).
    await loadConversations({ silent: true });
    conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
  } else {
    patchConversation(convId, {
      lastBody: row.body.slice(0, 140),
      lastAt: row.created_at,
      lastSenderId: row.sender_id,
      unread: fromMe ? conv.unread : conv.unread + 1,
    });
  }
  if (fromMe) return;

  // The sender stopped typing the moment the message landed.
  if (state.typing[convId]) setState({ typing: { ...state.typing, [convId]: false } });

  const looking = convId === activeConvId && pageIsVisible();
  if (looking) {
    markReadDebounced(convId);
  } else {
    announceIncoming(conv, row);
  }
}

function onMessageEvent(payload) {
  const row = payload?.new;
  if (!row?.id || !myId) return;
  if (payload.eventType === "INSERT") {
    onIncomingInsert(row);
  } else if (payload.eventType === "UPDATE") {
    // Read receipt (or any server-side change): patch the bubble in place.
    if (threads.has(row.conversation_id)) upsertMessage(row.conversation_id, mapMessage(row));
  }
}

// --- Bootstrap / teardown ---------------------------------------------------
let bootUnsub = null;
let presenceChannel = null;
let bootedFor = null;
let visibilityHandler = null;

function startMessaging(userId) {
  if (bootedFor === userId) return;
  stopMessaging();
  bootedFor = userId;
  myId = userId;
  loadConversations();

  bootUnsub = watchTables(
    `messaging:${userId}`,
    [{ table: "messages" }, { table: "conversations" }],
    (payload) => {
      if (payload.table === "messages") onMessageEvent(payload);
      else loadConversationsQuietly();
    },
    (status) => {
      // Back online after a drop: refetch whatever was missed in the gap.
      if (status === "SUBSCRIBED" && state.loaded) {
        loadConversationsQuietly();
        if (activeConvId) loadThread(activeConvId);
      }
    }
  );

  try {
    const sb = requireSupabase();
    presenceChannel = sb.channel("presence:online", { config: { presence: { key: userId } } });
    presenceChannel.on("presence", { event: "sync" }, () => {
      setState({ online: new Set(Object.keys(presenceChannel?.presenceState?.() ?? {})) });
    });
    presenceChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") presenceChannel.track({ at: Date.now() }).catch(() => {});
    });
  } catch {
    presenceChannel = null;
  }

  visibilityHandler = () => { if (pageIsVisible() && activeConvId) markReadDebounced(activeConvId); };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function stopMessaging() {
  if (bootUnsub) { bootUnsub(); bootUnsub = null; }
  if (presenceChannel) {
    try { requireSupabase().removeChannel(presenceChannel); } catch { /* already closed */ }
    presenceChannel = null;
  }
  if (visibilityHandler) { document.removeEventListener("visibilitychange", visibilityHandler); visibilityHandler = null; }
  leaveDmChannel();
  loadConversationsQuietly.cancel();
  markReadDebounced.cancel();
  threads.clear();
  activeConvId = null;
  bootedFor = null;
  myId = null;
  state = { loaded: false, loading: false, error: null, conversations: [], online: new Set(), typing: {} };
  notify();
}

function useStoreTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case something changed between render and subscribe
    return () => listeners.delete(listener);
  }, []);
}

/** Mounted once, in the app shell: opens the realtime connections for the
 * signed-in user and returns the total unread count for the sidebar badge. */
export function useMessagingBootstrap() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  useStoreTick();
  useEffect(() => {
    if (userId) startMessaging(userId);
    else stopMessaging();
  }, [userId]);
  return state.conversations.reduce((sum, c) => sum + c.unread, 0);
}

export function useConversations() {
  useStoreTick();
  return {
    conversations: state.conversations,
    loaded: state.loaded,
    loading: state.loading,
    error: state.error,
    online: state.online,
    typing: state.typing,
    unreadTotal: state.conversations.reduce((sum, c) => sum + c.unread, 0),
  };
}

export function useThread(convId) {
  useStoreTick();
  const thread = (convId && threads.get(convId)) || emptyThread();
  return { ...thread, typing: !!(convId && state.typing[convId]) };
}

export function reloadConversations() {
  loadConversations({ silent: true });
}
