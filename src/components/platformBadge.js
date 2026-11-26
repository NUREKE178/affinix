// "Owner of the platform" / "Administrator": the only people the app marks this way. Not the role in a company.
// The mark inside the chip is drawn here as a plain solid silhouette: the shared icon set uses a heavy stroke with a tinted body and dots,
// which at 13 px turned the crown into a lumpy blob.
import { html } from "../lib/preact.js";
import { useT } from "../lib/i18n.js";

const MARKS = {
  owner: html`<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M3.4 8.6l4.9 3.9L12 5.4l3.7 7.1 4.9-3.9-1.6 8.6H5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
    <rect x="5.2" y="19" width="13.6" height="2.4" rx="1.2" fill="currentColor" />
  </svg>`,
  admin: html`<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M12 2.8l7.2 2.8v5.5c0 4.9-3 8-7.2 9.5-4.2-1.5-7.2-4.6-7.2-9.5V5.6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
    <path d="M8.8 12l2.3 2.3 4.2-4.7" fill="none" stroke="var(--led)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`,
};

export function PlatformBadge({ role, className = "" }) {
  const t = useT();
  if (role !== "owner" && role !== "admin") return null;
  return html`
    <span class=${`sk-platform-badge ${className}`} data-role=${role} data-testid="platform-badge" title=${t(`platform.${role}Hint`)}>
      <span class="sk-glyph" data-tone=${role === "owner" ? "signal" : "steel"} style="--gs:20px" aria-hidden="true">${MARKS[role]}</span>${t(`platform.${role}`)}
    </span>
  `;
}
