// "Download": Affinix as an app. Installers for Windows (.exe) and Android (.apk) come from the latest GitHub release of the
// project (built by .github/workflows/release-apps.yml); until a release exists the page says so and offers the install-from-
// the-browser path, which works today on Windows and Android (Chrome / Edge) and on iPhone / Mac (Add to Home Screen).
// The same page is shown to visitors (/download) and inside the app (/app/download).
import { html, useState, useEffect } from "../lib/preact.js";
import { Button } from "../components/ui.js";
import { Icon, LogoMark } from "../components/icons.js";
import { LanguageSwitch } from "../components/languageSwitch.js";
import { useT, getLocale } from "../lib/i18n.js";
import { canInstall, isStandalone, promptInstall, subscribeInstall, detectPlatform } from "../lib/pwaInstall.js";
import { navigate } from "../router.js";

export const REPO = "NUREKE178/affinix";
export const ASSETS = { windows: "Affinix-Setup.exe", android: "Affinix.apk", linux: "Affinix.AppImage", deb: "Affinix.deb" };
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=8`;
const CACHE_KEY = "affinix_release_files";
const CACHE_MS = 10 * 60 * 1000;

const mb = (n) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
const direct = (name) => `https://github.com/${REPO}/releases/latest/download/${name}`;

/** { version, published, files: { windows?, android?, linux?, deb?: { url, size, version, published } } }
 *  null: no release yet (the page says the installers are being prepared);
 *  { unknown: true, files: {...direct links} }: GitHub could not be asked (offline, rate limit): the buttons still work, through the stable "latest" links.
 *  Each file comes from the newest release that has it, so a release in which one build failed does not take that app off the page. */
export async function fetchRelease(fetcher = fetch) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { const c = JSON.parse(raw); if (Date.now() - c.at < CACHE_MS) return c.data; }
  } catch { /* storage may be unavailable */ }
  let data = null;
  let cacheable = true;
  try {
    const res = await fetcher(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (res.ok) {
      const list = (await res.json()).filter((r) => !r.draft && !r.prerelease);
      const files = {};
      for (const r of list) {
        for (const [key, name] of Object.entries(ASSETS)) {
          if (files[key]) continue;
          const a = (r.assets ?? []).find((x) => x.name === name);
          if (a) files[key] = { url: a.browser_download_url, size: a.size, version: String(r.tag_name ?? "").replace(/^v/, ""), published: r.published_at };
        }
      }
      if (list.length) data = { version: String(list[0].tag_name ?? "").replace(/^v/, ""), published: list[0].published_at, files };
    } else if (res.status !== 404) {
      cacheable = false;
      data = { unknown: true, version: "", published: null, files: Object.fromEntries(Object.entries(ASSETS).map(([k, n]) => [k, { url: direct(n), size: 0, version: "", published: null }])) };
    }
  } catch {
    cacheable = false;
    data = { unknown: true, version: "", published: null, files: Object.fromEntries(Object.entries(ASSETS).map(([k, n]) => [k, { url: direct(n), size: 0, version: "", published: null }])) };
  }
  if (cacheable) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ } }
  return data;
}

function useInstallState() {
  const [, force] = useState(0);
  useEffect(() => subscribeInstall(() => force((n) => n + 1)), []);
  return { can: canInstall(), standalone: isStandalone() };
}

function Platform({ id, icon, name, note, children, first, testid }) {
  return html`
    <article class="dl-card sk-panel" data-first=${first} data-testid=${testid}>
      <div class="dl-card-head">
        <span class="dl-ico"><${Icon} name=${icon} size=${26} /></span>
        <div><h3>${name}</h3><p>${note}</p></div>
      </div>
      <div class="dl-card-body">${children}</div>
    </article>`;
}

