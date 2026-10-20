// Swiping between the tabs of a page (phone): a horizontal swipe on the page content moves to the next / previous tab.
//  * the content follows the finger (with a little resistance), then slides out; the new tab slides in from the side
//  * the same slide-in plays when a tab is tapped, so taps and swipes feel the same
//  * it never fights with the things that scroll or type: inputs, sideways-scrolling strips/tables, dialogs, the screen edges
// Every <Tabs> registers itself here (see components/ui.js); one document-level listener serves all of them.
import { prefersReducedMotion } from "./motion.js";

const entries = new Set(); // { root: () => Element|null, get: () => ({ tabs, active, go }), rank }
let installed = false;
let pending = null;        // direction of the tab change that is just about to render: 1 = next, -1 = previous
let held = [];             // elements left transparent after the slide-out; cleared once the new tab slides in
let g = null;              // the gesture in progress

const EDGE = 24;           // px at the screen edges that belong to the browser's own back / forward gestures
const EASE = "cubic-bezier(.22,.9,.3,1)";

export function noteTabChange(dir) {
  pending = { dir, at: Date.now() };
}

/** The direction of the change that was just announced (1 / -1), or 0. Consumed by the first caller. */
export function takeTabChange() {
  if (!pending) return 0;
  const fresh = Date.now() - pending.at < 1500;
  const dir = fresh ? pending.dir : 0;
  pending = null;
  return dir;
}

/** The page content that belongs to the tab bar: everything after it, at the highest level of the page that has anything after it. */
export function contentAfter(root) {
  const main = root?.closest?.("main");
  if (!main) return [];
  let best = [];
  for (let n = root; n && n !== main; n = n.parentElement) {
    const sib = [];
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) sib.push(s);
    if (sib.length) best = sib;
  }
  return best;
}

function clearHeld() {
  for (const el of held) { el.style.opacity = ""; el.style.transform = ""; el.style.willChange = ""; el.style.transition = ""; }
  held = [];
}

/** The slide-in of the new tab's content; `dir` 1 comes from the right (next tab), -1 from the left. */
export function slideIn(root, dir) {
  const els = contentAfter(root);
  if (!dir || prefersReducedMotion() || !els.length) { clearHeld(); return; }
  for (const el of els) {
    if (typeof el.animate !== "function") continue;
    el.animate(
      [{ opacity: 0, transform: `translate3d(${dir * 36}px,0,0)` }, { opacity: 1, transform: "translate3d(0,0,0)" }],
      { duration: 280, easing: EASE }
    );
  }
  clearHeld();
}

/** Keeps the active tab in view in a tab strip that scrolls sideways. */
export function revealActive(strip) {
  const btn = strip?.querySelector?.('[data-active="true"]');
  if (!btn || strip.scrollWidth <= strip.clientWidth + 1) return;
  const left = btn.offsetLeft - (strip.clientWidth - btn.offsetWidth) / 2;
  if (typeof strip.scrollTo === "function") strip.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  else strip.scrollLeft = left;
}

export function registerSwipe(entry) {
  entries.add(entry);
  install();
  document.documentElement.dataset.swipeTabs = "1"; // styles.css: the page content takes horizontal pans for itself
  return () => {
    entries.delete(entry);
    if (!entries.size) delete document.documentElement.dataset.swipeTabs;
  };
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onCancel, { passive: true });
}

function blocked(target) {
  if (!(target instanceof Element)) return true;
  // the empty space below a short page counts as page: only the chrome (top bar, sidebar, dialogs) is left out
  if (target.closest("[data-noswipe],[role=dialog],[aria-modal=true],aside,nav,header")) return true;
  // a field the person is typing in (or has focused) keeps its own drags (text selection, the caret); an untouched field
  // does not -- forms fill the screen on a phone, and a swipe over them must still change the tab
  const field = target.closest("input,textarea,select,[contenteditable]");
  if (field && (field === document.activeElement || field.contains(document.activeElement) || /^(range|file)$/.test(field.type || ""))) return true;
  for (let n = target; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true; // a strip / table that scrolls sideways keeps its own swipe
    }
  }
  return false;
}

