import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "../components/icons.js";
import { LanguageSwitch } from "../components/languageSwitch.js";
import { useT, useLocale, useLocaleFadeClass } from "../lib/i18n.js";
import { useReveal } from "../lib/motion.js";
import { startLandingScroll, scrollToTarget } from "../lib/scrollWatch.js";

// The landing in the product's own "Instrument" look (graphite, one orange signal, tactile keys, quiet plates). All
// styling lives in landing.css (every class is lp- prefixed and scoped under .lp-root, because vendor/tailwind.css is
// prebuilt and cannot gain new utilities without a build step); it reads the same surface tokens as the app (styles.css).
// Copy lives in locales/*.js under `landing.*`.

const ASSETS = "./assets/landing/";
const LOGO = "./assets/logo/";

// Phone screenshots are captured per UI language (ru / kk / en) from the real app with demo data.
const phoneSrc = (name, locale) => `${ASSETS}phone-${name}.${locale}.webp`;

// Sample numbers for the dashboard preview. Variant B is the app's own demo report (n = 248: 42% choice share,
// trust 61%, quality 58%, premium 34%, purchase intention 4.6/7); the other variants' numbers are illustrative, and the
// whole preview is labelled "Sample data" on screen.
const VARIANTS = [
  { key: "classic", label: "A", img: "pack-a.jpg", share: 27, m: [54, 52, 46, 4.1] },
  { key: "minimal", label: "B", img: "pack-b.jpg", share: 42, m: [61, 58, 34, 4.6] },
  { key: "bold", label: "C", img: "pack-c.jpg", share: 19, m: [44, 47, 22, 3.8] },
  { key: "natural", label: "D", img: "pack-d.jpg", share: 12, m: [39, 41, 28, 3.3] },
];
const LEAD = VARIANTS.reduce((best, v, i) => (v.share > VARIANTS[best].share ? i : best), 0);
const RUNNER_UP = Math.max(...VARIANTS.filter((_, i) => i !== LEAD).map((v) => v.share));
const barWidth = (share) => Math.round((share / 50) * 100);

function scrollToId(id) {
  scrollToTarget(id, { offset: -64 });
}

const RAIL = ["lp-top", "lp-workflow", "lp-trust", "lp-mobile", "lp-start"];

/** The page's choreography: a progress line at the top, a rail of section dots on the right, and a gentle parallax on the
 *  blocks marked data-par (they move a little slower than the page). All of it is driven by the scroll engine's frames. */
function useChoreography() {
  const [active, setActive] = useState(0);
  const bar = useRef(null);
  useEffect(() => {
    const engine = startLandingScroll();
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Measure once (and again when the layout can have moved), never per frame: reading layout every frame while scrolling is what made the page stutter.
    let tops = [], pars = [], vh = window.innerHeight;
    const measure = () => {
      vh = window.innerHeight;
      const sy = window.scrollY;
      tops = RAIL.map((id) => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().top + sy : Infinity; });
      pars = [...document.querySelectorAll("[data-par]")].map((el) => {
        el.style.transform = ""; // measure without our own offset
        const r = el.getBoundingClientRect();
        return { el, centre: r.top + sy + r.height / 2, h: r.height, k: Number(el.dataset.par), last: NaN };
      });
    };
    measure();
    const timers = [setTimeout(measure, 800), setTimeout(measure, 2500)];
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    let activeNow = -1, barNow = "";
    const off = engine.subscribe(({ y, progress }) => {
      const w = progress.toFixed(4);
      if (w !== barNow && bar.current) { barNow = w; bar.current.style.transform = `scaleX(${w})`; } // only when the bar actually moves
      const mid = y + vh * 0.4;
      let idx = 0;
      for (let i = 0; i < tops.length; i++) if (tops[i] <= mid) idx = i;
      if (idx !== activeNow) { activeNow = idx; setActive(idx); }
      if (!reduced) {
        for (const p of pars) {
          const d = p.centre - (y + vh / 2);
          if (Math.abs(d) > vh + p.h) continue;                 // far off screen: leave it
          const off2 = Math.round(d * -p.k * 2) / 2;            // half-pixel steps: no restyle for sub-pixel changes
          if (off2 !== p.last) { p.last = off2; p.el.style.transform = `translate3d(0, ${off2}px, 0)`; }
        }
      }
    });
    return () => {
      off(); engine.stop(); timers.forEach(clearTimeout);
      window.removeEventListener("resize", measure); window.removeEventListener("load", measure);
      document.querySelectorAll("[data-par]").forEach((el) => { el.style.transform = ""; });
    };
  }, []);
  return { active, bar };
}

