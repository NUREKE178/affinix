// BRAND COLOUR CARDS -- a palette shown the way a studio would present it, plus the palette in use.
//
// Top ~55%: the palette in one of 8 swatch arrangements (unequal bands, overlapping circles, hero tile grid, block + chips,
// strips / arches, rainbow arcs, diagonal slices, pills), 3-8 colours, full-bleed or inset. Bottom: an "Aa" specimen, a
// headline and a button chip set in the palette (4 arrangements). 26 curated palettes + 6 harmony palettes (mono /
// analogous / complementary / triad / split / dusty) per pool.
//
// A season-level plan (a pure function of ctx.season) gives every slot its swatch layout (each of the 8 appears 4x), palette,
// ground, headline, tone treatment and legibility class (exactly 8 poor, 8 excellent, 16 middling), so a pool is always varied.
//
// Legibility: main text = the headline. contrast = WCAG(headline colour, colour directly behind it), size = fs / 200 * 6.25,
//   score = 0.7 * min(1, ln(contrast) / ln(12)) + 0.3 * size.  poor: contrast 1.5-2.9, middling 3.9-8, excellent 10.6-16.4.
//
// Traits (all in [-1, 1]):
//   warm  = warmOf(accent colours + ground)         vivid = vividOf([a, b, c])        dark = 1 - meanLightness / 50 (swatch zone + ground, area weighted)
//   bold  = 4.2 * (0.34 * impact + 0.22 * thick + 0.22 * typeHeft + 0.22 * coverage) - 2.4
//           impact = saturated / dark share of the colours, thick = thickness of the swatch shapes, coverage = inked share of the canvas
//   round = 0.75 * layoutRoundness + 0.25 * buttonRoundness   (circles, pills, arcs +  ...  flat bands, slices -)
//   airy  = clamp((emptyShare - 0.45) * 3.4)         emptyShare = canvas not covered by swatches, type or buttons
//   rich  = richOf(swatches + captions + type runs + chips, 7, 17)
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
/** A text colour with `target` contrast on bg, on the line bg -> base -> black / white (keeps the base hue). */
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
  const [a, b, c] = [
    [hsl(h, 0.58, 0.42), hsl(h, 0.5, 0.72), hsl(h, 0.55, 0.24)],                        // monochrome
    [hsl(h, 0.66, 0.46), hsl(h + 34, 0.74, 0.58), hsl(h - 30, 0.6, 0.32)],              // analogous
    [hsl(h, 0.62, 0.44), hsl(h + 180, 0.7, 0.56), hsl(h, 0.5, 0.26)],                   // complementary
    [hsl(h, 0.62, 0.48), hsl(h + 120, 0.55, 0.5), hsl(h + 240, 0.55, 0.45)],            // triad
    [hsl(h, 0.64, 0.46), hsl(h + 150, 0.6, 0.54), hsl(h + 210, 0.55, 0.42)],            // split complementary
    [hsl(h, 0.3, 0.45), hsl(h + 24, 0.34, 0.66), hsl(h - 20, 0.28, 0.3)],               // dusty analogous
  ][type % 6];
  return dark
    ? { id: "harm" + type + "d", a, b, c, bg: hsl(h, 0.3, 0.075), surface: hsl(h, 0.28, 0.115), ink: hsl(h, 0.2, 0.94) }
    : { id: "harm" + type, a, b, c, bg: hsl(h, 0.32, 0.955), surface: hsl(h, 0.3, 0.99), ink: hsl(h + 10, 0.4, 0.11) };
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
  const counts = shuffle(r, [3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 8, 5, 6]);
  const heads = shuffle(r, HEADLINES.map((_, j) => j)), ctas = shuffle(r, CTA_LABELS.map((_, j) => j));
  const hues = shuffle(r, [0, 1, 2, 3, 4, 5].map((j) => (j * 60 + r() * 40 + 12) % 360));
  const strat = () => shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.5 + (r() - 0.5) * 0.8) / 32));
  const us = strat(), szs = strat();
  const hws = shuffle(r, [...Array(7).fill(400), ...Array(7).fill(500), ...Array(6).fill(600), ...Array(6).fill(700), ...Array(6).fill(800)]);
  const pos = i % 8, k = Math.floor(i / 8), layout = layOrder[pos];
  return {
    layout, v: (vOff[layout] + k) % 4, src: srcs[i], ground: grounds[i], cat: cats[i], tone: tones[i], u: us[i], sz: szs[i], n: counts[i], hw: hws[i],
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
  const D1 = darkNat ? base.bg : base.ink;
  // ground (the card colour): palette ground / surface / inverse dark
  const gnd = darkNat ? 2 : E.ground;
  let dg = base.ink; for (let q = 0; q < 9 && lightness(dg) > 13; q++) dg = mix(dg, "#000000", 0.18); // a dark ground tinted by the palette's ink
  const G = gnd === 0 ? base.bg : gnd === 1 ? base.surface : darkNat ? base.bg : dg;
  const dark = lightness(G) < 40;
  const textBase = dark ? L1 : D1;

  // ---- frame, zones, headline colour (the legibility target)
  const bleed = E.frame === 0;
  const R = bleed ? [0, 0, W, 112] : [12, 12, 216, 96];
  const zt = bleed ? 112 : 120;
  const useSlab = E.bottom === 2;
  const target = E.cat === 0 ? 1.55 + 1.35 * E.u : E.cat === 1 ? 3.9 + 4.1 * E.u : 10.6 + 5.8 * E.u;
  const reach = (c) => Math.max(contrast(c, "#000000"), contrast(c, "#ffffff"));
  const slabFill = useSlab ? (contrast(a, G) > 1.6 && (satOf(a) > 0.3 || lightness(a) < 30) && lightness(a) < 62 && reach(a) > target * 1.08 ? a : (reach(D1) > target * 1.08 && lightness(D1) < 40 ? D1 : mix(D1, "#000000", 0.75))) : null;
  const behind = useSlab ? slabFill : G;
  const headCol = inkAt(behind, useSlab ? (lightness(behind) < 55 ? L1 : D1) : textBase, target);
  const aaCol = away(lightness(behind) < 55 ? (contrast(a, behind) > 2.2 ? a : b) : a, behind, 2.6);

  // ---- the swatch ramp (a is always the dominant colour)
  const deep = mix(a, D1, 0.42), tint = mix(b, G, 0.55), lightSw = L2 === G ? L1 : L2;
  const ramp = [a, D1, b, tint, deep, lightSw, mix(a, lightSw, 0.55), mix(b, D1, 0.4)];
  const o = { v: E.v, t1, t2, t3, t4, id, G, dark, bleed, soft: t4 < 0.5, n: E.n };
  const rz = LAYOUTS[E.layout](R, ramp, o);

  const cid = `${id}-z`;
  const clip = bleed
    ? `<clipPath id="${cid}"><path d="M0 12A12 12 0 0 1 12 0H228A12 12 0 0 1 240 12V${R[3]}H0Z"/></clipPath>`
    : `<clipPath id="${cid}">${rect(R[0], R[1], R[2], R[3], "#000", { rx: 8 })}</clipPath>`;
  let out = `<defs>${clip}</defs><g clip-path="url(#${cid})">${rz.svg}</g>`;

  // ---- lower zone: Aa + headline + button
  const caps = t4 > 0.8;
  const head0 = HEADLINES[E.head], head = caps ? head0.toUpperCase() : head0, cta = CTA_LABELS[E.cta];
  const hw = E.hw;
  const bt = lowerZone(E.bottom, { zt, G, a, b, L1, D1, behind, slabFill, headCol, aaCol, head, cta, hw, hls: caps ? 0.05 : -0.012, fsMax: lerp(12.5, 19.5, E.sz), bleed, t1, t2, t5 });
  out += bt.svg;

  const frameLine = dark ? { stroke: mix(G, "#ffffff", 0.14), "stroke-width": 1 } : {};
  const svg = svgRoot(W, H, rect(0, 0, W, H, G, { rx: 12, ...frameLine }) + out);

  // ---- legibility
  const cr = Math.round(contrast(headCol, behind) * 10) / 10;
  const size = clamp((bt.fs / H) * 6.25, 0.1, 1);
  const score = 0.7 * Math.min(1, Math.log(cr) / Math.log(12)) + 0.3 * size;

  // ---- traits
  const chroma = [a, b, c];
  const warm = warmOf([...chroma, ...rz.hues, G]);
  const vivid = vividOf(chroma);
  const zoneShare = (R[2] * R[3]) / (W * H);
  const meanL = rz.meanL * zoneShare + lightness(behind) * (1 - zoneShare);
  const dk = clamp(1 - meanL / 50);
  const typeHeft = clamp(((hw - 400) / 400) * 0.65 + bt.aaHeft * 0.35, 0, 1);
  const coverage = clamp(rz.cover * zoneShare + bt.cover * (1 - zoneShare), 0, 1);
  const bold = clamp(4.2 * (0.34 * rz.impact + 0.22 * rz.thick + 0.22 * typeHeft + 0.22 * coverage) - 2.4);
  const round = clamp(0.75 * rz.rd + 0.25 * bt.rd);
  const airy = clamp(((1 - coverage) - 0.45) * 3.4);
  const rich = richOf(rz.n + rz.caps + bt.n, 7, 17);
  return {
    name: `${LAYOUT_NAMES[E.layout]}${E.n} / ${hs ? hs.id : base.id} / ${["bg", "surface", "dark"][gnd]} / ${["aa-left", "head-top", "slab", "inline"][E.bottom]} / ${["poor", "mid", "excellent"][E.cat]}`,
    svg,
    traits: { warm, bold, round, airy, vivid, rich, dark: dk },
    legibility: { score: Math.round(score * 100) / 100, contrast: cr, size: Math.round(size * 100) / 100 },
  };
}

