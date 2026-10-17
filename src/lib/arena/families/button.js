// CALL-TO-ACTION BUTTONS -- a tiny hero banner: eyebrow, a 1-2 line heading, a sub line and one CTA button.
//
// 12 button constructions (solid, outline, ghost + arrow, soft tint, pill, sharp caps, big radius, brutalist offset shadow,
// two-tone with an arrow chip, underlined link, icon + label, full-width block) cycled over the 32 slots, then varied in size,
// weight, case, radius, alignment (left / centred), vertical rhythm, background (palette / surface / dark / brand colour),
// decor and language (Latin, Russian, Kazakh). A season-level plan (a pure function of ctx.season) assigns style, palette,
// ground, legibility class (exactly 8 poor, 8 excellent, 16 middling), size, language ... so every pool is varied.
//
// Legibility: main text = the BUTTON LABEL, and the heading / sub line follow its class (heading contrast = 1.2 x label,
//   sub = 0.85 x label, capped by what the ground can carry), so all text of a banner is about equally readable.
//   contrast = the weaker of WCAG(label colour, colour directly behind it) -- the button fill for filled styles, the tinted
//   fill for soft, the page background for outline / ghost / underline -- and WCAG(heading, ground).
//   size = fs / 200 * 6.25;  score = 0.7 * min(1, ln(contrast) / ln(12)) + 0.3 * size.
//   poor: 1.5-2.9 (white on light yellow, pastel on pastel ...), middling 3.9-8, excellent 10.6-17.
//
// Traits (all in [-1, 1]):
//   warm  = warmOf(ground + brand colours used)      vivid = vividOf(brand colours used)      dark = darkOf(ground)
//   bold  = 4.6 * (0.3 * body + 0.2 * labelHeft + 0.22 * headingHeft + 0.14 * buttonShare + 0.14 * impact) - 2.25
//           body: how much of a container the button has (solid / block 1 ... ghost / link ~0.1)
//   round = 0.8 * (2 * corner / (h / 2) - 1) + 0.2 * decorRoundness   (pill +1, sharp / brutalist -1)
//   airy  = clamp((0.41 - sqrt(inked area / canvas)) * 7.5)           inked area = heading + sub + button boxes
//   rich  = richOf(heading lines + sub + button parts + decor + eyebrow, 3.5, 8)
import { svgRoot, rect, el, esc } from "../svgutil.js";
import { PALETTES, HEADLINES, CTA_LABELS } from "../palettes.js";
import { mix, contrast, hexToHsl, hsl, lightness } from "../color.js";
import { warmOf, vividOf, darkOf, richOf, clamp } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "attention", "trust", "clarity", "purchaseIntent", "friendly", "modern"];
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
const strk = (d, color, w, x) => el("path", { d, fill: "none", stroke: color, "stroke-width": f(w), "stroke-linecap": "round", "stroke-linejoin": "round", ...x });

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
const bestOn = (bg, cands) => cands.reduce((m, c) => (contrast(c, bg) > contrast(m, bg) ? c : m));
const worstOn = (bg, cands) => cands.reduce((m, c) => (contrast(c, bg) < contrast(m, bg) ? c : m));
const reach = (c) => Math.max(contrast(c, "#000000"), contrast(c, "#ffffff"));
function away(c, bg, min) {
  if (contrast(c, bg) >= min) return c;
  const toward = lightness(bg) > 55 ? "#000000" : "#ffffff";
  for (let t = 0.08; t <= 1.001; t += 0.08) { const m = mix(c, toward, t); if (contrast(m, bg) >= min) return m; }
  return toward;
}
/** A colour with `target` contrast on bg, on the line bg -> base -> black / white (keeps the base hue). */
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

