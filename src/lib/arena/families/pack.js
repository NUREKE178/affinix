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
    if (v % 2 === 0) {
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

  // botanic: a leaf sprig, a staggered leaf pattern with a name pill, or a fan of big leaves
  botanic(g, A) {
    const { pal, r, v, dk, lt, id } = g, cx = A.cx;
    const nm = cased(g.brand, g.cs), d = g.desc.toUpperCase(), lf = `${id}-lf`;
    const defs = `<path id="${lf}" d="M0 0C5-6 9-17 0-30C-9-17-5-6 0 0Z"/>`;
    const use = (x, y, rot, sc, fill, op) => el("use", { href: `#${lf}`, transform: `translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc)})`, fill, opacity: op });
    if (v === 0) {
      const base = g.dark ? pal.bg : pal.surface, lc = pal.a, st = g.dark ? mix(pal.a, pal.bg, 0.45) : mix(pal.a, "#000", 0.35);
      let s = R(A.x, A.y, A.w, A.h, base);
      const yb = A.sy + A.sh * 0.68, yt = A.sy + A.sh * 0.07, N = 5, k = A.sw / 62;
      s += P(pth`M${cx} ${yb}Q${cx + 5} ${(yb + yt) / 2} ${cx - 1} ${yt + 8}`, "none", { stroke: st, "stroke-width": 1.1, "stroke-linecap": "round" });
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), y = yb - (yb - yt - 12) * (0.04 + 0.92 * t), sc = k * (1.05 - t * 0.5), ang = 58 - t * 24;
        s += use(cx + 0.5 * t, y, -ang, sc, lc) + use(cx + 0.5 * t, y, ang, sc, mix(lc, base, 0.28));
      }
      s += use(cx - 1, yt + 10, 0, k * 0.55, lc);
      const fs = fit(nm, 700, 0.02, A.sw * 0.9, 20);
      s += T(cx, A.sy + A.sh * 0.84 + fs * 0.2, nm, fs, inkOn(base, dk, lt), { w: 700, ls: 0.02 });
      s += tag(cx, A.sy + A.sh * 0.84 + fs * 0.2 + 7.5, d, inkOn(base, dk, lt), A.sw, 4.8, { ls: 0.16, op: 0.8 });
      return { svg: s, defs, base, acc: lc, cols: [[base, 5], [lc, 2]], n: 14, plain: 0.5, bold: -0.1, round: 0.5 };
    }
    if (v === 1) {
      const base = g.dark ? pal.bg : pal.a, lcs = g.dark ? [pal.a, mix(pal.a, pal.bg, 0.5), pal.b] : [pal.surface, pal.b, mix(pal.a, "#000", 0.3)];
      let s = R(A.x, A.y, A.w, A.h, base);
      const cols = 3, cs = A.w / cols, rows = Math.ceil(A.h / (cs * 0.8)) + 1;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols + 1; i++) {
          const x = A.x + (i - (j % 2 ? 0.0 : 0.5)) * cs + cs * 0.25, y = A.y + j * cs * 0.8 + 12;
          s += use(x, y, (j + i) % 2 ? 28 : -28 + (j % 3) * 10, cs / 36, lcs[(i + j * 2) % 3]);
        }
      const ph = Math.min(A.sh * 0.3, 36), py = A.sy + A.sh * 0.5 - ph / 2, pw = A.sw * 0.98, pc = g.dark ? pal.surface : pal.surface;
      s += R(cx - pw / 2, py, pw, ph, pc, { rx: ph / 2 });
      const fs = Math.min(fit(nm, 800, 0.0, pw * 0.74, 22), ph * 0.42);
      s += T(cx, py + ph * 0.5 + fs * 0.12, nm, fs, inkOn(pc, dk, lt), { w: 800 });
      s += tag(cx, py + ph - 5.2, d, inkOn(pc, dk, lt), pw * 0.7, 4.2, { ls: 0.14, op: 0.8 });
      return { svg: s, defs, base, acc: lcs[1], cols: [[base, 4], [lcs[0], 1.5], [lcs[1], 1.2], [lcs[2], 1.2]], n: 7 + rows * (cols + 1), plain: 0.1, bold: 0.2, round: 0.45 };
    }
    const base = g.dark ? pal.bg : pal.bg, c1 = pal.a, c2 = mix(pal.a, pal.b, 0.5), c3 = pal.b;
    let s = R(A.x, A.y, A.w, A.h, base);
    const k = A.sh / 44, bx = A.sx + A.sw * 0.38, by = A.sy + A.sh * 0.93;
    s += use(bx, by, -42, k, c3, 0.9) + use(bx, by, 36, k * 0.92, c2, 0.95) + use(bx, by, -6, k * 1.04, c1) + use(bx, by, 62, k * 0.7, c1, 0.7);
    const fs = fit(nm, 800, 0.0, A.sw * 0.9, 22);
    s += T(cx, A.sy + A.sh * 0.1 + fs * 0.7, nm, fs, inkOn(base, dk, lt), { w: 800 });
    s += tag(cx, A.sy + A.sh * 0.1 + fs * 0.7 + 8, d, inkOn(base, dk, lt), A.sw, 4.8, { ls: 0.16, op: 0.8 });
    return { svg: s, defs, base, acc: c1, cols: [[base, 4], [c1, 1.6], [c2, 1.2], [c3, 1.2]], n: 8, plain: 0.45, bold: 0.15, round: 0.6 };
  },

  // word: pure typography: a rotated wordmark, stacked letters, or one giant line between hairlines
  word(g, A) {
    const { pal, r, v, dk, lt } = g, cx = A.cx;
    const base = pick(r, g.dark ? [pal.bg, pal.a] : [pal.a, pal.ink, pal.a]), fg = inkOn(base, dk, lt);
    const acc0 = base === pal.a ? pal.b : pal.a, acc = contrast(acc0, base) > 1.5 ? acc0 : fg;
    const wt = pick(r, [900, 800, 300]), nm = chance(r, 0.55) ? g.brand.toUpperCase() : g.brand.toLowerCase(), d = g.desc.toUpperCase();
    let s = R(A.x, A.y, A.w, A.h, base);
    const L = [...nm], vv = v === 1 && L.length > 6 ? 2 : v, boldv = (wt - 550) / 450;
    if (vv === 0) {
      const fs = Math.min(fit(nm, wt, -0.02, A.sh * 0.88, 70), A.sw * 0.58);
      s += T(A.sx + fs * 0.84, A.sy + A.sh * 0.5, nm, fs, fg, { w: wt, ls: -0.02, rot: -90 });
      s += tag(A.sx + A.sw, A.sy + A.sh - 2, d, fg, A.sw * 0.42, 4.6, { a: "end", ls: 0.1, op: 0.85 });
      s += C(A.sx + A.sw - 4, A.sy + 5, 2.8, acc);
      return { svg: s, base, acc, cols: [[base, 6], [acc, 0.4]], n: 4, plain: 0.45, bold: boldv, round: -0.1 };
    }
    if (vv === 1) {
      const fs = Math.min((A.sh * 0.8) / (L.length * 0.82), A.sw * 0.8), lp = fs * 0.82;
      L.forEach((c, i) => { s += T(A.sx, A.sy + fs * 0.76 + i * lp, c, fs, i === L.length - 1 ? acc : fg, { w: wt, a: "start", ls: -0.02 }); });
      s += tag(A.sx, A.sy + A.sh - 2, d, fg, A.sw, 4.8, { a: "start", ls: 0.12, op: 0.85 });
      return { svg: s, base, acc, cols: [[base, 6], [fg, 1], [acc, 0.4]], n: 3 + L.length, plain: 0.4, bold: boldv, round: -0.1 };
    }
    const fs = fit(nm, wt, -0.04, A.sw * 0.98, 44), yc = A.sy + A.sh * 0.46, cap = fs * 0.73;
    s += R(A.sx, yc - cap / 2 - 6, A.sw, 0.9, fg, { opacity: 0.7 }) + R(A.sx, yc + cap / 2 + 6, A.sw, 0.9, fg, { opacity: 0.7 });
    s += T(cx, yc + cap / 2, nm, fs, fg, { w: wt, ls: -0.04 });
    s += tag(cx, yc + cap / 2 + 15, d, fg, A.sw, 5, { ls: 0.18, op: 0.85 });
    s += T(cx, A.sy + A.sh - 2, g.vol, 4.8, fg, { w: 600, op: 0.65 });
    return { svg: s, base, acc, cols: [[base, 6], [fg, 0.6]], n: 6, plain: 0.55, bold: boldv, round: -0.2 };
  },

  // kraft: kraft paper, ink rules, a rotated rubber stamp
  kraft(g, A) {
    const { r } = g, cx = A.cx;
    const kr = pick(r, ["#c8a679", "#cdb08a", "#bf9d70", "#d3b78f"]), ink = "#2a2118", st = pick(r, ["#a23b25", "#2f4f6a", "#2a2118", "#3f5a3a"]);
    const nm = g.brand.toUpperCase(), d = g.desc.toUpperCase();
    let s = R(A.x, A.y, A.w, A.h, kr);
    s += R(A.sx, A.sy, A.sw, A.sh, "none", { stroke: ink, "stroke-width": 0.9 }) + R(A.sx + 2.6, A.sy + 2.6, A.sw - 5.2, A.sh - 5.2, "none", { stroke: ink, "stroke-width": 0.4 });
    const fs = Math.min(fit(nm, 800, 0.14, A.sw * 0.74, 15), A.sh * 0.14), y1 = A.sy + A.sh * 0.32, ry = y1 + 8;
    s += T(cx, y1, nm, fs, ink, { w: 800, ls: 0.14 });
    s += Ln(cx - A.sw * 0.3, ry, cx - 4, ry, ink, 0.6) + Ln(cx + 4, ry, cx + A.sw * 0.3, ry, ink, 0.6) + P(pth`M${cx} ${ry - 2.2}L${cx + 2.2} ${ry}L${cx} ${ry + 2.2}L${cx - 2.2} ${ry}Z`, ink);
    s += tag(cx, ry + 10, d, ink, A.sw * 0.8, 5.2, { ls: 0.2 });
    const sr = clamp(A.sw * 0.2, 9, 16), sx = A.sx + A.sw * 0.68, sy = A.sy + A.sh * 0.8;
    s += `<g transform="rotate(-12 ${f(sx)} ${f(sy)})" opacity=".92">` + C(sx, sy, sr, "none", { stroke: st, "stroke-width": 1.1 }) + C(sx, sy, sr - 2.2, "none", { stroke: st, "stroke-width": 0.5 }) +
      T(sx, sy - sr * 0.34, "SMALL", sr * 0.26, st, { w: 700, ls: 0.1 }) + T(sx, sy + sr * 0.22, "N° 07", sr * 0.6, st, { w: 800 }) + T(sx, sy + sr * 0.62, "BATCH", sr * 0.26, st, { w: 700, ls: 0.1 }) + "</g>";
    s += T(A.sx + 5, A.sy + A.sh - 6, "NET " + g.vol, 4.2, ink, { w: 600, a: "start", op: 0.8 });
    return { svg: s, base: kr, acc: st, cols: [[kr, 7], [st, 0.5], [ink, 0.8]], n: 13, plain: 0.55, bold: 0.15, round: 0.1 };
  },

  // premium: near-black with a foil (gold / silver / rose) frame, crest and letter-spaced name
  premium(g, A) {
    const { pal, r, id } = g, cx = A.cx;
    const base = g.dark ? pal.bg : lightness(pal.ink) < 28 ? pal.ink : darken(pal.a, 0.78);
    const FO = pick(r, [["#8a6a2b", "#f6e1a0", "#b98e3e", "#6f5220"], ["#868d96", "#f4f6f8", "#aeb5bd", "#656c75"], ["#9a5b46", "#f3c6ae", "#c98a6c", "#7d4634"]]);
    const fid = `${id}-f`, fu = url(fid), wt = pick(r, [300, 400, 500]);
    const defs = lin(fid, [[0, FO[0]], [0.35, FO[1]], [0.62, FO[2]], [1, FO[3]]], 1, 1);
    const nm = g.brand.toUpperCase(), d = g.desc.toUpperCase();
    let s = R(A.x, A.y, A.w, A.h, base);
    s += R(A.sx, A.sy, A.sw, A.sh, "none", { stroke: fu, "stroke-width": 0.8 }) + R(A.sx + 3, A.sy + 3, A.sw - 6, A.sh - 6, "none", { stroke: fu, "stroke-width": 0.4, opacity: 0.7 });
    const ey = A.sy + A.sh * 0.25;
    s += C(cx, ey, 6, "none", { stroke: fu, "stroke-width": 0.8 }) + P(pth`M${cx} ${ey - 3.2}L${cx + 3.2} ${ey}L${cx} ${ey + 3.2}L${cx - 3.2} ${ey}Z`, fu);
    s += Ln(cx - A.sw * 0.34, ey, cx - 9, ey, fu, 0.5) + Ln(cx + 9, ey, cx + A.sw * 0.34, ey, fu, 0.5);
    const fs = fit(nm, wt, 0.24, A.sw * 0.8, 13), ny = A.sy + A.sh * 0.52;
    s += T(cx, ny, nm, fs, fu, { w: wt, ls: 0.24 });
    s += Ln(cx - 8, ny + 7, cx + 8, ny + 7, fu, 0.5);
    s += tag(cx, ny + 15, d, fu, A.sw * 0.84, 4.8, { w: 500, ls: 0.28 });
    s += T(cx, A.sy + A.sh - 8, "EST. 2024", 4, fu, { w: 500, ls: 0.3, op: 0.8 });
    return { svg: s, defs, base, acc: FO[2], cols: [[base, 8], [FO[2], 0.7]], n: 13, plain: 0.72, bold: -0.45, round: -0.1 };
  },

  // playful: a Memphis-style grid of simple shapes under a name pill
  playful(g, A) {
    const { pal, r, dk, lt } = g, cx = A.cx;
    const hh = hexToHsl(pal.a)[0];
    const pop = [pal.a, pal.b, hsl(hh + 140, 0.7, 0.58), hsl(hh + 215, 0.7, 0.6)];
    const base = pick(r, g.dark ? [pal.bg, pal.surface] : [pal.surface, mix(pal.b, "#fff", 0.55), pal.bg]);
    const nm = cased(g.brand, g.cs), d = g.desc.toUpperCase();
    let s = R(A.x, A.y, A.w, A.h, base), n = 4;
    const cols = Math.max(3, Math.round(A.sw / 20)), cs = A.w / cols, rows = Math.ceil(A.h / cs);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = A.x + (i + 0.5) * cs, y = A.y + (j + 0.5) * cs, k = Math.floor(r() * 8), col = pop[Math.floor(r() * 4)], rot = 90 * Math.floor(r() * 4);
        const tr = rot ? { transform: `rotate(${rot} ${f(x)} ${f(y)})` } : {};
        n++;
        if (k === 0) s += C(x, y, cs * 0.34, col);
        else if (k === 1) s += C(x, y, cs * 0.27, "none", { stroke: col, "stroke-width": cs * 0.13 });
        else if (k === 2) s += P(pth`M${x - cs * 0.36} ${y + cs * 0.18}A${cs * 0.36} ${cs * 0.36} 0 0 1 ${x + cs * 0.36} ${y + cs * 0.18}Z`, col, tr);
        else if (k === 3) s += P(pth`M${x - cs * 0.3} ${y + cs * 0.3}V${y - cs * 0.3}A${cs * 0.6} ${cs * 0.6} 0 0 1 ${x + cs * 0.3} ${y + cs * 0.3}Z`, col, tr);
        else if (k === 4) s += P(pth`M${x} ${y - cs * 0.34}L${x + cs * 0.33} ${y + cs * 0.27}H${x - cs * 0.33}Z`, col, tr);
        else if (k === 5) s += P(pth`M${x - cs * 0.34} ${y}H${x + cs * 0.34}M${x} ${y - cs * 0.34}V${y + cs * 0.34}`, "none", { stroke: col, "stroke-width": cs * 0.14 });
        else if (k === 6) s += P(pth`M${x - cs * 0.36} ${y}Q${x - cs * 0.18} ${y - cs * 0.34} ${x} ${y}T${x + cs * 0.36} ${y}`, "none", { stroke: col, "stroke-width": cs * 0.13, "stroke-linecap": "round" });
        else s += P(pth`M${x} ${y - cs * 0.3}L${x + cs * 0.3} ${y}L${x} ${y + cs * 0.3}L${x - cs * 0.3} ${y}Z`, col);
      }
    const ph = Math.min(A.sh * 0.3, 38), py = A.sy + A.sh * 0.5 - ph / 2, pw = A.sw * 0.98, pc = g.dark ? pal.ink : "#fffdf7";
    s += R(cx - pw / 2, py, pw, ph, pc, { rx: ph / 2 });
    const fs = Math.min(fit(nm, 800, -0.01, pw * 0.74, 24), ph * 0.44);
    s += T(cx, py + ph * 0.5 + fs * 0.1, nm, fs, g.dark ? pal.bg : pal.ink, { w: 800, ls: -0.01 });
    s += tag(cx, py + ph - 5.2, d, g.dark ? pal.bg : pal.ink, pw * 0.7, 4.2, { ls: 0.14, op: 0.8 });
    return { svg: s, base, acc: pal.a, cols: [[base, 3], [pop[0], 1.1], [pop[1], 1.1], [pop[2], 1.1], [pop[3], 1.1], [pc, 1]], n, plain: 0.08, bold: 0.7, round: 0.1 };
  },

  // minimal: off-white, one accent, quiet type
  minimal(g, A) {
    const { pal, r, v } = g, cx = A.cx;
    const base = g.dark ? pal.bg : mix("#fbfaf6", pal.bg, 0.3), ink = pal.ink, acc = pal.a, mute = mix(ink, base, 0.5);
    const nm = cased(g.brand, g.cs), d = g.desc;
    let s = R(A.x, A.y, A.w, A.h, base);
    if (v !== 1) {
      const fs = Math.min(fit(nm, 600, -0.01, A.sw * 0.92, 20), A.sh * 0.18), x = A.sx + 3, ny = A.sy + A.sh * 0.6;
      s += C(x + 3.5, A.sy + 9, Math.max(3, A.sw * 0.055), acc);
      s += T(x, ny, nm, fs, ink, { w: 600, ls: -0.01, a: "start" });
      s += tag(x, ny + 9, d, mute, A.sw * 0.92, 6, { w: 500, ls: 0.02, a: "start" });
      s += T(x, A.sy + A.sh - 3, g.vol, 4.8, mute, { w: 500, a: "start" });
      s += R(A.x, A.y + A.h - 4.5, A.w, 4.5, acc);
    } else {
      const fs = Math.min(fit(nm, 500, 0.04, A.sw * 0.84, 18), A.sh * 0.16), ny = A.sy + A.sh * 0.46;
      s += T(cx, ny, nm, fs, ink, { w: 500, ls: 0.04 });
      s += R(cx - 5, ny + 7, 10, 1.6, acc);
      s += tag(cx, ny + 17, d, mute, A.sw * 0.9, 5.6, { w: 500, ls: 0.06 });
      s += T(cx, A.sy + A.sh - 3, g.vol, 4.6, mute, { w: 500 });
    }
    return { svg: s, base, acc, cols: [[base, 8], [acc, 0.7], [ink, 0.5]], n: 5, plain: 0.82, bold: -0.7, round: 0.15 };
  },
};

