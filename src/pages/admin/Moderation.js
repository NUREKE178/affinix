// What to look at and remove: reported crowd tests, and the newest posts and comments of the feed.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Button, Modal, Skeleton, toast } from "../../components/ui.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { timeAgo } from "../../lib/format.js";
import { fetchRecentContent, removeContent } from "../../lib/platform.js";
import { fetchAuthorsById } from "../../lib/postsStore.js";
import { navigate } from "../../router.js";
import { CrowdModeration } from "../crowd/Moderation.js";
import { AdminError } from "./parts.js";

function Row({ item, kind, author, t, onRemove }) {
  return html`
    <div class="adm-content" data-testid=${`admin-${kind}`} data-id=${item.id}>
      <${PersonLink} who=${{ id: item.author_id, name: author?.full_name, username: author?.username, avatarUrl: author?.avatar_url }} className="adm-content-who">
        <${Avatar} name=${author?.full_name} url=${author?.avatar_url} size=${30} />
      <//>
      <div class="adm-content-main">
        <div class="adm-content-head">
          <span class="adm-content-name">${author?.full_name ?? t("feed.unknownAuthor")}</span>
          <span class="adm-content-time">${timeAgo(item.created_at)}</span>
        </div>
        <p class="adm-content-body">${item.body}</p>
        ${item.image_url && html`<span class="adm-content-img"><${Icon} name="image" size=${13} /> ${t("admin.moderation.hasImage")}</span>`}
      </div>
      <div class="adm-content-act">
        <button type="button" class="adm-link" onClick=${() => navigate(`/app/feed?post=${kind === "post" ? item.id : item.post_id}`)}>${t("admin.moderation.openInFeed")}</button>
        <${Button} size="sm" variant="danger" onClick=${() => onRemove(kind, item)} data-testid=${`admin-remove-${kind}`}>${t("admin.moderation.remove")}<//>
      </div>
    </div>
  `;
}

export function AdminModeration() {
  const t = useT();
  const [state, setState] = useState({ loading: true, posts: [], comments: [], authors: {}, error: null });
  const [confirm, setConfirm] = useState(null); // { kind, item }
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchRecentContent(20)
      .then(async (c) => {
        const authors = await fetchAuthorsById([...new Set([...c.posts, ...c.comments].map((x) => x.author_id))]).catch(() => ({}));
        if (!off) setState({ loading: false, posts: c.posts, comments: c.comments, authors, error: null });
      })
      .catch((error) => { if (!off) setState({ loading: false, posts: [], comments: [], authors: {}, error }); });
    return () => { off = true; };
  }, [tick]);

  async function remove() {
    const { kind, item } = confirm;
    setBusy(true);
    try {
      await removeContent(kind, item.id);
      setState((s) => ({ ...s, posts: kind === "post" ? s.posts.filter((p) => p.id !== item.id) : s.posts, comments: kind === "post" ? s.comments.filter((c) => c.post_id !== item.id) : s.comments.filter((c) => c.id !== item.id) }));
      toast(t("admin.moderation.removed"), "emerald");
      setConfirm(null);
    } catch (err) {
      toast(err.message ?? t("admin.errorBody"), "rose");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="adm-stack" data-testid="admin-moderation">
      <section>
        <div class="sk-caption mb-2">${t("admin.moderation.reportsTitle")}</div>
        <${CrowdModeration} />
        <p class="adm-note" data-testid="admin-reports-hint">${t("admin.moderation.reportsHint")}</p>
      </section>

      ${state.error
        ? html`<${AdminError} error=${state.error} t=${t} onRetry=${() => setTick((n) => n + 1)} />`
        : html`
          <section>
            <div class="sk-caption mb-2">${t("admin.moderation.postsTitle")}</div>
            ${state.loading ? html`<${Skeleton} className="h-24 w-full rounded-xl" />`
              : state.posts.length === 0 ? html`<p class="adm-note">${t("admin.moderation.empty")}</p>`
              : html`<div class="adm-list sk-panel">${state.posts.map((p) => html`<${Row} key=${p.id} item=${p} kind="post" author=${state.authors[p.author_id]} t=${t} onRemove=${(kind, item) => setConfirm({ kind, item })} />`)}</div>`}
          </section>
          <section>
            <div class="sk-caption mb-2">${t("admin.moderation.commentsTitle")}</div>
            ${state.loading ? html`<${Skeleton} className="h-24 w-full rounded-xl" />`
              : state.comments.length === 0 ? html`<p class="adm-note">${t("admin.moderation.empty")}</p>`
              : html`<div class="adm-list sk-panel">${state.comments.map((c) => html`<${Row} key=${c.id} item=${c} kind="comment" author=${state.authors[c.author_id]} t=${t} onRemove=${(kind, item) => setConfirm({ kind, item })} />`)}</div>`}
          </section>`}

      <${Modal} open=${!!confirm} onClose=${() => !busy && setConfirm(null)} title=${confirm ? t(confirm.kind === "post" ? "admin.moderation.confirmPostTitle" : "admin.moderation.confirmCommentTitle") : ""}
        footer=${html`<${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => setConfirm(null)}>${t("common.cancel")}<//><${Button} variant="danger" size="sm" loading=${busy} onClick=${remove} data-testid="admin-confirm-remove">${t("common.delete")}<//>`}>
        <p class="text-sm text-graphite-400">${t("admin.moderation.confirmBody")}</p>
      <//>
    </div>
  `;
}
