// APP ICONS -- "an icon on a designer's desk".
//
// One app icon (iOS-style squircle, a rounded square, or a circle) on a calm backdrop with a soft stacked ground shadow,
// sometimes with two small replicas (34 px and 20 px) along the bottom to show how it holds up when it is tiny.
//   * 14 glyph archetypes (crescent, bolt, chat bubble, leaf, drop, 2x2 grid, ring / target, star, play, heart, sun, wave,
//     layers, flower), each with 4 variants (solid, outline, detailed, accent), all built from clean geometry on a +-40 box.
//   * 5 icon grounds: flat brand colour, diagonal 2-stop gradient (3 gradient recipes), deep dark with a lit glyph (+ glow),
//     white with a coloured glyph, duotone (tint + deep brand colour, or brand colour + accent).
//   * A season-level plan (a pure function of ctx.season) deals the 32 slots: every archetype appears 2-3x with different
//     variants, no palette repeats, grounds / shapes / replicas / heft / scale are stratified, so each pool is varied.
//
// Traits (all in [-1, 1], computed from what is drawn):
//   warm  = warmOf(icon colours + glyph)      vivid = vividOf(icon colours + glyph)      dark = darkOf(icon ground, a little backdrop)
//   bold  = 3.0 * (0.5 * glyphHeft + 0.5 * (cover - 0.3) / 0.45) - 1.5      glyphHeft: solid / thick strokes -> 1, hairlines -> 0.2;
//           cover = share of the icon's width the glyph spans (0.8 * glyph extent * glyph scale)
//   round = 0.78 * glyphRoundness + 0.22 * shape (circle +1, squircle +0.4, rounded square -0.1)
//   airy  = clamp((0.56 - cover) * 4) - 0.12 when replicas crowd the canvas
//   rich  = richOf(glyph parts + replicas + glow / gloss, 2, 11)
import { svgRoot, rect, el } from "../svgutil.js";
import { PALETTES } from "../palettes.js";
import { mix, contrast, hexToHsl, hsl, lightness } from "../color.js";
import { warmOf, vividOf, darkOf, richOf, clamp } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "attention", "trust", "quality", "premium"];
export const TEXT = false;
export const VIEWBOX = [240, 240];

const W = 240, H = 240;
const N_ARCH = 14;
const WHITE = "#ffffff", INK = "#14151a";

/* ------------------------------------------------------------------ small helpers */
const f = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const f1 = (n) => { const v = Math.round(n * 10) / 10; return v === 0 ? 0 : v; };
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (d) => (d * Math.PI) / 180;
const pol = (r, d) => [r * Math.cos(rad(d)), r * Math.sin(rad(d))];
const P = (...n) => n.map(f).join(" ");
const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
const poly = (arr, fill, x) => el("polygon", { points: pts(arr), fill, ...x });
const circ = (cx, cy, r, fill, x) => el("circle", { cx: f(cx), cy: f(cy), r: f(r), fill, ...x });
const pth = (d, fill, x) => el("path", { d, fill, ...x });
const strk = (d, color, w, x) => el("path", { d, fill: "none", stroke: color, "stroke-width": f(w), "stroke-linecap": "round", "stroke-linejoin": "round", ...x });
const grp = (tr, inner, x) => el("g", { transform: tr, ...x }, inner);
/** soft corners for polygons: a stroke in the fill colour with round joins */
const soft = (col, w) => ({ stroke: col, "stroke-width": f(w), "stroke-linejoin": "round" });
const sparkle = (cx, cy, r, fill) => pth(`M${P(cx, cy - r)}Q${P(cx + r * 0.1, cy - r * 0.1)} ${P(cx + r, cy)}Q${P(cx + r * 0.1, cy + r * 0.1)} ${P(cx, cy + r)}Q${P(cx - r * 0.1, cy + r * 0.1)} ${P(cx - r, cy)}Q${P(cx - r * 0.1, cy - r * 0.1)} ${P(cx, cy - r)}Z`, fill);
const starPts = (n, ro, ri, rot = -90) => Array.from({ length: n * 2 }, (_, j) => pol(j % 2 ? ri : ro, rot + (j * 180) / n));

/** Superellipse (n = 5, close to the iOS continuous corner) with half-size h, as a polygon path. */
function squircleD(h, n = 5, N = 96) {
  let d = "";
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    d += `${i ? "L" : "M"}${f1(h * Math.sign(c) * Math.abs(c) ** (2 / n))} ${f1(h * Math.sign(s) * Math.abs(s) ** (2 / n))}`;
  }
  return d + "Z";
}
const SHAPES = [
  squircleD(50),
  "M-22 -50H22A28 28 0 0 1 50 -22V22A28 28 0 0 1 22 50H-22A28 28 0 0 1 -50 22V-22A28 28 0 0 1 -22 -50Z",
  "M-50 0A50 50 0 1 0 50 0A50 50 0 1 0 -50 0Z",
];
const SHAPE_ROUND = [0.4, -0.1, 1];

