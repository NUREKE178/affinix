import { html, useState } from "../lib/preact.js";
import { SectionHeading, Card, Button, Badge, EmptyState, Skeleton, toast } from "../components/ui.js";
import { Avatar } from "../components/avatar.js";
import { FriendButton } from "../components/friendButton.js";
import { PersonLink } from "../components/profileViewer.js";
import { Icon } from "../components/icons.js";
import { useT } from "../lib/i18n.js";
import { useFriends, useFriendStatus, acceptFriendRequest, removeFriendship } from "../lib/friendsStore.js";
import { usePeopleSearch, cleanQuery, MIN_QUERY } from "../lib/people.js";
import { openProfile } from "../lib/profileViewer.js";
import { navigate } from "../router.js";

/** One person in a friend / request list. The avatar and the name both open
 * their profile (the shared popover, see lib/profileViewer.js). */
function PersonRow({ f, t, children }) {
  const hasProfile = !!f.otherName;
  const open = () => hasProfile && openProfile(f);
  return html`
    <div class="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick=${open} disabled=${!hasProfile}
        class=${`shrink-0 rounded-full ${hasProfile ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}>
        <${Avatar} name=${f.otherName} url=${f.otherAvatarUrl} size=${40} />
      <//>
      <div class="min-w-0 flex-1">
        <button type="button" onClick=${open} disabled=${!hasProfile}
          class=${`block text-left text-sm font-medium text-graphite-100 truncate ${hasProfile ? "hover:underline cursor-pointer" : "cursor-default"}`}>
          ${f.otherName ?? t("feed.unknownAuthor")}
        <//>
        ${f.otherUsername && html`<div class="text-xs text-graphite-500 truncate">@${f.otherUsername}</div>`}
      </div>
      <div class="flex items-center gap-2 shrink-0">${children}</div>
    </div>
  `;
}

/** "Find people": by name or @username, straight from the search box. */
function FindPeople({ query, setQuery, t }) {
  const short = query.trim().length > 0 && cleanQuery(query).length < MIN_QUERY;
  return html`
    <div class="sk-find-wrap">
      <label class="sk-find sk-display flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm text-graphite-400 w-full">
        <${Icon} name="search" size=${16} className="shrink-0" />
        <input type="text" value=${query} data-testid="people-search" maxlength="40" inputmode="search" enterkeyhint="search"
          autocomplete="off" autocapitalize="off" spellcheck=${false}
          placeholder=${t("people.searchPlaceholder")} aria-label=${t("people.searchAria")}
          onInput=${(e) => setQuery(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
            else if (e.key === "Enter") e.currentTarget.blur(); // phones: the "search" key folds the keyboard away so the results are visible
          }}
          class="bg-transparent outline-none placeholder:text-graphite-500 w-full text-graphite-200" />
        ${query && html`
          <button type="button" onClick=${() => setQuery("")} aria-label=${t("people.clear")} class="sk-find-clear shrink-0" data-testid="people-clear">
            <${Icon} name="close" size=${14} />
          </button>
        `}
      </label>
      ${short && html`<p class="sk-find-hint">${t("people.searchHint", { min: MIN_QUERY })}</p>`}
    </div>
  `;
}

/** A search result: who they are, plus the one action that makes sense for
 * the relationship you already have with them. */
function ResultRow({ p, t }) {
  const { status } = useFriendStatus(p.id);
  return html`
    <div class="flex items-center gap-3 px-4 py-3" data-testid="people-row">
      <${PersonLink} who=${p} className="sk-person-grow">
        <${Avatar} name=${p.name} url=${p.avatarUrl} size=${40} />
        <span class="sk-person-text">
          <span class="sk-person-name">${p.name ?? t("feed.unknownAuthor")}</span>
          ${(p.username || p.roleTitle) && html`
            <span class="sk-person-sub">${[p.username && `@${p.username}`, p.roleTitle].filter(Boolean).join(" · ")}</span>
          `}
        </span>
      <//>
      <div class="flex items-center gap-2 shrink-0">
        ${status === "self"
          ? html`<${Badge} tone="signal">${t("people.you")}<//>`
          : status === "friends"
            ? html`<${Button} size="sm" variant="secondary" onClick=${() => navigate(`/app/messages?with=${p.id}`)}><${Icon} name="chat" size=${14} /> ${t("friends.message")}<//>`
            : html`<${FriendButton} targetUserId=${p.id} />`}
      </div>
    </div>
  `;
}

function SearchResults({ search, query, onRetry, t }) {
  const { status, results } = search;
  if (status === "error") {
    return html`<${EmptyState} icon="search" title=${t("people.errorTitle")} body=${t("people.errorBody")}
      action=${html`<${Button} variant="secondary" size="sm" onClick=${onRetry}>${t("people.retry")}<//>`} />`;
  }
  if (status !== "ready" && results.length === 0) {
    return html`
      <${Card} className="divide-y divide-graphite-800" data-testid="people-loading">
        ${[0, 1, 2].map((i) => html`
          <div key=${i} class="flex items-center gap-3 px-4 py-3">
            <${Skeleton} className="h-10 w-10 rounded-full shrink-0" />
            <div class="flex-1"><${Skeleton} className="h-4 w-32" /><${Skeleton} className="h-3 w-20 mt-1.5" /></div>
          </div>
        `)}
      <//>
    `;
  }
  if (results.length === 0) {
    return html`<${EmptyState} icon="search" title=${t("people.noResultsTitle")} body=${t("people.noResultsBody", { query: cleanQuery(query) })} />`;
  }
  return html`
    <div class=${`sk-results ${status === "loading" ? "sk-results-busy" : ""}`} data-testid="people-results">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-graphite-500 mb-2">${t("people.resultsTitle", { count: results.length })}</h3>
      <${Card} className="divide-y divide-graphite-800">
        ${results.map((p) => html`<${ResultRow} key=${p.id} p=${p} t=${t} />`)}
      <//>
    </div>
  `;
}

export function Friends() {
  const t = useT();
  const { friends, incoming, outgoing, loading, error } = useFriends();
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const search = usePeopleSearch(query, retryKey);
  const searching = cleanQuery(query).length >= MIN_QUERY;

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

  const nothingLoadedYet = loading && friends.length === 0 && incoming.length === 0 && outgoing.length === 0;

  let body;
  if (searching) {
    body = html`<${SearchResults} search=${search} query=${query} onRetry=${() => setRetryKey((n) => n + 1)} t=${t} />`;
  } else if (nothingLoadedYet) {
    body = html`
      <${Card} className="divide-y divide-graphite-800">
        ${[0, 1, 2].map((i) => html`
          <div key=${i} class="flex items-center gap-3 px-4 py-3">
            <${Skeleton} className="h-10 w-10 rounded-full shrink-0" />
            <div class="flex-1"><${Skeleton} className="h-4 w-32" /><${Skeleton} className="h-3 w-20 mt-1.5" /></div>
          </div>
        `)}
      <//>
    `;
  } else if (error) {
    body = html`<${EmptyState} title=${t("friends.loadErrorTitle")} body=${t("friends.loadErrorBody")} icon="friends" />`;
  } else {
    body = html`
      ${incoming.length > 0 && html`
        <div class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-graphite-500 mb-2">${t("friends.incomingTitle", { count: incoming.length })}</h3>
          <${Card} className="divide-y divide-graphite-800">
            ${incoming.map((f) => html`
              <${PersonRow} key=${f.id} f=${f} t=${t}>
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
              <${PersonRow} key=${f.id} f=${f} t=${t}>
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
                <${PersonRow} key=${f.id} f=${f} t=${t}>
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
    `;
  }

  return html`
    <div class="max-w-2xl">
      <${SectionHeading} title=${t("friends.title")} subtitle=${t("friends.subtitle")} />
      <${FindPeople} query=${query} setQuery=${setQuery} t=${t} />
      ${body}
    </div>
  `;
}
