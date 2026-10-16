// BRAND COLOUR CARDS -- a palette shown the way a studio would present it, plus the palette in use.
//
// Top ~55%: the palette in one of 8 swatch arrangements (unequal bands, overlapping circles, hero tile grid, block + chips,
// strips / arches, rainbow arcs, diagonal slices, pills), full-bleed or inset. Bottom: an "Aa" specimen, a headline and a
// button chip set in the palette (4 arrangements). 26 curated palettes + 6 harmony palettes (mono / analogous /
// complementary / triad / split / dusty) per pool.
//
// A season-level plan (a pure function of ctx.season) gives every slot its swatch layout (each of the 8 appears 4x), palette,
// ground, headline, tone treatment and legibility class (exactly 8 poor, 8 excellent, 16 middling), so a pool is always varied.
//
// Legibility: main text = the headline. contrast = WCAG(headline colour, colour directly behind it), size = fs / 200 * 6.25,
//   score = 0.7 * min(1, ln(contrast) / ln(12)) + 0.3 * size.  poor: contrast 1.5-2.9, middling 3.8-8, excellent 10.5-16.5.
//
// Traits (all in [-1, 1]):
//   warm  = warmOf(accent colours + ground)         vivid = vividOf([a, b, c])        dark = 1 - meanLightness / 50 (swatch zone + ground, area weighted)
//   bold  = 2.6 * (0.5 * impact + 0.2 * typeHeft + 0.3 * coverage) - 1.25   impact = saturated / dark colour share, coverage = ink share of the canvas
//   round = 0.75 * layoutRoundness + 0.25 * buttonRoundness   (circles, pills, arcs +  ...  flat bands, slices -)
//   airy  = clamp((emptyShare - 0.45) * 3.4)         emptyShare = canvas not covered by swatches, type or buttons
//   rich  = richOf(shapes + text runs + chips, 7, 17)
import { svgRoot, rect, el, esc } from "../svgutil.js";
import { PALETTES, HEADLINES, CTA_LABELS } from "../palettes.js";
import { mix, contrast, hexToHsl, hsl, lightness } from "../color.js";
import { warmOf, vividOf, richOf, clamp } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "trust", "quality", "premium", "clarity", "purchaseIntent"];
export const TEXT = true;
export const VIEWBOX = [240, 200];

const W = 240, H = 200;
const FF = "Inter, system-ui, sans-serif";

/* ------------------------------------------------------------------ helpers */
const f = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const lerp = (a, b, t) => a + (b - a) * t;
const P = (...n) => n.map(f).join(" ");
const grp = (tr, inner) => `<g transform="${tr}">${inner}</g>`;
const rr = (x, y, w, h, r, fill, x2) => el("rect", { x: f(x), y: f(y), width: f(w), height: f(h), rx: f(Math.max(0, Math.min(r, w / 2, h / 2))), fill, ...x2 });
const circ = (cx, cy, r, fill, x) => el("circle", { cx: f(cx), cy: f(cy), r: f(r), fill, ...x });
const pth = (d, fill, x) => el("path", { d, fill, ...x });
const poly = (arr, fill, x) => el("polygon", { points: arr.map(([px, py]) => `${f(px)},${f(py)}`).join(" "), fill, ...x });