function Choreography({ t, active, bar }) {
  return html`
    <div class="lp-progress" aria-hidden="true"><i ref=${bar}></i></div>
    <nav class="lp-rail" aria-label=${t("landing.sections.label")}>
      ${RAIL.map((id, i) => html`
        <button type="button" key=${id} class="lp-rail-dot" data-on=${active === i} aria-label=${t(`landing.sections.${id.slice(3)}`)} aria-current=${active === i ? "true" : undefined} onClick=${() => scrollToId(id)}>
          <span>${t(`landing.sections.${id.slice(3)}`)}</span>
        </button>`)}
    </nav>
  `;
}

/** Fades/slides a block in once when it first scrolls into view (the app's existing .sk-reveal). */
function Reveal({ className = "", children }) {
  const { ref, visible } = useReveal();
  return html`<div ref=${ref} data-visible=${visible} class=${`sk-reveal ${className}`}>${children}</div>`;
}

function Header({ t }) {
  return html`
    <header class="lp-hd">
      <div class="lp-hd-in">
        <a class="lp-logo" href="#/" aria-label="Affinix" onClick=${(e) => { e.preventDefault(); scrollToTarget(0); }}>
          <img class="lp-logo-full" src=${`${LOGO}logo-lockup-dark.png`} alt="Affinix" width="128" height="30" />
          <img class="lp-logo-mark" src=${`${LOGO}logo-mark-256.png`} alt="" width="32" height="32" loading="lazy" decoding="async" />
        </a>
        <div class="lp-hd-r">
          <${LanguageSwitch} variant="glass" />
          <a class="lp-dl" href="#/download" data-testid="landing-download"><${Icon} name="arrowDown" size=${14} /> ${t("landing.download")}</a>
          <a class="lp-login" href="#/login">${t("landing.login")}</a>
          <a class="lp-btn lp-btn-sm" href="#/register">
            <span class="lp-long">${t("landing.createResearch")}</span><span class="lp-short">${t("landing.createShort")}</span>
          </a>
        </div>
      </div>
    </header>
  `;
}