/* ------------------------------------------------------------------ swatch layouts
   Each draws into R = [x, y, w, h] with a ramp of 8 colours and o.n colours wanted, and returns
   { svg, n (shapes), caps (captions), rd, cover (share of R inked), thick (0..1), meanL, impact, hues }. */
const LAYOUT_NAMES = ["Bands", "Circles", "Hero tiles", "Block+chips", "Strips", "Rainbow", "Slices", "Pills"];
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
const plate = (o, R) => (o.bleed ? rect(R[0], R[1], R[2], R[3], mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) : "");
/** tiny hex caption on a swatch */
const cap = (c, x, y, anchor = "start") => T(x, y, c.toUpperCase(), 5.2, 600, 0.04, bestOn(c, ["#ffffff", "#111111"]), anchor, { opacity: 0.82 });

function bands(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 7), vertical = o.v % 2 === 1, q = lerp(0.62, 0.8, o.t1);
  let ws = Array.from({ length: n }, (_, i) => q ** i); const tot = ws.reduce((s, v) => s + v, 0); ws = ws.map((v) => v / tot);
  const cols = S.slice(0, n);
  const rev = o.t2 < 0.5;
  if (rev) { ws.reverse(); cols.reverse(); }
  let s = "", pos = 0, caps = 0;
  const len = vertical ? w : h;
  cols.forEach((c, i) => {
    const l = ws[i] * len;
    s += vertical ? rect(x0 + pos, y0, l + 0.6, h, c) : rect(x0, y0 + pos, w, l + 0.6, c);
    if (o.t3 < 0.6 && l > (vertical ? 30 : 16)) { s += vertical ? cap(c, x0 + pos + 6, y0 + h - 8) : cap(c, x0 + 10, y0 + pos + l / 2 + 1.8); caps++; }
    pos += l;
  });
  return { svg: s, n, caps, rd: -0.9, cover: 1, thick: clamp(1.15 - n * 0.09), ...stats(cols.map((c, i) => [c, ws[i]])) };
}

