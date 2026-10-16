// Arena family "poster": type-led posters / social ads (3:4) built from a headline and a few geometric shapes.
//
// A pool of 32 is *planned* per season (planPoster): ten layouts are dealt in shuffled blocks (every layout 3-4
// times), legibility tiers are dealt exactly 8 poor / 16 mid / 8 excellent, colour moods and headlines are dealt in
// balanced blocks. The plan only depends on ctx.season (its own seeded PRNG); rand() supplies every per-specimen
// parameter (variant, type voice, geometry, copy).
//
// Main text = the headline (for the "numeral" layout: the huge number). Legibility:
//   contrast = WCAG ratio of the headline colour against the colour directly behind it (bg, or the block / disc / plate it sits on)
//   size     = font-size / 280 x 6.25, clamped to [0.1, 1]
//   score    = 0.7 x min(1, ln(contrast) / ln(12)) + 0.3 x size
// Traits are measured from what is drawn:
//   warm / vivid : warmOf / mean HSL chroma over the painted colours (area-weighted, text counted lightly)
//   dark         : 1 - L*/50 of the area-weighted lightness of the background colours (text excluded)
//   bold         : 0.5 x headline weight (300 -> -1 ... 900 -> +1) + 0.35 x headline size + 0.15 x ink coverage
//   round        : the layout's round / angular geometry (discs, rings, badges vs blocks, bars, squares), see each layout
//   airy         : empty share = 1 - (text boxes + shapes + half of the big solid blocks) / canvas
//   rich         : number of drawn elements (text lines + shapes)
import { svgRoot, esc, range, chance } from "../svgutil.js";
import { PALETTES, BRAND_NAMES, HEADLINES } from "../palettes.js";
import { mix, lighten, darken, hexToHsl, hsl, lightness, contrast } from "../color.js";
import { clamp, warmOf, richOf } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle, pick } from "../../prng.js";

export const DIMS = ["preference", "attention", "quality", "premium", "clarity"];
export const TEXT = true;
export const VIEWBOX = [210, 280];
const W = 210, H = 280, M = 16;

// ---------- tiny SVG helpers
const f = (v) => +(Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1));
const at = (o) => {
  let s = "";
  for (const k in o) {
    const v = o[k];
    if (v === undefined || v === null || v === false) continue;
    s += ` ${k}="${typeof v === "number" ? f(v) : v}"`;
  }
  return s;
};
const el = (t, o, i) => (i === undefined ? `<${t}${at(o)}/>` : `<${t}${at(o)}>${i}</${t}>`);
const R = (x, y, w, h, fill, o) => el("rect", { x, y, width: w, height: h, fill, ...o });
const C = (cx, cy, r, fill, o) => el("circle", { cx, cy, r, fill, ...o });
const P = (d, fill, o) => el("path", { d, fill, ...o });
const Ln = (x1, y1, x2, y2, stroke, sw, o) => el("line", { x1, y1, x2, y2, stroke, "stroke-width": sw, ...o });
const pth = (s, ...v) => {
  let o = s[0];
  for (let i = 0; i < v.length; i++) o += (typeof v[i] === "number" ? f(v[i]) : v[i]) + s[i + 1];
  return o;
};

// ---------- Inter advance widths (1/1000 em) at weight 300 and 900, interpolated (and extrapolated a little) for the weight
const GL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?-–—'\"“”«»·•/@%+−×()&‹›…_#№$€АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяӘәҒғҚқҢңӨөҰұҮүҺһІі";
const G3 = [673,649,728,719,595,588,744,740,262,567,647,564,900,759,759,628,759,634,632,636,736,673,966,662,666,622,549,602,559,602,580,345,603,589,233,234,528,233,873,588,593,602,602,359,516,298,589,556,815,531,556,542,618,394,614,606,629,580,602,560,611,602,281,282,282,282,292,282,500,453,500,1000,292,440,408,408,535,535,282,563,348,971,937,653,653,653,348,348,624,363,363,847,448,633,1086,632,673,673,639,649,577,816,595,595,932,606,759,759,655,754,900,740,759,740,628,728,636,609,817,662,705,695,941,953,809,853,642,728,1001,634,549,589,560,429,600,580,580,780,484,583,583,520,568,763,585,593,583,602,559,445,556,659,531,582,572,808,819,617,699,546,559,833,543,747,580,577,429,683,538,751,597,759,593,666,556,666,556,695,589,262,233];
const G9 = [795,668,748,723,613,584,754,750,291,596,759,565,956,770,775,656,787,668,666,687,722,795,1082,786,775,694,597,646,603,646,606,422,647,649,296,296,606,296,943,649,625,646,646,434,588,399,649,632,877,609,636,590,711,452,646,669,702,646,675,595,679,675,199,373,373,373,378,381,601,475,500,1000,372,625,625,610,726,726,373,398,412,1059,1044,693,693,693,388,388,695,471,471,1119,493,662,1110,666,700,795,647,668,586,910,613,613,1161,669,770,770,759,751,956,750,775,750,656,748,687,750,842,786,807,713,1016,1055,842,949,674,748,1066,668,597,623,587,467,701,606,606,910,541,649,649,618,628,848,649,625,635,646,603,548,636,854,609,706,621,892,931,708,866,616,604,888,598,750,606,586,467,808,662,789,688,775,625,775,632,775,632,713,649,291,296];
const GI = new Map([...GL].map((c, i) => [c, i]));
/** Width of a string at font-size fs, weight wt, tracking ls (em). */
function tw(s, fs, wt = 500, ls = 0) {
  const k = (wt - 300) / 600;
  let w = 0, n = 0;
  for (const ch of s) {
    const i = GI.get(ch);
    w += i === undefined ? 600 : G3[i] + (G9[i] - G3[i]) * k;
    n++;
  }
  return (w / 1000) * fs + ls * fs * n;
}

