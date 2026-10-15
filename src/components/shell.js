import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { navigate } from "../router.js";
import { Icon, LogoMark } from "./icons.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { useSession, signOut } from "../lib/auth.js";
import { useMyProfile, updateMyProfile } from "../lib/profile.js";
import { useT, useLocale, setLocale, LOCALES, useLocaleFadeClass } from "../lib/i18n.js";
import { useNotifications, markAllNotificationsRead, notificationCopyKey, notificationTargetPath } from "../lib/notificationsStore.js";
import { useFriends } from "../lib/friendsStore.js";
import { useMessagingBootstrap, useConversations } from "../lib/messagesStore.js";
import { relativeDate } from "../lib/format.js";
import { toast, Badge, LoadingBar, Skeleton } from "./ui.js";
import { useMountTransition } from "../lib/motion.js";

// "experiments" and "results" removed from the sidebar for now (not
// deleted -- routes/pages/code are untouched, just unreachable via nav)
// while the product direction is reconsidered.
const NAV = [
  { id: "overview", key: "shell.nav.overview", icon: "overview", path: "/app/overview" },
  { id: "participants", key: "shell.nav.participants", icon: "participants", path: "/app/participants" },
  { id: "insights", key: "shell.nav.insights", icon: "insights", path: "/app/insights" },
  { id: "reports", key: "shell.nav.reports", icon: "reports", path: "/app/reports" },
];

const COMMUNITY_NAV = [
  { id: "feed", key: "shell.community.feed", icon: "globe", path: "/app/feed" },
  { id: "favorites", key: "shell.community.favorites", icon: "bookmark", path: "/app/favorites" },
  { id: "friends", key: "shell.community.friends", icon: "friends", path: "/app/friends" },
  { id: "messages", key: "shell.community.messages", icon: "chat", path: "/app/messages" },
];