// Inter advance widths (1/1000 em) at weight 400 / 800 (Latin, Cyrillic, Kazakh letters); linear in between.
const WT = Object.fromEntries(
  "0631/692|1407/441|2610/638|3618/657|4646/688|5593/634|6620/662|7566/588|8619/664|9620/662|A690/770|B654/665|C730/744|D722/723|E601/610|F590/585|G746/752|H743/749|I269/286|J571/590|K672/738|L565/565|M903/943|N753/766|O765/773|P639/652|Q765/782|R644/662|S642/660|T646/677|U744/727|V690/770|W985/1059|X682/761|Y679/752|Z629/679|a562/588|b612/638|c571/595|d612/638|e583/601|f370/410|g613/639|h591/635|i242/283|j242/283|k549/593|l242/283|m876/927|n591/635|o600/619|p612/638|q612/638|r376/420|s528/573|t327/382|u591/635|v562/615|w818/863|x546/594|y562/618|z552/581| 281/219|.288/353|,288/353|:288/353|;302/360|!288/358|?511/579|-460/471|–500/500|—1000/1000|'300/354|’261/331|&644/683|+662/686|/360/400|(365/382|)365/382|%982/1029|·288/353|•563/438|→1000/1000|А690/770|Б646/647|В654/665|Г579/584|Д819/888|Е601/610|Ё601/610|Ж960/1113|З618/657|И753/766|Й753/766|К672/738|Л748/750|М903/943|Н743/749|О765/773|П743/749|Р639/652|С730/744|Т646/677|У628/721|Ф828/838|Х682/761|Ц721/786|Ч700/710|Ш958/1001|Щ972/1035|Ъ816/836|Ы883/933|Ь649/668|Э730/744|Ю1015/1054|Я644/662|а562/588|б594/616|в565/582|г436/459|д613/680|е583/601|ё583/601|ж810/886|з494/529|и591/635|й591/635|к542/600|л575/616|м770/829|н588/635|о600/619|п588/624|р612/638|с571/595|т466/528|у562/618|ф687/813|х546/594|ц597/680|ч578/611|ш822/875|щ837/908|ъ644/692|ы736/835|ь559/603|э571/597|ю843/877|я554/587|Ә746/750|ә583/601|Ғ579/584|ғ436/459|Қ706/784|қ562/638|Ң758/782|ң603/668|Ө765/773|ө600/619|Ұ679/752|ұ562/615|Ү679/752|ү562/615|Һ700/710|һ591/635|І269/286|і242/283"
    .split("|").map((s) => [s[0], s.slice(1).split("/").map(Number)]),
);
/** Width of a string in px: Inter at weight `w`, tracking `ls` em after every glyph. */
function tw(s, fs, w = 500, ls = 0) {
  const t = clamp((w - 400) / 400, -0.25, 1.25);
  let sum = 0, n = 0;
  for (const ch of s) { const e = WT[ch] ?? [600, 640]; sum += e[0] + (e[1] - e[0]) * t; n++; }
  return (sum / 1000 + ls * n) * fs;
}
function T(x, y, s, fs, w, ls, fill, anchor = "start", x2) {
  const dx = anchor === "middle" ? (ls * fs) / 2 : anchor === "end" ? ls * fs : 0;
  return el("text", { x: f(x + dx), y: f(y), "font-family": FF, "font-size": f(fs), "font-weight": w, "letter-spacing": ls ? f(ls * fs) : null, fill, "text-anchor": anchor === "start" ? null : anchor, ...x2 }, esc(s));
}
/** Best way to set a headline in a box maxW x maxH: one line, or two when that gives clearly bigger type. */
function setLines(str, maxW, maxH, fsMax, w, ls, maxLines = 2, lh = 1.16) {
  const words = str.split(" ");
  const one = { lines: [str], fs: Math.min(fsMax, maxW / tw(str, 1, w, ls), maxH / lh) };
  let best = one;
  if (maxLines > 1 && words.length > 1) {
    for (let s = 1; s < words.length; s++) {
      const l1 = words.slice(0, s).join(" "), l2 = words.slice(s).join(" ");
      const fs = Math.min(fsMax, maxW / Math.max(tw(l1, 1, w, ls), tw(l2, 1, w, ls)), maxH / (2 * lh));
      if (fs > one.fs * 1.18 && (best === one || fs > best.fs)) best = { lines: [l1, l2], fs };
    }
  }
  return best;
}
const bestOn = (bg, cands) => cands.reduce((m, c) => (contrast(c, bg) > contrast(m, bg) ? c : m));
function away(c, bg, min) {
  if (contrast(c, bg) >= min) return c;
  const toward = lightness(bg) > 55 ? "#000000" : "#ffffff";
  for (let t = 0.08; t <= 1.001; t += 0.08) { const m = mix(c, toward, t); if (contrast(m, bg) >= min) return m; }
  return toward;
}
/** A text colour with exactly `target` contrast on bg, on the line bg -> base -> black / white (keeps the base hue). */
function inkAt(bg, base, target) {
  const ext = lightness(bg) > 55 ? "#000000" : "#ffffff";
  const c = (u) => (u <= 1 ? mix(bg, base, u) : mix(base, ext, u - 1));
  if (contrast(c(2), bg) < target) return c(2);
  let lo = 0, hi = 2;
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (contrast(c(m), bg) < target) lo = m; else hi = m; }
  return c(hi);
}
function tone(c, amount) {
  const [h, s, l] = hexToHsl(c);
  return amount >= 0 ? hsl(h, s * (1 - amount), l) : hsl(h, Math.min(1, s + -amount * 0.25), l);
}
const satOf = (c) => hexToHsl(c)[1];

/* ------------------------------------------------------------------ palettes */
function harmony(type, h, dark) {
  const sets = [
    [hsl(h, 0.58, 0.42), hsl(h, 0.5, 0.72), hsl(h, 0.55, 0.24)],                        // monochrome
    [hsl(h, 0.66, 0.46), hsl(h + 34, 0.74, 0.58), hsl(h - 30, 0.6, 0.32)],              // analogous
    [hsl(h, 0.62, 0.44), hsl(h + 180, 0.7, 0.56), hsl(h, 0.5, 0.26)],                   // complementary
    [hsl(h, 0.62, 0.48), hsl(h + 120, 0.55, 0.5), hsl(h + 240, 0.55, 0.45)],            // triad
    [hsl(h, 0.64, 0.46), hsl(h + 150, 0.6, 0.54), hsl(h + 210, 0.55, 0.42)],            // split complementary
    [hsl(h, 0.3, 0.45), hsl(h + 24, 0.34, 0.66), hsl(h - 20, 0.28, 0.3)],               // dusty analogous
  ][type % 6];
  const [a, b, c] = sets;
  return dark
    ? { id: "h" + type, a, b, c, bg: hsl(h, 0.3, 0.075), surface: hsl(h, 0.28, 0.115), ink: hsl(h, 0.2, 0.94) }
    : { id: "h" + type, a, b, c, bg: hsl(h, 0.32, 0.955), surface: hsl(h, 0.3, 0.99), ink: hsl(h + 10, 0.4, 0.11) };
}

