import { html } from "../../lib/preact.js";
import { navigate } from "../../router.js";
import { LogoMark } from "../../components/icons.js";
import { LanguageSwitch } from "../../components/languageSwitch.js";
import { useLocaleFadeClass } from "../../lib/i18n.js";

export function AuthLayout({ title, subtitle, children, footer }) {
  const localeFadeClass = useLocaleFadeClass();
  return html`
    <div class=${`min-h-screen bg-graphite-950 text-graphite-100 flex items-center justify-center px-6 py-10 ${localeFadeClass}`}>
      <div class="w-full max-w-sm">
        <div class="flex items-center justify-between mb-8">
          <button onClick=${() => navigate("/")} class="flex items-center gap-2.5">
            <${LogoMark} size=${36} />
            <span class="font-semibold text-lg tracking-tight">affinix<span class="text-graphite-500">.space</span></span>
          </button>
          <${LanguageSwitch} />
        </div>
        <div class="sk-panel rounded-2xl p-6 sm:p-7 fade-in">
          <h1 class="text-lg font-semibold text-graphite-50">${title}</h1>
          ${subtitle && html`<p class="text-sm text-graphite-400 mt-1.5">${subtitle}</p>`}
          <div class="mt-6">${children}</div>
        </div>
        ${footer && html`<div class="text-center mt-5 text-sm text-graphite-500">${footer}</div>`}
      </div>
    </div>
  `;
}

export function AuthError({ message }) {
  if (!message) return null;
  return html`<div class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">${message}</div>`;
}

export function AuthSuccess({ message }) {
  if (!message) return null;
  return html`<div class="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">${message}</div>`;
}