/* ------------------------------------------------------------------ the 14 glyphs
   Each draws into a box of +-40 centred on (0,0) and returns { s, n: parts, rd: roundness -1..1, hv: heft 0..1, ext: share of the 80 box }.
   k = { g (glyph colour), g2 (an accent beside it), gd (detail drawn on top of the glyph, = the icon's own ground), hf (heft 0..1), v (variant 0..3), t1, t2 (0..1) } */

function moon(k) {
  const { g, g2, gd, hf, v, t1 } = k;
  const R = v === 3 ? 22 : 33, th = -42 - t1 * 16;
  const u = pol(1, th), nn = [-u[1], u[0]];
  const d = R * 0.5, thick = R * lerp(0.4, 0.62, hf), r = R + d - thick;
  const a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, R * R - a * a));
  const p1 = [a * u[0] + h * nn[0], a * u[1] + h * nn[1]], p2 = [a * u[0] - h * nn[0], a * u[1] - h * nn[1]];
  const large = a - d > 0 ? 1 : 0;
  const crescent = `M${P(...p1)}A${P(R, R)} 0 1 1 ${P(...p2)}A${P(r, r)} 0 ${large} 0 ${P(...p1)}Z`;
  const sx = ((R - a) / 2) * u[0], sy = ((R - a) / 2) * u[1]; // centre the crescent's bounding box
  let s, n = 1, ext = 0.84;
  if (v === 3) { // a moon in a disc
    s = circ(0, 0, 38, g2) + grp(`translate(${f(sx * 0.9 + 1)} ${f(sy * 0.9)})`, pth(crescent, g)); n = 2; ext = 0.95;
  } else {
    s = grp(`translate(${f(sx)} ${f(sy)})`, pth(crescent, g, { "stroke-linejoin": "round" }));
    if (v === 0) { s += sparkle(sx + u[0] * 22 + nn[0] * 10, sy + u[1] * 22 + nn[1] * 10, 6.5, g2); n = 2; }
    if (v === 2) { s += sparkle(sx + u[0] * 26 + nn[0] * 12, sy + u[1] * 26 + nn[1] * 12, 6, g2) + circ(sx + u[0] * 14 - nn[0] * 22, sy + u[1] * 14 - nn[1] * 22, 3, g2) + sparkle(sx + u[0] * 6 + nn[0] * 30, sy + u[1] * 6 + nn[1] * 30, 3.8, g2); n = 4; }
  }
  return { s, n, rd: 0.85, hv: 0.55 + hf * 0.35, ext };
}

function bolt(k) {
  const { g, g2, hf, v, t1 } = k;
  const B = [[8, -42], [-24, 4], [-4, 4], [-12, 42], [24, -8], [4, -8]];
  const sk = lerp(1.5, 5, hf);
  let s, n = 1, hv = 0.7 + hf * 0.3, ext = 1;
  if (v === 0) s = poly(B, g, soft(g, sk));
  else if (v === 1) { s = poly(B, "none", { ...soft(g, lerp(4.5, 8, hf)) }); hv = 0.25 + hf * 0.3; }
  else if (v === 2) { s = circ(0, 0, 38, "none", { stroke: g2, "stroke-width": f(lerp(3.5, 6, hf)) }) + grp("scale(.8)", poly(B, g, soft(g, sk))); n = 2; ext = 0.95; }
  else { s = grp("translate(-6 3) scale(.86)", poly(B, g, soft(g, sk))) + grp(`translate(${f(22 + t1 * 3)} ${f(-14)}) scale(.42)`, poly(B, g2, soft(g2, 2))); n = 2; ext = 0.95; }
  return { s, n, rd: -0.9, hv, ext };
}

function chat(k) {
  const { g, g2, gd, hf, v } = k;
  const bub = "M-20 -30H20A16 16 0 0 1 36 -14V6A16 16 0 0 1 20 22H-2L-22 38V22H-20A16 16 0 0 1 -36 6V-14A16 16 0 0 1 -20 -30Z";
  let s, n, hv = 0.9, ext = 0.9;
  if (v === 0) { s = pth(bub, g) + [-15, 0, 15].map((x) => circ(x, -4, 4.4, gd)).join(""); n = 4; }
  else if (v === 1) { s = pth(bub, g) + strk("M-20 -12H20", gd, 5) + strk("M-20 2H6", gd, 5); n = 3; }
  else if (v === 2) { s = pth(bub, "none", { stroke: g, "stroke-width": f(lerp(5, 8, hf)), "stroke-linejoin": "round" }) + [-14, 0, 14].map((x) => circ(x, -4, 3.6, g)).join(""); n = 4; hv = 0.3 + hf * 0.25; }
  else { s = grp("translate(8 10) scale(.62)", pth(bub, g2)) + grp("translate(-6 -4) scale(.8)", pth(bub, g) + [-12, 0, 12].map((x) => circ(x, -4, 3.8, gd)).join("")); n = 5; ext = 0.88; }
  return { s, n, rd: 0.6, hv, ext };
}

