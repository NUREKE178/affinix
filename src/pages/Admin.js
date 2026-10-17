// The admin panel (platform admins and the owner only): how the platform is doing, who is on it, what to moderate, and
// a log of what admins did. Tabs live in the address (?tab=people) so a view can be linked to.
import { html } from "../lib/preact.js";
import { SectionHeading, Tabs, EmptyState, Skeleton } from "../components/ui.js";
import { PlatformBadge } from "../components/platformBadge.js";
import { useT } from "../lib/i18n.js";
import { useMyProfile } from "../lib/profile.js";
import { platformRoleOf } from "../lib/platformRole.js";
import { navigate } from "../router.js";
import { AdminOverview } from "./admin/Overview.js";
import { AdminPeople } from "./admin/People.js";
import { AdminModeration } from "./admin/Moderation.js";
import { AdminLog } from "./admin/Log.js";

const TABS = ["overview", "people", "moderation", "log"];

export function Admin({ query }) {
  const t = useT();
  const { profile, loading } = useMyProfile();
  const tab = TABS.includes(query?.get("tab")) ? query.get("tab") : "overview";

  if (loading) {
    return html`<div class="adm"><${Skeleton} className="h-7 w-56" /><${Skeleton} className="h-4 w-56 mt-3" /><${Skeleton} className="h-40 w-full mt-6 rounded-xl" /></div>`;
  }
  if (!profile?.is_admin) {
    return html`<${EmptyState} title=${t("admin.noAccessTitle")} body=${t("admin.noAccessBody")} icon="shield" />`;
  }

  const role = platformRoleOf(profile);
  const go = (id) => navigate(`/app/admin?tab=${id}`);
  const tabs = TABS.map((id) => ({ id, label: t(`admin.tabs.${id}`) }));
  return html`
    <div class="adm fade-in" data-testid="admin-panel" data-tab=${tab}>
      <${SectionHeading} title=${t("admin.title")} subtitle=${t("admin.subtitle")} action=${html`<${PlatformBadge} role=${role} />`} />
      <div class="mb-5" data-testid="admin-tabs"><${Tabs} tabs=${tabs} active=${tab} onChange=${go} /></div>
      ${tab === "overview" && html`<${AdminOverview} onOpenTab=${go} />`}
      ${tab === "people" && html`<${AdminPeople} isOwner=${role === "owner"} meId=${profile.id} />`}
      ${tab === "moderation" && html`<${AdminModeration} />`}
      ${tab === "log" && html`<${AdminLog} />`}
    </div>
  `;
}
