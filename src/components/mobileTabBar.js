// The phone's bottom dock (below md): the places people use all day are one thumb-tap away, instead of opening the drawer first.
//   Arena | Feed | Messages | Marketing | More (opens the drawer with everything else)
// What makes it feel like an app and not a web menu:
//  * a floating glass dock with safe-area spacing; ONE tinted pill glides under the active icon (lib/thumb.js, the same key as every other control)
//  * every icon is drawn the same way (the app's duotone set at one size); the active one only changes colour and springs in; counts sit on the icons and pop when they change
//  * scrub: put a finger on the dock and slide across it -- the icon under the finger rises, lifting the finger opens it (with a tick of haptics)
//  * it gets out of the way: slides down when you scroll down (more room to read), returns on the slightest scroll up, at the top and at the end of the page;
//    it also leaves while a field is focused (keyboard up) and inside an open chat
//  * re-tapping the current tab scrolls to the top, like a native app
import { html, useEffect, useRef, useState } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { useT, useLocale } from "../lib/i18n.js";
import { useThumb } from "../lib/thumb.js";
import { useFriends } from "../lib/friendsStore.js";
import { useConversations } from "../lib/messagesStore.js";
import { useArenaLocal, arenaAttention } from "../lib/arenaStore.js";
import { tabsJustChanged } from "../lib/swipeTabs.js";

const TABS = [
  { id: "arena", labelKey: "shell.community.arena", icon: "arena", path: "/app/arena" },
  { id: "feed", labelKey: "shell.community.feed", icon: "globe", path: "/app/feed" },
  { id: "messages", labelKey: "shell.tabbar.messages", icon: "chat", path: "/app/messages" },
  { id: "marketers", labelKey: "shell.tabbar.marketers", icon: "overview", path: "/app/styles",
    also: ["/app/overview", "/app/experiments", "/app/results", "/app/participants", "/app/reports"] },
];

// NOTE: the sliding pill is measured with getBoundingClientRect(), which includes transforms. So nothing that moves or scales (press, raise, spring) may sit on
// .mtb-pill itself -- those effects live on the inner .mtb-ico, or the pill would be measured mid-effect and land bigger and higher than it is.
const matches = (tab, path) => [tab.path, ...(tab.also ?? [])].some((p) => path === p || path.startsWith(p + "/"));
const tick = (ms = 7) => { try { navigator.vibrate?.(ms); } catch { /* no haptics here */ } };

/** `data-kb` on <html> while a text field has focus: shell.css slides the dock away so it never sits on top of the keyboard. */
function useKeyboardFlag() {
  useEffect(() => {
    const isField = (el) => !!el?.closest?.("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]),textarea,select,[contenteditable=true]");
    let timer = 0;
    const set = (on) => { clearTimeout(timer); timer = setTimeout(() => { if (on) document.documentElement.dataset.kb = "1"; else delete document.documentElement.dataset.kb; }, on ? 0 : 80); };
    const onIn = (e) => { if (isField(e.target)) set(true); };
    const onOut = () => set(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { clearTimeout(timer); document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); delete document.documentElement.dataset.kb; };
  }, []);
}

/** `data-mtb-hide` on <html> while the person is reading downwards. Passive listener, one rAF per burst, no layout reads while scrolling down. */
function useHideOnScroll() {
  useEffect(() => {
    let last = window.scrollY, raf = 0, hidden = false, acc = 0, retry = 0;
    const apply = (h) => { if (h === hidden) return; hidden = h; if (h) document.documentElement.dataset.mtbHide = "1"; else delete document.documentElement.dataset.mtbHide; };
    const frame = () => {
      raf = 0;
      const y = Math.max(0, window.scrollY), d = y - last; last = y;
      // switching a tab swaps the content under the dock: its height / scroll jump are not reading, so the dock stays put -- and is re-checked once the swap is over
      if (tabsJustChanged()) { acc = 0; clearTimeout(retry); retry = setTimeout(onScroll, 1300); return; }
      if (y < 48) { acc = 0; apply(false); return; }
      acc = Math.sign(d) === Math.sign(acc) ? acc + d : d; // distance travelled in the current direction
      if (acc > 14) apply(true);
      else if (acc < -6) apply(false);
      else if (hidden && document.documentElement.scrollHeight - innerHeight - y < 64) apply(false); // the end of the page: nothing left to read
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); clearTimeout(retry); delete document.documentElement.dataset.mtbHide; };
  }, []);
}

