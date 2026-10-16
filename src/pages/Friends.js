import { html, useState } from "../lib/preact.js";
import { SectionHeading, Card, Button, Badge, EmptyState, Skeleton, toast } from "../components/ui.js";
import { Avatar } from "../components/avatar.js";
import { AuthorCard } from "../components/authorCard.js";
import { Icon } from "../components/icons.js";
import { useT } from "../lib/i18n.js";
import { useFriends, acceptFriendRequest, removeFriendship } from "../lib/friendsStore.js";
import { useMountedValue } from "../lib/motion.js";
import { navigate } from "../router.js";

/** AuthorCard expects the authorXxx-prefixed shape Feed.js's posts/comments
 * already use -- adapting a friendship row into that once here keeps the
 * popover itself unaware of friendsStore's own otherXxx naming. */
function toAuthorShape(f) {
  return { authorId: f.otherId, authorName: f.otherName, authorAvatarUrl: f.otherAvatarUrl, authorRoleTitle: f.otherRoleTitle, authorBio: f.otherBio };
}

function PersonRow({ f, t, onOpen, children }) {
  const hasProfile = !!f.otherName;
  return html`
    <div class="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick=${() => hasProfile && onOpen(f)} disabled=${!hasProfile}
        class=${`shrink-0 rounded-full ${hasProfile ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}>
        <${Avatar} name=${f.otherName} url=${f.otherAvatarUrl} size=${40} />
      <//>
      <div class="min-w-0 flex-1">
        <button type="button" onClick=${() => hasProfile && onOpen(f)} disabled=${!hasProfile}
          class=${`block text-left text-sm font-medium text-graphite-100 truncate ${hasProfile ? "hover:underline cursor-pointer" : "cursor-default"}`}>
          ${f.otherName ?? t("feed.unknownAuthor")}
        <//>
        ${f.otherUsername && html`<div class="text-xs text-graphite-500 truncate">@${f.otherUsername}</div>`}
      </div>
      <div class="flex items-center gap-2 shrink-0">${children}</div>
    </div>
  `;
}

export function Friends() {
  const t = useT();
  const { friends, incoming, outgoing, loading, error } = useFriends();
  const [busyId, setBusyId] = useState(null);
  const [viewingAuthor, setViewingAuthor] = useState(null);
  const { mounted: authorMounted, phase: authorPhase, value: authorPost } = useMountedValue(viewingAuthor);

  async function accept(f) {
    setBusyId(f.id);
    try {
      await acceptFriendRequest(f.id);
      toast(t("friends.requestAccepted"), "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRow(f, successKey) {
    setBusyId(f.id);
    try {
      await removeFriendship(f.id);
      if (successKey) toast(t(successKey));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusyId(null);
    }
  }

  const openAuthor = (f) => setViewingAuthor(toAuthorShape(f));
  const nothingLoadedYet = loading && friends.length === 0 && incoming.length === 0 && outgoing.length === 0;

  if (nothingLoadedYet) {
    return html`
      <div class="max-w-2xl">
        <${SectionHeading} title=${t("friends.title")} subtitle=${t("friends.subtitle")} />
        <${Card} className="divide-y divide-graphite-800">
          ${[0, 1, 2].map((i) => html`
            <div key=${i} class="flex items-center gap-3 px-4 py-3">
              <${Skeleton} className="h-10 w-10 rounded-full shrink-0" />
              <div class="flex-1"><${Skeleton} className="h-4 w-32" /><${Skeleton} className="h-3 w-20 mt-1.5" /></div>
            </div>
          `)}
        <//>
      </div>
    `;
  }

  if (error) {
    return html`
      <div class="max-w-2xl">
        <${SectionHeading} title=${t("friends.title")} subtitle=${t("friends.subtitle")} />
        <${EmptyState} title=${t("friends.loadErrorTitle")} body=${t("friends.loadErrorBody")} icon="friends" />
      </div>
    `;
  }

  return html`
    <div class="max-w-2xl">
      <${SectionHeading} title=${t("friends.title")} subtitle=${t("friends.subtitle")} />

      ${incoming.length > 0 && html`
        <div class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-graphite-500 mb-2">${t("friends.incomingTitle", { count: incoming.length })}</h3>
          <${Card} className="divide-y divide-graphite-800">
            ${incoming.map((f) => html`
              <${PersonRow} key=${f.id} f=${f} t=${t} onOpen=${openAuthor}>
                <${Button} size="sm" disabled=${busyId === f.id} onClick=${() => accept(f)}>
                  <${Icon} name="check" size=${14} /> ${t("friends.accept")}
                <//>
                <button type="button" onClick=${() => removeRow(f)} disabled=${busyId === f.id} aria-label=${t("friends.decline")}
                  class="sk-btn h-8 w-8 rounded-lg text-graphite-500 hover:text-rose-400">
                  <${Icon} name="close" size=${15} />
                <//>
              <//>
            `)}
          <//>
        </div>
      `}

      ${outgoing.length > 0 && html`
        <div class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-graphite-500 mb-2">${t("friends.outgoingTitle", { count: outgoing.length })}</h3>
          <${Card} className="divide-y divide-graphite-800">
            ${outgoing.map((f) => html`
              <${PersonRow} key=${f.id} f=${f} t=${t} onOpen=${openAuthor}>
                <${Badge} tone="neutral">${t("friends.requestSent")}<//>
                <button type="button" onClick=${() => removeRow(f)} disabled=${busyId === f.id} class="text-xs text-graphite-500 hover:text-rose-400 transition-colors">${t("friends.cancel")}</button>
              <//>
            `)}
          <//>
        </div>
      `}

      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-graphite-500 mb-2">${t("friends.friendsTitle", { count: friends.length })}</h3>
        ${friends.length === 0
          ? html`<${EmptyState} title=${t("friends.emptyTitle")} body=${t("friends.emptyBody")} icon="friends" />`
          : html`
            <${Card} className="divide-y divide-graphite-800">
              ${friends.map((f) => html`
                <${PersonRow} key=${f.id} f=${f} t=${t} onOpen=${openAuthor}>
                  <${Button} size="sm" variant="secondary" onClick=${() => navigate(`/app/messages?with=${f.otherId}`)}>
                    <${Icon} name="chat" size=${14} /> ${t("friends.message")}
                  <//>
                  <button type="button" onClick=${() => removeRow(f, "friends.removedToast")} disabled=${busyId === f.id}
                    class="text-xs text-graphite-500 hover:text-rose-400 transition-colors">${t("friends.remove")}</button>
                <//>
              `)}
            <//>
          `}
      </div>

      <${AuthorCard} author=${authorPost} mounted=${authorMounted} phase=${authorPhase} onClose=${() => setViewingAuthor(null)} t=${t} />
    </div>
  `;
}
