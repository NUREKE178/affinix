// PLACEHOLDER -- replaced by the real card specimen builder.
import { svgRoot, rect, text } from "../svgutil.js";
import { PALETTES } from "../palettes.js";
import { contrast } from "../color.js";

export const DIMS = ["preference", "trust", "quality", "clarity", "purchaseIntent"];
export const TEXT = true;
export const VIEWBOX = [240, 240];

export function build(rand, ctx) {
  const p = PALETTES[Math.floor(rand() * PALETTES.length)];
  const svg = svgRoot(240, 240, rect(0, 0, 240, 240, p.bg) + rect(60, 60, 120, 120, p.a, { rx: 18 }) + text(120, 132, "card " + ctx.index, { "text-anchor": "middle", "font-size": 14, fill: p.ink }));
  const traits = { warm: rand() * 2 - 1, bold: rand() * 2 - 1, round: rand() * 2 - 1, airy: rand() * 2 - 1, vivid: rand() * 2 - 1, rich: rand() * 2 - 1, dark: rand() * 2 - 1 };
  const c = contrast(p.ink, p.bg);
  return { name: "card " + ctx.index, svg, traits, legibility: { score: Math.min(1, c / 21), contrast: Math.round(c * 10) / 10, size: 0.5 } };
}
