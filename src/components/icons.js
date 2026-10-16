import { html } from "../lib/preact.js";

// Hand-built icon set (no external icon font/CDN needed) in one "powerful" style: heavy 2px strokes on a
// 24px grid, round caps and joins, and a tinted mass inside every closed shape ("duotone"), so each glyph
// reads as a solid object instead of a wireframe.
//   .b  shape with an outline AND a tinted body (the mass of the glyph)
//   .t  tint only, no outline (liquid level, shadows)
//   .f  solid detail (dots, small shapes)
// The tint is currentColor at 20 %; with `filled` it goes to 100 % (heart / bookmark toggles). See styles.css.
const PATHS = {
  overview: html`<rect class="b" x="3" y="3" width="7.5" height="9.5" rx="2"/><rect class="b" x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect class="b" x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect class="b" x="3" y="15.5" width="7.5" height="5.5" rx="2"/>`,
  experiments: html`<path class="t" d="M7.6 14h8.8l2.5 3.9a1.7 1.7 0 0 1-1.4 2.6H6.5a1.7 1.7 0 0 1-1.4-2.6z"/><path d="M9.5 3h5M10 3v5.6L4.9 17.4a2.2 2.2 0 0 0 1.9 3.3h10.4a2.2 2.2 0 0 0 1.9-3.3L14 8.6V3"/><circle class="f" cx="10.4" cy="17.2" r="1"/><circle class="f" cx="14.2" cy="16.4" r=".8"/>`,
  participants: html`<circle class="b" cx="9" cy="7.8" r="3.4"/><path class="b" d="M2.8 20.2c0-3.5 2.8-5.7 6.2-5.7s6.2 2.2 6.2 5.7z"/><circle class="b" cx="17.3" cy="8.6" r="2.5"/><path d="M16.1 14.6c2.6.3 4.5 2.3 4.5 5.4"/>`,
  results: html`<rect class="b" x="3" y="11" width="4" height="9.5" rx="1.3"/><rect class="b" x="10" y="3.5" width="4" height="17" rx="1.3"/><rect class="b" x="17" y="8" width="4" height="12.5" rx="1.3"/>`,
  insights: html`<path class="b" d="M10.5 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z"/><path class="b" d="M18.5 15.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>`,
  reports: html`<path class="b" d="M6.5 2.5h7.2l4.8 4.8v13.2a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M13.5 2.8v4.4h4.4"/><path d="M8.5 12.5h7M8.5 16.5h7M8.5 8.5h2.5"/>`,
  team: html`<circle class="b" cx="12" cy="7.8" r="3.3"/><path class="b" d="M6 20.5c0-3.4 2.6-5.6 6-5.6s6 2.2 6 5.6z"/><circle class="b" cx="4.8" cy="10.4" r="2"/><circle class="b" cx="19.2" cy="10.4" r="2"/><path d="M2 18.6c0-1.8 1.2-3.1 2.8-3.4M22 18.6c0-1.8-1.2-3.1-2.8-3.4"/>`,
  settings: html`<path class="b" fill-rule="evenodd" d="M19.4 13.5a7.4 7.4 0 0 0 0-3l1.9-1.3-1.5-2.6-2.2.6a7.3 7.3 0 0 0-2.6-1.5l-.3-2.2h-3l-.3 2.2a7.3 7.3 0 0 0-2.6 1.5l-2.2-.6-1.5 2.6 1.9 1.3a7.4 7.4 0 0 0 0 3l-1.9 1.3 1.5 2.6 2.2-.6a7.3 7.3 0 0 0 2.6 1.5l.3 2.2h3l.3-2.2a7.3 7.3 0 0 0 2.6-1.5l2.2.6 1.5-2.6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>`,
  menu: html`<path d="M4 6.5h16M4 12h16M4 17.5h16" stroke-width="2.4"/>`,
  close: html`<path d="M6 6l12 12M18 6L6 18" stroke-width="2.4"/>`,
  chevronRight: html`<path d="M9 5l7 7-7 7" stroke-width="2.4"/>`,
  chevronLeft: html`<path d="M15 5l-7 7 7 7" stroke-width="2.4"/>`,
  chevronDown: html`<path d="M5 9l7 7 7-7" stroke-width="2.4"/>`,
  chevronsLeft: html`<path d="M12 6l-6 6 6 6M19 6l-6 6 6 6" stroke-width="2.4"/>`,
  chevronsRight: html`<path d="M12 6l6 6-6 6M5 6l6 6-6 6" stroke-width="2.4"/>`,
  plus: html`<path d="M12 5v14M5 12h14" stroke-width="2.4"/>`,
  upload: html`<path d="M12 16V4M7 8.5l5-5 5 5" stroke-width="2.3"/><path class="b" d="M4 15.5v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5z"/>`,
  check: html`<path d="M4.8 12.8l4.7 4.7L19.2 7" stroke-width="2.6"/>`,
  clock: html`<circle class="b" cx="12" cy="12" r="8.8"/><path d="M12 7v5.2l3.4 2" stroke-width="2.2"/>`,
  play: html`<path class="b" d="M7.5 4.9v14.2a.6.6 0 0 0 .9.5l11-7.1a.6.6 0 0 0 0-1L8.4 4.4a.6.6 0 0 0-.9.5z"/>`,
  image: html`<rect class="b" x="3" y="4" width="18" height="16" rx="2.6"/><circle class="f" cx="8.5" cy="9.5" r="1.8"/><path d="M4 18l5-5 3.5 3.5L16.5 12 20 15.5"/>`,
  video: html`<rect class="b" x="2.5" y="5.5" width="13" height="13" rx="2.6"/><path class="b" d="M15.5 10.2l5.2-3v9.6l-5.2-3z"/>`,
  trash: html`<path d="M3.5 6.5h17M9 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v1.7"/><path class="b" d="M5.8 6.5l.9 12.7a2 2 0 0 0 2 1.8h6.6a2 2 0 0 0 2-1.8l.9-12.7"/><path d="M10 11v5.5M14 11v5.5"/>`,
  edit: html`<path class="b" d="M4 20l.9-3.7L16.3 4.9a1.7 1.7 0 0 1 2.4 0l.4.4a1.7 1.7 0 0 1 0 2.4L7.7 19.1z"/><path d="M14.3 6.9l2.8 2.8"/>`,
  external: html`<path d="M9 5.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/><path d="M13.5 3.5h7v7M20.5 3.5l-9 9" stroke-width="2.3"/>`,
  grip: html`<circle class="f" cx="8" cy="6" r="1.5"/><circle class="f" cx="8" cy="12" r="1.5"/><circle class="f" cx="8" cy="18" r="1.5"/><circle class="f" cx="16" cy="6" r="1.5"/><circle class="f" cx="16" cy="12" r="1.5"/><circle class="f" cx="16" cy="18" r="1.5"/>`,
  search: html`<circle class="b" cx="10.5" cy="10.5" r="6.6"/><path d="M20 20l-4.8-4.8" stroke-width="2.6"/>`,
  bell: html`<path class="b" d="M5.5 10a6.5 6.5 0 0 1 13 0v3.2l1.7 3.3H3.8l1.7-3.3z"/><path d="M9.5 19.5a2.6 2.6 0 0 0 5 0"/>`,
  copy: html`<path d="M15 9V6.5a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H9"/><rect class="b" x="9" y="9" width="11.5" height="11.5" rx="2.2"/>`,
  arrowRight: html`<path d="M4 12h16M14 5.5l6.5 6.5-6.5 6.5" stroke-width="2.4"/>`,
  arrowLeft: html`<path d="M20 12H4M10 5.5L3.5 12l6.5 6.5" stroke-width="2.4"/>`,
  shield: html`<path class="b" d="M12 2.8l7.5 3v5.6c0 5.2-3.2 8.3-7.5 9.9-4.3-1.6-7.5-4.7-7.5-9.9V5.8z"/><path d="M8.6 12l2.5 2.5 4.4-4.9" stroke-width="2.3"/>`,
  sparkle: html`<path class="b" d="M12 2.8l2.1 5.8 5.8 2.1-5.8 2.1L12 18.6l-2.1-5.8L4.1 10.7l5.8-2.1z"/><path class="b" d="M19 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`,
  user: html`<circle class="b" cx="12" cy="8" r="3.8"/><path class="b" d="M4.2 20.5c0-3.8 3.1-6.2 7.8-6.2s7.8 2.4 7.8 6.2z"/>`,
  card: html`<rect class="b" x="2.5" y="5" width="19" height="14" rx="2.6"/><path d="M2.5 10h19"/><path d="M6 15h4.5"/>`,
  globe: html`<circle class="b" cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2c2.4 2.4 3.6 5.4 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.4-3.6-8.8S9.6 5.6 12 3.2z"/>`,
  logout: html`<path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9"/><path d="M16 16.5l4.5-4.5L16 7.5M20 12H9" stroke-width="2.3"/>`,
  heart: html`<path class="b" d="M12 20.6s-7.6-4.6-9.9-9.4C.7 8.2 2.3 4.6 6 4.6c2.4 0 4.1 1.5 6 3.9 1.9-2.4 3.6-3.9 6-3.9 3.7 0 5.3 3.6 3.9 6.6-2.3 4.8-9.9 9.4-9.9 9.4z"/>`,
  bookmark: html`<path class="b" d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.6L5 21V4.5A1.5 1.5 0 0 1 6.5 3z"/>`,
  comment: html`<path class="b" d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16h-.5A1.5 1.5 0 0 1 4 14.5z"/>`,
  userPlus: html`<circle class="b" cx="8.5" cy="8" r="3.7"/><path class="b" d="M2 20.5c0-3.7 2.7-5.8 6.5-5.8s6.5 2.1 6.5 5.8z"/><path d="M18.5 8v6M15.5 11h6" stroke-width="2.4"/>`,
  userCheck: html`<circle class="b" cx="8.5" cy="8" r="3.7"/><path class="b" d="M2 20.5c0-3.7 2.7-5.8 6.5-5.8s6.5 2.1 6.5 5.8z"/><path d="M15.5 11.6l2.3 2.3 4-4.2" stroke-width="2.4"/>`,
  chat: html`<path class="b" d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.5-4.8A8.5 8.5 0 1 1 21 11.5z"/><circle class="f" cx="8" cy="11.5" r="1.2"/><circle class="f" cx="12" cy="11.5" r="1.2"/><circle class="f" cx="16" cy="11.5" r="1.2"/>`,
  send: html`<path class="b" d="M21.5 3l-6.8 18-4.2-7-7-4.2z"/><path d="M21.5 3L10.5 14"/>`,
  checks: html`<path d="M1.8 12.8l4.4 4.4L15 8.4M9.6 15.6l1.6 1.6L21.4 7" stroke-width="2.4"/>`,
  smile: html`<circle class="b" cx="12" cy="12" r="8.8"/><path d="M8.4 14.2c.9 1.3 2 2 3.6 2s2.7-.7 3.6-2"/><circle class="f" cx="9" cy="9.8" r="1.2"/><circle class="f" cx="15" cy="9.8" r="1.2"/>`,
  shuffle: html`<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>`,
  link: html`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
  arena: html`<rect class="b" x="2.8" y="4.5" width="18.4" height="15" rx="2.8"/><path d="M12 4.8v14.4"/><circle class="f" cx="7.4" cy="12" r="2.2"/><rect class="f" x="14.7" y="9.9" width="4.2" height="4.2" rx=".9"/>`,
  flame: html`<path class="b" d="M12 2.8c.6 3 4.6 4.8 4.6 9.2a4.6 4.6 0 0 1-9.2 0c0-1.9.9-3.1 1.9-4.1.2 1.3.9 2 1.6 2.3.1-2.3.3-4.6 1.1-7.4z"/>`,
  trophy: html`<path class="b" d="M7.5 4h9v5.4a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5v1.8a3.2 3.2 0 0 0 3.2 3.2M16.5 6h3v1.8a3.2 3.2 0 0 1-3.2 3.2"/><path d="M12 13.9V17M9 20.5h6M9.6 17h4.8"/>`,
  sliders: html`<path d="M4 8h2.4M11.6 8H20M4 16h8.4M17.6 16H20"/><circle class="b" cx="9" cy="8" r="2.6"/><circle class="b" cx="15" cy="16" r="2.6"/>`,
  bolt: html`<path class="b" d="M13.5 2.6L5 13.4h5.8l-.9 8L19 10.2h-5.9z"/>`,
  lock: html`<rect class="b" x="4.8" y="10.5" width="14.4" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle class="f" cx="12" cy="15.5" r="1.4"/>`,
  medal: html`<path d="M8.4 3.5L12 9.3l3.6-5.8"/><circle class="b" cx="12" cy="14.6" r="5.2"/>`,
  target: html`<circle class="b" cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="4.4"/><circle class="f" cx="12" cy="12" r="1.4"/>`,
  friends: html`<circle class="b" cx="8.5" cy="8" r="3.2"/><circle class="b" cx="15.5" cy="8" r="3.2"/><path d="M2.5 19.8c0-3.3 2.6-5.3 6-5.3 1.2 0 2.3.3 3.2.8M12.3 15.3c.9-.5 2-.8 3.2-.8 3.4 0 6 2 6 5.3"/>`,
};

/** `filled`: the tinted bodies go solid, for stateful toggles (heart / bookmark "active" states). */
export function Icon({ name, size = 18, className = "", strokeWidth, filled = false }) {
  const body = PATHS[name];
  if (!body) return null;
  const sw = strokeWidth ?? (size <= 20 ? 2.25 : 2); // optical size: a little heavier when small, so the glyphs stay strong in nav and buttons
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill=${filled ? "currentColor" : "none"}
      stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round"
      data-filled=${filled ? "true" : undefined} class=${`ic ${className}`.trim()}>${body}</svg>
  `;
}

/** The DecisionOS mark -- three paths of different weight and reach (what you're comparing) converging on one point
 * (the decision) -- as a PNG with its tile included, for every placement: sidebar, auth pages, public profile,
 * landing. (The boot screen and page loaders use the same file, see components/ui.js.) `size` is the rendered edge in
 * px; the 256px source stays sharp up to ~128px at 2x. */
export function LogoMark({ size = 24, className = "" }) {
  return html`<img src="./assets/logo/logo-mark-256.png" width=${size} height=${size} alt="" decoding="async" class=${`block shrink-0 ${className}`} />`;
}
