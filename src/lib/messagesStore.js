import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { fetchAuthorsById } from "./postsStore.js";
import { watchTables, debounce } from "./realtime.js";
import { t as translate, getLocale } from "./i18n.js";
import { playNotificationSound } from "./notificationsStore.js";
import { isMissingFunction } from "./rpcErrors.js";
import { prepareImage } from "./imageTools.js";
import { toast } from "../components/ui.js";
import { navigate } from "../router.js";

// ============================================================================
// 1:1 messaging between accepted friends (migrations 0018, 0020, 0024).
//
// Delivery is Supabase Realtime `postgres_changes` on `messages` (INSERT =
// new message, UPDATE = read receipt / edit / delete), on `conversations` and
// -- on a channel of its own, so a database without migration 0024 cannot
// break the rest -- on `message_reactions`. RLS decides what each browser
// receives, so a subscriber can only ever get rows from conversations they're
// in. Online dots use one Presence channel; the "typing…" signal is a
// Broadcast on a per-conversation channel (nothing sensitive travels on
// either -- message text only ever flows through the RLS-protected table).
//
// A message is: text and/or one picture (private bucket `message-images`, shown
// through signed URLs), optionally a reply to an earlier message, any number
// of reactions (one per person), and it can be edited (48 h) or deleted by its
// sender. Everything the player does shows at once and is confirmed (or taken
// back) when the server answers.
//
// Older databases keep working: without 0024 the thread is read without the
// reaction / quote embeds and the actions that need it are hidden (`caps`).
// ============================================================================

const PAGE_SIZE = 40;
const IMAGE_BUCKET = "message-images";
const REACTION_SET = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const KNOWN_ERRORS = new Set(["edit_expired", "not_found", "deleted", "bad_text", "bad_emoji", "not_friends"]);
const FULL_SELECT = "*, reactions:message_reactions(user_id,emoji), reply:messages!reply_to_id(id,sender_id,body,attachment_path,deleted_at)";
export const EDIT_WINDOW_MS = 48 * 3600 * 1000;

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

// --- Mapping ----------------------------------------------------------------
function mapReply(r) {
  if (r === undefined) return undefined; // not embedded in this payload (realtime row)
  if (!r) return null;
  return { id: r.id, senderId: r.sender_id, body: r.body ?? "", hasImage: !!r.attachment_path, deleted: !!r.deleted_at };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body ?? "",
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
    attachmentPath: row.attachment_path ?? null,
    replyToId: row.reply_to_id ?? null,
    reply: mapReply(row.reply),
    reactions: Array.isArray(row.reactions) ? row.reactions.map((x) => ({ userId: x.user_id, emoji: x.emoji })) : undefined,
    status: null, // null = confirmed by the server; "sending" | "failed" = local only
  };
}

function compareMessages(a, b) {
  const d = new Date(a.createdAt) - new Date(b.createdAt);
  return d !== 0 ? d : a.id < b.id ? -1 : 1;
}

function compareConversations(a, b) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
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
  caps: { actions: "unknown", images: "unknown" }, // unknown | ok | old: does the server know migration 0024 / 0020
};
const threads = new Map(); // conversationId -> { messages, loaded, loading, loadingOlder, hasMore, divider, dividerReady }
const listeners = new Set();
const pendingImages = new Map(); // message id -> { blob, ext, previewUrl } while an image message is not delivered yet
let myId = null;
let activeConvId = null;

