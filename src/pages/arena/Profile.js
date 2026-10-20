// Profile tab: Taste DNA, archetype, stats, activity, badges.
import { html, useState, useEffect, useMemo, useRef } from "../../lib/preact.js";
import { useThumb } from "../../lib/thumb.js";
import { StatTile, Skeleton, Badge, ProgressBar, Button, toast } from "../../components/ui.js";
import { createPost } from "../../lib/postsStore.js";
import { Icon } from "../../components/icons.js";
import { useT, getLocale } from "../../lib/i18n.js";
import { TRAIT_IDS } from "../../lib/arena/traits.js";
import { DIMENSION_IDS } from "../../lib/arena/stimuli.js";
import { addDays } from "../../lib/arena/rules.js";
import { leanOf, confidenceOf, archetypeOf, topTraits, leanStrength, standoutDifference, MIN_VOTES_FOR_TYPE, emptyDna } from "../../lib/arena/dna.js";
import { computeDna, useArenaClock } from "../../lib/arenaStore.js";
import { nf, clock, hoursMinutes, confidenceLabel } from "./parts.js";

const SHOW_SCALE = 1.8; // real leans rarely reach +-1; stretch them for the faders

function Fader({ trait, lean, t }) {
  const v = Math.max(-1, Math.min(1, lean * SHOW_SCALE));
  const pos = ((v + 1) / 2) * 100;
  const strength = leanStrength(lean);
  const pole = lean >= 0 ? "hi" : "lo";
  return html`
    <div class="ar-fader" data-testid="arena-fader" data-trait=${trait} data-strength=${strength}>
      <div class="ar-fader-labels">
        <span data-active=${strength !== "none" && lean < 0}>${t(`arena.traits.${trait}.lo`)}</span>
        <span class="ar-fader-read sk-num">${lean >= 0 ? "+" : "−"}${Math.abs(lean).toFixed(2)}</span>
        <span data-active=${strength !== "none" && lean > 0}>${t(`arena.traits.${trait}.hi`)}</span>
      </div>
      <div class="ar-fader-track" aria-hidden="true">
        <i class="ar-fader-mid"></i>
        <span class="ar-fader-fill" style=${{ left: v >= 0 ? "50%" : `${pos}%`, width: `${Math.abs(pos - 50)}%` }}></span>
        <span class="ar-fader-knob" style=${{ left: `${pos}%` }}></span>
      </div>
      <div class="ar-fader-note">${strength === "none" ? t("arena.dna.noLean") : t(`arena.dna.lean.${strength}`, { pole: t(`arena.traits.${trait}.${pole}`).toLowerCase() })}</div>
    </div>
  `;
}