function leaf(k) {
  const { g, g2, gd, hf, v, t1 } = k;
  const L = "M0 38C-30 22 -30 -18 0 -40C30 -18 30 22 0 38Z";
  const rot = 28 + t1 * 24;
  const at = (bx, by, rot, sc, inner) => grp(`translate(${f(bx)} ${f(by)}) rotate(${f(rot)}) scale(${f(sc)}) translate(0 -38)`, inner); // a leaf standing on its base point
  let s, n, hv = 0.85, ext = 0.88;
  if (v === 0) { s = grp(`rotate(${f(rot)})`, pth(L, g) + strk("M0 40V-16", gd, 3.6) + strk("M0 12L10 2M0 12L-10 2M0 -2L8 -10M0 -2L-8 -10", gd, 2.6)); n = 4; }
  else if (v === 1) { s = at(0, 34, -30, 0.86, pth(L, g2)) + at(0, 34, 26, 0.92, pth(L, g) + strk("M0 34V-14", gd, 3.4)); n = 3; ext = 0.86; }
  else if (v === 2) { s = strk("M0 42C0 28 0 18 0 6", g, 5.5) + at(0, 14, 40, 0.58, pth(L, g)) + at(0, 24, -42, 0.5, pth(L, g2)); n = 3; hv = 0.5 + hf * 0.2; ext = 0.8; }
  else { s = circ(0, 0, 37, "none", { stroke: g2, "stroke-width": f(lerp(3.5, 6, hf)) }) + grp(`rotate(${f(rot)}) scale(.62)`, pth(L, g) + strk("M0 40V-16", gd, 4.6)); n = 3; hv = 0.35 + hf * 0.25; ext = 0.94; }
  return { s, n, rd: 0.3, hv, ext };
}

function drop(k) {
  const { g, g2, gd, hf, v } = k;
  const D = "M0 -42C4 -30 30 -6 30 14A30 30 0 0 1 -30 14C-30 -6 -4 -30 0 -42Z";
  let s, n = 2, hv = 0.9, ext = 0.88;
  if (v === 0) s = pth(D, g) + strk("M-16 8Q-16 22 -7 28", gd, 4.4, { "stroke-opacity": 0.5 });
  else if (v === 1) { s = pth(D, "none", { stroke: g, "stroke-width": f(lerp(5, 8, hf)), "stroke-linejoin": "round" }) + strk("M-15 10Q-15 21 -7 26", g2, 4); hv = 0.25 + hf * 0.3; }
  else if (v === 2) { s = pth(D, g) + strk("M-30 16Q-22 8 -15 16T0 16T15 16T30 16", gd, 4.2) + strk("M-26 28Q-19 21 -13 28T0 28T13 28T26 28", gd, 4.2, { "stroke-opacity": 0.6 }); n = 3; }
  else { s = grp("translate(-8 2) scale(.9)", pth(D, g) + strk("M-16 8Q-16 22 -7 28", gd, 4, { "stroke-opacity": 0.5 })) + grp("translate(24 20) scale(.38)", pth(D, g2)); n = 3; ext = 0.92; }
  return { s, n, rd: 0.45, hv, ext };
}

function grid(k) {
  const { g, g2, hf, v } = k;
  const q = [[-19, -19], [19, -19], [-19, 19], [19, 19]], sz = 32, r = lerp(6, 11, hf);
  const tile = (x, y, c, extra) => el("rect", { x: f(x - sz / 2), y: f(y - sz / 2), width: sz, height: sz, rx: f(r), fill: c, ...extra });
  let s = "", n = 4, hv = 0.9;
  if (v === 0) s = q.map(([x, y]) => tile(x, y, g)).join("");
  else if (v === 1) s = q.map(([x, y], i) => tile(x, y, i === 1 ? g2 : g)).join("");
  else if (v === 2) s = circ(-19, -19, 16, g) + tile(19, -19, g) + tile(-19, 19, g) + circ(19, 19, 16, g2);
  else { s = q.map(([x, y], i) => i === 3 ? tile(x, y, g2) : tile(x, y, "none", { stroke: g, "stroke-width": f(lerp(4, 6.5, hf)) })).join(""); hv = 0.3 + hf * 0.3; }
  return { s, n, rd: v === 2 ? 0.5 : 0.15, hv, ext: 0.97 };
}

