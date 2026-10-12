import { html } from "../lib/preact.js";

// Small hand-built line-icon set (no external icon font/CDN needed).
// Every icon shares the same stroke style so the sidebar reads as one
// consistent system.
const PATHS = {
  overview: html`<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>`,
  experiments: html`<path d="M9 2.5h6M10 2.5v6.2L4.8 17a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 8.7V2.5"/><path d="M7.5 14.5h9"/>`,
  participants: html`<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="8.5" r="2.4"/><path d="M15.7 14.7c2.5.4 4.3 2.3 4.3 5.3"/>`,
  results: html`<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M2.5 20h19"/>`,
  insights: html`<path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>`,
  reports: html`<path d="M7 2.5h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M14 2.5v4h4"/><path d="M8.5 13h7M8.5 16.5h7M8.5 9.5h3"/>`,
  team: html`<circle cx="8" cy="8" r="3.3"/><circle cx="16.3" cy="9" r="2.6"/><path d="M2.6 19.5c0-3 2.4-5.3 5.4-5.3s5.4 2.3 5.4 5.3"/><path d="M14 19.5c.2-2.4 1.8-4 3.8-4.4"/>`,
  settings: html`<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.4 7.4 0 0 0 0-3l1.9-1.3-1.5-2.6-2.2.6a7.3 7.3 0 0 0-2.6-1.5l-.3-2.2h-3l-.3 2.2a7.3 7.3 0 0 0-2.6 1.5l-2.2-.6-1.5 2.6 1.9 1.3a7.4 7.4 0 0 0 0 3l-1.9 1.3 1.5 2.6 2.2-.6a7.3 7.3 0 0 0 2.6 1.5l.3 2.2h3l.3-2.2a7.3 7.3 0 0 0 2.6-1.5l2.2.6 1.5-2.6z"/>`,
  menu: html`<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/>`,
  close: html`<path d="M5 5l14 14M19 5L5 19"/>`,
  chevronRight: html`<path d="M9 5l7 7-7 7"/>`,
  chevronLeft: html`<path d="M15 5l-7 7 7 7"/>`,
  chevronDown: html`<path d="M5 9l7 7 7-7"/>`,
  plus: html`<path d="M12 5v14M5 12h14"/>`,
  upload: html`<path d="M12 16V4M7 8.5l5-5 5 5"/><path d="M4 16.5v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2.5"/>`,
  check: html`<path d="M5 12.5l4.5 4.5L19 7"/>`,
  clock: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>`,
  play: html`<path d="M6 4.5v15l13-7.5z"/>`,
  image: html`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 18l5-5 3.5 3.5L17 12l3 3"/>`,
  video: html`<rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="M16.5 10l4.5-3v10l-4.5-3z"/>`,
  trash: html`<path d="M4.5 7h15M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M18 7l-.8 12a1.5 1.5 0 0 1-1.5 1.4H8.3A1.5 1.5 0 0 1 6.8 19L6 7"/>`,
  edit: html`<path d="M4 20l.9-3.6L16 5.3a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3L7.6 19.1z"/><path d="M14 7.3l2.7 2.7"/>`,
  external: html`<path d="M9 5.5H5.5A2 2 0 0 0 3.5 7.5v11A2 2 0 0 0 5.5 20.5h11A2 2 0 0 0 18.5 18.5V15"/><path d="M13.5 3.5h7v7M20.5 3.5l-9 9"/>`,
  grip: html`<circle cx="8" cy="6" r="1.2"/><circle cx="8" cy="12" r="1.2"/><circle cx="8" cy="18" r="1.2"/><circle cx="16" cy="6" r="1.2"/><circle cx="16" cy="12" r="1.2"/><circle cx="16" cy="18" r="1.2"/>`,
  search: html`<circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.3-4.3"/>`,
  bell: html`<path d="M6 9.5a6 6 0 0 1 12 0v3.4l1.6 3.1H4.4L6 12.9z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/>`,
  copy: html`<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2.5"/>`,
  arrowRight: html`<path d="M4 12h16M14 6l6 6-6 6"/>`,
  arrowLeft: html`<path d="M20 12H4M10 6l-6 6 6 6"/>`,
  shield: html`<path d="M12 3l7 3v5.5c0 5-3 8-7 9.5-4-1.5-7-4.5-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 9.5"/>`,
  sparkle: html`<path d="M12 3l1.4 3.8L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.2z"/><path d="M5 16l.8 1.8L7.5 18l-1.7.8L5 20.5l-.8-1.7L2.5 18l1.7-.2z"/>`,
  user: html`<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.6 3-6 7.5-6s7.5 2.4 7.5 6"/>`,
  card: html`<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19"/><path d="M6 14.5h4"/>`,
  globe: html`<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.3-3.5-8.5S9.7 5.8 12 3.5z"/>`,
  logout: html`<path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9"/><path d="M16 16.5l4.5-4.5L16 7.5"/><path d="M20 12H9"/>`,
  heart: html`<path d="M12 20.3s-7.3-4.4-9.6-9C1 8.4 2.5 5 6 5c2.3 0 3.9 1.4 6 3.8C14.1 6.4 15.7 5 18 5c3.5 0 5 3.4 3.6 6.3-2.3 4.6-9.6 9-9.6 9z"/>`,
  bookmark: html`<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z"/>`,
  comment: html`<path d="M4 5.5a1.5 1.5 0 0 1 1.5-1.5h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5v-3.5H5.5A1.5 1.5 0 0 1 4 14.5z"/>`,
  userPlus: html`<circle cx="9" cy="8" r="3.6"/><path d="M2 20c0-3.6 3-6 7-6 1 0 2 .2 2.8.5"/><path d="M18 9v6M15 12h6"/>`,
  userCheck: html`<circle cx="9" cy="8" r="3.6"/><path d="M2 20c0-3.6 3-6 7-6 1 0 2 .2 2.8.5"/><path d="M15 13l2.2 2.2L21.5 11"/>`,
  // Two equal, slightly overlapping heads -- deliberately distinct from
  // `team` (one bigger lead + one smaller, offset report) so Friends and
  // Team don't read as the same glyph in the same sidebar.
  chat: html`<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.5-4.8A8.5 8.5 0 1 1 21 11.5z"/>`,
  send: html`<path d="M21.5 3L10.5 14"/><path d="M21.5 3l-6.8 18-4.2-7-7-4.2z"/>`,
  checks: html`<path d="M1.8 12.8l4.4 4.4L15 8.4"/><path d="M9.6 15.6l1.6 1.6L21.4 7"/>`,
  smile: html`<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.9 1.3 2 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.8h.01M15 9.8h.01"/>`,
  friends: html`<circle cx="9" cy="8" r="3.4"/><circle cx="15" cy="8" r="3.4" opacity="0.55"/><path d="M3 19.5c0-3.4 2.7-6 6.5-6a7 7 0 0 1 3.4.9"/><path d="M12.4 14.5c1-.6 2.2-1 3.6-1 3.5 0 6.5 2.6 6.5 6"/>`,
};

