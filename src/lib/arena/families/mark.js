// LOGO MARKS -- "an identity sheet from a good studio".
//
// A geometric brand mark + an invented wordmark, composed on a flat ground.
//   * 14 construction archetypes (ring+dot, bars, quarter-circles, split diamond, rosette, monogram badge,
//     orbit, chevrons, hexagon, waves, halftone, arch+sun, twin leaves, starburst), each with 4 variants.
//   * 5 lockups (stack, side-by-side, hero mark / cropped giant mark, container badge, left-aligned sheet),
//     7 wordmark treatments tied to the mark's stroke weight, 3 grounds (palette / brand colour / dark).
//   * A season-level plan (a pure function of ctx.season) assigns archetype, variant, palette, ground, lockup,
//     heft and scale to the 32 slots so every archetype appears 2-3x in a pool, no palette or name repeats and
//     the traits are spread over their whole range; build()'s own rand() then only adds fine variation.
//
// Traits (all in [-1, 1], computed from what is drawn):
//   warm  = warmOf(ground + mark colours)           vivid = vividOf(mark colours that carry hue)
//   dark  = darkOf(ground)
//   bold  = 2 * (0.58*markHeft + 0.27*wordHeft + 0.15*sizeShare) - 1   (stroke thickness / fill share, wordmark weight, mark size)
//   round = 0.82 * markRoundness + 0.18 * wordmarkRoundness            (circles / round caps +1 ... mitred polygons -1)
//   airy  = clamp((0.54 - u) * 3.6)    u = sqrt(inked area) / 240: mark box (weighted 55..100% by heft) + wordmark box, as a linear share of the canvas
//   rich  = richOf(shapes drawn + wordmark + extras, 2, 15)
import { svgRoot, rect, el, esc } from "../svgutil.js";
import { PALETTES, BRAND_NAMES } from "../palettes.js";
import { mix, contrast, hexToHsl, hsl, lightness } from "../color.js";
import { warmOf, vividOf, darkOf, richOf, clamp } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "attention", "trust", "quality", "premium", "purchaseIntent"];
export const TEXT = false;
export const VIEWBOX = [240, 240];

const W = 240, H = 240;
const FF = "Inter, system-ui, sans-serif";
const N_ARCH = 14;
const INK = "#141418", PAPER = "#ffffff";

/* ------------------------------------------------------------------ small helpers */
const f = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (d) => (d * Math.PI) / 180;
const pol = (r, d) => [r * Math.cos(rad(d)), r * Math.sin(rad(d))];
const P = (...n) => n.map(f).join(" ");
const pts = (arr) => arr.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
const poly = (arr, fill, x) => el("polygon", { points: pts(arr), fill, ...x });
const circ = (cx, cy, r, fill, x) => el("circle", { cx: f(cx), cy: f(cy), r: f(r), fill, ...x });
const pth = (d, fill, x) => el("path", { d, fill, ...x });
const strk = (d, color, w, x) => el("path", { d, fill: "none", stroke: color, "stroke-width": f(w), ...x });
const grp = (tr, inner) => `<g transform="${tr}">${inner}</g>`;
const rr = (x, y, w, h, r, fill, x2) => el("rect", { x: f(x), y: f(y), width: f(w), height: f(h), rx: f(Math.min(r, w / 2, h / 2)), fill, ...x2 });

// Inter advance widths (1/1000 em) at weight 400 / 800, Latin subset; linear in between.
const WT = Object.fromEntries(
  "A690/770|B654/665|C730/744|D722/723|E601/610|F590/585|G746/752|H743/749|I269/286|J571/590|K672/738|L565/565|M903/943|N753/766|O765/773|P639/652|Q765/782|R644/662|S642/660|T646/677|U744/727|V690/770|W985/1059|X682/761|Y679/752|Z629/679|a562/588|b612/638|c571/595|d612/638|e583/601|f370/410|g613/639|h591/635|i242/283|j242/283|k549/593|l242/283|m876/927|n591/635|o600/619|p612/638|q612/638|r376/420|s528/573|t327/382|u591/635|v562/615|w818/863|x546/594|y562/618|z552/581|0631/692|1407/441|2610/638|3618/657|4646/688|5593/634|6620/662|7566/588|8619/664|9620/662| 281/219|.288/353|,288/353|-460/471|&644/683|+662/686"
    .split("|").map((s) => [s[0], s.slice(1).split("/").map(Number)]),
);
/** Width of a string in px: Inter at `w` weight, `ls` em of tracking after every glyph. */
function tw(s, fs, w = 500, ls = 0) {
  const t = clamp((w - 400) / 400, -0.25, 1.25);
  let sum = 0, n = 0;
  for (const ch of s) { const e = WT[ch] ?? [600, 640]; sum += e[0] + (e[1] - e[0]) * t; n++; }
  return (sum / 1000 + ls * n) * fs;
}

/** Text with tracking compensation (SVG adds the spacing after the last glyph too, which would shift centred text). */
function T(x, y, s, fs, w, ls, fill, anchor = "middle", tail = "") {
  const dx = anchor === "middle" ? (ls * fs) / 2 : anchor === "end" ? ls * fs : 0;
  return el("text", { x: f(x + dx), y: f(y), "font-family": FF, "font-size": f(fs), "font-weight": w, "letter-spacing": ls ? f(ls * fs) : null, fill, "text-anchor": anchor }, esc(s) + tail);
}

/** Pushes colour c away from bg until it reaches a contrast ratio of `min`. */
function away(c, bg, min) {
  if (contrast(c, bg) >= min) return c;
  const toward = lightness(bg) > 55 ? "#000000" : "#ffffff";
  for (let t = 0.08; t <= 1.001; t += 0.08) { const m = mix(c, toward, t); if (contrast(m, bg) >= min) return m; }
  return toward;
}
/** The candidate with the best contrast against bg. */
const bestOn = (bg, cands) => cands.reduce((m, c) => (contrast(c, bg) > contrast(m, bg) ? c : m));
/** Desaturates (amount > 0) or boosts (amount < 0) a colour in HSL. */
function tone(c, amount) {
  const [h, s, l] = hexToHsl(c);
  return amount >= 0 ? hsl(h, s * (1 - amount), l) : hsl(h, Math.min(1, s + -amount * 0.25), l);
}

/* ------------------------------------------------------------------ the 14 archetypes
   Each draws into a local box centred on (0,0) and returns { s: svg, w, h: extent, n: shapes, rd: roundness -1..1, hv: heft 0..1 }.
   k = { a, b, c, bg, hf (heft 0..1), v (variant 0..3), t1, t2 (rand 0..1), soft, cap, ini, id }. */

