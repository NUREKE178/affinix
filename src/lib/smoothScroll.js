// The landing page's scrolling, as one small engine (Landing only, never inside the app):
//  * the mouse wheel and the keyboard (arrows, Space, PageUp / PageDown, Home / End) move a TARGET; the page eases toward it with a
//    frame-rate-independent exponential glide (same feel at 60 and 144 Hz), so a notch of the wheel carries on and settles softly
//  * anchors and buttons use the same engine through scrollToTarget(): a long eased tween (ease-in-out expo) instead of a linear jump
//  * every frame it reports { y, velocity, progress } to subscribers (the progress bar, the parallax, the section rail), also on touch
//    devices where the page keeps its own native momentum
// It stays out of the way of reduced motion, pinch-zoom (ctrl + wheel), inputs and anything that can scroll on its own.
import { prefersReducedMotion } from "./motion.js";

const TAU = 0.15;           // seconds: how long the glide takes to cover ~63% of the remaining distance
const easeInOutExpo = (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2);

let current = null; // the running engine, so buttons can ask it to scroll

function scrollableAncestor(el, dy) {
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      const atTop = n.scrollTop <= 0, atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
      if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) return n;
    }
  }
  return null;
}
let inner = { el: null, dir: 0, at: 0, hit: null };
/** scrollableAncestor() for a stream of wheel events: the same element and direction within 150 ms give the same answer, without walking the tree again. */
function scrollableAncestorCached(el, dy, now) {
  const dir = Math.sign(dy);
  if (inner.el === el && inner.dir === dir && now - inner.at < 150) return inner.hit;
  inner = { el, dir, at: now, hit: scrollableAncestor(el, dy) };
  return inner.hit;
}
const typing = (el) => !!el?.closest?.("input,textarea,select,button,a,summary,[contenteditable],[role=button],[role=tab],[role=switch]");

/** Scrolls to a y position, an element or an element id; glides when the engine is on, otherwise uses the browser's own smooth scroll. */
export function scrollToTarget(target, { duration = 1.1, offset = 0 } = {}) {
  const el = typeof target === "string" ? document.getElementById(target) : target instanceof Element ? target : null;
  const y = el ? el.getBoundingClientRect().top + window.scrollY + offset : Number(target) + offset;
  if (current) current.tween(y, duration);
  else window.scrollTo({ top: y, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** Starts the engine. `touch: false` (the default) keeps the wheel native on touch screens. Returns { stop, subscribe }. */
export function startLandingScroll() {
  if (typeof window === "undefined") return { stop() {}, subscribe: () => () => {} };
  const smooth = !prefersReducedMotion() && !matchMedia("(pointer: coarse)").matches;
  const subs = new Set();
  let target = window.scrollY, pos = window.scrollY, vel = 0, raf = 0, last = 0, running = false, tw = null;
  // The page height is read when it can have changed (load, resize, content growing), not on every frame: reading scrollHeight right after
  // scrollTo() forces the browser to lay the page out again 60 times a second.
  let max = 0;
  const measureMax = () => { max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); };
  const maxY = () => max;
  const out = { y: 0, velocity: 0, progress: 0 }; // one object for every frame (subscribers only read it)
  const emit = () => { const y = window.scrollY; out.y = y; out.velocity = vel; out.progress = max ? y / max : 0; subs.forEach((fn) => fn(out)); };

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    if (tw) {
      const x = Math.min(1, (now - tw.t0) / (tw.dur * 1000));
      const next = tw.from + (tw.to - tw.from) * easeInOutExpo(x);
      vel = (next - pos) / dt; pos = next; target = pos;
      if (x >= 1) { tw = null; running = false; vel = 0; }
    } else {
      const delta = (target - pos) * (1 - Math.exp(-dt / TAU));
      pos += delta; vel = delta / dt;
      if (Math.abs(target - pos) < 0.3) { pos = target; running = false; vel = 0; }
    }
    window.scrollTo(0, pos);
    emit();
    if (running) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
  const grab = () => { if (!running) { measureMax(); pos = window.scrollY; target = pos; } }; // at rest one layout read is free: take a fresh page height

  const engine = {
    tween(y, duration) {
      if (!smooth) { window.scrollTo({ top: Math.min(maxY(), Math.max(0, y)), behavior: prefersReducedMotion() ? "auto" : "smooth" }); return; }
      if (!running) measureMax();
      pos = window.scrollY;
      tw = { from: pos, to: Math.min(maxY(), Math.max(0, y)), t0: performance.now(), dur: duration };
      kick();
    },
  };

  function onWheel(e) {
    if (e.ctrlKey || e.defaultPrevented || (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
    if (scrollableAncestorCached(e.target, e.deltaY, e.timeStamp)) return;
    e.preventDefault();
    tw = null; grab();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
    target = Math.min(maxY(), Math.max(0, target + e.deltaY * unit));
    kick();
  }
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    const vh = window.innerHeight;
    const step = { ArrowDown: 80, ArrowUp: -80, PageDown: vh * 0.9, PageUp: -vh * 0.9, " ": (e.shiftKey ? -1 : 1) * vh * 0.85 }[e.key];
    if (step !== undefined) { e.preventDefault(); tw = null; grab(); target = Math.min(maxY(), Math.max(0, target + step)); kick(); }
    else if (e.key === "Home") { e.preventDefault(); engine.tween(0, 1.2); }
    else if (e.key === "End") { e.preventDefault(); engine.tween(maxY(), 1.2); }
  }
  const onScroll = () => { if (!running) { pos = target = window.scrollY; emit(); } };
  const onResize = () => { measureMax(); emit(); };

  if (smooth) { window.addEventListener("wheel", onWheel, { passive: false }); window.addEventListener("keydown", onKey); }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("load", onResize);
  const grew = typeof ResizeObserver === "function" ? new ResizeObserver(() => { measureMax(); if (!running) emit(); }) : null;
  grew?.observe(document.body);
  measureMax();
  current = engine;
  emit();
  return {
    subscribe(fn) { subs.add(fn); fn({ y: window.scrollY, velocity: 0, progress: max ? window.scrollY / max : 0 }); return () => subs.delete(fn); },
    stop() {
      if (current === engine) current = null;
      window.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); window.removeEventListener("load", onResize);
      grew?.disconnect();
      cancelAnimationFrame(raf);
    },
  };
}

/** Kept for callers that only want the glide. */
export function enableSmoothScroll() { return startLandingScroll().stop; }