// =====================================================================================================
// FORMS: silhouette + accessories + lighting (from the top-left). Each calls g.art(area) for its print.
// Returns { svg, defs, d, cx, gy, w, h, round 0..1, detail (element count) }.
// =====================================================================================================
const gyFor = (h) => clamp(226 - Math.max(0, 168 - h) * 0.3, 196, 226);
const SHADE = {
  cyl: (id) => lin(`${id}-s`, [[0, "#000", 0.3], [0.07, "#000", 0.1], [0.15, "#fff", 0.02], [0.24, "#fff", 0.34], [0.31, "#fff", 0.04], [0.62, "#000", 0], [0.9, "#000", 0.22], [0.95, "#fff", 0.06], [1, "#000", 0.34]]),
  soft: (id) => lin(`${id}-s`, [[0, "#000", 0.14], [0.1, "#fff", 0.06], [0.2, "#fff", 0.2], [0.34, "#fff", 0.04], [0.7, "#000", 0], [0.95, "#000", 0.16], [1, "#000", 0.24]]),
  flat: (id) => lin(`${id}-s`, [[0, "#fff", 0.16], [0.5, "#fff", 0.02], [1, "#000", 0.12]], 0.35, 1),
};
const METAL = (id) => lin(`${id}-m`, [[0, "#8f959d"], [0.22, "#eef1f4"], [0.46, "#c4c9cf"], [0.8, "#a4aab2"], [1, "#7e848c"]]);
const RIDGE = (id, h = 4) => `<pattern id="${id}-rg" width="3.4" height="${h}" patternUnits="userSpaceOnUse"><rect width=".9" height="${h}" fill="#000" fill-opacity=".16"/></pattern>`;
const CRIMP = (id) => `<pattern id="${id}-cr" width="4" height="2.6" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".13"/></pattern>`;
/** An accessory colour (cap / lid) that stands apart from the print. */
const capCol = (g, d, pool) => {
  const c = pick(g.r, pool);
  return contrast(c, d.base) < 1.35 ? inkOn(d.base, "#1c1c20", "#f4f2ec") : c;
};

