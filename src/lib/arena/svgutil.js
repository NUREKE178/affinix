// Tiny SVG string helpers shared by the specimen builders.

/** Serialises an attribute map; null / undefined / false values are skipped, numbers are trimmed to 2 decimals. */
export function attrs(map) {
  let out = "";
  for (const [k, v] of Object.entries(map)) {
    if (v === null || v === undefined || v === false) continue;
    const val = typeof v === "number" ? String(Math.round(v * 100) / 100) : v;
    out += ` ${k}="${String(val).replace(/"/g, "&quot;")}"`;
  }
  return out;
}

export function el(tag, map, inner) {
  const a = attrs(map ?? {});
  return inner === undefined ? `<${tag}${a}/>` : `<${tag}${a}>${inner}</${tag}>`;
}

/** Escapes text for use inside <text>. */
export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The root <svg>. Builders pass their own viewBox; the host sizes it with CSS. */
export function svgRoot(w, h, inner, extra = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"${attrs(extra)}>${inner}</svg>`;
}

/** A vertical linear gradient def. `stops` = [[offset 0..1, colour], ...]. */
export function vGradient(id, stops, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join("")}</linearGradient>`;
}

export const rect = (x, y, w, h, fill, extra = {}) => el("rect", { x, y, width: w, height: h, fill, ...extra });
export const circle = (cx, cy, r, fill, extra = {}) => el("circle", { cx, cy, r, fill, ...extra });
export const path = (d, fill, extra = {}) => el("path", { d, fill, ...extra });
export const text = (x, y, content, extra = {}) => el("text", { x, y, ...extra }, esc(content));

/** Picks a PRNG value in [lo, hi). */
export const range = (rand, lo, hi) => lo + rand() * (hi - lo);
export const irange = (rand, lo, hi) => Math.floor(range(rand, lo, hi + 1));
export const chance = (rand, p) => rand() < p;
