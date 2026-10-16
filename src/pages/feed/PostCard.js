// One post: author, text (links and hashtags clickable, long ones folded), picture, like / comment / save, comments,
// and for its author an inline editor. Also used by the Favorites page.
import { html, useState, useRef, useEffect } from "../../lib/preact.js";
import { Button, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { toggleLike, toggleSave } from "../../lib/postInteractions.js";
import { updatePost } from "../../lib/postsStore.js";
import { timeAgo } from "../../lib/format.js";
import { withTimeout } from "../../lib/async.js";
import { moderatePost } from "../../lib/profanityFilter.js";
import { useMountTransition } from "../../lib/motion.js";
import { Avatar, richNodes, copyPostLink } from "./parts.js";
import { CommentThread } from "./CommentThread.js";

const MAX_LEN = 2000;
const FOLD_CHARS = 420;
const FOLD_LINES = 7;
const EDITED_AFTER_MS = 3000; // the database stamps updated_at on insert too; a real edit is later than that

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

function IconButton({ icon, label, onClick, tone = "", testid }) {
  return html`
    <button type="button" onClick=${onClick} aria-label=${label} title=${label} data-testid=${testid}
      class=${`shrink-0 text-graphite-600 transition-colors ${tone === "danger" ? "hover:text-rose-400" : "hover:text-graphite-200"}`}>
      <${Icon} name=${icon} size=${15} />
    <//>
  `;
}

/** The text of one's own post as a box: Ctrl+Enter saves, Esc leaves. */
function PostEditor({ post, t, onClose }) {
  const [text, setText] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  function grow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 76), 320)}px`;
  }
  useEffect(() => {
    const el = ref.current;
    grow();
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  async function save() {
    const raw = text.trim();
    if (!raw || saving) return;
    if (raw === post.body) { onClose(); return; }
    const mod = moderatePost(raw);
    if (mod.action === "block") { toast(t("feed.profanityBlocked"), "rose"); return; }
    setSaving(true);
    try {
      await withTimeout(updatePost(post.id, mod.text), 15000);
      toast(t(mod.action === "censor" ? "feed.postEditedCensored" : "feed.postEdited"), mod.action === "censor" ? "amber" : "emerald");
      onClose();
    } catch (err) {
      toast(err?.message === "not_yours" ? t("feed.editNotAllowed") : err.message ?? String(err), "rose");
      setSaving(false);
      requestAnimationFrame(() => ref.current?.focus()); // so Esc / Ctrl+Enter work again right away
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  }

  return html`
    <div class="mt-2" data-testid="feed-editor" onKeyDown=${onKeyDown}>
      <textarea ref=${ref} value=${text} maxlength=${MAX_LEN} aria-label=${t("feed.editPost")}
        onInput=${(e) => { setText(e.currentTarget.value.slice(0, MAX_LEN)); grow(); }}
        class="sk-input w-full rounded-lg px-3.5 py-2.5 text-sm text-graphite-100 resize-none leading-relaxed"></textarea>
      <div class="flex items-center justify-between mt-2.5">
        <span class="text-xs text-graphite-500">${text.length}/${MAX_LEN}</span>
        <div class="flex items-center gap-2">
          <${Button} variant="secondary" size="sm" disabled=${saving} onClick=${onClose} data-testid="feed-edit-cancel">${t("common.cancel")}<//>
          <${Button} size="sm" loading=${saving} disabled=${!text.trim()} onClick=${save} data-testid="feed-edit-save">${t("common.save")}<//>
        </div>
      </div>
    </div>
  `;
}

export function PostCard({ post, index = 0, t, onHashtagClick, canDelete, canModerate, currentUserId, onDeleteClick, onAuthorClick, highlighted = false }) {
  const hasProfile = !!post.authorName;
  const openAuthor = () => hasProfile && onAuthorClick(post);
  const own = !!currentUserId && post.authorId === currentUserId;
  const [likeBusy, setLikeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { mounted: commentsMounted, phase: commentsPhase } = useMountTransition(commentsOpen);
  const { mounted: lightboxMounted, phase: lightboxPhase } = useMountTransition(lightboxOpen);
  // post.commentCount comes from the posts list's own fetch, which can go
  // stale the moment someone ELSE comments (no realtime on comments, only
  // on notifications) -- once the thread has actually been fetched, this
  // holds the true count instead, so the badge and the open thread below
  // it can never visibly disagree the way they did before this existed.
  const [liveCommentCount, setLiveCommentCount] = useState(null);
  const commentCount = liveCommentCount ?? post.commentCount;
  const edited = !!post.updatedAt && new Date(post.updatedAt) - new Date(post.createdAt) > EDITED_AFTER_MS;
  const folded = !expanded && (post.body.length > FOLD_CHARS || (post.body.match(/\n/g)?.length ?? 0) >= FOLD_LINES);
  const foldable = post.body.length > FOLD_CHARS || (post.body.match(/\n/g)?.length ?? 0) >= FOLD_LINES;

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
    <div class=${`sk-panel-flat rounded-xl p-4 slide-up ${highlighted ? "feed-flash" : ""}`} style=${`animation-delay:${Math.min(index, 6) * 40}ms`}
      data-post-id=${post.id} data-testid="feed-post">
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
              <span class="text-xs text-graphite-500">${timeAgo(post.createdAt)}</span>
              ${edited && html`<span class="text-xs text-graphite-600 italic" data-testid="feed-edited">${t("feed.edited")}</span>`}
            </div>
            <div class="flex items-center gap-3">
              <${IconButton} icon="link" label=${t("feed.copyLink")} onClick=${() => copyPostLink(post.id, t)} testid="feed-copy-link" />
              ${own && !editing && html`<${IconButton} icon="edit" label=${t("feed.editPost")} onClick=${() => setEditing(true)} testid="feed-edit" />`}
              ${canDelete && html`<${IconButton} icon="trash" label=${t("feed.deletePost")} tone="danger" onClick=${() => onDeleteClick(post)} />`}
            </div>
          </div>
          ${editing
            ? html`<${PostEditor} post=${post} t=${t} onClose=${() => setEditing(false)} />`
            : html`
              <p class=${`text-sm text-graphite-300 mt-1 leading-relaxed whitespace-pre-wrap break-words ${folded ? "feed-clamp" : ""}`} data-testid="feed-body">${richNodes(post.body, { onHashtag: onHashtagClick })}</p>
              ${foldable && html`<button type="button" class="feed-fold" data-testid="feed-fold" onClick=${() => setExpanded((v) => !v)}>${expanded ? t("feed.showLess") : t("feed.showMore")}</button>`}`}
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
