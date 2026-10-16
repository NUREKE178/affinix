import { html } from "../lib/preact.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { Card, SectionHeading, EmptyState, Badge, LoadingState } from "../components/ui.js";
import { useT } from "../lib/i18n.js";
import { SettingsTabs } from "../components/subNav.js";

export function Billing() {
  const t = useT();
  const { org, loading } = useCurrentOrg();
  if (loading || !org) return html`<${LoadingState} label=${t("common.loading")} />`;

  return html`
    <div class="fade-in max-w-3xl space-y-5">
      <${SettingsTabs} current="billing" />
      <${SectionHeading} title=${t("billing.title")} subtitle=${t("billing.subtitle", { org: org.name })} />

      <${Card} className="p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-graphite-400">${t("billing.currentPlan")}</div>
            <div class="text-lg font-semibold text-graphite-100 mt-0.5">${t("billing.planName")}</div>
          </div>
          <${Badge} tone="signal">${t("billing.planActive")}<//>
        </div>
      <//>

      <${EmptyState}
        title=${t("billing.emptyTitle")}
        body=${t("billing.emptyBody")}
        icon="card"
      />
    </div>
  `;
}