function ringdot(k) {
  const { a, b, bg, hf, v, t1 } = k;
  let R = 44, sw = lerp(6, 16, hf), s, n = 2;
  if (v === 0) { // ring with a concentric dot
    const rc = R - sw / 2, gap = Math.max(7, sw * 0.9), dr = Math.min(R - sw - gap, R * 0.42);
    s = circ(0, 0, rc, "none", { stroke: a, "stroke-width": f(sw) }) + circ(0, 0, dr, b);
  } else if (v === 1) { // open ring with an orbiting dot in the gap
    const rc = R - sw / 2, th = -50 + t1 * 40, gam = 66;
    const [x0, y0] = pol(rc, th + gam / 2), [x1, y1] = pol(rc, th + 360 - gam / 2), [dx, dy] = pol(rc, th);
    s = pth(`M${P(x0, y0)}A${P(rc, rc)} 0 1 1 ${P(x1, y1)}`, "none", { stroke: a, "stroke-width": f(sw), "stroke-linecap": "round" }) + circ(dx, dy, Math.max(sw * 0.62, 7), b);
  } else if (v === 2) { // heavy ring, a tangent dot inside
    sw = lerp(12, 24, hf);
    const rc = R - sw / 2, inner = R - sw, dr = inner * 0.4, d = inner - dr - sw * 0.2, [dx, dy] = pol(d, 100 + t1 * 80);
    s = circ(0, 0, rc, "none", { stroke: a, "stroke-width": f(sw) }) + circ(dx, dy, dr, b);
  } else { // ring with a dot sitting on the circumference, haloed in the ground colour
    R = 40;
    const rc = R - sw / 2, dr = Math.max(sw * 0.95, 7), [dx, dy] = pol(rc, -45 + (t1 - 0.5) * 50);
    s = circ(0, 0, rc, "none", { stroke: a, "stroke-width": f(sw) }) + circ(dx, dy, dr + 3.5, bg) + circ(dx, dy, dr, b);
    n = 3;
  }
  return { s, w: 2 * R + 6, h: 2 * R + 6, n, rd: 1, hv: clamp(hf * 0.9 + 0.05, 0, 1) };
}

function bars(k) {
  const { a, b, hf, v, t1, cap } = k;
  const col = (i, m) => mix(a, b, m <= 1 ? 0 : i / (m - 1));
  let s = "", w, h, n;
  const bh0 = lerp(11, 20, hf);
  if (v === 3) { // ascending columns
    n = 4; const bw = lerp(16, 24, hf), g = bw * lerp(0.4, 0.65, t1), hs = [34, 54, 76, 100];
    w = n * bw + (n - 1) * g; h = 100;
    hs.forEach((hh, i) => { s += rr(-w / 2 + i * (bw + g), 50 - hh, bw, hh, (bw / 2) * cap, i === 3 ? b : a); });
  } else if (v === 1) { // centred, symmetric
    n = 3; const g = bh0 * lerp(0.55, 0.85, t1), ls = [78, 100, 54];
    h = n * bh0 + (n - 1) * g; w = 100;
    ls.forEach((l, i) => { s += rr(-l / 2, -h / 2 + i * (bh0 + g), l, bh0, (bh0 / 2) * cap, col(i, n)); });
  } else if (v === 2) { // shifted stair
    n = 4; const bh = bh0 * 0.85, g = bh * lerp(0.45, 0.75, t1), L = 60, step = 40 / 3;
    h = n * bh + (n - 1) * g; w = L + 40;
    for (let i = 0; i < n; i++) s += rr(-w / 2 + i * step, -h / 2 + i * (bh + g), L, bh, (bh / 2) * cap, col(i, n));
  } else { // left-aligned, descending
    n = 4; const bh = bh0 * 0.88, g = bh * lerp(0.5, 0.8, t1), ls = [100, 74, 50, 26];
    h = n * bh + (n - 1) * g; w = 100;
    ls.forEach((l, i) => { s += rr(-50, -h / 2 + i * (bh + g), l, bh, (bh / 2) * cap, col(i, n)); });
  }
  return { s, w, h, n, rd: -0.75 + 1.65 * cap, hv: clamp(hf * 0.85 + 0.1, 0, 1) };
}

function quarters(k) {
  const { a, b, c, v, hf, t1, t2 } = k;
  const g = lerp(3, 8, t1), cs = 44, half = g / 2;
  const cells = [[-cs - half, -cs - half], [half, -cs - half], [half, half], [-cs - half, half]]; // TL TR BR BL
  const cols = t2 < 0.5 ? [a, b, a, c] : [b, a, c, a];
  const qd = (x0, y0, q, col) => {
    const ax = q === 0 || q === 3 ? x0 : x0 + cs, ay = q === 0 || q === 1 ? y0 : y0 + cs;
    const sx = q === 0 || q === 3 ? 1 : -1, sy = q === 0 || q === 1 ? 1 : -1;
    return pth(`M${P(ax, ay)}L${P(ax + sx * cs, ay)}A${P(cs, cs)} 0 0 ${sx * sy > 0 ? 1 : 0} ${P(ax, ay + sy * cs)}Z`, col);
  };
  let s = "", rd = 0.6;
  if (v < 3) {
    const shift = [2, 0, 1][v];
    cells.forEach(([x0, y0], i) => { s += qd(x0, y0, (i + shift) % 4, cols[i]); });
  } else { // Bauhaus mix: two quarters, a full circle and a square
    s += qd(cells[0][0], cells[0][1], 2, cols[0]);
    s += circ(cells[1][0] + cs / 2, cells[1][1] + cs / 2, cs / 2, cols[1]);
    s += rr(cells[3][0], cells[3][1], cs, cs, cs * 0.1, cols[3]);
    s += qd(cells[2][0], cells[2][1], 0, cols[2]);
    rd = 0.25;
  }
  return { s, w: 2 * cs + g, h: 2 * cs + g, n: 4, rd, hv: 0.55 + hf * 0.3 };
}