function circles(R, S, o) {
  const [x0, y0, w, h] = R, cy = y0 + h / 2;
  const n = clamp(o.n, 3, 5);
  let s = "", list = [], thick;
  const cols = [S[0], S[2], S[1], S[4], S[3]];
  if (o.v % 2 === 0) { // overlapping row
    const r = Math.min(h * (0.4 - n * 0.016), 36), pad = 14 + r, d = (w - 2 * pad) / (n - 1);
    const flip = o.t1 < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) { const c = cols[i]; s += circ(x0 + pad + i * d, cy + (i % 2 ? 9 : -9) * flip, r - i * 1.2, c, outline(c, o.G)); list.push([c, 0.2]); }
    thick = r / 36;
  } else { // three-circle cluster + satellites
    const r = Math.min(h * 0.32, 32), cx = x0 + w * (o.t1 < 0.5 ? 0.4 : 0.55);
    [[cx - r * 0.72, cy + r * 0.42], [cx + r * 0.72, cy + r * 0.42], [cx, cy - r * 0.62]].forEach(([px, py], i) => { s += circ(px, py, r, cols[i], outline(cols[i], o.G)); list.push([cols[i], 0.25]); });
    if (n > 3) { s += circ(cx + r * 2.15, cy - r * 0.75, r * 0.42, cols[3]); list.push([cols[3], 0.05]); }
    if (n > 4) { s += circ(cx + r * 2.3, cy + r * 0.7, r * 0.22, cols[4], outline(cols[4], o.G)); list.push([cols[4], 0.02]); }
    thick = r / 36;
  }
  return { svg: plate(o, R) + s, n, caps: 0, rd: 1, cover: 0.4, thick: clamp(thick), ...stats(list) };
}

