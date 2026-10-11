import { html, useState } from "../lib/preact.js";
import { navigate } from "../router.js";
import { Icon, Logo } from "../components/icons.js";
import { Button, Badge } from "../components/ui.js";
import { LanguageSwitch } from "../components/shell.js";
import { useT } from "../lib/i18n.js";

function ReportMetric({ label, value }) {
  return html`
    <div class="sk-display rounded-lg p-3">
      <div class="text-[11px] text-slate-500">${label}</div>
      <div class="text-lg font-semibold text-slate-100" style="font-variant-numeric:tabular-nums">${value}</div>
    </div>
  `;
}

function ExampleReport({ t }) {
  return html`
    <div class="sk-panel rounded-2xl p-5 sm:p-8">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h3 class="text-lg font-semibold text-slate-100">${t("landing.report.title")}</h3>
          <p class="text-sm text-slate-500 mt-1">${t("landing.report.subtitle")}</p>
        </div>
        <${Badge} tone="amber">${t("landing.report.badge")}<//>
      </div>

      <div class="sk-panel-flat rounded-xl p-5 mb-5">
        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">${t("landing.report.winnerLabel")}</div>
        <div class="flex items-end gap-3 flex-wrap">
          <span class="sk-slot-label inline-flex h-9 w-9 items-center justify-center rounded-lg text-white font-bold">B</span>
          <span class="text-2xl font-semibold text-slate-50">${t("landing.report.winnerName")}</span>
          <span class="text-3xl font-semibold text-emerald-400 ml-auto" style="font-variant-numeric:tabular-nums">42%</span>
        </div>
        <div class="sk-display flex h-2.5 w-full overflow-hidden rounded-full mt-4">
          <div style="width:42%;background:linear-gradient(180deg,#34d399,#10b981);box-shadow:0 0 8px -1px rgba(16,185,129,.7)"></div>
          <div style="width:27%;background:#475569"></div>
          <div style="width:19%;background:#475569"></div>
          <div style="width:12%;background:#475569"></div>
        </div>
        <div class="text-xs text-slate-500 mt-2">${t("landing.report.sampleLine")}</div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <${ReportMetric} label=${t("landing.report.metricTrust")} value="61%" />
        <${ReportMetric} label=${t("landing.report.metricQuality")} value="58%" />
        <${ReportMetric} label=${t("landing.report.metricPremium")} value="34%" />
        <${ReportMetric} label=${t("landing.report.metricPurchase")} value="4.6/7" />
      </div>

      <div class="sk-panel-flat rounded-xl p-5">
        <div class="flex items-center gap-2 mb-3 text-indigo-300"><${Icon} name="sparkle" size=${16} /><span class="text-sm font-semibold">${t("landing.report.aiTitle")}</span></div>
        <dl class="space-y-2.5 text-sm">
          <div><dt class="text-slate-500 text-xs uppercase tracking-wide">${t("landing.report.aiObservedLabel")}</dt><dd class="text-slate-300 mt-0.5">${t("landing.report.aiObserved")}</dd></div>
          <div><dt class="text-slate-500 text-xs uppercase tracking-wide">${t("landing.report.aiInterpretationLabel")}</dt><dd class="text-slate-300 mt-0.5">${t("landing.report.aiInterpretation")}</dd></div>
          <div><dt class="text-slate-500 text-xs uppercase tracking-wide">${t("landing.report.aiLimitationLabel")}</dt><dd class="text-slate-300 mt-0.5">${t("landing.report.aiLimitation")}</dd></div>
          <div><dt class="text-slate-500 text-xs uppercase tracking-wide">${t("landing.report.aiNextStepLabel")}</dt><dd class="text-slate-300 mt-0.5">${t("landing.report.aiNextStep")}</dd></div>
        </dl>
      </div>

      <p class="text-xs text-slate-500 mt-5 leading-relaxed">${t("landing.report.winnerCaveat")}</p>
    </div>
  `;
}

