// Push notifications on this device: a chat message reaches the lock screen even when Affinix is closed.
//   pushStatus()    "unsupported" | "install" (iPhone: only works from the Home Screen app) | "denied" | "off" | "on"
//   enablePush()    must run from a tap (the browser only asks for permission after a gesture): asks, subscribes, saves the device
//   disablePush()   unsubscribes and forgets the device
//   resyncPush()    on sign-in, if this device already said yes: saves it for the current account (a shared phone moves to whoever is signed in)
// The server half is supabase/functions/notify-message (it holds the VAPID keys; we ask it for the public one).
import { requireSupabase } from "./supabaseClient.js";
import { isStandalone, detectPlatform } from "./pwaInstall.js";
import { statusFrom } from "./pushUtil.js";

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
export { statusFrom, urlBase64ToBytes } from "./pushUtil.js";
import { urlBase64ToBytes } from "./pushUtil.js";
export function subscribePushState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function pushCapable() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

let cachedSub = null;
export async function pushStatus() {
  const capable = pushCapable();
  let subscribed = false;
  if (capable) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      cachedSub = (await reg?.pushManager.getSubscription()) ?? null;
      subscribed = !!cachedSub;
    } catch { /* not registered yet */ }
  }
  return statusFrom({ capable, platform: detectPlatform(), standalone: isStandalone(), permission: capable ? Notification.permission : "default", subscribed });
}

async function serverKey() {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke("notify-message", { body: { action: "key" } });
  if (error) {
    // say WHY: 503 = the function has no VAPID secrets, 404 = it is not deployed under this name, anything else = the code in the message
    const status = error.context?.status;
    throw new Error(status === 503 ? "push_not_configured" : status === 404 ? "push_no_function" : `push_http_${status ?? "network"}`);
  }
  if (!data?.publicKey) throw new Error("push_not_configured");
  return data.publicKey;
}

async function save(sub) {
  const json = sub.toJSON();
  const { error } = await requireSupabase().rpc("push_subscribe", {
    p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Resolves "on" or throws an Error whose message is: unsupported | denied | push_not_configured | (anything else = failed) */
export async function enablePush() {
  if (!pushCapable()) throw new Error("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") { emit(); throw new Error("denied"); }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(await serverKey()) });
  await save(sub);
  emit();
  return "on";
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await requireSupabase().rpc("push_unsubscribe", { p_endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } finally { emit(); }
}

/** Quietly re-saves this device for the signed-in person (no prompt, no error shown). */
export async function resyncPush() {
  try {
    if (!pushCapable() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch { /* the toggle in the profile shows the real state */ }
}

/** Tells the server a message was saved, so it can push it to the other person. Never blocks or fails the send. */
export function notifyMessage(messageId) {
  try {
    requireSupabase().functions.invoke("notify-message", { body: { message_id: messageId } }).catch(() => {});
  } catch { /* no backend (tests) */ }
}