const FORMS = {
  can(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 76, 90)), h = Math.round(range(r, 146, 168)), x0 = CX - w / 2, xr = x0 + w, gy = 226, yt = gy - h;
    const sil = pth`M${x0 + 8} ${yt + 6}H${xr - 8}C${xr - 5} ${yt + 14} ${xr} ${yt + 14} ${xr} ${yt + 28}V${gy - 20}C${xr} ${gy - 11} ${xr - 4} ${gy - 9} ${xr - 6} ${gy - 5}H${x0 + 6}C${x0 + 4} ${gy - 9} ${x0} ${gy - 11} ${x0} ${gy - 20}V${yt + 28}C${x0} ${yt + 14} ${x0 + 5} ${yt + 14} ${x0 + 8} ${yt + 6}Z`;
    const d = g.art(area(x0, yt, w, h, 36, 28, w * 0.08, w * 0.08));
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + SHADE.cyl(id) + METAL(id);
    let s = `<g clip-path="url(#${id}-c)">${R(x0, yt, w, h, d.base)}${d.svg}${R(x0, yt, w, h, url(`${id}-s`))}</g>`;
    s += R(x0 + 6, gy - 6, w - 12, 6, url(`${id}-m`), { rx: 2.5 });
    s += E(CX, yt + 5, (w - 14) / 2, 4.6, url(`${id}-m`)) + E(CX, yt + 5.4, (w - 22) / 2, 2.5, "#000", { "fill-opacity": 0.12 }) + R(CX - 5, yt + 3.6, 10, 3, "#e9ecef", { rx: 1.5 });
    return { svg: s, defs, d, cx: CX, gy, w, h, round: 0.65, detail: 6 };
  },

  bottle(g) {
    const { r, id, pal } = g;
    const w = Math.round(range(r, 58, 68)), h = Math.round(range(r, 172, 186)), nw = 17, x0 = CX - w / 2, xr = x0 + w, gy = 226, yt = gy - h;
    const sil = pth`M${CX - nw / 2} ${yt + 13}H${CX + nw / 2}V${yt + 54}C${CX + nw / 2} ${yt + 76} ${xr} ${yt + 70} ${xr} ${yt + 104}V${gy - 9}Q${xr} ${gy} ${xr - 9} ${gy}H${x0 + 9}Q${x0} ${gy} ${x0} ${gy - 9}V${yt + 104}C${x0} ${yt + 70} ${CX - nw / 2} ${yt + 76} ${CX - nw / 2} ${yt + 54}Z`;
    const ly = yt + 110, lh = h - 110 - 26, d = g.art(area(x0, ly, w, lh, 5, 5, 6, 6));
    const clear = chance(r, 0.4), glass = pick(r, ["#7a4a1f", "#35603f", "#2f5f86", "#1b1c21"]), liquid = mix(pal.a, "#ffffff", 0.12);
    const cap = capCol(g, d, [d.acc, "#d8dce1", "#1c1c20"]);
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath><clipPath id="${id}-l">${R(x0, ly, w, lh)}</clipPath>` + SHADE.cyl(id) + RIDGE(id, 14);
    let s = `<g clip-path="url(#${id}-c)">`;
    s += clear ? P(sil, "#fff", { opacity: 0.3 }) + R(x0, yt + 60, w, h - 60, liquid) + R(x0, yt + 60, w, 1.2, "#fff", { opacity: 0.4 }) : P(sil, glass);
    s += `<g clip-path="url(#${id}-l)">${d.svg}</g>` + R(x0, yt, w, h, url(`${id}-s`)) + "</g>";
    if (clear) s += P(sil, "none", { stroke: "#000", "stroke-opacity": 0.16, "stroke-width": 0.8 });
    s += R(x0 + 6, yt + 112, 5, h - 112 - 30, "#fff", { rx: 2.5, opacity: 0.26 }) + R(xr - 8.5, yt + 114, 2, h - 118 - 30, "#fff", { rx: 1, opacity: 0.14 }) + R(CX - nw / 2 + 3, yt + 18, 2.4, 32, "#fff", { rx: 1.2, opacity: 0.3 });
    s += R(CX - nw / 2 - 2, yt, nw + 4, 14, cap, { rx: 2.5 }) + R(CX - nw / 2 - 2, yt, nw + 4, 14, url(`${id}-rg`), { rx: 2.5 }) + R(CX - nw / 2, yt + 1.5, 2.6, 11, "#fff", { rx: 1.3, opacity: 0.3 });
    return { svg: s, defs, d, cx: CX, gy, w, h, round: 0.75, detail: 8 };
  },

  box(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 94, 110)), h = Math.round(range(r, 136, 154)), dx = Math.round(range(r, 18, 26)), dy = Math.round(dx * 0.6);
    const gy = 226, yt = gy - h, x0 = CX - (w + dx) / 2, xr = x0 + w;
    const d = g.art(area(x0, yt, w, h, 16, 14, 9, 9));
    const defs = `<clipPath id="${id}-c">${R(x0, yt, w, h)}</clipPath>` + SHADE.flat(id);
    let s = `<g clip-path="url(#${id}-c)">${d.svg}${R(x0, yt, w, h, url(`${id}-s`))}</g>`;
    s += P(pth`M${xr} ${yt}L${xr + dx} ${yt - dy}V${gy - dy}L${xr} ${gy}Z`, darken(d.base, 0.3));
    s += P(pth`M${x0} ${yt}L${x0 + dx} ${yt - dy}H${xr + dx}L${xr} ${yt}Z`, lighten(d.base, 0.3));
    s += R(x0, yt, 1.2, h, "#fff", { opacity: 0.35 }) + R(x0, yt, w, 1.2, "#fff", { opacity: 0.5 }) + Ln(xr, yt, xr, gy, "#000", 0.8, { opacity: 0.14 });
    s += Ln(x0, yt + 11, xr, yt + 11, "#000", 0.7, { opacity: 0.12 }) + Ln(x0, yt + 12, xr, yt + 12, "#fff", 0.7, { opacity: 0.25 });
    return { svg: s, defs, d, cx: CX, gy, w: w + dx, h: h + dy, round: -0.8, detail: 7 };
  },

  pouch(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 96, 110)), h = Math.round(range(r, 144, 160)), gy = 226, yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0 + 3} ${yt}H${xr - 3}C${xr - 1} ${yt + h * 0.22} ${xr + 3} ${yt + h * 0.5} ${xr + 2} ${yt + h * 0.78}Q${xr + 2} ${gy} ${xr - 9} ${gy}Q${CX} ${gy + 2.5} ${x0 + 9} ${gy}Q${x0 - 2} ${gy} ${x0 - 2} ${yt + h * 0.78}C${x0 - 3} ${yt + h * 0.5} ${x0 + 1} ${yt + h * 0.22} ${x0 + 3} ${yt}Z`;
    const d = g.art(area(x0 - 2, yt, w + 4, h, 40, 30, 10, 10));
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + SHADE.soft(id) + CRIMP(id);
    let s = `<g clip-path="url(#${id}-c)">${R(x0 - 3, yt, w + 6, h + 4, d.base)}${d.svg}${R(x0 - 3, yt, w + 6, h + 4, url(`${id}-s`))}`;
    s += R(x0, yt, w, 13, "#fff", { opacity: 0.1 }) + R(x0, yt + 1.5, w, 10, url(`${id}-cr`)) + Ln(x0, yt + 13, xr, yt + 13, "#000", 0.8, { opacity: 0.16 });
    s += Ln(x0, yt + 22, xr, yt + 22, "#fff", 1.3, { opacity: 0.35 }) + Ln(x0, yt + 23.4, xr, yt + 23.4, "#000", 1, { opacity: 0.12 });
    s += P(pth`M${x0 - 2} ${gy - 26}Q${CX} ${gy - 4} ${xr + 2} ${gy - 26}V${gy + 3}H${x0 - 2}Z`, "#000", { opacity: 0.07 }) + P(pth`M${x0 - 2} ${gy - 26}Q${CX} ${gy - 4} ${xr + 2} ${gy - 26}`, "none", { stroke: "#000", "stroke-width": 1, opacity: 0.14 });
    s += R(x0 + 9, yt + 28, 8, h - 62, "#fff", { rx: 4, opacity: 0.12 }) + "</g>";
    return { svg: s, defs, d, cx: CX, gy, w, h, round: 0.2, detail: 8 };
  },

  jar(g) {
    const { r, id, pal } = g;
    const w = Math.round(range(r, 84, 98)), bh = Math.round(range(r, 100, 116)), lidH = 22, gy = gyFor(bh + lidH), yl = gy - bh, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0 + 9} ${yl}H${xr - 9}C${xr - 4} ${yl + 1} ${xr} ${yl + 8} ${xr} ${yl + 16}V${gy - 12}Q${xr} ${gy} ${xr - 12} ${gy}H${x0 + 12}Q${x0} ${gy} ${x0} ${gy - 12}V${yl + 16}C${x0} ${yl + 8} ${x0 + 4} ${yl + 1} ${x0 + 9} ${yl}Z`;
    const ly = yl + 28, lh = bh - 28 - 14, d = g.art(area(x0, ly, w, lh, 6, 6, 8, 8));
    const content = pick(r, ["#d99a2b", "#8c1d3a", "#7b7a2e", "#b98650", "#6a1b3d", "#3f2a6b"]), lid = capCol(g, d, [d.acc, "#d8dce1", "#1c1c20", pal.a]);
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath><clipPath id="${id}-l">${R(x0, ly, w, lh)}</clipPath>` + SHADE.cyl(id) + RIDGE(id, lidH);
    let s = `<g clip-path="url(#${id}-c)">` + R(x0, yl, w, bh, "#fff", { opacity: 0.3 }) + R(x0, yl + 12, w, bh - 12, content) + R(x0, yl + 12, w, 1.4, "#fff", { opacity: 0.3 });
    s += `<g clip-path="url(#${id}-l)">${d.svg}</g>` + R(x0, yl, w, bh, url(`${id}-s`)) + "</g>";
    s += P(sil, "none", { stroke: "#000", "stroke-opacity": 0.12, "stroke-width": 0.8 }) + R(x0 + 7, yl + 30, 5, bh - 56, "#fff", { rx: 2.5, opacity: 0.22 });
    s += R(x0 + 5, yl - lidH + 2, w - 10, lidH, lid, { rx: 3.5 }) + R(x0 + 5, yl - lidH + 2, w - 10, lidH, url(`${id}-rg`), { rx: 3.5 }) + R(x0 + 5, yl - lidH + 2, w - 10, lidH, url(`${id}-s`), { rx: 3.5 }) + R(x0 + 5, yl - lidH + 2, w - 10, 1.6, "#fff", { rx: 0.8, opacity: 0.4 });
    return { svg: s, defs, d, cx: CX, gy, w, h: bh + lidH, round: 0.6, detail: 8 };
  },

  tube(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 64, 74)), h = Math.round(range(r, 150, 168)), cw = 30, ch = 22, gy = 226, yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0 + 2} ${yt}H${xr - 2}L${xr} ${yt + 12}V${gy - 46}C${xr} ${gy - 34} ${CX + cw / 2 + 2} ${gy - 30} ${CX + cw / 2} ${gy - ch}H${CX - cw / 2}C${CX - cw / 2 - 2} ${gy - 30} ${x0} ${gy - 34} ${x0} ${gy - 46}V${yt + 12}Z`;
    const d = g.art(area(x0, yt, w, h - ch, 20, 40, 7, 7)), cap = capCol(g, d, [d.acc, "#f1f1ee", "#1c1c20"]);
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + SHADE.cyl(id) + CRIMP(id) + RIDGE(id, ch);
    let s = `<g clip-path="url(#${id}-c)">${R(x0, yt, w, h, d.base)}${d.svg}${R(x0, yt, w, h, url(`${id}-s`))}`;
    s += R(x0, yt, w, 12, "#fff", { opacity: 0.12 }) + R(x0 + 2, yt + 1.5, w - 4, 9.5, url(`${id}-cr`)) + Ln(x0, yt + 12, xr, yt + 12, "#000", 0.8, { opacity: 0.18 }) + E(CX, yt + 6, 3.6, 2, "#000", { "fill-opacity": 0.22 }) + "</g>";
    s += R(CX - cw / 2, gy - ch, cw, ch, cap, { rx: 4 }) + R(CX - cw / 2, gy - ch, cw, ch, url(`${id}-rg`), { rx: 4 }) + R(CX - cw / 2, gy - ch, cw, ch, url(`${id}-s`), { rx: 4 });
    s += R(CX - cw / 2 + 1, gy - ch, cw - 2, 2, "#000", { opacity: 0.18 });
    return { svg: s, defs, d, cx: CX, gy, w, h, round: 0.45, detail: 7 };
  },

  brick(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 80, 92)), h = Math.round(range(r, 140, 158)), gy = 226, yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0} ${yt + 10}H${xr}V${gy - 4}Q${xr} ${gy} ${xr - 4} ${gy}H${x0 + 4}Q${x0} ${gy} ${x0} ${gy - 4}Z`;
    const d = g.art(area(x0, yt + 10, w, h - 10, 12, 10, 10, 12)), cap = capCol(g, d, [d.acc, "#f1f1ee", "#1c1c20"]);
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + CRIMP(id);
    let s = `<g clip-path="url(#${id}-c)">${d.svg}${R(x0, yt, 7, h, "#fff", { opacity: 0.16 })}${R(xr - 9, yt, 9, h, "#000", { opacity: 0.12 })}${R(x0 + 6.4, yt, 0.9, h, "#fff", { opacity: 0.22 })}${R(xr - 9.4, yt, 0.9, h, "#000", { opacity: 0.1 })}</g>`;
    s += R(x0 + 1, yt, w - 2, 10, mix(d.base, "#ffffff", 0.18), { rx: 1 }) + R(x0 + 2, yt + 1.2, w - 4, 7.6, url(`${id}-cr`)) + R(x0 + 1, yt + 9, w - 2, 1.2, "#000", { opacity: 0.18 });
    s += R(xr - 25, yt + 13, 15, 7.5, cap, { rx: 3 }) + R(xr - 25, yt + 13, 15, 2.6, "#fff", { rx: 1.3, opacity: 0.35 });
    return { svg: s, defs, d, cx: CX, gy, w, h, round: -0.55, detail: 8 };
  },

  bag(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 96, 108)), h = Math.round(range(r, 150, 166)), gy = 226, yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0 + 3} ${yt}H${xr - 3}C${xr - 1} ${yt + h * 0.3} ${xr + 2} ${yt + h * 0.7} ${xr + 2} ${gy - 4}Q${xr + 2} ${gy} ${xr - 1} ${gy}H${x0 + 1}Q${x0 - 2} ${gy} ${x0 - 2} ${gy - 4}C${x0 - 2} ${yt + h * 0.7} ${x0 + 1} ${yt + h * 0.3} ${x0 + 3} ${yt}Z`;
    const d = g.art(area(x0 - 2, yt, w + 4, h, 48, 24, 13, 13));
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + SHADE.soft(id) + CRIMP(id);
    let s = `<g clip-path="url(#${id}-c)">${R(x0 - 3, yt, w + 6, h + 4, d.base)}${d.svg}${R(x0 - 3, yt, w + 6, h + 4, url(`${id}-s`))}`;
    s += R(x0 - 3, yt, w + 6, 20, "#fff", { opacity: 0.1 }) + R(x0, yt + 1, w, 5, url(`${id}-cr`)) + Ln(x0, yt + 20, xr, yt + 20, "#fff", 1.2, { opacity: 0.3 }) + Ln(x0, yt + 21.4, xr, yt + 21.4, "#000", 1.4, { opacity: 0.1 });
    s += R(x0 + 14, yt + 9, w - 28, 3.2, "#d3d6da", { rx: 1.6 }) + R(x0 + 14, yt + 9, w - 28, 1.2, "#fff", { rx: 0.6, opacity: 0.6 });
    s += R(x0 - 2, yt + 20, 10, h, "#fff", { opacity: 0.1 }) + R(xr - 8, yt + 20, 10, h, "#000", { opacity: 0.1 }) + Ln(x0 + 8, yt + 21, x0 + 8, gy, "#000", 0.7, { opacity: 0.08 }) + Ln(xr - 8, yt + 21, xr - 8, gy, "#000", 0.7, { opacity: 0.08 });
    s += Ln(x0 - 2, gy, x0 + 8, gy - 14, "#000", 0.8, { opacity: 0.12 }) + Ln(xr + 2, gy, xr - 8, gy - 14, "#000", 0.8, { opacity: 0.12 });
    const vx = xr - 26, vy = yt + 38;
    s += C(vx, vy, 6.5, "#000", { opacity: 0.16 }) + C(vx, vy, 6.5, "none", { stroke: "#fff", "stroke-width": 0.9, "stroke-opacity": 0.45 }) + C(vx, vy, 2.4, "#000", { opacity: 0.3 }) + "</g>";
    return { svg: s, defs, d, cx: CX, gy, w, h, round: -0.15, detail: 12 };
  },

  tin(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 112, 134)), h = Math.round(range(r, 84, 106)), gy = gyFor(h + 6), yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const sil = pth`M${x0} ${yt}H${xr}V${gy - 4}Q${xr} ${gy} ${xr - 4} ${gy}H${x0 + 4}Q${x0} ${gy} ${x0} ${gy - 4}Z`;
    const d = g.art(area(x0, yt, w, h, 26, 10, 10, 10));
    const defs = `<clipPath id="${id}-c">${P(sil)}</clipPath>` + SHADE.cyl(id);
    let s = `<g clip-path="url(#${id}-c)">${d.svg}${R(x0, yt, w, h, url(`${id}-s`))}`;
    s += R(x0, yt, w, 20, "#000", { opacity: 0.06 }) + Ln(x0, yt + 20, xr, yt + 20, "#000", 1.2, { opacity: 0.22 }) + Ln(x0, yt + 21.4, xr, yt + 21.4, "#fff", 0.9, { opacity: 0.3 }) + R(x0, gy - 5, w, 5, "#000", { opacity: 0.14 }) + "</g>";
    s += E(CX, yt, w / 2 - 2.5, 6.5, lighten(d.base, 0.25)) + E(CX, yt, w / 2 - 2.5, 6.5, url(`${id}-s`)) + E(CX, yt, w / 2 - 9, 3.4, "#000", { "fill-opacity": 0.07 });
    return { svg: s, defs, d, cx: CX, gy, w, h: h + 6, round: 0.55, detail: 6 };
  },

  tall(g) {
    const { r, id } = g;
    const w = Math.round(range(r, 56, 66)), h = Math.round(range(r, 160, 178)), lidH = 17, rimH = 8, gy = 226, yt = gy - h, x0 = CX - w / 2, xr = x0 + w;
    const d = g.art(area(x0, yt + lidH, w, h - lidH - rimH, 8, 8, 6, 6)), lid = capCol(g, d, [d.acc, "#1d1d21", "#f1f1ee"]);
    const defs = `<clipPath id="${id}-c">${R(x0, yt + lidH, w, h - lidH)}</clipPath>` + SHADE.cyl(id) + METAL(id) + RIDGE(id, lidH);
    let s = `<g clip-path="url(#${id}-c)">${d.svg}${R(x0, yt, w, h, url(`${id}-s`))}</g>`;
    s += R(x0, gy - rimH, w, rimH, url(`${id}-m`), { rx: 1.5 }) + Ln(x0, gy - rimH, xr, gy - rimH, "#000", 0.8, { opacity: 0.25 });
    s += R(x0 - 2, yt, w + 4, lidH, lid, { rx: 3 }) + R(x0 - 2, yt, w + 4, lidH, url(`${id}-s`), { rx: 3 }) + R(x0 - 2, yt, w + 4, 1.6, "#fff", { rx: 0.8, opacity: 0.4 }) + Ln(x0, yt + lidH, xr, yt + lidH, "#000", 1.2, { opacity: 0.25 });
    return { svg: s, defs, d, cx: CX, gy, w: w + 4, h, round: 0.5, detail: 6 };
  },
};

// =====================================================================================================
// STAGE: studio backdrop (wall, table, optional spot disc) and the soft ground shadow
// =====================================================================================================
function stage(g, res) {
  const { r, pal, id } = g, d = res.d, gy = res.gy;
  const L = lightness(d.base), [ha, sa] = hexToHsl(pal.a);
  const gray = ha > 200 && ha < 330 ? "#e8ebee" : "#eeebe5", tintA = mix(pal.a, "#ffffff", 0.84), tintB = mix(pal.b, "#ffffff", 0.82), deep = hsl(ha, Math.min(0.3, sa), 0.15);
  const opts = L < 40 ? [tintA, gray, tintB, mix(pal.b, "#fff", 0.68)] : L > 80 ? [mix(pal.a, "#fff", 0.5), deep, mix(pal.b, "#fff", 0.45), "#d9dde2"] : [tintA, gray, tintB, deep];
  let wall = pick(r, opts);
  if (Math.abs(lightness(wall) - L) < 16) wall = L < 50 ? tintA : deep;
  const lw = lightness(wall), light = lw > 50, hy = gy - 28;
  const spot = chance(r, 0.5), spotC = light ? mix(wall, pal.a, 0.12) : lighten(wall, 0.1);
  const table = mix(wall, "#000000", light ? 0.07 : 0.25);
  const defs = lin(`${id}-w`, [[0, lighten(wall, light ? 0.05 : 0.08)], [1, wall]], 0, 1);
  let back = R(0, 0, W, H, url(`${id}-w`), { rx: 12 });
  if (spot) back += C(res.cx, gy - res.h * 0.5, clamp(Math.max(res.w * 0.8, res.h * 0.48), 54, 98), spotC);
  back += P(pth`M0 ${hy}H${W}V${H - 12}Q${W} ${H} ${W - 12} ${H}H12Q0 ${H} 0 ${H - 12}Z`, table);
  back += R(0, hy, W, 1, light ? "#fff" : "#000", { opacity: light ? 0.5 : 0.25 });
  const sh = res.w, k = light ? 1 : 0.7;
  const shadow = E(res.cx + sh * 0.12, gy + 3, sh * 0.62, 7, "#000", { "fill-opacity": 0.07 * k }) + E(res.cx + sh * 0.07, gy + 2, sh * 0.54, 4.5, "#000", { "fill-opacity": 0.1 * k }) + E(res.cx + 1, gy + 0.8, sh * 0.47, 2.2, "#000", { "fill-opacity": 0.3 * k });
  return { wall, light, spot, defs, back: back + shadow };
}

export function build(rand, ctx) {
  const slot = planPack(String(ctx.season))[ctx.index % 32];
  const pal = PAL[slot.pal];
  const g = {
    id: ctx.id, r: rand, pal, form: slot.form, design: slot.design, brand: slot.brand,
    dark: lightness(pal.bg) < 40,
    dk: lightness(pal.ink) < 30 ? pal.ink : DK,
    lt: lightness(pal.ink) > 85 ? pal.ink : lightness(pal.surface) > 90 ? pal.surface : LT,
  };
  g.cs = pick(rand, CASES[slot.design]);
  g.desc = pick(rand, DESC[slot.form]);
  g.vol = pick(rand, VOL[slot.form]);
  g.v = Math.floor(rand() * 3);
  g.art = (A) => DESIGNS[g.design](g, A);
  const res = FORMS[g.form](g);
  const st = stage(g, res), d = res.d;
  const svg = svgRoot(W, H, `<defs>${st.defs}${res.defs}${d.defs ?? ""}</defs>${st.back}${res.svg}`, { "font-family": "Inter, system-ui, sans-serif" });

  // ---- traits (see the header for the formulas)
  const expand = (cols, scale) => cols.flatMap(([h, n]) => Array(Math.max(1, Math.round(n * scale))).fill(h));
  const tot = d.cols.reduce((s, c) => s + c[1], 0);
  const hexes = [...expand(d.cols, 8 / tot), ...Array(4).fill(st.wall)];
  const lPack = d.cols.reduce((s, [h, n]) => s + lightness(h) * n, 0) / tot;
  const lAll = 0.55 * lightness(st.wall) + 0.45 * lPack;
  const cover = (res.w * res.h) / (W * H);
  const plainShare = 0.6 * d.plain + 0.4 * (1 - clamp(cover * 3.2, 0, 1));
  const traits = {
    warm: warmOf(hexes),
    vivid: vividOf(hexes),
    dark: clamp(1 - lAll / 50),
    round: clamp(0.5 * res.round + 0.5 * d.round + (st.spot ? 0.12 : 0)),
    bold: clamp(d.bold + 0.25 * vividOf(d.cols.map((c) => c[0]))),
    airy: clamp((plainShare - 0.36) * 2.8),
    rich: richOf(d.n + res.detail + (st.spot ? 1 : 0), 6, 28),
  };
  return { name: `${g.form} / ${g.design}`, svg, traits };
}
