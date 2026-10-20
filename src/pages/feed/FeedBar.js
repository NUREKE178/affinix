// Above the posts: who's posts (all / friends / mine), the order (new / popular), and the tags people are using.
import { html, useRef } from "../../lib/preact.js";
import { useThumb } from "../../lib/thumb.js";
import { Tabs } from "../../components/ui.js";

export function FeedBar({ t, view, onView, sort, onSort, tags, activeTag, onTag }) {
  const sortHost = useRef(null);
  const sortThumb = useRef(null);
  useThumb(sortHost, sortThumb, sort);
  const tabs = [
    { id: "all", label: t("feed.tabAll") },
    { id: "friends", label: t("feed.tabFriends") },
    { id: "mine", label: t("feed.tabMine") },
  ];
  return html`
    <div class="feed-bar mb-4" data-testid="feed-bar">
      <div class="feed-bar-row">
        <div data-testid="feed-tabs"><${Tabs} tabs=${tabs} active=${view} onChange=${onView} /></div>
        <div class="feed-sort sk-thumbhost" role="group" aria-label=${t("feed.sortLabel")} ref=${sortHost}>
          <span class="sk-thumb" ref=${sortThumb} aria-hidden="true"></span>
          ${["new", "top"].map((id) => html`
            <button key=${id} type="button" class="feed-sort-btn" data-active=${sort === id} data-testid=${`feed-sort-${id}`} aria-pressed=${sort === id} onClick=${() => onSort(id)}>
              ${t(id === "new" ? "feed.sortNew" : "feed.sortTop")}
            </button>`)}
        </div>
      </div>
      ${tags.length > 0 && html`
        <div class="feed-tags" data-testid="feed-trending" aria-label=${t("feed.trendingTitle")}>
          <span class="feed-tags-label">${t("feed.trendingTitle")}</span>
          ${tags.map((x) => html`
            <button key=${x.tag} type="button" class="feed-tag" data-active=${activeTag?.toLowerCase() === x.tag} data-testid="feed-trend-tag" onClick=${() => onTag(activeTag?.toLowerCase() === x.tag ? null : x.tag)}>
              ${x.tag}<b>${x.count}</b>
            </button>`)}
        </div>`}
    </div>
  `;
}