/* ------------------------------------------------------------------ season plan */
function entry(season, i) {
  const r = mulberry32(hashStringToSeed(`palette|plan|${season}`));
  const layOrder = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7]);
  const vOff = Array.from({ length: 8 }, () => Math.floor(r() * 4));
  const cur = shuffle(r, PALETTES.map((_, j) => j)).slice(0, 26);
  const srcs = shuffle(r, [...cur, 100, 101, 102, 103, 104, 105]);
  const grounds = shuffle(r, [...Array(8).fill(2), ...Array(12).fill(0), ...Array(12).fill(1)]);
  const cats = shuffle(r, [...Array(8).fill(0), ...Array(8).fill(2), ...Array(16).fill(1)]);
  const tones = shuffle(r, [...Array(5).fill(1), ...Array(2).fill(2), ...Array(25).fill(0)]);
  const heads = shuffle(r, HEADLINES.map((_, j) => j)), ctas = shuffle(r, CTA_LABELS.map((_, j) => j));
  const hues = shuffle(r, [0, 1, 2, 3, 4, 5].map((j) => (j * 60 + r() * 40 + 12) % 360));
  const us = shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.5 + (r() - 0.5) * 0.8) / 32));
  const pos = i % 8, k = Math.floor(i / 8), layout = layOrder[pos];
  return {
    layout, v: (vOff[layout] + k) % 4, src: srcs[i], ground: grounds[i], cat: cats[i], tone: tones[i], u: us[i],
    bottom: (pos + k) % 4, frame: (k + (layout % 2)) % 2, head: heads[i % heads.length], cta: ctas[i % ctas.length], hue: hues[i % 6], pos, k,
  };
}

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const idx = ((ctx.index % 32) + 32) % 32;
  const E = entry(String(ctx.season ?? ""), idx);
  const t1 = rand(), t2 = rand(), t3 = rand(), t4 = rand(), t5 = rand();
  const id = ctx.id;

  // ---- the palette
  const hs = E.src >= 100 ? harmony(E.src - 100, E.hue + t1 * 30, t2 < 0.28) : null;
  const base = hs ?? { ...PALETTES[E.src], c: mix(PALETTES[E.src].a, PALETTES[E.src].ink, 0.35) };
  const darkNat = lightness(base.bg) < 30;
  let a = base.a, b = base.b, c = base.c;
  if (E.tone === 1) { a = tone(a, 0.88); b = tone(b, 0.88); c = tone(c, 0.88); }
  else if (E.tone === 2) { a = tone(a, -0.6); b = tone(b, -0.6); c = tone(c, -0.6); }
  // neutrals: light (L) and dark (D) ends of the palette
  const L1 = darkNat ? base.ink : base.surface, L2 = darkNat ? mix(base.ink, base.bg, 0.78) : base.bg;
  const D1 = darkNat ? base.bg : base.ink, D2 = darkNat ? base.surface : mix(base.ink, base.bg, 0.55);
  // ground (the card colour): palette ground / surface / inverse dark
  const gnd = darkNat ? 2 : E.ground;
  const G = gnd === 0 ? (darkNat ? base.bg : base.bg) : gnd === 1 ? (darkNat ? base.surface : base.surface) : darkNat ? base.bg : mix(base.ink, "#000000", 0.25);
  const dark = lightness(G) < 40;
  const textBase = dark ? L1 : D1;

  // ---- legibility target -> headline colour
  const u = E.u;
  const target = E.cat === 0 ? 1.55 + 1.35 * u : E.cat === 1 ? 3.9 + 4.1 * u : 10.6 + 5.8 * u;

  const R = E.frame === 0 ? [0, 0, W, 112] : [12, 12, 216, 98];
  const bleed = E.frame === 0;
  const zt = bleed ? 112 : 122;                      // top of the lower zone
  const useSlab = E.bottom === 2;
  const slabFill = useSlab ? (contrast(a, G) > 1.6 && (hexToHsl(a)[1] > 0.3 || lightness(a) < 30) ? (lightness(a) < 62 ? a : D1) : D1) : null;
  const behind = useSlab ? slabFill : G;
  const headCol = inkAt(behind, useSlab ? (lightness(behind) < 55 ? L1 : D1) : textBase, target);
  const aaCol = away(lightness(behind) < 55 ? (contrast(a, behind) > 2.2 ? a : b) : a, behind, 2.6);

  // ---- swatch list used by the layouts
  const deep = mix(a, D1, 0.42), tint = mix(b, G, 0.55);
  const lightSw = dark ? L1 : L2 === G ? L1 : L2;   // a light neutral that differs from the ground
  const darkSw = dark ? D1 : D1;
  const SW = { a, b, c, deep, tint, light: lightSw, dark: darkSw };
  const lay = LAYOUTS[E.layout];
  const o = { v: E.v, t1, t2, t3, t4, id, G, dark, frame: E.frame, bleed, soft: t4 < 0.5 };
  const rz = lay(R, SW, o);

  // ---- clip for the swatch zone
  const cid = `${id}-z`;
  const clip = bleed
    ? `<clipPath id="${cid}"><path d="M0 12A12 12 0 0 1 12 0H228A12 12 0 0 1 240 12V${R[3]}H0Z"/></clipPath>`
    : `<clipPath id="${cid}">${rect(R[0], R[1], R[2], R[3], "#000", { rx: 8 })}</clipPath>`;
  let out = `<defs>${clip}</defs><g clip-path="url(#${cid})">${rz.svg}</g>`;
  if (!bleed && rz.panel) out = `${rr(R[0], R[1], R[2], R[3], 8, rz.panel)}${out}`;

  // ---- lower zone: Aa + headline + button
  const head = HEADLINES[E.head], cta = CTA_LABELS[E.cta];
  const hw = [700, 800, 600, 800][(E.pos + E.k) % 4];
  const bt = lowerZone(E.bottom, { zt, G, a, b, c, deep, tint, L1, D1, dark, behind, slabFill, headCol, aaCol, head, cta, hw, bleed, t1, t2, t3, t4, t5, u });
  out += bt.svg;

  const frameLine = dark ? { stroke: mix(G, "#ffffff", 0.14), "stroke-width": 1 } : {};
  const svg = svgRoot(W, H, rect(0, 0, W, H, G, { rx: 12, ...frameLine }) + out);

  // ---- legibility
  const cr = Math.round(contrast(headCol, behind) * 10) / 10;
  const size = clamp((bt.fs / H) * 6.25, 0.1, 1);
  const score = 0.7 * Math.min(1, Math.log(cr) / Math.log(12)) + 0.3 * size;

  // ---- traits
  const chroma = [a, b, c];
  const warm = warmOf([...chroma, ...(rz.hues ?? []), G]);
  const vivid = vividOf(chroma);
  const swL = (rz.meanL ?? lightness(G));
  const zoneShare = (R[2] * R[3]) / (W * H);
  const meanL = swL * zoneShare + lightness(behind) * (1 - zoneShare);
  const darkT = clamp(1 - meanL / 50);
  const impact = rz.impact ?? 0.5;
  const typeHeft = ((hw - 500) / 300) * 0.6 + (bt.aaHeft ?? 0.5) * 0.4;
  const coverage = clamp(rz.cover * zoneShare + bt.cover * (1 - zoneShare), 0, 1);
  const bold = clamp(2.6 * (0.5 * impact + 0.2 * typeHeft + 0.3 * coverage) - 1.25);
  const round = clamp(0.75 * rz.rd + 0.25 * bt.rd);
  const emptyShare = 1 - coverage;
  const airy = clamp((emptyShare - 0.45) * 3.4);
  const rich = richOf(rz.n + bt.n, 7, 17);
  return {
    name: `${LAYOUT_NAMES[E.layout]} / ${["bg", "surface", "dark"][gnd]} / ${["aa-left", "head-top", "slab", "inline"][E.bottom]} / ${["poor", "mid", "excellent"][E.cat]}`,
    svg,
    traits: { warm, bold, round, airy, vivid, rich, dark: darkT },
    legibility: { score: Math.round(score * 100) / 100, contrast: cr, size: Math.round(size * 100) / 100 },
  };
}