function notify() {
  for (const l of listeners) l();
}
function setState(patch) {
  state = { ...state, ...patch };
  notify();
}
function setCaps(patch) {
  const next = { ...state.caps, ...patch };
  if (next.actions === state.caps.actions && next.images === state.caps.images) return;
  setState({ caps: next });
}
function emptyThread() {
  return { messages: [], loaded: false, loading: false, loadingOlder: false, hasMore: false, divider: null, dividerReady: false };
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
const findMessage = (convId, id) => threads.get(convId)?.messages.find((m) => m.id === id) ?? null;

function pageIsVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** The short word of a failed chat call: edit_expired, not_found, deleted, bad_text, bad_emoji, not_friends,
 * updatePending (the server does not know the feature yet) or generic. */
export function chatErrorCode(err) {
  if (isMissingFunction(err)) { setCaps({ actions: "old" }); return "updatePending"; }
  const m = typeof err?.message === "string" ? err.message.trim() : "";
  if (KNOWN_ERRORS.has(m)) return m;
  return "generic";
}

// --- Drafts (what was typed and not sent, per conversation) -------------------
let drafts = {};
const draftKey = (uid) => `dos_chat_drafts_${uid}`;
function loadDrafts(uid) {
  try { drafts = JSON.parse(localStorage.getItem(draftKey(uid)) ?? "{}") ?? {}; } catch { drafts = {}; }
}
const persistDrafts = debounce(() => {
  try { if (myId) localStorage.setItem(draftKey(myId), JSON.stringify(drafts)); } catch { /* private mode: drafts just live for this visit */ }
}, 400);
const notifyDrafts = debounce(() => notify(), 250);

export const getDraft = (convId) => (convId && drafts[convId]) || "";
export function setDraft(convId, text) {
  if (!convId) return;
  const v = text ?? "";
  if (v.trim() === "") { if (!(convId in drafts)) return; delete drafts[convId]; } else drafts[convId] = v;
  persistDrafts();
  notifyDrafts();
}

// --- Conversations list -----------------------------------------------------
async function fetchConversations() {
  const sb = requireSupabase();
  const me = getCurrentUser()?.id;
  if (!me) return [];
  const [convRes, unreadRes, prefRes] = await Promise.all([
    sb.from("conversations").select("*").order("last_message_at", { ascending: false, nullsFirst: false }),
    sb.rpc("my_unread_counts"),
    sb.from("conversation_prefs").select("conversation_id,pinned_at,muted"), // absent before 0024: ignored
  ]);
  if (convRes.error) throw convRes.error;
  const rows = convRes.data ?? [];
  const unreadByConv = new Map((unreadRes.error ? [] : unreadRes.data ?? []).map((r) => [r.conversation_id, Number(r.unread)]));
  const prefByConv = new Map((prefRes.error || !Array.isArray(prefRes.data) ? [] : prefRes.data).map((r) => [r.conversation_id, r]));
  const otherIds = [...new Set(rows.map((r) => (r.user_a === me ? r.user_b : r.user_a)))];
  const people = await fetchAuthorsById(otherIds);
  return rows
    .map((r) => {
      const otherId = r.user_a === me ? r.user_b : r.user_a;
      const p = people[otherId];
      const pref = prefByConv.get(r.id);
      return {
        id: r.id,
        otherId,
        otherName: p?.full_name ?? null,
        otherUsername: p?.username ?? null,
        otherAvatarUrl: p?.avatar_url ?? null,
        lastBody: r.last_message_body ?? null,
        lastAt: r.last_message_at ?? null,
        lastSenderId: r.last_message_sender_id ?? null,
        lastHasImage: !!r.last_message_has_attachment,
        lastDeleted: !!r.last_message_deleted,
        unread: unreadByConv.get(r.id) ?? 0,
        pinned: !!pref?.pinned_at,
        muted: !!pref?.muted,
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
/** Puts `msg` into the thread. A realtime row has no reaction / quote embeds: those are kept from what is already there. */
function upsertMessage(convId, msg) {
  const thread = threads.get(convId) ?? emptyThread();
  const i = thread.messages.findIndex((m) => m.id === msg.id);
  let messages;
  if (i === -1) {
    messages = [...thread.messages, { ...msg, reactions: msg.reactions ?? [], reply: msg.reply ?? null }].sort(compareMessages);
  } else {
    const prev = thread.messages[i];
    const merged = {
      ...prev,
      ...msg,
      // An out-of-order echo must never "un-read" a message.
      readAt: msg.readAt ?? prev.readAt,
      reactions: msg.reactions ?? prev.reactions ?? [],
      reply: msg.reply !== undefined ? msg.reply : prev.reply ?? null,
      localImage: msg.localImage !== undefined ? msg.localImage : prev.localImage ?? null,
    };
    messages = thread.messages.slice();
    messages[i] = merged;
    messages.sort(compareMessages);
  }
  threads.set(convId, { ...thread, messages });
  notify();
}

/** Messages of a conversation with the reaction / quote embeds; falls back to a plain read on a database without 0024. */
async function queryMessages(convId, refine) {
  const sb = requireSupabase();
  if (state.caps.actions !== "old") {
    const { data, error } = await refine(sb.from("messages").select(FULL_SELECT).eq("conversation_id", convId));
    if (!error) {
      if (state.caps.actions === "unknown") setCaps({ actions: "ok" });
      return data ?? [];
    }
    // a refusal of the query itself (no such relationship / column) means an older database; anything else is a real failure
    if (!(typeof error.code === "string" && /^(PGRST|42)/.test(error.code))) throw error;
    setCaps({ actions: "old" });
  }
  const { data, error } = await refine(sb.from("messages").select("*").eq("conversation_id", convId));
  if (error) throw error;
  return data ?? [];
}

function firstUnread(messages) {
  const unread = messages.filter((m) => m.senderId !== myId && !m.readAt && !m.deletedAt && !m.status);
  return unread.length ? { id: unread[0].id, count: unread.length } : null;
}

async function loadThread(convId) {
  const existing = threads.get(convId);
  if (existing?.loading) return;
  patchThread(convId, { loading: true });
  try {
    const data = await queryMessages(convId, (q) => q.order("created_at", { ascending: false }).limit(PAGE_SIZE));
    const fetched = data.map(mapMessage);
    // Keep local-only messages (still sending / failed) the server doesn't know yet.
    const local = threads.get(convId)?.messages ?? [];
    const pending = local.filter((m) => m.status);
    const byId = new Map(
      [...fetched, ...pending].map((m) => {
        const prev = local.find((x) => x.id === m.id);
        return [m.id, { ...m, reactions: m.reactions ?? prev?.reactions ?? [], reply: m.reply !== undefined ? m.reply : prev?.reply ?? null, localImage: prev?.localImage ?? null }];
      })
    );
    const messages = [...byId.values()].sort(compareMessages);
    const thread = threads.get(convId) ?? emptyThread();
    patchThread(convId, {
      messages,
      loaded: true,
      loading: false,
      hasMore: fetched.length === PAGE_SIZE,
      divider: thread.dividerReady ? thread.divider : firstUnread(messages),
      dividerReady: true,
    });
    // rows without the column mean the server does not know pictures yet (migration 0020)
    if (state.caps.images === "unknown" && data.length) setCaps({ images: "attachment_path" in data[0] ? "ok" : "old" });
  } catch {
    patchThread(convId, { loading: false, loaded: true, dividerReady: true });
  }
}

export async function loadOlderMessages(convId) {
  const thread = threads.get(convId);
  if (!thread || thread.loadingOlder || !thread.hasMore || thread.messages.length === 0) return;
  patchThread(convId, { loadingOlder: true });
  try {
    const oldest = thread.messages.find((m) => !m.status)?.createdAt ?? thread.messages[0].createdAt;
    const data = await queryMessages(convId, (q) => q.lt("created_at", oldest).order("created_at", { ascending: false }).limit(PAGE_SIZE));
    const older = data.map(mapMessage);
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

/** Makes sure a message (found by search, or quoted by a reply) is in the thread: reads everything since its time in one go,
 * or, when that is a lot, pages backwards. Resolves true when the message is there. */
export async function ensureMessageLoaded(convId, messageId, createdAt) {
  if (findMessage(convId, messageId)) return true;
  if (!createdAt) {
    // a quote that only knows the id: ask for the one message
    try {
      const sb = requireSupabase();
      const { data } = await sb.from("messages").select("id,created_at").eq("id", messageId).maybeSingle();
      createdAt = data?.created_at;
    } catch { return false; }
    if (!createdAt) return false;
  }
  try {
    const BIG = 400;
    const data = await queryMessages(convId, (q) => q.gte("created_at", createdAt).order("created_at", { ascending: false }).limit(BIG));
    const fetched = data.map(mapMessage);
    if (fetched.length < BIG) {
      const current = threads.get(convId) ?? emptyThread();
      const byId = new Map(current.messages.map((m) => [m.id, m]));
      for (const m of fetched) {
        const prev = byId.get(m.id);
        byId.set(m.id, { ...m, reactions: m.reactions ?? prev?.reactions ?? [], reply: m.reply !== undefined ? m.reply : prev?.reply ?? null, localImage: prev?.localImage ?? null });
      }
      patchThread(convId, { messages: [...byId.values()].sort(compareMessages), hasMore: true });
      return !!findMessage(convId, messageId);
    }
  } catch { /* fall through to paging */ }
  for (let i = 0; i < 40 && !findMessage(convId, messageId); i++) {
    const t = threads.get(convId);
    if (!t?.hasMore) break;
    await loadOlderMessages(convId);
  }
  return !!findMessage(convId, messageId);
}

// --- Pictures ---------------------------------------------------------------
const urlCache = new Map(); // storage path -> { url, exp }
let signBatch = null;

function flushSignBatch() {
  const batch = signBatch;
  signBatch = null;
  if (!batch) return;
  const paths = [...batch.paths];
  let sb;
  try { sb = requireSupabase(); } catch (err) { batch.waiters.forEach((w) => w.reject(err)); return; }
  sb.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600).then(({ data, error }) => {
    const found = new Map((error ? [] : data ?? []).map((d) => [d.path, d.signedUrl]));
    for (const w of batch.waiters) {
      const url = found.get(w.path);
      if (url) {
        urlCache.set(w.path, { url, exp: Date.now() + 3500 * 1000 });
        w.resolve(url);
      } else {
        w.reject(new Error("sign_failed"));
      }
    }
  }, (err) => batch.waiters.forEach((w) => w.reject(err)));
}

/** A temporary link to a picture of a conversation (the bucket is private). Requests made within a few ms share one call. */
export function getImageUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now() + 60000) return Promise.resolve(hit.url);
  return new Promise((resolve, reject) => {
    if (!signBatch) {
      signBatch = { paths: new Set(), waiters: [] };
      setTimeout(flushSignBatch, 25);
    }
    signBatch.paths.add(path);
    signBatch.waiters.push({ path, resolve, reject });
  });
}
export const cachedImageUrl = (path) => { const hit = urlCache.get(path); return hit && hit.exp > Date.now() + 60000 ? hit.url : null; };

/** Shrinks a picked / pasted / dropped picture and shows it as a preview. Rejects with `.hint` bad_type / unreadable / too_big. */
export async function prepareChatImage(file) {
  const out = await prepareImage(file, { maxSide: 1600, maxBytes: 1500 * 1024 });
  return { ...out, previewUrl: URL.createObjectURL(out.blob) };
}

async function uploadChatImage(convId, image) {
  const sb = requireSupabase();
  const me = getCurrentUser()?.id;
  const path = `${convId}/${me}/${newId()}.${image.ext}`;
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, image.blob, { cacheControl: "3600", upsert: false, contentType: image.blob.type });
  if (error) throw error;
  return path;
}

// --- Sending ----------------------------------------------------------------
async function insertMessage(convId, id, body, replyToId, attachmentPath) {
  const sb = requireSupabase();
  const row = { id, conversation_id: convId, body };
  if (replyToId) row.reply_to_id = replyToId;
  if (attachmentPath) row.attachment_path = attachmentPath;
  const { data, error } = await sb.from("messages").insert(row).select().single();
  if (error) throw error;
  return mapMessage(data);
}

function bumpPreview(convId, body, createdAt, hasImage) {
  if (!state.conversations.some((c) => c.id === convId)) return;
  patchConversation(convId, { lastBody: body.slice(0, 140), lastAt: createdAt, lastSenderId: myId, lastHasImage: !!hasImage, lastDeleted: false });
}

function snapshotReply(convId, replyToId) {
  const m = findMessage(convId, replyToId);
  return m ? { id: m.id, senderId: m.senderId, body: m.body, hasImage: !!m.attachmentPath, deleted: !!m.deletedAt } : null;
}

async function deliver(convId, id) {
  const msg = findMessage(convId, id);
  if (!msg) return;
  const image = pendingImages.get(id) ?? null;
  try {
    let attachmentPath = msg.attachmentPath;
    if (image && !attachmentPath) {
      attachmentPath = await uploadChatImage(convId, image);
      if (!findMessage(convId, id)) {
        // the player threw the message away while it was uploading: do not send it after all
        requireSupabase().storage.from(IMAGE_BUCKET).remove([attachmentPath]).catch(() => {});
        return;
      }
      upsertMessage(convId, { ...findMessage(convId, id), attachmentPath });
    }
    const saved = await insertMessage(convId, id, msg.body, msg.replyToId, attachmentPath);
    if (image && attachmentPath) urlCache.set(attachmentPath, { url: image.previewUrl, exp: Date.now() + 24 * 3600 * 1000 });
    pendingImages.delete(id);
    upsertMessage(convId, { ...saved, reply: findMessage(convId, id)?.reply ?? snapshotReply(convId, msg.replyToId), reactions: [], localImage: image?.previewUrl ?? null });
  } catch (err) {
    if (err?.code === "PGRST204" || /attachment_path/.test(err?.message ?? "")) setCaps({ images: "old" });
    const cur = findMessage(convId, id);
    if (cur) upsertMessage(convId, { ...cur, status: "failed" });
  }
}

/** Optimistic send: the bubble appears instantly with a clock, then flips to
 * ✓ when the server confirms (or "failed — tap to retry"). The client picks
 * the row id, so the realtime echo of this same insert merges into the
 * bubble instead of duplicating it. `image` comes from prepareChatImage(). */
export async function sendMessage(convId, rawBody, { replyToId = null, image = null } = {}) {
  const body = (rawBody ?? "").trim().slice(0, 4000);
  const me = getCurrentUser()?.id;
  if ((!body && !image) || !me) return;
  stopTyping();
  const id = newId();
  const createdAt = new Date().toISOString();
  if (image) pendingImages.set(id, image);
  upsertMessage(convId, {
    id, conversationId: convId, senderId: me, body, createdAt, readAt: null, editedAt: null, deletedAt: null,
    attachmentPath: null, replyToId, reply: replyToId ? snapshotReply(convId, replyToId) : null, reactions: [],
    status: "sending", localImage: image?.previewUrl ?? null,
  });
  bumpPreview(convId, body, createdAt, !!image);
  await deliver(convId, id);
}

export async function retryMessage(convId, messageId) {
  const msg = findMessage(convId, messageId);
  if (!msg || msg.status !== "failed") return;
  upsertMessage(convId, { ...msg, status: "sending" });
  await deliver(convId, messageId);
}

// --- Actions on a message ---------------------------------------------------
/** Edits my own text message. Resolves { ok } or { ok: false, error } (a chatErrorCode word). */
export async function editMessage(convId, messageId, rawBody) {
  const msg = findMessage(convId, messageId);
  const body = (rawBody ?? "").trim().slice(0, 4000);
  if (!msg || msg.senderId !== myId || msg.deletedAt || msg.status) return { ok: false, error: "not_found" };
  if (!body && !msg.attachmentPath) return { ok: false, error: "bad_text" };
  if (body === msg.body) return { ok: true };
  if (Date.now() - new Date(msg.createdAt).getTime() > EDIT_WINDOW_MS) return { ok: false, error: "edit_expired" };
  const conv = state.conversations.find((c) => c.id === convId);
  const isLast = conv && conv.lastAt === msg.createdAt;
  upsertMessage(convId, { ...msg, body, editedAt: new Date().toISOString() });
  if (isLast) patchConversation(convId, { lastBody: body.slice(0, 140) });
  try {
    const sb = requireSupabase();
    const { data, error } = await sb.rpc("edit_message", { p_message_id: messageId, p_body: body });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id) upsertMessage(convId, { ...mapMessage(row), reply: undefined, reactions: undefined });
    return { ok: true };
  } catch (err) {
    upsertMessage(convId, msg);
    if (isLast) patchConversation(convId, { lastBody: conv.lastBody });
    return { ok: false, error: chatErrorCode(err) };
  }
}

function dropLocalMessage(convId, messageId) {
  const thread = threads.get(convId);
  if (!thread) return;
  const image = pendingImages.get(messageId);
  pendingImages.delete(messageId);
  patchThread(convId, { messages: thread.messages.filter((m) => m.id !== messageId) });
  if (image?.previewUrl) { try { URL.revokeObjectURL(image.previewUrl); } catch { /* already gone */ } }
}

/** Deletes my message for both people (a message that never left this device is just dropped). */
export async function deleteMessage(convId, messageId) {
  const msg = findMessage(convId, messageId);
  if (!msg || msg.senderId !== myId) return { ok: false, error: "not_found" };
  if (msg.status) { dropLocalMessage(convId, messageId); return { ok: true }; }
  const conv = state.conversations.find((c) => c.id === convId);
  const isLast = conv && conv.lastAt === msg.createdAt;
  upsertMessage(convId, { ...msg, body: "", attachmentPath: null, deletedAt: new Date().toISOString(), reactions: [], localImage: null });
  if (isLast) patchConversation(convId, { lastBody: "", lastHasImage: false, lastDeleted: true });
  try {
    const sb = requireSupabase();
    const { data: path, error } = await sb.rpc("delete_message", { p_message_id: messageId });
    if (error) throw error;
    if (typeof path === "string" && path) {
      urlCache.delete(path);
      sb.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {}); // best effort: the row no longer points at it
    }
    return { ok: true };
  } catch (err) {
    upsertMessage(convId, msg);
    if (isLast) patchConversation(convId, { lastBody: conv.lastBody, lastHasImage: conv.lastHasImage, lastDeleted: false });
    return { ok: false, error: chatErrorCode(err) };
  }
}

/** Reacts with `emoji`; the same emoji again takes the reaction back. */
export async function reactToMessage(convId, messageId, emoji) {
  const msg = findMessage(convId, messageId);
  if (!msg || msg.deletedAt || msg.status || !REACTION_SET.includes(emoji)) return { ok: false, error: "not_found" };
  const mine = msg.reactions.find((r) => r.userId === myId);
  const next = mine?.emoji === emoji ? null : emoji;
  upsertMessage(convId, { ...msg, reactions: [...msg.reactions.filter((r) => r.userId !== myId), ...(next ? [{ userId: myId, emoji: next }] : [])] });
  try {
    const sb = requireSupabase();
    const { error } = await sb.rpc("react_to_message", { p_message_id: messageId, p_emoji: next });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    const cur = findMessage(convId, messageId);
    if (cur) upsertMessage(convId, { ...cur, reactions: msg.reactions });
    return { ok: false, error: chatErrorCode(err) };
  }
}

/** Pins / mutes a conversation (only for me). Each field left undefined stays as it is. */
export async function setConversationPref(convId, { pinned, muted } = {}) {
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) return { ok: false, error: "not_found" };
  patchConversation(convId, { ...(pinned === undefined ? {} : { pinned }), ...(muted === undefined ? {} : { muted }) });
  try {
    const sb = requireSupabase();
    const { error } = await sb.rpc("set_conversation_pref", { p_conversation_id: convId, p_pinned: pinned ?? null, p_muted: muted ?? null });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    patchConversation(convId, { pinned: conv.pinned, muted: conv.muted });
    return { ok: false, error: chatErrorCode(err) };
  }
}