/** The dashboard preview: pick a variant key and the share chart, metrics and interpretation follow. */
function DashboardMock({ t }) {
  const [sel, setSel] = useState(LEAD);
  const v = VARIANTS[sel];
  const variantName = (x) => t(`landing.mock.variants.${x.key}`);
  const aiText = sel === LEAD
    ? t("landing.mock.aiLead", { L: v.label, p: v.share, d: v.share - RUNNER_UP })
    : t("landing.mock.aiTrail", { L: v.label, p: v.share, d: VARIANTS[LEAD].share - v.share });
  const metrics = [
    { label: t("landing.mock.trust"), value: `${v.m[0]}%`, w: v.m[0] },
    { label: t("landing.mock.quality"), value: `${v.m[1]}%`, w: v.m[1] },
    { label: t("landing.mock.premium"), value: `${v.m[2]}%`, w: v.m[2] },
    { label: t("landing.mock.intent"), value: `${v.m[3].toFixed(1)}/7`, w: Math.round((v.m[3] / 7) * 100) },
  ];
  const sideIcons = ["overview", "experiments", "participants", "results", "reports"];

  return html`
    <div class="lp-stage" id="lp-sample" data-par="0.07">
      <div class="lp-fc lp-fc1" aria-hidden="true">
        <span class="lp-fc-l">${t("landing.mock.winner")}</span>
        <span class="lp-fc-v"><b>${t("landing.mock.winnerName")}</b><em>${VARIANTS[LEAD].share}%</em></span>
        <span class="lp-fc-bar"><i></i></span>
      </div>
      <div class="lp-fc lp-fc2" aria-hidden="true">
        <span class="lp-fc-l">${t("landing.mock.sample")}</span>
        <span class="lp-fc-v"><b>n = 248</b></span>
        <span class="lp-ci"><i></i><u></u></span>
        <span class="lp-fc-s">${t("landing.mock.sampleNote")}</span>
      </div>

      <div class="lp-float">
        <div class="lp-mock" role="group" aria-label=${t("landing.mock.aria")}>
          <div class="lp-m-top">
            <div class="lp-dots" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="lp-m-url"><${Icon} name="experiments" size=${14} className="lp-ic" /><span>${t("landing.mock.crumb")}</span></div>
            <span class="lp-m-gap" aria-hidden="true"></span>
          </div>
          <div class="lp-m-body">
            <aside class="lp-m-side" aria-hidden="true">
              ${sideIcons.map((name) => html`<span key=${name} class=${`lp-m-ic ${name === "experiments" ? "lp-on" : ""}`}><${Icon} name=${name} size=${19} /></span>`)}
              <span class="lp-m-ic lp-m-last"><${Icon} name="settings" size=${19} /></span>
            </aside>
            <div class="lp-m-main">
              <div class="lp-m-head">
                <div class="lp-m-title">${t("landing.mock.title")}</div>
                <span class="lp-tag lp-live"><i class="lp-dot"></i>${t("landing.mock.live")}</span>
                <span class="lp-tag lp-demo">${t("landing.mock.demo")}</span>
                <span class="lp-m-resp">${t("landing.mock.responses")}</span>
              </div>

              <div class="lp-m-cards">
                ${VARIANTS.map((x, i) => html`
                  <button key=${x.key} type="button" class=${`lp-vc ${i === sel ? "lp-on" : ""}`} aria-pressed=${i === sel} onClick=${() => setSel(i)}>
                    <span class="lp-vc-img">
                      <img src=${ASSETS + x.img} alt=${variantName(x)} width="220" height="220" />
                      <span class="lp-vc-l">${x.label}</span>
                      <span class="lp-vc-ck"><${Icon} name="check" size=${14} strokeWidth=${2.6} /></span>
                      ${i === LEAD && html`<span class="lp-vc-lead">${t("landing.mock.leading")}</span>`}
                    </span>
                    <span class="lp-vc-meta"><span class="lp-vc-name">${variantName(x)}</span><span class="lp-vc-pct">${x.share}%</span></span>
                    <span class="lp-vc-bar"><i style=${`width:${barWidth(x.share)}%`}></i></span>
                  </button>
                `)}
              </div>

              <div class="lp-m-row">
                <div class="lp-pane">
                  <div class="lp-pane-h"><span class="lp-pane-t"><${Icon} name="results" size=${16} className="lp-ic" />${t("landing.mock.share")}</span><span class="lp-pane-s">${t("landing.mock.ci")}</span></div>
                  ${VARIANTS.map((x, i) => html`
                    <div key=${x.key} class=${`lp-bar-row ${i === sel ? "lp-on" : ""}`}>
                      <span class="lp-bl">${x.label}</span><span class="lp-bt"><i style=${`width:${barWidth(x.share)}%`}></i></span><span class="lp-bv">${x.share}%</span>
                    </div>
                  `)}
                </div>
                <div class="lp-pane">
                  <div class="lp-pane-h"><span class="lp-pane-t">${t("landing.mock.metrics")}</span><span class="lp-pane-s">${t("landing.mock.variantFmt", { L: v.label })} · ${variantName(v)}</span></div>
                  <div class="lp-met-grid">
                    ${metrics.map((m) => html`
                      <div key=${m.label} class="lp-met"><span class="lp-ml">${m.label}</span><span class="lp-mv">${m.value}</span><span class="lp-mbar"><i style=${`width:${m.w}%`}></i></span></div>
                    `)}
                  </div>
                </div>
                <div class="lp-pane">
                  <div class="lp-pane-h"><span class="lp-pane-t"><${Icon} name="sparkle" size=${16} className="lp-ic" />${t("landing.mock.aiTitle")}</span><span class="lp-tagp">${t("landing.mock.aiTag")}</span></div>
                  <p class="lp-ai-p">${aiText}</p>
                  <p class="lp-ai-lim"><b>${t("landing.mock.limitLabel")}</b> ${t("landing.mock.limitText")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function Hero({ t }) {
  return html`
    <section class="lp-hero" id="lp-top">
      <div class="lp-wrap lp-hero-in slide-up">
        <div class="lp-pill"><i class="lp-led" aria-hidden="true"></i><span>${t("landing.badge")}</span></div>
        <h1 class="lp-h1">${t("landing.heroTitleLead")} <span class="lp-g">${t("landing.heroTitleAccent")}</span></h1>
        <p class="lp-lead">${t("landing.heroSubtitle")}</p>
        <div class="lp-cta-row">
          <a class="lp-btn" href="#/register">${t("landing.createResearch")} <${Icon} name="arrowRight" size=${18} strokeWidth=${2.2} className="lp-ic" /></a>
          <button type="button" class="lp-btn lp-btn-ghost" onClick=${() => scrollToId("lp-sample")}>${t("landing.seeSample")}</button>
        </div>
        <p class="lp-micro"><${Icon} name="shield" size=${15} className="lp-ic" /><span>${t("landing.microNote")}</span></p>
      </div>
      <div class="lp-wrap"><${DashboardMock} t=${t} /></div>
    </section>
  `;
}

function CanTest({ t }) {
  const items = ["packaging", "ads", "logos", "landings", "images", "interfaces"];
  return html`
    <section class="lp-wrap" aria-label=${t("landing.canTest.label")}>
      <div class="lp-ctx">
        <span class="lp-ctx-l">${t("landing.canTest.label")}</span>
        <ul class="lp-ctx-list">${items.map((k) => html`<li key=${k} class="lp-cx">${t(`landing.canTest.${k}`)}</li>`)}</ul>
      </div>
    </section>
  `;
}

/** "From stimulus to decision": five plates in a bento grid, each with a small live-looking preview. */
function Workflow({ t, locale }) {
  const chips = [
    { id: "preference", on: true }, { id: "attention" }, { id: "trust", sug: true }, { id: "quality" },
    { id: "premium", sug: true }, { id: "clarity" }, { id: "recall" }, { id: "purchaseIntent" },
  ];
  const step = (n) => ({ title: t(`landing.workflow.steps.s${n}.title`), desc: t(`landing.workflow.steps.s${n}.desc`) });
  const s1 = step(1), s2 = step(2), s3 = step(3), s4 = step(4), s5 = step(5);
  return html`
    <section class="lp-sec" id="lp-workflow">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow">${t("landing.workflow.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.workflow.title")}</h2>
            <p class="lp-sub">${t("landing.workflow.subtitle")}</p>
          </div>
        <//>

        <${Reveal}>
          <div class="lp-bento">
            <article class="lp-bc lp-b1">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="upload" size=${22} /></span><span class="lp-num">01</span></div>
              <h3>${s1.title}</h3>
              <p>${s1.desc}</p>
              <div class="lp-pv">
                <div class="lp-dz">
                  <img class="lp-th lp-th1" src=${`${ASSETS}pack-a.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <img class="lp-th lp-th2" src=${`${ASSETS}pack-b.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <img class="lp-th lp-th3" src=${`${ASSETS}pack-c.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <span class="lp-dz-c">${t("landing.workflow.preview.dropHint")}</span>
                </div>
                <div class="lp-dz-m"><span class="lp-chipm"><${Icon} name="upload" size=${13} className="lp-ic" />${t("landing.workflow.preview.files")}</span><span>${t("landing.workflow.preview.fileTypes")}</span></div>
              </div>
            </article>

            <article class="lp-bc lp-b2">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="edit" size=${22} /></span><span class="lp-num">02</span></div>
              <h3>${s2.title}</h3>
              <p>${s2.desc}</p>
              <div class="lp-pv">
                <div class="lp-chips">
                  ${chips.map((c) => html`
                    <span key=${c.id} class=${`lp-chip ${c.sug ? "lp-sug" : ""}`}>
                      ${c.on && html`<${Icon} name="check" size=${13} strokeWidth=${2.6} className="lp-ic" />`}${t(`builder.dimensions.${c.id}.label`)}${c.sug && html`<em>${t("builder.dimensions.suggestedBadge")}</em>`}
                    </span>
                  `)}
                </div>
              </div>
            </article>

            <article class="lp-bc lp-b3">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="participants" size=${22} /></span><span class="lp-num">03</span></div>
              <h3>${s3.title}</h3>
              <p>${s3.desc}</p>
              <div class="lp-pv lp-p3">
                <span class="lp-fl lp-fl1"><${Icon} name="shuffle" size=${14} className="lp-ic" />${t("landing.workflow.preview.randomized")}</span>
                <span class="lp-fl lp-fl2"><${Icon} name="link" size=${14} className="lp-ic" />${t("landing.workflow.preview.publicLink")}</span>
                <img class="lp-ph" src=${phoneSrc("participant", locale)} alt=${t("landing.workflow.preview.altParticipant")} width="864" height="1748" loading="lazy" decoding="async" />
              </div>
            </article>

            <article class="lp-bc lp-b4">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="results" size=${22} /></span><span class="lp-num">04</span></div>
              <h3>${s4.title}</h3>
              <p>${s4.desc}</p>
              <div class="lp-pv">
                <div class="lp-mini" aria-hidden="true">
                  <div class="lp-mc"><div class="lp-mi"><i style="height:62px"></i></div><b>A</b></div>
                  <div class="lp-mc lp-top"><div class="lp-mi"><i style="height:92px"></i><u></u></div><b>B</b></div>
                  <div class="lp-mc"><div class="lp-mi"><i style="height:44px"></i></div><b>C</b></div>
                  <div class="lp-mc"><div class="lp-mi"><i style="height:28px"></i></div><b>D</b></div>
                </div>
                <div class="lp-mini-m"><span class="lp-tagp">±6% · 95%</span><span>n = 248</span></div>
              </div>
            </article>

            <article class="lp-bc lp-b5">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="sparkle" size=${22} /></span><span class="lp-num">05</span></div>
              <h3>${s5.title}</h3>
              <p>${s5.desc}</p>
              <div class="lp-pv">
                <div class="lp-ai">
                  <div class="lp-ai-h"><span class="lp-ai-t"><${Icon} name="sparkle" size=${16} className="lp-ic" />${t("landing.mock.aiTitle")}</span><span class="lp-tagp">${t("landing.workflow.preview.predictionTag")}</span></div>
                  <div class="lp-ai-r"><b>${t("landing.workflow.preview.observedLabel")}</b><span>${t("landing.workflow.preview.observed")}</span></div>
                  <div class="lp-ai-r"><b>${t("landing.workflow.preview.limitLabel")}</b><span>${t("landing.workflow.preview.limit")}</span></div>
                  <div class="lp-ai-r"><b>${t("landing.workflow.preview.nextLabel")}</b><span>${t("landing.workflow.preview.next")}</span></div>
                </div>
              </div>
            </article>
          </div>
        <//>
      </div>
    </section>
  `;
}

function Trust({ t }) {
  const items = [
    { key: "i1", icon: "participants" }, { key: "i2", icon: "results" },
    { key: "i3", icon: "sparkle" }, { key: "i4", icon: "shield" },
  ];
  return html`
    <section class="lp-sec" id="lp-trust">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow">${t("landing.trust.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.trust.title")}</h2>
            <p class="lp-sub">${t("landing.trust.subtitle")}</p>
          </div>
          <div class="lp-tgrid">
            ${items.map((it) => html`
              <article key=${it.key} class="lp-bc lp-tc">
                <div class="lp-bc-top"><span class="lp-ico"><${Icon} name=${it.icon} size=${22} /></span></div>
                <div class="lp-big">${t(`landing.trust.items.${it.key}.n`)}</div>
                <h3>${t(`landing.trust.items.${it.key}.title`)}</h3>
                <p>${t(`landing.trust.items.${it.key}.desc`)}</p>
              </article>
            `)}
          </div>
        <//>
      </div>
    </section>
  `;
}

function Mobile({ t, locale }) {
  return html`
    <section class="lp-sec lp-mobi" id="lp-mobile">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow">${t("landing.mobile.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.mobile.title")}</h2>
            <p class="lp-sub">${t("landing.mobile.subtitle")}</p>
          </div>
          <ul class="lp-mb-list">
            <li class="lp-cx"><${Icon} name="edit" size=${16} className="lp-ic" />${t("landing.mobile.b1")}</li>
            <li class="lp-cx"><${Icon} name="results" size=${16} className="lp-ic" />${t("landing.mobile.b2")}</li>
            <li class="lp-cx"><${Icon} name="chat" size=${16} className="lp-ic" />${t("landing.mobile.b3")}</li>
          </ul>
        <//>
      </div>
      <div class="lp-fan-wrap">
        <div class="lp-fan" data-par="0.06">
          <img class="lp-f lp-f1" src=${phoneSrc("builder", locale)} alt=${t("landing.mobile.altBuilder")} width="864" height="1748" loading="lazy" decoding="async" />
          <img class="lp-f lp-f2" src=${phoneSrc("report", locale)} alt=${t("landing.mobile.altReport")} width="864" height="1748" loading="lazy" decoding="async" />
          <img class="lp-f lp-f3" src=${phoneSrc("chat", locale)} alt=${t("landing.mobile.altChat")} width="864" height="1748" loading="lazy" decoding="async" />
        </div>
      </div>
    </section>
  `;
}

function FinalCta({ t }) {
  return html`
    <section class="lp-sec" id="lp-start">
      <div class="lp-wrap">
        <${Reveal} className="lp-cta-box">
          <h2 class="lp-h2">${t("landing.cta.title")}</h2>
          <p class="lp-sub">${t("landing.cta.subtitle")}</p>
          <div class="lp-cta-row">
            <a class="lp-btn" href="#/register">${t("landing.createResearch")} <${Icon} name="arrowRight" size=${18} strokeWidth=${2.2} className="lp-ic" /></a>
            <button type="button" class="lp-btn lp-btn-ghost" onClick=${() => scrollToId("lp-sample")}>${t("landing.seeSample")}</button>
          </div>
          <p class="lp-have">${t("landing.cta.haveAccount")} <a class="lp-lk" href="#/login">${t("landing.login")}</a></p>
        <//>
      </div>
    </section>
  `;
}

function Footer({ t }) {
  return html`
    <footer class="lp-ft">
      <div class="lp-wrap">
        <div class="lp-ft-top">
          <a class="lp-logo" href="#/" aria-label="Affinix" onClick=${(e) => { e.preventDefault(); scrollToTarget(0); }}>
            <img class="lp-ft-logo" src=${`${LOGO}logo-lockup-dark.png`} alt="Affinix" width="136" height="32" loading="lazy" decoding="async" />
          </a>
          <a class="lp-dl lp-dl-ft" href="#/download" data-testid="landing-download-footer"><${Icon} name="arrowDown" size=${14} /> ${t("landing.download")}</a>
          <p class="lp-ft-tag">${t("landing.footer")}</p>
        </div>
        <div class="lp-disc">
          <h3>${t("landing.disclaimerTitle")}</h3>
          <p>${t("landing.disclaimerBody")}</p>
        </div>
      </div>
    </footer>
  `;
}

export function Landing() {
  const t = useT();
  const choreo = useChoreography(); // the smooth engine, progress line, section rail and parallax: landing page only, never inside the app
  const locale = useLocale();
  const localeFadeClass = useLocaleFadeClass();
  return html`
    <div class=${`lp-root ${localeFadeClass}`}>
      <${Header} t=${t} />
      <${Choreography} t=${t} active=${choreo.active} bar=${choreo.bar} />
      <main>
        <${Hero} t=${t} />
        <${CanTest} t=${t} />
        <${Workflow} t=${t} locale=${locale} />
        <${Trust} t=${t} />
        <${Mobile} t=${t} locale=${locale} />
        <${FinalCta} t=${t} />
      </main>
      <${Footer} t=${t} />
    </div>
  `;
}
