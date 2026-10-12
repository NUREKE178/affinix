import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { getCurrentUser, useSession } from "./auth.js";
import { fetchAuthorsById } from "./postsStore.js";
import { watchTables, debounce } from "./realtime.js";
import { t as translate, getLocale } from "./i18n.js";
import { toast } from "../components/ui.js";

function mapFriendship(row, viewerId, profilesById) {
  const isRequester = row.requester_id === viewerId;
  const otherId = isRequester ? row.addressee_id : row.requester_id;
  const other = profilesById[otherId];
  return {
    id: row.id,
    status: row.status,
    otherId,
    otherName: other?.full_name ?? null,
    otherUsername: other?.username ?? null,
    otherAvatarUrl: other?.avatar_url ?? null,
    otherRoleTitle: other?.role_title ?? null,
    otherBio: other?.bio ?? null,
    isRequester,
    createdAt: row.created_at,
  };
}

/** Every friendship row the viewer is a party to (either direction), split
 * into the three shapes the UI actually needs. One query, not three --
 * status/direction are already on each row, so there's nothing to gain by
 * asking Postgres for three separate filtered sets. */
async function fetchMyFriendships() {
  const userId = getCurrentUser()?.id;
  if (!userId) return { friends: [], incoming: [], outgoing: [] };
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw error;
  const rows = data ?? [];
  const otherIds = [...new Set(rows.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)))];
  const profilesById = await fetchAuthorsById(otherIds);
  const mapped = rows
    .map((row) => mapFriendship(row, userId, profilesById))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    friends: mapped.filter((f) => f.status === "accepted"),
    incoming: mapped.filter((f) => f.status === "pending" && !f.isRequester),
    outgoing: mapped.filter((f) => f.status === "pending" && f.isRequester),
  };
}

/** Routed through send_friend_request() (migration 0017) rather than a
 * direct insert -- it also has to notice "they already requested ME" and
 * accept instead, which a plain client-side insert can't decide on its
 * own. */
export async function sendFriendRequest(targetId) {
  const sb = requireSupabase();
  const { error } = await sb.rpc("send_friend_request", { target_id: targetId });
  if (error) throw error;
  invalidateFriends();
}

/** The only UPDATE this table ever needs, and deliberately not exposed as
 * a raw RLS-gated update -- see migration 0017's own comment for why. */
export async function acceptFriendRequest(friendshipId) {
  const sb = requireSupabase();
  const { error } = await sb.rpc("accept_friend_request", { p_friendship_id: friendshipId });
  if (error) throw error;
  invalidateFriends();
}

/** Decline, cancel, and remove are all the same operation underneath --
 * delete a row you're a party to -- safely covered by friendships_delete_own
 * (0017) without needing three separate functions. */
export async function removeFriendship(friendshipId) {
  const sb = requireSupabase();
  const { error } = await sb.from("friendships").delete().eq("id", friendshipId);
  if (error) throw error;
  invalidateFriends();
}

/** For ANY profile, not just the viewer's own -- friends_count() (0017) is
 * SECURITY DEFINER specifically so a count can show on someone else's
 * profile/popover without widening friendships' own SELECT policy. */
export async function fetchFriendsCount(targetId) {
  if (!targetId) return 0;
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("friends_count", { target_id: targetId });
  if (error) throw error;
  return data ?? 0;
}

/** A lightweight fetch-on-mount for a single profile's count -- for the
 * viewer's OWN count, prefer useFriends().friends.length instead (already
 * loaded, no extra round trip). */
export function useFriendsCount(targetId) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!targetId) { setCount(null); return undefined; }
    let cancelled = false;
    fetchFriendsCount(targetId)
      .then((c) => { if (!cancelled) setCount(c); })
      .catch(() => { if (!cancelled) setCount(null); });
    return () => { cancelled = true; };
  }, [targetId]);
  return count;
}

// --- Reactive cache, same module-level state + listener-set pattern as
// postsStore.js / notificationsStore.js -- plus loadedForUserId (the
// pattern profile.js's useMyProfile() already uses), which those two
// don't need: unlike the main feed or the bell, FriendButton/useFriends()
// is reachable from a page an ANONYMOUS visitor can land on
// (PublicProfile, /u/:username). Tracking which user (or `null`, for "no
// one") the cache was last loaded for means a visitor who signs in after
// landing there gets a real reload instead of being stuck on the empty
// anonymous result for the rest of the tab's life. ---
let state = { friends: [], incoming: [], outgoing: [], loading: false, error: null, loaded: false, loadedForUserId: undefined };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function load({ silent = false } = {}) {
  const userId = getCurrentUser()?.id ?? null;
  if (!silent) {
    state = { ...state, loading: true };
    notify();
  }
  try {
    const { friends, incoming, outgoing } = await fetchMyFriendships();
    state = { friends, incoming, outgoing, loading: false, error: null, loaded: true, loadedForUserId: userId };
  } catch (error) {
    // A failed background refresh keeps what's on screen instead of blanking it.
    state = silent
      ? { ...state, loading: false }
      : { friends: [], incoming: [], outgoing: [], loading: false, error, loaded: true, loadedForUserId: userId };
  }
  notify();
}

