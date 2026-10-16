// Small pieces the Arena tabs share: number formatting, the level plate, the
// 10-LED round ladder, the specimen well.
import { html, useMemo } from "../../lib/preact.js";
import { Icon } from "../../components/icons.js";
import { ProgressBar } from "../../components/ui.js";
import { useT, getLocale } from "../../lib/i18n.js";
import { renderSvg, getStimulus } from "../../lib/arena/stimuli.js";

export const nf = (n) => new Intl.NumberFormat(getLocale()).format(Math.round(n));

/** 3725 -> "1:02:05", 125 -> "2:05" */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

/** "2 h 05" style, for totals */
export function hoursMinutes(sec, t) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${t("common.unitMin")}`;
  return `${Math.floor(m / 60)} ${t("arena.unitHour")} ${String(m % 60).padStart(2, "0")}`;
}

export function LevelPlate({ view }) {
  const t = useT();
  return html`
    <div class="ar-level sk-panel" data-testid="arena-level">
      <div class="ar-level-num">
        <span class="sk-caption">${t("arena.level")}</span>
        <span class="sk-num ar-level-value" key=${view.level}>${String(view.level).padStart(2, "0")}</span>
      </div>
      <div class="ar-level-main">
        <div class="ar-level-rank">${t(`arena.rank.${view.rank}`)}</div>
        <${ProgressBar} value=${view.levelRatio} />
        <div class="ar-level-xp sk-num">${nf(view.levelInto)}<span class="sk-unit">/ ${nf(view.levelSpan)} XP</span></div>
      </div>
    </div>
  `;
}

/** The round as a row of LEDs: answered ones lit, the current one pulsing. */
export function Ladder({ total, idx, results, phase }) {
  const t = useT();
  return html`
    <div class="ar-ladder" role="img" aria-label=${t("arena.console.progress", { n: Math.min(idx + (phase === "reveal" ? 1 : 0), total), total })}>
      ${Array.from({ length: total }, (_, i) => {
        const r = results[i];
        const state = r ? (r.skipped ? "skip" : "done") : i === idx ? "now" : "todo";
        return html`<i key=${i} class="ar-led" data-state=${state}></i>`;
      })}
    </div>
  `;
}

/** A specimen in its well. In `reveal` it also carries the community numbers. */
export function Specimen({ stim, svg, side, state, kbd, onPick, name, children }) {
  const t = useT();
  return html`
    <button
      type="button"
      class="ar-spec"
      data-side=${side}
      data-state=${state}
      aria-disabled=${state !== "idle" ? "true" : undefined}
      aria-label=${name}
      onClick=${() => state === "idle" && onPick(side)}
    >
      <span class="ar-spec-art" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: svg }}></span>
      <span class="ar-spec-key sk-kbd" aria-hidden="true">${kbd}</span>
      <span class="ar-spec-slot">
        ${state === "idle"
          ? html`<span class="ar-spec-choose"><b>${side === 0 ? "A" : "B"}</b><span>${t("arena.console.choose")}</span></span>`
          : children}
      </span>
    </button>
  `;
}

/** A small, non-interactive specimen (lists, reports). */
export function Thumb({ season, family, index, size = 64 }) {
  const svg = useMemo(() => renderSvg(getStimulus(season, family, index)), [season, family, index]);
  return html`<span class="ar-thumb" style=${{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}

/** "day" / "days": English needs the singular for 1; Russian and Kazakh use an invariant short form. */
export function daysLabel(n, t) {
  return n === 1 ? t("arena.quests.dayOne") : t("arena.quests.days");
}

export function Glyph({ name, size = 16 }) {
  return html`<${Icon} name=${name} size=${size} />`;
}

/** Text for how sure the Taste DNA is. */
export function confidenceLabel(c, t) {
  return c >= 1 ? t("arena.dna.confFull") : c >= 0.5 ? t("arena.dna.confGood") : t("arena.dna.confLow");
}
