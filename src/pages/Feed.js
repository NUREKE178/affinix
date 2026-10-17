import { html, useState, useMemo, useEffect, useRef, useCallback } from "../lib/preact.js";
import { Card, SectionHeading, Button, Badge, EmptyState, toast, Skeleton } from "../components/ui.js";
import { useT } from "../lib/i18n.js";
import { useMyProfile } from "../lib/profile.js";
import { getCurrentUser } from "../lib/auth.js";
import { usePosts, deletePost, invalidatePosts, loadMorePosts, fetchPostById } from "../lib/postsStore.js";
import { useFriends } from "../lib/friendsStore.js";
import { withTimeout } from "../lib/async.js";
import { useMountedValue } from "../lib/motion.js";
import { openProfile } from "../lib/profileViewer.js";
import { invalidateFavorites } from "../lib/favoritesStore.js";
import { extractTags, hasTag } from "../lib/richText.js";
import { navigate } from "../router.js";
import { Icon } from "../components/icons.js";
import { PostCard } from "./feed/PostCard.js";
import { Composer } from "./feed/Composer.js";
import { FeedBar } from "./feed/FeedBar.js";

// Favorites.js and the tests import it from here
export { PostCard };

const VIEWS = ["all", "friends", "mine"];
const SORTS = ["new", "top"];
const PREF_KEY = "decisionos_feed_prefs";
const SCROLLED_PX = 240;
const TAG_LIMIT = 8;

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") ?? {}; } catch { return {}; }
}
function writePref(key, value) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), [key]: value })); } catch { /* private mode: not remembered */ }
}

/** Likes count once, a comment counts for more: the order of the "popular" view. Ties go to the newer post. */
const score = (p) => p.likeCount * 2 + p.commentCount * 3;
const byPopularity = (a, b) => score(b) - score(a) || new Date(b.createdAt) - new Date(a.createdAt);

/** The hashtags used in these posts, most used first. */
function trending(posts) {
  const counts = new Map();
  for (const p of posts) for (const tag of extractTags(p.body)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, TAG_LIMIT);
}

