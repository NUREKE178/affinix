// The language switch (RU / KZ / EN): the sliding-key tabs in the app, the glass pill on the landing page. A module of its own so that the landing page
// does not have to download the whole app shell just to show it.
import { html, useState, useRef } from "../lib/preact.js";
import { useT, useLocale, setLocale, LOCALES } from "../lib/i18n.js";
import { useMyProfile, updateMyProfile } from "../lib/profile.js";
import { useThumb } from "../lib/thumb.js";
import { toast } from "./ui.js";

export function LanguageSwitch({ variant = "tabs" }) {
  const t = useT();
  const locale = useLocale();
  const { profile } = useMyProfile();
  const [pending, setPending] = useState(false);
  const host = useRef(null);
  const thumb = useRef(null);
  useThumb(host, thumb, locale);

  async function choose(id) {
    if (id === locale || pending) return;
    setLocale(id); // local + immediate -- the UI updates now, regardless of auth/DB state
    if (!profile) return; // not signed in (or profile still loading) -- nothing to persist
    setPending(true);
    try {
      await updateMyProfile({ locale: id });
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setPending(false);
    }
  }
  if (variant === "glass") {
    // Landing-page look (landing.css): a raised key sliding under three 38px legends -- same choose() logic as below.
    const idx = Math.max(0, LOCALES.findIndex((l) => l.id === locale));
    return html`
      <div class="lp-lang" role="group" aria-label=${t("landing.langLabel")}>
        <span class="lp-lang-pill" style=${`transform:translateX(${idx * 38}px)`}></span>
        ${LOCALES.map((l) => html`
          <button key=${l.id} type="button" disabled=${pending} aria-pressed=${locale === l.id} onClick=${() => choose(l.id)}
            class=${`lp-lang-b ${locale === l.id ? "lp-on" : ""}`}>${l.label}</button>
        `)}
      </div>
    `;
  }
  return html`
    <div class="sk-tabs flex items-center rounded-lg p-0.5 text-sm font-medium" data-compact="true" role="group" aria-label=${t("landing.langLabel")} ref=${host}>
      <span class="sk-thumb" ref=${thumb} aria-hidden="true"></span>
      ${LOCALES.map((l) => html`
        <button key=${l.id} disabled=${pending} data-active=${locale === l.id} aria-pressed=${locale === l.id} onClick=${() => choose(l.id)}
          class=${`sk-tab px-2.5 py-1.5 rounded-md disabled:opacity-50 ${locale === l.id ? "text-white" : "text-graphite-500 hover:text-graphite-300"}`}>${l.label}</button>
      `)}
    </div>
  `;
}