export function DownloadPage({ standalone: standaloneLayout = false }) {
  const t = useT();
  const platform = detectPlatform();
  const [release, setRelease] = useState(undefined); // undefined = loading, null = none
  const { can, standalone } = useInstallState();
  const [done, setDone] = useState(false);
  useEffect(() => { let live = true; fetchRelease().then((r) => live && setRelease(r)); return () => { live = false; }; }, []);

  const files = release?.files ?? {};
  const info = (k) => {
    const f = files[k];
    if (!f || !f.version) return null; // the stable "latest" links carry no version
    return t("download.version", { v: f.version, size: mb(f.size), date: new Date(f.published).toLocaleDateString(getLocale()) });
  };
  // the visitor's own system comes first, but every download stays available to everyone
  const order = ({
    android: ["android", "windows", "linux", "apple"],
    linux: ["linux", "windows", "android", "apple"],
    ios: ["apple", "windows", "linux", "android"],
    mac: ["apple", "windows", "linux", "android"],
  })[platform] ?? ["windows", "linux", "android", "apple"];

  async function install() { const r = await promptInstall(); if (r === "accepted") setDone(true); }

  const cards = {
    windows: html`
      <${Platform} key="windows" icon="windows" name=${t("download.win.name")} note=${t("download.win.note")} first=${order[0] === "windows"} testid="dl-windows">
        ${files.windows
          ? html`<a class="dl-btn" href=${files.windows.url} data-testid="dl-windows-link" download><${Icon} name="arrowDown" size=${16} /> ${t("download.win.cta")}</a><p class="dl-meta">${info("windows")}</p>`
          : html`<p class="dl-meta" data-testid="dl-windows-soon">${release === undefined ? "…" : t("download.pending")}</p>`}
        <p class="dl-warn">${t("download.warn.win")}</p>
      <//>`,
    android: html`
      <${Platform} key="android" icon="android" name=${t("download.android.name")} note=${t("download.android.note")} first=${order[0] === "android"} testid="dl-android">
        ${files.android
          ? html`<a class="dl-btn" href=${files.android.url} data-testid="dl-android-link" download><${Icon} name="arrowDown" size=${16} /> ${t("download.android.cta")}</a><p class="dl-meta">${info("android")}</p>`
          : html`<p class="dl-meta" data-testid="dl-android-soon">${release === undefined ? "…" : t("download.pending")}</p>`}
        <p class="dl-warn">${t("download.warn.android")}</p>
      <//>`,
    linux: html`
      <${Platform} key="linux" icon="linux" name=${t("download.linux.name")} note=${t("download.linux.note")} first=${order[0] === "linux"} testid="dl-linux">
        ${files.linux || files.deb
          ? html`
            ${files.linux && html`<a class="dl-btn" href=${files.linux.url} data-testid="dl-linux-link" download><${Icon} name="arrowDown" size=${16} /> ${t("download.linux.cta")}</a><p class="dl-meta">${info("linux")}</p>`}
            ${files.deb && html`<a class="dl-btn dl-btn-2" href=${files.deb.url} data-testid="dl-deb-link" download><${Icon} name="arrowDown" size=${16} /> ${t("download.linux.ctaDeb")}</a><p class="dl-meta">${info("deb")}</p>`}`
          : html`<p class="dl-meta" data-testid="dl-linux-soon">${release === undefined ? "…" : t("download.pending")}</p>`}
        <p class="dl-warn">${t("download.warn.linux")}</p>
        <p class="dl-warn">${t("download.warn.deb")}</p>
      <//>`,
    apple: html`
      <${Platform} key="apple" icon="apple" name=${t("download.apple.name")} note=${t("download.apple.note")} first=${order[0] === "apple"} testid="dl-apple">
        <p class="dl-steps">${t("download.apple_steps")}</p>
      <//>`,
  };

  const body = html`
    <div class="dl fade-in" data-testid="download-page" data-platform=${platform}>
      <div class="dl-hero">
        <${LogoMark} size=${72} className="dl-mark" />
        <h1>${t("download.title")}</h1>
        <p>${t("download.sub")}</p>
        ${standalone && html`<p class="dl-installed" data-testid="dl-installed"><${Icon} name="check" size=${15} /> ${t("download.installed")}</p>`}
      </div>

      <section class="dl-browser sk-panel" data-testid="dl-browser">
        <div>
          <h3>${t("download.browser.title")}</h3>
          <p>${can ? t("download.browser.body") : t("download.browser.unavailable")}</p>
        </div>
        ${can && html`<${Button} onClick=${install} data-testid="dl-install"><${Icon} name="arrowDown" size=${16} /> ${done ? t("download.browser.done") : t("download.browser.cta")}<//>`}
      </section>

      <div class="dl-cards" data-testid="dl-cards">${order.map((k) => cards[k])}</div>

      <div class="dl-why">
        ${["1", "2", "3"].map((n) => html`<div key=${n}><b>${t(`download.why.t${n}`)}</b><span>${t(`download.why.b${n}`)}</span></div>`)}
      </div>
    </div>`;

  if (!standaloneLayout) return body;
  return html`
    <div class="dl-page">
      <header class="dl-top">
        <a class="dl-back" href="#/" onClick=${(e) => { e.preventDefault(); navigate("/"); }}><${LogoMark} size=${30} /><span>affinix<i>.space</i></span></a>
        <div class="dl-top-r"><${LanguageSwitch} /></div>
      </header>
      ${body}
    </div>`;
}