/* ------------------------------------------------------------------ swatch layouts
   Each draws into R = [x, y, w, h] and returns { svg, n, rd, cover (share of R inked), meanL, impact, hues?, panel? }. */
const LAYOUT_NAMES = ["Bands", "Circles", "Hero tiles", "Block + chips", "Strips", "Rainbow", "Slices", "Pills"];
const strength = (c) => clamp(satOf(c) * 0.75 + (1 - lightness(c) / 100) * 0.55);
function stats(list) { // list = [[colour, areaShare], ...]
  const tot = list.reduce((s, [, w]) => s + w, 0) || 1;
  return {
    meanL: list.reduce((s, [c, w]) => s + lightness(c) * w, 0) / tot,
    impact: list.reduce((s, [c, w]) => s + strength(c) * w, 0) / tot,
    hues: list.map(([c]) => c),
  };
}
const outline = (c, G) => (contrast(c, G) < 1.35 ? { stroke: mix(G, lightness(G) < 50 ? "#ffffff" : "#000000", 0.16), "stroke-width": 0.8 } : {});
/** tiny hex caption on a swatch */
const cap = (c, x, y, anchor = "start") => T(x, y, c.toUpperCase(), 5.2, 600, 0.04, bestOn(c, ["#ffffff", "#111111"]), anchor, { opacity: 0.82 });

