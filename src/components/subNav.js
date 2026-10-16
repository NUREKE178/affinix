// In-page tab bars that keep related pages together under one sidebar item:
// Research (overview, participants, reports) and Settings (organization, team, billing).
import { html } from "../lib/preact.js";
import { Tabs } from "./ui.js";
import { navigate } from "../router.js";
import { useT } from "../lib/i18n.js";

function SubNav({ tabs, current, testid }) {
  return html`
    <div class="mb-5" data-testid=${testid}>
      <${Tabs} tabs=${tabs} active=${current} onChange=${(id) => navigate(tabs.find((x) => x.id === id).path)} />
    </div>
  `;
}

export function ResearchTabs({ current }) {
  const t = useT();
  const tabs = [
    { id: "overview", label: t("shell.subnav.overview"), path: "/app/overview" },
    { id: "participants", label: t("shell.nav.participants"), path: "/app/participants" },
    { id: "reports", label: t("shell.nav.reports"), path: "/app/reports" },
  ];
  return html`<${SubNav} tabs=${tabs} current=${current} testid="subnav-research" />`;
}

export function SettingsTabs({ current }) {
  const t = useT();
  const tabs = [
    { id: "settings", label: t("shell.subnav.organization"), path: "/app/settings" },
    { id: "team", label: t("shell.workspace.team"), path: "/app/team" },
    { id: "billing", label: t("shell.workspace.billing"), path: "/app/billing" },
  ];
  return html`<${SubNav} tabs=${tabs} current=${current} testid="subnav-settings" />`;
}
