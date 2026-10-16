// Quests tab: the day's three quests, the clear bonus, the streak.
import { html } from "../../lib/preact.js";
import { Button, Badge, ProgressBar } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { addDays } from "../../lib/arena/rules.js";
import { nf } from "./parts.js";

const KIND_ICON = { votes: "bolt", families: "globe", dims: "sliders", combo: "flame", eye: "target", time: "clock" };

function questValue(q) {
  return q.kind === "time" ? Math.floor(q.progress / 60) : q.progress;
}
function questTarget(q) {
  return q.kind === "time" ? Math.round(q.target / 60) : q.target;
}

function QuestCard({ q, onClaim }) {
  const t = useT();
  return html`
    <article class="ar-quest sk-panel" data-done=${q.done} data-claimed=${q.claimed} data-tier=${q.tier} data-testid="arena-quest" data-quest=${q.id}>
      <span class="sk-tile"><${Icon} name=${KIND_ICON[q.kind] ?? "bolt"} size=${15} /></span>
      <div class="ar-quest-main">
        <div class="ar-quest-title">${t(`arena.quest.${q.kind}`, { n: questTarget(q) })}</div>
        <div class="ar-quest-meta"><span class="sk-caption">${t(`arena.tier.${q.tier}`)}</span></div>
        <div class="ar-quest-bar"><${ProgressBar} value=${q.progress / q.target} /><span class="sk-num ar-quest-num">${nf(questValue(q))}<span class="sk-unit">/ ${nf(questTarget(q))}</span></span></div>
      </div>
      <div class="ar-quest-side">
        <span class="ar-quest-xp sk-num">+${q.xp}<span class="sk-unit">XP</span></span>
        ${q.claimed
          ? html`<${Badge} tone="emerald">${t("arena.quests.claimed")}<//>`
          : html`<${Button} size="sm" disabled=${!q.done} variant=${q.done ? "primary" : "secondary"} onClick=${() => onClaim(q.id)} data-testid="arena-claim">${t("arena.quests.claim")}<//>`}
      </div>
    </article>
  `;
}

function StreakCard({ view }) {
  const t = useT();
  const week = view.heat.slice(-7);
  const today = view.today.day;
  return html`
    <article class="ar-streak-card sk-panel" data-testid="arena-streak">
      <div class="ar-streak-top">
        <span class="sk-tile"><${Icon} name="flame" size=${15} /></span>
        <span class="sk-caption">${t("arena.quests.streakTitle")}</span>
      </div>
      <div class="ar-streak-big sk-num">${view.streak}<span class="sk-unit">${t("arena.quests.days")}</span></div>
      <div class="ar-week" aria-hidden="true">
        ${week.map((d) => html`<span key=${d.day} class="ar-week-day" data-on=${d.votes > 0} data-today=${d.day === today}><i></i><b>${new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</b></span>`)}
      </div>
      <p class="ar-streak-note">${view.streakDoneToday ? t("arena.quests.streakSafe") : view.streak > 0 ? t("arena.quests.streakRisk") : t("arena.quests.streakStart")}</p>
      <div class="ar-streak-best sk-caption">${t("arena.quests.best")}: <span class="sk-num">${view.bestStreak}</span></div>
    </article>
  `;
}

export function QuestsTab({ arena }) {
  const t = useT();
  const { view, actions, ready } = arena;
  if (!ready || !view) return html`<div class="ar-quests"></div>`;
  return html`
    <div class="ar-quests-grid">
      <div class="ar-quests">
        <div class="ar-quests-head">
          <span class="sk-caption">${t("arena.quests.today")}</span>
          <span class="ar-muted">${t("arena.quests.resetNote")}</span>
        </div>
        ${view.quests.map((q) => html`<${QuestCard} key=${q.id} q=${q} onClaim=${actions.claim} />`)}
        <article class="ar-quest ar-quest-clear sk-panel" data-done=${view.clear.ready || view.clear.claimed} data-claimed=${view.clear.claimed}>
          <span class="sk-tile"><${Icon} name="medal" size=${15} /></span>
          <div class="ar-quest-main">
            <div class="ar-quest-title">${t("arena.quests.clearTitle")}</div>
            <div class="ar-quest-meta"><span class="ar-muted">${t("arena.quests.clearBody")}</span></div>
          </div>
          <div class="ar-quest-side">
            <span class="ar-quest-xp sk-num">+${view.clear.bonus}<span class="sk-unit">XP</span></span>
            ${view.clear.claimed
              ? html`<${Badge} tone="emerald">${t("arena.quests.claimed")}<//>`
              : html`<${Button} size="sm" disabled=${!view.clear.ready} variant=${view.clear.ready ? "primary" : "secondary"} onClick=${() => actions.claim("daily_clear")} data-testid="arena-claim-clear">${t("arena.quests.claim")}<//>`}
          </div>
        </article>
      </div>
      <${StreakCard} view=${view} />
    </div>
  `;
}
