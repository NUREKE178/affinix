// Arena family "pack": front-facing flat-vector product packaging on a soft studio backdrop.
//
// A pool of 32 is *planned* per season (planPack): ten pack forms x ten print designs are dealt in
// Latin-square blocks, so every form and every design shows up 3-4 times in every pool, never as the same
// pair twice; colour moods (warm / cool / dark / vivid / muted / graphic / pastel) are dealt the same way.
// The plan only depends on ctx.season (a seeded PRNG of its own), so it is deterministic; rand() then
// supplies every per-specimen parameter (proportions, variant, type voice, backdrop).
//
// Traits are measured, not random:
//   warm / vivid : warmOf / vividOf over the colours actually painted (backdrop + print, weighted by area)
//   dark         : 1 - L*/50 of the area-weighted lightness of backdrop (55 %) and print (45 %)
//   round        : 0.5 x the form's silhouette roundness + 0.5 x the print's motif roundness (+ a spot circle)
//   bold         : print weight (blocks / heavy type high, hairlines low) + a little of the print's saturation
//   airy         : share of the label left plain (60 %), mixed with how small the pack sits in the frame (40 %)
//   rich         : element count of the artwork + the form's details
import { svgRoot, esc, range, chance } from "../svgutil.js";
import { PALETTES, BRAND_NAMES } from "../palettes.js";
import { mix, lighten, darken, hexToHsl, hsl, lightness, contrast } from "../color.js";
import { clamp, warmOf, vividOf, richOf } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle, pick } from "../../prng.js";

export const DIMS = ["preference", "attention", "trust", "quality", "premium", "purchaseIntent"];
export const TEXT = false;
export const VIEWBOX = [240, 260];
const W = 240, H = 260, CX = 120;