export function Feed({ query }) {
  const t = useT();
  const { profile } = useMyProfile();
  const currentUserId = getCurrentUser()?.id;
  const { posts, loading, error, hasMore, loadingMore, moreError } = usePosts();
  const { friends } = useFriends();
  const [view, setViewState] = useState(() => (VIEWS.includes(readPrefs().view) ? readPrefs().view : "all"));
  const [sort, setSortState] = useState(() => (SORTS.includes(readPrefs().sort) ? readPrefs().sort : "new"));
  const [activeHashtag, setActiveHashtag] = useState(query?.get("tag") ? `#${query.get("tag").replace(/^#/, "")}` : null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [released, setReleased] = useState(() => new Set());
  const [flashId, setFlashId] = useState(null);
  const [shared, setShared] = useState(null);
  const baseline = useRef(null);
  const wantFlashMine = useRef(false);
  const sentinelRef = useRef(null);
  const composerRef = useRef(null);
  const { mounted: confirmMounted, phase: confirmPhase, value: confirmPost } = useMountedValue(confirmDelete);
  const postParam = query?.get("post") ?? null;

  const setView = (v) => { setViewState(v); writePref("view", v); };
  const setSort = (v) => { setSortState(v); writePref("sort", v); };

  // --- posts that arrive while the reader is far down the page wait behind a pill instead of pushing the page about ---
  useEffect(() => {
    if (!baseline.current && posts.length) baseline.current = { ids: new Set(posts.map((p) => p.id)), newest: posts[0].createdAt };
  }, [posts]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLLED_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const incoming = useMemo(() => {
    const b = baseline.current;
    if (!b) return [];
    return posts.filter((p) => p.createdAt > b.newest && !b.ids.has(p.id) && p.authorId !== currentUserId && !released.has(p.id));
  }, [posts, released, currentUserId]);
  useEffect(() => {
    if (!scrolled && incoming.length) setReleased((r) => new Set([...r, ...incoming.map((p) => p.id)]));
  }, [scrolled, incoming]);
  const heldIds = useMemo(() => (scrolled ? new Set(incoming.map((p) => p.id)) : new Set()), [scrolled, incoming]);

  const scrollToTop = useCallback(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, []);
  function showHeld() {
    setReleased((r) => new Set([...r, ...incoming.map((p) => p.id)]));
    scrollToTop();
  }

  // the composer is below the list, so a new post of mine appears far above it: take the reader to it
  function onPosted() {
    wantFlashMine.current = true;
    setView(view === "friends" ? "all" : view);
    scrollToTop();
  }
  useEffect(() => {
    if (!wantFlashMine.current) return;
    const b = baseline.current;
    const mine = posts.find((p) => p.authorId === currentUserId && (!b || (!b.ids.has(p.id) && p.createdAt >= b.newest)));
    if (!mine) return;
    wantFlashMine.current = false;
    setFlashId(mine.id);
    setTimeout(() => setFlashId((id) => (id === mine.id ? null : id)), 2200);
  }, [posts]);

  // --- a link to one post (?post=<id>): scroll to it and light it up, or fetch it when it is older than what is loaded ---
  useEffect(() => {
    if (!postParam || loading) return undefined;
    const inList = posts.find((p) => p.id === postParam);
    if (inList) {
      setShared(null);
      let cancelled = false;
      requestAnimationFrame(() => {
        if (cancelled) return;
        document.querySelector(`[data-post-id="${CSS.escape(postParam)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setFlashId(postParam);
        setTimeout(() => setFlashId((id) => (id === postParam ? null : id)), 2200);
      });
      return () => { cancelled = true; };
    }
    if (posts.length === 0 && !error) return undefined;
    let off = false;
    fetchPostById(postParam).then((p) => { if (off) return; if (p) setShared(p); else toast(t("feed.postNotFound"), "amber"); }, () => { if (!off) toast(t("feed.postNotFound"), "amber"); });
    return () => { off = true; };
  }, [postParam, loading, posts.length > 0]);

  // --- the shown list: tab, tag, order ---
  const friendIds = useMemo(() => new Set([currentUserId, ...friends.map((f) => f.otherId)]), [friends, currentUserId]);
  const visibleBase = useMemo(() => posts.filter((p) => !heldIds.has(p.id)), [posts, heldIds]);
  const inView = useMemo(() => {
    if (view === "friends") return visibleBase.filter((p) => friendIds.has(p.authorId));
    if (view === "mine") return visibleBase.filter((p) => p.authorId === currentUserId);
    return visibleBase;
  }, [visibleBase, view, friendIds, currentUserId]);
  const tags = useMemo(() => trending(inView), [inView]);
  const visiblePosts = useMemo(() => {
    const filtered = activeHashtag ? inView.filter((p) => hasTag(p.body, activeHashtag)) : inView;
    return sort === "top" ? [...filtered].sort(byPopularity) : filtered;
  }, [inView, activeHashtag, sort]);

  // --- the next page, when the end of the list comes into view ---
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMorePosts(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visiblePosts.length, loadingMore]);

  async function doDelete() {
    setDeleting(true);
    try {
      await withTimeout(deletePost(confirmDelete.id), 15000);
      setConfirmDelete(null);
      invalidateFavorites(); // a deleted post can't stay in anyone's saved list either
      toast(t("feed.postDeleted"), "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setDeleting(false);
    }
  }

  const cardProps = (post, i) => ({
    key: post.id, post, index: i, t, onHashtagClick: setActiveHashtag,
    canDelete: post.authorId === currentUserId || !!profile?.is_admin,
    canModerate: !!profile?.is_admin, currentUserId, onDeleteClick: setConfirmDelete, onAuthorClick: openProfile,
    highlighted: flashId === post.id,
  });
  const empty = !loading && !error && posts.length === 0;
  const tabEmpty = !loading && !error && posts.length > 0 && inView.length === 0;
  const scrollToComposer = () => composerRef.current?.querySelector("textarea")?.focus();

  return html`
    <div>
      <${SectionHeading} title=${t("feed.title")} subtitle=${t("feed.subtitle")} />

      ${!empty && !error && html`<${FeedBar} t=${t} view=${view} onView=${setView} sort=${sort} onSort=${setSort} tags=${tags} activeTag=${activeHashtag} onTag=${setActiveHashtag} />`}

      ${activeHashtag && html`
        <div class="flex items-center gap-2 mb-4">
          <${Badge} tone="signal">${activeHashtag}<//>
          <button type="button" onClick=${() => setActiveHashtag(null)} class="text-xs text-graphite-500 hover:text-graphite-300">${t("feed.clearFilter")}</button>
        </div>
      `}

      ${heldIds.size > 0 && html`
        <button type="button" class="feed-newpill" data-testid="feed-new-pill" onClick=${showHeld}>
          <${Icon} name="arrowUp" size=${15} />${t("feed.newPosts", { count: heldIds.size })}
        </button>`}

      ${shared && html`
        <div class="feed-shared mb-4" data-testid="feed-shared">
          <div class="feed-shared-head"><span class="sk-caption">${t("feed.sharedTitle")}</span>
            <button type="button" class="text-xs text-graphite-500 hover:text-graphite-300" onClick=${() => { setShared(null); navigate("/app/feed"); }}>${t("common.close")}</button></div>
          <${PostCard} ...${{ ...cardProps(shared, 0), key: `shared-${shared.id}`, highlighted: true }} />
        </div>`}

      <!-- Gated on posts.length === 0, not just loading: every like/save/comment
           reload sets loading=true again via invalidatePosts(), and this list
           has to stay mounted through that (stale posts, fresh in the
           background) or every PostCard remounts fresh -- snapping shut
           whichever card's comment thread was open. -->
      ${loading && posts.length === 0 && html`
        <div class="space-y-3">
          ${[0, 1].map((i) => html`
            <div key=${i} class="sk-panel-flat rounded-xl p-4">
              <div class="flex gap-3">
                <${Skeleton} className="h-8 w-8 rounded-full shrink-0" />
                <div class="flex-1 min-w-0">
                  <${Skeleton} className="h-4 w-32" />
                  <${Skeleton} className="h-3 w-full mt-2.5" />
                  <${Skeleton} className="h-3 w-2/3 mt-1.5" />
                </div>
              </div>
            </div>
          `)}
        </div>
      `}

      ${error && html`
        <${EmptyState} title=${t("feed.loadErrorTitle")} body=${t("feed.loadErrorBody")} icon="globe"
          action=${html`<${Button} onClick=${() => invalidatePosts()}>${t("common.retry")}<//>`} />
      `}

      ${empty && html`
        <${EmptyState} title=${t("feed.emptyTitle")} body=${t("feed.emptyBody")} icon="globe" />
      `}

      ${tabEmpty && view === "friends" && html`
        <${EmptyState} title=${t("feed.friendsEmptyTitle")} body=${t(friends.length ? "feed.friendsEmptyBody" : "feed.friendsNoneBody")} icon="friends"
          action=${friends.length ? null : html`<${Button} onClick=${() => navigate("/app/friends")}>${t("feed.findFriends")}<//>`} />
      `}
      ${tabEmpty && view === "mine" && html`
        <${EmptyState} title=${t("feed.mineEmptyTitle")} body=${t("feed.mineEmptyBody")} icon="comment"
          action=${html`<${Button} onClick=${scrollToComposer}>${t("feed.writeFirst")}<//>`} />
      `}

      ${!loading && !error && inView.length > 0 && visiblePosts.length === 0 && html`
        <${EmptyState} title=${t("feed.noHashtagTitle")} body=${t("feed.noHashtagBody", { tag: activeHashtag })} icon="search" />
      `}

      ${!error && visiblePosts.length > 0 && html`
        <div class="space-y-3" data-testid="feed-list">
          ${visiblePosts.map((post, i) => html`<${PostCard} ...${cardProps(post, i)} />`)}
        </div>
      `}

      ${!error && hasMore && html`
        <div ref=${sentinelRef} class="feed-more" data-testid="feed-more">
          ${moreError
            ? html`<${Button} variant="secondary" size="sm" onClick=${() => loadMorePosts()}>${t("feed.loadMoreFailed")}<//>`
            : html`<${Button} variant="secondary" size="sm" loading=${loadingMore} onClick=${() => loadMorePosts()}>${t("feed.loadMore")}<//>`}
        </div>`}

      <div ref=${composerRef} style="display:contents"><${Composer} t=${t} profile=${profile} onPosted=${onPosted} /></div>

      ${confirmMounted && html`
        <div class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-4" data-state=${confirmPhase} onClick=${(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <${Card} className="sk-overlay-anim sk-overlay-anim-center max-w-sm p-5" data-state=${confirmPhase}>
            <div class="font-semibold text-graphite-100">${t("feed.confirmDeleteTitle")}</div>
            <p class="text-sm text-graphite-500 mt-1.5">${t("feed.confirmDeleteBody")}</p>
            <div class="flex justify-end gap-2 mt-5">
              <${Button} variant="secondary" size="sm" onClick=${() => setConfirmDelete(null)}>${t("common.cancel")}<//>
              <${Button} variant="danger" size="sm" disabled=${deleting} onClick=${doDelete}>${t("common.delete")}<//>
            </div>
          <//>
        </div>
      `}

    </div>
  `;
}