/** Finds messages by their text across my conversations (needs 0024). Rejects with .code "updatePending" on an older server. */
export async function searchMessages(query) {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("search_messages", { p_query: q, p_limit: 30 });
  if (error) {
    const missing = isMissingFunction(error);
    if (missing) setCaps({ actions: "old" });
    throw Object.assign(new Error(missing ? "updatePending" : error.message), { code: missing ? "updatePending" : error.code });
  }
  return (data ?? []).map((r) => ({ messageId: r.message_id, conversationId: r.conversation_id, senderId: r.sender_id, body: r.body, createdAt: r.created_at }));
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
  // the "N unread" line is worked out once per visit, from what was unread when the chat was opened
  patchThread(convId, { divider: null, dividerReady: false });
  joinDmChannel(convId);
  loadThread(convId).then(() => markReadDebounced(convId));
}

// --- Incoming-message side effects ------------------------------------------
function previewText(row) {
  const body = row.body || (row.attachment_path ? `📷 ${translate(getLocale(), "messages.photo")}` : "");
  return body.length > 90 ? `${body.slice(0, 90)}…` : body;
}

function announceIncoming(conv, row) {
  if (conv?.muted) return;
  const locale = getLocale();
  const name = conv?.otherName ?? translate(locale, "feed.unknownAuthor");
  const openIt = () => {
    try { window.focus(); } catch { /* ignore */ }
    navigate(`/app/messages?c=${row.conversation_id}`);
  };
  playNotificationSound();
  if (pageIsVisible()) {
    toast(`${name}: ${previewText(row)}`, "neutral");
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const popup = new Notification(name, { body: previewText(row), icon: "/assets/logo/icon-192.png", tag: `dm:${row.conversation_id}` });
    popup.onclick = () => { openIt(); popup.close(); };
  } catch { /* some platforms throw on `new Notification` -- the in-app badge still shows */ }
}

