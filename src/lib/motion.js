// Shared motion utilities. styles.css does the actual animating (its
// .sk-overlay-anim / .sk-backdrop-anim / .sk-toast-anim / .sk-reveal rules);
// these just drive the timing and state that CSS keys off of.
import { useState, useEffect, useLayoutEffect, useRef } from "./preact.js";

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const DEFAULT_EXIT_MS = 160;

// Keeps a closing overlay (modal, dropdown, popover, lightbox...) mounted
// long enough to play its exit transition instead of unmounting the
// instant `open` goes false. Returns `mounted` (render while true) and
// `phase` ("entering" | "entered" | "exiting") to set as data-state on the
// animated node. Call sites still own their own open/close state -- this
// only delays the unmount and sequences entering -> entered on a frame.
export function useMountTransition(open, exitDuration = DEFAULT_EXIT_MS) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState(open ? "entering" : "exiting");
  const pending = useRef([]);

  useEffect(() => {
    pending.current.forEach((cancel) => cancel());
    pending.current = [];

    if (open) {
      setMounted(true);
      setPhase("entering");
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setPhase("entered"));
        pending.current.push(() => cancelAnimationFrame(raf2));
      });
      pending.current.push(() => cancelAnimationFrame(raf1));
    } else {
      setPhase("exiting");
      const duration = prefersReducedMotion() ? 0 : exitDuration;
      const timer = setTimeout(() => setMounted(false), duration);
      pending.current.push(() => clearTimeout(timer));
    }

    return () => {
      pending.current.forEach((cancel) => cancel());
      pending.current = [];
    };
  }, [open]);

  return { mounted, phase };
}

// Same as useMountTransition, but for a "some object, or null" trigger --
// a modal whose content IS the selected item (confirmDelete, viewingAuthor
// style state). Keeps returning the last non-null value while `mounted`
// stays true, so the closing modal can keep rendering its content through
// the exit transition instead of hitting null mid-fade.
export function useMountedValue(value, exitDuration = DEFAULT_EXIT_MS) {
  const { mounted, phase } = useMountTransition(value != null, exitDuration);
  const lastValue = useRef(value);
  if (value != null) lastValue.current = value;
  return { mounted, phase, value: lastValue.current };
}

// IntersectionObserver-backed scroll reveal. Returns a ref to attach to the
// element and a boolean for its current data-visible state. Reveals once
// and stays revealed (no re-hide on scroll-away -- that reads as glitchy,
// not "premium"). Falls back to always-visible when IntersectionObserver
// isn't available rather than leaving content stuck hidden.
export function useReveal(options) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");

  // useLayoutEffect, not useEffect: this runs after the DOM commits but
  // before the browser paints, so an element that's already on screen the
  // instant it mounts (near the top of an already-tall page, or simply
  // tall enough to start in view) can be marked visible before the first
  // paint -- skipping the hidden-then-revealed dance instead of letting it
  // flash hidden for a frame while the (necessarily async) observer below
  // catches up.
  useLayoutEffect(() => {
    if (visible || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) setVisible(true);
  }, []);

  useEffect(() => {
    if (visible || typeof IntersectionObserver === "undefined" || !ref.current) return undefined;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px", ...options }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return { ref, visible };
}