/** `filled`: swaps fill to currentColor for stateful toggles (heart/bookmark
 * "active" states) -- every other icon stays its default outline. */
export function Icon({ name, size = 18, className = "", strokeWidth = 1.8, filled = false }) {
  const body = PATHS[name];
  if (!body) return null;
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill=${filled ? "currentColor" : "none"}
      stroke="currentColor" stroke-width=${strokeWidth} stroke-linecap="round" stroke-linejoin="round"
      class=${className}>${body}</svg>
  `;
}

/** The DecisionOS mark -- three paths of different weight and reach
 * (what you're comparing) converging on one point (the decision),
 * rather than a generic isometric-cube "tech logo." A dedicated
 * component, not a PATHS entry: unlike every other icon it needs more
 * than one color at once (two muted paths + one resolved in the accent
 * indigo), so it can't share Icon's single currentColor stroke.
 * `animated`: the one-time draw-in-and-resolve reveal, for a first-load
 * moment (the full-screen loader). Every other placement (sidebar,
 * headers) renders fully drawn and static except for the same slow
 * breathing glow on the resolved point both modes settle into -- so the
 * mark stays quietly alive in persistent chrome without being loud. */
export function Logo({ size = 24, animated = false, className = "" }) {
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none"
      class=${`sk-logo ${animated ? "sk-logo-animated" : ""} ${className}`}>
      <line class="sk-logo-path sk-logo-path-1" x1="3.5" y1="12" x2="11.5" y2="19" stroke="#475569" stroke-width="2.1" stroke-linecap="round" />
      <line class="sk-logo-path sk-logo-path-2" x1="9" y1="2.5" x2="11.5" y2="19" stroke="#64748b" stroke-width="2.1" stroke-linecap="round" />
      <line class="sk-logo-path sk-logo-path-3" x1="20.5" y1="9.5" x2="12.3" y2="19" stroke="#818cf8" stroke-width="2.6" stroke-linecap="round" />
      <circle class="sk-logo-point" cx="11.9" cy="19.3" r="2.6" fill="#818cf8" />
    </svg>
  `;
}