function tiles(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 4, 7), g = lerp(3, 9, o.t1), rt = o.soft ? lerp(6, 13, o.t2) : lerp(0, 3, o.t2);
  const m = o.bleed ? 12 : 0, X = x0 + m, Y = y0 + m, Wd = w - 2 * m, Hh = h - 2 * m;
  const cols = [S[0], S[2], S[1], S[5], S[4], S[3], S[6]];
  let s = "", list = [], caps = 0;
  const tile = (x, y, ww, hh, c, lab) => { s += rr(x, y, ww, hh, rt, c, outline(c, o.G)); if (lab && ww > 30 && hh > 14) { s += cap(c, x + 6, y + hh - 6); caps++; } list.push([c, (ww * hh) / (Wd * Hh)]); };
  const others = n - 1;
  if (o.v % 2 === 0) { // hero left, the rest stacked in one or two columns
    const hw = Wd * (others > 3 ? 0.5 : 0.58), cw = Wd - hw - g, ncol = others > 3 ? 2 : 1, rows = Math.ceil(others / ncol);
    const ch = (Hh - (rows - 1) * g) / rows, cwi = (cw - (ncol - 1) * g) / ncol;
    tile(X, Y, hw, Hh, cols[0], true);
    for (let i = 0; i < others; i++) tile(X + hw + g + (i % ncol) * (cwi + g), Y + Math.floor(i / ncol) * (ch + g), cwi, ch, cols[1 + i], i < 2);
  } else { // hero top, the rest in a row
    const hh = Hh * 0.58, cw = (Wd - (others - 1) * g) / others, ch = Hh - hh - g;
    tile(X, Y, Wd, hh, cols[0], true);
    for (let i = 0; i < others; i++) tile(X + i * (cw + g), Y + hh + g, cw, ch, cols[1 + i], i < 2);
  }
  return { svg: plate(o, R) + s, n, caps, rd: clamp((rt / 13) * 1.6 - 0.8, -1, 1), cover: 0.9 - n * 0.02, thick: 0.75, ...stats(list) };
}