function diamond(k) {
  const { a, b, c, v, hf, t1, t2, soft } = k;
  const hx = lerp(34, 42, t1), hy = lerp(44, 50, t2), r = soft ? lerp(2.5, 5, hf) : 0;
  const stk = (col) => (r ? { stroke: col, "stroke-width": f(r * 2), "stroke-linejoin": "round" } : {});
  const sh = (arr, col) => poly(arr, col, stk(col));
  const T0 = [0, -hy], R0 = [hx, 0], B0 = [0, hy], L0 = [-hx, 0], C0 = [0, 0];
  const mv = (arr, dx, dy) => arr.map(([x, y]) => [x + dx, y + dy]);
  let s, n = 2, w = 2 * hx, h = 2 * hy;
  const g = 3 + r * 2;
  if (v === 0) { // two halves, the right one dropped
    const d = lerp(6, 13, hf);
    s = sh(mv([T0, L0, B0], -g / 2, 0), a) + sh(mv([T0, R0, B0], g / 2, -d), b);
    w = 2 * hx + g; h = 2 * hy + d;
  } else if (v === 1) { // four exploded facets
    const e = g * 0.7;
    s = sh(mv([C0, T0, L0], -e, -e), mix(a, "#ffffff", 0.22)) + sh(mv([C0, T0, R0], e, -e), a) + sh(mv([C0, R0, B0], e, e), mix(a, "#000000", 0.22)) + sh(mv([C0, B0, L0], -e, e), b);
    w = 2 * hx + 2 * e; h = 2 * hy + 2 * e; n = 4;
  } else if (v === 2) { // outline with a solid core
    const sw = lerp(6, 14, hf), kk = 0.34;
    s = poly([T0, R0, B0, L0], "none", { stroke: a, "stroke-width": f(sw), "stroke-linejoin": soft ? "round" : "miter" }) + poly([[0, -hy * kk], [hx * kk, 0], [0, hy * kk], [-hx * kk, 0]], b, soft ? { stroke: b, "stroke-width": 3, "stroke-linejoin": "round" } : {});
    w += sw; h += sw;
  } else { // three facets
    const e = g * 0.6;
    s = sh(mv([T0, L0, B0], -e, 0), a) + sh(mv([T0, R0, C0], e, -e * 0.6), b) + sh(mv([C0, R0, B0], e, e * 0.6), c);
    w = 2 * hx + 2 * e; n = 3;
  }
  return { s, w, h, n, rd: soft ? -0.35 : -0.92, hv: 0.5 + hf * 0.35 };
}

function rosette(k) {
  const { a, b, hf, v, t1, bg } = k;
  let s = "", n, rd = 0.5;
  const petal = (ri, L, wd, col, rot) => grp(`rotate(${f(rot)})`, pth(`M0 ${f(-ri)}C${f(wd)} ${f(-ri - 0.3 * L)} ${f(wd)} ${f(-ri - 0.72 * L)} 0 ${f(-ri - L)}C${f(-wd)} ${f(-ri - 0.72 * L)} ${f(-wd)} ${f(-ri - 0.3 * L)} 0 ${f(-ri)}Z`, col));
  if (v === 0) { // lens petals
    n = t1 < 0.5 ? 6 : 8; const ri = 5, L = 45 - ri, wd = (L * lerp(0.36, 0.62, hf)) / 0.75 * (n === 8 ? 0.8 : 1);
    for (let i = 0; i < n; i++) s += petal(ri, L, wd, i % 2 ? b : a, (i * 360) / n);
    s += circ(0, 0, 4.5, bg); n += 1;
  } else if (v === 1) { // flower-of-life outline
    n = 7; const r0 = 21, sw = lerp(2.6, 5.5, hf);
    for (let i = 0; i < 6; i++) { const [x, y] = pol(r0, i * 60 - 90); s += circ(x, y, r0, "none", { stroke: i % 2 ? b : a, "stroke-width": f(sw) }); }
    s += circ(0, 0, r0, "none", { stroke: a, "stroke-width": f(sw) }); rd = 1;
  } else if (v === 2) { // pinwheel of 90-degree lens leaves
    n = 8; const ri = 6, D = 40;
    const rl = D * lerp(0.62, 0.9, 1 - hf), lens = `M0 ${f(-ri)}A${P(rl, rl)} 0 0 1 0 ${f(-ri - D)}A${P(rl, rl)} 0 0 1 0 ${f(-ri)}Z`;
    for (let i = 0; i < n; i++) s += grp(`rotate(${f((i * 360) / n)})`, pth(lens, i % 2 ? b : a));
    rd = 0.2;
  } else { // scalloped flower: ring of discs round a core
    n = 9; const cr = 15 + hf * 3, ro = 29;
    for (let i = 0; i < 8; i++) { const [x, y] = pol(ro, i * 45); s += circ(x, y, cr, i % 2 ? b : a); }
    s += circ(0, 0, 16, a); s += circ(0, 0, 7, bg); rd = 1;
  }
  return { s, w: 92, h: 92, n, rd, hv: 0.45 + hf * 0.35 };
}

function monogram(k) {
  const { a, b, c, bg, hf, v, ini, t1 } = k;
  const R = 44, em = tw(ini, 1, 800);
  const fs = Math.min(R * 1.2, (R * 2 * 0.56) / em);
  let s, n = 3;
  const knock = bestOn(a, [bg, c, PAPER, INK]);
  if (v === 0) {
    s = circ(0, 0, R, a) + circ(0, 0, R - 5.5, "none", { stroke: mix(a, knock, 0.45), "stroke-width": 1.4 }) + T(0, fs * 0.3635, ini, fs, 800, 0, knock);
  } else if (v === 1) {
    const dot = Math.max(3.4, fs * 0.085), gw = em * fs + dot * 2.4, x0 = -gw / 2, plate = contrast(c, bg) > 1.8 ? c : bestOn(bg, [INK, PAPER]);
    s = rr(-R, -R, 2 * R, 2 * R, lerp(10, 26, t1), plate) + T(x0, fs * 0.3635, ini, fs, 800, 0, bestOn(plate, [a, b, bg, PAPER]), "start") + circ(x0 + em * fs + dot * 1.4, fs * 0.3635 - dot, dot, bestOn(plate, [b, a, PAPER]));
  } else if (v === 2) {
    const sw = lerp(4, 8, hf), [dx, dy] = pol(R - sw / 2, -42);
    s = circ(0, 0, R - sw / 2, "none", { stroke: a, "stroke-width": f(sw) }) + T(0, fs * 0.3635, ini, fs * 0.94, 700, 0, bestOn(bg, [c, a, INK, PAPER])) + circ(dx, dy, sw * 0.95 + 2.5, bg) + circ(dx, dy, sw * 0.95, b);
    n = 4;
  } else {
    const bw = Math.min(R * 0.9, em * fs * 0.7);
    s = rr(-R, -R, 2 * R, 2 * R, R * 0.62, a) + T(0, fs * 0.3635 - 7, ini, fs * 0.92, 800, 0, knock) + rr(-bw / 2, 20, bw, 5.5, 2.75, bestOn(a, [b, knock]));
  }
  return { s, w: 2 * R, h: 2 * R, n, rd: v === 1 ? 0.15 + t1 * 0.5 : v === 3 ? 0.7 : 0.9, hv: 0.5 + hf * 0.35 };
}