// ---------- copy
const SUBS = {
  en: ["New season, new rituals.", "Made slowly. Meant to last.", "Small batch, big flavour.", "Simple things done well.", "Fresh every single morning.", "Everything you need, nothing you don't."],
  ru: ["Новая коллекция уже в продаже.", "Сделано с любовью и вниманием.", "Просто, чисто, по-настоящему.", "Лучшее — каждый день.", "Всё самое нужное — рядом."],
  kk: ["Жаңа маусым басталды.", "Сапа мен дәм — бір жерде.", "Өзіңізге уақыт бөліңіз.", "Қарапайым әрі таза.", "Әр күн — жаңа бастама."],
};
const CTAS = { en: ["Get started", "Order today", "Learn more"], ru: ["Начать", "Подробнее", "Купить"], kk: ["Бастау", "Көру", "Тапсырыс беру"] };
const BADGES = { en: ["SALE", "NEW", "ONLY NOW"], ru: ["СКИДКА", "НОВОЕ", "СЕЙЧАС"], kk: ["ЖАҢА", "ТИІМДІ", "ЖЕҢІЛДІК"] };
const OFFS = { en: "OFF", ru: "СКИДКА", kk: "ЖЕҢІЛДІК" };
const MONTHS = {
  en: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  ru: ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"],
  kk: ["ҚАҢ", "АҚП", "НАУ", "СӘУ", "МАМ", "МАУ", "ШІЛ", "ТАМ", "ҚЫР", "ҚАЗ", "ҚАР", "ЖЕЛ"],
};
const VENUES = { en: ["Hall 2", "Studio 4", "Open air"], ru: ["Зал 2", "Студия 4", "Под открытым небом"], kk: ["2-зал", "4-студия", "Ашық аспан"] };
const NOTES = { en: "Customer note", ru: "Из отзывов", kk: "Пікір" };
const PATHS = ["start", "new", "open", "shop", "join", "more", "play"];
const KK_LETTERS = /[ӘәҒғҚқҢңӨөҰұҮүҺһІі]/;
const langOf = (head) => {
  if (KK_LETTERS.test(head)) return "kk";
  const i = HEADLINES.indexOf(head);
  if (i >= 12) return "kk";
  return /[А-Яа-яЁё]/.test(head) ? "ru" : "en";
};
const cased = (s, m) => (m === "U" ? s.toUpperCase() : m === "L" ? s.toLowerCase() : s);

// type voices per layout: [weight, tracking (em), case]
const VOICE = {
  stack: [[900, -0.04, "U"], [900, -0.05, "L"], [800, -0.03, "T"], [700, -0.02, "U"], [300, -0.02, "L"]],
  circle: [[300, 0.02, "T"], [800, -0.01, "T"], [600, 0.08, "U"], [900, -0.03, "L"]],
  split: [[800, -0.03, "T"], [900, -0.04, "U"], [500, 0, "T"], [900, -0.05, "L"]],
  bottom: [[900, -0.05, "L"], [800, -0.04, "U"], [700, -0.03, "T"]],
  numeral: [[900, -0.05, "T"]],
  quote: [[600, -0.01, "T"], [300, 0, "T"], [800, -0.02, "T"]],
  event: [[800, -0.03, "U"], [600, 0, "T"], [900, -0.04, "T"]],
  word: [[200, -0.02, "L"], [300, -0.03, "L"], [900, -0.06, "L"], [200, 0.0, "L"]],
  grid: [[700, -0.02, "T"], [500, 0, "U"], [900, -0.03, "U"]],
  stripes: [[900, -0.03, "U"], [700, 0.02, "U"], [800, -0.02, "L"]],
};
const LAYOUT_IDS = Object.keys(VOICE);

const PAL = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
const CAT = {
  warm: ["terracotta", "peach", "saffron", "roseClay", "cocoa", "dune"],
  cool: ["nordic", "mint", "lilac", "glacier", "sage", "skyPop"],
  dark: ["midnightCitrus", "graphiteEmerald", "noirGold", "deepPlum", "oceanNight", "ember", "chalk"],
  vivid: ["electricBerry", "limeVolt", "tangerine", "cobaltPink", "sunnyTeal", "hotCoral"],
  muted: ["dustyRose", "slateMist", "moss", "taupe", "fogLavender", "sandOlive"],
  graphic: ["inkPaper", "paperBlue", "boneBlack"],
  pastel: ["pastelHaze", "peachLow", "mintLow", "nightLow", "sandLow", "skyLow", "mint"],
};
const CATS = Object.keys(CAT);

/** The season's pool plan: 32 slots {layout, tier, cat, pal, head, brand}. */
function planPoster(season) {
  const r = mulberry32(hashStringToSeed(`${season}/poster/plan`));
  const slots = [];
  for (let b = 0; b < 4; b++) slots.push(...shuffle(r, LAYOUT_IDS).map((layout) => ({ layout })));
  slots.length = 32;
  const tiers = shuffle(r, [...Array(8).fill("poor"), ...Array(16).fill("mid"), ...Array(8).fill("exc")]);
  const cats = [];
  while (cats.length < 32) cats.push(...shuffle(r, CATS));
  const heads = [];
  while (heads.length < 32) heads.push(...shuffle(r, HEADLINES));
  const brands = shuffle(r, BRAND_NAMES), lists = {}, used = {};
  slots.forEach((s, i) => {
    s.tier = tiers[i];
    s.cat = cats[i];
    lists[s.cat] = lists[s.cat] ?? shuffle(r, CAT[s.cat]);
    used[s.cat] = (used[s.cat] ?? -1) + 1;
    s.pal = lists[s.cat][used[s.cat] % lists[s.cat].length];
    s.head = heads[i];
    s.brand = brands[i % brands.length];
  });
  return slots;
}