function bands(R, S, o) {
  const [x0, y0, w, h] = R;
  const vertical = o.v % 2 === 1;
  const tpl = [[0.38, 0.24, 0.17, 0.12, 0.09], [0.3, 0.3, 0.2, 0.12, 0.08], [0.46, 0.2, 0.14, 0.11, 0.09], [0.28, 0.22, 0.2, 0.17, 0.13]][o.v];
  const order = o.t1 < 0.5 ? [S.a, S.dark, S.b, S.tint, S.light] : [S.a, S.b, S.deep, S.light, S.dark];
  const rev = o.t2 < 0.5;
  const ws = rev ? tpl.slice().reverse() : tpl;
  const cols = rev ? order.slice().reverse() : order;
  let s = "", pos = 0;
  const len = vertical ? w : h;
  cols.forEach((c, i) => {
    const l = ws[i] * len;
    s += vertical ? rect(x0 + pos, y0, l + 0.6, h, c) : rect(x0, y0 + pos, w, l + 0.6, c);
    if (o.t3 < 0.6 && l > 17) s += vertical ? cap(c, x0 + pos + 6, y0 + h - 8) : cap(c, x0 + 10, y0 + pos + l / 2 + 2);
    pos += l;
  });
  const st = stats(cols.map((c, i) => [c, ws[i]]));
  return { svg: s, n: 5 + (o.t3 < 0.6 ? 3 : 0), rd: -0.9, cover: 1, ...st, panel: null };
}

function circles(R, S, o) {
  const [x0, y0, w, h] = R, cy = y0 + h / 2;
  let s = "", list = [];
  const cols = [S.a, S.b, S.dark, S.deep, S.tint];
  const o2 = outline;
  if (o.v % 2 === 0) { // overlapping row
    const n = 4, r = Math.min(h * 0.37, 36), pad = 14 + r, d = (w - 2 * pad) / (n - 1);
    for (let i = 0; i < n; i++) { const c = cols[i]; s += circ(x0 + pad + i * d, cy + (i % 2 ? 9 : -9) * (o.t1 < 0.5 ? 1 : -1), r - i * 1.5, c, o2(c, o.G)); list.push([c, 0.2]); }
  } else { // three-circle cluster + a satellite dot
    const r = Math.min(h * 0.32, 32), cx = x0 + w * (o.t1 < 0.5 ? 0.4 : 0.55);
    const pts = [[cx - r * 0.72, cy + r * 0.42], [cx + r * 0.72, cy + r * 0.42], [cx, cy - r * 0.62]];
    pts.forEach(([px, py], i) => { s += circ(px, py, r, cols[i], o2(cols[i], o.G)); list.push([cols[i], 0.25]); });
    s += circ(cx + r * 2.15, cy - r * 0.75, r * 0.42, cols[3]); list.push([cols[3], 0.05]);
    s += circ(cx + r * 2.3, cy + r * 0.7, r * 0.22, cols[4], o2(cols[4], o.G));
  }
  const st = stats(list);
  const panel = o.bleed ? null : (o.dark ? mix(o.G, "#ffffff", 0.05) : mix(o.G, "#000000", 0.035));
  return { svg: (o.bleed ? rect(x0, y0, w, h, panel ?? mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) : "") + s, n: 5, rd: 1, cover: 0.46, ...st, panel };
}

function tiles(R, S, o) {
  const [x0, y0, w, h] = R;
  const g = lerp(3, 9, o.t1), rt = o.soft ? lerp(6, 13, o.t2) : lerp(0, 3, o.t2);
  const cols = [S.a, S.b, S.dark, S.light];
  let s = "", list = [];
  const m = o.bleed ? 12 : 0, X = x0 + m, Y = y0 + m, Wd = w - 2 * m, Hh = h - 2 * m;
  const T0 = (x, y, ww, hh, c, lab) => { s += rr(x, y, ww, hh, rt, c, outline(c, o.G)); if (lab && ww > 30 && hh > 14) s += cap(c, x + 7, y + hh - 7); list.push([c, (ww * hh) / (Wd * Hh)]); };
  if (o.v % 2 === 0) { // hero left, three stacked
    const hw = Wd * 0.58, cw = Wd - hw - g, ch = (Hh - 2 * g) / 3;
    T0(X, Y, hw, Hh, cols[0], true);
    for (let i = 0; i < 3; i++) T0(X + hw + g, Y + i * (ch + g), cw, ch, [cols[1], cols[2], cols[3]][i], i < 2);
  } else { // hero top, three below
    const hh = Hh * 0.6, cw = (Wd - 2 * g) / 3, ch = Hh - hh - g;
    T0(X, Y, Wd, hh, cols[0], true);
    for (let i = 0; i < 3; i++) T0(X + i * (cw + g), Y + hh + g, cw, ch, [cols[1], cols[2], cols[3]][i], i < 2);
  }
  const st = stats(list);
  const panel = o.bleed ? null : undefined;
  return { svg: (o.bleed ? rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) : "") + s, n: 8, rd: clamp(rt / 13 * 1.6 - 0.8, -1, 1), cover: 1 - (g * 4) / 60, ...st, panel };
}