/** A reply that arrives without its quote (the quoted message is older than the loaded page): ask for just that one. */
async function hydrateReply(convId, msg) {
  if (!msg.replyToId || msg.reply || findMessage(convId, msg.replyToId)) return;
  try {
    const sb = requireSupabase();
    const { data } = await sb.from("messages").select("id,sender_id,body,attachment_path,deleted_at").eq("id", msg.replyToId).maybeSingle();
    if (data) {
      const cur = findMessage(convId, msg.id);
      if (cur) upsertMessage(convId, { ...cur, reply: mapReply(data) });
    }
  } catch { /* the quote just shows as "message" */ }
}

async function onIncomingInsert(row) {
  const convId = row.conversation_id;
  const fromMe = row.sender_id === myId;
  if (threads.has(convId)) {
    const msg = mapMessage(row);
    upsertMessage(convId, msg);
    hydrateReply(convId, msg);
  }

  let conv = state.conversations.find((c) => c.id === convId);
  if (!conv) {
    // First message of a brand-new thread: fetch it (with the sender's name).
    await loadConversations({ silent: true });
    conv = state.conversations.find((c) => c.id === convId);
    if (!conv) return;
  } else {
    patchConversation(convId, {
      lastBody: (row.body ?? "").slice(0, 140),
      lastAt: row.created_at,
      lastSenderId: row.sender_id,
      lastHasImage: !!row.attachment_path,
      lastDeleted: false,
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
    // Read receipt, edit or delete: patch the bubble in place.
    const convId = row.conversation_id;
    if (!threads.has(convId)) return;
    const msg = mapMessage(row);
    if (msg.deletedAt) { msg.reactions = []; msg.localImage = null; }
    upsertMessage(convId, msg);
    const conv = state.conversations.find((c) => c.id === convId);
    if (conv && conv.lastAt === msg.createdAt) {
      patchConversation(convId, { lastBody: msg.body.slice(0, 140), lastHasImage: !!msg.attachmentPath, lastDeleted: !!msg.deletedAt });
    }
  }
}

function onReactionEvent(payload) {
  const removed = payload?.eventType === "DELETE";
  const row = removed ? payload?.old : payload?.new;
  if (!row?.message_id || !row?.user_id) return;
  for (const [convId, thread] of threads) {
    const msg = thread.messages.find((m) => m.id === row.message_id);
    if (!msg) continue;
    const others = (msg.reactions ?? []).filter((r) => r.userId !== row.user_id);
    upsertMessage(convId, { ...msg, reactions: removed || !row.emoji ? others : [...others, { userId: row.user_id, emoji: row.emoji }] });
    return;
  }
}

// --- Bootstrap / teardown ---------------------------------------------------
let bootUnsub = null;
let reactionsUnsub = null;
let presenceChannel = null;
let bootedFor = null;
let visibilityHandler = null;

function startMessaging(userId) {
  if (bootedFor === userId) return;
  stopMessaging();
  bootedFor = userId;
  myId = userId;
  loadDrafts(userId);
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
  // its own channel: a database that has no message_reactions table yet must not take the messages channel down with it
  reactionsUnsub = watchTables(`message-reactions:${userId}`, [{ table: "message_reactions" }], onReactionEvent);

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
  if (reactionsUnsub) { reactionsUnsub(); reactionsUnsub = null; }
  if (presenceChannel) {
    try { requireSupabase().removeChannel(presenceChannel); } catch { /* already closed */ }
    presenceChannel = null;
  }
  if (visibilityHandler) { document.removeEventListener("visibilitychange", visibilityHandler); visibilityHandler = null; }
  leaveDmChannel();
  loadConversationsQuietly.cancel();
  markReadDebounced.cancel();
  threads.clear();
  pendingImages.clear();
  urlCache.clear();
  drafts = {};
  activeConvId = null;
  bootedFor = null;
  myId = null;
  state = { loaded: false, loading: false, error: null, conversations: [], online: new Set(), typing: {}, caps: { actions: "unknown", images: "unknown" } };
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

/** What the server can do: actions (reactions, edit, delete, pin, search: migration 0024) and images (0020). */
export function useMessagingCaps() {
  useStoreTick();
  return state.caps;
}

export function reloadConversations() {
  loadConversations({ silent: true });
}

export { REACTION_SET };
