import { html, useState, useRef, useMemo, useEffect } from "../lib/preact.js";
import { Card, SectionHeading, Button, Badge, EmptyState, toast, Skeleton, LoadingState } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { useT } from "../lib/i18n.js";
import { useMyProfile } from "../lib/profile.js";
import { getCurrentUser } from "../lib/auth.js";
import { usePosts, createPost, deletePost, invalidatePosts } from "../lib/postsStore.js";
import { toggleLike, toggleSave, fetchComments, createComment, deleteComment } from "../lib/postInteractions.js";
import { uploadPostImage, validateAssetFile } from "../lib/storage.js";
import { relativeDate } from "../lib/format.js";
import { withTimeout } from "../lib/async.js";
import { moderatePost } from "../lib/profanityFilter.js";
import { useMountTransition, useMountedValue } from "../lib/motion.js";
import { AuthorCard } from "../components/authorCard.js";
import { invalidateFavorites } from "../lib/favoritesStore.js";

const MAX_LEN = 2000;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** Splits a post body into plain-text chunks and clickable hashtag buttons. */
function renderPostBody(body, onHashtagClick) {
  const parts = [];
  let lastIndex = 0;
  const re = new RegExp(HASHTAG_RE);
  let match;
  while ((match = re.exec(body))) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    const tag = match[0];
    parts.push(html`<button type="button" key=${`${match.index}-${tag}`}
      onClick=${() => onHashtagClick(tag)}
      class="text-signal-300 hover:text-signal-200 font-medium">${tag}</button>`);
    lastIndex = match.index + tag.length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}

function initialsFor(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function Avatar({ name, url, size = 36 }) {
  if (url) {
    return html`<img src=${url} class="rounded-full object-cover shrink-0" style=${{ width: `${size}px`, height: `${size}px` }} />`;
  }
  return html`
    <div class="shrink-0 rounded-full sk-avatar flex items-center justify-center font-semibold"
      style=${{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, size * 0.38)}px` }}>
      ${name ? initialsFor(name) : html`<${Icon} name="user" size=${Math.round(size * 0.55)} />`}
    </div>
  `;
}

const COMPOSER_MIN_H = 44;
const COMPOSER_MAX_H = 240;

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_H), COMPOSER_MAX_H)}px`;
}