function orbit(k) {
  const { a, b, c, bg, hf, v, t1 } = k;
  const sw = lerp(4, 9, hf), rx = 46, ry = lerp(15, 23, t1), sr = lerp(12, 19, hf);
  const half = (x, y, back) => `M${P(-x, 0)}A${P(x, y)} 0 0 ${back ? 1 : 0} ${P(x, 0)}`;
  const ring = (rot, col, back) => grp(`rotate(${rot})`, strk(half(rx, ry, back), bg, sw + 5, { "stroke-linecap": "round" }) + strk(half(rx, ry, back), col, sw, { "stroke-linecap": "round" }));
  let s, n = 4;
  if (v === 0) {
    s = ring(-28, a, true) + ring(28, b, true) + circ(0, 0, sr, c) + ring(-28, a, false) + ring(28, b, false);
  } else if (v === 1) {
    const th = 35 + t1 * 40, ex = rx * Math.cos(rad(th)), ey = ry * Math.sin(rad(th));
    const rot = rad(-24), px = ex * Math.cos(rot) - ey * Math.sin(rot), py = ex * Math.sin(rot) + ey * Math.cos(rot);
    s = ring(-24, a, true) + circ(0, 0, sr * 1.25, c) + ring(-24, a, false) + circ(px, py, sw * 1.25 + 2.5, bg) + circ(px, py, sw * 1.25, b);
  } else if (v === 2) {
    s = ring(45, a, true) + ring(-45, b, true) + circ(0, 0, sr, c) + ring(45, a, false) + ring(-45, b, false);
  } else {
    const r1 = 44, r2 = 26, sw2 = sw * 0.7, [x1, y1] = pol(r1, -40), [x2, y2] = pol(r2, 150);
    s = circ(0, 0, r1 - sw2 / 2, "none", { stroke: a, "stroke-width": f(sw2) }) + circ(0, 0, r2 - sw2 / 2, "none", { stroke: mix(a, bg, 0.35), "stroke-width": f(sw2) }) + circ(0, 0, sr * 0.75, c) + circ(x1, y1, sw2 * 2.4 + 2, bg) + circ(x1, y1, sw2 * 2.4, b) + circ(x2, y2, sw2 * 1.8 + 2, bg) + circ(x2, y2, sw2 * 1.8, a);
    n = 5;
    return { s, w: 92, h: 92, n, rd: 1, hv: 0.3 + hf * 0.3 };
  }
  return { s, w: 2 * (rx + 4), h: v === 2 ? 2 * (rx * 0.72 + sw) : 2 * (rx * 0.5 + ry * 0.6 + sw), n, rd: 0.95, hv: 0.25 + hf * 0.45 };
}

function chevrons(k) {
  const { a, b, hf, v, t1, t2 } = k;
  const nC = v === 2 ? 4 : 3, Wd = lerp(38, 46, t1), rise = lerp(16, 32, t2), th = lerp(8, 16, hf), gap = th * lerp(0.4, 0.8, t1), step = th + gap;
  let s = "";
  const rot = v === 1 ? 90 : v === 3 ? 180 : 0;
  const total = rise + th + (nC - 1) * step;
  for (let i = 0; i < nC; i++) {
    const col = mix(a, b, nC === 1 ? 0 : i / (nC - 1)), y = -total / 2 + i * step;
    if (v === 1 || v === 3) { // stroked, round
      const sw = th * 0.95;
      s += strk(`M${P(-Wd, y + rise + sw / 2)}L${P(0, y + sw / 2)}L${P(Wd, y + rise + sw / 2)}`, col, sw, { "stroke-linecap": "round", "stroke-linejoin": "round" });
    } else {
      s += poly([[-Wd, y + rise], [0, y], [Wd, y + rise], [Wd, y + rise + th], [0, y + th], [-Wd, y + rise + th]], col);
    }
  }
  const round = v === 1 || v === 3;
  return { s: rot ? grp(`rotate(${rot})`, s) : s, w: rot === 90 ? total : 2 * Wd, h: rot === 90 ? 2 * Wd : total, n: nC, rd: round ? 0.3 : -0.85, hv: clamp(0.25 + hf * 0.65, 0, 1) };
}

function hexagon(k) {
  const { a, b, c, bg, hf, v, soft, t1 } = k;
  const R = 46, flat = t1 < 0.35;
  const hv = (r) => Array.from({ length: 6 }, (_, i) => pol(r, (flat ? 0 : -90) + i * 60));
  const j = soft ? { "stroke-linejoin": "round" } : {};
  let s, n = 3, rd = soft ? -0.2 : -0.55;
  if (v === 0) { // solid hex, ring cut, core triangle
    const th = lerp(8, 15, hf);
    s = poly(hv(R), a, soft ? { stroke: a, "stroke-width": 6, "stroke-linejoin": "round" } : {}) + poly(hv(R - th - 7), bg, soft ? { stroke: bg, "stroke-width": 4, "stroke-linejoin": "round" } : {}) + poly(hv(R - th - 17).filter((_, i) => i % 2 === 0), b, j);
  } else if (v === 1) { // nested outlines
    const sw = lerp(3.5, 8, hf);
    s = poly(hv(R - sw / 2), "none", { stroke: a, "stroke-width": f(sw), ...j }) + poly(hv((R - sw / 2) * 0.66), "none", { stroke: b, "stroke-width": f(sw), ...j }) + poly(hv((R - sw / 2) * 0.32), a, j);
  } else if (v === 2) { // isometric cube
    const Vs = hv(R), O = [0, 0], gp = { stroke: bg, "stroke-width": 2.2, "stroke-linejoin": "round" };
    const top = flat ? [Vs[4], Vs[5], Vs[0], O] : [Vs[5], Vs[0], Vs[1], O], right = flat ? [O, Vs[0], Vs[1], Vs[2]] : [O, Vs[1], Vs[2], Vs[3]], left = flat ? [O, Vs[2], Vs[3], Vs[4]] : [O, Vs[3], Vs[4], Vs[5]];
    s = poly(top, b, gp) + poly(left, a, gp) + poly(right, mix(a, c, 0.35), gp);
    rd = -0.5;
  } else { // outline hex with a play triangle
    const sw = lerp(5, 12, hf), tr = R * 0.42;
    s = poly(hv(R - sw / 2), "none", { stroke: a, "stroke-width": f(sw), ...j }) + poly([[-tr * 0.62 + 3, -tr], [tr + 3, 0], [-tr * 0.62 + 3, tr]], b, soft ? { stroke: b, "stroke-width": 5, "stroke-linejoin": "round" } : {});
    n = 2;
  }
  return { s, w: flat ? 2 * R : 2 * R * 0.866, h: flat ? 2 * R * 0.866 : 2 * R, n, rd, hv: 0.35 + hf * 0.5 };
}

