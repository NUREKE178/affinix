// "Styles" (Pro view): what the Arena crowd prefers, for marketers. Pick a question ("which looks more premium / friendly /
// natural ..."), a kind of design and an audience, and see which STYLE wins: the seven trait axes with how much more often
// the specimens leaning one way win, the recipe of a winning style, the actual winners, and a CSV to take away.
import { html, useState, useEffect, useMemo, useRef } from "../lib/preact.js";
import { SectionHeading, Badge, Button, Skeleton, EmptyState, toast } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { navigate } from "../router.js";
import { Thumb } from "./arena/parts.js";
import { useT } from "../lib/i18n.js";
import { getLocale } from "../lib/i18n.js";
import { seasonOf, localDay } from "../lib/arena/rules.js";
import { FAMILY_IDS, DIMENSION_IDS, POOL_SIZE, CLASSIC_POOL, dropPoolForDay } from "../lib/arena/catalog.js";
import { TRAIT_IDS } from "../lib/arena/traits.js";
import { fetchStyleReport, fetchStyleSegments, withTraits, traitLifts, recipeOf, rankSpecimens, toCsv, MIN_GROUP } from "../lib/styleInsights.js";

const nf = (n) => new Intl.NumberFormat(getLocale()).format(Math.round(n ?? 0));
const pts = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}`;
const prevSeason = () => seasonOf(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)));
const SCALE = 0.3; // a 30-point lift fills half of the bar's track

function countryName(code) {
  try { return new Intl.DisplayNames([getLocale()], { type: "region" }).of(code) ?? code; } catch { return code; }
}

function Chips({ items, value, onChange, testid }) {
  return html`
    <div class="sty-chips" role="tablist" data-testid=${testid}>
      ${items.map(([id, label]) => html`<button type="button" key=${id} role="tab" aria-selected=${value === id} data-on=${value === id} data-id=${id} onClick=${() => onChange(id)}>${label}</button>`)}
    </div>`;
}

function Fingerprint({ lifts, overall, t, country }) {
  const base = overall ? Object.fromEntries(overall.map((l) => [l.trait, l.lift])) : null;
  return html`
    <div class="sty-fp" data-testid="styles-fingerprint">
      ${lifts.map((l) => {
        const w = Math.min(50, (Math.abs(l.lift) / SCALE) * 50);
        const side = l.lift >= 0 ? "hi" : "lo";
        const ghost = base ? Math.max(-50, Math.min(50, (base[l.trait] / SCALE) * 50)) : null;
        return html`
          <div class="sty-fp-row" key=${l.trait} data-trait=${l.trait} data-level=${l.level} data-side=${side}
            title=${t("styles.fingerprint.detail", { hi: pts(l.hiRate - 0.5), lo: pts(l.loRate - 0.5), nHi: nf(l.nHi), nLo: nf(l.nLo) })}>
            <span class="sty-pole sty-pole-lo" data-win=${l.level !== "none" && side === "lo"}>${t(`arena.traits.${l.trait}.lo`)}</span>
            <span class="sty-track" aria-hidden="true">
              <i class="sty-mid"></i>
              <i class="sty-bar" style=${{ width: `${w}%`, [side === "hi" ? "left" : "right"]: "50%" }}></i>
              ${ghost !== null && html`<i class="sty-ghost" style=${{ left: `${50 + ghost}%` }}></i>`}
            </span>
            <span class="sty-pole sty-pole-hi" data-win=${l.level !== "none" && side === "hi"}>${t(`arena.traits.${l.trait}.hi`)}</span>
            <span class="sty-val sk-num" data-testid=${`styles-lift-${l.trait}`}>${pts(l.lift)}<small>${t("styles.fingerprint.pts")}</small></span>
            <span class="sty-conf" data-level=${l.level}>${t(`styles.level.${l.level}`)}</span>
          </div>`;
      })}
      ${country && html`<p class="sty-legend"><i class="sty-ghost sty-ghost-static"></i>${t("styles.fingerprint.ghost")}</p>`}
    </div>`;
}

export function Styles() {
  const t = useT();
  const [season, setSeason] = useState(seasonOf());
  const [dim, setDim] = useState("preference");
  const [family, setFamily] = useState("all");
  const [country, setCountry] = useState("all");
  const [scope, setScope] = useState("all"); // which designs: all | today's drop | the classics
  const [state, setState] = useState({ status: "loading", data: null, error: null, progress: null });
  const [tick, setTick] = useState(0);
  const token = useRef(0);
  const memo = useRef(new Map());

  // everything that depends on the question / family / season is loaded together; the audience only re-slices it
  useEffect(() => {
    const mine = ++token.current;
    const key = `${season}|${dim}|${family}|${tick}`;
    const cached = memo.current.get(key);
    if (cached) { setState({ status: "ready", data: cached, error: null, progress: null }); return undefined; }
    setState((s) => ({ status: "loading", data: null, error: null, progress: s.progress && s.status === "loading" ? s.progress : null }));
    (async () => {
      try {
        const fam = family === "all" ? null : family;
        const [report, segs] = await Promise.all([
          fetchStyleReport({ season, dim, family: fam }),
          fetchStyleSegments({ season, dim, family: fam }).catch(() => ({ countries: [], rows: [] })),
        ]);
        if (token.current !== mine) return;
        const stop = () => token.current !== mine;
        const entries = await withTraits(report.rows, season, { onProgress: (done, total) => token.current === mine && setState((s) => ({ ...s, progress: { done, total } })), shouldStop: stop });
        if (!entries || token.current !== mine) return;
        const byCountry = {};
        if (segs.countries.length) {
          const segEntries = await withTraits(segs.rows.map((r) => ({ ...r, dim })), season, { shouldStop: stop });
          if (!segEntries || token.current !== mine) return;
          for (const e of segEntries) (byCountry[e.country] ??= []).push(e);
        }
        const data = { report, entries, countries: segs.countries, byCountry };
        memo.current.set(key, data);
        setState({ status: "ready", data, error: null, progress: null });
      } catch (error) {
        if (token.current === mine) setState({ status: "error", data: null, error, progress: null });
      }
    })();
    return () => { token.current += 1; };
  }, [season, dim, family, tick]);

  useEffect(() => { setCountry("all"); }, [season, dim, family]);

  const view = useMemo(() => {
    const d = state.data;
    if (!d) return null;
    const overall = traitLifts(d.entries);
    const picked = country !== "all" && d.byCountry[country] ? d.byCountry[country] : null;
    const todayPool = dropPoolForDay(localDay());
    const inScope = (e) => scope === "all" || (scope === "today" ? Math.floor(e.index / POOL_SIZE) === todayPool : Math.floor(e.index / POOL_SIZE) === CLASSIC_POOL);
    const base = (picked ?? d.entries).filter(inScope);
    const lifts = traitLifts(base);
    const ranked = rankSpecimens(base, { top: 12, bottom: 4, minAnswers: scope === "today" ? 3 : 6 });
    const duels = base.reduce((s, e) => s + e.wins, 0);
    return { overall: picked ? overall : lifts, lifts, ranked, recipe: recipeOf(lifts), duels, specimens: new Set(base.map((e) => e.stim)).size, picked: !!picked, scoped: scope !== "all" };
  }, [state.data, country, scope]);

  const dimItems = DIMENSION_IDS.map((id) => [id, t(`builder.dimensions.${id}.label`)]);
  const famItems = [["all", t("styles.all")], ...FAMILY_IDS.map((f) => [f, t(`arena.family.${f}`)])];
  const seasonItems = [[seasonOf(), t("styles.thisMonth")], [prevSeason(), t("styles.lastMonth")]];
  const d = state.data;
  const enough = view && view.duels >= (scope === "today" ? 20 : 60);
  const reliability = !view ? "none" : view.duels >= 600 ? "high" : view.duels >= 150 ? "mid" : "low";

  function download() {
    const csv = toCsv({ season, dim, family: family === "all" ? null : family, country: country === "all" ? null : country, lifts: view.lifts, ranked: view.ranked, votes: d.report.votes, voters: d.report.voters });
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `styles-${season}-${dim}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t("styles.exported"), "emerald");
  }

  const recipeText = view?.recipe.length
    ? view.recipe.map((l) => t(`arena.traits.${l.trait}.${l.lift >= 0 ? "hi" : "lo"}`).toLowerCase()).join(", ")
    : null;

  return html`
    <div class="fade-in sty" data-testid="styles-page">
      <${SectionHeading} title=${t("styles.title")} subtitle=${t("styles.subtitle")} action=${html`<${Badge} tone="signal">${t("styles.pro")}<//>`} />

      <div class="sty-filters sk-panel">
        <div class="sty-filter"><span class="sk-caption">${t("styles.question")}</span><${Chips} items=${dimItems} value=${dim} onChange=${setDim} testid="styles-dims" /></div>
        <div class="sty-filter"><span class="sk-caption">${t("styles.family")}</span><${Chips} items=${famItems} value=${family} onChange=${setFamily} testid="styles-families" /></div>
        <div class="sty-filter"><span class="sk-caption">${t("styles.scope.label")}</span><${Chips} items=${[["all", t("styles.scope.all")], ["today", t("styles.scope.today")], ["classic", t("styles.scope.classic")]]} value=${scope} onChange=${setScope} testid="styles-scope" /></div>
        <div class="sty-filter sty-filter-row">
          <div><span class="sk-caption">${t("styles.period")}</span><${Chips} items=${seasonItems} value=${season} onChange=${setSeason} testid="styles-season" /></div>
          <div>
            <span class="sk-caption">${t("styles.audience")}</span>
            <select class="sty-select" value=${country} onChange=${(e) => setCountry(e.currentTarget.value)} data-testid="styles-country" aria-label=${t("styles.audience")}>
              <option value="all">${t("styles.allCountries")}</option>
              ${(d?.countries ?? []).map((c) => html`<option key=${c.code} value=${c.code}>${countryName(c.code)} · ${t("styles.voters", { n: nf(c.voters) })}</option>`)}
            </select>
          </div>
        </div>
      </div>

      ${state.status === "loading" && html`
        <div class="sty-loading" data-testid="styles-loading">
          <${Skeleton} className="h-24 w-full rounded-xl" /><${Skeleton} className="h-24 w-full rounded-xl mt-3" /><${Skeleton} className="h-24 w-full rounded-xl mt-3" />
          ${state.progress && html`<p class="sty-progress">${t("styles.analysing", { done: nf(state.progress.done), total: nf(state.progress.total) })}</p>`}
        </div>`}

      ${state.status === "error" && html`
        <${EmptyState} icon="sparkle" title=${t(state.error?.code === "updatePending" ? "styles.pendingTitle" : "styles.errorTitle")} body=${t(state.error?.code === "updatePending" ? "styles.pendingBody" : "styles.errorBody")}
          action=${state.error?.code === "updatePending" ? null : html`<${Button} onClick=${() => setTick((n) => n + 1)}>${t("common.retry")}<//>`} />`}

      ${state.status === "ready" && !enough && html`
        <div data-testid="styles-empty"><${EmptyState} icon="sparkle" title=${t("styles.emptyTitle")} body=${t("styles.emptyBody", { n: nf(view?.duels ?? 0) })} /></div>`}

      ${state.status === "ready" && enough && html`
        <div class="sty-stack" data-testid="styles-ready" data-reliability=${reliability}>
          <div class="sk-stat-strip sk-stat-strip-well sty-summary" style="--cols:4">
            <div class="sk-stat"><div class="sk-stat-label">${t("styles.sum.answers")}</div><div class="sk-stat-value" data-testid="styles-answers">${nf(view.duels)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("styles.sum.voters")}</div><div class="sk-stat-value">${nf(d.report.voters)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("styles.sum.specimens")}</div><div class="sk-stat-value">${nf(view.specimens)}</div></div>
            <div class="sk-stat"><div class="sk-stat-label">${t("styles.sum.reliability")}</div><div class="sk-stat-value sty-rel" data-level=${reliability}>${t(`styles.reliability.${reliability}`)}</div></div>
          </div>

          <section class="sty-card sk-panel sty-recipe" data-testid="styles-recipe">
            <div class="sty-card-head"><span class="sk-caption">${t("styles.recipe.title")}</span></div>
            <p>${recipeText ? t("styles.recipe.lead", { dim: t(`builder.dimensions.${dim}.label`).toLowerCase(), traits: recipeText }) : t("styles.recipe.none")}</p>
          </section>

          ${view.ranked.best.length > 0 && html`
            <section class="sty-card sk-panel" data-testid="styles-winners">
              <div class="sty-card-head"><span class="sk-caption">${t("styles.loved")}</span></div>
              <div class="sty-grid">
                ${view.ranked.best.map((m) => html`
                  <figure class="sty-spec" key=${m.stim} data-stim=${m.stim}>
                    <${Thumb} season=${season} family=${m.family} index=${m.index} size=168 />
                    <figcaption><b class="sk-num">${Math.round(m.rate * 100)}%</b><span>${t(`arena.family.${m.family}`)} · ${t("styles.winners.answers", { n: nf(m.n) })}</span></figcaption>
                  </figure>`)}
              </div>
              ${view.ranked.worst.length > 0 && html`
                <div class="sty-card-head sty-sub"><span class="sk-caption">${t("styles.winners.least")}</span></div>
                <div class="sty-grid sty-grid-dim">
                  ${view.ranked.worst.map((m) => html`
                    <figure class="sty-spec" key=${m.stim} data-stim=${m.stim}>
                      <${Thumb} season=${season} family=${m.family} index=${m.index} size=96 />
                      <figcaption><b class="sk-num">${Math.round(m.rate * 100)}%</b><span>${t("styles.winners.answers", { n: nf(m.n) })}</span></figcaption>
                    </figure>`)}
                </div>`}
            </section>`}

          <section class="sty-card sk-panel">
            <div class="sty-card-head"><span class="sk-caption">${t("styles.fingerprint.title")}</span><span class="sty-hint">${t("styles.fingerprint.hint", { dim: t(`builder.dimensions.${dim}.label`).toLowerCase() })}</span></div>
            <${Fingerprint} lifts=${view.lifts} overall=${view.picked ? view.overall : null} country=${view.picked} t=${t} />
          </section>

          <div class="sty-actions">
            <${Button} variant="secondary" onClick=${download} data-testid="styles-export"><${Icon} name="arrowDown" size=${16} /> ${t("styles.export")}<//>
          </div>
          <button type="button" class="sty-advanced" onClick=${() => navigate("/app/overview")} data-testid="styles-advanced">${t("styles.advanced")}</button>
          <p class="sty-note" data-testid="styles-note">${t("styles.note", { n: MIN_GROUP })}</p>
        </div>`}
    </div>`;
}