// --- Live updates. One channel per tab on `friendships` (migration 0018 puts
// it in the realtime publication). RLS means INSERT/UPDATE events only ever
// reach the two people in the row; DELETE events carry just the primary key
// and aren't filtered, so every event is treated purely as "reload" -- the
// reload itself is RLS-scoped and therefore always correct.
//
// "Your request was accepted" is detected by diffing: an id that was in
// `outgoing` before the reload and is in `friends` after it. ---
let liveFriendsUnsub = null;
let liveFriendsUserId = null;
async function refreshFromLive() {
  const waitingOn = new Map(state.outgoing.map((f) => [f.id, f]));
  await load({ silent: true });
  for (const f of state.friends) {
    if (!waitingOn.has(f.id)) continue;
    const name = f.otherName ?? translate(getLocale(), "feed.unknownAuthor");
    toast(translate(getLocale(), "friends.liveAccepted", { name }), "emerald");
  }
}
const refreshFromLiveDebounced = debounce(refreshFromLive, 250);

function subscribeToLiveFriendships(userId) {
  if (!userId || liveFriendsUserId === userId) return;
  if (liveFriendsUnsub) liveFriendsUnsub();
  liveFriendsUserId = userId;
  liveFriendsUnsub = watchTables(`friendships:${userId}`, [{ table: "friendships" }], refreshFromLiveDebounced, (status) => {
    // After a dropped connection comes back, anything that happened in the
    // gap is missed -- one silent reload closes it.
    if (status === "SUBSCRIBED" && state.loaded) load({ silent: true });
  });
}

/** Also called from notificationsStore.js when a live friend_request /
 * friend_accept notification arrives, so the Friends page and any open
 * FriendButton update without needing their own realtime subscription. */
export function invalidateFriends() {
  load();
}

export function useFriends() {
  const [, setTick] = useState(0);
  const { user, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    return () => listeners.delete(listener);
  }, []);

  // Separate from the effect above and keyed on session state: reload
  // whenever the signed-in user this cache was built for doesn't match
  // who's actually signed in now (including the anon-then-signed-in case
  // above) -- but only once session hydration has actually resolved one
  // way or the other, so this doesn't fire a premature "signed out" load
  // on an authenticated page during the brief hydration window.
  useEffect(() => {
    if (sessionLoading) return;
    if (!state.loading && state.loadedForUserId !== userId) load();
  }, [sessionLoading, userId]);

  useEffect(() => {
    if (userId) subscribeToLiveFriendships(userId);
  }, [userId]);

  return { friends: state.friends, incoming: state.incoming, outgoing: state.outgoing, loading: state.loading, error: state.error };
}

/** Derives a profile's friend-button status from the same loaded data
 * useFriends() already holds -- no separate fetch per button. */
export function useFriendStatus(targetUserId) {
  const { user } = useSession();
  const { friends, incoming, outgoing, loading } = useFriends();
  const myId = user?.id ?? null;

  // Distinct from "none" (signed in, no relationship yet) -- an anonymous
  // visitor (e.g. on a public /u/:username page) must never be shown an
  // "Add Friend" button that would just fail server-side when clicked.
  if (!myId) return { status: "signed_out", friendshipId: null, loading };
  if (!targetUserId) return { status: "none", friendshipId: null, loading };
  if (targetUserId === myId) return { status: "self", friendshipId: null, loading };

  const inFriends = friends.find((f) => f.otherId === targetUserId);
  if (inFriends) return { status: "friends", friendshipId: inFriends.id, loading };
  const inIncoming = incoming.find((f) => f.otherId === targetUserId);
  if (inIncoming) return { status: "pending_incoming", friendshipId: inIncoming.id, loading };
  const inOutgoing = outgoing.find((f) => f.otherId === targetUserId);
  if (inOutgoing) return { status: "pending_outgoing", friendshipId: inOutgoing.id, loading };
  return { status: "none", friendshipId: null, loading };
}
