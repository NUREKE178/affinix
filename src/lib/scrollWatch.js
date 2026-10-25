// The landing page's scrolling is the browser's own (wheel, keys, touch, anchors, all native and immediate): nothing here smooths or follows it.
// The one helper: a jump to a y position, an element or an element id, without animation.
export function scrollToTarget(target, { offset = 0 } = {}) {
  const el = typeof target === "string" ? document.getElementById(target) : target instanceof Element ? target : null;
  const y = el ? el.getBoundingClientRect().top + window.scrollY + offset : Number(target) + offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
}
