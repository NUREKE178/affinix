// The pure parts of push (no browser objects), kept apart so they can be tested in plain Node.
/** base64url (what VAPID keys look like) -> the bytes PushManager.subscribe wants */
export function urlBase64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Pure part of pushStatus (so it can be tested): what the page may do, from what the browser reports. */
export function statusFrom({ capable, platform, standalone, permission, subscribed }) {
  // iPhone / iPad only deliver web push to a site added to the Home Screen
  if (!capable) return platform === "ios" && !standalone ? "install" : "unsupported";
  if (permission === "denied") return "denied";
  return permission === "granted" && subscribed ? "on" : "off";
}

