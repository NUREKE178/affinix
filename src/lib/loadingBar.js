// A tiny ref-counted "something is loading" signal behind the thin bar at the
// top of the app (<LoadingBar/> in components/ui.js). Anything that puts a
// placeholder on screen -- <Skeleton/>, <Spinner/>, <LoadingState/> -- holds
// it for as long as it stays mounted, so the bar is on exactly as long as the
// screen is visibly waiting for something, with no per-fetch bookkeeping at
// the call sites.
import { useEffect, useState } from "./preact.js";

let holds = 0;
const listeners = new Set();

function notify() {
  const on = holds > 0;
  for (const listener of listeners) listener(on);
}

/** Takes one hold; returns the function that releases it (idempotent). */
export function acquireLoading() {
  holds++;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    notify();
  };
}

/** Keeps the bar on for as long as the calling component stays mounted. */
export function useLoadingHold() {
  useEffect(() => acquireLoading(), []);
}

/** True while at least one hold is active. */
export function useIsLoading() {
  const [on, setOn] = useState(holds > 0);
  useEffect(() => {
    listeners.add(setOn);
    setOn(holds > 0); // a hold may have been taken or released between render and this effect
    return () => { listeners.delete(setOn); };
  }, []);
  return on;
}