function chips(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 7), m = n - 1, g = lerp(5, 9, o.t1), rt = o.soft ? lerp(8, 16, o.t2) : 2;
  const mg = o.bleed ? 12 : 0, X = x0 + mg, Y = y0 + mg, Wd = w - 2 * mg, Hh = h - 2 * mg;
  const round = o.v % 2 === 1, cols = [S[0], S[2], S[1], S[5], S[4], S[3], S[6]];
  let s = "", list = [];
  const chip = (x, y, d, c) => { s += round ? circ(x + d / 2, y + d / 2, d / 2, c, outline(c, o.G)) : rr(x, y, d, d, d * 0.2 * (o.soft ? 1.6 : 0.4), c, outline(c, o.G)); list.push([c, (d * d) / (Wd * Hh)]); };
  let thick;
  if (o.v < 2) { // block left, a grid of chips right
    const bw = Wd * 0.58, region = Wd - bw - g, cc = m <= 2 ? 1 : 2, rows = Math.ceil(m / cc);
    const d = Math.min((Hh - (rows - 1) * g) / rows, (region - (cc - 1) * g) / cc);
    s += rr(X, Y, bw, Hh, rt, cols[0], outline(cols[0], o.G)); list.push([cols[0], bw / Wd]);
    const gw = cc * d + (cc - 1) * g, gh = rows * d + (rows - 1) * g, gx = X + bw + g + (region - gw) / 2, gy = Y + (Hh - gh) / 2;
    for (let i = 0; i < m; i++) chip(gx + (i % cc) * (d + g), gy + Math.floor(i / cc) * (d + g), d, cols[1 + i]);
    thick = clamp(0.55 + d / 80);
  } else { // block top, a row of chips under
    const bh = Hh * 0.6, d = Math.min(Hh - bh - g, (Wd - (m - 1) * g) / m);
    s += rr(X, Y, Wd, bh, rt, cols[0], outline(cols[0], o.G)); list.push([cols[0], 0.6]);
    const sx = X + (Wd - (m * d + (m - 1) * g)) / 2;
    for (let i = 0; i < m; i++) chip(sx + i * (d + g), Y + bh + g, d, cols[1 + i]);
    thick = clamp(0.5 + d / 80);
  }
  return { svg: plate(o, R) + s, n, caps: 0, rd: round ? 0.55 : clamp((rt / 16) * 1.4 - 0.8, -1, 1), cover: 0.7, thick, ...stats(list) };
}

function strips(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 8), g = o.bleed ? 0 : 4, sw = (w - (n - 1) * g) / n;
  const fr = [[0.7, 0.92, 0.6, 1, 0.8, 0.66, 0.88, 0.74], [1, 0.78, 0.9, 0.62, 0.72, 0.95, 0.58, 0.84], [0.55, 0.75, 1, 0.85, 0.65, 0.9, 0.7, 0.8], [0.85, 0.6, 0.78, 1, 0.7, 0.55, 0.92, 0.68]][o.v];
  const cols = o.t1 < 0.5 ? [S[0], S[2], S[1], S[4], S[3], S[5], S[6], S[7]] : [S[4], S[0], S[3], S[2], S[1], S[6], S[5], S[7]];
  let s = "", list = [], caps = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const c = cols[i], hh = fr[i] * h, x = x0 + i * (sw + g), y = y0 + h - hh;
    if (o.soft) s += pth(`M${P(x, y0 + h)}V${P(y + sw / 2)}A${P(sw / 2, sw / 2)} 0 0 1 ${P(x + sw, y + sw / 2)}V${P(y0 + h)}Z`, c, outline(c, o.G));
    else s += rect(x, y, sw, hh + 0.5, c, outline(c, o.G));
    if (o.t3 < 0.55 && hh > 40 && sw > 29) { s += cap(c, x + sw / 2, y0 + h - 7, "middle"); caps++; }
    list.push([c, (sw * hh) / (w * h)]); sum += fr[i];
  }
  return { svg: plate(o, R) + s, n, caps, rd: o.soft ? 0.55 : -0.8, cover: (sum / n) * 0.92, thick: clamp(sw / 38), ...stats(list) };
}