function Composer({ t, profile }) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  // Preview is a local blob: URL for the selected file, revoked whenever it
  // changes or the composer unmounts so we don't leak object URLs.
  useEffect(() => {
    if (!imageFile) { setImagePreview(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function onInput(e) {
    setDraft(e.target.value.slice(0, MAX_LEN));
    autoGrow(e.target);
  }

  function onPickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    try {
      validateAssetFile(file);
      setImageFile(file);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  async function submit(e) {
    e.preventDefault();
    const rawBody = draft.trim();
    if (!rawBody || posting) return;

    const mod = moderatePost(rawBody);
    if (mod.action === "block") {
      toast(t("feed.profanityBlocked"), "rose");
      return;
    }

    setPosting(true);
    try {
      let imageUrl = null;
      if (imageFile) {
        const authorId = getCurrentUser()?.id;
        const uploaded = await withTimeout(uploadPostImage({ authorId, file: imageFile }), 20000);
        imageUrl = uploaded.url;
      }
      await withTimeout(createPost(mod.text, imageUrl), 15000);
      setDraft("");
      setImageFile(null);
      autoGrow(taRef.current);
      toast(t(mod.action === "censor" ? "feed.postedCensored" : "feed.posted"), mod.action === "censor" ? "amber" : "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setPosting(false);
    }
  }

  return html`
    <${Card} className="p-5 mt-6">
      <form onSubmit=${submit}>
        <div class="flex gap-3 items-start">
          <div class="pt-1.5"><${Avatar} name=${profile?.full_name} url=${profile?.avatar_url} /></div>
          <div class="flex-1 min-w-0">
            <textarea
              ref=${taRef}
              placeholder=${t("feed.composerPlaceholder")}
              value=${draft}
              onInput=${onInput}
              rows="1"
              style=${{ height: `${COMPOSER_MIN_H}px` }}
              class="sk-input w-full rounded-lg px-3.5 py-2.5 text-sm text-graphite-100 placeholder:text-graphite-500 resize-none overflow-hidden leading-relaxed"
            ></textarea>

            ${imagePreview && html`
              <div class="relative inline-block mt-3">
                <img src=${imagePreview} class="sk-display rounded-lg max-h-48 object-cover" />
                <button type="button" onClick=${() => setImageFile(null)}
                  aria-label=${t("feed.removeImage")}
                  class="sk-btn absolute -top-2 -right-2 h-6 w-6 rounded-full text-graphite-300">
                  <${Icon} name="close" size=${12} />
                <//>
              </div>
            `}

            <div class="flex items-center justify-between mt-3">
              <div class="flex items-center gap-3">
                <span class="text-xs text-graphite-500">${draft.length}/${MAX_LEN}</span>
                <button type="button" onClick=${() => fileRef.current?.click()}
                  class="text-graphite-500 hover:text-signal-300 transition-colors" aria-label=${t("feed.addImage")}>
                  <${Icon} name="image" size=${18} />
                <//>
                <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onChange=${onPickImage} />
              </div>
              <${Button} type="submit" loading=${posting} disabled=${!draft.trim()}>
                ${!posting && html`<${Icon} name="plus" size=${16} />`} ${posting ? t("feed.posting") : t("feed.publish")}
              <//>
            </div>
          </div>
        </div>
      </form>
    <//>
  `;
}

function ActionButton({ icon, filled = false, label, count, active = false, tone = "neutral", onClick, disabled = false, className = "" }) {
  const toneClass = active
    ? (tone === "rose" ? "text-rose-400" : tone === "signal" ? "text-signal-300" : "text-graphite-200")
    : "text-graphite-500 hover:text-graphite-300";
  // A quick pop exactly when this flips INTO its active state (liking,
  // saving) -- not on mount, and not on the way back out.
  const [popping, setPopping] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      setPopping(true);
      const timer = setTimeout(() => setPopping(false), 320);
      wasActive.current = active;
      return () => clearTimeout(timer);
    }
    wasActive.current = active;
    return undefined;
  }, [active]);
  return html`
    <button type="button" onClick=${onClick} disabled=${disabled} aria-label=${label} aria-pressed=${active}
      class=${`flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${toneClass} ${className}`}>
      <${Icon} name=${icon} size=${16} filled=${filled} className=${popping ? "sk-icon-pop" : ""} />
      ${count > 0 && html`<span>${count}</span>`}
    <//>
  `;
}

function CommentThread({ post, t, currentUserId, canModerate, onCountChange, onAuthorClick }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const fresh = await fetchComments(post.id);
      setComments(fresh);
      onCountChange(fresh.length);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [post.id]);

  async function submit(e) {
    e.preventDefault();
    const raw = draft.trim();
    if (!raw || posting) return;

    const mod = moderatePost(raw);
    if (mod.action === "block") {
      toast(t("feed.profanityBlocked"), "rose");
      return;
    }

    setPosting(true);
    try {
      await withTimeout(createComment({ postId: post.id, postAuthorId: post.authorId, body: mod.text }), 15000);
      setDraft("");
      await load();
      invalidatePosts(); // refreshes this card's comment count
      toast(t(mod.action === "censor" ? "feed.commentPostedCensored" : "feed.commentPosted"), mod.action === "censor" ? "amber" : "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setPosting(false);
    }
  }

  async function onDelete(id) {
    try {
      await deleteComment(id);
      setComments((prev) => {
        const next = prev.filter((c) => c.id !== id);
        onCountChange(next.length);
        return next;
      });
      invalidatePosts();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  return html`
    <div class="mt-3 pt-3 border-t border-black/30 space-y-3">
      ${loading && html`<${LoadingState} compact className="py-1" label=${t("common.loading")} />`}
      ${!loading && comments.length === 0 && html`<div class="text-xs text-graphite-500">${t("feed.noComments")}</div>`}
      ${!loading && comments.map((c) => {
        const hasProfile = !!c.authorName;
        const openAuthor = () => hasProfile && onAuthorClick(c);
        return html`
        <div key=${c.id} class="flex gap-2.5 items-start">
          <button type="button" onClick=${openAuthor} disabled=${!hasProfile}
            class=${`shrink-0 rounded-full ${hasProfile ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}>
            <${Avatar} name=${c.authorName} url=${c.authorAvatarUrl} size=${26} />
          <//>
          <div class="flex-1 min-w-0">
            <div class="sk-display rounded-lg px-3 py-2">
              <div class="flex items-center justify-between gap-2">
                <button type="button" onClick=${openAuthor} disabled=${!hasProfile}
                  class=${`text-xs font-medium text-graphite-200 ${hasProfile ? "hover:underline cursor-pointer" : "cursor-default"}`}>
                  ${c.authorName ?? t("feed.unknownAuthor")}
                <//>
                ${(c.authorId === currentUserId || canModerate) && html`
                  <button type="button" onClick=${() => onDelete(c.id)} aria-label=${t("feed.deleteComment")}
                    class="shrink-0 text-graphite-600 hover:text-rose-400 transition-colors">
                    <${Icon} name="trash" size=${12} />
                  <//>
                `}
              </div>
              <p class="text-sm text-graphite-300 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">${c.body}</p>
            </div>
            <div class="text-[11px] text-graphite-500 mt-1">${relativeDate(c.createdAt)}</div>
          </div>
        </div>
      `;
      })}

      <form onSubmit=${submit} class="flex items-center gap-2.5 pt-1">
        <input value=${draft} onInput=${(e) => setDraft(e.target.value.slice(0, 1000))}
          placeholder=${t("feed.commentPlaceholder")}
          class="sk-input flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-graphite-100 placeholder:text-graphite-500" />
        <${Button} type="submit" size="sm" className="shrink-0" loading=${posting} disabled=${!draft.trim()}>${t("feed.commentSubmit")}<//>
      </form>
    </div>
  `;
}

export function PostCard({ post, index = 0, t, onHashtagClick, canDelete, canModerate, currentUserId, onDeleteClick, onAuthorClick }) {
  const hasProfile = !!post.authorName;
  const openAuthor = () => hasProfile && onAuthorClick(post);
  const [likeBusy, setLikeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { mounted: commentsMounted, phase: commentsPhase } = useMountTransition(commentsOpen);
  const { mounted: lightboxMounted, phase: lightboxPhase } = useMountTransition(lightboxOpen);
  // post.commentCount comes from the posts list's own fetch, which can go
  // stale the moment someone ELSE comments (no realtime on comments, only
  // on notifications) -- once the thread has actually been fetched, this
  // holds the true count instead, so the badge and the open thread below
  // it can never visibly disagree the way they did before this existed.
  const [liveCommentCount, setLiveCommentCount] = useState(null);
  const commentCount = liveCommentCount ?? post.commentCount;

  async function onToggleLike() {
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      await toggleLike(post.id, post.viewerLiked);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setLikeBusy(false);
    }
  }

  async function onToggleSave() {
    if (saveBusy) return;
    setSaveBusy(true);
    try {
      await toggleSave(post.id, post.viewerSaved);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setSaveBusy(false);
    }
  }

  return html`
    <div class="sk-panel-flat rounded-xl p-4 slide-up" style=${`animation-delay:${Math.min(index, 6) * 40}ms`}>
      <div class="flex gap-3 items-start">
        <button type="button" onClick=${openAuthor} disabled=${!hasProfile}
          class=${`shrink-0 rounded-full ${hasProfile ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}>
          <${Avatar} name=${post.authorName} url=${post.authorAvatarUrl} size=${32} />
        <//>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-baseline gap-2 flex-wrap">
              <button type="button" onClick=${openAuthor} disabled=${!hasProfile}
                class=${`text-sm font-medium text-graphite-100 ${hasProfile ? "hover:underline cursor-pointer" : "cursor-default"}`}>
                ${post.authorName ?? t("feed.unknownAuthor")}
              <//>
              <span class="text-xs text-graphite-500">${relativeDate(post.createdAt)}</span>
            </div>
            ${canDelete && html`
              <button type="button" onClick=${() => onDeleteClick(post)} aria-label=${t("feed.deletePost")}
                class="shrink-0 text-graphite-600 hover:text-rose-400 transition-colors">
                <${Icon} name="trash" size=${15} />
              <//>
            `}
          </div>
          <p class="text-sm text-graphite-300 mt-1 leading-relaxed whitespace-pre-wrap break-words">${renderPostBody(post.body, onHashtagClick)}</p>
          ${post.imageUrl && html`
            <img src=${post.imageUrl} onClick=${() => setLightboxOpen(true)}
              class="sk-display rounded-lg mt-3 max-h-96 w-full object-cover cursor-zoom-in" />
          `}

          <div class="flex items-center gap-5 mt-3.5 pt-3 border-t border-black/30">
            <${ActionButton} icon="heart" filled=${post.viewerLiked} active=${post.viewerLiked} tone="rose"
              label=${t("feed.like")} count=${post.likeCount} disabled=${likeBusy} onClick=${onToggleLike} />
            <${ActionButton} icon="comment" active=${commentsOpen}
              label=${t("feed.comment")} count=${commentCount} onClick=${() => setCommentsOpen((v) => !v)} />
            <${ActionButton} icon="bookmark" filled=${post.viewerSaved} active=${post.viewerSaved} tone="signal"
              label=${t("feed.save")} disabled=${saveBusy} onClick=${onToggleSave} className="ml-auto" />
          </div>

          ${commentsMounted && html`
            <div class="sk-expand-anim" data-state=${commentsPhase}>
              <${CommentThread} post=${post} t=${t} currentUserId=${currentUserId} canModerate=${canModerate} onCountChange=${setLiveCommentCount} onAuthorClick=${onAuthorClick} />
            </div>
          `}
        </div>
      </div>

      ${lightboxMounted && html`
        <div
          class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          data-state=${lightboxPhase}
          onClick=${(e) => e.target === e.currentTarget && setLightboxOpen(false)}
        >
          <button type="button" onClick=${() => setLightboxOpen(false)} aria-label=${t("common.close")}
            class="sk-btn absolute top-4 right-4 h-9 w-9 rounded-lg text-graphite-300 hover:text-white">
            <${Icon} name="close" size=${20} />
          <//>
          <img src=${post.imageUrl} data-state=${lightboxPhase} class="sk-overlay-anim sk-overlay-anim-center max-w-full max-h-full object-contain rounded-lg" />
        </div>
      `}
    </div>
  `;
}

export function Feed() {
  const t = useT();
  const { profile } = useMyProfile();
  const currentUserId = getCurrentUser()?.id;
  const { posts, loading, error } = usePosts();
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
      invalidateFavorites(); // a deleted post can't stay in anyone's saved list either
      toast(t("feed.postDeleted"), "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setDeleting(false);
    }
  }

  return html`
    <div>
      <${SectionHeading} title=${t("feed.title")} subtitle=${t("feed.subtitle")} />

      ${activeHashtag && html`
        <div class="flex items-center gap-2 mb-4">
          <${Badge} tone="signal">${activeHashtag}<//>
          <button type="button" onClick=${() => setActiveHashtag(null)} class="text-xs text-graphite-500 hover:text-graphite-300">${t("feed.clearFilter")}</button>
        </div>
      `}

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

      ${!loading && !error && posts.length === 0 && html`
        <${EmptyState} title=${t("feed.emptyTitle")} body=${t("feed.emptyBody")} icon="globe" />
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

      <${Composer} t=${t} profile=${profile} />

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

      <${AuthorCard} author=${authorPost} mounted=${authorMounted} phase=${authorPhase} onClose=${() => setViewingAuthor(null)} t=${t} />
    </div>
  `;
}
