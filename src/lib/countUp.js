// A number that rolls to its new value instead of jumping: the wallet balance, the bonus after a mission answer.
// Starts from `from` (0 on the first look, so the screen opens with a count-up) and ends exactly on the target.
// With "reduce motion" on, it shows the target at once. `ms` is the roll time.
import { useState, useEffect, useRef } from "./preact.js";
import { prefersReducedMotion } from "./motion.js";
import { countUpAt } from "./money.js";

export function useCountUp(target, { ms = 750, from = 0 } = {}) {
  const goal = Number.isFinite(Number(target)) ? Math.trunc(Number(target)) : 0;
  const reduce = prefersReducedMotion();
  const [shown, setShown] = useState(reduce ? goal : from);
  const last = useRef(reduce ? goal : from);
  useEffect(() => {
    if (reduce || typeof requestAnimationFrame !== "function") { last.current = goal; setShown(goal); return undefined; }
    const start = last.current;
    if (start === goal) { setShown(goal); return undefined; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now) => {
      const p = (now - t0) / ms;
      const v = countUpAt(start, goal, p);
      last.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [goal, ms, reduce]);
  return shown;
}
