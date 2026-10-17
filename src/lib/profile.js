import { useState, useEffect } from "./preact.js";
import { useSession } from "./auth.js";
import { requireSupabase } from "./supabaseClient.js";
import { adoptProfileLocale } from "./i18n.js";
import { withPlatformRole, platformColumnMissing } from "./platformRole.js";

const PROFILE_COLUMNS =
  "id, full_name, avatar_url, locale, email, username, bio, role_title, country, timezone, research_interests, public_profile_enabled, notify_email_responses, notify_email_digest, is_admin";
// is_owner comes with migration 0025
const columns = () => withPlatformRole(PROFILE_COLUMNS).replace(", platform_role", ", is_owner");

let state = { profile: null, loading: true, loadedForUser: null, error: null };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function reload(userId) {
  state = { ...state, loading: true, error: null };
  notify();
  try {
    const sb = requireSupabase();
    let { data, error } = await sb.from("profiles").select(columns()).eq("id", userId).single();
    if (error && platformColumnMissing(error)) ({ data, error } = await sb.from("profiles").select(columns()).eq("id", userId).single());
    if (error) throw error;
    state = { profile: data, loading: false, loadedForUser: userId, error: null };
    if (data?.locale) adoptProfileLocale(data.locale);
  } catch (err) {
    // Surfacing the raw message (not swallowing it) matters here: the most
    // likely real-world cause is migration 0008 not yet applied to this
    // Supabase project, which fails as "column profiles.username does not
    // exist" -- a silent catch made this indistinguishable from "still
    // loading" and the profile page hung on a loading spinner forever.
    state = { profile: null, loading: false, loadedForUser: userId, error: err?.message ?? String(err) };
  }
  notify();
}

export function invalidateProfile() {
  if (state.loadedForUser) reload(state.loadedForUser);
}

/** { profile, loading, error } for the signed-in user's own profile row. */
export function useMyProfile() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a change resolved just before this subscribed
    if (userId && state.loadedForUser !== userId) reload(userId);
    return () => listeners.delete(listener);
  }, [userId]);

  return { profile: userId ? state.profile : null, loading: userId ? state.loading : false, error: userId ? state.error : null };
}

export async function updateMyProfile(fields) {
  const sb = requireSupabase();
  const userId = state.loadedForUser;
  const { data, error } = await sb.from("profiles").update(fields).eq("id", userId).select(PROFILE_COLUMNS).single();
  if (error) {
    if (error.code === "23505") throw new Error("Это имя пользователя уже занято.");
    if (error.code === "23514") throw new Error("Имя пользователя: 3-30 символов, только латиница в нижнем регистре, цифры и подчёркивание.");
    throw error;
  }
  state = { ...state, profile: data };
  notify();
  return data;
}

const AVATAR_BUCKET = "avatars";
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_MAX_BYTES = 3 * 1024 * 1024; // 3MB

export async function uploadAvatar(file) {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error("Недопустимый тип файла. Разрешены: JPEG, PNG, WEBP.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Файл слишком большой (максимум 3 МБ).");
  const sb = requireSupabase();
  const userId = state.loadedForUser;
  const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "jpg").toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(AVATAR_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const previous = state.profile?.avatar_url;
  const updated = await updateMyProfile({ avatar_url: data.publicUrl });
  if (previous) {
    const marker = `/object/public/${AVATAR_BUCKET}/`;
    const idx = previous.indexOf(marker);
    if (idx !== -1) await sb.storage.from(AVATAR_BUCKET).remove([previous.slice(idx + marker.length)]);
  }
  return updated;
}

/** Real counts for the "Создано экспериментов" / "Завершивших участников"
 * profile stats -- never fabricated, computed from the same tables the rest
 * of the app reads. */
export async function fetchMyProfileStats(userId) {
  const sb = requireSupabase();
  const { count: experimentCount } = await sb
    .from("experiments")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);

  const { data: myExperiments } = await sb.from("experiments").select("id").eq("created_by", userId);
  const ids = (myExperiments ?? []).map((e) => e.id);
  let completedParticipants = 0;
  if (ids.length) {
    const { count } = await sb
      .from("participant_sessions")
      .select("id", { count: "exact", head: true })
      .in("experiment_id", ids)
      .eq("status", "completed");
    completedParticipants = count ?? 0;
  }
  return { experimentCount: experimentCount ?? 0, completedParticipants };
}

/** Public, opt-in researcher profile via the get_public_profile() RPC
 * (0008 migration) -- returns null if the username doesn't exist or hasn't
 * enabled a public profile. No auth required; safe to call from /u/:username. */
export async function fetchPublicProfile(username) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("get_public_profile", { p_username: username });
  if (error) throw error;
  return data?.[0] ?? null;
}

export function usernameAvailableLocally(username) {
  return /^[a-z0-9_]{3,30}$/.test(username);
}