function ring(k) {
  const { g, g2, hf, v, t1 } = k;
  const sw = lerp(6, 12, hf);
  let s, n, hv = 0.6 + hf * 0.3;
  if (v === 0) { s = circ(0, 0, 40 - sw / 2, "none", { stroke: g, "stroke-width": f(sw) }) + circ(0, 0, 12 + hf * 4, g2); n = 2; }
  else if (v === 1) { s = circ(0, 0, 38, "none", { stroke: g, "stroke-width": f(sw * 0.62) }) + circ(0, 0, 24, "none", { stroke: g2, "stroke-width": f(sw * 0.62) }) + circ(0, 0, 8.5, g); n = 3; hv = 0.3 + hf * 0.3; }
  else if (v === 2) { const rc = 40 - sw / 2, a0 = -50 + t1 * 30, [x0, y0] = pol(rc, a0), [x1, y1] = pol(rc, a0 + 300); s = strk(`M${P(x0, y0)}A${P(rc, rc)} 0 1 1 ${P(x1, y1)}`, g, sw) + circ(0, 0, 11 + hf * 4, g2); n = 2; }
  else { s = circ(0, 0, 40 - sw * 0.75, "none", { stroke: g, "stroke-width": f(sw * 1.5) }) + circ(0, 0, 14, "none", { stroke: g2, "stroke-width": f(sw * 0.5) }); n = 2; hv = 0.8 + hf * 0.2; }
  return { s, n, rd: 1, hv, ext: 0.97 };
}

function star(k) {
  const { g, g2, gd, hf, v, t1 } = k;
  let s, n = 1, rd, hv = 0.85, ext = 0.96;
  if (v === 0) { const sk = lerp(5, 10, hf); s = poly(starPts(5, 38 - sk / 2, 19 - sk / 2), g, soft(g, sk)); rd = 0.15; }
  else if (v === 1) { s = poly(starPts(5, 41, lerp(17, 21, hf)), g, soft(g, 1.2)); rd = -0.95; }
  else if (v === 2) { s = sparkle(-4, 4, 38, g) + sparkle(26, -26, 11, g2); n = 2; rd = -0.4; hv = 0.7; ext = 0.92; }
  else { s = poly(starPts(5, 40, 19.5), "none", soft(g, f(lerp(4, 6.5, hf)))) + poly(starPts(5, 15, 7), g2, soft(g2, 3)); n = 2; rd = -0.25; hv = 0.3 + hf * 0.25; }
  return { s, n, rd, hv, ext };
}

function play(k) {
  const { g, g2, gd, hf, v } = k;
  const T = (sc, sk) => grp(`translate(${f(4 * sc)} 0) scale(${sc})`, poly([[-18, -30], [-18, 30], [32, 0]], g, soft(g, sk)));
  const sk = lerp(6, 12, hf);
  let s, n = 1, rd = 0.1, hv = 0.85, ext = 0.86;
  if (v === 0) s = T(1, sk);
  else if (v === 1) { s = circ(0, 0, 37, "none", { stroke: g, "stroke-width": f(lerp(5, 8, hf)) }) + grp("translate(2.6 0) scale(.5)", poly([[-18, -30], [-18, 30], [32, 0]], g, soft(g, 7))); n = 2; rd = 0.6; hv = 0.3 + hf * 0.25; ext = 0.94; }
  else if (v === 2) { s = el("rect", { x: -36, y: -36, width: 72, height: 72, rx: 20, fill: "none", stroke: g, "stroke-width": f(lerp(5, 8, hf)) }) + grp("translate(2.6 0) scale(.5)", poly([[-18, -30], [-18, 30], [32, 0]], g, soft(g, 7))); n = 2; rd = 0.1; hv = 0.3 + hf * 0.25; ext = 0.9; }
  else { s = circ(0, 0, 37, g) + grp("translate(2.4 0) scale(.5)", poly([[-18, -30], [-18, 30], [32, 0]], gd, soft(gd, 7))); n = 2; rd = 0.5; ext = 0.94; }
  return { s, n, rd, hv, ext };
}

function heart(k) {
  const { g, g2, gd, hf, v } = k;
  const Hp = "M0 36C-46 6 -36 -32 -16 -32C-6 -32 0 -24 0 -20C0 -24 6 -32 16 -32C36 -32 46 6 0 36Z";
  let s, n = 1, hv = 0.9, ext = 0.92;
  if (v === 0) s = pth(Hp, g, soft(g, 3));
  else if (v === 1) { s = pth(Hp, "none", { stroke: g, "stroke-width": f(lerp(4.5, 9, hf)), "stroke-linejoin": "round" }); hv = 0.25 + hf * 0.3; }
  else if (v === 2) { s = pth(Hp, g) + strk("M-44 6H-17L-9 -12L3 22L11 6H44", gd, 4.2); n = 2; ext = 0.98; }
  else { s = grp("translate(9 6) scale(.62)", pth(Hp, g2)) + grp("translate(-6 -2) scale(.82)", pth(Hp, g, soft(g, 2))); n = 2; }
  return { s, n, rd: 0.8, hv, ext };
}

