// The search box in the top bar: one place to find a page, a person or a public post. Arrow keys + Enter, "/" to focus,
// Esc to close. On a phone the box opens as a full-screen sheet from a button.
import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { useT } from "../lib/i18n.js";
import { navigate } from "../router.js";
import { openProfile } from "../lib/profileViewer.js";
import { cleanText, matchPages, searchPlatform, MIN_TEXT } from "../lib/globalSearch.js";
import { timeAgo } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Icon } from "./icons.js";
import { PlatformBadge } from "./platformBadge.js";
import { platformRoleOf } from "../lib/platformRole.js";

const EMPTY = { status: "idle", people: [], posts: [], failed: 0 };

function Group({ title, children }) {
  return html`<div class="gs-group" role="group" aria-label=${title}><div class="gs-group-title">${title}</div>${children}</div>`;
}

export function GlobalSearch({ pages, sheet = false, onDone }) {
  const t = useT();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(sheet);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState(EMPTY);
  const box = useRef(null);
  const input = useRef(null);
  const seq = useRef(0);

  const q = cleanText(text);
  const searching = q.length >= MIN_TEXT;
  const pageHits = matchPages(pages, text).slice(0, searching ? 4 : pages.length);

  // the people / posts part waits for a short pause in typing and ignores answers to older text
  useEffect(() => {
    if (!searching) { setFound(EMPTY); return undefined; }
    const mine = ++seq.current;
    setFound((f) => ({ ...f, status: "loading" }));
    const timer = setTimeout(() => {
      searchPlatform(q).then((r) => { if (seq.current === mine) setFound({ status: "ready", ...r }); });
    }, 260);
    return () => clearTimeout(timer);
  }, [q]);

  // everything selectable, in screen order
  const items = [
    ...pageHits.map((p) => ({ kind: "page", key: `p-${p.id}`, p })),
    ...found.people.map((p) => ({ kind: "person", key: `u-${p.id}`, p })),
    ...found.posts.map((p) => ({ kind: "post", key: `d-${p.id}`, p })),
  ];
  useEffect(() => { setActive(0); }, [q]);

  useEffect(() => {
    if (!open || sheet) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, sheet]);

  // "/" focuses the box (never while typing somewhere else)
  useEffect(() => {
    if (sheet) { input.current?.focus(); return undefined; }
    function onKey(e) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (!input.current || input.current.offsetParent === null) return;
      e.preventDefault();
      input.current.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  function close() {
    setOpen(false);
    if (sheet) onDone?.();
  }
  function choose(item) {
    if (!item) return;
    setText("");
    setOpen(false);
    input.current?.blur();
    if (item.kind === "page") navigate(item.p.path);
    else if (item.kind === "person") openProfile(item.p);
    else navigate(`/app/feed?post=${item.p.id}`);
    onDone?.();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); if (text) setText(""); else { input.current?.blur(); close(); } }
    else if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[active]); }
  }
  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, found]);

  let n = -1;
  const row = (item, body) => {
    n += 1;
    const idx = n;
    return html`<button type="button" role="option" class="gs-item" key=${item.key} data-kind=${item.kind} data-active=${idx === active ? "true" : "false"} aria-selected=${idx === active}
      onMouseEnter=${() => setActive(idx)} onClick=${() => choose(item)} data-testid=${`gs-${item.kind}`}>${body}</button>`;
  };

  const none = searching && found.status === "ready" && items.length === 0;
  const allFailed = searching && found.status === "ready" && found.failed === 2 && pageHits.length === 0;
  const loading = searching && found.status === "loading";

  return html`
    <div class=${`gs ${sheet ? "gs-sheet" : ""}`} ref=${box} data-open=${open} data-testid="global-search">
      <div class="gs-field sk-display">
        <${Icon} name="search" size=${16} className="shrink-0" />
        <input ref=${input} value=${text} role="combobox" aria-expanded=${open} aria-controls="gs-list" aria-autocomplete="list" autocomplete="off" spellcheck=${false}
          onInput=${(e) => { setText(e.currentTarget.value); setOpen(true); }} onFocus=${() => setOpen(true)} onKeyDown=${onKeyDown}
          placeholder=${t("shell.searchPlaceholder")} aria-label=${t("search.aria")} data-testid="global-search-input" />
        ${text
          ? html`<button type="button" class="gs-clear" onClick=${() => { setText(""); input.current?.focus(); }} aria-label=${t("search.clear")}><${Icon} name="close" size=${14} /></button>`
          : html`<span class="sk-kbd gs-slash" aria-hidden="true">/</span>`}
        ${sheet && html`<button type="button" class="gs-cancel" onClick=${close}>${t("common.cancel")}</button>`}
      </div>

      ${open && html`
        <div class="gs-panel sk-panel" id="gs-list" role="listbox" aria-label=${t("search.aria")} data-testid="global-search-panel">
          ${pageHits.length > 0 && html`
            <${Group} title=${t("search.pages")}>
              ${pageHits.map((p) => row({ kind: "page", key: `p-${p.id}`, p }, html`
                <span class="gs-ic"><${Icon} name=${p.icon} size=${17} /></span>
                <span class="gs-main"><span class="gs-title">${p.label}</span></span>`))}
            <//>`}
          ${found.people.length > 0 && html`
            <${Group} title=${t("search.people")}>
              ${found.people.map((p) => row({ kind: "person", key: `u-${p.id}`, p }, html`
                <${Avatar} name=${p.name} url=${p.avatarUrl} size=${30} />
                <span class="gs-main">
                  <span class="gs-title">${p.name ?? p.username}${p.platformRole && html` <${PlatformBadge} role=${platformRoleOf(p)} />`}</span>
                  <span class="gs-sub">${p.username ? `@${p.username}` : ""}${p.username && p.roleTitle ? " · " : ""}${p.roleTitle ?? ""}</span>
                </span>`))}
            <//>`}
          ${found.posts.length > 0 && html`
            <${Group} title=${t("search.posts")}>
              ${found.posts.map((p) => row({ kind: "post", key: `d-${p.id}`, p }, html`
                <span class="gs-ic"><${Icon} name="globe" size=${17} /></span>
                <span class="gs-main">
                  <span class="gs-title gs-clamp">${p.body}</span>
                  <span class="gs-sub">${p.author?.full_name ?? t("feed.unknownAuthor")} · ${timeAgo(p.createdAt)}</span>
                </span>`))}
            <//>`}
          ${loading && items.length === 0 && html`<div class="gs-note">${t("search.searching")}</div>`}
          ${none && html`<div class="gs-note" data-testid="global-search-empty">${t("search.empty")}</div>`}
          ${allFailed && html`<div class="gs-note">${t("search.error")}</div>`}
          <div class="gs-foot">${t("search.scope")}</div>
        </div>`}
    </div>
  `;
}

/** Phone: a button in the top bar that opens the search as a full-screen sheet. */
export function SearchSheetButton({ pages }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return html`
    <button type="button" class="sk-btn sk-search-btn h-9 w-9 rounded-lg text-graphite-400 shrink-0" onClick=${() => setOpen(true)} aria-label=${t("search.aria")} data-testid="global-search-open">
      <${Icon} name="search" size=${18} />
    </button>
    ${open && html`<div class="gs-overlay"><${GlobalSearch} pages=${pages} sheet=${true} onDone=${() => setOpen(false)} /></div>`}
  `;
}