export function MobileTabBar({ currentPath, onNavigate, onMore }) {
  const t = useT();
  const locale = useLocale();
  const { incoming } = useFriends();
  const { unreadTotal } = useConversations();
  const arena = useArenaLocal();
  const host = useRef(null);
  const thumb = useRef(null);
  const [hot, setHot] = useState(null); // the icon under a sliding finger
  useKeyboardFlag();
  useHideOnScroll();

  const current = TABS.find((tab) => matches(tab, currentPath))?.id ?? "more";
  useThumb(host, thumb, current, locale);
  // a new page starts with the dock in view
  // (but a page's own tabs may be routes too: a tab change is not a new page, the dock keeps whatever state it has)
  useEffect(() => { if (!tabsJustChanged()) delete document.documentElement.dataset.mtbHide; }, [currentPath]);
  const badge = (id) => (id === "messages" ? unreadTotal : id === "arena" ? arenaAttention(arena.view) : id === "more" ? incoming.length : 0);

  const activate = (id) => {
    if (id === "more") { onMore(); return; }
    const tab = TABS.find((x) => x.id === id);
    if (!tab) return;
    if (current === id) window.scrollTo({ top: 0, behavior: "instant" });
    else onNavigate(tab.path);
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  // scrub: slide a finger across the dock; the icon under it rises, lifting the finger opens it
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    let start = null, over = null, moved = false;
    const itemAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(".mtb-item")?.dataset.id ?? null;
    const onStart = (e) => {
      const t0 = e.touches[0];
      start = itemAt(t0.clientX, t0.clientY); over = start; moved = false;
      if (start) { setHot(start); tick(5); }
    };
    const onMove = (e) => {
      if (!start) return;
      const t0 = e.touches[0];
      const id = itemAt(t0.clientX, t0.clientY);
      if (id !== over) { over = id; moved = moved || id !== start; setHot(id); if (id) tick(6); }
    };
    const end = (e, cancelled) => {
      const id = over, wasMoved = moved && id && id !== start;
      start = over = null; moved = false; setHot(null);
      if (wasMoved && !cancelled) { e.preventDefault(); activateRef.current(id); } // the browser's own click would hit the item the finger started on
    };
    const onEnd = (e) => end(e, false);
    const onCancel = (e) => end(e, true);
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove); el.removeEventListener("touchend", onEnd); el.removeEventListener("touchcancel", onCancel); };
  }, []);

  const item = (id, icon, label) => {
    const n = badge(id);
    const on = current === id;
    return html`
      <button type="button" class="mtb-item" data-id=${id} data-hot=${hot === id ? "true" : undefined} onClick=${() => activate(id)}
        aria-current=${on ? "page" : undefined} aria-label=${n > 0 ? `${label}, ${n}` : label} data-testid=${`mtb-${id}`}>
        <span class="mtb-pill" data-active=${on}>
          <span class="mtb-ico">
            <${Icon} name=${icon} size=${22} />
            ${n > 0 && html`<span class="mtb-badge" key=${n} aria-hidden="true">${n > 99 ? "99+" : n}</span>`}
          </span>
        </span>
        <span class="mtb-label" data-on=${on}>${label}</span>
      </button>
    `;
  };

  return html`
    <nav class="mtb md:hidden" aria-label=${t("shell.tabbar.label")} data-testid="mobile-tabbar">
      <div class="mtb-in sk-thumbhost" ref=${host}>
        <span class="sk-thumb mtb-thumb" ref=${thumb} aria-hidden="true"></span>
        ${TABS.map((tab) => item(tab.id, tab.icon, t(tab.labelKey)))}
        ${item("more", "more", t("shell.tabbar.more"))}
      </div>
    </nav>
  `;
}
