// The phone's bottom tab bar (below md): the places people use all day are one thumb-tap away, instead of opening the drawer first.
//   Arena | Feed | Messages | Marketing | More (opens the drawer with everything else)
// A single tinted pill glides under the active icon (lib/thumb.js, the same sliding key as every other segmented control), counts sit on
// the icons, and the bar steps out of the way where it would only be in the way: while a field is focused (the keyboard is up) and inside an
// open chat. Re-tapping the current tab scrolls to the top, like a native app.
import { html, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { useT, useLocale } from "../lib/i18n.js";
import { useThumb } from "../lib/thumb.js";
import { useFriends } from "../lib/friendsStore.js";
import { useConversations } from "../lib/messagesStore.js";
import { useArenaLocal, arenaAttention } from "../lib/arenaStore.js";

const TABS = [
  { id: "arena", labelKey: "shell.community.arena", icon: "arena", path: "/app/arena" },
  { id: "feed", labelKey: "shell.community.feed", icon: "globe", path: "/app/feed" },
  { id: "messages", labelKey: "shell.community.messages", icon: "chat", path: "/app/messages" },
  { id: "marketers", labelKey: "shell.tabbar.marketers", icon: "overview", path: "/app/styles",
    also: ["/app/overview", "/app/experiments", "/app/results", "/app/participants", "/app/reports"] },
];

const matches = (tab, path) => [tab.path, ...(tab.also ?? [])].some((p) => path === p || path.startsWith(p + "/"));

/** `data-kb` on <html> while a text field has focus: styles.css slides the bar away so it never sits on top of the keyboard. */
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

export function MobileTabBar({ currentPath, onNavigate, onMore }) {
  const t = useT();
  const locale = useLocale();
  const { incoming } = useFriends();
  const { unreadTotal } = useConversations();
  const arena = useArenaLocal();
  const host = useRef(null);
  const thumb = useRef(null);
  useKeyboardFlag();

  const current = TABS.find((tab) => matches(tab, currentPath))?.id ?? "more";
  useThumb(host, thumb, current, locale);
  const badge = (id) => (id === "messages" ? unreadTotal : id === "arena" ? arenaAttention(arena.view) : id === "more" ? incoming.length : 0);

  const tap = (tab) => {
    if (current === tab.id) window.scrollTo({ top: 0, behavior: "instant" });
    else onNavigate(tab.path);
  };
  const item = (id, icon, label, onClick) => {
    const n = badge(id);
    const on = current === id;
    return html`
      <button type="button" class="mtb-item" onClick=${onClick} aria-current=${on ? "page" : undefined} aria-label=${n > 0 ? `${label}, ${n}` : label} data-testid=${`mtb-${id}`}>
        <span class="mtb-pill" data-active=${on}>
          <${Icon} name=${icon} size=${22} filled=${false} />
          ${n > 0 && html`<span class="mtb-badge" aria-hidden="true">${n > 99 ? "99+" : n}</span>`}
        </span>
        <span class="mtb-label" data-on=${on}>${label}</span>
      </button>
    `;
  };

  return html`
    <nav class="mtb md:hidden" aria-label=${t("shell.tabbar.label")} data-testid="mobile-tabbar">
      <div class="mtb-in sk-thumbhost" ref=${host}>
        <span class="sk-thumb mtb-thumb" ref=${thumb} aria-hidden="true"></span>
        ${TABS.map((tab) => item(tab.id, tab.icon, t(tab.labelKey), () => tap(tab)))}
        ${item("more", "menu", t("shell.tabbar.more"), onMore)}
      </div>
    </nav>
  `;
}
