// Smooth (gliding) mouse-wheel scrolling for the landing page: each wheel notch moves a target and the page eases toward it
// instead of jumping. Switched on by Landing only (never inside the app). It stays out of the way of: touch devices (their own
// momentum is already smooth), reduced motion, pinch-zoom (ctrl + wheel), anything that can scroll on its own (a textarea, a
// scrollable panel), and the keyboard / scrollbar / anchor jumps (they scroll natively and the target follows them).
import { prefersReducedMotion } from "./motion.js";

const EASE = 0.11;        // fraction of the remaining distance covered per frame
const WHEEL_GAIN = 1;     // 1 = the browser's own distance per notch

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

/** Turns the smooth wheel on; returns the function that turns it off. */
export function enableSmoothScroll() {
  if (typeof window === "undefined" || prefersReducedMotion() || matchMedia("(pointer: coarse)").matches) return () => {};
  let target = window.scrollY, current = window.scrollY, raf = 0, running = false;
  const maxY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const frame = () => {
    current += (target - current) * EASE;
    if (Math.abs(target - current) < 0.4) { current = target; running = false; }
    window.scrollTo(0, current);
    if (running) raf = requestAnimationFrame(frame);
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.defaultPrevented || e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (scrollableAncestor(e.target, e.deltaY)) return;
    e.preventDefault();
    if (!running) { current = window.scrollY; target = current; }
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
    target = Math.min(maxY(), Math.max(0, target + e.deltaY * unit * WHEEL_GAIN));
    if (!running) { running = true; raf = requestAnimationFrame(frame); }
  };
  const onScroll = () => { if (!running) { current = target = window.scrollY; } };

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("scroll", onScroll);
    cancelAnimationFrame(raf);
  };
}