function sun(k) {
  const { g, g2, gd, hf, v, t1 } = k;
  const sw = lerp(4.5, 8, hf);
  const rays = (nn, r1, r2, c, c2, rot = 0) => { let o = ""; for (let i = 0; i < nn; i++) { const [x1, y1] = pol(r1, rot + (i * 360) / nn), [x2, y2] = pol(i % 2 && c2 ? r2 - 4 : r2, rot + (i * 360) / nn); o += strk(`M${P(x1, y1)}L${P(x2, y2)}`, i % 2 && c2 ? c2 : c, sw); } return o; };
  let s, n, hv = 0.5 + hf * 0.3, ext = 0.94;
  if (v === 0) { s = circ(0, 0, 15 + hf * 3, g) + rays(8, 26, 38 - sw / 2, g); n = 9; }
  else if (v === 1) { // sunrise on a horizon
    s = pth("M-23 12A23 23 0 0 1 23 12Z", g) + strk("M-38 22H38", g, sw) + strk("M-24 35H24", g2, sw * 0.85);
    for (let i = 0; i < 5; i++) { const a0 = -180 + (i * 180) / 4, [x1, y1] = pol(31, a0), [x2, y2] = pol(40 - sw / 2, a0); s += strk(`M${P(x1, y1 + 10)}L${P(x2, y2 + 10)}`, g, sw); }
    n = 8; ext = 0.92;
  }
  else if (v === 2) { s = circ(0, 0, 17, "none", { stroke: g, "stroke-width": f(sw * 0.85) }) + circ(0, 0, 7, g2) + rays(12, 26, 37 - sw / 2, g, null, 15); n = 14; hv = 0.25 + hf * 0.3; }
  else { s = circ(0, 0, 23 + hf * 3, g) + rays(8, 31, 38 - sw / 2, g2, null, 22.5); n = 9; hv = 0.85; }
  return { s, n, rd: 0.7, hv, ext };
}

function wave(k) {
  const { g, g2, gd, hf, v } = k;
  const wv = (y, amp = 7, per = 40) => `M-40 ${f(y)}Q${P(-40 + per / 4, y - amp * 2)} ${P(-40 + per / 2, y)}T${P(-40 + per, y)}T${P(-40 + per * 1.5, y)}T${P(-40 + per * 2, y)}`;
  const sw = lerp(6, 11, hf);
  let s, n, hv = 0.75, ext = 1;
  if (v === 0) { s = strk(wv(-18), g, sw) + strk(wv(2), g, sw) + strk(wv(22), g2, sw); n = 3; hv = 0.6 + hf * 0.3; }
  else if (v === 1) { s = [-27, -9, 9, 27].map((y, i) => strk(wv(y, 6, 40), i === 3 ? g2 : g, sw * 0.55)).join(""); n = 4; hv = 0.2 + hf * 0.3; }
  else if (v === 2) { s = circ(-12, -22, 13, g2) + strk(wv(4, 6.5, 40), g, sw) + strk(wv(24, 6.5, 40), g, sw); n = 3; hv = 0.6 + hf * 0.3; ext = 0.97; }
  else { // filled bands in a disc
    const band = (y, c) => pth(`${wv(y, 7, 40)}V40H-40Z`, c);
    s = `<defs><clipPath id="${k.id}-w"><circle r="37"/></clipPath></defs><g clip-path="url(#${k.id}-w)">${band(-16, g2)}${band(4, g)}${band(24, g2)}</g>`; n = 3; hv = 0.9; ext = 0.93;
  }
  return { s, n, rd: 0.9, hv, ext };
}

function layers(k) {
  const { g, g2, hf, v } = k;
  const dia = (cy, hw = 38, hh = 19) => `M0 ${f(cy - hh)}L${f(hw)} ${f(cy)}L0 ${f(cy + hh)}L${f(-hw)} ${f(cy)}Z`;
  const sw = lerp(5, 9, hf);
  let s, n = 3, hv = 0.8, rd = -0.85, ext = 0.95;
  if (v === 0) { s = strk(`M-38 18L0 37L38 18`, g, sw, { "stroke-opacity": 0.55 }) + strk(`M-38 2L0 21L38 2`, g, sw, { "stroke-opacity": 0.8 }) + pth(dia(-14), g, soft(g, 3)); }
  else if (v === 1) { s = pth(dia(16), g, { "fill-opacity": 0.4, ...soft(g, 2) }) + pth(dia(0), g, { "fill-opacity": 0.7, ...soft(g, 2) }) + pth(dia(-16), g, soft(g, 2)); hv = 0.9; }
  else if (v === 2) { const sq = (x, y, c, op) => el("rect", { x: f(x - 22), y: f(y - 22), width: 44, height: 44, rx: 11, fill: c, "fill-opacity": op }); s = sq(-13, 13, g2, 0.5) + sq(0, 0, g2, 0.8) + sq(13, -13, g, 1); rd = 0.2; ext = 0.88; }
  else { s = pth(dia(8, 40, 22), g2, soft(g2, 3)) + pth(dia(-12, 40, 22), g, soft(g, 3)); n = 2; hv = 0.95; ext = 0.97; }
  return { s, n, rd, hv, ext };
}