/* ------------------------------------------------------------------ copy */
const KK = new Set(["Жаңа дәм", "Таза ауа", "Өз қолыңмен", "Тыныштық", "Бүгін бастаймыз", "Бастау", "Көру", "Сатып алу", "Тапсырыс беру"]);
const langOf = (s) => (KK.has(s) ? 2 : /[Ѐ-ӿ]/.test(s) ? 1 : 0);
const SUBS = [
  ["Everything you need, nothing you don't", "Simple tools for calmer days", "Start in a minute, no card needed", "Made with care, delivered fast", "Small steps, steady progress", "Quality that lasts"],
  ["Всё нужное — в одном месте", "Просто начните, без лишнего", "Сделано с заботой о вас", "Маленькие шаги к большим целям", "Качество, проверенное временем"],
  ["Қажеттінің бәрі бір жерде", "Жеңіл, жылдам әрі ыңғайлы", "Әр күн — жаңа мүмкіндік", "Сапа мен жайлылық бір жерде", "Қарапайым әрі сенімді"],
];
/** word-wrap a heading into at most two lines that fit maxW at the biggest size <= fsMax */
function headLines(str, maxW, fsMax, w, ls) {
  const words = str.split(" ");
  const one = Math.min(fsMax, maxW / tw(str, 1, w, ls));
  let best = { lines: [str], fs: one };
  if (words.length > 1) {
    for (let s = 1; s < words.length; s++) {
      const l1 = words.slice(0, s).join(" "), l2 = words.slice(s).join(" ");
      const fs = Math.min(fsMax, maxW / Math.max(tw(l1, 1, w, ls), tw(l2, 1, w, ls)));
      if (fs > best.fs * 0.92 || best.lines.length === 1) { if (best.lines.length === 1 || fs > best.fs) best = { lines: [l1, l2], fs }; }
    }
    // prefer two lines whenever the type does not shrink by more than ~25%
    const two = best.lines.length === 2 ? best : null;
    if (two && two.fs >= one * 0.72) return two;
    if (!two) return best;
  }
  return best.lines.length === 1 ? best : { lines: [str], fs: one };
}

/* ------------------------------------------------------------------ season plan */
const STYLE_NAMES = ["Solid", "Outline", "Ghost + arrow", "Soft tint", "Pill", "Sharp caps", "Big radius", "Brutalist", "Two-tone chip", "Underline link", "Icon + label", "Block"];
function entry(season, i) {
  const r = mulberry32(hashStringToSeed(`button|plan|${season}`));
  const order = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const pal = shuffle(r, PALETTES.map((_, j) => j));
  const bgs = shuffle(r, [...Array(12).fill(0), ...Array(6).fill(1), ...Array(8).fill(2), ...Array(6).fill(3)]);
  const cats = shuffle(r, [...Array(8).fill(0), ...Array(8).fill(2), ...Array(16).fill(1)]);
  const aligns = shuffle(r, [...Array(17).fill(0), ...Array(15).fill(1)]);
  const vposs = shuffle(r, [...Array(14).fill(0), ...Array(8).fill(1), ...Array(10).fill(2)]);
  const decors = shuffle(r, [...Array(9).fill(0), ...Array(5).fill(1), ...Array(5).fill(2), ...Array(4).fill(3), ...Array(5).fill(4), ...Array(4).fill(5)]);
  const langs = shuffle(r, [...Array(12).fill(0), ...Array(10).fill(1), ...Array(10).fill(2)]);
  const tones = shuffle(r, [...Array(5).fill(1), ...Array(2).fill(2), ...Array(25).fill(0)]);
  const strat = () => shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.5 + (r() - 0.5) * 0.8) / 32));
  const us = strat(), szs = strat(), rads = strat(), hszs = strat();
  const wts = shuffle(r, [...Array(6).fill(500), ...Array(7).fill(600), ...Array(9).fill(700), ...Array(10).fill(800)]);
  const hwts = shuffle(r, [...Array(8).fill(600), ...Array(10).fill(700), ...Array(14).fill(800)]);
  const heads = shuffle(r, HEADLINES.map((_, j) => j)), ctas = shuffle(r, CTA_LABELS.map((_, j) => j));
  const ups = shuffle(r, [...Array(10).fill(1), ...Array(22).fill(0)]);
  const k = Math.floor(i / 12);
  return { style: order[i % 12], k, pal: pal[i], bg: bgs[i], cat: cats[i], align: aligns[i], vpos: vposs[i], decor: decors[i], lang: langs[i], tone: tones[i], u: us[i], sz: szs[i], rad: rads[i], hsz: hszs[i], w: wts[i], hw: hwts[i], up: ups[i], heads, ctas, i };
}