function waves(k) {
  const { a, b, bg, hf, v, t1, t2, id } = k;
  const sw = lerp(7, 15, hf), nW = v === 1 ? 4 : 3, A = lerp(6, 11, t1), sp = sw * lerp(1.9, 2.5, t2);
  const wv = (y, amp, x0 = -50) => `M${P(x0, y)}Q${P(x0 + 12.5, y - 2 * amp)} ${P(x0 + 25, y)}T${P(x0 + 50, y)}T${P(x0 + 75, y)}T${P(x0 + 100, y)}`;
  const o = { "stroke-linecap": "round" };
  let s = "", w = 100 + sw, h, n = nW;
  if (v === 0 || v === 1) {
    h = (nW - 1) * sp + 2 * A + sw;
    for (let i = 0; i < nW; i++) s += strk(wv(-h / 2 + A + sw / 2 + i * sp, v === 1 ? A * (1 - i * 0.22) : A), mix(a, b, nW === 1 ? 0 : i / (nW - 1)), sw, o);
  } else if (v === 2) { // waves cut out of a disc
    const cid = `${id}-w`, R = 44;
    s = `<defs><clipPath id="${cid}">${circ(0, 0, R, "#000")}</clipPath></defs>` + circ(0, 0, R, a) + `<g clip-path="url(#${cid})">`;
    for (let i = 0; i < 3; i++) s += strk(wv(-2 + i * (sw * 0.9 + 5), 5 + t1 * 3), i === 0 ? b : bg, Math.max(5, sw * 0.7), o);
    s += "</g>"; w = 2 * R; h = 2 * R; n = 4;
  } else { // one big wave and a sun
    s = strk(wv(8, A * 1.1), a, sw * 1.7, o) + strk(wv(8 + sw * 2.4, A * 1.1), b, sw * 1.2, o) + circ(18, -26, sw * 1.15 + 3, b);
    h = 80; n = 3;
  }
  return { s, w, h, n, rd: 0.85, hv: 0.2 + hf * 0.7 };
}

function halftone(k) {
  const { a, b, hf, v } = k;
  const m = v === 1 ? 5 : v === 3 ? 7 : 6, p = 96 / m, rmax = p * lerp(0.4, 0.53, hf);
  let s = "", n = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const x = (i - (m - 1) / 2) * p, y = (j - (m - 1) / 2) * p;
    let g;
    if (v === 0) { const d = Math.hypot(x, y) / ((m * p) / 2); if (d > 0.98) continue; g = 1 - d * 0.92; }
    else if (v === 1) g = (i + (m - 1 - j)) / (2 * (m - 1));
    else if (v === 2) g = 0.5 + 0.5 * Math.sin((i / (m - 1)) * Math.PI * 2 + j * 0.9);
    else g = 1 - Math.hypot(i, m - 1 - j) / ((m - 1) * 1.38);
    const r = rmax * (v === 0 ? Math.max(0.12, g) : 0.2 + 0.8 * g);
    if (r < 1.1) continue;
    s += circ(x, y, r, g > 0.82 && v !== 2 ? b : a); n++;
  }
  return { s, w: 96, h: 96, n, rd: 0.85, hv: 0.45 + hf * 0.4 };
}

function arch(k) {
  const { a, b, c, bg, hf, v, t1, t2 } = k;
  const Wd = lerp(58, 74, t1), Hh = lerp(82, 98, t2), x0 = -Wd / 2, x1 = Wd / 2, yT = -Hh / 2, yB = Hh / 2;
  const ap = (xa, xb, yt, yb) => { const r = (xb - xa) / 2; return `M${P(xa, yb)}V${P(yt + r)}A${P(r, r)} 0 0 1 ${P(xb, yt + r)}V${P(yb)}Z`; };
  let s, n = 3;
  if (v === 0) { // solid gate, inner arch cut, rising sun
    const t = lerp(9, 17, hf), ir = (Wd - 2 * t) / 2;
    s = pth(ap(x0, x1, yT, yB), a) + pth(ap(x0 + t, x1 - t, yT + t, yB), bg) + pth(`M${P(-ir * 0.62, yB)}A${P(ir * 0.62, ir * 0.62)} 0 0 1 ${P(ir * 0.62, yB)}Z`, b);
  } else if (v === 1) { // rainbow arches
    const sw = lerp(8, 14, hf), g = sw * 0.35;
    s = "";
    for (let i = 0; i < 3; i++) { const r = Wd / 2 - sw / 2 - i * (sw + g); s += strk(`M${P(-r, yB)}V${P(yT + Wd / 2)}A${P(r, r)} 0 0 1 ${P(r, yT + Wd / 2)}V${P(yB)}`, [a, b, c][i], sw); }
    const r3 = Wd / 2 - 3 * (sw + g) + g * 0.5; n = 4;
    if (r3 > 3) s += pth(`M${P(-r3, yB)}V${P(yT + Wd / 2)}A${P(r3, r3)} 0 0 1 ${P(r3, yT + Wd / 2)}V${P(yB)}Z`, a);
  } else if (v === 2) { // outline gate on a ground line with a sun
    const sw = lerp(5, 10, hf), ir = (Wd - sw) / 2;
    s = strk(`M${P(x0 + sw / 2, yB)}V${P(yT + Wd / 2)}A${P(ir, ir)} 0 0 1 ${P(x1 - sw / 2, yT + Wd / 2)}V${P(yB)}`, a, sw) + pth(`M${P(-ir * 0.55, yB - sw * 0.5)}A${P(ir * 0.55, ir * 0.55)} 0 0 1 ${P(ir * 0.55, yB - sw * 0.5)}Z`, b) + strk(`M${P(-Wd / 2 - 12, yB)}H${f(Wd / 2 + 12)}`, a, sw * 0.8, { "stroke-linecap": "round" });
    return { s, w: Wd + 24 + sw, h: Hh, n, rd: 0.3, hv: 0.3 + hf * 0.5 };
  } else { // twin arches
    const w1 = Wd * 0.56, h1 = Hh, w2 = Wd * 0.56, h2 = Hh * 0.72, g = 6;
    s = pth(ap(-w1 - g / 2, -g / 2, -h1 / 2, h1 / 2), a) + pth(ap(g / 2, g / 2 + w2, h1 / 2 - h2, h1 / 2), b); n = 2;
    return { s, w: w1 + w2 + g, h: h1, n, rd: 0.3, hv: 0.55 + hf * 0.3 };
  }
  return { s, w: Wd, h: Hh, n, rd: 0.3, hv: 0.35 + hf * 0.5 };
}