function chips(R, S, o) {
  const [x0, y0, w, h] = R;
  const g = lerp(5, 10, o.t1), rt = o.soft ? lerp(8, 16, o.t2) : 2;
  const m = o.bleed ? 12 : 0, X = x0 + m, Y = y0 + m, Wd = w - 2 * m, Hh = h - 2 * m;
  let s = "", list = [];
  const round = o.v % 2 === 1;
  if (o.v < 2) { // block left, 2x2 chips right
    const bw = Wd * 0.6, d = Math.min((Hh - g) / 2, (Wd - bw - 2 * g) / 2);
    s += rr(X, Y, bw, Hh, rt, S.a, outline(S.a, o.G)); list.push([S.a, bw * Hh / (Wd * Hh)]);
    const cx0 = X + bw + g + (Wd - bw - g - (2 * d + g)) / 2, cy0 = Y + (Hh - (2 * d + g)) / 2;
    [S.b, S.dark, S.light, S.tint].forEach((c, i) => { const cx = cx0 + (i % 2) * (d + g), cy = cy0 + Math.floor(i / 2) * (d + g); s += round ? circ(cx + d / 2, cy + d / 2, d / 2, c, outline(c, o.G)) : rr(cx, cy, d, d, rt * 0.6, c, outline(c, o.G)); list.push([c, 0.06]); });
  } else { // block top, row of 4 chips under
    const bh = Hh * 0.62, d = Math.min(Hh - bh - g, (Wd - 3 * g) / 4);
    s += rr(X, Y, Wd, bh, rt, S.a, outline(S.a, o.G)); list.push([S.a, 0.6]);
    const sx = X + (Wd - (4 * d + 3 * g)) / 2;
    [S.b, S.deep, S.dark, S.light].forEach((c, i) => { const cx = sx + i * (d + g); s += round ? circ(cx + d / 2, Y + bh + g + d / 2, d / 2, c, outline(c, o.G)) : rr(cx, Y + bh + g, d, d, rt * 0.6, c, outline(c, o.G)); list.push([c, 0.05]); });
  }
  const st = stats(list);
  return { svg: (o.bleed ? rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) : "") + s, n: 6, rd: round ? 0.5 : clamp(rt / 16 * 1.4 - 0.8, -1, 1), cover: 0.72, ...st, panel: null };
}

function strips(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = 5, g = o.bleed ? 0 : 5, sw = (w - (n - 1) * g) / n;
  const hts = [[0.7, 0.92, 0.6, 1, 0.8], [1, 0.78, 0.9, 0.62, 0.72], [0.55, 0.75, 1, 0.85, 0.65], [0.85, 0.6, 0.78, 1, 0.7]][o.v];
  const cols = o.t1 < 0.5 ? [S.a, S.b, S.dark, S.deep, S.tint] : [S.deep, S.a, S.tint, S.b, S.dark];
  let s = "", list = [];
  const soft = o.soft;
  cols.forEach((c, i) => {
    const hh = hts[i] * h, x = x0 + i * (sw + g), y = y0 + h - hh;
    if (soft) s += pth(`M${P(x, y0 + h)}V${P(y + sw / 2)}A${P(sw / 2, sw / 2)} 0 0 1 ${P(x + sw, y + sw / 2)}V${P(y0 + h)}Z`, c, outline(c, o.G));
    else s += rect(x, y, sw, hh + 0.5, c, outline(c, o.G));
    if (o.t3 < 0.55 && hh > 40) s += cap(c, x + sw / 2, y0 + h - 7, "middle");
    list.push([c, (sw * hh) / (w * h)]);
  });
  const st = stats(list);
  const bgz = rect(x0, y0, w, h, o.bleed ? mix(o.G, o.dark ? "#ffffff" : "#000000", 0.045) : "none");
  return { svg: bgz + s, n: 5 + (o.t3 < 0.55 ? 3 : 0), rd: soft ? 0.55 : -0.8, cover: hts.reduce((q, v) => q + v, 0) / 5, ...st, panel: null };
}

function rainbow(R, S, o) {
  const [x0, y0, w, h] = R;
  const cols = o.t1 < 0.5 ? [S.a, S.tint, S.b, S.dark, S.deep] : [S.deep, S.a, S.b, S.light, S.dark];
  let s = "", list = [];
  const n = 5;
  if (o.v % 3 === 0) { // semicircle rainbow, resting on the bottom edge
    const cx = x0 + w / 2, cy = y0 + h + (o.bleed ? 0 : 0), R0 = Math.min(h * 0.98, w / 2 - 8), t = R0 / (n + 0.55);
    for (let i = 0; i < n; i++) { const r = R0 - i * t; s += pth(`M${P(cx - r, cy)}A${P(r, r)} 0 0 1 ${P(cx + r, cy)}Z`, cols[i], outline(cols[i], o.G)); list.push([cols[i], 0.12]); }
  } else { // quarter circles from a corner
    const left = o.v % 3 === 1, cx = left ? x0 : x0 + w, cy = y0 + h, R0 = Math.min(w * 0.82, h * 1.5), t = R0 / (n + 0.4);
    for (let i = 0; i < n; i++) { const r = R0 - i * t; s += pth(`M${P(cx, cy)}L${P(cx + (left ? r : -r), cy)}A${P(r, r)} 0 0 ${left ? 0 : 1} ${P(cx, cy - r)}Z`, cols[i], outline(cols[i], o.G)); list.push([cols[i], 0.12]); }
  }
  const st = stats(list);
  const bgz = o.bleed ? rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.045)) : "";
  return { svg: bgz + s, n: 5, rd: 0.8, cover: 0.5, ...st, panel: null };
}