// ---------- tiny SVG helpers (numbers are trimmed to keep a specimen well under 7 KB)
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
const E = (cx, cy, rx, ry, fill, o) => el("ellipse", { cx, cy, rx, ry, fill, ...o });
const pth = (s, ...v) => {
  let o = s[0];
  for (let i = 0; i < v.length; i++) o += (typeof v[i] === "number" ? f(v[i]) : v[i]) + s[i + 1];
  return o;
};
const lin = (id, stops, x2 = 1, y2 = 0) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map(([off, c, op]) => `<stop offset="${off}" stop-color="${c}"${op === undefined ? "" : ` stop-opacity="${op}"`}/>`)
    .join("")}</linearGradient>`;
const url = (id) => `url(#${id})`;

// ---------- Inter advance widths (1/1000 em) at weight 300 and 900, interpolated for the weight in between
const GL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?-–—'\"“”«»·•/@%+−×()&‹›…_#№$€АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяӘәҒғҚқҢңӨөҰұҮүҺһІі";
const G3 = [673,649,728,719,595,588,744,740,262,567,647,564,900,759,759,628,759,634,632,636,736,673,966,662,666,622,549,602,559,602,580,345,603,589,233,234,528,233,873,588,593,602,602,359,516,298,589,556,815,531,556,542,618,394,614,606,629,580,602,560,611,602,281,282,282,282,292,282,500,453,500,1000,292,440,408,408,535,535,282,563,348,971,937,653,653,653,348,348,624,363,363,847,448,633,1086,632,673,673,639,649,577,816,595,595,932,606,759,759,655,754,900,740,759,740,628,728,636,609,817,662,705,695,941,953,809,853,642,728,1001,634,549,589,560,429,600,580,580,780,484,583,583,520,568,763,585,593,583,602,559,445,556,659,531,582,572,808,819,617,699,546,559,833,543,747,580,577,429,683,538,751,597,759,593,666,556,666,556,695,589,262,233];
const G9 = [795,668,748,723,613,584,754,750,291,596,759,565,956,770,775,656,787,668,666,687,722,795,1082,786,775,694,597,646,603,646,606,422,647,649,296,296,606,296,943,649,625,646,646,434,588,399,649,632,877,609,636,590,711,452,646,669,702,646,675,595,679,675,199,373,373,373,378,381,601,475,500,1000,372,625,625,610,726,726,373,398,412,1059,1044,693,693,693,388,388,695,471,471,1119,493,662,1110,666,700,795,647,668,586,910,613,613,1161,669,770,770,759,751,956,750,775,750,656,748,687,750,842,786,807,713,1016,1055,842,949,674,748,1066,668,597,623,587,467,701,606,606,910,541,649,649,618,628,848,649,625,635,646,603,548,636,854,609,706,621,892,931,708,866,616,604,888,598,750,606,586,467,808,662,789,688,775,625,775,632,775,632,713,649,291,296];
const GI = new Map([...GL].map((c, i) => [c, i]));

/** Width of a string in user units: font-size fs, weight wt, tracking ls (em). */
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
/** Largest font-size (<= maxFs) at which s fits in maxW. */
const fit = (s, wt, ls, maxW, maxFs) => Math.min(maxFs, maxW / tw(s, 1, wt, ls));

/** <text>; x is the anchor (centre by default); tracking is compensated so centred text is optically centred. */
function T(x, y, s, fs, fill, o = {}) {
  const { w = 500, ls = 0, a = "middle", op, rot } = o;
  const lp = ls * fs;
  const xx = a === "middle" ? x + lp / 2 : a === "end" ? x + lp : x;
  return el(
    "text",
    {
      x: xx, y, "font-size": fs, "font-weight": w, "letter-spacing": ls ? lp : null,
      "text-anchor": a === "start" ? null : a, fill, "fill-opacity": op,
      transform: rot ? `rotate(${rot} ${f(xx)} ${f(y)})` : null,
    },
    esc(s),
  );
}
/** Small caps line that is skipped when it would have to be set below ~3.6 units. */
function tag(x, y, s, fill, maxW, fs0 = 5.4, o = {}) {
  const fs = fit(s, o.w ?? 600, o.ls ?? 0.12, maxW, fs0);
  return fs < 3.6 ? "" : T(x, y, s, fs, fill, { w: 600, ls: 0.12, ...o });
}

// ---------- colour roles
const DK = "#17140f", LT = "#fffdf7";
const inkOn = (bg, dk = DK, lt = LT) => (contrast(bg, dk) >= contrast(bg, lt) ? dk : lt);
const cased = (s, m) => (m === "U" ? s.toUpperCase() : m === "L" ? s.toLowerCase() : s);
const PAL = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
const CAT = {
  warm: ["terracotta", "peach", "saffron", "roseClay", "cocoa", "dune"],
  cool: ["nordic", "mint", "lilac", "glacier", "sage", "skyPop"],
  dark: ["midnightCitrus", "graphiteEmerald", "noirGold", "deepPlum", "oceanNight", "ember", "chalk"],
  vivid: ["electricBerry", "limeVolt", "tangerine", "cobaltPink", "sunnyTeal", "hotCoral"],
  muted: ["dustyRose", "slateMist", "moss", "taupe", "fogLavender", "sandOlive"],
  graphic: ["inkPaper", "paperBlue", "boneBlack"],
  pastel: ["pastelHaze", "peachLow", "mintLow", "skyLow", "sandLow"],
};
const CATS = Object.keys(CAT);

const FORM_IDS = ["can", "bottle", "box", "pouch", "jar", "tube", "brick", "bag", "tin", "tall"];
const DESIGN_IDS = ["blocks", "stripes", "sun", "waves", "botanic", "word", "kraft", "premium", "playful", "minimal"];
const DESC = {
  can: ["Sparkling water", "Cold brew", "Lemon soda", "Oat drink", "Тау суы", "Лимонад", "Холодный кофе", "Алма шырыны"],
  bottle: ["Cold-pressed juice", "Olive oil", "Still water", "Яблочный сок", "Тау суы", "Craft soda", "Алма шырыны"],
  box: ["Green tea", "Herbal tea", "Oat flakes", "Чёрный чай", "Қара шай", "Мюсли", "Түнгі шай"],
  pouch: ["Granola", "Mixed nuts", "Dried fruit", "Гранола", "Жаңғақ қоспасы", "Жареный миндаль"],
  jar: ["Wild honey", "Berry jam", "Peanut butter", "Цветочный мёд", "Малиновое варенье", "Тау балы"],
  tube: ["Hand cream", "Face wash", "Sun care", "Крем для рук", "Қол кремі", "Night cream"],
  brick: ["Oat drink", "Whole milk", "Orange juice", "Овсяный напиток", "Сүт", "Яблочный сок"],
  bag: ["Single origin", "Dark roast", "Whole beans", "Кофе в зёрнах", "Кофе дәні", "Espresso blend"],
  tin: ["Night tea", "Түнгі шай", "Mint tablets", "Чёрный чай", "Shortbread", "Loose leaf"],
  tall: ["Salted crisps", "Rose tea", "Hot cocoa", "Какао", "Matcha", "Sea salt"],
};
const VOL = {
  can: ["330 ml", "250 ml", "0,33 l"], bottle: ["500 ml", "750 ml", "330 ml"], box: ["100 g", "20 bags", "250 g"],
  pouch: ["250 g", "400 g", "8.8 oz"], jar: ["350 g", "250 ml", "12 oz"], tube: ["75 ml", "50 ml", "100 ml"],
  brick: ["1 L", "500 ml", "1 l"], bag: ["340 g", "12 oz", "250 g"], tin: ["50 g", "100 g", "2 oz"], tall: ["150 g", "200 g", "5 oz"],
};
const CASES = { premium: ["U"], kraft: ["U"], word: ["U", "L"], minimal: ["T", "L"], playful: ["T", "L"], blocks: ["T", "U"], stripes: ["U", "T"], sun: ["U", "T"], waves: ["T", "U"], botanic: ["T", "U"] };

/** The season's pool plan: 32 slots {form, design, pal, cat, brand}. */
function planPack(season) {
  const r = mulberry32(hashStringToSeed(`${season}/pack/plan`));
  const forms = shuffle(r, FORM_IDS), designs = shuffle(r, DESIGN_IDS);
  const shifts = shuffle(r, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const slots = [];
  for (let b = 0; b < 4; b++) {
    const sh = b === 0 ? 0 : shifts[b - 1];
    slots.push(...shuffle(r, forms.map((form, j) => ({ form, design: designs[(j + sh) % 10] }))));
  }
  slots.length = 32;
  const cats = [];
  while (cats.length < 32) cats.push(...shuffle(r, CATS));
  const lists = {}, used = {};
  const brands = shuffle(r, BRAND_NAMES);
  slots.forEach((s, i) => {
    const cat = s.design === "premium" ? "dark" : cats[i];
    lists[cat] = lists[cat] ?? shuffle(r, CAT[cat]);
    used[cat] = (used[cat] ?? -1) + 1;
    s.pal = lists[cat][used[cat] % lists[cat].length];
    s.cat = cat;
    s.brand = brands[i % brands.length];
  });
  return slots;
}

const area = (x, y, w, h, t = 0, b = 0, l = 0, r = 0) => ({ x, y, w, h, cx: x + w / 2, sx: x + l, sy: y + t, sw: w - l - r, sh: h - t - b });

// =====================================================================================================
// PRINT DESIGNS: each paints a full-bleed background over the area, then its artwork, then the type.
// Returns { svg, defs?, base, acc, cols:[[hex, weight]..], n (elements), plain 0..1, bold -1..1, round -1..1 }.
// =====================================================================================================
const DESIGNS = {
  // bold colour blocking: three horizontal blocks, a vertical split with a rotated name, or a monogram disc
  blocks(g, A) {
    const { pal, r, v, dk, lt } = g;
    const [k1, k2, k3] = g.dark ? [pal.bg, pal.a, pal.b] : [pal.a, pal.surface, pal.b];
    const nm = cased(g.brand, g.cs), wt = pick(r, [800, 900]), d = g.desc.toUpperCase(), cx = A.cx;
    let s = "";
    if (v === 0) {
      const y1 = A.y + A.h * range(r, 0.48, 0.56), y2 = y1 + A.h * range(r, 0.2, 0.25), y3 = A.y + A.h;
      s += R(A.x, A.y, A.w, y1 - A.y, k1) + R(A.x, y1, A.w, y2 - y1, k2) + R(A.x, y2, A.w, y3 - y2, k3);
      const mh = y2 - y1, fs = Math.min(fit(nm, wt, -0.02, A.sw * 0.92, 40), mh * 0.56);
      s += T(cx, y1 + mh / 2 + fs * 0.36, nm, fs, inkOn(k2, dk, lt), { w: wt, ls: -0.02 });
      s += tag(cx, y2 + (y3 - y2) * 0.5 + 2, d, inkOn(k3, dk, lt), A.sw, 5.6, { ls: 0.14 });
      s += T(A.sx + 2, A.sy + 6, g.vol, 5, inkOn(k1, dk, lt), { w: 600, a: "start", op: 0.75 });
      s += C(A.sx + A.sw - 5, A.sy + 4, 3.2, k3);
      return { svg: s, base: k1, acc: k3, cols: [[k1, 5], [k2, 2.4], [k3, 2.4]], n: 6, plain: 0.55, bold: 0.85, round: -0.3 };
    }
    if (v === 1) {
      const sw = A.w * 0.38, rx = A.x + sw + (A.w - sw) / 2;
      s += R(A.x, A.y, A.w, A.h, k2) + R(A.x, A.y, sw, A.h, k1) + R(A.x + sw, A.y + A.h * 0.7, A.w - sw, A.h * 0.3, k3);
      const fs = Math.min(fit(nm, wt, 0, A.sh * 0.86, 60), sw * 0.62);
      s += T(A.x + sw * 0.5 + fs * 0.34, A.sy + A.sh * 0.5, nm, fs, inkOn(k1, dk, lt), { w: wt, rot: -90 });
      s += tag(rx, A.y + A.h * 0.2, d, inkOn(k2, dk, lt), (A.w - sw) * 0.86, 5.4, { ls: 0.1 });
      s += T(rx, A.y + A.h * 0.85 + 2, g.vol, 6, inkOn(k3, dk, lt), { w: 700, ls: 0.06 });
      s += C(rx, A.y + A.h * 0.42, (A.w - sw) * 0.2, k1);
      return { svg: s, base: k1, acc: k3, cols: [[k1, 4], [k2, 4], [k3, 1.4]], n: 7, plain: 0.6, bold: 0.8, round: -0.15 };
    }
    const yj = A.y + A.h * range(r, 0.5, 0.58), rr = Math.min(A.sw * 0.3, A.sh * 0.22);
    s += R(A.x, A.y, A.w, yj - A.y, k1) + R(A.x, yj, A.w, A.y + A.h - yj, k3) + C(cx, yj, rr, k2);
    s += T(cx, yj + rr * 0.4, nm[0].toUpperCase(), rr * 1.15, contrast(k1, k2) > 2.2 ? k1 : inkOn(k2, dk, lt), { w: 900 });
    const un = g.brand.toUpperCase(), fs2 = fit(un, 700, 0.2, A.sw * 0.92, 11);
    s += T(cx, yj + rr + (A.y + A.h - yj - rr) * 0.5 + fs2 * 0.2, un, fs2, inkOn(k3, dk, lt), { w: 700, ls: 0.2 });
    s += tag(cx, A.sy + 6, d, inkOn(k1, dk, lt), A.sw, 5.4, { op: 0.85 });
    return { svg: s, base: k1, acc: k3, cols: [[k1, 4], [k2, 1.5], [k3, 3.5]], n: 6, plain: 0.55, bold: 0.8, round: 0.2 };
  },

  // stripes: awning bands + a central panel, a three-stripe racing band, or candy vertical stripes + a pill
  stripes(g, A) {
    const { pal, r, v, dk, lt } = g;
    const base = g.dark ? pal.bg : pal.surface, c1 = pal.a, c2 = pal.b, c3 = pal.ink, cx = A.cx;
    const nm = cased(g.brand, g.cs), d = g.desc.toUpperCase();
    let s = R(A.x, A.y, A.w, A.h, base);
    if (v === 0) {
      const N = pick(r, [9, 11, 13]), bh = A.h / N;
      for (let i = 0; i < N; i += 2) s += R(A.x, A.y + i * bh, A.w, bh + 0.4, c1);
      const ph = A.sh * 0.34, py = A.sy + A.sh * 0.5 - ph / 2;
      s += R(A.x, py, A.w, ph, base) + R(A.x, py, A.w, 1.2, c3) + R(A.x, py + ph - 1.2, A.w, 1.2, c3);
      const fs = Math.min(fit(nm, 800, -0.01, A.sw * 0.92, 30), ph * 0.42);
      s += T(cx, py + ph * 0.5 + fs * 0.1, nm, fs, c3, { w: 800, ls: -0.01 });
      s += tag(cx, py + ph - 4.6, d, c3, A.sw, 4.6, { ls: 0.16 });
      return { svg: s, base: c1, acc: c2, cols: [[c1, 4], [base, 4], [c3, 0.6]], n: 4 + N / 2, plain: 0.4, bold: 0.45, round: -0.7 };
    }
    if (v === 1) {
      const fs = Math.min(fit(nm, 700, 0.04, A.sw * 0.9, 22), A.sh * 0.17);
      s += T(cx, A.sy + A.sh * 0.3, nm, fs, inkOn(base, dk, lt), { w: 700, ls: 0.04 });
      const t = A.sh * 0.055, y0 = A.sy + A.sh * 0.46;
      [c1, c2, c3].forEach((c, i) => { s += R(A.x, y0 + i * t * 1.7, A.w, t, c); });
      s += tag(cx, y0 + t * 5.4 + 8, d, inkOn(base, dk, lt), A.sw, 5.6, { ls: 0.16 });
      s += T(cx, A.sy + A.sh - 2, g.vol, 5, inkOn(base, dk, lt), { w: 600, op: 0.7 });
      return { svg: s, base, acc: c1, cols: [[base, 5], [c1, 1.2], [c2, 1.2], [c3, 1.2]], n: 8, plain: 0.55, bold: 0.35, round: -0.6 };
    }
    const N = pick(r, [7, 9]), bw = A.w / N;
    for (let i = 0; i < N; i += 2) s += R(A.x + i * bw, A.y, bw + 0.4, A.h, c1);
    const ph = Math.min(A.sh * 0.3, 40), py = A.sy + A.sh * 0.5 - ph / 2, pw = A.sw * 1.0;
    s += R(cx - pw / 2, py, pw, ph, base, { rx: ph / 2 });
    const fs = Math.min(fit(nm, 800, 0, pw * 0.74, 28), ph * 0.42);
    s += T(cx, py + ph * 0.5 + fs * 0.1, nm, fs, c3, { w: 800 });
    s += tag(cx, py + ph - 5.4, d, c3, pw * 0.7, 4.4, { ls: 0.14 });
    return { svg: s, base: c1, acc: c2, cols: [[c1, 3], [base, 3]], n: 6 + N / 2, plain: 0.35, bold: 0.5, round: -0.1 };
  },

  // sun: a retro slatted sun over a horizon band, a landscape with hills, or concentric rainbow arcs
  sun(g, A) {
    const { pal, r, v, dk, lt } = g, cx = A.cx;
    const nm = cased(g.brand, g.cs), d = g.desc.toUpperCase();
    const base = g.dark ? pal.bg : pal.surface, c1 = pal.a, c2 = g.dark ? pal.b : pal.ink;
    let s = "";
    if (v === 0) {
      s += R(A.x, A.y, A.w, A.h, base);
      const rs = Math.min(A.sw * 0.34, A.sh * 0.23), cy = A.sy + A.sh * 0.33, hy = A.sy + A.sh * 0.62;
      s += C(cx, cy, rs, c1);
      for (let k = 0; k < 4; k++) s += R(cx - rs - 1, cy + rs * (0.02 + k * 0.26), rs * 2 + 2, 1 + k * 1.15, base);
      s += R(A.x, hy, A.w, A.y + A.h - hy, c2);
      const fs = Math.min(fit(nm, 800, 0.02, A.sw * 0.9, 24), (A.y + A.h - hy) * 0.34);
      s += T(cx, hy + (A.y + A.h - hy) * 0.36 + fs * 0.3, nm, fs, inkOn(c2, dk, lt), { w: 800, ls: 0.02 });
      s += tag(cx, A.sy + 5, d, inkOn(base, dk, lt), A.sw, 5, { ls: 0.16, op: 0.8 });
      return { svg: s, base, acc: c1, cols: [[base, 4], [c1, 1.6], [c2, 2.2]], n: 10, plain: 0.5, bold: 0.5, round: 0.65 };
    }
    if (v === 1) {
      const sky = mix(pal.b, g.dark ? pal.bg : "#ffffff", g.dark ? 0.55 : 0.6), h1 = mix(c1, "#000", 0.28), h2 = g.dark ? pal.surface : mix(pal.ink, c1, 0.2);
      s += R(A.x, A.y, A.w, A.h, sky);
      const rs = A.sw * 0.2, cy = A.sy + A.sh * 0.34;
      s += C(cx + A.sw * 0.16, cy, rs, c1);
      const by = A.y + A.h;
      s += P(pth`M${A.x} ${by}V${A.sy + A.sh * 0.66}C${A.x + A.w * 0.25} ${A.sy + A.sh * 0.52} ${A.x + A.w * 0.5} ${A.sy + A.sh * 0.6} ${A.x + A.w * 0.62} ${A.sy + A.sh * 0.68}S${A.x + A.w * 0.9} ${A.sy + A.sh * 0.6} ${A.x + A.w} ${A.sy + A.sh * 0.58}V${by}Z`, h1);
      s += P(pth`M${A.x} ${by}V${A.sy + A.sh * 0.8}C${A.x + A.w * 0.3} ${A.sy + A.sh * 0.7} ${A.x + A.w * 0.6} ${A.sy + A.sh * 0.84} ${A.x + A.w} ${A.sy + A.sh * 0.74}V${by}Z`, h2);
      const fs = fit(nm, 800, 0.02, A.sw * 0.9, 22);
      s += T(cx, A.sy + A.sh * 0.14 + fs * 0.3, nm, fs, inkOn(sky, dk, lt), { w: 800, ls: 0.02 });
      s += tag(cx, A.sy + A.sh * 0.93, d, inkOn(h2, dk, lt), A.sw, 5, { ls: 0.16 });
      return { svg: s, base: sky, acc: c1, cols: [[sky, 3], [c1, 1], [h1, 2], [h2, 2.4]], n: 7, plain: 0.4, bold: 0.35, round: 0.5 };
    }
    const bg = pick(r, [pal.surface, pal.bg]), cols = [c1, pal.b, mix(c1, bg, 0.5)];
    s += R(A.x, A.y, A.w, A.h, bg);
    const R0 = Math.min(A.sw * 0.5, A.sh * 0.32), by = A.sy + A.sh * 0.66, tk = R0 / 3.4;
    for (let k = 0; k < 3; k++) s += P(pth`M${cx - R0 + k * tk} ${by}A${R0 - k * tk} ${R0 - k * tk} 0 0 1 ${cx + R0 - k * tk} ${by}Z`, cols[k]);
    const fs = fit(nm, 800, 0.02, A.sw * 0.92, 24);
    s += T(cx, by + (A.y + A.h - by) * 0.45 + fs * 0.3, nm, fs, inkOn(bg, dk, lt), { w: 800, ls: 0.02 });
    s += tag(cx, A.sy + 5, d, inkOn(bg, dk, lt), A.sw, 5, { ls: 0.16, op: 0.8 });
    return { svg: s, base: bg, acc: c1, cols: [[bg, 4], [c1, 2], [pal.b, 1.4], [cols[2], 1]], n: 7, plain: 0.5, bold: 0.45, round: 0.8 };
  },

  // waves: light wave lines on colour, or layered wave bands
  waves(g, A) {
    const { pal, r, v, dk, lt } = g, cx = A.cx;
    const nm = cased(g.brand, g.cs), d = g.desc.toUpperCase();
    const wave = (x0, x1, y, amp, lam, sw, col, op) => {
      let dd = pth`M${x0} ${y}Q${x0 + lam / 4} ${y - amp * 2} ${x0 + lam / 2} ${y}`;
      for (let x = x0 + lam; x < x1 + lam / 2; x += lam / 2) dd += pth`T${x} ${y}`;
      return P(dd, "none", { stroke: col, "stroke-width": sw, "stroke-linecap": "round", opacity: op });
    };
    if (v_(g) === 0) {
      const base = g.dark ? pal.bg : pal.a, line = g.dark ? pal.a : inkOn(base, dk, lt), l2 = pal.b;
      let s = R(A.x, A.y, A.w, A.h, base);
      const nL = 6, y0 = A.sy + A.sh * 0.5, gap = A.sh * 0.085, lam = A.w / pick(r, [3, 4]) ;
      for (let i = 0; i < nL; i++) s += wave(A.x - lam / 2, A.x + A.w + lam, y0 + i * gap, 3 + i * 0.25, lam, 1.7, i % 2 ? l2 : line, 1 - i * 0.08);
      const fs = fit(nm, 800, 0.0, A.sw * 0.9, 24);
      s += T(cx, A.sy + A.sh * 0.26 + fs * 0.3, nm, fs, inkOn(base, dk, lt), { w: 800 });
      s += tag(cx, A.sy + A.sh * 0.26 + fs * 0.3 + 9, d, inkOn(base, dk, lt), A.sw, 5, { ls: 0.16, op: 0.85 });
      return { svg: s, base, acc: l2, cols: [[base, 5], [line, 1.2], [l2, 1]], n: 10, plain: 0.35, bold: 0.1, round: 0.85 };
    }
    const base = g.dark ? pal.bg : pal.surface, w1 = pal.a, w2 = pal.b, w3 = g.dark ? pal.surface : pal.ink;
    let s = R(A.x, A.y, A.w, A.h, base);
    const by = A.y + A.h, lam = A.w / pick(r, [2, 3]);
    [[0.58, w2, 5], [0.68, w1, 4.5], [0.8, w3, 3.5]].forEach(([yy, c, amp]) => {
      const y = A.sy + A.sh * yy;
      let dd = pth`M${A.x - lam} ${y}Q${A.x - lam * 0.75} ${y - amp * 2} ${A.x - lam / 2} ${y}`;
      for (let x = A.x; x < A.x + A.w + lam; x += lam / 2) dd += pth`T${x} ${y}`;
      s += P(dd + pth`V${by}H${A.x - lam}Z`, c);
    });
    const fs = fit(nm, 800, 0.0, A.sw * 0.9, 24);
    s += T(cx, A.sy + A.sh * 0.2 + fs * 0.3, nm, fs, inkOn(base, dk, lt), { w: 800 });
    s += tag(cx, A.sy + A.sh * 0.2 + fs * 0.3 + 9, d, inkOn(base, dk, lt), A.sw, 5, { ls: 0.16, op: 0.8 });
    s += tag(cx, A.sy + A.sh * 0.93, g.vol, inkOn(w3, dk, lt), A.sw, 5, { ls: 0.08 });
    return { svg: s, base, acc: w1, cols: [[base, 3], [w2, 1.6], [w1, 1.6], [w3, 1.6]], n: 8, plain: 0.45, bold: 0.1, round: 0.9 };
  },
};
const v_ = (g) => g.v % 2;

export function build(rand, ctx) {
  return { name: "pack", svg: svgRoot(W, H, ""), traits: {} };
}
