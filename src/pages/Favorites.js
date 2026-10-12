import { html, useState, useMemo } from "../lib/preact.js";
import { SectionHeading, Button, Badge, EmptyState, Card, toast, Skeleton } from "../components/ui.js";
import { AuthorCard } from "../components/authorCard.js";
import { useT } from "../lib/i18n.js";
import { useMyProfile } from "../lib/profile.js";
import { getCurrentUser } from "../lib/auth.js";
import { deletePost } from "../lib/postsStore.js";
import { useFavorites, invalidateFavorites } from "../lib/favoritesStore.js";
import { withTimeout } from "../lib/async.js";
import { useMountedValue } from "../lib/motion.js";
import { PostCard } from "./Feed.js";

/** Saved posts, rendered with the exact same PostCard the main feed uses --
 * same likes/comments/save toggle, same author popover, same delete flow
 * for a post the viewer owns (or can moderate). Unsaving a card here is
 * already covered for free: PostCard's own bookmark button is what saved
 * it in the first place, and toggling it off removes the post from this
 * list the moment favoritesStore reloads (toggleSave() in
 * postInteractions.js invalidates both stores, regardless of which page
 * the toggle happened on). */
export function Favorites() {
  const t = useT();
  const { profile } = useMyProfile();
  const currentUserId = getCurrentUser()?.id;
  const { posts, loading, error } = useFavorites();
  const [activeHashtag, setActiveHashtag] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [viewingAuthor, setViewingAuthor] = useState(null);
  const { mounted: confirmMounted, phase: confirmPhase, value: confirmPost } = useMountedValue(confirmDelete);
  const { mounted: authorMounted, phase: authorPhase, value: authorPost } = useMountedValue(viewingAuthor);

  const visiblePosts = useMemo(() => {
    if (!activeHashtag) return posts;
    const needle = activeHashtag.toLowerCase();
    return posts.filter((p) => p.body.toLowerCase().includes(needle));
  }, [posts, activeHashtag]);

  async function doDelete() {
    setDeleting(true);
    try {
      await withTimeout(deletePost(confirmDelete.id), 15000);
      setConfirmDelete(null);
      invalidateFavorites();
      toast(t("feed.postDeleted"), "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setDeleting(false);
    }
  }

  return html`
    <div>
      <${SectionHeading} title=${t("favorites.title")} subtitle=${t("favorites.subtitle")} />

      ${activeHashtag && html`
        <div class="flex items-center gap-2 mb-4">
          <${Badge} tone="indigo">${activeHashtag}<//>
          <button type="button" onClick=${() => setActiveHashtag(null)} class="text-xs text-slate-500 hover:text-slate-300">${t("feed.clearFilter")}</button>
        </div>
      `}

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
        <${EmptyState} title=${t("favorites.loadErrorTitle")} body=${t("favorites.loadErrorBody")} icon="bookmark"
          action=${html`<${Button} onClick=${() => invalidateFavorites()}>${t("common.retry")}<//>`} />
      `}

      ${!loading && !error && posts.length === 0 && html`
        <${EmptyState} title=${t("favorites.emptyTitle")} body=${t("favorites.emptyBody")} icon="bookmark" />
      `}

      ${!loading && !error && posts.length > 0 && visiblePosts.length === 0 && html`
        <${EmptyState} title=${t("feed.noHashtagTitle")} body=${t("feed.noHashtagBody", { tag: activeHashtag })} icon="search" />
      `}

      ${!error && visiblePosts.length > 0 && html`
        <div class="space-y-3">
          ${visiblePosts.map((post, i) => html`
            <${PostCard} key=${post.id} post=${post} index=${i} t=${t} onHashtagClick=${setActiveHashtag}
              canDelete=${post.authorId === currentUserId || !!profile?.is_admin}
              canModerate=${!!profile?.is_admin} currentUserId=${currentUserId}
              onDeleteClick=${setConfirmDelete} onAuthorClick=${setViewingAuthor} />
          `)}
        </div>
      `}

      ${confirmMounted && html`
        <div class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" data-state=${confirmPhase} onClick=${(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <${Card} className="sk-overlay-anim sk-overlay-anim-center max-w-sm p-5" data-state=${confirmPhase}>
            <div class="font-semibold text-slate-100">${t("feed.confirmDeleteTitle")}</div>
            <p class="text-sm text-slate-500 mt-1.5">${t("feed.confirmDeleteBody")}</p>
            <div class="flex justify-end gap-2 mt-5">
              <${Button} variant="secondary" size="sm" onClick=${() => setConfirmDelete(null)}>${t("common.cancel")}<//>
              <${Button} variant="danger" size="sm" disabled=${deleting} onClick=${doDelete}>${t("common.delete")}<//>
            </div>
          <//>
        </div>
      `}

      <${AuthorCard} author=${authorPost} mounted=${authorMounted} phase=${authorPhase} onClose=${() => setViewingAuthor(null)} t=${t} />
    </div>
  `;
}