function slices(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = 5, sk = lerp(26, 46, o.t1);
  const ws = [[0.3, 0.22, 0.18, 0.17, 0.13], [0.2, 0.2, 0.2, 0.2, 0.2], [0.36, 0.14, 0.24, 0.1, 0.16], [0.14, 0.26, 0.22, 0.12, 0.26]][o.v];
  const cols = o.t2 < 0.5 ? [S.a, S.dark, S.b, S.tint, S.deep] : [S.deep, S.b, S.a, S.light, S.dark];
  let s = "", list = [], acc = x0 - sk * 0.1;
  const total = w + sk;
  cols.forEach((c, i) => {
    const wi = ws[i] * total, xa = acc, xb = acc + wi + 0.5;
    s += poly([[xa + sk, y0], [xb + sk, y0], [xb, y0 + h], [xa, y0 + h]], c, outline(c, o.G));
    acc += wi; list.push([c, ws[i]]);
  });
  const st = stats(list);
  return { svg: rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) + s, n: 5, rd: -0.55, cover: 0.96, ...st, panel: null };
}

function pills(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = 5, g = lerp(4, 7, o.t1), ph = (h - 2 * 11 - (n - 1) * g) / n;
  const lens = [[1, 0.8, 0.62, 0.46, 0.3], [0.7, 1, 0.5, 0.82, 0.38], [0.45, 0.7, 1, 0.78, 0.56], [1, 0.6, 0.84, 0.4, 0.7]][o.v];
  const cols = o.t2 < 0.5 ? [S.a, S.b, S.dark, S.deep, S.tint] : [S.deep, S.a, S.tint, S.b, S.dark];
  const align = o.t3 < 0.34 ? "l" : o.t3 < 0.67 ? "c" : "r";
  const wmax = w - 2 * 12;
  let s = "", list = [];
  cols.forEach((c, i) => {
    const pw = Math.max(ph * 2.2, lens[i] * wmax), x = align === "l" ? x0 + 12 : align === "c" ? x0 + (w - pw) / 2 : x0 + w - 12 - pw, y = y0 + 11 + i * (ph + g);
    s += rr(x, y, pw, ph, o.soft ? ph / 2 : 3, c, outline(c, o.G));
    if (pw > 70 && ph > 11) s += cap(c, x + ph / 2 + 2, y + ph / 2 + 1.8);
    list.push([c, (pw * ph) / (w * h)]);
  });
  const st = stats(list);
  const panel = o.bleed ? null : mix(o.G, o.dark ? "#ffffff" : "#000000", 0.035);
  const cover = list.reduce((q, [, a2]) => q + a2, 0);
  return { svg: (o.bleed ? rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) : "") + s, n: 8, rd: o.soft ? 0.9 : -0.3, cover, ...st, panel };
}
const LAYOUTS = [bands, circles, tiles, chips, strips, rainbow, slices, pills];

/* ------------------------------------------------------------------ lower zone: "Aa", headline, button chip */
function chipBtn(x, y, label, fs, h, style, fill, ink, anchor = "start") {
  const ls = style === 2 ? 0.07 : 0.02, txt = style === 2 ? label.toUpperCase() : label;
  const tww = tw(txt, fs, 700, ls), w = tww + h * 1.15;
  const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  const rx = style === 1 ? h / 2 : style === 2 ? 0 : 4;
  let s = style === 3 ? rr(x0 + 0.6, y + 0.6, w - 1.2, h - 1.2, rx, "none", { stroke: fill, "stroke-width": 1.2 }) : rr(x0, y, w, h, rx, fill);
  s += T(x0 + w / 2, y + h / 2 + fs * 0.35, txt, fs, 700, ls, style === 3 ? fill : ink, "middle");
  return { svg: s, w, h, x0, rd: style === 1 ? 1 : style === 2 ? -1 : -0.2 };
}