const WORKSPACE_NAV = [
  { id: "team", key: "shell.workspace.team", icon: "team", path: "/app/team" },
  { id: "billing", key: "shell.workspace.billing", icon: "card", path: "/app/billing" },
  { id: "profile", key: "shell.workspace.profile", icon: "user", path: "/profile" },
  { id: "settings", key: "shell.workspace.settings", icon: "settings", path: "/app/settings" },
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
    <div class="rounded-full bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center font-semibold text-white shrink-0"
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
      class=${`flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors ${danger ? "text-rose-400 hover:bg-rose-500/10" : "text-slate-300 hover:bg-white/5"}`}>
      <${Icon} name=${icon} size=${15} /> ${label}
    </button>
  `;
}

function UserMenu({ onNavigate, collapsed = false }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { org } = useCurrentOrg();
  const { user } = useSession();
  const { profile } = useMyProfile();
  const displayName = profile?.full_name || user?.email || "";

  return html`
    <div class=${`relative ${collapsed ? "px-2" : "px-3"}`}>
      <button onClick=${() => setOpen((v) => !v)} title=${collapsed ? displayName : undefined}
        class=${`sk-nav-item flex w-full items-center gap-2.5 overflow-hidden rounded-lg py-2 transition-colors ${collapsed ? "justify-center px-0" : "px-1.5"}`} data-active="false">
        <div class="relative shrink-0">
          <${Avatar} name=${displayName} url=${profile?.avatar_url} />
          <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-slate-950"></span>
        </div>
        ${!collapsed && html`
          <div class="min-w-0 flex-1 text-left">
            <div class="text-sm font-medium text-slate-100 truncate">${displayName || html`<${Skeleton} className="h-4 w-24" />`}</div>
            <div class="text-[11px] text-slate-500 truncate">${org?.name ?? ""}</div>
          </div>
          <${Icon} name="chevronDown" size=${14} className="text-slate-500 shrink-0" />
        `}
      </button>
      <${Dropdown} open=${open} onClose=${() => setOpen(false)}>
        <${MenuItem} icon="user" label=${t("shell.userMenu.profile")} onClick=${() => { setOpen(false); onNavigate("/profile"); }} />
        <${MenuItem} icon="settings" label=${t("shell.userMenu.settings")} onClick=${() => { setOpen(false); onNavigate("/app/settings"); }} />
        <div class="my-1 border-t border-slate-800"></div>
        <${MenuItem} icon="logout" label=${t("shell.userMenu.logout")} danger onClick=${async () => { setOpen(false); await signOut(); navigate("/"); }} />
      <//>
    </div>
  `;
}

function NavItem({ item, currentPath, onNavigate, t, collapsed, badgeCount = 0 }) {
  const active = currentPath === item.path || currentPath.startsWith(item.path + "/");
  return html`
    <button
      onClick=${() => onNavigate(item.path)}
      data-active=${active}
      title=${collapsed ? t(item.key) : undefined}
      class=${`sk-nav-item relative flex w-full items-center gap-3 overflow-hidden whitespace-nowrap rounded-lg py-2 text-sm font-medium ${collapsed ? "justify-center px-0" : "px-3"} ${
        active ? "text-indigo-300" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      <span class="relative shrink-0">
        <${Icon} name=${item.icon} size=${17} />
        ${collapsed && badgeCount > 0 && html`<span class="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-rose-400 border border-slate-950"></span>`}
      </span>
      ${!collapsed && html`<span class="flex-1 text-left">${t(item.key)}</span>`}
      ${!collapsed && badgeCount > 0 && html`<${Badge} tone="rose" className="shrink-0 px-1.5">${badgeCount}<//>`}
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

/** Matches the picker pattern from Supabase's own dashboard (the user's
 * own reference): a small dot marks the active mode, not a checkmark. */
function SidebarModePicker({ mode, onChange, collapsed }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return html`
    <div class="relative">
      <button type="button" onClick=${() => setOpen((v) => !v)}
        title=${t("shell.sidebar.label")}
        class="sk-btn h-7 w-7 rounded-lg text-slate-500 hover:text-slate-200">
        <${Icon} name=${collapsed ? "chevronRight" : "chevronLeft"} size=${14} />
      </button>
      <${Dropdown} open=${open} onClose=${() => setOpen(false)}>
        <div class="px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">${t("shell.sidebar.label")}</div>
        ${SIDEBAR_MODES.map((m) => html`
          <button key=${m.id} type="button" onClick=${() => { onChange(m.id); setOpen(false); }}
            class="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-left text-slate-300 hover:bg-white/5 transition-colors">
            <span class=${`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${mode === m.id ? "bg-indigo-400" : "bg-transparent"}`}></span>
            ${t(m.key)}
          </button>
        `)}
      <//>
    </div>
  `;
}

function SidebarContent({ currentPath, onNavigate, collapsed = false, sidebarMode, onChangeSidebarMode }) {
  const t = useT();
  const { org } = useCurrentOrg();
  const { incoming } = useFriends();
  const { unreadTotal } = useConversations();
  const navBadge = (id) => (id === "friends" ? incoming.length : id === "messages" ? unreadTotal : 0);
  return html`
    <div class="flex h-full flex-col">
      <button type="button" onClick=${() => onNavigate("/app/overview")}
        class=${`flex items-center gap-2.5 overflow-hidden px-5 py-5 text-left hover:opacity-80 transition-opacity ${collapsed ? "justify-center px-0" : "w-full"}`}>
        <${LogoMark} size=${36} />
        ${!collapsed && html`
          <div class="min-w-0">
            <div class="font-semibold text-slate-50 leading-tight tracking-tight whitespace-nowrap">DecisionOS</div>
            <div class="text-[11px] text-slate-500 leading-tight truncate max-w-[9rem]">${org?.name ?? html`<${Skeleton} className="mt-1 h-3 w-20" />`}</div>
          </div>
        `}
      </button>

      <div class="px-4 mb-3">
        <button onClick=${() => onNavigate("/app/experiments/new")}
          title=${collapsed ? t("shell.newResearch") : undefined}
          class=${`sk-btn sk-btn-primary flex w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg text-white text-sm font-medium py-2.5 ${collapsed ? "px-0" : "px-4"}`}>
          <${Icon} name="plus" size=${16} className="shrink-0" /> ${!collapsed && t("shell.newResearch")}
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 space-y-0.5">
        ${NAV.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} />`)}

        ${collapsed
          ? html`<div class="my-2 mx-2 border-t border-black/40"></div>`
          : html`<div class="overflow-hidden whitespace-nowrap pt-4 pb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">${t("shell.communityLabel")}</div>`}
        ${COMMUNITY_NAV.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} badgeCount=${navBadge(item.id)} />`)}

        ${collapsed
          ? html`<div class="my-2 mx-2 border-t border-black/40"></div>`
          : html`<div class="overflow-hidden whitespace-nowrap pt-4 pb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">${t("shell.workspaceLabel")}</div>`}
        ${WORKSPACE_NAV.map((item) => html`<${NavItem} key=${item.id} item=${item} currentPath=${currentPath} onNavigate=${onNavigate} t=${t} collapsed=${collapsed} />`)}
      </nav>

      <div class="border-t border-black/40 py-3 space-y-1.5">
        ${onChangeSidebarMode && html`
          <div class=${`flex ${collapsed ? "justify-center px-0" : "justify-start px-3"}`}>
            <${SidebarModePicker} mode=${sidebarMode} onChange=${onChangeSidebarMode} collapsed=${collapsed} />
          </div>
        `}
        <${UserMenu} onNavigate=${onNavigate} collapsed=${collapsed} />
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
      <button class="sk-btn relative h-8 w-8 rounded-lg text-slate-400 hover:text-slate-200" onClick=${onToggle} aria-label=${t("shell.notifications.title")}>
        <${Icon} name="bell" size=${17} className=${ringing ? "sk-bell-ring" : ""} />
        ${unreadCount > 0 && html`<span class="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-400 border border-slate-950"></span>`}
      </button>
      ${menuMounted && html`
        <div data-state=${menuPhase} style="transform-origin: top right" class="sk-modal sk-overlay-anim sk-overlay-anim-down fixed right-4 top-[69px] sm:absolute sm:right-0 sm:top-full sm:mt-2 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-xl">
          <div class="px-4 py-3 border-b border-black/40 text-sm font-medium text-slate-200">${t("shell.notifications.title")}</div>
          ${loading && html`<div class="px-4 py-8 text-center text-sm text-slate-500">${t("common.loading")}</div>`}
          ${!loading && notifications.length === 0 && html`<div class="px-4 py-8 text-center text-sm text-slate-500">${t("shell.notifications.empty")}</div>`}
          ${!loading && notifications.length > 0 && html`
            <div class="max-h-80 overflow-y-auto py-1">
              ${notifications.map((n) => html`
                <button key=${n.id} type="button" onClick=${() => onItemClick(n)}
                  class="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-white/5 transition-colors">
                  <${Avatar} name=${n.actorName} url=${n.actorAvatarUrl} size=${28} />
                  <div class="min-w-0 flex-1">
                    <div class="text-xs text-slate-300 leading-snug">${t(notificationCopyKey(n.type), { name: n.actorName ?? t("feed.unknownAuthor") })}</div>
                    ${n.type === "comment" && n.commentBody && html`<div class="text-xs text-slate-500 truncate mt-0.5">«${n.commentBody}»</div>`}
                    <div class="text-[11px] text-slate-600 mt-0.5">${relativeDate(n.createdAt)}</div>
                  </div>
                  ${!n.isRead && html`<span class="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0"></span>`}
                </button>
              `)}
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

export function LanguageSwitch({ variant = "tabs" }) {
  const t = useT();
  const locale = useLocale();
  const { profile } = useMyProfile();
  const [pending, setPending] = useState(false);

  async function choose(id) {
    if (id === locale || pending) return;
    setLocale(id); // local + immediate -- the UI updates now, regardless of auth/DB state
    if (!profile) return; // not signed in (or profile still loading) -- nothing to persist
    setPending(true);
    try {
      await updateMyProfile({ locale: id });
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setPending(false);
    }
  }
  if (variant === "glass") {
    // Landing-page look (landing.css): sliding violet pill under three 38px buttons -- same choose() logic as below.
    const idx = Math.max(0, LOCALES.findIndex((l) => l.id === locale));
    return html`
      <div class="lp-lang" role="group" aria-label=${t("landing.langLabel")}>
        <span class="lp-lang-pill" style=${`transform:translateX(${idx * 38}px)`}></span>
        ${LOCALES.map((l) => html`
          <button key=${l.id} type="button" disabled=${pending} aria-pressed=${locale === l.id} onClick=${() => choose(l.id)}
            class=${`lp-lang-b ${locale === l.id ? "lp-on" : ""}`}>${l.label}</button>
        `)}
      </div>
    `;
  }
  return html`
    <div class="sk-tabs flex items-center rounded-lg p-0.5 text-sm font-medium">
      ${LOCALES.map((l) => html`
        <button key=${l.id} disabled=${pending} data-active=${locale === l.id} onClick=${() => choose(l.id)}
          class=${`sk-tab px-2.5 py-1.5 rounded-md disabled:opacity-50 ${locale === l.id ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>${l.label}</button>
      `)}
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
  const displayName = profile?.full_name || user?.email || "";
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
  const [search, setSearch] = useState("");
  const { mounted: drawerMounted, phase: drawerPhase } = useMountTransition(mobileOpen);
  // A brief dip-and-recover across the whole shell whenever the language
  // actually changes, so every translated label on screen (sidebar, header,
  // page content) reads as transitioning together instead of flickering.
  const localeFadeClass = useLocaleFadeClass();

  const onNavigate = (path) => { setMobileOpen(false); navigate(path); };

  function chooseSidebarMode(mode) {
    setSidebarMode(mode);
    try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch {}
    setHoverPeek(false);
  }

  function onSearchSubmit(e) {
    e.preventDefault();
    if (search.trim()) navigate(`/app/experiments?q=${encodeURIComponent(search.trim())}`);
  }

  // The layout's reserved width only grows for a real "expanded" choice --
  // "hover" keeps the narrow rail reserved so peeking never reflows content.
  const reservedNarrow = sidebarMode !== "expanded";
  const peeking = sidebarMode === "hover" && hoverPeek;
  const visuallyExpanded = sidebarMode === "expanded" || peeking;

  return html`
    <div class=${`min-h-screen bg-slate-950 text-slate-100 ${localeFadeClass}`}>
      <!-- On while any skeleton/spinner/page gate below is on screen -->
      <${LoadingBar} />
      <!-- Desktop/tablet sidebar (md and up) -->
      <aside
        class=${`sk-sidebar hidden md:flex md:flex-col md:fixed md:inset-y-0 transition-all duration-150 ${visuallyExpanded ? "md:w-64" : "md:w-[72px]"} ${peeking ? "z-40 shadow-2xl shadow-black/60" : "z-20"}`}
        onMouseEnter=${() => { if (sidebarMode === "hover") setHoverPeek(true); }}
        onMouseLeave=${() => { if (sidebarMode === "hover") setHoverPeek(false); }}>
        <${SidebarContent} currentPath=${currentPath} onNavigate=${onNavigate} collapsed=${!visuallyExpanded} sidebarMode=${sidebarMode} onChangeSidebarMode=${chooseSidebarMode} />
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

      <div class=${reservedNarrow ? "md:pl-[72px]" : "md:pl-64"}>
        <header class="sk-topbar sticky top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 md:px-8">
          <div class="flex items-center gap-3 justify-self-start">
            <button class="sk-btn md:!hidden h-9 w-9 rounded-lg text-slate-400 shrink-0" onClick=${() => setMobileOpen(true)}><${Icon} name="menu" size=${19} /></button>
          </div>
          <form onSubmit=${onSearchSubmit} class="sk-display hidden sm:flex items-center gap-2.5 justify-self-center rounded-lg px-3.5 py-2 text-sm text-slate-400 w-full max-w-xl">
            <${Icon} name="search" size=${16} className="shrink-0" />
            <input value=${search} onInput=${(e) => setSearch(e.target.value)} placeholder=${t("shell.searchPlaceholder")}
              class="bg-transparent outline-none placeholder:text-slate-500 w-full lg:min-w-[18rem] text-slate-200" />
          </form>
          <div class="flex items-center gap-3 col-start-2 sm:col-start-3 justify-self-center sm:justify-self-end">
            <${LanguageSwitch} />
            <${NotificationsMenu} />
          </div>
          <button onClick=${() => navigate("/profile")} class="md:hidden col-start-3 justify-self-end">
            <${Avatar} name=${displayName} url=${profile?.avatar_url} size=${30} />
          </button>
        </header>
        <main class="px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
          <div key=${currentPath} class="sk-page-enter">
            ${children}
          </div>
        </main>
      </div>
    </div>
  `;
}