function leaves(k) {
  const { a, b, hf, v, t1, t2 } = k;
  const lens = (L, wd) => `M0 0C${f(wd)} ${f(-0.28 * L)} ${f(wd)} ${f(-0.72 * L)} 0 ${f(-L)}C${f(-wd)} ${f(-0.72 * L)} ${f(-wd)} ${f(-0.28 * L)} 0 0Z`;
  const lens90 = (L, rf) => { const r = L * rf; return `M0 0A${P(r, r)} 0 0 1 0 ${f(-L)}A${P(r, r)} 0 0 1 0 0Z`; };
  const fat = lerp(0.3, 0.42, hf);
  let s = "", n = 3;
  const stem = (len, col) => strk(`M0 0V${f(len)}`, col, lerp(4, 8, hf), { "stroke-linecap": "round" });
  const spread = lerp(26, 40, t1);
  if (v === 0) {
    const L = 64, wd = (L * fat) / 0.75;
    s = grp(`rotate(${f(-spread)})`, pth(lens(L, wd), a)) + grp(`rotate(${f(spread)})`, pth(lens(L, wd), b)) + stem(16, a);
  } else if (v === 1) {
    const L = 68, wd = (L * fat) / 0.75, L2 = L * lerp(0.55, 0.68, t2);
    s = grp(`rotate(${f(-18 - t1 * 10)})`, pth(lens(L, wd), a)) + grp(`rotate(${f(38 + t2 * 10)})`, pth(lens(L2, (L2 * fat) / 0.75), b)) + stem(14, a);
  } else if (v === 2) {
    const L = 60, fr = lerp(0.62, 0.8, 1 - hf);
    s = grp("rotate(-45)", pth(lens90(L, fr), a)) + grp("rotate(45)", pth(lens90(L, fr), b)) + circ(0, 4, lerp(3.5, 6, hf), a);
  } else {
    const L = 66, wd = (L * fat) / 0.75, L2 = L * 0.78;
    s = grp(`rotate(${f(-spread - 6)})`, pth(lens(L2, (L2 * fat) / 0.75), b)) + grp(`rotate(${f(spread + 6)})`, pth(lens(L2, (L2 * fat) / 0.75), b)) + pth(lens(L, wd), a) + stem(14, a); n = 4;
  }
  const ext = v === 2 ? { w: 86, h: 74 } : v === 3 ? { w: 92, h: 82 } : v === 1 ? { w: 78, h: 96 } : { w: 76, h: 80 };
  return { s: grp(`translate(0 ${f(v === 2 ? 22 : 30)})`, s), ...ext, n, rd: v === 2 ? -0.1 : 0.35, hv: 0.45 + hf * 0.4 };
}

function burst(k) {
  const { a, b, bg, hf, v, t1, t2 } = k;
  const R = 46;
  const star = (nn, ro, ri, rot = -90) => Array.from({ length: nn * 2 }, (_, i) => pol(i % 2 ? ri : ro, rot + (i * 180) / nn));
  let s, n = 3, rd, w = 2 * R, h = 2 * R;
  if (v === 0) { // sharp star
    const nn = [8, 10, 12, 14][Math.floor(t1 * 3.99)], ri = R * lerp(0.62, 0.8, t2);
    s = poly(star(nn, R, ri), a) + circ(0, 0, R * 0.3, bg) + circ(0, 0, R * 0.14, b);
    n = nn + 2; rd = -0.85;
  } else if (v === 1) { // soft rounded seal
    const nn = [8, 10, 12][Math.floor(t1 * 2.99)], ri = R * lerp(0.74, 0.86, t2), cr = 4;
    s = poly(star(nn, R - cr, ri - cr * 0.2), a, { stroke: a, "stroke-width": cr * 2, "stroke-linejoin": "round" }) + circ(0, 0, R * 0.36, bg) + circ(0, 0, R * 0.17, b);
    n = nn + 2; rd = 0.4;
  } else if (v === 2) { // sun rays
    const nn = [8, 10, 12][Math.floor(t1 * 2.99)], sw = lerp(5, 9, hf);
    s = circ(0, 0, 15 + hf * 3, a);
    for (let i = 0; i < nn; i++) { const [x1, y1] = pol(26, i * (360 / nn)), [x2, y2] = pol(i % 2 ? 38 : R - sw / 2, i * (360 / nn)); s += strk(`M${P(x1, y1)}L${P(x2, y2)}`, i % 2 ? b : a, sw, { "stroke-linecap": "round" }); }
    n = nn + 1; rd = 0.9;
  } else { // sparkle with a satellite
    const sp = (r, col, cx, cy) => pth(`M${P(cx, cy - r)}Q${P(cx + r * 0.1, cy - r * 0.1)} ${P(cx + r, cy)}Q${P(cx + r * 0.1, cy + r * 0.1)} ${P(cx, cy + r)}Q${P(cx - r * 0.1, cy + r * 0.1)} ${P(cx - r, cy)}Q${P(cx - r * 0.1, cy - r * 0.1)} ${P(cx, cy - r)}Z`, col);
    s = sp(40, a, -5, 6) + sp(16, b, 29, -28); n = 2; rd = -0.55; w = 92; h = 92;
  }
  return { s, w, h, n, rd, hv: 0.5 + hf * 0.3 };
}

const ARCH = [ringdot, bars, quarters, diamond, rosette, monogram, orbit, chevrons, hexagon, waves, halftone, arch, leaves, burst];
const ARCH_NAMES = ["Ring + dot", "Bar stack", "Quarter circles", "Split diamond", "Rosette", "Monogram badge", "Orbit", "Chevrons", "Hexagon", "Waves", "Halftone", "Arch + sun", "Twin leaves", "Starburst"];
const CROPPY = new Set([0, 2, 4, 6, 7, 8, 9, 10, 13]); // archetypes that look good as a cropped giant mark

/* ------------------------------------------------------------------ wordmark treatments */
// [weight, tracking (em), case (0 lower, 1 UPPER, 2 Title), base size, roundness, full stop]
const WM = [
  [800, -0.045, 0, 28, 0.2, 0],   // heavy tight lowercase
  [300, 0.34, 1, 12.5, -0.2, 0],  // light wide-tracked caps
  [600, 0.14, 1, 15, -0.2, 0],    // semibold caps
  [700, -0.02, 2, 24, 0.1, 0],    // bold title case
  [500, 0.1, 0, 19, 0.1, 0],      // medium lowercase, open
  [800, 0.005, 1, 21, -0.3, 0],   // extrabold caps
  [700, -0.03, 0, 26, 0.2, 1],    // bold lowercase + brand full stop
];
const wmText = (name, c) => (c === 0 ? name.toLowerCase() : c === 1 ? name.toUpperCase() : name);
const DESCR = ["STUDIO", "ATELIER", "GOODS", "WORKS", "LAB", "CLUB", "HOUSE", "SUPPLY"];