function rainbow(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 7);
  const cols = o.t1 < 0.5 ? [S[0], S[3], S[2], S[1], S[4], S[5], S[6]] : [S[4], S[0], S[2], S[5], S[1], S[3], S[6]];
  let s = "", list = [], t;
  if (o.v % 3 === 0) { // semicircle rainbow resting on the bottom edge
    const cx = x0 + w / 2, cy = y0 + h, R0 = Math.min(h * 0.98, w / 2 - 8); t = R0 / (n + 0.55);
    for (let i = 0; i < n; i++) { const r = R0 - i * t; s += pth(`M${P(cx - r, cy)}A${P(r, r)} 0 0 1 ${P(cx + r, cy)}Z`, cols[i], outline(cols[i], o.G)); list.push([cols[i], 1 / n]); }
  } else { // quarter circles from a corner
    const left = o.v % 3 === 1, cx = left ? x0 : x0 + w, cy = y0 + h, R0 = Math.min(w * 0.82, h * 1.5); t = R0 / (n + 0.4);
    for (let i = 0; i < n; i++) { const r = R0 - i * t; s += pth(`M${P(cx, cy)}L${P(cx + (left ? r : -r), cy)}A${P(r, r)} 0 0 ${left ? 0 : 1} ${P(cx, cy - r)}Z`, cols[i], outline(cols[i], o.G)); list.push([cols[i], 1 / n]); }
  }
  return { svg: plate(o, R) + s, n, caps: 0, rd: 0.8, cover: 0.5, thick: clamp(t / 20), ...stats(list) };
}

function slices(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 7), sk = lerp(26, 46, o.t1);
  const rw = Array.from({ length: n }, (_, i) => 1 + 0.55 * Math.sin(i * 2.3 + o.v * 1.7 + o.t2 * 5)); const tot = rw.reduce((q, v) => q + v, 0);
  const cols = o.t2 < 0.5 ? [S[0], S[1], S[2], S[3], S[4], S[5], S[6]] : [S[4], S[2], S[0], S[5], S[1], S[3], S[6]];
  let s = "", list = [], acc = x0 - sk * 0.1;
  const total = w + sk;
  for (let i = 0; i < n; i++) {
    const wi = (rw[i] / tot) * total, xa = acc, xb = acc + wi + 0.5, c = cols[i];
    s += poly([[xa + sk, y0], [xb + sk, y0], [xb, y0 + h], [xa, y0 + h]], c, outline(c, o.G));
    acc += wi; list.push([c, rw[i] / tot]);
  }
  return { svg: rect(x0, y0, w, h, mix(o.G, o.dark ? "#ffffff" : "#000000", 0.04)) + s, n, caps: 0, rd: -0.55, cover: 0.96, thick: clamp(1.1 - n * 0.09), ...stats(list) };
}

function pills(R, S, o) {
  const [x0, y0, w, h] = R;
  const n = clamp(o.n, 3, 7), g = lerp(4, 7, o.t1), ph = (h - 2 * 11 - (n - 1) * g) / n;
  const lens = [[1, 0.8, 0.62, 0.46, 0.3, 0.7, 0.54], [0.7, 1, 0.5, 0.82, 0.38, 0.9, 0.6], [0.45, 0.7, 1, 0.78, 0.56, 0.36, 0.84], [1, 0.6, 0.84, 0.4, 0.7, 0.52, 0.9]][o.v];
  const cols = o.t2 < 0.5 ? [S[0], S[2], S[1], S[4], S[3], S[5], S[6]] : [S[4], S[0], S[3], S[2], S[1], S[6], S[5]];
  const align = o.t3 < 0.34 ? "l" : o.t3 < 0.67 ? "c" : "r", wmax = w - 24;
  let s = "", list = [], caps = 0;
  for (let i = 0; i < n; i++) {
    const c = cols[i], pw = Math.max(ph * 2.2, lens[i] * wmax), x = align === "l" ? x0 + 12 : align === "c" ? x0 + (w - pw) / 2 : x0 + w - 12 - pw, y = y0 + 11 + i * (ph + g);
    s += rr(x, y, pw, ph, o.soft ? ph / 2 : 3, c, outline(c, o.G));
    if (pw > 70 && ph > 11) { s += cap(c, x + ph / 2 + 2, y + ph / 2 + 1.8); caps++; }
    list.push([c, (pw * ph) / (w * h)]);
  }
  return { svg: plate(o, R) + s, n, caps, rd: o.soft ? 0.9 : -0.3, cover: list.reduce((q, [, v]) => q + v, 0), thick: clamp(ph / 17), ...stats(list) };
}
const LAYOUTS = [bands, circles, tiles, chips, strips, rainbow, slices, pills];