function flower(k) {
  const { g, g2, gd, hf, v, t1 } = k;
  let s = "", n, rd = 0.6, hv = 0.85, ext = 0.95;
  const petal = (rot, c, rx, ry, dist, extra) => grp(`rotate(${f(rot)})`, el("ellipse", { cx: 0, cy: -dist, rx, ry, fill: c, ...extra }));
  if (v === 0) { const nn = 8; for (let i = 0; i < nn; i++) s += petal((i * 360) / nn + 22.5, i % 2 ? g2 : g, 8.5 + hf * 2, 18, 20); s += circ(0, 0, 9, gd); n = 9; }
  else if (v === 1) { const nn = 6; for (let i = 0; i < nn; i++) s += petal((i * 360) / nn, "none", 9, 18, 20, { stroke: g, "stroke-width": f(lerp(3.5, 6, hf)) }); s += circ(0, 0, 8, g2); n = 7; hv = 0.3 + hf * 0.25; }
  else if (v === 2) { const r0 = 17; s = [[-11, -11, g, 0.9], [11, -11, g2, 0.9], [-11, 11, g2, 0.9], [11, 11, g, 0.9]].map(([x, y, c, o]) => circ(x, y, r0, c, { "fill-opacity": o })).join("") + circ(0, 0, 8, gd); n = 5; rd = 0.9; ext = 0.92; }
  else { const nn = 5, rot0 = t1 * 36; for (let i = 0; i < nn; i++) s += grp(`rotate(${f(rot0 + (i * 360) / nn)})`, pth("M0 0C-17 -8 -17 -34 0 -40C17 -34 17 -8 0 0Z", i % 2 ? g2 : g)); n = 5; rd = 0.4; ext = 1; }
  return { s, n, rd, hv, ext };
}

const ARCH = [moon, bolt, chat, leaf, drop, grid, ring, star, play, heart, sun, wave, layers, flower];
const ARCH_NAMES = ["Crescent", "Bolt", "Chat", "Leaf", "Drop", "Grid", "Ring", "Star", "Play", "Heart", "Sun", "Wave", "Layers", "Flower"];
// archetypes that read best a little smaller / larger inside the icon
const GSCALE = [0.95, 0.9, 0.92, 0.95, 0.92, 0.9, 0.92, 0.95, 0.9, 0.92, 0.92, 0.92, 0.95, 0.9];

/* ------------------------------------------------------------------ colour logic */
/** Shifts colour c away from bg (towards black or white) until the contrast reaches `min`. */
function toContrast(c, bg, min) {
  if (contrast(c, bg) >= min) return c;
  const dir = lightness(bg) > 55 ? "#000000" : "#ffffff";
  for (let q = 1; q <= 20; q++) { const m = mix(c, dir, q * 0.05); if (contrast(m, bg) >= min) return m; }
  return dir;
}
const hueShift = (c, dh, ds = 0) => { const [h, s, l] = hexToHsl(c); return hsl(h + dh, Math.min(1, s + ds), l); };

/** Icon ground (c1 -> c2 along the diagonal) and glyph colours for one of the 5 grounds. */
function paint(p, scheme, r1, r2) {
  const a = p.a, b = p.b;
  if (scheme === 0) { // flat brand colour
    const base = a, wh = contrast(WHITE, base) >= 2.6;
    const g = wh ? WHITE : contrast(INK, base) >= 4 ? INK : p.ink;
    return { c1: base, c2: base, g, g2: wh ? mix(base, WHITE, 0.6) : mix(base, "#000000", 0.5), gd: base, kind: "flat" };
  }
  if (scheme === 1) { // diagonal gradient
    const m = Math.floor(r1 * 3);
    let c1 = m === 0 ? mix(b, WHITE, 0.12) : m === 1 ? mix(a, WHITE, 0.26) : hueShift(a, 30, 0.1);
    let c2 = m === 0 ? a : m === 1 ? mix(a, "#000000", 0.3) : hueShift(a, -24, 0.05);
    const lum = (lightness(c1) + lightness(c2)) / 2;
    let g = WHITE;
    if (lum > 74) g = INK;
    else for (let q = 0; q < 6 && Math.min(contrast(WHITE, c1), contrast(WHITE, c2)) < 2.4; q++) { c1 = mix(c1, "#000000", 0.12); c2 = mix(c2, "#000000", 0.12); }
    const mid = mix(c1, c2, 0.5);
    return { c1, c2, g, g2: g === WHITE ? mix(mid, WHITE, 0.6) : mix(mid, "#000000", 0.5), gd: mid, kind: "gradient" };
  }
  if (scheme === 2) { // deep dark with a lit glyph
    const darkBase = lightness(p.bg) < 28 ? p.bg : lightness(p.ink) < 26 ? p.ink : "#15161c";
    const c1 = mix(darkBase, a, 0.12), c2 = mix(darkBase, "#000000", 0.4);
    const g = toContrast(mix(a, WHITE, 0.18), c1, 5.5), g2 = toContrast(b, c1, 3.2);
    return { c1, c2, g, g2, gd: mix(c1, c2, 0.5), glow: a, kind: "dark" };
  }
  if (scheme === 3) { // white with a coloured glyph
    const c1 = WHITE, c2 = mix(WHITE, a, 0.07);
    const hueC = hexToHsl(a)[1] < 0.3 && hexToHsl(b)[1] > hexToHsl(a)[1] ? b : a, other = hueC === a ? b : a;
    const g = toContrast(hueC, WHITE, 3.6), g2 = toContrast(other, WHITE, 1.7);
    return { c1, c2, g, g2, gd: mix(c1, c2, 0.4), kind: "white" };
  }
  // duotone
  if (r2 < 0.5) { // a light tint + the deep brand colour
    const base = mix(a, WHITE, 0.82), g = toContrast(mix(a, "#000000", 0.25), base, 6);
    return { c1: base, c2: mix(a, WHITE, 0.7), g, g2: a, gd: base, kind: "duo" };
  }
  const base = a, g0 = toContrast(b, base, 3.2), g = contrast(g0, base) >= 3 ? g0 : contrast(WHITE, base) >= 3 ? WHITE : INK;
  return { c1: base, c2: mix(a, "#000000", 0.12), g, g2: mix(g, base, 0.45), gd: base, kind: "duo2" };
}

