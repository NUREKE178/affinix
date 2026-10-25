import { html, useState, useEffect } from "../lib/preact.js";
import { Icon } from "../components/icons.js";
import { LanguageSwitch } from "../components/languageSwitch.js";
import { useT, useLocale } from "../lib/i18n.js";
import { useReveal } from "../lib/motion.js";
import { scrollToTarget } from "../lib/scrollWatch.js";

// The landing in the product's own "Instrument" look (graphite, one orange signal, tactile keys, quiet plates). All
// styling lives in landing.css (every class is lp- prefixed and scoped under .lp-root, because vendor/tailwind.css is
// prebuilt and cannot gain new utilities without a build step); it reads the same surface tokens as the app (styles.css).
// Copy lives in locales/*.js under `landing.*`. The page tells the product as it is: the Arena (duels, XP, streak, the daily challenge, taste DNA)
// and the marketers' hub (what people love), plus the apps. Nothing about running research with your own participants.

const ASSETS = "./assets/landing/";
const LOGO = "./assets/logo/";

// Phone screenshots are captured per UI language (ru / kk / en) from the real app with demo data.
const phoneSrc = (name, locale) => `${ASSETS}phone-${name}.${locale}.webp`;

// Sample numbers for the "For marketers" preview: four packaging styles, their win share and a four-part style profile (warm, bold,
// minimal, premium, 0-100). They are illustrative and the whole preview is labelled "Sample data" on screen.
const VARIANTS = [
  { key: "classic", label: "A", img: "pack-a.jpg", share: 27, m: [54, 52, 46, 59] },
  { key: "minimal", label: "B", img: "pack-b.jpg", share: 42, m: [61, 38, 84, 72] },
  { key: "bold", label: "C", img: "pack-c.jpg", share: 19, m: [44, 81, 22, 35] },
  { key: "natural", label: "D", img: "pack-d.jpg", share: 12, m: [79, 41, 48, 40] },
];
const LEAD = VARIANTS.reduce((best, v, i) => (v.share > VARIANTS[best].share ? i : best), 0);
const RUNNER_UP = Math.max(...VARIANTS.filter((_, i) => i !== LEAD).map((v) => v.share));
const barWidth = (share) => Math.round((share / 50) * 100);

function scrollToId(id) {
  scrollToTarget(id, { offset: -64 });
}

/** A gentle parallax on the blocks marked data-par (they move a little slower than the page). The motion itself is a CSS scroll-driven animation (landing.css);
 *  all this does is tell each block how far it may travel: k x (screen height + its own height) / 2, in px. Measured on load and resize, never while scrolling. */
