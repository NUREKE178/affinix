// Arena: design duels with XP, streaks, quests, rankings and a personal Taste DNA.
// The page is a thin frame; the tabs live in pages/arena/, the state in lib/arenaStore.js.
import { html, useEffect } from "../lib/preact.js";
import { Tabs, Skeleton } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { useT } from "../lib/i18n.js";
import { navigate } from "../router.js";
import { useArena, startActivityTracking } from "../lib/arenaStore.js";
import { LevelPlate } from "./arena/parts.js";
import { PlayTab } from "./arena/Play.js";
import { QuestsTab } from "./arena/Quests.js";
import { RankingsTab } from "./arena/Rankings.js";
import { ProfileTab } from "./arena/Profile.js";

const TAB_IDS = ["play", "quests", "rankings", "profile"];

export function Arena({ query }) {
  const t = useT();
  const arena = useArena();
  const { view, ready } = arena;
  const requested = query?.get("tab");
  const tab = TAB_IDS.includes(requested) ? requested : "play";

  // time in the Arena counts while this page is open and the player is actually here
  useEffect(() => startActivityTracking(), []);

  const claimable = view
    ? view.quests.filter((q) => q.done && !q.claimed).length + (view.daily.done && !view.daily.claimed ? 1 : 0) + (view.clear.ready ? 1 : 0)
    : 0;
  const tabs = [
    { id: "play", label: t("arena.tabs.play") },
    { id: "quests", label: html`${t("arena.tabs.quests")}${claimable > 0 ? html`<span class="sk-count" data-testid="arena-claimable">${claimable}</span>` : null}` },
    { id: "rankings", label: t("arena.tabs.rankings") },
    { id: "profile", label: t("arena.tabs.profile") },
  ];

  return html`
    <div class="ar-page" data-testid="arena-page">
      <div class="ar-head">
        <div class="ar-head-title">
          <h2>${t("arena.title")}</h2>
          <p>${t("arena.subtitle")}</p>
        </div>
        <div class="ar-head-side">
          ${ready && view
            ? html`
              <div class="ar-streak-chip" data-on=${view.streak > 0} title=${t("arena.quests.streakTitle")} data-testid="arena-streak-chip">
                <${Icon} name="flame" size=${20} />
                <div><b class="sk-num">${view.streak}</b></div>
                <span class="sk-caption">${t("arena.quests.days")}</span>
              </div>
              <${LevelPlate} view=${view} />`
            : html`<${Skeleton} className="h-14 w-72 rounded-xl" />`}
        </div>
      </div>

      <div class="ar-tabs-row">
        <${Tabs} tabs=${tabs} active=${tab} onChange=${(id) => navigate(id === "play" ? "/app/arena" : `/app/arena?tab=${id}`)} />
      </div>

      ${tab === "play" && html`<${PlayTab} arena=${arena} />`}
      ${tab === "quests" && html`<${QuestsTab} arena=${arena} />`}
      ${tab === "rankings" && html`<${RankingsTab} arena=${arena} />`}
      ${tab === "profile" && html`<${ProfileTab} arena=${arena} />`}
    </div>
  `;
}