/* ------------------------------------------------------------------ season plan */
function entry(season, i) {
  const r = mulberry32(hashStringToSeed(`appicon|plan|${season}`));
  const archOrder = shuffle(r, Array.from({ length: N_ARCH }, (_, j) => j));
  const vOff = Array.from({ length: N_ARCH }, () => Math.floor(r() * 4));
  const pal = shuffle(r, PALETTES.map((_, j) => j));
  const schemes = shuffle(r, [...Array(7).fill(0), ...Array(8).fill(1), ...Array(6).fill(2), ...Array(5).fill(3), ...Array(6).fill(4)]);
  const shapes = shuffle(r, [...Array(21).fill(0), ...Array(6).fill(1), ...Array(5).fill(2)]);
  const reps = shuffle(r, [...Array(14).fill(1), ...Array(18).fill(0)]);
  const bds = shuffle(r, Array.from({ length: 32 }, (_, j) => (j % 4) / 4 + r() * 0.2));
  const strat = () => shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.15 + 0.7 * r()) / 32));
  const hefts = strat(), gscales = strat(), sizes = strat();
  const gloss = shuffle(r, [...Array(12).fill(1), ...Array(20).fill(0)]);
  const k = Math.floor(i / N_ARCH), arch = archOrder[i % N_ARCH];
  return { arch, v: (vOff[arch] + k) % 4, pal: pal[i], scheme: schemes[i], shape: shapes[i], reps: reps[i], bd: bds[i], heft: hefts[i], gs: gscales[i], size: sizes[i], gloss: gloss[i] };
}

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const i = ((ctx.index % 32) + 32) % 32;
  const E = entry(String(ctx.season ?? ""), i);
  const p = PALETTES[E.pal];
  const t1 = rand(), t2 = rand(), t3 = rand(), t4 = rand();
  const id = ctx.id;
  const col = paint(p, E.scheme, t1, t2);
  const mean = mix(col.c1, col.c2, 0.5);

  // ---- backdrop: calm, and always separate from the icon
  const lightBd = mix(lightness(p.bg) > 82 ? p.bg : "#eceef2", p.a, 0.04);
  const darkBd = mix("#14151a", p.a, 0.06);
  const deepBd = mix(p.a, "#000000", 0.62);
  const opts = col.kind === "white" ? [darkBd, deepBd, mix(p.a, "#000000", 0.45)] : col.kind === "dark" ? [lightBd, "#0a0b0e", mix(lightBd, "#9aa0ab", 0.35)] : [lightBd, lightBd, darkBd, mix(lightBd, p.a, 0.1)];
  let bd = opts[Math.min(opts.length - 1, Math.floor(E.bd * opts.length))];
  if (contrast(mean, bd) < 1.3) bd = lightness(mean) > 50 ? darkBd : lightBd;
  const bdDark = lightness(bd) < 45;

  // ---- geometry
  const reps = E.reps === 1;
  const S = reps ? lerp(106, 122, E.size) : lerp(124, 150, E.size);
  const cx = 120, cy = reps ? 94 : 116, k0 = S / 100;
  const gs = lerp(0.5, 1.02, E.gs) * GSCALE[E.arch] * (reps ? 0.98 : 1);
  const gl = ARCH[E.arch]({ g: col.g, g2: col.g2, gd: col.gd, hf: E.heft, v: E.v, t1: t2, t2: t3, id });

  // ---- defs
  const q = `${id}-q`, gg = `${id}-g`, hh = `${id}-h`, ss = `${id}-s`, vv = `${id}-v`;
  const fillIcon = col.c1 === col.c2 ? col.c1 : `url(#${gg})`;
  let defs = `<path id="${q}" d="${SHAPES[E.shape]}"/>`;
  if (col.c1 !== col.c2) defs += `<linearGradient id="${gg}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col.c1}"/><stop offset="1" stop-color="${col.c2}"/></linearGradient>`;
  const hiCol = lightness(mean) > 60 ? "#ffffff" : "#ffffff";
  defs += `<linearGradient id="${hh}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hiCol}" stop-opacity="${lightness(mean) > 85 ? 0 : 0.55}"/><stop offset="0.45" stop-color="${hiCol}" stop-opacity="0"/></linearGradient>`;
  const glossy = E.gloss === 1 && col.kind !== "white";
  if (glossy) defs += `<linearGradient id="${ss}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0.02"/></linearGradient>`;
  defs += `<radialGradient id="${vv}" cx="0.5" cy="0.42" r="0.7"><stop offset="0" stop-color="${bdDark ? mix(bd, "#ffffff", 0.1) : "#ffffff"}" stop-opacity="${bdDark ? 1 : 0.7}"/><stop offset="1" stop-color="${bd}" stop-opacity="0"/></radialGradient>`;

  // ---- one icon (ground, highlight, glyph) at a given centre / edge length
  const hair = contrast(mean, bd) < 2.2 ? { stroke: mix(bd, bdDark ? "#ffffff" : "#000000", 0.22), "stroke-width": 1.1 } : {};
  const icon = (x, y, size, detail) => {
    const k = size / 100;
    let o = `<use href="#${q}" fill="${fillIcon}"${hair.stroke ? ` stroke="${hair.stroke}" stroke-width="${f(hair["stroke-width"] / k)}"` : ""}/>`;
    if (detail && glossy) o += `<use href="#${q}" fill="url(#${ss})"/>`;
    if (detail && col.glow) o += [34, 27, 20].map((r, j) => circ(0, 0, r, col.glow, { "fill-opacity": 0.05 + j * 0.01 })).join("");
    o += grp(`scale(${f(gs)})`, gl.s);
    if (detail) o += `<use href="#${q}" fill="none" stroke="url(#${hh})" stroke-width="1.6"/>`;
    return grp(`translate(${f(x)} ${f(y)}) scale(${f(k)})`, o);
  };

  // ---- shadow: stacked, low-opacity copies sinking below the icon
  const shOp = bdDark ? 0.1 : 0.05, shCol = bdDark ? "#000000" : "#10121c";
  let shadow = "";
  for (let j = 0; j < 6; j++) shadow += `<use href="#${q}" fill="${shCol}" fill-opacity="${shOp}" transform="translate(${cx} ${f(cy + (4 + j * 3.3) * k0)}) scale(${f(k0 * (1 + j * 0.02))})"/>`;
  if (bdDark) for (let j = 0; j < 4; j++) shadow += `<use href="#${q}" fill="${p.a}" fill-opacity="0.03" transform="translate(${cx} ${f(cy + 4)}) scale(${f(k0 * (1.06 + j * 0.07))})"/>`;

  let out = `<defs>${defs}</defs>` + rect(0, 0, W, H, bd, { rx: 12 }) + rect(0, 0, W, H, `url(#${vv})`, { rx: 12 }) + shadow + icon(cx, cy, S, true);
  if (reps) {
    const s1 = 34, s2 = 20, gap = 14, x0 = 120 - (s1 + gap + s2) / 2;
    out += icon(x0 + s1 / 2, 214 - s1 / 2, s1, false) + icon(x0 + s1 + gap + s2 / 2, 214 - s2 / 2, s2, false);
  }
  const svg = svgRoot(W, H, out);

  // ---- traits
  const cover = clamp(gl.ext * gs * 0.8, 0.2, 0.92);
  const hues = [col.c1, col.c2, col.g];
  const warm = warmOf([...hues, col.g2]);
  const vivid = vividOf(hues);
  const dark = darkOf(mix(mean, bd, 0.15));
  const bold = clamp(3.0 * (0.5 * gl.hv + 0.5 * ((cover - 0.3) / 0.45)) - 1.5);
  const round = clamp(0.78 * gl.rd + 0.22 * SHAPE_ROUND[E.shape]);
  const airy = clamp((0.56 - cover) * 4 - (reps ? 0.12 : 0));
  const rich = richOf(gl.n + (reps ? 2 : 0) + (glossy ? 1 : 0) + (col.glow ? 1 : 0), 2, 11);
  return {
    name: `${ARCH_NAMES[E.arch]} ${E.v} / ${col.kind} / ${["squircle", "rounded", "circle"][E.shape]}${reps ? " / sizes" : ""}`,
    svg,
    traits: { warm, bold, round, airy, vivid, rich, dark },
  };
}
