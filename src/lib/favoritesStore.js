import { useState, useEffect } from "./preact.js";
import { fetchSavedPosts } from "./postsStore.js";

// --- Reactive cache, same module-level state + listener-set pattern as
// postsStore.js -- a deliberately separate store, not a filtered view of
// postsStore's own state: the Favorites page needs to keep showing a saved
// post even while the main feed reloads for an unrelated reason (someone
// else's like/comment), and vice versa. ---
let state = { posts: [], loading: false, error: null, loaded: false };
const listeners = new Set();
function notify() {
  for (const l of listeners) l();
}

async function load() {
  state = { ...state, loading: true };
  notify();
  try {
    const posts = await fetchSavedPosts();
    state = { posts, loading: false, error: null, loaded: true };
  } catch (error) {
    state = { posts: [], loading: false, error, loaded: true };
  }
  notify();
}

/** Called from postInteractions.js's toggleSave() -- a save/unsave can
 * happen from the main feed OR from this page itself, and both need to
 * keep this store in sync regardless of where the toggle happened. */
export function invalidateFavorites() {
  load();
}

export function useFavorites() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    listener(); // re-sync in case a save/unsave resolved just before this subscribed
    if (!state.loaded && !state.loading) load();
    return () => listeners.delete(listener);
  }, []);

  return { posts: state.posts, loading: state.loading, error: state.error };
}
