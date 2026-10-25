// Installing Affinix as an app from the browser (Chrome / Edge on Windows, Android; "Add to Home Screen" on iPhone).
// The browser announces that the site is installable with `beforeinstallprompt`; we keep that event and fire it from our own button.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
  }
}

export const canInstall = () => deferred !== null;
export const isStandalone = () =>
  typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
export function subscribeInstall(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Shows the browser's install dialog. Resolves to "accepted" | "dismissed" | "unavailable". */
export async function promptInstall() {
  if (!deferred) return "unavailable";
  const ev = deferred;
  deferred = null;
  notify();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome;
  } catch { return "unavailable"; }
}

/** Which device the visitor is on (to put the right download first). */
export function detectPlatform() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/linux|x11/i.test(ua) && !/cros/i.test(ua)) return "linux";
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/mac/i.test(ua)) return "mac";
  return "other";
}