/* ------------------------------------------------------------------ lower zone: "Aa", headline, button chip */
function chipBtn(x, y, label, fs, h, style, fill, ink, anchor = "start") {
  const ls = style === 2 ? 0.07 : 0.02, txt = style === 2 ? label.toUpperCase() : label;
  const w = tw(txt, fs, 700, ls) + h * 1.15;
  const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  const rx = style === 1 ? h / 2 : style === 2 ? 0 : 4;
  let s = style === 3 ? rr(x0 + 0.6, y + 0.6, w - 1.2, h - 1.2, rx, "none", { stroke: fill, "stroke-width": 1.2 }) : rr(x0, y, w, h, rx, fill);
  s += T(x0 + w / 2, y + h / 2 + fs * 0.35, txt, fs, 700, ls, style === 3 ? fill : ink, "middle");
  return { svg: s, w, h, x0, rd: style === 1 ? 1 : style === 2 ? -1 : -0.2 };
}

function lowerZone(variant, q) {
  const { zt, G, a, b, L1, D1, behind, slabFill, headCol, aaCol, head, cta, hw, hls, fsMax, bleed, t1, t2, t5 } = q;
  const style = Math.floor(t5 * 4);
  const btnFill = contrast(a, behind) >= 2.2 ? a : (contrast(b, behind) >= 2.2 ? b : bestOn(behind, [L1, D1]));
  const ink = (c) => bestOn(c, ["#ffffff", "#111114"]);
  const aaW = q.hw <= 500 ? 300 : q.hw === 600 ? (t2 < 0.5 ? 400 : 600) : (t2 < 0.5 ? 800 : 700);
  let s = "", fs = 14, n = 6, cover = 0.2, rd = 0;
  const aaHeft = (aaW - 300) / 500, bottom = H, cyz = (zt + bottom) / 2;
  if (variant === 0) { // Aa left, headline + button right
    const aaFs = 38 + t1 * 8, aaB = cyz + aaFs * 0.3;
    s += T(16, aaB + 2, "Aa", aaFs, aaW, -0.03, aaCol);
    const x2 = 16 + tw("Aa", aaFs, aaW, -0.03) + 18, maxW = 224 - x2;
    s += rect(x2 - 9, cyz - 22, 1, 44, mix(behind, headCol, 0.2));
    const bh = 16, gap = 8, availH = bottom - zt - 24;
    const hl = setLines(head, maxW, availH - gap - bh, fsMax, hw, hls);
    const lh = hl.fs * 1.16, blockH = hl.lines.length * lh + gap + bh, y1 = cyz - blockH / 2 + hl.fs * 0.8;
    hl.lines.forEach((ln, i) => { s += T(x2, y1 + i * lh, ln, hl.fs, hw, hls, headCol); });
    const bt = chipBtn(x2, y1 + (hl.lines.length - 1) * lh + gap - hl.fs * 0.1, cta, 7.4, bh, style, btnFill, ink(btnFill));
    s += bt.svg; fs = hl.fs; rd = bt.rd; n = 5 + hl.lines.length; cover = 0.2;
  } else if (variant === 1) { // headline on top, button left + Aa right
    const bh = 18, by = bottom - 14 - bh, top = zt + 11;
    const hl = setLines(head, 208, by - 7 - top, fsMax + 1.5, hw, hls);
    const lh = hl.fs * 1.14, y1 = top + hl.fs * 0.8;
    hl.lines.forEach((ln, i) => { s += T(16, y1 + i * lh, ln, hl.fs, hw, hls, headCol); });
    const bt = chipBtn(16, by, cta, 7.8, bh, style, btnFill, ink(btnFill));
    s += bt.svg;
    const aaFs = 28 + t1 * 8;
    s += T(224, bottom - 14 + 1, "Aa", aaFs, aaW, -0.03, aaCol, "end");
    fs = hl.fs; rd = bt.rd; n = 5 + hl.lines.length; cover = 0.2;
  } else if (variant === 2) { // dark slab with light type
    const sx = bleed ? 0 : 12, sw = bleed ? W : 216, sy = zt, sh = bottom - zt - (bleed ? 0 : 12);
    s += bleed ? pth(`M0 ${sy}H${W}V${bottom - 12}A12 12 0 0 1 ${W - 12} ${bottom}H12A12 12 0 0 1 0 ${bottom - 12}Z`, slabFill) : rr(sx, sy, sw, sh, 8, slabFill);
    const px = sx + 16, midY = sy + sh / 2, bh = 16, gap = 8;
    const hl = setLines(head, 118, sh - 24 - gap - bh, fsMax, hw, hls);
    const lh = hl.fs * 1.16, aaFs = 34 + t1 * 8, blockH = hl.lines.length * lh + gap + bh, y1 = midY - blockH / 2 + hl.fs * 0.8;
    hl.lines.forEach((ln, i) => { s += T(px, y1 + i * lh, ln, hl.fs, hw, hls, headCol); });
    const bfill = contrast(b, slabFill) >= 2.4 ? b : (contrast(a, slabFill) >= 2.4 ? a : bestOn(slabFill, [L1, D1]));
    const bt = chipBtn(px, y1 + (hl.lines.length - 1) * lh + gap - hl.fs * 0.1, cta, 7.4, bh, style, bfill, ink(bfill));
    s += bt.svg;
    s += T(sx + sw - 16, midY + aaFs * 0.3, "Aa", aaFs, aaW, -0.03, away(contrast(b, slabFill) >= 2.4 ? b : a, slabFill, 2.6), "end");
    fs = hl.fs; rd = bt.rd; n = 6 + hl.lines.length; cover = 1;
  } else { // inline: Aa | headline, full-width button below
    const aaFs = 26, y1 = zt + 17 + aaFs * 0.73;
    s += T(16, y1, "Aa", aaFs, aaW, -0.03, aaCol);
    const x2 = 16 + tw("Aa", aaFs, aaW, -0.03) + 20, hl = setLines(head, 224 - x2, 24, fsMax, hw, hls, 1);
    s += rect(x2 - 10, y1 - 20, 1, 24, mix(behind, headCol, 0.25));
    s += T(x2, y1 - 0.25 * aaFs + hl.fs * 0.35 - 1, hl.lines[0], hl.fs, hw, hls, headCol);
    const bh = 20, by = bottom - 14 - bh, bw = 208, rx = style === 1 ? bh / 2 : style === 2 ? 0 : 4;
    const txt = style === 2 ? cta.toUpperCase() : cta;
    s += style === 3 ? rr(16.6, by + 0.6, bw - 1.2, bh - 1.2, rx, "none", { stroke: btnFill, "stroke-width": 1.2 }) : rr(16, by, bw, bh, rx, btnFill);
    s += T(120, by + bh / 2 + 3, txt, 8, 700, style === 2 ? 0.07 : 0.02, style === 3 ? btnFill : ink(btnFill), "middle");
    fs = hl.fs; rd = style === 1 ? 1 : style === 2 ? -1 : -0.2; n = 5; cover = 0.26;
  }
  return { svg: s, fs, n, cover, aaHeft, rd };
}
