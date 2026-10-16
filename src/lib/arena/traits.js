// The seven "taste" axes every Arena specimen is measured on. A trait value
// is a number in [-1, 1]; the pole labels live in the arena.traits.* locale
// keys. A user's Taste DNA is how consistently their picks lean along each axis
// (see dna.js).
import { hexToHsl, lightness } from "./color.js";

export const TRAIT_IDS = ["warm", "bold", "round", "airy", "vivid", "rich", "dark"];

export const clamp = (n, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));
export const r2 = (n) => Math.round(n * 100) / 100;

/** Hue -> warmth: orange +1, blue about -1, green neutral. */
export function warmthOfHue(h) {
  return Math.cos(((h - 30) * Math.PI) / 180);
}

/** Saturation-weighted warmth of a set of colours (greys count for nothing). */
export function warmOf(hexes) {
  let wsum = 0, acc = 0;
  for (const hex of hexes) {
    const [h, s, l] = hexToHsl(hex);
    const w = s * (1 - Math.abs(2 * l - 1) * 0.6); // near-black / near-white colours carry little hue
    wsum += w;
    acc += w * warmthOfHue(h);
  }
  return wsum < 0.04 ? 0 : clamp(acc / wsum);
}

/** Mean saturation mapped so a muted palette is about -0.8 and a punchy one +1. */
export function vividOf(hexes) {
  const mean = hexes.reduce((s, hex) => s + hexToHsl(hex)[1], 0) / Math.max(1, hexes.length);
  return clamp((mean - 0.3) / 0.35);
}

/** Dark background +1, white -1. */
export function darkOf(bg) {
  return clamp(1 - lightness(bg) / 50);
}

/** How dense a composition is, from an element count: few -> minimal (-1), many -> rich (+1). */
export function richOf(count, low = 2, high = 10) {
  return clamp(((count - low) / (high - low)) * 2 - 1);
}

/** Share of the canvas left empty, 0..1 -> airy (+1) / dense (-1). */
export function airyOf(emptyShare) {
  return clamp(emptyShare * 2 - 0.6);
}

/** Normalises a partial trait object into the full, rounded vector. */
export function finishTraits(t) {
  const out = {};
  for (const id of TRAIT_IDS) out[id] = r2(clamp(t[id] ?? 0));
  return out;
}

/** Euclidean distance between two trait vectors (0 .. ~5.3). */
export function traitDistance(a, b) {
  let s = 0;
  for (const id of TRAIT_IDS) s += (a[id] - b[id]) ** 2;
  return Math.sqrt(s);
}