export function Landing() {
  const t = useT();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const WORKFLOW_ICONS = ["upload", "edit", "participants", "results", "insights"];
  const workflowSteps = ["s1", "s2", "s3", "s4", "s5"].map((key, i) => ({
    key, icon: WORKFLOW_ICONS[i],
    title: t(`landing.workflow.steps.${key}.title`),
    desc: t(`landing.workflow.steps.${key}.desc`),
  }));

  return html`
    <div class="min-h-screen bg-slate-950 text-slate-100">
      <header class="flex items-center justify-between px-6 py-5 lg:px-12 max-w-7xl mx-auto">
        <div class="flex items-center gap-2.5">
          <div class="sk-panel-flat flex h-9 w-9 items-center justify-center rounded-lg"><${Logo} size=${18} animated=${true} /></div>
          <span class="font-semibold text-lg tracking-tight">DecisionOS</span>
        </div>
        <div class="hidden sm:flex items-center gap-5">
          <${LanguageSwitch} />
          <${Button} variant="ghost" size="sm" onClick=${() => navigate("/login")}>${t("landing.login")}<//>
          <${Button} variant="primary" size="sm" onClick=${() => navigate("/register")}>${t("landing.createResearch")}<//>
        </div>
        <button onClick=${() => setMobileMenuOpen(true)} class="sk-btn sm:!hidden h-9 w-9 rounded-lg text-slate-300">
          <${Icon} name="menu" size=${19} />
        </button>
      </header>

      ${mobileMenuOpen && html`
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-6 fade-in" onClick=${() => setMobileMenuOpen(false)}>
          <div class="sk-panel w-full max-w-xs rounded-2xl p-6 flex flex-col items-center gap-5 text-center" onClick=${(e) => e.stopPropagation()}>
            <button onClick=${() => setMobileMenuOpen(false)} class="self-end -mt-2 -mr-2 text-slate-500 hover:text-slate-300 p-1"><${Icon} name="close" size=${18} /></button>
            <${LanguageSwitch} />
            <div class="flex flex-col items-stretch gap-2.5 w-full">
              <${Button} variant="ghost" className="w-full" onClick=${() => navigate("/login")}>${t("landing.login")}<//>
              <${Button} variant="primary" className="w-full" onClick=${() => navigate("/register")}>${t("landing.createResearch")}<//>
            </div>
          </div>
        </div>
      `}

      <section class="px-6 lg:px-12 max-w-4xl mx-auto text-center pt-10 pb-10">
        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] text-slate-50">${t("landing.heroTitle")}</h1>
        <p class="mt-5 text-lg text-slate-400 max-w-2xl mx-auto">${t("landing.heroSubtitle")}</p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <${Button} size="lg" onClick=${() => navigate("/register")}><${Icon} name="plus" size=${18}/> ${t("landing.createResearch")}<//>
        </div>
      </section>

      <section class="px-6 lg:px-12 max-w-6xl mx-auto py-14">
        <div class="text-center mb-10">
          <h2 class="text-2xl font-semibold text-slate-50">${t("landing.workflow.title")}</h2>
          <p class="text-sm text-slate-500 mt-2 max-w-xl mx-auto">${t("landing.workflow.subtitle")}</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          ${workflowSteps.map(
            (s, i) => html`
              <div key=${s.key} class="sk-panel-flat rounded-2xl p-5 relative">
                <div class="absolute top-4 right-4 text-xs text-slate-600 font-mono tracking-wider">${String(i + 1).padStart(2, "0")}</div>
                <div class="sk-display flex h-10 w-10 items-center justify-center rounded-lg text-indigo-300 mb-3"><${Icon} name=${s.icon} size=${18} /></div>
                <div class="font-semibold text-slate-100 text-sm">${s.title}</div>
                <div class="text-xs text-slate-500 mt-1.5 leading-relaxed">${s.desc}</div>
                ${i < workflowSteps.length - 1 && html`<div class="hidden lg:block absolute top-1/2 -right-2 text-slate-700"><${Icon} name="chevronRight" size=${14} /></div>`}
              </div>
            `
          )}
        </div>
      </section>

      <section class="px-6 lg:px-12 max-w-3xl mx-auto py-8">
        <${ExampleReport} t=${t} />
      </section>

      <section class="px-6 lg:px-12 max-w-4xl mx-auto py-10">
        <div class="sk-panel-flat rounded-2xl border-amber-500/15 p-6">
          <div class="flex items-start gap-3">
            <${Icon} name="shield" size=${20} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div class="font-semibold text-amber-200 text-sm">${t("landing.disclaimerTitle")}</div>
              <p class="text-sm text-slate-400 mt-1.5 leading-relaxed">${t("landing.disclaimerBody")}</p>
            </div>
          </div>
        </div>
      </section>

      <footer class="px-6 lg:px-12 max-w-6xl mx-auto py-10 text-center text-xs text-slate-600">
        ${t("landing.footer")}
      </footer>
    </div>
  `;
}
