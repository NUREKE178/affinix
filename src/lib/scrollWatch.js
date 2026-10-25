// The landing page's scroll state, with NO smoothing: the page scrolls the way the browser scrolls it (wheel, keys, touch, anchors all native and immediate).
// This only watches the scroll position and tells subscribers { y, velocity, progress } once per frame (the landing's parallax uses it).
/** Jumps to a y position, an element or an element id (no animation). */
export function scrollToTarget(target, { offset = 0 } = {}) {
  const el = typeof target === "string" ? document.getElementById(target) : target instanceof Element ? target : null;
  const y = el ? el.getBoundingClientRect().top + window.scrollY + offset : Number(target) + offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
}

/** Starts watching. Returns { stop, subscribe }. */
export function startLandingScroll() {
  if (typeof window === "undefined") return { stop() {}, subscribe: () => () => {} };
  const subs = new Set();
  const out = { y: 0, velocity: 0, progress: 0 }; // one object for every notice (subscribers only read it)
  let max = 0, raf = 0, lastY = window.scrollY, lastT = performance.now();
  // The page height is read when it can have changed (load, resize, content growing), never while scrolling.
  const measureMax = () => { max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); };
  const emit = () => {
    raf = 0;
    const y = window.scrollY, now = performance.now();
    out.velocity = (y - lastY) / Math.max(0.001, (now - lastT) / 1000);
    lastY = y; lastT = now;
    out.y = y; out.progress = max ? Math.min(1, y / max) : 0;
    subs.forEach((fn) => fn(out));
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(emit); };
  const onResize = () => { measureMax(); onScroll(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("load", onResize);
  const grew = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  grew?.observe(document.body);
  measureMax();
  return {
    subscribe(fn) { subs.add(fn); fn({ y: window.scrollY, velocity: 0, progress: max ? window.scrollY / max : 0 }); return () => subs.delete(fn); },
    stop() {
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); window.removeEventListener("load", onResize);
      grew?.disconnect();
      cancelAnimationFrame(raf);
    },
  };
}
