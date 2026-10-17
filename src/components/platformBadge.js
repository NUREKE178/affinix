// "Owner of the platform" / "Administrator": the only people the app marks this way. Not the role in a company.
import { html } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { useT } from "../lib/i18n.js";

export function PlatformBadge({ role, className = "" }) {
  const t = useT();
  if (role !== "owner" && role !== "admin") return null;
  return html`
    <span class=${`sk-platform-badge ${className}`} data-role=${role} data-testid="platform-badge" title=${t(`platform.${role}Hint`)}>
      <${Icon} name=${role === "owner" ? "crown" : "shield"} size=${12} />${t(`platform.${role}`)}
    </span>
  `;
}
