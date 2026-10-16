// UI CARDS -- ten card layouts on a page: product (image top), image + floating info panel, minimal text card, list of items,
// pricing tier, profile, article, stat, compact tile, hero. Abstract "images" are built from the palette (landscapes, blobs, arches,
// slices, halftone, waves, Bauhaus geometry, mountains, rings): no photos.
//
// A season-level plan (a pure function of ctx.season) assigns layout (each of the 10 appears 3-4x), palette, ground, legibility class
// (exactly 8 poor, 8 excellent, 16 middling), spacing scale (tight 8 .. airy 24), type hierarchy (strong .. flat), corner radius
// (0 .. 22), edge (soft shadow / hairline / flat tint), art, language (Latin, Russian, Kazakh) ... so every pool is varied.
//
// Legibility: main text = the card TITLE. contrast = WCAG(title colour, colour directly behind it: the card surface, a plate or a colour block),
//   size = fs / 260 * 6.25;  score = 0.7 * min(1, ln(contrast) / ln(12)) + 0.3 * size.
//   poor: 1.5-2.9, middling 3.9-8, excellent 10.7-16.7.
//
// Traits (all in [-1, 1]):
//   warm  = warmOf(page + surface + brand colours + art)       vivid = vividOf([a, b, c])
//   dark  = 1 - meanLightness / 50   (page, card surface and art, area weighted)
//   bold  = 4.2 * (0.28 * titleHeft + 0.24 * imageImpact + 0.18 * ctaHeft + 0.16 * edge + 0.14 * tightness) - 2.1
//           titleHeft: weight and size of the title, imageImpact: saturated / dark share of the card, tightness: 1 - spacing scale
//   round = 0.55 * cornerRadius + 0.25 * artRoundness + 0.2 * buttonRoundness       (radius 0 -> -1 ... 22 -> +1)
//   airy  = clamp((emptyShare - 0.5) * 3.4)       emptyShare = canvas not covered by text, art, buttons and chips (page margin counts)
//   rich  = richOf(text runs + chips + dots + art shapes + buttons, 9, 24)
import { svgRoot, rect, el, esc } from "../svgutil.js";
import { PALETTES, CTA_LABELS } from "../palettes.js";
import { mix, contrast, hexToHsl, hsl, lightness } from "../color.js";
import { warmOf, vividOf, richOf, clamp } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "trust", "quality", "clarity", "purchaseIntent"];
export const TEXT = true;
export const VIEWBOX = [240, 260];

const W = 240, H = 260;
const FF = "Inter, system-ui, sans-serif";

