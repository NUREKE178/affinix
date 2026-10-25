import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { navigate, HOME_PATH } from "../router.js";
import { Icon, LogoMark } from "./icons.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { useSession, signOut } from "../lib/auth.js";
import { useMyProfile, updateMyProfile } from "../lib/profile.js";
import { useThumb } from "../lib/thumb.js";
import { tabsJustChanged } from "../lib/swipeTabs.js";
import { LanguageSwitch } from "./languageSwitch.js";
export { LanguageSwitch }; // (it used to live here: old imports keep working)
import { useT, useLocale, setLocale, LOCALES, useLocaleFadeClass } from "../lib/i18n.js";
import { useNotifications, markAllNotificationsRead, notificationCopyKey, notificationTargetPath } from "../lib/notificationsStore.js";
import { useFriends } from "../lib/friendsStore.js";
import { useMessagingBootstrap, useConversations } from "../lib/messagesStore.js";
import { useArenaLocal, arenaAttention } from "../lib/arenaStore.js";
import { relativeDate } from "../lib/format.js";
import { toast, Badge, LoadingBar, Skeleton } from "./ui.js";
import { useMountTransition } from "../lib/motion.js";
import { ProfileViewerHost } from "./profileViewer.js";
import { openProfile } from "../lib/profileViewer.js";
import { GlobalSearch, SearchSheetButton } from "./globalSearch.js";
import { MobileTabBar } from "./mobileTabBar.js";

// Two work areas. The Arena is the home of the app (first item; see HOME_PATH). "Research" holds everything about
// experiments and crowd tests: its overview, participants and reports are tabs of that one area (`also` keeps the
// sidebar item lit on them). Insights were removed; the rule-based interpretation lives inside the report.
const NAV = [
  { id: "arena", key: "shell.community.arena", icon: "arena", path: "/app/arena" },
  { id: "marketers", key: "shell.nav.marketers", icon: "overview", path: "/app/styles",
    also: ["/app/overview", "/app/experiments", "/app/results", "/app/participants", "/app/reports"] },
];

const COMMUNITY_NAV = [
  { id: "feed", key: "shell.community.feed", icon: "globe", path: "/app/feed" },
  { id: "favorites", key: "shell.community.favorites", icon: "bookmark", path: "/app/favorites" },
  { id: "friends", key: "shell.community.friends", icon: "friends", path: "/app/friends" },
  { id: "messages", key: "shell.community.messages", icon: "chat", path: "/app/messages" },
];

// Team and billing are tabs of Settings (the organisation's own page), not sidebar items.
// only platform admins (and the owner) see this one
const ADMIN_NAV_ITEM = { id: "admin", key: "shell.workspace.admin", icon: "shield", path: "/app/admin" };

const WORKSPACE_NAV = [
  { id: "profile", key: "shell.workspace.profile", icon: "user", path: "/profile" },
  { id: "settings", key: "shell.workspace.settings", icon: "settings", path: "/app/settings", also: ["/app/team", "/app/billing"] },
  { id: "download", key: "shell.workspace.download", icon: "arrowDown", path: "/app/download" },
];

