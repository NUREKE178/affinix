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

/** Eight flat two-tone looks for options that have no picture, so a text-only option is a small poster instead of an empty
 * well. The look is chosen by a hash of the option's id (else its text), so one option always wears the same one. Text colours
 * are picked for contrast (white on the saturated ones, near-black on the light ones). */
export const TONES = [
  { bg: "#2f2170", bg2: "#5b3fd1", fg: "#ffffff" }, // violet
  { bg: "#0b3b36", bg2: "#178a74", fg: "#ffffff" }, // teal
  { bg: "#5c1d2b", bg2: "#c9433b", fg: "#ffffff" }, // coral
  { bg: "#e9d7a8", bg2: "#d9a83f", fg: "#2a1c05" }, // sand
  { bg: "#12304f", bg2: "#2f6fb0", fg: "#ffffff" }, // blue
  { bg: "#cde6a8", bg2: "#7cc24a", fg: "#10240a" }, // lime
  { bg: "#3b1a52", bg2: "#b8419f", fg: "#ffffff" }, // magenta
  { bg: "#f2f2f4", bg2: "#c3c6ce", fg: "#18191c" }, // paper
];

/** Which of TONES an option wears: a stable index from its id or text. */
export function toneIndex(item) {
  const key = String(item?.id ?? item?.label ?? "?");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % TONES.length;
}

export const toneStyle = (item) => {
  const t = TONES[toneIndex(item)];
  return { "--tone-a": t.bg, "--tone-b": t.bg2, "--tone-fg": t.fg };
};

/** An option as a small tile: its image when it has one, else the first letters of its text on its own colours. */
export function OptionThumb({ item, size = 44 }) {
  const url = item.path ? safeImageUrl(item.path) : null;
  const box = { width: `${size}px`, height: `${size}px` };
  return url
    ? html`<span class="cr-thumb" style=${box}><img src=${url} alt="" loading="lazy" draggable="false" /></span>`
    : html`<span class="cr-thumb cr-thumb-text" data-tone=${toneIndex(item)} style=${{ ...box, ...toneStyle(item), fontSize: `${Math.max(11, size * 0.32)}px` }}>${(item.label ?? "?").trim().slice(0, 2)}</span>`;
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
