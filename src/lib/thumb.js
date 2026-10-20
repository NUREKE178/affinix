// The sliding key of a segmented control (tabs, the language switch, the sort toggle ...): ONE raised key that glides from the old
// choice to the new one -- it stretches over both while it travels and then tightens on the new label -- instead of the highlight
// blinking off one button and on another. Every segmented control uses this, so they all move the same way.
//
//   const host = useRef(null), thumb = useRef(null);
//   useThumb(host, thumb, activeId, labelsKey);
//   <div ref=${host} class="sk-thumbhost"> <span class="sk-thumb" ref=${thumb} aria-hidden="true"></span> <button data-active=...> ... </div>
//
// The host holds `data-thumb="on"` once the key is placed (CSS then drops the active button's own background); the buttons keep
// `data-active`, so nothing else (tests, a11y, other styles) changes.
import { useEffect, useLayoutEffect, useRef } from "./preact.js";
import { prefersReducedMotion } from "./motion.js";

const EASE = "cubic-bezier(.3,.9,.3,1)";
const MS = 400;

function boxIn(host, el) {
  const h = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: r.left - h.left + host.scrollLeft - host.clientLeft,
    y: r.top - h.top + host.scrollTop - host.clientTop,
    w: r.width,
    h: r.height,
  };
}

const at = (b) => `translate3d(${b.x}px,${b.y}px,0)`;

function place(host, thumb, animate) {
  const btn = host.querySelector('[data-active="true"]');
  if (!btn) { delete host.dataset.thumb; return; }
  const now = boxIn(host, btn);
  const same = thumb._box && Math.abs(thumb._box.x - now.x) < 0.5 && Math.abs(thumb._box.y - now.y) < 0.5 && Math.abs(thumb._box.w - now.w) < 0.5 && Math.abs(thumb._box.h - now.h) < 0.5;
  if (same && !animate) { host.dataset.thumb = "on"; return; } // a resize notice that changed nothing: leave a glide in progress alone
  const running = thumb.getAnimations ? thumb.getAnimations() : [];
  // where the key is seen right now (it may still be travelling from an earlier change)
  const from = running.length ? boxIn(host, thumb) : thumb._box;
  for (const a of running) a.cancel();

  thumb.style.width = `${now.w}px`;
  thumb.style.height = `${now.h}px`;
  thumb.style.transform = at(now);
  thumb.style.borderRadius = getComputedStyle(btn).borderRadius;
  thumb._box = now;
  host.dataset.thumb = "on";

  const moved = from && (Math.abs(from.x - now.x) > 0.5 || Math.abs(from.y - now.y) > 0.5 || Math.abs(from.w - now.w) > 0.5);
  // a size change that lands in the middle of a glide re-aims it (shorter), so the key never jumps
  if (!(animate || running.length) || !moved || prefersReducedMotion() || typeof thumb.animate !== "function") return;
  const left = Math.min(from.x, now.x);
  const right = Math.max(from.x + from.w, now.x + now.w);
  const stretch = { x: left, y: (from.y + now.y) / 2, w: right - left };
  thumb.animate(
    [
      { transform: at(from), width: `${from.w}px` },
      { transform: at(stretch), width: `${stretch.w}px`, offset: 0.42 },
      { transform: at(now), width: `${now.w}px` },
    ],
    { duration: animate ? MS : 240, easing: EASE }
  );
}

/** `key`: the active choice (an id); `layoutKey`: anything that changes the buttons' sizes without changing the choice (the labels, the language).
 *  Safe when the host is not rendered yet (a loading state): it simply picks the host up on the render that has it. */
export function useThumb(hostRef, thumbRef, key, layoutKey = "") {
  const last = useRef(undefined);
  const lastLayout = useRef(layoutKey);
  const watching = useRef(null);
  const ro = useRef(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const thumb = thumbRef.current;
    if (!host || !thumb) { last.current = undefined; return; }
    const changed = last.current !== undefined && last.current !== key && lastLayout.current === layoutKey;
    last.current = key;
    lastLayout.current = layoutKey;
    place(host, thumb, changed);
  });

  // sizes that change on their own (a web font arriving, a resize, a rotated phone): follow without animating
  useEffect(() => {
    const host = hostRef.current;
    const thumb = thumbRef.current;
    if (host === watching.current) return;
    ro.current?.disconnect();
    watching.current = host;
    if (!host || !thumb) return;
    const again = () => place(host, thumb, false);
    if (typeof ResizeObserver === "function") {
      ro.current = new ResizeObserver(again);
      ro.current.observe(host);
      for (const b of host.querySelectorAll("button")) ro.current.observe(b);
    }
    document.fonts?.ready?.then(again);
  });
  useEffect(() => () => ro.current?.disconnect(), []);
}