function initialsFor(nameOrEmail) {
  if (!nameOrEmail) return "?";
  const parts = nameOrEmail.split(/[\s@._]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

function Avatar({ name, url, size = 32 }) {
  if (url) {
    return html`<img src=${url} class="rounded-full object-cover shrink-0" style=${{ width: `${size}px`, height: `${size}px` }} />`;
  }
  return html`
    <div class="sk-avatar flex items-center justify-center rounded-full font-semibold shrink-0"
      style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, size * 0.38)}px` }}>
      ${name ? initialsFor(name) : html`<${Icon} name="user" size=${Math.round(size * 0.55)} />`}
    </div>
  `;
}

/** Click-outside dropdown wrapper -- closes on outside click or Escape.
 * Always opens upward: every trigger that uses it (UserMenu, the
 * sidebar-mode picker) lives in the sidebar's bottom footer, where there's
 * room above but not below. */
function Dropdown({ open, onClose, align = "left", children }) {
  const ref = useRef(null);
  const { mounted, phase } = useMountTransition(open);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!mounted) return null;
  return html`
    <div
      ref=${ref}
      data-state=${phase}
      style=${`transform-origin: bottom ${align === "right" ? "right" : "left"}`}
      class=${`sk-modal sk-overlay-anim absolute ${align === "right" ? "right-0" : "left-0"} bottom-full mb-2 z-40 w-56 rounded-xl py-1.5`}
    >
      ${children}
    </div>
  `;
}

function MenuItem({ icon, label, onClick, danger = false }) {
  return html`
    <button onClick=${onClick}
      class=${`flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors ${danger ? "text-rose-400 hover:bg-rose-500/10" : "text-graphite-300 hover:bg-white/5"}`}>
      <${Icon} name=${icon} size=${15} /> ${label}
    </button>
  `;
}

function UserMenu({ onNavigate, collapsed = false, sidebarMode, onChangeSidebarMode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { org } = useCurrentOrg();
  const { user } = useSession();
  const { profile } = useMyProfile();
  const displayName = profile?.full_name || user?.email || user?.phone || "";

  return html`
    <div class="relative sk-rail-gutter">
      <button onClick=${() => setOpen((v) => !v)} title=${collapsed ? displayName : undefined}
        class="sk-nav-item sk-user flex w-full items-center overflow-hidden" data-active="false">
        <div class="relative shrink-0">
          <${Avatar} name=${displayName} url=${profile?.avatar_url} />
          <span class="sk-led absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-graphite-900" style="--led:#34d399;--led-glow:rgba(52,211,153,.6)"></span>
        </div>
        <div class="sk-fade min-w-0 flex-1 text-left">
          <div class="text-sm font-medium text-graphite-100 truncate">${displayName || html`<${Skeleton} className="h-4 w-24" />`}</div>
          <div class="text-[11px] text-graphite-500 truncate">${org?.name ?? ""}</div>
        </div>
        <${Icon} name="chevronDown" size=${14} className="sk-fade text-graphite-500 shrink-0" />
      </button>
      <${Dropdown} open=${open} onClose=${() => setOpen(false)}>
        <${MenuItem} icon="user" label=${t("shell.userMenu.profile")} onClick=${() => { setOpen(false); onNavigate("/profile"); }} />
        <${MenuItem} icon="settings" label=${t("shell.userMenu.settings")} onClick=${() => { setOpen(false); onNavigate("/app/settings"); }} />
        ${onChangeSidebarMode && html`
          <div class="my-1 border-t border-graphite-800"></div>
          <div class="sk-caption px-3.5 pt-2 pb-1">${t("shell.sidebar.label")}</div>
          ${SIDEBAR_MODES.map((m) => html`
            <button key=${m.id} type="button" onClick=${() => { onChangeSidebarMode(m.id); setOpen(false); }}
              class="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left text-graphite-300 hover:bg-white/5 transition-colors">
              <span class="sk-led shrink-0" style=${sidebarMode === m.id ? "--led:#ff6a1f;--led-glow:rgba(255,106,31,.65)" : "--led:#2f3137"}></span>
              ${t(m.key)}
            </button>
          `)}
        `}
        <div class="my-1 border-t border-graphite-800"></div>
        <${MenuItem} icon="logout" label=${t("shell.userMenu.logout")} danger onClick=${async () => { setOpen(false); await signOut(); navigate("/"); }} />
      <//>
    </div>
  `;
}

function NavItem({ item, currentPath, onNavigate, t, collapsed, badgeCount = 0 }) {
  const active = [item.path, ...(item.also ?? [])].some((p) => currentPath === p || currentPath.startsWith(p + "/"));
  return html`
    <button
      onClick=${() => onNavigate(item.path)}
      data-active=${active}
      title=${collapsed ? t(item.key) : undefined}
      aria-current=${active ? "page" : undefined}
      class="sk-nav-item relative flex w-full items-center overflow-hidden whitespace-nowrap text-sm font-medium"
    >
      <span class=${`relative shrink-0 ${active ? "text-signal-400" : ""}`}>
        <${Icon} name=${item.icon} size=${19} />
        <span class="sk-nav-dot" data-on=${badgeCount > 0}></span>
      </span>
      <span class="sk-fade flex-1 text-left">${t(item.key)}</span>
      ${badgeCount > 0 && html`<span class="sk-fade sk-count">${badgeCount}</span>`}
    </button>
  `;
}

/** Desktop/tablet only -- the mobile drawer always renders expanded
 * (collapsing a temporary overlay you're about to close doesn't help). */
const SIDEBAR_MODES = [
  { id: "expanded", key: "shell.sidebar.expanded" },
  { id: "collapsed", key: "shell.sidebar.collapsed" },
  { id: "hover", key: "shell.sidebar.hover" },
];

/** The key at the foot of the sidebar: collapses the rail, expands it again, or (in "expand on hover"
 * mode) pins it open. All three modes stay reachable from the user menu. `[` does the same from the keyboard. */
function CollapseKey({ mode, collapsed, onToggle }) {
  const t = useT();
  const label = collapsed ? t("shell.sidebar.expand") : mode === "hover" ? t("shell.sidebar.pin") : t("shell.sidebar.collapse");
  return html`
    <button type="button" onClick=${onToggle} class="sk-collapse" data-rail=${collapsed ? "true" : "false"}
      title=${collapsed ? `${label}  [` : undefined} aria-label=${label} aria-keyshortcuts="[">
      <${Icon} name=${collapsed ? "chevronsRight" : "chevronsLeft"} size=${16} className="shrink-0" />
      <span class="sk-fade whitespace-nowrap">${label}</span><span class="sk-fade sk-kbd" aria-hidden="true">[</span>
    </button>
  `;
}

function SidebarContent({ currentPath, onNavigate, collapsed = false, sidebarMode, onChangeSidebarMode, onToggleSidebar }) {
  const t = useT();
  const { org } = useCurrentOrg();
  const { profile } = useMyProfile();
  const workspaceNav = profile?.is_admin ? [ADMIN_NAV_ITEM, ...WORKSPACE_NAV] : WORKSPACE_NAV;
  const { incoming } = useFriends();
  const { unreadTotal } = useConversations();
  const arena = useArenaLocal();
  const navHost = useRef(null);
  const navThumb = useRef(null);
  const activeNavId = [...NAV, ...COMMUNITY_NAV, ...workspaceNav].find((item) => [item.path, ...(item.also ?? [])].some((p) => currentPath === p || currentPath.startsWith(p + "/")))?.id ?? "";
  useThumb(navHost, navThumb, activeNavId, collapsed ? "rail" : "open");
  const navBadge = (id) => (id === "friends" ? incoming.length : id === "messages" ? unreadTotal : id === "arena" ? arenaAttention(arena.view) : 0);
  return html`
    <div class="sk-rail flex h-full flex-col" data-collapsed=${collapsed}>
      <button type="button" onClick=${() => onNavigate(HOME_PATH)} class="sk-brand">
        <${LogoMark} size=${34} />
        <div class="sk-fade min-w-0">
          <div class="font-semibold text-graphite-50 leading-tight tracking-tight whitespace-nowrap">affinix<span class="text-graphite-500">.space</span></div>
          <div class="text-[11px] text-graphite-500 leading-tight truncate max-w-[9rem]">${org?.name ?? html`<${Skeleton} className="mt-1 h-3 w-20" />`}</div>
        </div>
      </button>

      <nav class="sk-rail-gutter sk-thumbhost flex-1 overflow-y-auto overflow-x-hidden py-1 space-y-0.5" ref=${navHost}>
        <span class="sk-thumb sk-nav-thumb" ref=${navThumb} aria-hidden="true"></span>
        ${NAV.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} badgeCount=${navBadge(item.id)} />`)}

        <div class="sk-rail-caption"><span class="sk-caption sk-fade">${t("shell.communityLabel")}</span></div>
        ${COMMUNITY_NAV.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} badgeCount=${navBadge(item.id)} />`)}

        <div class="sk-rail-caption"><span class="sk-caption sk-fade">${t("shell.workspaceLabel")}</span></div>
        ${workspaceNav.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} />`)}
      </nav>

      <div class="border-t border-graphite-800 py-3 space-y-2">
        ${onToggleSidebar && html`
          <div class="sk-rail-gutter">
            <${CollapseKey} mode=${sidebarMode} collapsed=${collapsed} onToggle=${onToggleSidebar} />
          </div>
        `}
        <${UserMenu} onNavigate=${onNavigate} collapsed=${collapsed} sidebarMode=${sidebarMode} onChangeSidebarMode=${onChangeSidebarMode} />
      </div>
    </div>
  `;
}