/* ------------------------------------------------------------------ helpers */
const f = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const lerp = (a, b, t) => a + (b - a) * t;
const P = (...n) => n.map(f).join(" ");
const rr = (x, y, w, h, r, fill, x2) => el("rect", { x: f(x), y: f(y), width: f(w), height: f(h), rx: f(Math.max(0, Math.min(r, w / 2, h / 2))), fill, ...x2 });
const circ = (cx, cy, r, fill, x) => el("circle", { cx: f(cx), cy: f(cy), r: f(r), fill, ...x });
const pth = (d, fill, x) => el("path", { d, fill, ...x });
const poly = (arr, fill, x) => el("polygon", { points: arr.map(([px, py]) => `${f(px)},${f(py)}`).join(" "), fill, ...x });
const strk = (d, color, w, x) => el("path", { d, fill: "none", stroke: color, "stroke-width": f(w), "stroke-linecap": "round", "stroke-linejoin": "round", ...x });
const grp = (tr, inner) => `<g transform="${tr}">${inner}</g>`;

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
/** Greedy word wrap into lines of width <= maxW: tries maxLines .. hardLines lines and shrinks the type (never below minFs). */
function wrap(str, maxW, fs, w, ls, maxLines, minFs = 8, hardLines = maxLines) {
  const greedy = (size) => {
    const lines = []; let cur = "";
    for (const wd of str.split(" ")) {
      const t = cur ? cur + " " + wd : wd;
      if (cur && tw(t, size, w, ls) > maxW) { lines.push(cur); cur = wd; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const lo = Math.min(minFs, fs);
  for (let ml = maxLines; ml <= hardLines; ml++) {
    for (let k = 0; k <= 12; k++) {
      const size = fs - (k * (fs - lo)) / 12, lines = greedy(size);
      if (lines.length <= ml && lines.every((l) => tw(l, size, w, ls) <= maxW * 1.002)) return { lines, fs: size };
    }
  }
  return { lines: greedy(lo), fs: lo };
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
const at = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];
const strength = (c) => clamp(satOf(c) * 0.75 + (1 - lightness(c) / 100) * 0.55);

/* ------------------------------------------------------------------ copy (Latin / Russian / Kazakh) */
const TX = [
  { // English
    product: ["Linen throw", "Ceramic mug", "Walnut tray", "Daily kettle", "Wool scarf", "Studio lamp", "Oak stool", "Glass carafe"],
    psub: ["Hand-finished in small batches", "Soft, washed and made to last", "Oak, brass and good light", "Free delivery over $40", "Stoneware, glazed by hand"],
    article: ["The slow city", "Small habits that stick", "Notes from the studio", "Why quiet design wins", "A week without screens", "Making room for light"],
    excerpt: ["Eight minutes on why the best places never rush you.", "What we learned after a year of building in the open.", "A short guide to materials that age well."],
    cat: ["Journal", "Design", "Guide", "Essay"], meta: ["5 min read", "8 min read", "3 min read"], date: ["Oct 12", "Nov 3", "Sep 28"],
    name: ["Mira Lind", "Eli Hart", "Nora Vale", "Theo Rask"], role: ["Product designer", "Ceramicist", "Editor", "Illustrator"],
    plan: ["Starter", "Studio", "Team", "Solo"], feat: ["3 projects", "Unlimited projects", "Custom domain", "Priority support", "Export to PDF", "Team seats"], per: "/mo",
    stat: ["Weekly visits", "Revenue", "New orders", "Active users"], tile: ["Focus mode", "Dark theme", "Reminders", "Sync"], tsub: ["Mute everything", "Easy on the eyes", "3 today", "All devices"],
    hero: ["Fresh start", "Less is more", "Made to last", "Slow morning"], hsub: ["Everything you need, nothing you don't.", "Simple tools for calmer days."],
    pst: ["Posts", "Rating", "Fans"], tag: ["NEW", "SALE", "ECO"], pop: "Popular", saved: "Saved", cta: [["Buy now", "Order today"], ["Learn more", "Get started"], ["Subscribe", "Try free"]],
  },
  { // Russian
    product: ["Льняной плед", "Керамическая кружка", "Ореховый поднос", "Дневной чайник", "Шерстяной шарф", "Лампа для студии"],
    psub: ["Ручная работа, малые партии", "Мягкий, стираный, надолго", "Дерево, латунь и тёплый свет", "Бесплатная доставка", "Керамика, глазурь вручную"],
    article: ["Медленный город", "Маленькие привычки", "Заметки из мастерской", "Тишина в дизайне", "Неделя без экранов", "Больше света"],
    excerpt: ["Восемь минут о том, почему лучшие места не торопят.", "Чему мы научились за год работы в открытую.", "Короткий гид по материалам, что стареют красиво."],
    cat: ["Журнал", "Дизайн", "Гид", "Эссе"], meta: ["5 мин чтения", "8 мин чтения", "3 мин чтения"], date: ["12 окт", "3 ноя", "28 сен"],
    name: ["Мира Лис", "Илья Север", "Нина Ветер", "Тимур Рас"], role: ["Продуктовый дизайнер", "Керамист", "Редактор", "Иллюстратор"],
    plan: ["Старт", "Студия", "Команда", "Соло"], feat: ["3 проекта", "Безлимит проектов", "Свой домен", "Приоритетная поддержка", "Экспорт в PDF", "Командные места"], per: "/мес",
    stat: ["Визиты за неделю", "Выручка", "Новые заказы", "Активные"], tile: ["Режим фокуса", "Тёмная тема", "Напоминания", "Синхронизация"], tsub: ["Без уведомлений", "Мягкий свет", "3 на сегодня", "Все устройства"],
    hero: ["Новый вкус", "Лето рядом", "Просто и чисто", "Время для себя"], hsub: ["Всё нужное — в одном месте.", "Простые вещи для спокойных дней."],
    pst: ["Работ", "Рейтинг", "Фанаты"], tag: ["НОВОЕ", "СКИДКА", "ЭКО"], pop: "Выбор", saved: "Сохранённое", cta: [["Купить", "Заказать"], ["Подробнее", "Начать"], ["Подписаться", "Попробовать"]],
  },
  { // Kazakh
    product: ["Зығыр көрпе", "Керамика кесе", "Жаңғақ науа", "Күнделікті шәйнек", "Жүн орамал", "Шам-шырақ"],
    psub: ["Қолдан жасалған, шағын топтама", "Жұмсақ әрі берік", "Ағаш, жез және жылы жарық", "Тегін жеткізу", "Қыш, қолмен әйнектелген"],
    article: ["Баяу қала", "Кішкентай әдеттер", "Шеберханадан жазбалар", "Тыныш дизайн", "Экрансыз апта", "Жарыққа орын"],
    excerpt: ["Ең жақсы орындар неге асықтырмайды: сегіз минут.", "Бір жыл ашық жұмыс істегенде не үйрендік.", "Әдемі ескіретін материалдарға қысқа нұсқаулық."],
    cat: ["Журнал", "Дизайн", "Нұсқаулық", "Эссе"], meta: ["5 мин оқу", "8 мин оқу", "3 мин оқу"], date: ["12 қаз", "3 қар", "28 қыр"],
    name: ["Айла Нұр", "Дәулет Жан", "Арман Таң", "Мира Сай"], role: ["Өнім дизайнері", "Қыш шебері", "Редактор", "Суретші"],
    plan: ["Бастау", "Студия", "Топ", "Жеке"], feat: ["3 жоба", "Шексіз жоба", "Жеке домен", "Басым қолдау", "PDF экспорты", "Топ орындары"], per: "/ай",
    stat: ["Апталық кірулер", "Табыс", "Жаңа тапсырыс", "Белсенділер"], tile: ["Фокус режимі", "Қараңғы тақырып", "Еске салғыш", "Синхрон"], tsub: ["Хабарламасыз", "Жұмсақ жарық", "Бүгінге 3", "Барлық құрылғы"],
    hero: ["Жаңа дәм", "Таза ауа", "Өз қолыңмен", "Бүгін бастаймыз"], hsub: ["Қажеттінің бәрі бір жерде.", "Тыныш күндерге қарапайым заттар."],
    pst: ["Жұмыс", "Рейтинг", "Оқырман"], tag: ["ЖАҢА", "ЖЕҢІЛДІК", "ЭКО"], pop: "Таңдау", saved: "Сақталған", cta: [["Сатып алу", "Тапсырыс беру"], ["Көру", "Бастау"], ["Көру", "Бастау"]],
  },
];

/* ------------------------------------------------------------------ season plan */
const LAYOUT_NAMES = ["Product", "Overlay", "Minimal", "List", "Pricing", "Profile", "Article", "Stat", "Tile", "Hero"];
function entry(season, i) {
  const r = mulberry32(hashStringToSeed(`card|plan|${season}`));
  const order = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const vOff = Array.from({ length: 10 }, () => Math.floor(r() * 4));
  const pal = shuffle(r, PALETTES.map((_, j) => j));
  const schemes = shuffle(r, [...Array(11).fill(0), ...Array(5).fill(1), ...Array(8).fill(2), ...Array(4).fill(3), ...Array(4).fill(4)]);
  const cats = shuffle(r, [...Array(8).fill(0), ...Array(8).fill(2), ...Array(16).fill(1)]);
  const tones = shuffle(r, [...Array(5).fill(1), ...Array(2).fill(2), ...Array(25).fill(0)]);
  const langs = shuffle(r, [...Array(12).fill(0), ...Array(10).fill(1), ...Array(10).fill(2)]);
  const edges = shuffle(r, [...Array(13).fill(0), ...Array(12).fill(1), ...Array(7).fill(2)]);
  const strat = () => shuffle(r, Array.from({ length: 32 }, (_, j) => (j + 0.5 + (r() - 0.5) * 0.8) / 32));
  const us = strat(), sps = strat(), hiers = strat(), rads = strat(), ms = strat();
  const artOff = Math.floor(r() * 9), picks = shuffle(r, Array.from({ length: 32 }, (_, j) => j));
  const layout = order[i % 10], k = Math.floor(i / 10);
  return { layout, k, v: (vOff[layout] + k) % 4, pal: pal[i], scheme: schemes[i], cat: cats[i], tone: tones[i], lang: langs[i], edge: edges[i], u: us[i], sp: sps[i], hier: hiers[i], rad: rads[i], m: ms[i], art: (i + artOff) % 9, pick: picks[i] };
}

/* ------------------------------------------------------------------ abstract art ("images") from the palette
   Each draws into the box (x, y, w, h) (the caller clips it) and returns { s, n, rd (roundness), imp (visual impact 0..1) }. */
function art(kind, x, y, w, h, K, t, v) {
  const m = Math.min(w, h), { a, b, deep, tint, light, dark } = K;
  let s = "", n = 3, rd = 0.5;
  switch (kind) {
    case 0: { // landscape: sun and two hills
      const sx = x + w * lerp(0.25, 0.75, t), sy = y + h * 0.34;
      s = rect(x, y, w, h, tint) + circ(sx, sy, m * 0.16, K.b)
        + pth(`M${P(x, y + h * 0.7)}C${P(x + w * 0.28, y + h * 0.46)} ${P(x + w * 0.62, y + h * 0.82)} ${P(x + w, y + h * 0.58)}V${P(y + h)}H${P(x)}Z`, a)
        + pth(`M${P(x, y + h * 0.86)}C${P(x + w * 0.3, y + h * 0.66)} ${P(x + w * 0.7, y + h * 0.96)} ${P(x + w, y + h * 0.74)}V${P(y + h)}H${P(x)}Z`, deep);
      n = 4; rd = 0.6; break;
    }
    case 1: { // soft blobs
      s = rect(x, y, w, h, tint) + circ(x + w * 0.34, y + h * 0.56, m * 0.36, a)
        + `<ellipse cx="${f(x + w * 0.68)}" cy="${f(y + h * 0.42)}" rx="${f(w * 0.3)}" ry="${f(h * 0.25)}" fill="${K.b}" transform="rotate(${f(-18 + t * 30)} ${f(x + w * 0.68)} ${f(y + h * 0.42)})"/>`
        + circ(x + w * 0.5, y + h * 0.78, m * 0.14, deep) + circ(x + w * 0.82, y + h * 0.78, m * 0.06, light);
      n = 5; rd = 1; break;
    }
    case 2: { // arches
      const aw = w * 0.26, g = w * 0.04, x0 = x + (w - (3 * aw + 2 * g)) / 2, hs = [0.78, 0.6, 0.46], cols = [light, K.b, deep];
      s = rect(x, y, w, h, a);
      hs.forEach((q, i) => { const ah = h * q, ax = x0 + i * (aw + g), ay = y + h - ah; s += pth(`M${P(ax, y + h)}V${P(ay + aw / 2)}A${P(aw / 2, aw / 2)} 0 0 1 ${P(ax + aw, ay + aw / 2)}V${P(y + h)}Z`, cols[i]); });
      n = 4; rd = 0.35; break;
    }
    case 3: { // diagonal slices and a disc
      const sk = h * 0.55, cols = [a, deep, K.b, light];
      s = rect(x, y, w, h, tint);
      for (let i = 0; i < 4; i++) { const xa = x + (w + sk) * (i / 4) - sk * 0.4, xb = x + (w + sk) * ((i + 1) / 4) - sk * 0.4 + 0.5; s += poly([[xa + sk, y], [xb + sk, y], [xb, y + h], [xa, y + h]], cols[i]); }
      s += circ(x + w * 0.2, y + h * 0.3, m * 0.13, light);
      n = 6; rd = -0.4; break;
    }
    case 4: { // halftone dots
      const cols = 7, p = w / cols, rows = Math.min(5, Math.max(3, Math.floor(h / p)));
      s = rect(x, y, w, h, deep); n = 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const g = i / (cols - 1), r = p * 0.46 * (0.16 + 0.84 * g * (0.75 + 0.25 * Math.sin(j * 1.3 + t * 5)));
        if (r > 1) { s += circ(x + p * (i + 0.5), y + (h - rows * p) / 2 + p * (j + 0.5), r, g > 0.8 ? K.b : a); n++; }
      }
      n = Math.min(n, 12); rd = 0.85; break;
    }
    case 5: { // layered waves
      s = rect(x, y, w, h, tint);
      const wv = (yy, col) => pth(`M${P(x, y + h * yy)}Q${P(x + w * 0.25, y + h * (yy - 0.2))} ${P(x + w * 0.5, y + h * yy)}T${P(x + w, y + h * yy)}V${P(y + h)}H${P(x)}Z`, col);
      s += wv(0.5, K.b) + wv(0.66, a) + wv(0.82, deep); n = 4; rd = 0.8; break;
    }
    case 6: { // Bauhaus geometry
      s = rect(x, y, w, h, light) + pth(`M${P(x, y + h)}V${P(y + h - m * 0.9)}A${P(m * 0.9, m * 0.9)} 0 0 1 ${P(x + m * 0.9, y + h)}Z`, a)
        + circ(x + w * 0.74, y + h * 0.36, m * 0.2, K.b) + rr(x + w * 0.52, y + h * 0.58, m * 0.26, m * 0.26, m * 0.03, deep);
      n = 4; rd = 0.2; break;
    }
    case 7: { // mountains and a sun
      s = rect(x, y, w, h, tint) + circ(x + w * 0.74, y + h * 0.3, m * 0.14, K.b)
        + poly([[x - w * 0.05, y + h], [x + w * 0.3, y + h * 0.3], [x + w * 0.66, y + h]], a)
        + poly([[x + w * 0.35, y + h], [x + w * 0.68, y + h * 0.46], [x + w * 1.05, y + h]], deep);
      n = 4; rd = -0.7; break;
    }
    default: { // concentric rings
      const cx = x + w * 0.68, cy = y + h * 0.52, cols = [light, K.b, deep, light];
      s = rect(x, y, w, h, a);
      for (let i = 0; i < 4; i++) s += circ(cx, cy, m * (0.56 - i * 0.125), cols[i]);
      n = 5; rd = 1; break;
    }
  }
  return { s, n, rd, imp: clamp((strength(a) + strength(deep)) / 2 + 0.1) };
}

/* ------------------------------------------------------------------ small parts */
function chipEl(x, y, label, fs, fill, ink, anchor = "start") {
  const w = tw(label, fs, 700, 0.06) + fs * 1.4, h = fs * 1.9, x0 = anchor === "end" ? x - w : x;
  return { svg: rr(x0, y, w, h, h / 2, fill) + T(x0 + w / 2, y + h / 2 + fs * 0.36, label, fs, 700, 0.06, ink, "middle"), w, h, x0 };
}
function btnEl(x, y, label, fs, h, style, fill, ink, wFixed, anchor = "start") {
  const up = style === 2, txt = up ? label.toUpperCase() : label, ls = up ? 0.07 : 0.015;
  const w = wFixed ?? tw(txt, fs, 700, ls) + h * 1.1, x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  const rx = style === 1 ? h / 2 : style === 2 ? 0 : style === 3 ? 4 : Math.min(h / 2, 6);
  let s = style === 4 ? rr(x0 + 0.6, y + 0.6, w - 1.2, h - 1.2, rx, "none", { stroke: fill, "stroke-width": 1.2 }) : rr(x0, y, w, h, rx, fill);
  s += T(x0 + w / 2, y + h / 2 + fs * 0.355, txt, fs, 700, ls, style === 4 ? fill : ink, "middle");
  return { svg: s, w, h, x0, rd: style === 1 ? 1 : style === 2 ? -1 : style === 3 ? -0.5 : -0.1 };
}
const dots5 = (x, y, filled, col, empty, r = 2.5, gap = 3) => { let s = ""; for (let i = 0; i < 5; i++) s += circ(x + r + i * (2 * r + gap), y, r, i < filled ? col : empty); return s; };
const check = (cx, cy, sz, col) => strk(`M${P(cx - sz * 0.5, cy + sz * 0.02)}L${P(cx - sz * 0.12, cy + sz * 0.4)}L${P(cx + sz * 0.52, cy - sz * 0.38)}`, col, Math.max(1.3, sz * 0.2));
const arrowR = (cx, cy, sz, col, sw = 1.4) => strk(`M${P(cx - sz, cy)}H${f(cx + sz)}M${P(cx + sz * 0.1, cy - sz * 0.75)}L${P(cx + sz, cy)}L${P(cx + sz * 0.1, cy + sz * 0.75)}`, col, sw);
function avatar(cx, cy, r, fill, ink, letter, ring, ringCol) {
  return (ring ? circ(cx, cy, r + ring, ringCol) : "") + circ(cx, cy, r, fill) + T(cx, cy + r * 0.36, letter, r * 1.0, 800, 0, ink, "middle");
}
function clipPathRound(cid, x, y, w, h, r, top = true, bottom = true) {
  const t = top ? r : 0, b = bottom ? r : 0;
  return `<clipPath id="${cid}"><path d="M${P(x + t, y)}H${f(x + w - t)}${t ? `A${P(t, t)} 0 0 1 ${P(x + w, y + t)}` : ""}V${P(y + h - b)}${b ? `A${P(b, b)} 0 0 1 ${P(x + w - b, y + h)}` : ""}H${f(x + b)}${b ? `A${P(b, b)} 0 0 1 ${P(x, y + h - b)}` : ""}V${P(y + t)}${t ? `A${P(t, t)} 0 0 1 ${P(x + t, y)}` : ""}Z"/></clipPath>`;
}

/* ------------------------------------------------------------------ the ten layouts
   Each draws a card in local coordinates (card top-left = 0,0, width c.cw) and returns
   { svg, h, n (text runs + parts), art (art shapes), rdArt, btnRd, imp (image impact), tFs, behind (colour behind the title), tCol, cover (inked share of the card) }. */
function L0(c) { // product card: image on top, title, sub, rating / chips, price + button
  const { cw, sp, K, S, text, id } = c;
  const bleed = c.v % 2 === 0, inset = bleed ? 0 : Math.min(sp, 12), iw = cw - 2 * inset, tmax = cw - 2 * sp;
  const title = at(text.product, c.sel(0)), sub = at(text.psub, c.sel(1));
  const tl = wrap(title, tmax, Math.min(c.tFs, 21), c.tW, c.tls, 2, 13.2, 3), sl = wrap(sub, tmax, c.subFs, 400, 0.004, 2);
  const bh = 24, ratingH = 10, lh = 1.16;
  const textH = tl.lines.length * tl.fs * lh + 5 + sl.lines.length * sl.fs * 1.28 + 8 + ratingH + 9 + bh;
  const gap = sp * 0.85;
  const ih = clamp(c.chT - inset - gap - textH - sp, 62, 140);
  const rimg = Math.max(0, c.r - inset);
  let s = "", n = 0;
  const cid = `${id}-i`;
  const A = art(c.artKind, inset, inset, iw, ih, K, c.t1, c.v);
  s += `<defs>${clipPathRound(cid, inset, inset, iw, ih, bleed ? c.r : Math.min(c.r, 10), true, !bleed ? true : false)}</defs><g clip-path="url(#${cid})">${A.s}</g>`;
  if (c.t2 < 0.65) { const ch = chipEl(inset + 9, inset + 9, text.tag[Math.floor(c.t3 * 3)], 6.6, c.S, c.ink); s += ch.svg; n++; }
  let y = inset + ih + gap;
  tl.lines.forEach((ln, i) => { s += T(sp, y + tl.fs * 0.8 + i * tl.fs * lh, ln, tl.fs, c.tW, c.tls, c.tCol); });
  y += tl.lines.length * tl.fs * lh + 5;
  sl.lines.forEach((ln, i) => { s += T(sp, y + sl.fs * 0.8 + i * sl.fs * 1.28, ln, sl.fs, 400, 0.004, c.mCol); });
  y += sl.lines.length * sl.fs * 1.28 + 8;
  if (c.v < 2) { s += dots5(sp, y + 4, 4, K.b, c.hair, 2.4, 2.8) + T(sp + 5 * 7.6 + 4, y + 7, "4.8", 8.4, 700, 0, c.mCol) + T(sp + 5 * 7.6 + 4 + tw("4.8", 8.4, 700) + 3, y + 7, "(128)", 8.4, 400, 0, mix(S, c.mCol, 0.7)); n += 3; }
  else { const c1 = chipEl(sp, y - 1, text.tag[1], 6.6, c.tint2, c.tintInk), c2 = chipEl(sp + c1.w + 5, y - 1, text.tag[2], 6.6, c.tint2, c.tintInk); s += c1.svg + c2.svg; n += 2; }
  y += ratingH + 9;
  const price = ["$24", "$118", "€39", "$62", "$9.90"][c.sel(2) % 5], pf = clamp(c.tFs * 0.82, 14, 19);
  s += T(sp, y + bh / 2 + pf * 0.36, price, pf, 800, -0.01, c.priceCol);
  const bt = btnEl(cw - sp, y, c.cta[0], 8.6, bh, c.btnStyle, c.btnFill, c.btnInk, undefined, "end");
  s += bt.svg; n += 3;
  const h = y + bh + sp;
  return { svg: s, h, n, art: A.n, rdArt: A.rd, btnRd: bt.rd, imp: A.imp, tFs: tl.fs, behind: S, tCol: c.tCol, cover: (iw * ih + 0.35 * cw * (h - ih)) / (cw * h), ctaHeft: 0.7 };
}

function L1(c) { // full-bleed art with a floating info panel
  const { cw, sp, K, S, text, id } = c;
  const pm = Math.max(8, Math.min(sp * 0.8, 14)), pw = cw - 2 * pm, tmax = pw - 2 * Math.min(sp, 14);
  const pad = Math.min(sp, 14) * 0.95;
  const plate = c.plate;
  const title = at(text.product, c.sel(3)), sub = at(text.psub, c.sel(4));
  const tl = wrap(title, tmax, Math.min(c.tFs, 19), c.tW, c.tls, 2, 13.2, 3), sl = wrap(sub, tmax, c.subFs, 400, 0.004, 1);
  const bh = 22;
  const ph = pad + tl.lines.length * tl.fs * 1.16 + 4 + sl.lines.length * sl.fs * 1.28 + 9 + bh + pad;
  const h = clamp(c.chT, ph + 96, 236), rp = Math.max(4, c.r - pm + 2);
  let s = "", n = 0;
  const cid = `${id}-i`;
  const A = art(c.artKind, 0, 0, cw, h - 24, K, c.t1, c.v);
  s += `<defs>${clipPathRound(cid, 0, 0, cw, h, c.r, true, true)}</defs><g clip-path="url(#${cid})">${A.s}${rect(0, h - 26, cw, 26, plate.art)}</g>`;
  const py = h - pm - ph;
  s += rr(pm, py, pw, ph, rp, plate.fill);
  let y = py + pad;
  tl.lines.forEach((ln, i) => { s += T(pm + pad, y + tl.fs * 0.8 + i * tl.fs * 1.16, ln, tl.fs, c.tW, c.tls, plate.tCol); });
  y += tl.lines.length * tl.fs * 1.16 + 4;
  sl.lines.forEach((ln, i) => { s += T(pm + pad, y + sl.fs * 0.8, ln, sl.fs, 400, 0.004, plate.mCol); });
  y += sl.lines.length * sl.fs * 1.28 + 9;
  const price = ["$24", "$118", "€39", "$62"][c.sel(2) % 4];
  s += T(pm + pad, y + bh / 2 + 6, price, 15, 800, -0.01, plate.pCol);
  const bt = btnEl(pm + pw - pad, y, c.cta[0], 8.4, bh, c.btnStyle, plate.btnFill, plate.btnInk, undefined, "end");
  s += bt.svg; n += 5;
  if (c.t2 < 0.7) { const ch = chipEl(10, 10, text.tag[Math.floor(c.t3 * 3)], 6.6, plate.fill, plate.tCol); s += ch.svg; n++; }
  if (c.t4 < 0.5) { s += rr(cw - 10 - 52, 10, 52, 17, 8.5, plate.fill) + dots5(cw - 10 - 52 + 8, 18.5, 4, K.b, plate.hair, 2.2, 2.6); n += 2; }
  return { svg: s, h, n, art: A.n, rdArt: A.rd, btnRd: bt.rd, imp: A.imp, tFs: tl.fs, behind: plate.fill, tCol: plate.tCol, cover: 0.92, ctaHeft: 0.7 };
}

function L2(c) { // minimal text card
  const { cw, sp, K, S, text } = c;
  const tmax = cw - 2 * sp;
  const title = at(text.article, c.sel(0)), ex = at(text.excerpt, c.sel(1));
  const tl = wrap(title, tmax, Math.min(c.tFs * 1.08, 25), c.tW, c.tls, 3, 13.2, 4), el2 = wrap(ex, tmax, c.subFs + 0.4, 400, 0.004, 4);
  const lh = c.hier > 0.5 ? 1.1 : 1.18;
  let s = "", n = 0, y = sp;
  const cat = at(text.cat, c.sel(2));
  s += T(sp, y + 7, cat.toUpperCase(), 7.2, 700, 0.12, c.accentInk) + circ(cw - sp - 6, y + 4, 6, "none", { stroke: K.a, "stroke-width": 1.8 }) + circ(cw - sp - 3, y + 7, 3, K.b);
  y += 22 + sp * 0.4; n += 3;
  tl.lines.forEach((ln, i) => { s += T(sp, y + tl.fs * 0.8 + i * tl.fs * lh, ln, tl.fs, c.tW, c.tls, c.tCol); });
  y += tl.lines.length * tl.fs * lh + sp * 0.5; n += tl.lines.length;
  s += rect(sp, y, Math.min(34, tmax * 0.3), 2.4, K.a); y += 2.4 + sp * 0.6; n++;
  el2.lines.forEach((ln, i) => { s += T(sp, y + el2.fs * 0.8 + i * el2.fs * 1.42, ln, el2.fs, 400, 0.004, c.mCol); });
  y += el2.lines.length * el2.fs * 1.42 + sp * 0.8; n += el2.lines.length;
  const by = Math.max(y, Math.min(c.chT - sp - 16, y + 16 + sp * 0.8));
  s += rect(sp, by - 9, tmax, 1, c.hair);
  const lk = c.cta[1], wLink = tw(lk, 8.8, 700, 0.01) + 16;
  let metaStr = at(text.date, c.sel(0)) + " · " + at(text.meta, c.sel(1));
  if (tw(metaStr, 8.4, 500, 0.01) + wLink + 10 > tmax) metaStr = at(text.date, c.sel(0));
  s += T(sp, by + 9, metaStr, 8.4, 500, 0.01, c.mCol);
  s += T(cw - sp - 11, by + 9, lk, 8.8, 700, 0.01, c.accentInk, "end") + arrowR(cw - sp - 4, by + 6.4, 3.6, c.accentInk, 1.4);
  n += 3;
  const h = by + 9 + sp * 0.9 + 4;
  return { svg: s, h, n, art: 3, rdArt: 1, btnRd: 0, imp: 0.2, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.32, ctaHeft: 0.2 };
}

function L3(c) { // list of items with thumbnails
  const { cw, sp, K, S, text, id } = c;
  const ps = Math.min(sp, 16), rowH = clamp((c.chT - 2 * ps - 20) / 3, 56, 70), th = rowH - 16;
  let s = "", n = 0, y = ps;
  s += T(ps, y + 8, text.saved.toUpperCase(), 7.2, 700, 0.12, c.mCol) + chipEl(cw - ps, y - 1, "3", 7, c.tint2, c.tintInk, "end").svg;
  y += 18; n += 2;
  const cid = `${id}-i`;
  let clip = "", arts = "", artN = 0, rdA = 0, impA = 0, firstFs = 14;
  const rt = Math.min(c.r, 9), tx = ps, tx2 = tx + th + 11, mw = cw - ps - tx2 - ps - 8;
  for (let i = 0; i < 3; i++) {
    const ry = y + i * rowH, ty = ry + (rowH - th) / 2;
    clip += rr(tx, ty, th, th, rt, "#000");
    const A = art((c.artKind + i * 3) % 9, tx, ty, th, th, K, (c.t1 + i * 0.31) % 1, c.v); arts += A.s; artN += A.n; rdA += A.rd / 3; impA += A.imp / 3;
    const cands = text.product.filter((t) => tw(t, 13.4, c.tW, c.tls) <= mw);
    const title = cands.length ? at(cands, c.sel(0) + i * 2) : at(text.product, c.sel(0) + i * 2);
    const tl = wrap(title, mw, Math.min(c.tFs, 15), c.tW, c.tls, 1, 13.2, 2);
    const mfs = 8.6, blockH = tl.lines.length * tl.fs * 1.18 + 4 + mfs * 1.2, by = ry + (rowH - blockH) / 2;
    tl.lines.forEach((ln, q) => { s += T(tx2, by + tl.fs * 0.82 + q * tl.fs * 1.18, ln, tl.fs, c.tW, c.tls, c.tCol); });
    const my = by + tl.lines.length * tl.fs * 1.18 + 4 + mfs * 0.8;
    const pr = at(["$24", "$118", "€39", "$62", "$9"], c.sel(2) + i);
    s += circ(tx2 + 2.6, my - 2.6, 2.6, K.b) + T(tx2 + 8, my, "4." + (8 - i), mfs, 700, 0, c.mCol) + T(tx2 + 8 + tw("4.8", mfs, 700) + 5, my, "·  " + pr, mfs, 700, 0, c.priceCol);
    s += arrowR(cw - ps - 4, ry + rowH / 2, 3.4, c.mCol, 1.3);
    if (i < 2) s += rect(tx2, ry + rowH, cw - ps - tx2, 1, c.hair);
    n += 5; if (i === 0) firstFs = tl.fs;
  }
  const defs = `<defs><clipPath id="${cid}">${clip}</clipPath></defs><g clip-path="url(#${cid})">${arts}</g>`;
  const h = y + 3 * rowH + ps * 0.7;
  return { svg: defs + s, h, n, art: artN, rdArt: rdA, btnRd: 0, imp: impA, tFs: firstFs, behind: S, tCol: c.tCol, cover: 0.5, ctaHeft: 0.1 };
}

function L4(c) { // pricing tier
  const { cw, sp, K, S, text } = c;
  const ps = Math.max(sp, 12), tmax = cw - 2 * ps;
  const plan = at(text.plan, c.sel(0));
  const tl = wrap(plan, tmax - 54, Math.min(c.tFs * 0.95, 20), c.tW, c.tls, 1, 13.2, 2);
  let s = "", n = 0, y = ps;
  s += T(ps, y + tl.fs * 0.8, tl.lines[0], tl.fs, c.tW, c.tls, c.tCol);
  const pop = chipEl(cw - ps, y - 1, text.pop.toUpperCase(), 6.4, K.a, c.aInk, "end"); if (c.v % 2 === 0) { s += pop.svg; n++; }
  y += tl.fs * 1.2 + 4;
  const pr = ["24", "12", "49", "9", "79"][c.sel(1) % 5], pf = clamp(30 + c.hier * 14, 32, 44);
  s += T(ps, y + pf * 0.78, "$" + pr, pf, 800, -0.03, c.priceCol) + T(ps + tw("$" + pr, pf, 800, -0.03) + 3, y + pf * 0.78, text.per, 9.4, 500, 0, c.mCol);
  y += pf * 1.0 + ps * 0.6; n += 2;
  s += rect(ps, y, tmax, 1, c.hair); y += ps * 0.75;
  const list = [text.feat[1], text.feat[2], text.feat[3], text.feat[4]].slice(0, c.v % 2 === 0 ? 4 : 3);
  const fsF = Math.min(c.subFs + 0.6, 10), rowF = fsF * 1.9 + Math.min(sp, 14) * 0.1;
  list.forEach((ft, i) => {
    const w2 = wrap(ft, tmax - 20, fsF, 450, 0.003, 1);
    s += circ(ps + 5, y + rowF * 0.5 + i * rowF, 5.2, c.tint2) + check(ps + 5, y + rowF * 0.5 + i * rowF, 6, c.tintInk) + T(ps + 16, y + rowF * 0.5 + i * rowF + w2.fs * 0.36, w2.lines[0], w2.fs, 450, 0.003, c.mCol);
    n += 2;
  });
  y += list.length * rowF + ps * 0.7;
  const bh = 28, by = Math.max(y, Math.min(c.chT - ps - bh, y + 20));
  const bt = btnEl(ps, by, c.cta[1], 9.2, bh, c.btnStyle, c.btnFill, c.btnInk, tmax);
  s += bt.svg; n += 2;
  const h = by + bh + ps;
  return { svg: s, h, n, art: 0, rdArt: 0, btnRd: bt.rd, imp: 0.35, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.4, ctaHeft: 0.9 };
}

function L5(c) { // profile card
  const { cw, sp, K, S, text, id } = c;
  const ps = Math.max(Math.min(sp, 18), 10), tmax = cw - 2 * ps, centre = c.v % 2 === 0;
  const bannerH = clamp(c.chT * 0.27, 56, 72), ar = 21;
  const name = at(text.name, c.sel(0)), role = at(text.role, c.sel(1));
  const tl = wrap(name, tmax, Math.min(c.tFs, 20), c.tW, c.tls, 1, 13.2, 2), rl = wrap(role, tmax, c.subFs, 400, 0.004, 1);
  let s = "", n = 0;
  const cid = `${id}-i`, A = art(c.artKind, 0, 0, cw, bannerH, K, c.t1, c.v);
  s += `<defs>${clipPathRound(cid, 0, 0, cw, bannerH, c.r, true, false)}</defs><g clip-path="url(#${cid})">${A.s}</g>`;
  const ax = centre ? cw / 2 : ps + ar + 3, ay = bannerH;
  s += avatar(ax, ay, ar, K.a, c.aInk, name[0], 3.5, S); n += 2;
  let y = ay + ar + 9;
  const tx = centre ? cw / 2 : ps, an = centre ? "middle" : "start";
  s += T(tx, y + tl.fs * 0.8, tl.lines[0], tl.fs, c.tW, c.tls, c.tCol, an); y += tl.fs * 1.2 + 2;
  s += T(tx, y + rl.fs * 0.8, rl.lines[0], rl.fs, 400, 0.004, c.mCol, an); y += rl.fs * 1.3 + ps * 0.7; n += 2;
  const stats = [["128", text.pst[0]], ["4.9", text.pst[1]], ["12k", text.pst[2]]];
  s += rect(ps, y, tmax, 1, c.hair); y += ps * 0.65;
  const colW = tmax / 3;
  stats.forEach(([v1, l1], i) => {
    const sx = ps + colW * (i + 0.5);
    s += T(sx, y + 12, v1, 13, 800, -0.01, c.tCol, "middle") + T(sx, y + 23, l1, 7.4, 500, 0.02, c.mCol, "middle");
    if (i) s += rect(ps + colW * i, y + 2, 1, 22, c.hair);
  });
  y += 30 + ps * 0.7; n += 6;
  const bh = 26, by = Math.max(y, Math.min(c.chT - ps - bh, y + 20));
  const bt = btnEl(ps, by, c.cta[0], 9, bh, c.btnStyle, c.btnFill, c.btnInk, tmax);
  s += bt.svg; n += 2;
  const h = by + bh + ps;
  return { svg: s, h, n, art: A.n + 1, rdArt: (A.rd + 1) / 2, btnRd: bt.rd, imp: A.imp * 0.6, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.42, ctaHeft: 0.8 };
}

function L6(c) { // article card
  const { cw, sp, K, S, text, id } = c;
  const ps = Math.max(Math.min(sp, 18), 10), tmax = cw - 2 * ps;
  const title = at(text.article, c.sel(3)), ex = at(text.excerpt, c.sel(2));
  const tl = wrap(title, tmax, Math.min(c.tFs * 1.02, 22), c.tW, c.tls, 2, 13.2, 3), el2 = wrap(ex, tmax, c.subFs, 400, 0.004, 2);
  const ih = clamp(c.chT * 0.34, 54, 86), inset = c.v % 2 === 0 ? 0 : ps * 0.7, iw = cw - 2 * inset;
  let s = "", n = 0;
  const cid = `${id}-i`, A = art(c.artKind, inset, inset, iw, ih, K, c.t1, c.v);
  s += `<defs>${clipPathRound(cid, inset, inset, iw, ih, c.v % 2 === 0 ? c.r : Math.min(c.r, 10), true, c.v % 2 !== 0)}</defs><g clip-path="url(#${cid})">${A.s}</g>`;
  let y = inset + ih + ps * 0.85;
  const cat = at(text.cat, c.sel(1)).toUpperCase();
  const ch = chipEl(ps, y, cat, 6.8, c.tint2, c.tintInk); s += ch.svg;
  s += T(ps + ch.w + 8, y + ch.h / 2 + 2.9, at(text.date, c.sel(0)), 8.2, 500, 0.01, c.mCol);
  y += ch.h + 7; n += 3;
  tl.lines.forEach((ln, i) => { s += T(ps, y + tl.fs * 0.8 + i * tl.fs * 1.15, ln, tl.fs, c.tW, c.tls, c.tCol); });
  y += tl.lines.length * tl.fs * 1.15 + 5; n += tl.lines.length;
  el2.lines.forEach((ln, i) => { s += T(ps, y + el2.fs * 0.8 + i * el2.fs * 1.34, ln, el2.fs, 400, 0.004, c.mCol); });
  y += el2.lines.length * el2.fs * 1.34 + ps * 0.7; n += el2.lines.length;
  const fy = Math.max(y, Math.min(c.chT - ps - 22, y + 16));
  s += rect(ps, fy - 6, tmax, 1, c.hair);
  s += avatar(ps + 9, fy + 10, 9, K.b, c.bInk, at(text.name, c.sel(2))[0], 0, S);
  s += T(ps + 24, fy + 8, at(text.name, c.sel(2)), 8.6, 700, 0, c.tCol) + T(ps + 24, fy + 18, at(text.meta, c.sel(0)), 7.6, 400, 0, c.mCol);
  s += strk(`M${P(cw - ps - 8, fy + 3)}h8v14l-4-3-4 3z`, c.mCol, 1.3); n += 6;
  const h = fy + 24 + ps * 0.6;
  return { svg: s, h, n, art: A.n, rdArt: A.rd, btnRd: 0, imp: A.imp, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.55, ctaHeft: 0.15 };
}

function L7(c) { // stat card
  const { cw, sp, K, S, text } = c;
  const ps = Math.max(Math.min(sp, 20), 11), tmax = cw - 2 * ps;
  const label = at(text.stat, c.sel(0));
  const tl = wrap(label, tmax - 30, Math.min(c.tFs, 16), c.tW, c.tls, 1, 13.2, 2);
  const val = ["12.4k", "$8,920", "1,284", "98%"][c.sel(1) % 4], vf = clamp(30 + c.hier * 18, 34, 50);
  let s = "", n = 0, y = ps;
  s += rr(ps, y - 1, 20, 20, c.r > 10 ? 10 : 5, c.tint2) + circ(ps + 10, y + 9, 4.4, "none", { stroke: c.tintInk, "stroke-width": 1.8 });
  s += T(ps + 28, y + 9 + tl.fs * 0.36, tl.lines[0], tl.fs, c.tW, c.tls, c.tCol);
  y += 28; n += 3;
  const vw = tw(val, vf, 800, -0.03);
  s += T(ps, y + vf * 0.78, val, vf, 800, -0.03, c.priceCol);
  const dl = chipEl(ps + vw + 9, y + vf * 0.4 - 8, c.v % 2 === 0 ? "+12%" : "−3%", 7.6, c.v % 2 === 0 ? c.tint2 : c.tint3, c.v % 2 === 0 ? c.tintInk : c.tint3Ink);
  s += dl.svg; y += vf + 8; n += 3;
  const gh = clamp(c.chT - y - ps - 22, 34, 70), gy = y;
  if (c.v < 2) { // sparkline with an area
    const pts = [0.62, 0.45, 0.55, 0.3, 0.42, 0.2, 0.34, 0.12].map((q, i) => [ps + (tmax * i) / 7, gy + gh * clamp(q + (c.t1 - 0.5) * 0.2, 0.05, 0.95)]);
    const dd = pts.map(([px, py], i) => (i ? "L" : "M") + P(px, py)).join("");
    s += pth(`${dd}L${P(ps + tmax, gy + gh)}L${P(ps, gy + gh)}Z`, c.tint2) + strk(dd, K.a, 2) + circ(pts[7][0], pts[7][1], 3, K.a) + circ(pts[7][0], pts[7][1], 1.3, S);
    n += 3;
  } else { // bars
    const nb = 9, bw = tmax / nb * 0.62, hs = [0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.65, 0.95, 0.8];
    hs.forEach((q, i) => { s += rr(ps + (tmax / nb) * i + (tmax / nb - bw) / 2, gy + gh * (1 - q), bw, gh * q, Math.min(bw / 2, c.r * 0.4), i === nb - 2 ? K.a : c.tint2); });
    n += 4;
  }
  y += gh + 8;
  s += T(ps, y + 9, at(text.date, c.sel(0)) + " · " + at(text.meta, c.sel(1)), 8.2, 500, 0.01, c.mCol); n++;
  const h = y + 9 + ps * 0.9 + 3;
  return { svg: s, h, n, art: 3, rdArt: 0.4, btnRd: 0.2, imp: 0.4, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.45, ctaHeft: 0.3 };
}

function L8(c) { // compact tile
  const { cw, sp, K, S, text, id } = c;
  const ps = Math.max(Math.min(sp, 16), 10), tmax = cw - 2 * ps;
  const isz = clamp(cw * 0.3, 38, 48);
  const title = at(text.tile, c.sel(0)), sub = at(text.tsub, c.sel(0));
  const tl = wrap(title, tmax, Math.min(c.tFs, 16.5), c.tW, c.tls, 2, 13.2, 3), sl = wrap(sub, tmax, c.subFs, 400, 0.004, 1);
  let s = "", n = 0, y = ps;
  const cid = `${id}-i`, ir = c.r > 12 ? isz * 0.3 : Math.min(c.r, isz * 0.18);
  const A = art(c.artKind, ps, y, isz, isz, K, c.t1, c.v);
  s += `<defs><clipPath id="${cid}">${rr(ps, y, isz, isz, ir, "#000")}</clipPath></defs><g clip-path="url(#${cid})">${A.s}</g>`;
  if (c.t2 < 0.6) { const ch = chipEl(cw - ps, y, text.tag[Math.floor(c.t3 * 3)], 6.4, c.tint2, c.tintInk, "end"); s += ch.svg; n++; }
  y += isz + ps * 0.9;
  tl.lines.forEach((ln, i) => { s += T(ps, y + tl.fs * 0.8 + i * tl.fs * 1.16, ln, tl.fs, c.tW, c.tls, c.tCol); });
  y += tl.lines.length * tl.fs * 1.16 + 3;
  s += T(ps, y + sl.fs * 0.8, sl.lines[0], sl.fs, 400, 0.004, c.mCol); y += sl.fs * 1.3 + ps * 0.7; n += tl.lines.length + 2;
  // a toggle
  const on = c.v % 2 === 0, tgw = 26, tgh = 14;
  s += rr(ps, y, tgw, tgh, tgh / 2, on ? K.a : c.hair) + circ(on ? ps + tgw - tgh / 2 : ps + tgh / 2, y + tgh / 2, tgh / 2 - 2, on ? c.aInk : S);
  s += T(ps + tgw + 7, y + tgh / 2 + 3, on ? "ON" : "OFF", 7.2, 700, 0.1, c.mCol); n += 3;
  const h = y + tgh + ps;
  return { svg: s, h, n, art: A.n, rdArt: A.rd, btnRd: 1, imp: A.imp * 0.5, tFs: tl.fs, behind: S, tCol: c.tCol, cover: 0.45, ctaHeft: 0.25 };
}

function L9(c) { // hero card: a colour block with the headline, then meta + button
  const { cw, sp, K, S, text, id } = c;
  const ps = Math.max(Math.min(sp, 20), 12), tmax = cw - 2 * ps;
  const blk = c.block, tw2 = tmax * 0.66;
  const head = at(text.hero, c.sel(0)), sub = at(text.hsub, c.sel(1));
  const tl = wrap(head, tw2, Math.min(c.tFs * 1.2, 27), Math.max(c.tW, 700), -0.025, 2, 13.2, 3), sl = wrap(sub, tw2, c.subFs + 0.2, 400, 0.004, 3);
  const bh = 26, dc = c.v;
  const ty = ps + 2, tgH = 6.6 * 1.9;
  const yEnd = ty + tgH + 9 + tl.lines.length * tl.fs * 1.08 + 6 + sl.lines.length * sl.fs * 1.3;
  const blockH = clamp(Math.max(c.chT - bh - ps * 2.2 - 12, dc === 3 ? yEnd / 0.74 : yEnd + 16), 118, 176);
  let s = "", n = 0;
  const cid = `${id}-i`;
  s += `<defs>${clipPathRound(cid, 0, 0, cw, blockH, c.r, true, false)}</defs><g clip-path="url(#${cid})">${rect(0, 0, cw, blockH, blk.fill)}`;
  if (dc === 0) s += circ(cw - 6, blockH - 4, 54, blk.deco) + circ(cw - 6, blockH - 4, 30, blk.deco2);
  else if (dc === 1) s += poly([[cw, blockH * 0.3], [cw, blockH], [cw - blockH * 0.7, blockH]], blk.deco);
  else if (dc === 2) { for (let i = 0; i < 3; i++) s += `<circle cx="${f(cw)}" cy="${f(blockH)}" r="${f(26 + i * 19)}" fill="none" stroke="${i === 1 ? blk.deco2 : blk.deco}" stroke-width="8"/>`; }
  else s += pth(`M${P(0, blockH * 0.84)}Q${P(cw * 0.25, blockH * 0.66)} ${P(cw * 0.5, blockH * 0.84)}T${P(cw, blockH * 0.84)}V${f(blockH)}H0Z`, blk.deco) + pth(`M${P(0, blockH * 0.93)}Q${P(cw * 0.25, blockH * 0.79)} ${P(cw * 0.5, blockH * 0.93)}T${P(cw, blockH * 0.93)}V${f(blockH)}H0Z`, blk.deco2);
  s += "</g>";
  const tg = chipEl(ps, ty, at(text.tag, Math.floor(c.t3 * 3)), 6.6, blk.chip, blk.chipInk); s += tg.svg;
  let y = ty + tg.h + 9;
  tl.lines.forEach((ln, i) => { s += T(ps, y + tl.fs * 0.8 + i * tl.fs * 1.08, ln, tl.fs, Math.max(c.tW, 700), -0.025, blk.tCol); });
  y += tl.lines.length * tl.fs * 1.08 + 6;
  sl.lines.forEach((ln, i) => { s += T(ps, y + sl.fs * 0.8 + i * sl.fs * 1.3, ln, sl.fs, 400, 0.004, blk.mCol); });
  n += 3 + tl.lines.length + sl.lines.length;
  const rest = Math.max(c.chT - blockH, bh + 2 * ps), by = blockH + (rest - bh) / 2 - 1;
  const bt = btnEl(ps, by, c.cta[0], 9, bh, c.btnStyle, c.btnFill, c.btnInk); s += bt.svg;
  const mt = at(text.date, c.sel(0)) + " · " + at(text.meta, c.sel(1)), mw = cw - 2 * ps - bt.w - 10;
  s += T(cw - ps, by + bh / 2 + 3, tw(mt, 8.2, 500, 0.01) <= mw ? mt : at(text.date, c.sel(0)), 8.2, 500, 0.01, c.mCol, "end"); n += 3;
  const h = by + bh + (rest - bh) / 2 + 1;
  return { svg: s, h, n, art: 3, rdArt: dc === 3 ? 0.8 : dc === 1 ? -0.6 : 1, btnRd: bt.rd, imp: clamp(strength(blk.fill) + 0.1), tFs: tl.fs, behind: blk.fill, tCol: blk.tCol, cover: 0.74, ctaHeft: 0.7 };
}
const LAYOUTS = [L0, L1, L2, L3, L4, L5, L6, L7, L8, L9];
// card width per layout (before the plan's margin): [min, max]
const CW = [[190, 212], [190, 212], [186, 212], [200, 214], [168, 196], [190, 210], [196, 214], [196, 214], [128, 150], [196, 214]];

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const idx = ((ctx.index % 32) + 32) % 32;
  const E = entry(String(ctx.season ?? ""), idx);
  const t1 = rand(), t2 = rand(), t3 = rand(), t4 = rand(), t5 = rand(), t6 = rand();
  const id = ctx.id;
  const p = PALETTES[E.pal], text = TX[E.lang];
  const darkNat = lightness(p.bg) < 30;
  let a = p.a, b = p.b;
  if (E.tone === 1) { a = tone(a, 0.88); b = tone(b, 0.88); } else if (E.tone === 2) { a = tone(a, -0.6); b = tone(b, -0.6); }
  const L1c = darkNat ? p.ink : p.surface, D1 = darkNat ? p.bg : (lightness(p.ink) < 38 ? p.ink : mix(p.ink, "#000000", 0.8));
  let dg = p.ink; for (let q = 0; q < 9 && lightness(dg) > 13; q++) dg = mix(dg, "#000000", 0.18);

  // ---- legibility target
  const target = E.cat === 0 ? 1.55 + 1.35 * E.u : E.cat === 1 ? 3.95 + 4.1 * E.u : 10.7 + 6.0 * E.u;
  const feasible = (c0) => E.cat === 0 || reach(c0) > target * 1.06;

  // ---- ground: page + card surface
  let page, S;
  const sc = E.scheme;
  if (sc === 0) { page = p.bg; S = p.surface; }
  else if (sc === 1) { page = p.bg; S = mix(darkNat ? p.surface : p.bg, a, darkNat ? 0.16 : 0.1); if (!darkNat) page = mix(p.bg, "#ffffff", 0.5); }
  else if (sc === 2) { page = darkNat ? p.bg : dg; S = darkNat ? p.surface : mix(dg, "#ffffff", 0.07); }
  else if (sc === 3) { page = a; S = darkNat ? p.surface : (lightness(p.surface) > 80 ? p.surface : "#ffffff"); }
  else { page = darkNat ? p.bg : p.bg; S = feasible(a) && lightness(a) < 62 && satOf(a) > 0.28 ? a : D1; }
  if (!feasible(S)) { // push the surface towards black / white until the title can reach the target contrast
    const ext = lightness(S) < 50 ? "#000000" : "#ffffff";
    for (let q = 1; q <= 10; q++) { const m = mix(S, ext, q / 10); if (feasible(m)) { S = m; break; } }
    if (!feasible(S)) S = ext;
  }
  if (contrast(page, S) < 1.04 && sc !== 1) page = lightness(S) > 50 ? mix(S, "#000000", 0.06) : mix(S, "#ffffff", 0.06);
  const pageDark = lightness(page) < 42, sDark = lightness(S) < 45;
  const ink = bestOn(S, [L1c, D1, "#ffffff", "#111114"]);
  const tCol = inkAt(S, ink, target);
  const mut = (surf, base) => (E.cat === 0 ? inkAt(surf, base, clamp(target * 1.25, 3.1, 4.6)) : inkAt(surf, base, 5.4));
  const mCol = mut(S, ink);
  const hair = mix(S, ink, sDark ? 0.2 : 0.13);
  const aOn = contrast(a, S) >= 1.8 ? a : (contrast(b, S) >= 1.8 ? b : bestOn(S, [L1c, D1]));
  const priceCol = away(E.cat === 0 ? mix(S, ink, 0.7) : (contrast(a, S) >= 3 ? a : ink), S, E.cat === 0 ? 3.0 : 3.4);
  const accentInk = away(a, S, 3.2);
  const tint2 = mix(S, a, sDark ? 0.3 : 0.16), tintInk = away(a, tint2, 4.4);
  const tint3 = mix(S, b, sDark ? 0.3 : 0.18), tint3Ink = away(b, tint3, 4.4);
  const btnFill = aOn, btnInk = bestOn(btnFill, ["#ffffff", "#111114", L1c, D1]);
  const aInk = bestOn(a, ["#ffffff", "#111114"]), bInk = bestOn(b, ["#ffffff", "#111114"]);
  const deep = mix(a, D1, 0.42), tint = mix(b, sDark ? mix(S, "#000000", 0.3) : "#ffffff", sDark ? 0.5 : 0.62), light = sDark ? mix(L1c, S, 0.1) : mix(S, "#ffffff", 0.6);
  const K = { a, b, deep, tint, light, dark: D1 };

  // ---- plates / blocks for layouts that put the title on art
  const plateCands = [S, sDark ? mix(S, "#ffffff", 0.06) : "#ffffff"];
  const plateFill = S;
  const pInk = bestOn(plateFill, [L1c, D1, "#ffffff", "#111114"]);
  const plate = { fill: plateFill, art: mix(plateFill, a, 0.08), tCol: inkAt(plateFill, pInk, target), mCol: mut(plateFill, pInk), hair: mix(plateFill, pInk, 0.2), pCol: away(contrast(a, plateFill) >= 3 ? a : pInk, plateFill, 3.2), btnFill: contrast(a, plateFill) >= 1.8 ? a : bestOn(plateFill, [L1c, D1]), btnInk: bestOn(contrast(a, plateFill) >= 1.8 ? a : bestOn(plateFill, [L1c, D1]), ["#ffffff", "#111114"]) };
  void plateCands;
  const blkCands = [a, D1, b, deep];
  const blkFill = blkCands.find((c0) => contrast(c0, S) > 1.15 && lightness(c0) < 65 && feasible(c0)) ?? D1;
  const bkInk = bestOn(blkFill, [L1c, D1, "#ffffff", "#111114"]);
  const block = { fill: blkFill, tCol: inkAt(blkFill, bkInk, target), mCol: inkAt(blkFill, bkInk, E.cat === 0 ? clamp(target * 1.2, 3, 4.5) : 6), deco: mix(blkFill, lightness(blkFill) < 50 ? "#ffffff" : "#000000", 0.12), deco2: mix(blkFill, lightness(blkFill) < 50 ? "#ffffff" : "#000000", 0.22), chip: bestOn(blkFill, [L1c, D1]), chipInk: blkFill };

  // ---- geometry knobs
  const sp = lerp(9, 24, E.sp), r = lerp(0, 22, E.rad);
  const hier = E.hier, tFs = lerp(13.6, 23, hier), tW = hier > 0.55 ? 800 : hier > 0.25 ? 700 : 600, tls = hier > 0.55 ? -0.022 : hier > 0.25 ? -0.01 : 0;
  const subFs = lerp(10.4, 8.8, hier);
  const mv = lerp(13, 24, E.m), cwr = CW[E.layout], cw = clamp(240 - 2 * mv, cwr[0], cwr[1]);
  const chT = H - 2 * mv + 4;
  const sel = (o = 0) => (E.pick + o * 5 + E.layout) % 32;
  const c = {
    id, cw, sp, r, K, S, page, text, hier, tFs, tW, tls, subFs, tCol, mCol, hair, priceCol, accentInk, tint2, tintInk, tint3, tint3Ink, aInk, bInk, ink, plate, block,
    btnFill, btnInk, btnStyle: Math.floor(t5 * 5), v: E.v, artKind: E.art, chT, t1, t2, t3, t4, cta: text.cta[E.layout % 3 === 0 ? 0 : E.layout % 3 === 1 ? 1 : 2], sel: (o = 0) => sel(o),
  };
  let res;
  for (let q = 0; q < 7; q++) { c.sp = sp * (1 - 0.12 * q); res = LAYOUTS[E.layout](c); if (res.h <= H - 14) break; }

  // ---- assemble: page, edge, card, content
  const ch = Math.min(res.h, H - 16), cx = (W - cw) / 2, cy = clamp((H - ch) / 2 - 1, 8, H);
  let out = "";
  if (E.edge === 0) {
    const col = pageDark ? "#000000" : mix(ink, "#000000", 0.4);
    const layers = pageDark ? [[1.5, 0, 0.4], [5, 2, 0.3], [11, 5, 0.22]] : [[1.5, 0, 0.08], [4.5, 2, 0.055], [10, 5, 0.04]];
    for (const [dy, e, o] of layers) out += rr(cx - e, cy + dy - e, cw + 2 * e, ch + 2 * e, r + e, col, { "fill-opacity": o });
  }
  const cardAttrs = E.edge === 1 ? { stroke: hair, "stroke-width": 1 } : E.edge === 2 && contrast(S, page) < 1.12 ? { stroke: mix(S, ink, 0.06), "stroke-width": 1 } : {};
  out += E.edge === 1 ? rr(cx + 0.5, cy + 0.5, cw - 1, ch - 1, Math.max(0, r - 0.5), S, cardAttrs) : rr(cx, cy, cw, ch, r, S, cardAttrs);
  out += grp(`translate(${f(cx)} ${f(cy)})`, res.svg);
  const pageFrame = pageDark ? { stroke: mix(page, "#ffffff", 0.14), "stroke-width": 1 } : {};
  const svg = svgRoot(W, H, rect(0, 0, W, H, page, { rx: 12, ...pageFrame }) + out);

  // ---- legibility
  const cr = Math.round(contrast(res.tCol, res.behind) * 10) / 10;
  const size = clamp((res.tFs / H) * 6.25, 0.1, 1);
  const score = 0.7 * Math.min(1, Math.log(cr) / Math.log(12)) + 0.3 * size;

  // ---- traits
  const hues = [a, b, deep];
  const warm = warmOf([page, S, a, b, ...(res.art ? [deep] : [])]);
  const vivid = vividOf([a, b, deep]);
  const cardShare = (cw * ch) / (W * H);
  const meanL = lightness(page) * (1 - cardShare) + (lightness(S) * (1 - res.cover * 0.6) + lightness(deep) * res.cover * 0.6) * cardShare;
  const dark = clamp(1 - meanL / 50);
  const titleHeft = clamp(((tW - 500) / 300) * 0.5 + ((res.tFs - 13) / 12) * 0.5, 0, 1);
  const tight = clamp(1 - (sp - 9) / 15, 0, 1);
  const edgeW = E.edge === 0 ? 1 : E.edge === 1 ? 0.4 : 0.1;
  const rawBold = 0.28 * titleHeft + 0.24 * (res.imp * clamp(res.cover * 1.6, 0.3, 1)) + 0.18 * res.ctaHeft + 0.16 * edgeW + 0.14 * tight;
  const bold = clamp(4.2 * rawBold - 2.1);
  const round = clamp(0.55 * (r / 11 - 1) + 0.25 * res.rdArt + 0.2 * (res.btnRd ?? 0));
  const empty = 1 - clamp(cardShare * res.cover * 1.1, 0, 1);
  const airy = clamp((empty - 0.5) * 3.4);
  const rich = richOf(res.n + res.art, 9, 24);
  void hues;
  return {
    name: `${LAYOUT_NAMES[E.layout]} / ${p.id} / ${["light", "tint", "dark", "brand", "accent"][E.scheme]} / ${["shadow", "hairline", "flat"][E.edge]} / ${["poor", "mid", "excellent"][E.cat]} / ${["en", "ru", "kk"][E.lang]}`,
    svg,
    traits: { warm, bold, round, airy, vivid, rich, dark },
    legibility: { score: Math.round(score * 100) / 100, contrast: cr, size: Math.round(size * 100) / 100 },
  };
}
