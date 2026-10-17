import { html, useState, useEffect } from "../lib/preact.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { updateOrganizationName } from "../lib/org.js";
import { invalidateOrgs } from "../lib/currentOrg.js";
import { Card, SectionHeading, Field, TextInput, Button, Badge, toast, LoadingState } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { useT } from "../lib/i18n.js";
import { SettingsTabs } from "../components/subNav.js";

export function Settings() {
  const t = useT();
  const { org, loading } = useCurrentOrg();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (org) setName(org.name); }, [org?.id]);

  async function saveName() {
    if (!name.trim() || name === org.name) return;
    setSaving(true);
    try {
      await updateOrganizationName(org.id, name.trim());
      invalidateOrgs();
      toast(t("settings.nameSaved"));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !org) return html`<${LoadingState} label=${t("common.loading")} />`;

  return html`
    <div class="fade-in max-w-3xl space-y-6">
      <${SettingsTabs} current="settings" />
      <${SectionHeading} title=${t("settings.title")} subtitle=${t("settings.subtitle")} />

      <${Card} className="p-5">
        <h3 class="font-semibold text-graphite-100 mb-4">${t("settings.orgTitle")}</h3>
        <${Field} label=${t("settings.orgNameLabel")}>
          <div class="flex gap-2">
            <${TextInput} value=${name} onInput=${(e) => setName(e.target.value)} />
            <${Button} size="sm" loading=${saving} disabled=${!name.trim() || name === org.name} onClick=${saveName}>${saving ? t("common.saving") : t("common.save")}<//>
          </div>
        <//>
        <${Field} label=${t("settings.yourRole")}>
          <${Badge} tone="signal">${t(`team.roles.${org.role}`)}<//>
        <//>
      <//>

      <${Card} className="p-5">
        <h3 class="font-semibold text-graphite-100 mb-4">${t("settings.defaultsTitle")}</h3>
        <div class="text-sm text-graphite-400 space-y-2">
          <div class="flex justify-between"><span>${t("settings.minSample")}</span><span class="text-graphite-200">${t("settings.minSampleValue")}</span></div>
          <div class="flex justify-between"><span>${t("settings.confidenceInterval")}</span><span class="text-graphite-200">${t("settings.confidenceValue")}</span></div>
        </div>
        <p class="text-xs text-graphite-500 mt-3">${t("settings.thresholdsNote")}</p>
      <//>

      <${Card} className="p-5">
        <h3 class="font-semibold text-graphite-100 mb-4">${t("settings.privacyTitle")}</h3>
        <ul class="text-sm text-graphite-400 space-y-2 list-disc pl-4">
          <li>${t("settings.privacy1")}</li>
          <li>${t("settings.privacy2")}</li>
          <li>${t("settings.privacy3")}</li>
        </ul>
      <//>

      <${Card} className="p-5 border-amber-500/20 bg-amber-500/[0.04]">
        <div class="flex gap-3">
          <${Icon} name="shield" size=${18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 class="font-semibold text-amber-200 text-sm mb-1.5">${t("settings.ethicsTitle")}</h3>
            <p class="text-sm text-graphite-400 leading-relaxed">${t("settings.ethicsBody")}</p>
          </div>
        </div>
      <//>
    </div>
  `;
}