function lowerZone(variant, q) {
  const { zt, G, a, b, deep, tint, L1, D1, dark, behind, slabFill, headCol, aaCol, head, cta, hw, bleed, t1, t2, t3, t4, t5 } = q;
  const style = [0, 1, 2, 3][Math.floor(t5 * 4)];
  const btnFill = contrast(a, behind) >= 2.2 ? a : (contrast(b, behind) >= 2.2 ? b : bestOn(behind, [L1, D1]));
  const ink = (c) => bestOn(c, ["#ffffff", "#111114"]);
  const aaW = [800, 300, 700, 800][Math.floor(t2 * 4)];
  let s = "", fs = 14, n = 5, cover = 0.18, aaHeft = (aaW - 300) / 500, rd = 0;
  const bottom = H, cyz = (zt + bottom) / 2;
  const cta2 = cta.length > 12 ? cta : cta;
  if (variant === 0) { // Aa left, headline + button right
    const aaFs = 40 + t1 * 6, aaB = cyz + aaFs * 0.3;
    s += T(16, aaB + 2, "Aa", aaFs, aaW, -0.03, aaCol);
    const x2 = 16 + tw("Aa", aaFs, aaW, -0.03) + 18, maxW = 224 - x2;
    s += rect(x2 - 9, cyz - 22, 1, 44, mix(behind, headCol, 0.2));
    const hl = setLines(head, maxW, 16, 11.5, hw, -0.01);
    const lh = hl.fs * 1.16, bh = 17, blockH = hl.lines.length * lh + 9 + bh, y1 = cyz - blockH / 2 + hl.fs * 0.78;
    hl.lines.forEach((ln, i) => { s += T(x2, y1 + i * lh, ln, hl.fs, hw, -0.01, headCol); });
    const bt = chipBtn(x2, y1 + (hl.lines.length - 1) * lh + 9 - hl.fs * 0.1, cta2, 7.4, bh, style, btnFill, ink(btnFill));
    s += bt.svg; fs = hl.fs; rd = bt.rd; cover = 0.2;
  } else if (variant === 1) { // headline on top, button left + Aa right
    const hl = setLines(head, 208, 19, 12.5, hw, -0.015);
    const lh = hl.fs * 1.14, y1 = zt + 12 + hl.fs * 0.8;
    hl.lines.forEach((ln, i) => { s += T(16, y1 + i * lh, ln, hl.fs, hw, -0.015, headCol); });
    const bh = 19, by = bottom - 15 - bh;
    const bt = chipBtn(16, by, cta2, 7.8, bh, style, btnFill, ink(btnFill));
    s += bt.svg;
    const aaFs = 30 + t1 * 8;
    s += T(224, bottom - 15 + 1, "Aa", aaFs, aaW, -0.03, aaCol, "end");
    fs = hl.fs; rd = bt.rd; n = 5; cover = 0.2;
  } else if (variant === 2) { // dark slab with light type
    const sx = bleed ? 0 : 12, sw = bleed ? W : 216, sy = zt, sh = bottom - zt - (bleed ? 0 : 12);
    s += bleed ? pth(`M0 ${sy}H${W}V${bottom - 12}A12 12 0 0 1 ${W - 12} ${bottom}H12A12 12 0 0 1 0 ${bottom - 12}Z`, slabFill) : rr(sx, sy, sw, sh, 8, slabFill);
    const px = sx + 16, hl = setLines(head, 118, 16, 11.5, hw, -0.01);
    const lh = hl.fs * 1.16, aaFs = 36 + t1 * 8, midY = sy + sh / 2;
    const bh = 17, blockH = hl.lines.length * lh + 9 + bh, y1 = midY - blockH / 2 + hl.fs * 0.78;
    hl.lines.forEach((ln, i) => { s += T(px, y1 + i * lh, ln, hl.fs, hw, -0.01, headCol); });
    const bfill = contrast(b, slabFill) >= 2.4 ? b : (contrast(a, slabFill) >= 2.4 ? a : bestOn(slabFill, [L1, D1]));
    const bt = chipBtn(px, y1 + (hl.lines.length - 1) * lh + 9 - hl.fs * 0.1, cta2, 7.4, bh, style, bfill, ink(bfill));
    s += bt.svg;
    const aaC = away(contrast(b, slabFill) >= 2.4 ? b : a, slabFill, 2.6);
    s += T(sx + sw - 16, midY + aaFs * 0.3, "Aa", aaFs, aaW, -0.03, aaC, "end");
    fs = hl.fs; rd = bt.rd; n = 5; cover = 1; aaHeft = (aaW - 300) / 500 + 0.15;
  } else { // inline: Aa | headline, full-width button below
    const aaFs = 26, y1 = zt + 16 + aaFs * 0.73;
    s += T(16, y1, "Aa", aaFs, aaW, -0.03, aaCol);
    const x2 = 16 + tw("Aa", aaFs, aaW, -0.03) + 20, hl = setLines(head, 224 - x2, 15, 11, hw, -0.01, 1);
    s += rect(x2 - 10, y1 - 20, 1, 24, mix(behind, headCol, 0.25));
    s += T(x2, y1 - 0.25 * aaFs + hl.fs * 0.35 - 1, hl.lines[0], hl.fs, hw, -0.01, headCol);
    const bh = 20, by = bottom - 15 - bh;
    const bw = 208;
    const rx = style === 1 ? bh / 2 : style === 2 ? 0 : 4;
    const txt = style === 2 ? cta2.toUpperCase() : cta2;
    s += style === 3 ? rr(16.6, by + 0.6, bw - 1.2, bh - 1.2, rx, "none", { stroke: btnFill, "stroke-width": 1.2 }) : rr(16, by, bw, bh, rx, btnFill);
    s += T(120, by + bh / 2 + 3, txt, 8, 700, style === 2 ? 0.07 : 0.02, style === 3 ? btnFill : ink(btnFill), "middle");
    fs = hl.fs; rd = style === 1 ? 1 : style === 2 ? -1 : -0.2; n = 5; cover = 0.26;
  }
  return { svg: s, fs, n, cover, aaHeft, rd };
}
