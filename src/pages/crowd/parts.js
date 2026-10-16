// Small pieces the crowd-test pages share.
import { html } from "../../lib/preact.js";
import { Badge } from "../../components/ui.js";
import { imageUrl, testVerdict } from "../../lib/crowdStore.js";
import { MIN_RELIABLE_SAMPLE } from "../../lib/stats.js";

export const TESTS_NEW_PATH = "/app/overview/tests/new";
/** Under /app/overview so the sidebar keeps "Research" lit while a test is open. */
export const testPath = (id) => `/app/overview/tests/${id}`;

export const STATUS_TONE = { open: "emerald", closed: "steel", flagged: "amber", removed: "rose" };

export function StatusBadge({ status, t }) {
  return html`<${Badge} tone=${STATUS_TONE[status] ?? "neutral"}>${t(`crowd.status.${status}`)}<//>`;
}

/** "Option B" when an option has no caption. */
export const optionName = (item, t) => (item.label ? item.label : t("crowd.optionN", { n: String.fromCharCode(65 + (item.pos ?? 0)) }));

export function safeImageUrl(path) {
  try { return imageUrl(path); } catch { return null; }
}

/** An option as a small tile: its image when it has one, else the first letters of its text. */
export function OptionThumb({ item, size = 44 }) {
  const url = item.path ? safeImageUrl(item.path) : null;
  const box = { width: `${size}px`, height: `${size}px` };
  return url
    ? html`<span class="cr-thumb" style=${box}><img src=${url} alt="" loading="lazy" draggable="false" /></span>`
    : html`<span class="cr-thumb cr-thumb-text" style=${{ ...box, fontSize: `${Math.max(11, size * 0.32)}px` }}>${(item.label ?? "?").trim().slice(0, 2)}</span>`;
}

/** One sentence on where the test stands (see testVerdict for the rules). */
export function verdictText(test, t) {
  const v = testVerdict(test);
  if (v.state === "empty") return t("crowd.verdict.empty");
  if (v.state === "collecting") return t("crowd.verdict.collecting", { n: MIN_RELIABLE_SAMPLE });
  if (v.state === "winner") {
    return t("crowd.verdict.winner", {
      label: optionName(v.lead, t),
      pct: Math.round(v.lead.rate * 100),
      lo: Math.round(v.lead.ci[0] * 100),
      hi: Math.round(v.lead.ci[1] * 100),
    });
  }
  return t("crowd.verdict.close");
}