/** Opening the dropdown marks everything read immediately (same convention
 * as most bell menus) rather than requiring a click per item -- there's no
 * per-notification detail view to click through to, just the feed itself,
 * so per-item read-tracking after that point would have no UI to attach
 * to anyway. The per-item dot still reflects whatever was unread at the
 * moment this list was fetched, so it briefly shows what's new even as
 * the mark-read request resolves in the background. */
function NotificationsMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ringing, setRinging] = useState(false);
  const ref = useRef(null);
  const { notifications, loading, unreadCount, ringSeq } = useNotifications();
  const seenRingSeq = useRef(ringSeq);
  const { mounted: menuMounted, phase: menuPhase } = useMountTransition(open);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Replays the ring on every live arrival after this mounted -- ringSeq
  // starts equal to seenRingSeq.current on mount (no spurious ring just
  // from loading whatever notifications already existed), and each
  // increase past that re-triggers it for exactly one animation cycle.
  useEffect(() => {
    if (ringSeq === seenRingSeq.current) return;
    seenRingSeq.current = ringSeq;
    setRinging(true);
    const timer = setTimeout(() => setRinging(false), 650);
    return () => clearTimeout(timer);
  }, [ringSeq]);

  function onToggle() {
    const opening = !open;
    setOpen(opening);
    if (opening && unreadCount > 0) markAllNotificationsRead();
  }

  function onItemClick(n) {
    setOpen(false);
    navigate(notificationTargetPath(n.type));
  }

  return html`
    <div class="relative" ref=${ref}>
      <button class="sk-btn relative h-8 w-8 rounded-lg text-graphite-400 hover:text-graphite-200" onClick=${onToggle} aria-label=${t("shell.notifications.title")}>
        <${Icon} name="bell" size=${17} className=${ringing ? "sk-bell-ring" : ""} />
        ${unreadCount > 0 && html`<span class="sk-led absolute top-1 right-1 h-2 w-2" style="--led:#ff6a1f;--led-glow:rgba(255,106,31,.7)"></span>`}
      </button>
      ${menuMounted && html`
        <div data-state=${menuPhase} style="transform-origin: top right" class="sk-modal sk-overlay-anim sk-overlay-anim-down fixed right-4 top-[69px] sm:absolute sm:right-0 sm:top-full sm:mt-2 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-xl">
          <div class="px-4 py-3 border-b border-graphite-800 text-sm font-medium text-graphite-200">${t("shell.notifications.title")}</div>
          ${loading && html`<div class="px-4 py-8 text-center text-sm text-graphite-500">${t("common.loading")}</div>`}
          ${!loading && notifications.length === 0 && html`<div class="px-4 py-8 text-center text-sm text-graphite-500">${t("shell.notifications.empty")}</div>`}
          ${!loading && notifications.length > 0 && html`
            <div class="max-h-80 overflow-y-auto py-1">
              ${notifications.map((n) => html`
                <div key=${n.id} class="flex w-full items-start gap-2.5 px-4 py-2.5 hover:bg-white/5 transition-colors">
                  ${n.actorId
                    ? html`
                      <button type="button" class="sk-person shrink-0" data-testid="notification-actor"
                        title=${t("people.openProfile", { name: n.actorName ?? t("feed.unknownAuthor") })}
                        onClick=${() => { setOpen(false); openProfile({ id: n.actorId, name: n.actorName, avatarUrl: n.actorAvatarUrl }); }}>
                        <${Avatar} name=${n.actorName} url=${n.actorAvatarUrl} size=${28} />
                      </button>`
                    : html`<${Avatar} name=${n.actorName} url=${n.actorAvatarUrl} size=${28} />`}
                  <button type="button" onClick=${() => onItemClick(n)} class="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                    <div class="min-w-0 flex-1">
                      <div class="text-xs text-graphite-300 leading-snug">${t(notificationCopyKey(n.type), { name: n.actorName ?? t("feed.unknownAuthor") })}</div>
                      ${n.type === "comment" && n.commentBody && html`<div class="text-xs text-graphite-500 truncate mt-0.5">«${n.commentBody}»</div>`}
                      <div class="text-[11px] text-graphite-500 mt-0.5">${relativeDate(n.createdAt)}</div>
                    </div>
                    ${!n.isRead && html`<span class="sk-led mt-1.5 shrink-0" style="--led:#ff6a1f;--led-glow:rgba(255,106,31,.65)"></span>`}
                  </button>
                </div>
              `)}
            </div>
          `}
        </div>
      `}
    </div>
  `;
}


