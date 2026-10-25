// Warms up the parts of the app a visitor is likely to open next, so that the first tap on "Sign in" / a tab does not wait for the network.
//  * landing page: nothing is fetched on its own (the page is being scrolled and animated; downloads and parsing would show up as jank);
//    the app is fetched the moment a finger / pointer gets close to a button that leads into it
//  * everywhere else: one module per idle slice, in the order people usually open them
// Skipped on Save-Data and on slow (2g) connections.
const APP = [
  () => import("../components/shell.js"),
  () => import("../pages/Arena.js"),
  () => import("../pages/auth/Login.js"),
  () => import("../pages/Feed.js"),
  () => import("../pages/Overview.js"),
  () => import("../pages/Styles.js"),
  () => import("../pages/Messages.js"),
  () => import("../pages/Friends.js"),
  () => import("../pages/Profile.js"),
  () => import("../pages/Settings.js"),
];

const AUTH = [
  () => import("../pages/auth/Login.js"),
  () => import("../pages/auth/Register.js"),
  () => import("../components/shell.js"),
  () => import("../pages/Arena.js"),
];

const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 600));

function allowed() {
  const c = navigator.connection;
  return !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")));
}

function run(list) {
  let i = 0;
  const next = () => {
    if (i >= list.length) return;
    list[i++]().catch(() => { /* offline or a failed fetch: the page loads it when it is really opened */ }).finally(() => idle(next));
  };
  idle(next);
}

let started = false;
function once(list) {
  if (started || !allowed()) return;
  started = true;
  run(list);
}

export function startIdlePreload() {
  if (typeof document === "undefined") return;
  const onLanding = () => { const h = location.hash.replace(/^#/, ""); return h === "" || h === "/"; };
  if (!onLanding()) { if (document.readyState === "complete") once(APP); else addEventListener("load", () => once(APP), { once: true }); }
  // the way into the app from the landing page (or a later route change onto an app page)
  const warm = (e) => {
    if (started) return;
    const a = e.target?.closest?.("a[href*='#/login'],a[href*='#/register'],a[href*='#/app'],a[href*='#/download']");
    if (a) once(AUTH);
  };
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("touchstart", warm, { passive: true });
  addEventListener("hashchange", () => { if (!onLanding()) once(APP); });
}