/* ------------------------------------------------------------------ season plan */
function entry(season, i) {
  const r = mulberry32(hashStringToSeed(`mark|plan|${season}`));
  const archOrder = shuffle(r, Array.from({ length: N_ARCH }, (_, j) => j));
  const vOff = Array.from({ length: N_ARCH }, () => Math.floor(r() * 4));
  const order = shuffle(r, PALETTES.map((_, j) => j));
  const names = shuffle(r, BRAND_NAMES.map((_, j) => j));
  const strat = () => shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.15 + 0.7 * r()) / 32));
  const hefts = strat(), scales = strat();
  const tones = shuffle(r, [...Array(6).fill(1), ...Array(3).fill(2), ...Array(23).fill(0)]);
  const sOff = Math.floor(r() * 3), lOff = Math.floor(r() * 5), cOff = Math.floor(r() * 4);
  const k = Math.floor(i / N_ARCH), arch = archOrder[i % N_ARCH];
  return { arch, v: (vOff[arch] + k) % 4, pal: order[i], name: names[i], heft: hefts[i], scale: scales[i], tone: tones[i], scheme: (i + 2 * k + sOff) % 3, layout: (i + 3 * k + lOff) % 5, cap: (i + k + cOff) % 3 };
}

/* ------------------------------------------------------------------ colour logic */
function grounds(p, scheme, tn) {
  const a0 = tn === 1 ? tone(p.a, 0.86) : tn === 2 ? tone(p.a, -0.5) : p.a;
  const b0 = tn === 1 ? tone(p.b, 0.86) : tn === 2 ? tone(p.b, -0.5) : p.b;
  if (scheme === 0) { // the palette's own ground
    const bg = p.bg, wm = away(p.ink, bg, 5);
    return { bg, a: away(a0, bg, 2.2), b: away(b0, bg, 1.5), c: wm, wm };
  }
  if (scheme === 1) { // brand colour ground, mark in the inverse
    const bg = a0, lightOk = contrast(PAPER, bg) >= contrast(INK, bg);
    const hi = lightOk ? (contrast(p.surface, bg) >= 3 ? p.surface : PAPER) : (contrast(p.ink, bg) >= 7 ? p.ink : INK);
    const lo = lightOk ? (contrast(p.ink, bg) >= 6 ? p.ink : INK) : (contrast(p.surface, bg) >= 3 ? p.surface : PAPER);
    const acc = contrast(b0, bg) >= 1.6 ? b0 : mix(hi, bg, 0.35);
    return { bg, a: hi, b: acc, c: lo, wm: hi };
  }
  const bg = lightness(p.bg) < 25 ? p.bg : lightness(p.ink) < 28 ? p.ink : mix(a0, "#000000", 0.82); // dark ground
  const lightN = bestOn(bg, [p.bg, p.surface, p.ink, "#f3f0ea"]);
  return { bg, a: away(a0, bg, 3.4), b: away(b0, bg, 2.4), c: lightN, wm: lightN };
}

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const i = ((ctx.index % 32) + 32) % 32;
  const E = entry(String(ctx.season ?? ""), i);
  const p = PALETTES[E.pal];
  const t1 = rand(), t2 = rand(), t3 = rand(), t4 = rand(), t5 = rand(), t6 = rand();
  const name = BRAND_NAMES[E.name];
  const mono = t3 < 0.2;
  let layout = E.layout;
  if (E.arch === 5 && layout === 3) layout = 0; // a monogram already is a badge
  const col = grounds(p, E.scheme, E.tone);
  const hf = E.heft, sc = E.scale;
  const k = { a: col.a, b: mono ? col.a : col.b, c: col.c, bg: col.bg, hf, v: E.v, t1, t2, soft: t4 < 0.45, cap: [0, 0.5, 1][E.cap], ini: name[0].toUpperCase(), id: ctx.id };
  // wordmark style follows the mark's heft (light mark <-> light type), with a little personal choice
  const wsi = hf < 0.2 ? (t5 < 0.5 ? 1 : 4) : hf < 0.42 ? (t5 < 0.5 ? 2 : 4) : hf < 0.66 ? (t5 < 0.34 ? 3 : t5 < 0.67 ? 2 : 6) : (t5 < 0.4 ? 0 : t5 < 0.7 ? 5 : 3);
  const ws = WM[wsi], str = wmText(name, ws[2]);
  const wmCol = col.wm, tail = (ws[5] ? `<tspan fill="${mono ? col.a : col.b}">.</tspan>` : "");
  const strW = (fs) => tw(str + (ws[5] ? "." : ""), fs, ws[0], ws[1]);
  const cy0 = ws[2] === 1 ? 0.3635 : 0.33; // vertical centre of the wordmark above its baseline, in em
  const descr = t2 < 0.3 && (layout === 0 || layout === 3) ? DESCR[Math.floor(t1 * DESCR.length)] : null;
  let out = "", inkA = 0, extra = 0, mk, markH;

  if (layout === 3) { // ------------- badge: the mark in a brand container
    const C = lerp(104, 140, sc), shape = Math.floor(t6 * 3);
    // container fill: the first clean, clearly visible colour of the mark (a light neutral on a brand ground), else ink / paper
    const clean = (c) => contrast(c, col.bg) >= 1.7 && (hexToHsl(c)[1] >= 0.28 || lightness(c) < 22 || lightness(c) > 86);
    const F = [col.a, col.b, col.c].find(clean) ?? bestOn(col.bg, [INK, PAPER]);
    const cands = [col.bg, PAPER, INK];
    const main = bestOn(F, cands);
    const acc = contrast(col.b, F) >= 1.8 ? col.b : mix(main, F, 0.38);
    const inv = { ...k, a: main, b: mono ? main : acc, c: bestOn(F, [INK, PAPER, col.c]), bg: F };
    mk = ARCH[E.arch](inv);
    const msz = C * (shape === 0 ? 0.6 : 0.62), scl = msz / Math.max(mk.w, mk.h);
    const fs = Math.min(ws[3] * lerp(0.85, 1.2, t2) * lerp(0.9, 1.15, sc), 190 / strW(1));
    const capH = 0.73 * fs, gap = 12 + C * 0.07, tot = C + gap + capH + (descr ? 15 : 0), top = 119 - tot / 2, cy = top + C / 2;
    out += shape === 0 ? circ(120, cy, C / 2, F) : shape === 1 ? rr(120 - C / 2, top, C, C, C * 0.24, F) : rr(120 - C / 2, top, C, C, C * 0.5, F);
    out += grp(`translate(120 ${f(cy)}) scale(${f(scl)})`, mk.s);
    const wy = top + C + gap + capH;
    out += T(120, wy, str, fs, ws[0], ws[1], wmCol, "middle", tail);
    if (descr) out += T(120, wy + 13, descr, 6, 500, 0.4, mix(wmCol, col.bg, 0.5));
    inkA = C * C * 0.85 + strW(fs) * capH;
    markH = C; extra = 1 + (descr ? 1 : 0); mk.n += 1;
  } else {
    mk = ARCH[E.arch](k);
    if (layout === 0) { // ------------- stack
      const M = lerp(84, 130, sc), scl = M / Math.max(mk.w, mk.h), mw = mk.w * scl, mh = mk.h * scl;
      const fs = Math.min(ws[3] * lerp(0.85, 1.2, t2) * lerp(0.85, 1.25, sc), 196 / strW(1));
      const capH = 0.73 * fs, gap = clamp(M * 0.23, 15, 30), tot = mh + gap + capH + (descr ? 15 : 0), top = 118 - tot / 2;
      out += grp(`translate(120 ${f(top + mh / 2)}) scale(${f(scl)})`, mk.s);
      const wy = top + mh + gap + capH;
      out += T(120, wy, str, fs, ws[0], ws[1], wmCol, "middle", tail);
      if (descr) out += T(120, wy + 13, descr, 6, 500, 0.4, mix(wmCol, col.bg, 0.5));
      inkA = mw * mh * (0.55 + 0.45 * mk.hv) + strW(fs) * capH;
      markH = mh; extra = 1 + (descr ? 1 : 0);
    } else if (layout === 1) { // ------------- side by side
      const M = lerp(60, 90, sc), scl = M / Math.max(mk.w, mk.h), mw = mk.w * scl, mh = mk.h * scl;
      const gap = M * 0.3, fsMax = (208 - mw - gap) / strW(1);
      const fs = Math.min(ws[3] * lerp(0.9, 1.25, t2) * lerp(0.9, 1.15, sc) * 1.05, fsMax);
      const tW = strW(fs), tot = mw + gap + tW, x0 = 120 - tot / 2;
      out += grp(`translate(${f(x0 + mw / 2)} 119) scale(${f(scl)})`, mk.s);
      out += T(x0 + mw + gap, 119 + cy0 * fs, str, fs, ws[0], ws[1], wmCol, "start", tail);
      inkA = mw * mh * (0.55 + 0.45 * mk.hv) + tW * 0.73 * fs;
      markH = mh; extra = 1;
    } else if (layout === 2) { // ------------- hero: giant mark, micro wordmark
      const crop = CROPPY.has(E.arch) && !(E.arch === 0 && E.v === 1) && t6 < 0.62;
      if (crop) { // a cropped giant mark in one corner, the wordmark in the opposite one
        const M = lerp(215, 266, sc), scl = M / Math.max(mk.w, mk.h), corner = Math.floor(t1 * 4);
        const cx = corner % 2 === 0 ? W - M * 0.2 : M * 0.2, cyy = corner < 2 ? M * 0.2 : H - M * 0.2;
        const left = corner % 2 === 0, top = corner < 2;
        const cid = `${ctx.id}-c`, fs = ws[3] * lerp(1.0, 1.35, t2);
        const wx = left ? 24 : W - 24, wy = top ? H - 26 : 40;
        out += `<defs><clipPath id="${cid}">${rect(0, 0, W, H, "#000", { rx: 12 })}</clipPath></defs><g clip-path="url(#${cid})">${grp(`translate(${f(cx)} ${f(cyy)}) scale(${f(scl)})`, mk.s)}</g>`;
        const fs2 = Math.min(fs, 150 / strW(1));
        const ink = bestOn(col.bg, [col.wm, PAPER, INK]);
        out += T(wx, wy, str, fs2, ws[0], ws[1], ink, left ? "start" : "end", tail);
        inkA = 0.62 * W * H; markH = 150; extra = 1;
      } else {
        const M = lerp(124, 172, sc), scl = M / Math.max(mk.w, mk.h), mw = mk.w * scl, mh = mk.h * scl;
        const fs = 8.5 + (1 - sc) * 1.5, st = wsi === 1 || wsi === 2 || wsi === 5 ? ws : WM[2], s2 = wmText(name, st[2]);
        const my = 106 - Math.max(0, mh - 130) * 0.15;
        out += grp(`translate(120 ${f(my)}) scale(${f(scl)})`, mk.s);
        out += T(120, 210, s2, fs, 600, 0.38, wmCol);
        inkA = mw * mh * (0.55 + 0.45 * mk.hv) + tw(s2, fs, 600, 0.38) * 6;
        markH = mh; extra = 1;
      }
    } else { // ------------- left-aligned sheet: mark top-left, wordmark bottom-left, descriptor bottom-right
      const M = lerp(92, 128, sc), scl = M / Math.max(mk.w, mk.h), mw = mk.w * scl, mh = mk.h * scl;
      const fs = Math.min(Math.max(ws[3] * lerp(1.0, 1.35, t2), 16), 176 / strW(1));
      const lx = 26;
      out += grp(`translate(${f(lx + mw / 2)} ${f(26 + mh / 2)}) scale(${f(scl)})`, mk.s);
      out += T(lx - 1, 204, str, fs, ws[0], ws[1], wmCol, "start", tail);
      const d2 = DESCR[Math.floor(t1 * DESCR.length)];
      out += T(W - 26, 204, d2, 6, 500, 0.4, mix(wmCol, col.bg, 0.45), "end");
      inkA = mw * mh * (0.55 + 0.45 * mk.hv) + strW(fs) * 0.73 * fs;
      markH = mh; extra = 2;
    }
  }
  const svg = svgRoot(W, H, rect(0, 0, W, H, col.bg, { rx: 12 }) + out);

  // ---- traits
  const wordHeft = (ws[0] - 300) / 500;
  const sizeShare = clamp(markH / 150, 0, 1);
  const hues = [col.a, ...(mono ? [] : [col.b])];
  if (lightness(col.bg) > 25 && lightness(col.bg) < 82) hues.push(col.bg);
  const warm = warmOf([...hues, col.bg]);
  const vivid = vividOf(hues);
  const dark = darkOf(col.bg);
  const bold = clamp(2.5 * (0.58 * mk.hv + 0.27 * wordHeft + 0.15 * sizeShare) - 1.3);
  const round = clamp(0.82 * mk.rd + 0.18 * ws[4]);
  const airy = clamp((0.54 - Math.sqrt(inkA) / W) * 3.6);
  const rich = richOf(mk.n + 1 + extra, 2, 15);
  return {
    name: `${ARCH_NAMES[E.arch]} / ${["palette", "brand", "dark"][E.scheme]} / ${["stack", "side", "hero", "badge", "sheet"][layout]}`,
    svg,
    traits: { warm, bold, round, airy, vivid, rich, dark },
  };
}