// ---------- colour decisions driven by the legibility tier
const maxC = (c) => Math.max(contrast(c, "#000000"), contrast(c, "#ffffff"));
const reach = (c, tier) => (tier === "exc" ? maxC(c) >= 12 : tier === "mid" ? maxC(c) >= 5.6 : true);
/** A headline colour for `bg` whose contrast lands in the tier's band (poor < 3.2, mid 3.6-8, excellent > 10.5). */
function inkFor(bg, tier, cands, r) {
  const band = tier === "poor" ? [1.35, 3.0] : tier === "mid" ? [3.6, 8.0] : [10.5, 21];
  const ok = cands.filter((c) => { const k = contrast(c, bg); return k >= band[0] && k <= band[1]; });
  if (ok.length) return pick(r, ok);
  const pole = lightness(bg) > 55 ? "#000000" : "#ffffff";
  const target = tier === "poor" ? range(r, 1.5, 2.7) : tier === "mid" ? range(r, 4.2, 7) : range(r, 11, 16);
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (contrast(mix(bg, pole, m), bg) < target) lo = m; else hi = m;
  }
  return mix(bg, pole, (lo + hi) / 2);
}

/** Per-specimen drawing context: collects svg, element count, shape coverage (cov) and text coverage (tc). */
function mkS() {
  return {
    s: "", n: 0, cov: 0, tc: 0,
    add(svg, area = 0, w = 1, cnt = 1) { this.s += svg; this.n += cnt; this.cov += area * w; },
  };
}
/** Pushes a text line (its box, width x cap height, counts as text coverage); returns the line's width. */
function txt(S, x, y, str, fs, fill, o = {}) {
  const { w = 500, ls = 0, a = "start", op, rot } = o;
  const lp = ls * fs, width = tw(str, fs, w, ls);
  const xx = a === "middle" ? x + lp / 2 : a === "end" ? x + lp : x;
  S.s += el("text", { x: xx, y, "font-size": fs, "font-weight": w, "letter-spacing": ls ? lp : null, "text-anchor": a === "start" ? null : a, fill, "fill-opacity": op, transform: rot ? `rotate(${rot} ${f(xx)} ${f(y)})` : null }, esc(str));
  S.n++;
  S.tc += width * fs * 0.78;
  return width;
}

/** Joins one- and two-letter words to their neighbour so no line is an orphan ("и", "of", "to"). */
const joinShort = (words) => {
  const out = [], w = words.slice();
  for (let i = 0; i < w.length; i++) {
    if (w[i].length <= 2 && i < w.length - 1) { w[i + 1] = w[i] + " " + w[i + 1]; continue; }
    out.push(w[i]);
  }
  return out;
};
const stackLines = (words) => {
  const lines = words.slice();
  while (lines.length > 3) {
    let k = 0, best = 1e9;
    for (let i = 0; i < lines.length - 1; i++) {
      const l = lines[i].length + lines[i + 1].length;
      if (l < best) { best = l; k = i; }
    }
    lines.splice(k, 2, lines[k] + " " + lines[k + 1]);
  }
  return lines;
};
/** Splits words into at most two lines of similar width. */
const balance2 = (words, wt, ls) => {
  if (words.length < 2) return words;
  let best = null, bw = 1e9;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" "), m = Math.max(tw(a, 1, wt, ls), tw(b, 1, wt, ls));
    if (m < bw) { bw = m; best = [a, b]; }
  }
  return best;
};

/** Colours for one layout: the background that sits behind the headline, the headline ink (tier-controlled) and accents. */
function colors(g, bgOpts, headBg) {
  const { pal, tier, r } = g;
  const opts = g.loud && !headBg ? [pal.a, pal.b, ...bgOpts] : bgOpts;
  const bg = opts.find((o) => reach(o, tier)) ?? opts[opts.length - 1];
  const behind = headBg ?? bg;
  const cands = tier === "poor" ? [pal.a, pal.b, mix(behind, pal.a, 0.4), mix(behind, pal.ink, 0.32), pal.ink] : tier === "mid" ? [pal.a, pal.b, darken(pal.a, 0.3), lighten(pal.a, 0.3), mix(pal.ink, behind, 0.3)] : [pal.ink, "#0d0d10", "#ffffff", "#fffdf7"];
  const hc = inkFor(behind, tier, cands, r);
  const dk = lightness(bg) < 50;
  const pool = [pal.a, pal.b, g.deep, pal.surface].filter((c) => contrast(c, bg) >= 1.6);
  const acc = pool[0] ?? (dk ? "#ffffff" : "#111111"), acc2 = pool[1] ?? acc;
  const sc = tier === "poor" ? mix(bg, hc, 0.9) : contrast(pal.ink, bg) >= 6 ? pal.ink : dk ? "#f4f1ea" : "#16140f";
  return { bg, behind, hc, acc, acc2, sc, dk };
}
const onInk = (bg) => (contrast(bg, "#14120f") >= contrast(bg, "#ffffff") ? "#14120f" : "#ffffff");
const urlOf = (g) => `${g.brand.toLowerCase()}.app/${g.path}`;

// =====================================================================================================
// LAYOUTS: each draws into S (the background fill excluded) and returns
// { bg (page colour), c (colours), fs (headline font-size), behind (colour directly behind the headline),
//   round -1..1, wt (headline weight), bgCols:[[hex, share]] (area-weighted painted colours), extra? }
// =====================================================================================================
const subFs = (str, maxW, fs0 = 7.6) => Math.min(fs0, maxW / tw(str, 1, 500, 0));

