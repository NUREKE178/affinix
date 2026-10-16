import { useState, useEffect } from "./lib/preact.js";

function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, query] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(query || "") };
}

const listeners = new Set();
window.addEventListener("hashchange", () => listeners.forEach((l) => l()));

/** The app's home: where the logo, a fresh sign-in and any unknown address lead. */
export const HOME_PATH = "/app/arena";

export function navigate(path) {
  if (location.hash.slice(1) === path) return;
  location.hash = `#${path}`;
}

export function useRoute() {
  const [state, setState] = useState(parseHash);
  useEffect(() => {
    const listener = () => setState(parseHash());
    listeners.add(listener);
    listener(); // re-sync in case the hash changed between this render and this effect committing
    return () => listeners.delete(listener);
  }, []);
  return state;
}

/** Matches a `/app/experiments/:id/results` style pattern against a real path, returning params or null. */
export function matchRoute(pattern, path) {
  const pSegs = pattern.split("/").filter(Boolean);
  const aSegs = path.split("/").filter(Boolean);
  if (pSegs.length !== aSegs.length) return null;
  const params = {};
  for (let i = 0; i < pSegs.length; i++) {
    if (pSegs[i].startsWith(":")) params[pSegs[i].slice(1)] = decodeURIComponent(aSegs[i]);
    else if (pSegs[i] !== aSegs[i]) return null;
  }
  return params;
}