/* ------------------------------------------------------------------ icons */
const arrow = (cx, cy, s, col, sw) => strk(`M${P(cx - s, cy)}H${f(cx + s)}M${P(cx + s * 0.1, cy - s * 0.8)}L${P(cx + s, cy)}L${P(cx + s * 0.1, cy + s * 0.8)}`, col, sw);
const plus = (cx, cy, s, col, sw) => strk(`M${P(cx - s, cy)}H${f(cx + s)}M${P(cx, cy - s)}V${f(cy + s)}`, col, sw);

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const idx = ((ctx.index % 32) + 32) % 32;
  const E = entry(String(ctx.season ?? ""), idx);
  const t1 = rand(), t2 = rand(), t3 = rand(), t4 = rand(), t5 = rand();
  const id = ctx.id;
  const st = E.style;
  const p = PALETTES[E.pal];
  const darkNat = lightness(p.bg) < 30;

  // ---- palette colours (with a muted / brighter treatment for a few slots)
  let a = p.a, b = p.b;
  if (E.tone === 1) { a = tone(a, 0.88); b = tone(b, 0.88); } else if (E.tone === 2) { a = tone(a, -0.6); b = tone(b, -0.6); }
  const L1 = darkNat ? p.ink : p.surface, D1 = darkNat ? p.bg : (lightness(p.ink) < 38 ? p.ink : mix(p.ink, "#000000", 0.8));
  let dg = p.ink; for (let q = 0; q < 9 && lightness(dg) > 13; q++) dg = mix(dg, "#000000", 0.18);
  // background scheme: 0 palette ground, 1 surface, 2 dark, 3 brand colour
  const scheme = E.bg;
  let B = scheme === 0 ? p.bg : scheme === 1 ? p.surface : scheme === 2 ? (darkNat ? p.bg : dg) : a;
  if (E.cat === 2 && reach(B) < 12.5) { // an excellent slot needs a ground that can carry near-black / white text: push the brand colour darker or lighter
    const dir = contrast(B, "#ffffff") >= contrast(B, "#000000") ? "#000000" : "#ffffff";
    for (let q = 1; q <= 20 && reach(B) < 12.5; q++) B = mix(B, dir, 0.05 * q > 0.9 ? 0.9 : 0.05);
  }
  const bgDark = lightness(B) < 42;
  const light = bgDark ? L1 : B === a ? L1 : (lightness(p.surface) > 80 ? p.surface : "#ffffff");
  const deep = mix(a, D1, 0.45);

  // ---- legibility class -> target contrast
  const cat = E.cat, u = E.u;
  const target = cat === 0 ? 1.55 + 1.3 * u : cat === 1 ? 3.95 + 4.0 * u : 10.7 + 6.0 * u;
  const lo = cat === 0 ? 1.4 : cat === 1 ? 3.7 : 10.3, hi = cat === 0 ? 3.0 : cat === 1 ? 8.4 : 21;
  const fit = (S, base) => { const c0 = contrast(S, base); return c0 >= lo && c0 <= hi ? base : inkAt(S, base, target); };
  /** label colour for a filled surface S: best ink (middling / excellent) or the weakest one (poor) */
  const labelFor = (S) => {
    const cands = [L1, D1, "#ffffff", "#111114"];
    if (cat === 0) { const hint = worstOn(S, [L1, "#ffffff", D1]); return inkAt(S, hint, Math.min(target, Math.max(1.25, contrast(S, hint)))); }
    return inkAt(S, bestOn(S, cands), target);
  };

  // ---- button geometry parameters
  const FS = [[11, 14.5], [11, 14], [12.5, 16], [11, 14], [11, 14.5], [10, 12.5], [12, 15], [11, 14], [11, 13.5], [13, 16.5], [11, 14], [13, 16.5]][st];
  let fs = lerp(FS[0], FS[1], E.sz);
  const lw = st === 5 ? Math.max(E.w, 700) : st === 7 ? 800 : E.w;
  const up = st === 5 || st === 7 ? true : E.up === 1;
  const lang = E.lang;
  // copy: heading / CTA in the slot's language (one in four slots mixes languages)
  const mixed = t3 < 0.22;
  const pickBy = (list, want, order) => { for (const j of order) if (langOf(list[j]) === want) return list[j]; return list[order[0]]; };
  const head = pickBy(HEADLINES, lang, E.heads), cta0 = pickBy(CTA_LABELS, mixed ? (lang + 1) % 3 : lang, E.ctas);
  const sub = SUBS[lang][Math.floor(t2 * SUBS[lang].length)];
  const label = up ? cta0.toUpperCase() : cta0;
  const lsL = up ? 0.07 : 0.012;
  const tW = (s) => tw(label, s, lw, lsL);
  const contentW = 196;
  const center = E.align === 1 && st !== 11;
  // fitting the label to the content width
  const padFor = [1.35, 1.2, 0, 1.3, 1.7, 1.7, 1.8, 1.4, 1.3, 0, 1.2, 0][st];
  if (st !== 11) fs = Math.min(fs, (contentW - 2 * padFor * fs - (st === 8 || st === 10 || st === 2 ? fs * 3.2 : 0)) / (tW(1) + 0.001) + 0.001, 17);
  fs = Math.max(fs, 10);

  // ---- surfaces & colours per style
  const FILL = [0, 4, 5, 6, 7, 8, 10, 11];
  const isFill = FILL.includes(st);
  const Kb = lightness(B) > 20 && contrast(a, B) > 1.2 ? a : b;
  let F = null, C, S, K = null, T2 = null, accent = b;
  if (isFill) {
    const cands = B === a ? [light, D1, b] : st === 7 ? [b, a, light, D1] : st === 8 || st === 3 ? [a, D1, b, deep] : [a, b, deep, D1, light];
    if (cat === 0) { // poor: a light-ish or mid fill, so the weak label looks like an honest mistake
      F = cands.find((c) => contrast(c, B) > 1.15 && lightness(c) > 40) ?? cands.find((c) => contrast(c, B) > 1.15) ?? cands[0];
    } else {
      F = cands.find((c) => contrast(c, B) > 1.25 && reach(c) > target * 1.06) ?? (bgDark ? light : D1);
      if (contrast(F, B) < 1.25) F = bestOn(B, [light, D1]);
    }
    C = labelFor(F); S = F;
    if (st === 8) { // chip colour
      T2 = cands.find((c) => c !== F && contrast(c, F) > 1.7 && contrast(c, B) > 1.25) ?? [light, D1, "#ffffff", "#111114"].filter((c) => contrast(c, B) > 1.25).sort((x, y) => contrast(y, F) - contrast(x, F))[0] ?? bestOn(F, [light, D1]);
    }
  } else if (st === 3) { // soft tint: label on a tinted fill
    const base = Kb;
    T2 = mix(base, B, bgDark ? 0.78 : 0.86);
    S = T2; K = fit(S, base); C = K;
  } else { // outline, ghost, underline: label on the page
    S = B; K = fit(B, Kb); C = K;
    accent = contrast(b, B) > 1.4 ? b : a;
  }
  // heading and sub colours follow the label's class (monotone in its contrast), so every text of a banner is about equally
  // readable and "which text is easier to read" has one answer whichever of them a player looks at
  const ink0 = bestOn(B, [L1, D1, light]);
  const crL = contrast(C, S), rB = reach(B);
  const hT = clamp(crL * 1.2, 1.7, rB * 0.98), sT = clamp(Math.min(crL * 0.85, hT * 0.9), 1.4, rB * 0.95);
  const headCol = inkAt(B, ink0, hT), subCol = inkAt(B, ink0, sT);

  // ---- heading sizes
  const hw = E.hw, hsz = E.hsz, hls = -0.022;
  const hMax = lerp(19, 29, hsz);
  const hl = headLines(head, center ? 176 : contentW, hMax, hw, hls);
  let hfs = Math.max(hl.fs, 14);
  const sfs = lerp(8.4, 9.6, t1);
  const sfit = Math.min(sfs, contentW / tw(sub, 1, 400, 0.004));

  // ---- button size
  const brad = lerp(0, 1, E.rad);
  let bh = [fs * 2.55, fs * 2.5, fs * 1.6, fs * 2.5, fs * 2.55, fs * 2.9, Math.max(38, fs * 3.05), fs * 2.6, fs * 2.7, fs * 1.5, fs * 2.55, Math.max(40, fs * 3.0)][st];
  if (st === 11) bh = Math.min(bh, 46);
  const rx = [lerp(3, 9, brad), lerp(3, 9, brad), 0, lerp(5, 11, brad), bh / 2, 0, 12, lerp(0, 4, brad), bh / 2, 0, lerp(5, 10, brad), lerp(3, 10, brad)][st];
  const sw = lerp(1.4, 2.3, E.rad);
  const eyebrow = E.decor === 4 && !center;

  // ---- vertical layout
  const gap1 = clamp(hfs * 0.42, 7, 12), gap2 = clamp(hfs * 0.7, 12, 19);
  const lhd = hfs * 1.07, eyeH = eyebrow ? 12 : 0, subH = sfit * 1.1;
  let total = eyeH + hl.lines.length * lhd + gap1 + subH + gap2 + bh;
  for (let q = 0; q < 6 && total > 150; q++) { hfs *= 0.92; total = eyeH + hl.lines.length * hfs * 1.07 + gap1 + subH + gap2 + bh; }
  const lh2 = hfs * 1.07;
  let top = (H - total) / 2 - 2;
  const vpos = st === 11 ? 2 : E.vpos;
  let btnY;
  if (vpos === 1) top = Math.min(Math.max(26, top - 8), 34);
  if (vpos === 2) top = 26;
  const baseY1 = top + eyeH + hfs * 0.78;
  const lastBase = baseY1 + (hl.lines.length - 1) * lh2;
  const subBase = lastBase + hfs * 0.2 + gap1 + sfit * 0.75;
  btnY = subBase + sfit * 0.25 + gap2;
  if (vpos === 2) btnY = Math.max(btnY, H - 24 - bh);
  const x0 = center ? W / 2 : 22, anchor = center ? "middle" : "start";

  // ---- decor (drawn first)
  const cid = `${id}-c`;
  const dt = B === a ? mix(B, bgDark ? "#ffffff" : "#000000", 0.13) : mix(B, a, bgDark ? 0.22 : 0.13);
  let decor = "", dn = 0, drd = 0;
  const dk = E.decor;
  if (dk === 1) { decor = circ(W - 4, 26, 78, dt) + circ(W - 4, 26, 50, "none", { stroke: mix(dt, B, 0.5), "stroke-width": 1 }); dn = 2; drd = 1; }
  else if (dk === 2) { decor = `<polygon points="${P(W, H - 82)} ${P(W, H - 52)} ${P(W - 52, H)} ${P(W - 82, H)}" fill="${dt}"/><polygon points="${P(W, H - 40)} ${P(W, H - 14)} ${P(W - 14, H)} ${P(W - 40, H)}" fill="${mix(dt, B, 0.4)}"/>`; dn = 2; drd = -0.7; }
  else if (dk === 3) { for (let j = 0; j < 4; j++) for (let q = 0; q < 6; q++) decor += circ(W - 18 - q * 9, 18 + j * 9, 1.6, mix(B, bgDark ? "#ffffff" : "#000000", 0.2)); dn = 2; drd = 0.8; }
  else if (dk === 5) { for (let q = 0; q < 3; q++) decor += `<circle cx="${W}" cy="${H}" r="${f(38 + q * 24)}" fill="none" stroke="${q === 0 ? dt : mix(dt, B, 0.45)}" stroke-width="7"/>`; dn = 3; drd = 1; }
  if (decor) decor = `<defs><clipPath id="${cid}">${rect(0, 0, W, H, "#000", { rx: 12 })}</clipPath></defs><g clip-path="url(#${cid})">${decor}</g>`;

  // ---- text block
  let out = decor;
  if (eyebrow) out += rr(x0, top + 1, 26, 3.5, 1.75, accent === b ? b : a);
  hl.lines.forEach((ln, q) => { out += T(x0, baseY1 + q * lh2, ln, hfs, hw, hls, headCol, anchor); });
  out += T(x0, subBase, sub, sfit, 400, 0.004, subCol, anchor);

  // ---- the button
  const txt = label, base = (h) => btnY + h / 2 + (up ? 0.3635 : 0.352) * fs;
  let btnW, parts = 1, body, rdRatio, svgB = "", inkB = 0;
  const lab = (cx, h, col, anchorL = "middle") => T(cx, base(h), txt, fs, lw, lsL, col, anchorL);
  const place = (wBtn) => (center ? W / 2 - wBtn / 2 : x0);
  const hair = (col, bg) => (contrast(col, bg) < 1.3 ? { stroke: mix(bg, lightness(bg) < 50 ? "#ffffff" : "#000000", 0.22), "stroke-width": 0.9 } : {});
  if (st === 0 || st === 4 || st === 6 || st === 5 || st === 10 || st === 11) {
    const pad = padFor * fs;
    let iconW = st === 10 ? fs * 0.95 : 0, gapI = st === 10 ? fs * 0.65 : 0;
    btnW = st === 11 ? contentW : tW(fs) + 2 * pad + iconW + gapI;
    const bx = st === 11 ? (center ? W / 2 - btnW / 2 : x0) : place(btnW);
    svgB += rr(bx, btnY, btnW, bh, rx, F, hair(F, B));
    if (st === 10) {
      const iconLeft = t4 < 0.5, ic = t5 < 0.6 ? arrow : plus, tx = bx + pad + (iconLeft ? iconW + gapI : 0), ix = iconLeft ? bx + pad + iconW / 2 : bx + pad + tW(fs) + gapI + iconW / 2;
      svgB += T(tx, base(bh), txt, fs, lw, lsL, C, "start") + ic(ix, btnY + bh / 2, iconW * 0.5, C, Math.max(1.4, fs * 0.13));
      parts = 3;
    } else if (st === 11) {
      const arrowOn = t4 < 0.6;
      if (arrowOn) { svgB += T(bx + 16, base(bh), txt, fs, lw, lsL, C, "start") + arrow(bx + btnW - 20, btnY + bh / 2, fs * 0.5, C, Math.max(1.5, fs * 0.13)); parts = 2; }
      else svgB += lab(bx + btnW / 2, bh, C);
    } else svgB += lab(bx + btnW / 2, bh, C);
    body = st === 11 ? 1 : st === 5 ? 0.9 : 0.85; rdRatio = rx / (bh / 2);
    inkB = btnW * bh;
  } else if (st === 1) { // outline
    const pad = padFor * fs; btnW = tW(fs) + 2 * pad; const bx = place(btnW);
    svgB += rr(bx + sw / 2, btnY + sw / 2, btnW - sw, bh - sw, rx, "none", { stroke: K, "stroke-width": f(sw) }) + lab(bx + btnW / 2, bh, C);
    body = 0.4; rdRatio = rx / (bh / 2); inkB = btnW * bh * 0.5;
  } else if (st === 2) { // ghost + arrow
    const gapA = fs * 0.7, aw = fs * 0.95; btnW = tW(fs) + gapA + aw; const bx = place(btnW);
    svgB += T(bx, base(bh), txt, fs, lw, lsL, C, "start") + arrow(bx + tW(fs) + gapA + aw / 2, btnY + bh / 2, aw * 0.5, C, Math.max(1.4, fs * 0.13));
    parts = 2; body = 0.12; rdRatio = 0.5; inkB = btnW * fs;
  } else if (st === 3) { // soft tint
    const pad = padFor * fs; btnW = tW(fs) + 2 * pad; const bx = place(btnW);
    svgB += rr(bx, btnY, btnW, bh, rx, T2, hair(T2, B)) + lab(bx + btnW / 2, bh, C);
    body = 0.6; rdRatio = rx / (bh / 2); inkB = btnW * bh;
  } else if (st === 7) { // brutalist: hard offset shadow + keyline
    const pad = padFor * fs, off = lerp(3, 5, E.rad); btnW = tW(fs) + 2 * pad; const bx = place(btnW - off / 2);
    const lineCol = bgDark ? bestOn(B, [light, L1]) : D1;
    svgB += rr(bx + off, btnY + off, btnW, bh, rx, lineCol) + rr(bx, btnY, btnW, bh, rx, F, { stroke: lineCol, "stroke-width": 2 }) + lab(bx + btnW / 2, bh, C);
    parts = 2; body = 1; rdRatio = Math.max(0, rx / (bh / 2)) * 0.5 - 0.2; inkB = (btnW + off) * (bh + off);
  } else if (st === 8) { // two-tone with an arrow chip
    const padL = fs * 1.3, gapC = fs * 0.9, pill = t4 < 0.55;
    btnW = padL + tW(fs) + gapC + bh; const bx = place(btnW);
    const chipFg = bestOn(T2, [light, D1, "#ffffff", "#111114"]);
    if (pill) {
      svgB += rr(bx, btnY, btnW, bh, bh / 2, F, hair(F, B)) + circ(bx + btnW - bh / 2, btnY + bh / 2, bh / 2 - 3.5, T2) + arrow(bx + btnW - bh / 2, btnY + bh / 2, bh * 0.2, chipFg, Math.max(1.4, fs * 0.13));
      rdRatio = 1;
    } else {
      const r = lerp(2, 8, brad), cx0 = bx + btnW - bh;
      svgB += pth(`M${P(bx + r, btnY)}H${f(cx0)}V${f(btnY + bh)}H${f(bx + r)}A${P(r, r)} 0 0 1 ${P(bx, btnY + bh - r)}V${f(btnY + r)}A${P(r, r)} 0 0 1 ${P(bx + r, btnY)}Z`, F, hair(F, B))
        + pth(`M${P(cx0, btnY)}H${f(bx + btnW - r)}A${P(r, r)} 0 0 1 ${P(bx + btnW, btnY + r)}V${f(btnY + bh - r)}A${P(r, r)} 0 0 1 ${P(bx + btnW - r, btnY + bh)}H${f(cx0)}Z`, T2)
        + arrow(cx0 + bh / 2, btnY + bh / 2, bh * 0.2, chipFg, Math.max(1.4, fs * 0.13));
      rdRatio = r / (bh / 2);
    }
    svgB += lab(bx + padL + tW(fs) / 2, bh, C);
    parts = 3; body = 1; inkB = btnW * bh;
  } else { // 9: underlined link
    const gapA = fs * 0.55, aw = t4 < 0.5 ? fs * 0.9 : 0; btnW = tW(fs) + (aw ? gapA + aw : 0); const bx = place(btnW);
    const uy = base(bh) + fs * 0.32, th = lerp(2, 3.4, E.rad);
    svgB += T(bx, base(bh), txt, fs, lw, lsL, C, "start") + rr(bx, uy, tW(fs) - lsL * fs, th, th / 2, accent) + (aw ? arrow(bx + tW(fs) + gapA + aw / 2, btnY + bh / 2, aw * 0.5, C, Math.max(1.4, fs * 0.13)) : "");
    parts = aw ? 3 : 2; body = 0.22; rdRatio = 0.4; inkB = btnW * fs * 1.4;
  }
  out += svgB;

  const frame = bgDark ? { stroke: mix(B, "#ffffff", 0.14), "stroke-width": 1 } : {};
  const svg = svgRoot(W, H, rect(0, 0, W, H, B, { rx: 12, ...frame }) + out);

  // ---- legibility (the label vs the colour directly behind it)
  const cr = Math.round(Math.min(contrast(C, S), contrast(headCol, B)) * 10) / 10;
  const size = clamp((fs / H) * 6.25, 0.1, 1);
  const score = 0.7 * Math.min(1, Math.log(cr) / Math.log(12)) + 0.3 * size;

  // ---- traits
  const accentUsed = isFill ? F : (K ?? a);
  const hues = [a, accentUsed];
  if (st === 8 || st === 9 || eyebrow) hues.push(b);
  const impact = clamp(satOf(accentUsed) * 0.7 + (1 - lightness(accentUsed) / 100) * 0.5);
  const headHeft = clamp(((hw - 500) / 300) * 0.5 + ((hfs - 17) / 12) * 0.5, 0, 1);
  const labelHeft = clamp((lw - 400) / 400 * 0.7 + (fs - 10) / 7 * 0.3, 0, 1);
  const btnShare = clamp(inkB / (contentW * 40), 0, 1);
  const rawBold = 0.3 * body + 0.2 * labelHeft + 0.22 * headHeft + 0.14 * btnShare + 0.14 * impact;
  const bold = clamp(4.6 * rawBold - 2.25);
  const round = clamp(0.8 * (2 * clamp(rdRatio, 0, 1) - 1) + 0.2 * drd);
  const hwid = Math.max(...hl.lines.map((s) => tw(s, hfs, hw, hls)));
  const inkArea = hwid * hl.lines.length * hfs * 0.85 + tw(sub, sfit, 400, 0.004) * sfit * 0.85 + inkB;
  const airy = clamp((0.41 - Math.sqrt(inkArea / (W * H))) * 7.5);
  const rich = richOf(hl.lines.length + 1 + parts + dn + (eyebrow ? 1 : 0), 3.5, 8);
  return {
    name: `${STYLE_NAMES[st]} / ${["bg", "surface", "dark", "brand"][scheme]} / ${["poor", "mid", "excellent"][cat]} / ${["en", "ru", "kk"][lang]}${mixed ? "+" : ""} / ${center ? "centre" : "left"}`,
    svg,
    traits: { warm: warmOf([B, ...hues]), bold, round, airy, vivid: vividOf(hues), rich, dark: darkOf(B) },
    legibility: { score: Math.round(score * 100) / 100, contrast: cr, size: Math.round(size * 100) / 100 },
  };
}