const LAYOUTS = {
  // oversized stacked headline, left aligned, tight leading; sub line and URL at the foot
  stack(g, S) {
    const { pal, v } = g, [wt, ls, cs] = g.voice;
    const c = colors(g, v === 1 ? [pal.a, pal.bg] : v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface]);
    const lines = stackLines(cased(g.head, cs).split(" ")), n = lines.length, lh = 0.92;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((W - 2 * M) / w1, 66, (H * 0.56) / (0.73 + (n - 1) * lh))), bh = 0.73 * fs + (n - 1) * lh * fs;
    const top = v === 1 ? Math.max(M + 4, H * 0.44 - bh / 2) : M + 4, y0 = top + 0.73 * fs, ox = -0.04 * fs, yb = H - M;
    lines.forEach((l, i) => txt(S, M + ox, y0 + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    S.add(R(M, yb - 40, 22, 1.6, c.acc), 40);
    txt(S, M, yb - 26, g.sub, subFs(g.sub, W - 2 * M - 50), c.sc, { w: 500 });
    txt(S, M, yb - 4, urlOf(g), 6.4, c.sc, { w: 600, ls: 0.05 });
    if (v === 1) {
      S.add(R(M, top + bh + 16, 44, 5, c.acc), 220);
      S.add(C(W - M - 16, yb - 18, 16, c.acc2), 800);
    } else if (v === 2) S.add(P(pth`M${W - M} ${yb}H${W - M - 40}A40 40 0 0 1 ${W - M} ${yb - 40}Z`, c.acc2), 800);
    else S.add(C(W - M - 8, M + 8, 6, c.acc), 110);
    return { bg: c.bg, c, fs, behind: c.bg, round: v === 1 ? 0.0 : v === 2 ? -0.1 : -0.35, wt, bgCols: [[c.bg, 1]], extra: [[c.acc, 0.05]] };
  },

  // centred headline inside a big disc (or ring), orbit dot, tracked brand line above
  circle(g, S) {
    const { pal, v, r } = g, [wt, ls, cs] = g.voice, ring = v === 2;
    const discOpts = g.loud ? [pal.a, pal.b, g.deep] : [pal.a, pal.b, g.deep], disc0 = discOpts.find((o) => reach(o, g.tier)) ?? discOpts[0];
    const bgPool = [pal.bg, pal.surface, g.deep, mix(pal.a, "#ffffff", 0.82)];
    const bg = ring ? bgPool.find((o) => reach(o, g.tier)) ?? bgPool[0] : bgPool.find((o) => contrast(o, disc0) >= 1.5) ?? bgPool[0];
    const c = colors(g, [bg], ring ? bg : disc0);
    const disc = ring ? bg : disc0;
    const cx = W / 2, cy = 118 + range(r, -4, 4), R0 = Math.min(76 + range(r, -4, 4), 198 - cy);
    if (ring) S.add(C(cx, cy, R0 - 1.5, "none", { stroke: c.acc, "stroke-width": 3 }), Math.PI * R0 * R0 * 0.25);
    else S.add(C(cx, cy, R0, disc), Math.PI * R0 * R0, 0.6);
    const words = cased(g.head, cs).split(" "), lines = words.length > 1 ? balance2(words, wt, ls) : words, n = lines.length, lh = 1.04;
    let fs = 30;
    for (let k = 0; k < 4; k++) {
      const bh = n * lh * fs, chord = 2 * Math.sqrt(Math.max(1, R0 * R0 - (bh / 2 + 3) ** 2)) * 0.86, w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
      fs = Math.max(14, Math.min(chord / w1, 38));
    }
    const yBase = cy - ((n - 1) * lh * fs) / 2 + 0.36 * fs;
    lines.forEach((l, i) => txt(S, cx, yBase + i * lh * fs, l, fs, c.hc, { w: wt, ls, a: "middle" }));
    const ang = -0.75;
    S.add(C(cx + R0 * Math.cos(ang), cy + R0 * Math.sin(ang), 5.5, ring ? c.acc2 : c.acc), 95);
    txt(S, cx, 24, g.brand.toUpperCase(), 6.4, c.sc, { w: 700, ls: 0.34, a: "middle" });
    txt(S, cx, cy + R0 + 22, g.sub, subFs(g.sub, W - 2 * M), c.sc, { w: 500, a: "middle" });
    S.add(R(cx - 11, H - 36, 22, 1.4, c.acc), 30);
    txt(S, cx, H - 20, urlOf(g), 6.4, c.sc, { w: 600, ls: 0.05, a: "middle" });
    return { bg, c, fs, behind: disc, round: ring ? 0.8 : 0.9, wt, bgCols: ring ? [[bg, 1], [c.acc, 0.08]] : [[bg, 0.62], [disc, 0.38]] };
  },

  // two colour blocks (horizontal or vertical) with the headline in the large one
  split(g, S) {
    const { pal, v, r } = g, [wt, ls, cs] = g.voice, horiz = v !== 1;
    const aOpts = [pal.a, g.deep, pal.b], A = aOpts.find((o) => reach(o, g.tier)) ?? aOpts[0];
    const bPool = [pal.bg, pal.surface, pal.b, g.deep, "#f4f1ea"], B = bPool.find((o) => contrast(o, A) >= 1.8) ?? bPool.find((o) => contrast(o, A) >= 1.3) ?? bPool[0];
    const c = colors(g, [B], A);
    const lines = stackLines(joinShort(cased(g.head, cs).split(" "))), n = lines.length, lh = 0.94;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    if (horiz) {
      const ys = Math.round(H * range(r, 0.55, 0.64)), cr = 20 + Math.floor(r() * 5);
      S.add(R(0, 0, W, ys, A), W * ys, 0.55);
      const fs = Math.max(16, Math.min((W - 2 * M) / w1, 54, (ys - 2 * M - 10) / (0.73 + (n - 1) * lh)));
      const yl = ys - 18 - (n - 1) * lh * fs;
      lines.forEach((l, i) => txt(S, M - 0.04 * fs, yl + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
      txt(S, M, M + 8, g.brand.toUpperCase(), 6.4, onInk(A), { w: 700, ls: 0.3, op: 0.9 });
      S.add(C(W - M - cr, ys + cr + 8, cr, c.acc2), Math.PI * cr * cr);
      txt(S, M, ys + 30, g.sub, subFs(g.sub, W - 2 * M - 2 * cr - 14, 7.8), c.sc, { w: 500 });
      txt(S, M, H - M, urlOf(g), 6.4, c.sc, { w: 600, ls: 0.05 });
      return { bg: B, c: { ...c, behind: A }, fs, behind: A, round: 0.05, wt, bgCols: [[A, 0.58], [B, 0.42]] };
    }
    const bw = Math.round(W * range(r, 0.58, 0.66)), tx = M;
    S.add(R(0, 0, bw, H, A), bw * H, 0.55);
    const fs = Math.max(16, Math.min((bw - M - 12) / w1, 46, (H * 0.5) / (0.73 + (n - 1) * lh)));
    const yl = M + 10 + fs * 0.73;
    lines.forEach((l, i) => txt(S, tx - 0.04 * fs, yl + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    const cr = (W - bw) * 0.34, ccx = bw + (W - bw) / 2, ccy = H * 0.3;
    S.add(C(ccx, ccy, cr, c.acc2), Math.PI * cr * cr);
    txt(S, tx, H - 44, g.sub, subFs(g.sub, bw - M - 10, 7.6), onInk(A), { w: 500, op: g.tier === "poor" ? 0.7 : 0.95 });
    txt(S, tx, H - M, urlOf(g), 6.4, onInk(A), { w: 600, ls: 0.05, op: g.tier === "poor" ? 0.7 : 0.95 });
    txt(S, ccx, H * 0.62 + 10, g.brand.toUpperCase(), 6.4, c.sc, { w: 700, ls: 0.3, a: "middle" });
    return { bg: B, c: { ...c, behind: A }, fs, behind: A, round: -0.25, wt, bgCols: [[A, bw / W], [B, 1 - bw / W]] };
  },

  // top whitespace, a hairline and tiny kicker; the headline sits heavy at the bottom
  bottom(g, S) {
    const { pal, v } = g, [wt, ls, cs] = g.voice;
    const c = colors(g, v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface, g.deep]);
    const lines = stackLines(cased(g.head, cs).split(" ")), n = lines.length, lh = 0.9;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((W - 2 * M) / w1, 62, (H * 0.5) / (0.73 + (n - 1) * lh)));
    const yLast = H - 36, y0 = yLast - (n - 1) * lh * fs;
    lines.forEach((l, i) => txt(S, M - 0.04 * fs, y0 + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    txt(S, M, H - 14, urlOf(g), 6.4, c.sc, { w: 600, ls: 0.05 });
    S.add(R(M, 26, W - 2 * M, 1, c.sc, { opacity: 0.7 }), 178);
    txt(S, M, 19, g.brand.toUpperCase(), 6.4, c.sc, { w: 700, ls: 0.3 });
    txt(S, W - M, 19, `N° ${String(g.no).padStart(2, "0")}`, 6.4, c.sc, { w: 600, ls: 0.1, a: "end" });
    txt(S, M, 44, g.sub, subFs(g.sub, W - 2 * M - 50), c.sc, { w: 500 });
    if (v === 1) S.add(P(pth`M${W} 26V${26 + 52}A52 52 0 0 1 ${W - 52} 26Z`, c.acc), 1350);
    else S.add(R(W - M - 26, 54, 26, 26, c.acc), 676);
    return { bg: c.bg, c, fs, behind: c.bg, round: v === 1 ? 0.3 : -0.55, wt, bgCols: [[c.bg, 1]], extra: [[c.acc, 0.04]] };
  },

  // a huge percentage with a sticker badge, a phrase and a CTA pill
  numeral(g, S) {
    const { pal, v, r } = g, wt = 900, ls = -0.05;
    const c = colors(g, v === 1 ? [pal.a, pal.bg] : [pal.bg, pal.surface, g.deep]);
    const dd = pick(r, ["30", "50", "70", "15", "25", "40", "20"]), minus = chance(r, 0.4);
    const num = (minus ? "−" : "") + dd, pw = 0.42;
    const total = tw(num, 1, wt, ls) + 0.03 + tw("%", pw, wt, ls);
    const fs = Math.min((W - 2 * M) / total, 120), yb = 168, ox = -0.025 * fs;
    const w = txt(S, M + ox, yb, num, fs, c.hc, { w: wt, ls });
    txt(S, M + ox + w + 0.03 * fs, yb - 0.73 * fs + 0.73 * fs * pw, "%", fs * pw, c.hc, { w: wt, ls });
    const bx = W - M - 28, by = 52, br = 27, ba = chance(r, 0.5) ? -12 : 10, btxt = pick(r, BADGES[g.lang]);
    S.add(`<g transform="rotate(${ba} ${bx} ${by})">${C(bx, by, br, c.acc)}${el("text", { x: bx, y: by + 3.2, "font-size": btxt.length > 6 ? 6.6 : 9, "font-weight": 800, "letter-spacing": 0.6, "text-anchor": "middle", fill: onInk(c.acc) }, esc(btxt))}</g>`, Math.PI * br * br, 1, 2);
    txt(S, M, 29, g.brand.toUpperCase(), 6.4, c.sc, { w: 700, ls: 0.3 });
    txt(S, M, yb + 22, OFFS[g.lang], 9.5, c.sc, { w: 800, ls: 0.3 });
    S.add(R(M, yb + 31, W - 2 * M, 1, c.sc, { opacity: 0.5 }), 178);
    txt(S, M, yb + 48, g.head, Math.min(15, (W - 2 * M) / tw(g.head, 1, 700, -0.01)), c.sc, { w: 700, ls: -0.01 });
    txt(S, M, yb + 62, g.sub, subFs(g.sub, W - 2 * M, 7.2), c.sc, { w: 500, op: 0.9 });
    const cta = pick(r, CTAS[g.lang]), pwid = tw(cta, 8, 700, 0.02) + 26;
    S.add(R(M, H - M - 24, pwid, 24, c.acc, { rx: 12 }), pwid * 24);
    txt(S, M + pwid / 2, H - M - 8.5, cta, 8, onInk(c.acc), { w: 700, ls: 0.02, a: "middle" });
    txt(S, W - M, H - M - 8.5, urlOf(g), 6.2, c.sc, { w: 600, ls: 0.04, a: "end" });
    return { bg: c.bg, c, fs, behind: c.bg, round: 0.3, wt, bgCols: [[c.bg, 1]], extra: [[c.acc, 0.07]] };
  },

  // a big quotation mark, the headline set as a quote, an attribution (left, centred, or over a ghost mark)
  quote(g, S) {
    const { pal, v } = g, [wt, ls] = g.voice;
    const c = colors(g, v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface]);
    const lines = stackLines(joinShort(g.head.split(" "))), n = lines.length, lh = 1.12, mid = v === 1;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((W - 2 * M) / w1, 34, 108 / ((n - 1) * lh + 1))), top = mid ? 122 : 112;
    if (v === 2) S.add(el("text", { x: M - 14, y: 248, "font-size": 300, "font-weight": 900, fill: mix(c.bg, c.acc, 0.16) }, "“"), 150 * 90, 0.3);
    else S.add(el("text", { x: mid ? W / 2 : M - 5, y: M + 126, "font-size": 150, "font-weight": 900, "text-anchor": mid ? "middle" : null, fill: c.acc }, "“"), 70 * 44);
    const y0 = top + fs * 0.73, ax = mid ? W / 2 : M, an = mid ? "middle" : "start";
    lines.forEach((l, i) => txt(S, ax, y0 + i * lh * fs, l, fs, c.hc, { w: wt, ls, a: an }));
    const ya = y0 + (n - 1) * lh * fs + 30;
    S.add(R(mid ? W / 2 - 9 : M, ya - 8, 18, 1.6, c.acc), 28);
    txt(S, ax, ya + 4, NOTES[g.lang] + " · " + g.brand, 7, c.sc, { w: 600, ls: 0.04, a: an });
    txt(S, ax, H - M, urlOf(g), 6.4, c.sc, { w: 600, ls: 0.05, a: an });
    txt(S, W - M, M + 8, "N° " + String(g.no).padStart(2, "0"), 6.4, c.sc, { w: 600, ls: 0.1, a: "end" });
    return { bg: c.bg, c, fs, behind: c.bg, round: 0.25, wt, bgCols: [[c.bg, 1]], extra: [[c.acc, 0.06]] };
  },

  // a date block + a title: the typographic grid of an event poster
  event(g, S) {
    const { pal, v, r } = g, [wt, ls, cs] = g.voice;
    const c = colors(g, v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface]);
    const bw = 58, bx = M, by = M + 4, blk = [pal.a, pal.b, c.acc].find((o) => contrast(o, c.bg) >= 1.6) ?? c.acc;
    S.add(R(bx, by, bw, bw, blk, { rx: v === 1 ? 29 : 3 }), bw * bw);
    const day = String(1 + Math.floor(r() * 28)), mon = MONTHS[g.lang][Math.floor(r() * 12)], ink = onInk(blk);
    txt(S, bx + bw / 2, by + 38, day, 34, ink, { w: 900, ls: -0.04, a: "middle" });
    txt(S, bx + bw / 2, by + 52, mon, 8.5, ink, { w: 700, ls: 0.16, a: "middle" });
    const venue = pick(r, VENUES[g.lang]), time = pick(r, ["18:00", "19:00", "20:30", "12:00"]);
    txt(S, bx + bw + 14, by + 24, time, 19, c.sc, { w: 700, ls: -0.02 });
    txt(S, bx + bw + 14, by + 40, venue, subFs(venue, W - M - bx - bw - 14, 8.2), c.sc, { w: 500 });
    txt(S, bx + bw + 14, by + 54, g.brand.toUpperCase(), 6.2, c.sc, { w: 700, ls: 0.3, op: 0.8 });
    const lines = stackLines(joinShort(cased(g.head, cs).split(" "))), n = lines.length, lh = 0.98;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((W - 2 * M) / w1, 44, 92 / (0.73 + (n - 1) * lh)));
    const y0 = 118 + fs * 0.73;
    lines.forEach((l, i) => txt(S, M - 0.04 * fs, y0 + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    S.add(R(M, H - 52, W - 2 * M, 1, c.sc, { opacity: 0.6 }), 178);
    const cta = pick(r, CTAS[g.lang]), pwid = tw(cta, 7.6, 700, 0.02) + 22;
    S.add(R(M, H - 40, pwid, 22, c.acc, { rx: 11 }), pwid * 22);
    txt(S, M + pwid / 2, H - 25.6, cta, 7.6, onInk(c.acc), { w: 700, ls: 0.02, a: "middle" });
    txt(S, W - M, H - 25.6, urlOf(g), 6.2, c.sc, { w: 600, ls: 0.04, a: "end" });
    return { bg: c.bg, c, fs, behind: c.bg, round: v === 1 ? 0.5 : -0.5, wt, bgCols: [[c.bg, 1], [blk, 0.07]] };
  },

  // one word, lots of air, a whisper of caption (left, centred, or sunk to the bottom)
  word(g, S) {
    const { pal, v, r } = g, [wt, ls] = g.voice;
    const c = colors(g, v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface]);
    const words = g.head.split(" "), main = words.find((w) => w.length >= 4) ?? words[0], rest = words.filter((w) => w !== main).join(" ");
    const word = main.toLowerCase(), dot = wt <= 300 || chance(r, 0.4), full = word + (dot ? "." : "");
    const fs = Math.max(16, Math.min((W - 2 * M) / tw(full, 1, wt, ls), 64)), mid = v === 1;
    const yb = v === 2 ? H - 96 : H * 0.47 + fs * 0.36, ox = mid ? 0 : -0.04 * fs, wd = tw(word, fs, wt, ls), wf = tw(full, fs, wt, ls);
    const x0 = mid ? (W - wf) / 2 : M + ox;
    txt(S, x0, yb, word, fs, c.hc, { w: wt, ls });
    if (dot) txt(S, x0 + wd, yb, ".", fs, c.acc, { w: wt, ls });
    const an = mid ? "middle" : "start", ax = mid ? W / 2 : M;
    txt(S, ax, M + 8, g.brand.toUpperCase(), 6.4, c.sc, { w: 700, ls: 0.34, a: an });
    if (!mid) S.add(C(W - M - 3, M + 5, 3, c.acc), 28);
    S.add(R(mid ? W / 2 - 7 : M, H - 60, 14, 1.4, c.sc, { opacity: 0.8 }), 20);
    if (rest) txt(S, ax, H - 46, rest, 8.4, c.sc, { w: 600, a: an });
    txt(S, ax, H - (rest ? 34 : 46), g.sub, subFs(g.sub, W - 2 * M, 7), c.sc, { w: 500, op: 0.9, a: an });
    txt(S, ax, H - M, urlOf(g), 6.2, c.sc, { w: 600, ls: 0.05, a: an });
    return { bg: c.bg, c, fs, behind: c.bg, round: -0.05, wt, bgCols: [[c.bg, 1]], extra: [[c.acc, 0.01]] };
  },

  // a modular 3 x 3 grid of simple tiles above the headline
  grid(g, S) {
    const { pal, v, r } = g, [wt, ls, cs] = g.voice;
    const c = colors(g, v === 2 ? [g.deep, pal.bg] : [pal.bg, pal.surface]);
    const gap = 5, tw_ = (W - 2 * M - 2 * gap) / 3, th = 46, x0 = M, y0 = M, q = th;
    const set = [pal.a, pal.b, g.deep, pal.surface, mix(pal.a, pal.b, 0.5)].filter((h, i, a) => a.indexOf(h) === i);
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const x = x0 + i * (tw_ + gap), y = y0 + j * (th + gap), bgc = pick(r, set), fg = set.filter((h) => contrast(h, bgc) >= 1.5), sh = fg.length ? pick(r, fg) : onInk(bgc), k = Math.floor(r() * 6), rot = 90 * Math.floor(r() * 4);
        const sx = x + (tw_ - q) / 2, tr = rot ? { transform: `rotate(${rot} ${f(x + tw_ / 2)} ${f(y + th / 2)})` } : {};
        let svg = R(x, y, tw_, th, bgc, { rx: 2 }), cnt = 2;
        if (k === 0) svg += C(x + tw_ / 2, y + th / 2, q * 0.34, sh);
        else if (k === 1) svg += P(pth`M${sx + q * 0.14} ${y + q * 0.62}A${q * 0.36} ${q * 0.36} 0 0 1 ${sx + q * 0.86} ${y + q * 0.62}Z`, sh, tr);
        else if (k === 2) svg += P(pth`M${sx} ${y + q}V${y}A${q} ${q} 0 0 1 ${sx + q} ${y + q}Z`, sh, tr);
        else if (k === 3) svg += C(x + tw_ / 2, y + th / 2, q * 0.28, "none", { stroke: sh, "stroke-width": q * 0.12 });
        else if (k === 4) svg += R(sx + q * 0.18, y + q * 0.18, q * 0.64, q * 0.64, sh, tr);
        else { svg += [0, 1, 2].map((z) => R(sx + q * 0.16, y + q * (0.2 + z * 0.24), q * 0.68, q * 0.12, sh)).join(""); cnt = 4; }
        S.add(svg, tw_ * th, 0.95, cnt);
      }
    const lines = stackLines(joinShort(cased(g.head, cs).split(" "))), n = lines.length, lh = 1.0;
    const w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((W - 2 * M) / w1, 26, 58 / (0.73 + (n - 1) * lh)));
    const yl = y0 + 3 * th + 2 * gap + 18 + fs * 0.73;
    lines.forEach((l, i) => txt(S, M - 0.03 * fs, yl + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    txt(S, M, H - M - 12, subFs(g.sub, W - 2 * M, 7) < 7 ? g.sub : g.sub, subFs(g.sub, W - 2 * M, 7), c.sc, { w: 500 });
    txt(S, M, H - M, urlOf(g), 6.2, c.sc, { w: 600, ls: 0.05 });
    return { bg: c.bg, c, fs, behind: c.bg, round: 0.0, wt, bgCols: [[c.bg, 0.4], ...set.slice(0, 3).map((h) => [h, 0.2])] };
  },

  // a stripe or halftone field with the headline on a solid plate
  stripes(g, S) {
    const { pal, v, r } = g, [wt, ls, cs] = g.voice, half = v === 1;
    const plateOpts = [pal.surface, g.deep, pal.bg, pal.a], plate = plateOpts.find((o) => reach(o, g.tier)) ?? plateOpts[0];
    const fieldPool = (g.loud ? [pal.a, pal.b, pal.bg, g.deep] : [pal.a, pal.b, pal.bg, g.deep]).filter((h) => contrast(h, plate) >= 1.3), field = fieldPool[0] ?? pal.bg;
    const alt = pick(r, [mix(field, "#ffffff", 0.18), mix(field, "#000000", 0.16), pal.b]);
    const c = colors(g, [field], plate);
    if (half) {
      const cols = 8, rows = 9, ins = 8, sx = (W - 2 * ins) / cols, sy = 150 / rows, dotc = contrast(pal.b, field) >= 1.4 ? pal.b : c.acc;
      let d = "";
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const rr = 1 + (j / (rows - 1)) * (sx * 0.46), x = ins + sx * (i + 0.5), y = sy * (j + 0.5) + 4;
          d += pth`M${x - rr} ${y}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
        }
      S.add(P(d, dotc), W * 150, 1, cols * rows);
    } else {
      const N = pick(r, [12, 14, 16]), bh = H / N;
      let bars = "";
      for (let i = 1; i < N; i += 2) bars += R(0, i * bh, W, bh + 0.3, alt);
      S.add(bars, W * H, 0.95, N / 2); // a full-bleed stripe field leaves no calm area: it counts as covering the canvas
    }
    const lines = stackLines(joinShort(cased(g.head, cs).split(" "))), n = lines.length, lh = 0.96;
    const px = M, pw = W - 2 * M, w1 = Math.max(...lines.map((l) => tw(l, 1, wt, ls)));
    const fs = Math.max(16, Math.min((pw - 24) / w1, 34, 70 / (0.73 + (n - 1) * lh)));
    const ph = 30 + 0.73 * fs + (n - 1) * lh * fs + 30, py = Math.min(H - M - ph, 150);
    S.add(R(px, py, pw, ph, plate, { rx: 5 }), pw * ph, 0.3);
    txt(S, px + 12, py + 15, g.brand.toUpperCase(), 6, onInk(plate), { w: 700, ls: 0.3, op: 0.75 });
    const y0 = py + 24 + 0.73 * fs;
    lines.forEach((l, i) => txt(S, px + 12 - 0.03 * fs, y0 + i * lh * fs, l, fs, c.hc, { w: wt, ls }));
    txt(S, px + 12, py + ph - 9, urlOf(g), 6, onInk(plate), { w: 600, ls: 0.05, op: 0.8 });
    return { bg: field, c: { ...c, behind: plate }, fs, behind: plate, round: half ? 0.7 : -0.65, wt, bgCols: [[field, 0.7], [plate, 0.3]] };
  },
};

export function build(rand, ctx) {
  const slot = planPoster(String(ctx.season))[ctx.index % 32];
  const pal = PAL[slot.pal];
  const dark = lightness(pal.bg) < 40;
  const lang = langOf(slot.head);
  const deep = dark ? pal.bg : lightness(pal.ink) < 28 ? pal.ink : darken(pal.a, 0.78);
  const g = {
    id: ctx.id, r: rand, pal, tier: slot.tier, head: slot.head, brand: slot.brand, lang, deep, dark, loud: slot.cat === "vivid",
    voice: pick(rand, VOICE[slot.layout]), v: Math.floor(rand() * 3), no: 1 + Math.floor(rand() * 98),
  };
  g.sub = pick(rand, SUBS[lang]);
  g.path = pick(rand, PATHS);
  const S = mkS();
  const out = LAYOUTS[slot.layout](g, S);
  const clip = `<clipPath id="${ctx.id}-p"><rect width="${W}" height="${H}" rx="10"/></clipPath>`;
  const svg = svgRoot(W, H, `<defs>${clip}</defs><g clip-path="url(#${ctx.id}-p)">${R(0, 0, W, H, out.bg)}${S.s}</g>`, { "font-family": "Inter, system-ui, sans-serif" });

  // ---- legibility of the headline
  const ratio = contrast(out.c.hc, out.behind);
  const size = clamp((out.fs / H) * 6.25, 0.1, 1);
  const legibility = {
    score: Math.round((0.7 * Math.min(1, Math.log(ratio) / Math.log(12)) + 0.3 * size) * 100) / 100,
    contrast: Math.round(ratio * 10) / 10,
    size: Math.round(size * 100) / 100,
  };

  // ---- traits
  const chroma = (h) => { const [, sat, l] = hexToHsl(h); return sat * (1 - Math.abs(2 * l - 1)); };
  const all = [...out.bgCols, ...(out.extra ?? [])];
  const tot6 = all.reduce((a, c) => a + c[1] ** 0.6, 0);
  const hexes = all.flatMap(([h, n]) => Array(Math.max(1, Math.round((n ** 0.6 * 12) / tot6))).fill(h));
  const lAvg = out.bgCols.reduce((a, [h, n]) => a + lightness(h) * n, 0) / out.bgCols.reduce((a, c) => a + c[1], 0);
  const stem = 0.02 + ((out.wt - 100) / 800) * 0.17;   // Inter stem width in em: 100 -> 0.02 ... 900 -> 0.19
  const thick = stem * out.fs;
  const traits = {
    warm: warmOf(hexes),
    vivid: clamp((hexes.reduce((a, h) => a + chroma(h), 0) / hexes.length - 0.26) / 0.3),
    dark: clamp(1 - lAvg / 50),
    bold: clamp(0.85 * clamp(Math.log2(thick / 4.2) * 0.9) + 0.3 * clamp((S.cov / (W * H) - 0.18) * 3, -0.5, 1)),
    round: clamp(out.round),
    airy: clamp((1 - (S.cov + S.tc) / (W * H) - 0.45) * 3),
    rich: richOf(S.n, 6, 26),
  };
  return { name: `${slot.layout} / ${slot.head}`, svg, traits, legibility };
}