function useParallax() {
  useEffect(() => {
    const measure = () => {
      const vh = window.innerHeight;
      document.querySelectorAll("[data-par]").forEach((el) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--par-r", `${Math.round(Number(el.dataset.par) * (vh + r.height)) / 2}px`);
      });
    };
    // the header is fixed: keep the space reserved for it equal to its real height (it can wrap on very narrow screens)
    const hd = document.querySelector(".lp-hd");
    const root = document.querySelector(".lp-root");
    const syncHeader = () => { if (hd && root) root.style.setProperty("--lp-hd-h", `${hd.offsetHeight}px`); };
    syncHeader();
    const ro = typeof ResizeObserver === "function" && hd ? new ResizeObserver(syncHeader) : null;
    ro?.observe(hd);
    measure();
    const timers = [setTimeout(measure, 800), setTimeout(measure, 2500)];
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    return () => {
      timers.forEach(clearTimeout); ro?.disconnect();
      window.removeEventListener("resize", measure); window.removeEventListener("load", measure);
      document.querySelectorAll("[data-par]").forEach((el) => el.style.removeProperty("--par-r"));
    };
  }, []);
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
            <span class="lp-long">${t("landing.play")}</span><span class="lp-short">${t("landing.playShort")}</span>
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
    { label: t("landing.mock.intent"), value: `${v.m[3]}%`, w: v.m[3] },
  ];
  const sideIcons = ["arena", "overview", "globe", "chat", "user"];

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
        <span class="lp-fc-s">${t("landing.mock.sampleNote")}</span>
      </div>

      <div class="lp-float">
        <div class="lp-mock" role="group" aria-label=${t("landing.mock.aria")}>
          <div class="lp-m-top">
            <div class="lp-dots" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="lp-m-url"><${Icon} name="overview" size=${14} className="lp-ic" /><span>${t("landing.mock.crumb")}</span></div>
            <span class="lp-m-gap" aria-hidden="true"></span>
          </div>
          <div class="lp-m-body">
            <aside class="lp-m-side" aria-hidden="true">
              ${sideIcons.map((name) => html`<span key=${name} class=${`lp-m-ic ${name === "overview" ? "lp-on" : ""}`}><${Icon} name=${name} size=${19} /></span>`)}
              <span class="lp-m-ic lp-m-last"><${Icon} name="settings" size=${19} /></span>
            </aside>
            <div class="lp-m-main">
              <div class="lp-m-head">
                <div class="lp-m-title">${t("landing.mock.title")}</div>
                <span class="lp-tag lp-live"><span class="lp-gl lp-gl-pulse" aria-hidden="true"><${Icon} name="bolt" size=${11} strokeWidth=${3} /></span>${t("landing.mock.live")}</span>
                <span class="lp-tag lp-demo"><span class="lp-gl" aria-hidden="true"><${Icon} name="sparkle" size=${11} strokeWidth=${3} /></span>${t("landing.mock.demo")}</span>
                <span class="lp-m-resp">${t("landing.mock.responses")}</span>
              </div>

              <div class="lp-m-cards">
                ${VARIANTS.map((x, i) => html`
                  <button key=${x.key} type="button" class=${`lp-vc ${i === sel ? "lp-on" : ""}`} aria-pressed=${i === sel} onClick=${() => setSel(i)}>
                    <span class="lp-vc-img">
                      <img src=${ASSETS + x.img} alt=${variantName(x)} width="220" height="220" />
                      <span class="lp-vc-l">${x.label}</span>
                      <span class="lp-vc-ck"><${Icon} name="check" size=${14} strokeWidth=${2.6} /></span>
                      ${i === LEAD && html`<span class="lp-vc-lead"><span class="lp-gl" aria-hidden="true"><${Icon} name="crown" size=${10} strokeWidth=${3} /></span>${t("landing.mock.leading")}</span>`}
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
        <div class="lp-pill"><span class="lp-pill-ic" aria-hidden="true"><${Icon} name="arena" size=${15} strokeWidth=${2.6} /></span><span>${t("landing.badge")}</span></div>
        <h1 class="lp-h1">${t("landing.heroTitleLead")} <span class="lp-g">${t("landing.heroTitleAccent")}</span></h1>
        <p class="lp-lead">${t("landing.heroSubtitle")}</p>
        <div class="lp-cta-row">
          <a class="lp-btn" href="#/register">${t("landing.play")} <${Icon} name="arrowRight" size=${18} strokeWidth=${2.2} className="lp-ic" /></a>
          <button type="button" class="lp-btn lp-btn-ghost" onClick=${() => scrollToId("lp-duel")}>${t("landing.tryDuel")}</button>
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

/** Try a duel right on the page: tap one of two designs, see how many players chose the same (sample numbers, labelled as such). */
function Duel({ t }) {
  const [picked, setPicked] = useState(null);
  const share = { A: 58, B: 42 };
  const reveal = picked !== null;
  return html`
    <section class="lp-sec" id="lp-duel">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow"><span class="lp-eb-ic" aria-hidden="true"><${Icon} name="arena" size=${13} strokeWidth=${3} /></span>${t("landing.duel.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.duel.title")}</h2>
            <p class="lp-sub">${t("landing.duel.subtitle")}</p>
          </div>
          <div class="lp-bc lp-duel" data-testid="landing-duel" data-picked=${picked ?? "none"}>
            <div class="lp-duel-top">
              <span class="lp-duel-count">${t("landing.duel.counter")}</span>
              <span class="lp-duel-meta"><span><${Icon} name="flame" size=${14} className="lp-ic" />${t("landing.duel.streak")}</span><b>${t("landing.duel.xp")}</b></span>
            </div>
            <h3 class="lp-duel-q">${t("landing.duel.question")}</h3>
            <div class="lp-duel-grid">
              ${["A", "B"].map((id) => html`
                <button key=${id} type="button" class=${`lp-duel-card ${picked === id ? "lp-won" : ""}`} data-id=${id} aria-pressed=${picked === id} aria-label=${t("landing.duel.pick", { L: id })} onClick=${() => setPicked(id)}>
                  <span class=${`lp-duel-art lp-art-${id}`} aria-hidden="true">${id === "A" ? html`<span class="lp-art-a-in"><b>N°1</b></span>` : html`<span class="lp-art-b-in"><b>pop!</b></span>`}</span>
                  <span class="lp-duel-row"><span class="lp-duel-l">${id}</span><span class="lp-duel-pct">${reveal ? `${share[id]}%` : ""}</span></span>
                </button>
              `)}
            </div>
            <div class="lp-duel-bar" aria-hidden="true"><i style=${`width:${reveal ? share[picked] : 0}%`}></i></div>
            <p class="lp-duel-hint" aria-live="polite">${reveal ? t("landing.duel.result", { L: picked, p: share[picked] }) : t("landing.duel.hint")}</p>
            ${reveal && html`
              <div class="lp-cta-row lp-duel-cta">
                <a class="lp-btn" href="#/register">${t("landing.duel.cta")} <${Icon} name="arrowRight" size=${18} strokeWidth=${2.2} className="lp-ic" /></a>
                <button type="button" class="lp-btn lp-btn-ghost" onClick=${() => setPicked(null)}>${t("landing.duel.again")}</button>
              </div>`}
          </div>
        <//>
      </div>
    </section>
  `;
}

/** "How it works": five plates in a bento grid, each with a small live-looking preview. */
function Workflow({ t, locale }) {
  const chips = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id, i) => ({ id, on: i === 0 }));
  const step = (n) => ({ title: t(`landing.workflow.steps.s${n}.title`), desc: t(`landing.workflow.steps.s${n}.desc`) });
  const s1 = step(1), s2 = step(2), s3 = step(3), s4 = step(4), s5 = step(5);
  return html`
    <section class="lp-sec" id="lp-workflow">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow"><span class="lp-eb-ic" aria-hidden="true"><${Icon} name="target" size=${13} strokeWidth=${3} /></span>${t("landing.workflow.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.workflow.title")}</h2>
            <p class="lp-sub">${t("landing.workflow.subtitle")}</p>
          </div>
        <//>

        <${Reveal}>
          <div class="lp-bento">
            <article class="lp-bc lp-b1">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="arena" size=${22} /></span><span class="lp-num">01</span></div>
              <h3>${s1.title}</h3>
              <p>${s1.desc}</p>
              <div class="lp-pv">
                <div class="lp-dz">
                  <img class="lp-th lp-th1" src=${`${ASSETS}pack-a.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <img class="lp-th lp-th2" src=${`${ASSETS}pack-b.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <img class="lp-th lp-th3" src=${`${ASSETS}pack-c.jpg`} alt="" width="84" height="84" loading="lazy" decoding="async" />
                  <span class="lp-dz-c">${t("landing.workflow.preview.dropHint")}</span>
                </div>
                <div class="lp-dz-m"><span class="lp-chipm"><span class="lp-gl" aria-hidden="true"><${Icon} name="arena" size=${11} strokeWidth=${3} /></span>${t("landing.workflow.preview.files")}</span><span>${t("landing.workflow.preview.fileTypes")}</span></div>
              </div>
            </article>

            <article class="lp-bc lp-b2">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="sliders" size=${22} /></span><span class="lp-num">02</span></div>
              <h3>${s2.title}</h3>
              <p>${s2.desc}</p>
              <div class="lp-pv">
                <div class="lp-chips">
                  ${chips.map((c) => html`
                    <span key=${c.id} class="lp-chip">
                      ${c.on && html`<${Icon} name="check" size=${13} strokeWidth=${2.6} className="lp-ic" />`}${t(`landing.workflow.chips.${c.id}`)}
                    </span>
                  `)}
                </div>
              </div>
            </article>

            <article class="lp-bc lp-b3">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="flame" size=${22} /></span><span class="lp-num">03</span></div>
              <h3>${s3.title}</h3>
              <p>${s3.desc}</p>
              <div class="lp-pv lp-p3">
                <span class="lp-fl lp-fl1"><${Icon} name="flame" size=${14} className="lp-ic" />${t("landing.workflow.preview.streak")}</span>
                <span class="lp-fl lp-fl2"><${Icon} name="bolt" size=${14} className="lp-ic" />${t("landing.workflow.preview.xp")}</span>
                <img class="lp-ph" src=${phoneSrc("arena", locale)} alt=${t("landing.workflow.preview.altArena")} width="864" height="1748" loading="lazy" decoding="async" />
              </div>
            </article>

            <article class="lp-bc lp-b4">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="trophy" size=${22} /></span><span class="lp-num">04</span></div>
              <h3>${s4.title}</h3>
              <p>${s4.desc}</p>
              <div class="lp-pv">
                <div class="lp-mini" aria-hidden="true">
                  <div class="lp-mc"><div class="lp-mi"><i style="height:62px"></i></div><b>A</b></div>
                  <div class="lp-mc lp-top"><div class="lp-mi"><i style="height:92px"></i><u></u></div><b>B</b></div>
                  <div class="lp-mc"><div class="lp-mi"><i style="height:44px"></i></div><b>C</b></div>
                  <div class="lp-mc"><div class="lp-mi"><i style="height:28px"></i></div><b>D</b></div>
                </div>
                <div class="lp-mini-m"><span class="lp-tagp">${t("landing.workflow.preview.rankTag")}</span><span>${t("landing.workflow.preview.rankMeta")}</span></div>
              </div>
            </article>

            <article class="lp-bc lp-b5">
              <div class="lp-bc-top"><span class="lp-ico"><${Icon} name="overview" size=${22} /></span><span class="lp-num">05</span></div>
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
    { key: "i1", icon: "results" }, { key: "i2", icon: "shuffle" },
    { key: "i3", icon: "target" }, { key: "i4", icon: "shield" },
  ];
  return html`
    <section class="lp-sec" id="lp-trust">
      <div class="lp-wrap">
        <${Reveal}>
          <div class="lp-sec-h">
            <span class="lp-eyebrow"><span class="lp-eb-ic" aria-hidden="true"><${Icon} name="shield" size=${13} strokeWidth=${3} /></span>${t("landing.trust.eyebrow")}</span>
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
            <span class="lp-eyebrow"><span class="lp-eb-ic" aria-hidden="true"><${Icon} name="phone" size=${13} strokeWidth=${3} /></span>${t("landing.mobile.eyebrow")}</span>
            <h2 class="lp-h2">${t("landing.mobile.title")}</h2>
            <p class="lp-sub">${t("landing.mobile.subtitle")}</p>
          </div>
          <ul class="lp-mb-list">
            <li class="lp-cx"><${Icon} name="arena" size=${16} className="lp-ic" />${t("landing.mobile.b1")}</li>
            <li class="lp-cx"><${Icon} name="overview" size=${16} className="lp-ic" />${t("landing.mobile.b2")}</li>
            <li class="lp-cx"><${Icon} name="chat" size=${16} className="lp-ic" />${t("landing.mobile.b3")}</li>
          </ul>
          <div class="lp-cta-row lp-mb-dl"><a class="lp-btn lp-btn-ghost" href="#/download"><${Icon} name="arrowDown" size=${16} className="lp-ic" /> ${t("landing.mobile.download")}</a></div>
        <//>
      </div>
      <div class="lp-fan-wrap">
        <div class="lp-fan" data-par="0.06">
          <img class="lp-f lp-f1" src=${phoneSrc("styles", locale)} alt=${t("landing.mobile.altStyles")} width="864" height="1748" loading="lazy" decoding="async" />
          <img class="lp-f lp-f2" src=${phoneSrc("arena", locale)} alt=${t("landing.mobile.altArena")} width="864" height="1748" loading="lazy" decoding="async" />
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
            <a class="lp-btn" href="#/register">${t("landing.play")} <${Icon} name="arrowRight" size=${18} strokeWidth=${2.2} className="lp-ic" /></a>
            <button type="button" class="lp-btn lp-btn-ghost" onClick=${() => scrollToId("lp-duel")}>${t("landing.tryDuel")}</button>
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
  useParallax(); // landing page only, never inside the app
  const locale = useLocale();
  // No dip-and-recover on a language change here (the app shell has one): on the landing page the fixed header and the hero would flash with it.
  return html`
    <div class="lp-root">
      <${Header} t=${t} />
      <main>
        <${Hero} t=${t} />
        <${CanTest} t=${t} />
        <${Duel} t=${t} />
        <${Workflow} t=${t} locale=${locale} />
        <${Trust} t=${t} />
        <${Mobile} t=${t} locale=${locale} />
        <${FinalCta} t=${t} />
      </main>
      <${Footer} t=${t} />
    </div>
  `;
}