function ArchetypeCard({ dna, lean, t, view }) {
  const [sharing, setSharing] = useState(false);
  const calibrated = dna.n >= MIN_VOTES_FOR_TYPE;
  const conf = confidenceOf(dna);
  if (!calibrated) {
    return html`
      <article class="ar-type sk-panel" data-testid="arena-archetype" data-ready="false">
        <span class="sk-caption">${t("arena.dna.typeTitle")}</span>
        <div class="ar-type-name">${t("arena.dna.calibrating")}</div>
        <p class="ar-type-body">${t("arena.dna.calibratingBody", { n: MIN_VOTES_FOR_TYPE })}</p>
        <${ProgressBar} value=${dna.n / MIN_VOTES_FOR_TYPE} />
        <div class="ar-type-count sk-num">${dna.n}<span class="sk-unit">/ ${MIN_VOTES_FOR_TYPE}</span></div>
      </article>
    `;
  }
  const a = archetypeOf(lean);
  const tops = topTraits(lean, 3).filter((x) => leanStrength(x.lean) !== "none");
  async function share() {
    setSharing(true);
    try {
      const traits = tops.map((x) => t(`arena.traits.${x.trait}.${x.lean >= 0 ? "hi" : "lo"}`).toLowerCase()).join(", ");
      await createPost(t("arena.share.text", { type: t(`arena.archetype.${a.id}.name`), traits, level: view.level, streak: view.streak }));
      toast(t("arena.share.done"), "emerald");
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setSharing(false);
    }
  }
  return html`
    <article class="ar-type sk-panel" data-testid="arena-archetype" data-ready="true" data-type=${a.id}>
      <span class="sk-caption">${t("arena.dna.typeTitle")}</span>
      <div class="ar-type-name">${t(`arena.archetype.${a.id}.name`)}</div>
      <p class="ar-type-body">${t(`arena.archetype.${a.id}.body`)}</p>
      <div class="ar-type-chips">
        ${tops.map((x) => html`<${Badge} key=${x.trait} tone="neutral">${t(`arena.traits.${x.trait}.${x.lean >= 0 ? "hi" : "lo"}`)}<//>`)}
      </div>
      <div class="ar-type-foot sk-caption">${t("arena.dna.basedOn", { n: dna.n })} · ${confidenceLabel(conf, t)}</div>
      <div><${Button} variant="secondary" size="sm" loading=${sharing} onClick=${share} data-testid="arena-share"><${Icon} name="send" size=${14} />${t("arena.share.cta")}<//></div>
    </article>
  `;
}

function Heatmap({ view, t }) {
  const today = view.today.day;
  const byDay = new Map(view.heat.map((d) => [d.day, d]));
  const wd = (new Date(`${today}T12:00:00`).getDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 7; row++) {
      const ago = (11 - col) * 7 + (wd - row);
      if (ago < 0) { cells.push(html`<i class="ar-heat-cell" data-level="x" key=${`${col}-${row}`}></i>`); continue; }
      const day = addDays(today, -ago);
      const d = byDay.get(day);
      const v = d?.votes ?? 0;
      const level = v === 0 ? 0 : v < 10 ? 1 : v < 30 ? 2 : v < 80 ? 3 : 4;
      cells.push(html`<i class="ar-heat-cell" key=${`${col}-${row}`} data-level=${level} data-today=${day === today} title=${`${day}: ${v} · ${hoursMinutes(d?.sec ?? 0, t)}`}></i>`);
    }
  }
  return html`<div class="ar-heat" role="img" aria-label=${t("arena.profile.heatLabel")}>${cells}</div>`;
}

function badgeText(id, t) {
  const m = /^(votes|streak|daily|level)_(\d+)$/.exec(id);
  if (m) return { name: t(`arena.badgeName.${m[1]}`, { n: nf(Number(m[2])) }), desc: t(`arena.badgeDesc.${m[1]}`, { n: nf(Number(m[2])) }) };
  return { name: t(`arena.badge.${id}.name`), desc: t(`arena.badge.${id}.desc`) };
}
const GROUP_ICON = { volume: "bolt", streak: "flame", skill: "target", level: "medal", time: "clock" };

function Badges({ view, t }) {
  const groups = ["volume", "streak", "skill", "level", "time"];
  return html`
    <section class="ar-badges sk-panel" data-testid="arena-badges">
      <div class="ar-section-head"><span class="sk-caption">${t("arena.profile.badges")}</span><span class="sk-num ar-section-count">${view.badgeCount}<span class="sk-unit">/ ${view.badges.length}</span></span></div>
      ${groups.map((g) => html`
        <div class="ar-badge-group" key=${g}>
          <div class="ar-badge-group-title">${t(`arena.badgeGroup.${g}`)}</div>
          <div class="ar-badge-grid">
            ${view.badges.filter((b) => b.group === g).map((b) => {
              const txt = badgeText(b.id, t);
              return html`
                <div class="ar-badge" key=${b.id} data-unlocked=${b.unlocked} data-testid="arena-badge" data-badge=${b.id}>
                  <span class="sk-tile ar-badge-tile"><${Icon} name=${b.unlocked ? GROUP_ICON[g] : "lock"} size=${15} /></span>
                  <div class="ar-badge-text">
                    <div class="ar-badge-name">${txt.name}</div>
                    <div class="ar-badge-desc">${txt.desc}</div>
                    ${!b.unlocked && b.progress > 0 && html`<div class="ar-badge-prog"><i style=${{ width: `${Math.round(b.progress * 100)}%` }}></i></div>`}
                  </div>
                </div>`;
            })}
          </div>
        </div>
      `)}
    </section>
  `;
}

export function ProfileTab({ arena }) {
  const t = useT();
  const { view, ready } = arena;
  const seconds = useArenaClock();
  const [dna, setDna] = useState(null);
  const [dim, setDim] = useState("all");
  const dimHost = useRef(null);
  const dimThumb = useRef(null);
  useThumb(dimHost, dimThumb, dim);

  // building the specimens behind a long history takes a moment: let the tab paint first
  useEffect(() => {
    if (!ready) return undefined;
    let off = false;
    const id = setTimeout(() => { computeDna().then((d) => { if (!off) setDna(d); }); }, 40);
    return () => { off = true; clearTimeout(id); };
  }, [ready, view?.votes]);

  if (!ready || !view) return html`<div class="ar-profile"></div>`;

  const cur = dna ? (dim === "all" ? dna.all : dna.byDim[dim] ?? emptyDna()) : null;
  const lean = cur ? leanOf(cur) : null;
  const standout = dna ? standoutDifference(dna) : null;
  const weekSeconds = view.heat.slice(-7).reduce((n, d) => n + d.sec, 0);
  const eyePct = view.eye.total ? Math.round((view.eye.correct / view.eye.total) * 100) : null;
  const crowdPct = view.crowd.total ? Math.round((view.crowd.hits / view.crowd.total) * 100) : null;
  const dimTabs = [{ id: "all", label: t("arena.dna.allQuestions") }, ...DIMENSION_IDS.map((d) => ({ id: d, label: t(`builder.dimensions.${d}.label`) }))];

  return html`
    <div class="ar-profile">
      <div class="sk-stat-strip" style="--cols:3" data-testid="arena-stats">
        <${StatTile} label=${t("arena.profile.statVotes")} value=${nf(view.votes)} hint=${t("arena.profile.statVotesHint", { n: view.familiesSeen })} />
        <${StatTile} label=${t("arena.profile.statEye")} value=${eyePct === null ? "—" : `${eyePct}%`} hint=${t("arena.profile.statEyeHint", { c: view.eye.correct, n: view.eye.total })} />
        <${StatTile} label=${t("arena.profile.statCrowd")} value=${crowdPct === null ? "—" : `${crowdPct}%`} hint=${crowdPct === null ? t("arena.profile.statCrowdNone") : t("arena.profile.statCrowdHint", { h: view.crowd.hits, n: view.crowd.total })} />
        <${StatTile} label=${t("arena.profile.statCombo")} value=${`${view.bestCombo}`} hint=${t("arena.profile.statComboHint")} />
        <${StatTile} label=${t("arena.profile.statStreak")} value=${`${view.bestStreak}`} hint=${t("arena.profile.statStreakHint", { n: view.streak })} />
        <${StatTile} label=${t("arena.profile.statTime")} value=${hoursMinutes(view.activeSeconds + (seconds - view.today.sec), t)} hint=${t("arena.profile.statTimeHint", { t: clock(view.bestDaySeconds) })} />
      </div>

      <div class="ar-dna-grid">
        <section class="ar-dna sk-panel" data-testid="arena-dna">
          <div class="ar-section-head">
            <span class="sk-caption">${t("arena.dna.title")}</span>
            ${cur && html`<span class="sk-num ar-section-count">${cur.n}<span class="sk-unit">${t("arena.dna.votesUnit")}</span></span>`}
          </div>
          <div class="ar-dim-tabs sk-thumbhost" role="tablist" ref=${dimHost}>
            <span class="sk-thumb" ref=${dimThumb} aria-hidden="true"></span>
            ${dimTabs.map((d) => html`<button key=${d.id} type="button" role="tab" aria-selected=${dim === d.id} data-active=${dim === d.id} onClick=${() => setDim(d.id)}>${d.label}</button>`)}
          </div>
          ${!dna
            ? html`<div class="ar-faders">${TRAIT_IDS.map((x) => html`<${Skeleton} key=${x} className="h-9 w-full rounded-lg" />`)}</div>`
            : cur.n === 0
              ? html`<p class="ar-muted ar-dna-empty">${t("arena.dna.empty")}</p>`
              : html`<div class="ar-faders">${TRAIT_IDS.map((x) => html`<${Fader} key=${x} trait=${x} lean=${lean[x]} t=${t} />`)}</div>`}
          ${standout && dim === "all" && html`
            <p class="ar-insight" data-testid="arena-insight">
              <${Icon} name="sparkle" size=${14} />
              ${t("arena.dna.standout", { dim: t(`builder.dimensions.${standout.dim}.label`), pole: t(`arena.traits.${standout.trait}.${standout.delta >= 0 ? "hi" : "lo"}`).toLowerCase() })}
            </p>`}
        </section>
        <${ArchetypeCard} dna=${dna ? dna.all : emptyDna()} lean=${leanOf(dna ? dna.all : emptyDna())} t=${t} view=${view} />
      </div>

      <section class="ar-activity sk-panel" data-testid="arena-activity">
        <div class="ar-section-head"><span class="sk-caption">${t("arena.profile.activity")}</span><span class="ar-muted">${t("arena.profile.activityHint")}</span></div>
        <div class="ar-activity-body">
          <${Heatmap} view=${view} t=${t} />
          <div class="ar-time-stats">
            <div class="ar-time-stat"><span class="sk-caption">${t("arena.profile.timeToday")}</span><b class="sk-num" data-testid="arena-time-today">${clock(seconds)}</b></div>
            <div class="ar-time-stat"><span class="sk-caption">${t("arena.profile.timeWeek")}</span><b class="sk-num">${clock(weekSeconds + (seconds - view.today.sec))}</b></div>
            <div class="ar-time-stat"><span class="sk-caption">${t("arena.profile.timeBest")}</span><b class="sk-num">${clock(view.bestDaySeconds)}</b></div>
            <p class="ar-muted ar-time-note" data-testid="arena-time-note">${t("arena.profile.timeNote")}</p>
          </div>
        </div>
      </section>

      <${Badges} view=${view} t=${t} />
    </div>
  `;
}