const SIDEBAR_MODE_KEY = "decisionos_sidebar_mode";
const SIDEBAR_MODE_IDS = SIDEBAR_MODES.map((m) => m.id);

export function Shell({ currentPath, children }) {
  const t = useT();
  // Opens the live message/presence connections for the whole signed-in session.
  useMessagingBootstrap();
  const { user } = useSession();
  const { profile } = useMyProfile();
  const displayName = profile?.full_name || user?.email || user?.phone || "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_MODE_KEY);
      return SIDEBAR_MODE_IDS.includes(saved) ? saved : "expanded";
    } catch { return "expanded"; }
  });
  // "hover" mode sits collapsed at rest and only grows while the pointer is
  // over it -- that growth is a transient visual state, never persisted.
  const [hoverPeek, setHoverPeek] = useState(false);
  const { mounted: drawerMounted, phase: drawerPhase } = useMountTransition(mobileOpen);
  // A brief dip-and-recover across the whole shell whenever the language
  // actually changes, so every translated label on screen (sidebar, header,
  // page content) reads as transitioning together instead of flickering.
  const localeFadeClass = useLocaleFadeClass();
  // The entrance (fade + rise) is for moving to another page; changing the tab of the page you are on (Arena: Game / Quests / Rating / Profile) must not move anything.
  // Decided once per path, so the class does not flip on a later re-render and replay the animation.
  const pageEnterRef = useRef({ path: null, cls: "sk-page-enter" });
  if (pageEnterRef.current.path !== currentPath) pageEnterRef.current = { path: currentPath, cls: pageEnterRef.current.path !== null && tabsJustChanged(400) ? "" : "sk-page-enter" };
  const pageEnter = pageEnterRef.current;

  const onNavigate = (path) => { setMobileOpen(false); navigate(path); };

  function chooseSidebarMode(mode) {
    setSidebarMode(mode);
    try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch {}
    setHoverPeek(false);
  }

  // expanded <-> collapsed; "expand on hover" counts as collapsed, so the key pins it open.
  function toggleSidebar() { chooseSidebarMode(sidebarMode === "expanded" ? "collapsed" : "expanded"); }
  // "[" from the keyboard (by physical key, so it works on a Russian/Kazakh layout too), never while typing.
  const toggleRef = useRef(toggleSidebar);
  toggleRef.current = toggleSidebar;
  useEffect(() => {
    function onKey(e) {
      if (e.code !== "BracketLeft" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      toggleRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // what the search can jump to: every page a person can reach (the admin panel only for admins)
  const searchPages = [
    ...NAV, ...COMMUNITY_NAV,
    { id: "participants", key: "shell.nav.participants", icon: "participants", path: "/app/participants" },
    { id: "reports", key: "shell.nav.reports", icon: "reports", path: "/app/reports" },
    ...(profile?.is_admin ? [ADMIN_NAV_ITEM] : []),
    ...WORKSPACE_NAV,
    { id: "team", key: "shell.workspace.team", icon: "team", path: "/app/team" },
    { id: "billing", key: "shell.workspace.billing", icon: "card", path: "/app/billing" },
  ].map((p) => ({ id: p.id, label: t(p.key), path: p.path, icon: p.icon }));

  // The layout's reserved width only grows for a real "expanded" choice --
  // "hover" keeps the narrow rail reserved so peeking never reflows content.
  const reservedNarrow = sidebarMode !== "expanded";
  const peeking = sidebarMode === "hover" && hoverPeek;
  const visuallyExpanded = sidebarMode === "expanded" || peeking;

  return html`
    <div class=${`min-h-screen bg-graphite-950 text-graphite-100 ${localeFadeClass}`}>
      <!-- On while any skeleton/spinner/page gate below is on screen -->
      <${LoadingBar} />
      <!-- Desktop/tablet sidebar (md and up) -->
      <aside
        class=${`sk-sidebar sk-aside hidden md:flex md:flex-col md:fixed md:inset-y-0 ${peeking ? "shadow-2xl shadow-black/60" : ""}`} data-rail=${!visuallyExpanded}
        onMouseEnter=${() => { if (sidebarMode === "hover") setHoverPeek(true); }}
        onMouseLeave=${() => { if (sidebarMode === "hover") setHoverPeek(false); }}>
        <${SidebarContent} currentPath=${currentPath} onNavigate=${onNavigate} collapsed=${!visuallyExpanded} sidebarMode=${sidebarMode} onChangeSidebarMode=${chooseSidebarMode} onToggleSidebar=${toggleSidebar} />
      </aside>

      <!-- Mobile sidebar (phone only, below md) -->
      ${drawerMounted && html`
        <div class="fixed inset-0 z-40 md:hidden">
          <div class="sk-backdrop-anim absolute inset-0 bg-black/70" data-state=${drawerPhase} onClick=${() => setMobileOpen(false)}></div>
          <aside class="sk-sidebar sk-drawer-anim absolute inset-y-0 left-0 w-64" data-state=${drawerPhase}>
            <${SidebarContent} currentPath=${currentPath} onNavigate=${onNavigate} />
          </aside>
        </div>
      `}

      <!-- The top bar does not depend on the sidebar at all: the search and the buttons never move when the rail opens or closes -->
      <header class="sk-topbar sk-topbar-grid sticky top-0 z-30 items-center gap-3 px-4 py-3 md:px-8">
        <div class="flex items-center gap-3 justify-self-start">
          <button class="sk-btn md:!hidden h-9 w-9 rounded-lg text-graphite-400 shrink-0" onClick=${() => setMobileOpen(true)}><${Icon} name="menu" size=${19} /></button>
        </div>
        <div class="sk-topbar-search"><${GlobalSearch} pages=${searchPages} /></div>
        <div class="flex items-center gap-3 col-start-2 sm:col-start-3 justify-self-center sm:justify-self-end">
          <${SearchSheetButton} pages=${searchPages} />
          <${LanguageSwitch} />
          <${NotificationsMenu} />
        </div>
        <button onClick=${() => navigate("/profile")} class="md:hidden col-start-3 justify-self-end">
          <${Avatar} name=${displayName} url=${profile?.avatar_url} size=${30} />
        </button>
      </header>
      <div class="sk-shell-main" data-narrow=${reservedNarrow}>
        <main class="sk-main px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
          <div key=${currentPath} class=${pageEnter.cls}>
            ${children}
          </div>
        </main>
      </div>
      <!-- Phone only: the places used all day, one tap away (the drawer above holds the rest) -->
      <${MobileTabBar} currentPath=${currentPath} onNavigate=${onNavigate} onMore=${() => setMobileOpen(true)} />
      <!-- Every avatar + name in the app opens its person here -->
      <${ProfileViewerHost} />
    </div>
  `;
}