function pickEntry() {
  let best = null;
  for (const e of entries) {
    const root = e.root();
    if (!root || !root.isConnected || root.offsetParent === null) continue;
    if (!best || (e.rank ?? 0) >= (best.rank ?? 0)) best = e;
  }
  return best;
}

function onStart(e) {
  g = null;
  if (!entries.size || e.touches.length !== 1) return;
  const t = e.touches[0];
  if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
  if (blocked(e.target)) return;
  const entry = pickEntry();
  if (!entry) return;
  clearHeld();
  g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), entry, locked: false, dx: 0, els: [] };
}

function neighbour(entry, dir) {
  const { tabs, active } = entry.get();
  const i = tabs.findIndex((x) => x.id === active);
  return i < 0 ? null : tabs[i + dir] || null;
}

function paint(dx, has) {
  const k = has ? 0.55 : 0.2; // resistance: more at the first / last tab, where there is nothing to go to
  const shift = dx * k;
  const fade = Math.min(Math.abs(dx) / 420, 0.4) * (has ? 1 : 0.4);
  for (const el of g.els) {
    el.style.transition = "none";
    el.style.willChange = "transform, opacity";
    el.style.transform = `translate3d(${shift}px,0,0)`;
    el.style.opacity = String(1 - fade);
  }
}

function onMove(e) {
  if (!g) return;
  const t = e.touches[0];
  const dx = t.clientX - g.x0;
  const dy = t.clientY - g.y0;
  if (!g.locked) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }  // a vertical scroll: leave it alone
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    g.locked = true;
    g.els = contentAfter(g.entry.root());
  }
  g.dx = dx;
  paint(dx, !!neighbour(g.entry, dx < 0 ? 1 : -1));
  if (e.cancelable) e.preventDefault();
}

function reset(els, animate) {
  for (const el of els) {
    const from = el.style.transform || "translate3d(0,0,0)";
    const op = el.style.opacity || "1";
    el.style.transition = ""; el.style.transform = ""; el.style.opacity = ""; el.style.willChange = "";
    if (animate && typeof el.animate === "function" && !prefersReducedMotion()) {
      el.animate([{ transform: from, opacity: op }, { transform: "translate3d(0,0,0)", opacity: 1 }], { duration: 240, easing: EASE });
    }
  }
}

function onEnd() {
  const gesture = g;
  g = null;
  if (!gesture || !gesture.locked) return;
  const { dx, entry, els } = gesture;
  const dt = Math.max(Date.now() - gesture.t0, 1);
  const dir = dx < 0 ? 1 : -1;
  const next = neighbour(entry, dir);
  const far = Math.abs(dx) > Math.max(64, innerWidth * 0.2);
  const quick = Math.abs(dx) > 36 && Math.abs(dx) / dt > 0.45;
  if (!next || !(far || quick)) { reset(els, true); return; }
  // slide the old content out, then change tab; the new content slides in (Tabs does that when it sees the change)
  const { go } = entry.get();
  if (prefersReducedMotion() || typeof els[0]?.animate !== "function") { reset(els, false); go(next.id); return; }
  held = els;
  const run = els.map((el) => {
    const a = el.animate(
      [{ transform: el.style.transform || "translate3d(0,0,0)", opacity: Number(el.style.opacity || 1) }, { transform: `translate3d(${-dir * 44}px,0,0)`, opacity: 0 }],
      { duration: 130, easing: "ease-in", fill: "forwards" }
    );
    return a.finished.catch(() => {});
  });
  for (const el of els) { el.style.transition = ""; el.style.transform = ""; el.style.opacity = "0"; }
  Promise.all(run).then(() => {
    go(next.id);
    setTimeout(clearHeld, 700); // safety: if the new tab did not slide in, do not leave the old content transparent
  });
}

function onCancel() {
  if (g?.locked) reset(g.els, true);
  g = null;
}
