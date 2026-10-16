// The comments under a post: the latest few (older ones on request), a reply shortcut, and the box to write one.
import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { Button, toast, LoadingState } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { fetchComments, createComment, deleteComment } from "../../lib/postInteractions.js";
import { invalidatePosts } from "../../lib/postsStore.js";
import { withTimeout } from "../../lib/async.js";
import { moderatePost } from "../../lib/profanityFilter.js";
import { timeAgo } from "../../lib/format.js";
import { Avatar, richNodes } from "./parts.js";

const SHOWN = 3;

export function CommentThread({ post, t, currentUserId, canModerate, onCountChange, onAuthorClick }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const inputRef = useRef(null);

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
      setShowAll(true); // the new comment is the last one: keep it in view next to the ones before
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

  function reply(c) {
    const first = (c.authorName ?? "").trim().split(/\s+/)[0];
    if (!first) { inputRef.current?.focus(); return; }
    const mention = `@${first} `;
    setDraft((d) => (d.startsWith(mention) ? d : mention + d));
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  const hidden = showAll ? 0 : Math.max(0, comments.length - SHOWN);
  const shown = hidden ? comments.slice(-SHOWN) : comments;

  return html`
    <div class="mt-3 pt-3 border-t border-black/30 space-y-3" data-testid="feed-comments">
      ${loading && comments.length === 0 && html`<${LoadingState} compact className="py-1" label=${t("common.loading")} />`}
      ${!loading && comments.length === 0 && html`<div class="text-xs text-graphite-500">${t("feed.noComments")}</div>`}
      ${hidden > 0 && html`
        <button type="button" class="feed-earlier" data-testid="feed-earlier-comments" onClick=${() => setShowAll(true)}>
          ${t("feed.earlierComments", { count: hidden })}
        </button>`}
      ${shown.map((c) => {
        const hasProfile = !!c.authorName;
        const openAuthor = () => hasProfile && onAuthorClick(c);
        return html`
        <div key=${c.id} class="flex gap-2.5 items-start" data-testid="feed-comment">
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
              <p class="text-sm text-graphite-300 mt-0.5 leading-relaxed whitespace-pre-wrap break-words">${richNodes(c.body)}</p>
            </div>
            <div class="flex items-center gap-3 mt-1">
              <span class="text-[11px] text-graphite-500">${timeAgo(c.createdAt)}</span>
              ${c.authorId !== currentUserId && html`<button type="button" class="feed-reply" data-testid="feed-comment-reply" onClick=${() => reply(c)}>${t("feed.reply")}</button>`}
            </div>
          </div>
        </div>
      `;
      })}

      <form onSubmit=${submit} class="flex items-center gap-2.5 pt-1">
        <input ref=${inputRef} value=${draft} onInput=${(e) => setDraft(e.target.value.slice(0, 1000))}
          placeholder=${t("feed.commentPlaceholder")}
          class="sk-input flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-graphite-100 placeholder:text-graphite-500" />
        <${Button} type="submit" size="sm" className="shrink-0" loading=${posting} disabled=${!draft.trim()}>${t("feed.commentSubmit")}<//>
      </form>
    </div>
  `;
}
