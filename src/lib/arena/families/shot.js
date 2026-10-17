// Arena family "shot": product-photography styles. One hero object staged like a studio / lifestyle photo
// (backdrop, lighting, props, colour grade, composition), so marketers can learn which *photographic style* wins.
// Everything is pure SVG: layered linear + radial gradients, feGaussianBlur soft shadows, floor reflections
// (a <use> of the object, flipped, masked), feTurbulence paper / concrete texture and film grain (at most 2
// feTurbulence filters, numOctaves <= 3, all filter regions inside the viewBox), vignette. No <image>, no fonts,
// no text: the label on the object is a stripe, a monogram ring or abstract lines.
//
// Object forms (13): glass bottle, frosted bottle, amber bottle (screw / cork / dropper tops), pump bottle, tall can,
//   jar with lid (glass or opaque), tube, carton box, stand-up pouch, round tin, open cosmetic compact, speaker block,
//   perfume bottle. Flat-lay turns every form into its top-down / lying version.
// Stages (7): floor, round podium, block podium, steps, floating with shadow, top-down flat-lay with props, water ripples.
// Lighting (5): soft box, hard sun through a window (gobo of panes), leaf-shadow gobo, coloured-gel rim light (low key),
//   spotlight. Backdrops (5): seamless, gradient, paper (texture), concrete (texture), bokeh. Colour moods (10),
//   colour logic (4: tonal / contrast / complementary accent / neutral product), composition (centre / thirds),
//   9 props (leaves & fronds, citrus slices, geometric solids, droplets, petals, pebbles, dry grass, silk ribbon, sun disc / plate).
//
// A pool of 32 is *planned* per season (planShot): every attribute (form, stage, light, backdrop, mood, colour logic,
// size, composition, label, prop density, prop kinds, gloss) is dealt in its own balanced, shuffled blocks from a PRNG that
// depends only on ctx.season; rand() then supplies every per-specimen parameter (hue, proportions, positions, ...).
//
// Traits are measured from what is drawn, never random. While drawing, every coloured area is logged as
// [hex, share of the frame] (the backdrop is first tinted by the light that falls on it):
//   warm  : area x chroma weighted cos(hue - 30deg) of all logged colours (orange +1, blue -1, green ~0)
//   vivid : area-weighted mean HSL chroma s x (1 - |2l-1|) of the same colours: (mean - 0.22) / 0.24
//   dark  : 1 - L*/50 of the area-weighted lightness of the frame, darkened by the vignette
//   bold  : 0.5 x object-vs-backdrop contrast (lightness gap + hue-opposition x chroma) + 0.3 x object size share
//           + 0.2 x graphic colour blocks (podium / sun disc / solids against the backdrop)
//   round : area-weighted roundness of the object (cylinders +, boxes -), the stage (round podium / ripples +, block / steps -),
//           the light (soft / bokeh +, hard window gobo -) and the props (spheres, petals, drops + / cubes, grass -)
//   airy  : negative space = 1 - (object + stage + props footprints) / frame, tightened so that big, crowded frames read
//           as dense (-1) and a small hero on a calm backdrop as airy (+1)
//   rich  : count of visible layers: label details, stage parts, props, texture, bokeh, gobo, reflection, ...
import { svgRoot } from "../svgutil.js";
import { mix, lighten, darken, hexToHsl, hsl, lightness } from "../color.js";
import { clamp, warmthOfHue, richOf } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle, pick } from "../../prng.js";

export const DIMS = ["preference", "attention", "quality", "premium", "trust", "purchaseIntent", "modern", "natural"];
export const TEXT = false;
export const VIEWBOX = [240, 300];
const W = 240, H = 300;

// ---------- tiny SVG helpers (numbers are trimmed to keep a specimen small)
const nz = (n) => String(n).replace(/^(-?)0\./, "$1.");
const f = (v) => nz(+(Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1)));
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
const E = (cx, cy, rx, ry, fill, o) => el("ellipse", { cx, cy, rx, ry, fill, ...o });
const Pa = (dd, fill, o) => el("path", { d: dd, fill, ...o });
const G = (o, i) => el("g", o, i);
const d = (s, ...v) => {
  let o = s[0];
  for (let i = 0; i < v.length; i++) o += (typeof v[i] === "number" ? f(v[i]) : v[i]) + s[i + 1];
  return o;
};
const stp = ([o, c, op]) => `<stop offset="${nz(+(+o).toFixed(3))}" stop-color="${c}"${op === undefined ? "" : ` stop-opacity="${nz(+(+op).toFixed(2))}"`}/>`;
const lin = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 0, extra = "") =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra}>${stops.map(stp).join("")}</linearGradient>`;
const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5, extra = "") =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${extra}>${stops.map(stp).join("")}</radialGradient>`;
const rg = (r, a, b) => a + r() * (b - a);
const ri = (r, a, b) => Math.floor(rg(r, a, b + 1));
const ch = (r, p) => r() < p;
const c01 = (n) => Math.min(1, Math.max(0, n));
const url = (id) => `url(#${id})`;
const mirror = (lx, stops) => (lx > 0 ? stops.map(([o, c, a]) => [+(1 - o).toFixed(3), c, a]).reverse() : stops);
const chroma = (hex) => { const [, s, l] = hexToHsl(hex); return s * (1 - Math.abs(2 * l - 1)); };
const inkOn = (bg) => (lightness(bg) > 58 ? "#1b1814" : "#faf7ef");

// ---------- colour moods
const MOODS = {
  sunbaked: { h: [[8, 38]], s: [0.55, 0.78], l: [0.5, 0.65], w: "Terracotta" },
  cream: { h: [[30, 52]], s: [0.25, 0.5], l: [0.86, 0.93], w: "Cream" },
  blush: { h: [[345, 372]], s: [0.45, 0.7], l: [0.82, 0.9], w: "Blush" },
  ocean: { h: [[198, 226]], s: [0.55, 0.8], l: [0.42, 0.58], w: "Ocean" },
  glacier: { h: [[185, 215]], s: [0.2, 0.4], l: [0.82, 0.92], w: "Icy" },
  noir: { h: [[200, 300]], s: [0.12, 0.4], l: [0.04, 0.1], w: "Noir" },
  pop: { h: [[318, 345], [262, 290]], s: [0.78, 0.95], l: [0.5, 0.6], w: "Pop" },
  forest: { h: [[100, 160]], s: [0.25, 0.45], l: [0.26, 0.4], w: "Forest" },
  stone: { h: [[20, 60]], s: [0.02, 0.08], l: [0.55, 0.82], w: "Stone" },
  mustard: { h: [[42, 52]], s: [0.75, 0.95], l: [0.5, 0.58], w: "Mustard" },
};
const MOOD_IDS = Object.keys(MOODS);

const FORMS = ["bottleG", "bottleF", "bottleA", "pump", "can", "jar", "tube", "box", "pouch", "tin", "compact", "speaker", "perfume"];
const FORM_NAME = {
  bottleG: "Glass bottle", bottleF: "Frosted bottle", bottleA: "Amber bottle", pump: "Pump bottle", can: "Tall can", jar: "Jar",
  tube: "Tube", box: "Carton box", pouch: "Pouch", tin: "Round tin", compact: "Powder compact", speaker: "Speaker", perfume: "Perfume bottle",
};
const STAGES = ["floor", "cyl", "block", "steps", "float", "flat", "water"];
const STAGE_NAME = { floor: "", cyl: "on a round podium", block: "on a block", steps: "on steps", float: "floating", flat: "flat-lay", water: "in water" };
const LIGHTS = ["soft", "window", "leaf", "gel", "spot"];
const LIGHT_NAME = { soft: "soft box", window: "window sunlight", leaf: "leaf shadows", gel: "gel rim light", spot: "spotlight" };
const BACKS = ["seamless", "gradient", "paper", "concrete", "bokeh"];
const TONES = ["tonal", "contrast", "accent", "neutral"];
const LABELS = ["stripe", "circle", "lines", "band", "arch", "dots", "none"];
const PROPS = ["leaves", "citrus", "geo", "drops", "petals", "stones", "grass", "ribbon", "sun"];
const PROP_NAME = { leaves: "leaves", citrus: "citrus", geo: "solids", drops: "water drops", petals: "petals", stones: "pebbles", grass: "dry grass", ribbon: "silk", sun: "sun disc" };

const seq = (r, list, n = 32) => {
  const out = [];
  while (out.length < n) out.push(...shuffle(r, list));
  return out.slice(0, n);
};

const planCache = new Map();
/** The season's pool plan: 32 slots, each attribute dealt in balanced shuffled blocks; a pure function of the season. */
function planShot(season) {
  const hit = planCache.get(season);
  if (hit) return hit;
  const r = mulberry32(hashStringToSeed(`${season}/shot/plan`));
  const forms = seq(r, FORMS), stages = seq(r, STAGES), moods = seq(r, [...MOOD_IDS, "noir"]), lights = seq(r, ["soft", "soft", "window", "window", "leaf", "spot", "gel"]);
  const backs = seq(r, BACKS), tones = seq(r, TONES), comps = seq(r, ["centre", "centre", "left", "right"]), sizes = seq(r, [0, 1, 2, 3]);
  const labels = seq(r, LABELS), dens = seq(r, [0, 1, 1, 2, 2, 3]), gloss = seq(r, [true, false, false]);
  const deck = seq(r, PROPS, 96);
  let dk = 0;
  const gelLeft = shuffle(r, ["gel", "spot"]);
  const slots = [];
  for (let i = 0; i < 32; i++) {
    const s = { i, form: forms[i], stage: stages[i], mood: moods[i], light: lights[i], back: backs[i], tone: tones[i], comp: comps[i], size: sizes[i], label: labels[i], gloss: gloss[i] };
    // gel rim lights need a dark room; dark moods get gel / spot, everything else keeps a daylight-ish light
    if (s.mood === "noir") s.light = gelLeft[i % 2] === "gel" ? (i % 3 ? "gel" : "spot") : i % 3 ? "spot" : "gel";
    else if (s.light === "gel") s.light = ["soft", "window", "leaf"][i % 3];
    if (s.mood === "noir") s.gloss = true;
    if (s.stage === "flat" && s.back === "bokeh") s.back = "paper";
    s.dens = dens[i];
    s.props = [];
    while (s.props.length < s.dens) {
      const p = deck[dk++ % deck.length];
      if (!s.props.includes(p)) s.props.push(p);
    }
    slots.push(s);
  }
  const seen = new Set();
  for (const s of slots) {
    const base = `${FORM_NAME[s.form]}${STAGE_NAME[s.stage] ? " " + STAGE_NAME[s.stage] : ""}, ${LIGHT_NAME[s.light]}`;
    const cand = [base, `${MOODS[s.mood].w} ${base.toLowerCase()}`, `${MOODS[s.mood].w} ${base.toLowerCase()}, ${s.back}`, `${MOODS[s.mood].w} ${base.toLowerCase()}, ${s.back}, ${s.props.map((p) => PROP_NAME[p]).join(" + ") || "clean"}`];
    let nm = cand.find((c) => !seen.has(c));
    for (let k = 2; !nm; k++) if (!seen.has(`${cand[3]} #${k}`)) nm = `${cand[3]} #${k}`;
    seen.add(nm);
    s.name = nm;
  }
  planCache.set(season, slots);
  if (planCache.size > 40) planCache.delete(planCache.keys().next().value);
  return slots;
}

// ---------- colour logic
function colours(r, moodId, tone) {
  const M = MOODS[moodId];
  const [lo, hi] = pick(r, M.h);
  const h = (((rg(r, lo, hi)) % 360) + 360) % 360, s = rg(r, ...M.s), l = rg(r, ...M.l);
  const dark = l < 0.45, light = l > 0.6;
  const bg = hsl(h, s, l);
  const lit = hsl(h + rg(r, -6, 6), s * 0.95, c01(l + (dark ? 0.09 : 0.05)));
  const dim = hsl(h + rg(r, -8, 8), s, c01(l - (dark ? 0.035 : 0.13)));
  const front = hsl(h, s, c01(l - (dark ? 0.02 : 0.07)));
  const gTop = hsl(h + rg(r, 22, 42) * (r() < 0.5 ? 1 : -1), s, c01(l + (light ? -0.13 : 0.08)));
  const gBot = hsl(h + rg(r, -30, 30), s, c01(l + (light ? 0.05 : -0.03)));
  const comp = h + 180 + rg(r, -28, 28);
  const sgn = light ? -1 : 1;
  let pc, ac;
  if (tone === "tonal") {
    pc = hsl(h + rg(r, -12, 12), c01(s * rg(r, 0.8, 1.15)), c01(l + sgn * rg(r, 0.16, 0.26)));
    ac = hsl(h + rg(r, -25, 25), c01(s * 1.05), c01(l + sgn * rg(r, 0.3, 0.4)));
  } else if (tone === "contrast") {
    pc = light ? hsl(h + rg(r, -25, 25), rg(r, 0.3, 0.8), rg(r, 0.1, 0.24)) : hsl(h + rg(r, -15, 15), rg(r, 0.08, 0.35), rg(r, 0.88, 0.96));
    ac = hsl(comp, rg(r, 0.7, 0.9), rg(r, 0.5, 0.58));
  } else if (tone === "accent") {
    pc = ch(r, 0.5) ? hsl(h, 0.14, rg(r, 0.92, 0.96)) : hsl(h, 0.12, rg(r, 0.08, 0.13));
    ac = hsl(comp, rg(r, 0.78, 0.92), rg(r, 0.46, 0.55));
  } else {
    pc = dark ? hsl(40, 0.12, rg(r, 0.86, 0.94)) : hsl(h, 0.1, rg(r, 0.93, 0.97));
    ac = hsl(h + rg(r, -10, 10), c01(Math.max(s, 0.3) * 1.1), dark ? rg(r, 0.5, 0.6) : rg(r, 0.36, 0.48));
  }
  const gold = hsl(rg(r, 38, 46), rg(r, 0.5, 0.65), rg(r, 0.5, 0.6));
  const cap = pick(r, ["#1b1815", "#1b1815", "#f3efe7", gold, gold, darken(pc, 0.35), ac]);
  const metal = pick(r, ["#cfd3d8", "#cfd3d8", gold, "#d9a891", "#2a2a2e"]);
  const ink = lightness(pc) > 55 ? "#1b1814" : "#faf7ef";
  const tint = ch(r, 0.5) ? hsl(rg(r, 150, 200), 0.3, 0.72) : lighten(pc, 0.3);
  const liq = pick(r, [hsl(rg(r, 36, 50), 0.8, 0.5), lighten(pc, 0.1), hsl(rg(r, 0, 20), 0.6, 0.6), hsl(rg(r, 80, 150), 0.45, 0.5), hsl(rg(r, 190, 220), 0.4, 0.78)]);
  const paper = ch(r, 0.7) ? "#f6f1e6" : lightness(pc) > 70 ? "#ffffff" : lighten(pc, 0.8);
  return { h, s, l, dark, light, bg, lit, dim, front, gTop, gBot, comp, pc, ac, cap, metal, ink, tint, liq, paper, gold };
}

// ---------- shading overlays shared by every object (alpha gradients over a flat colour)
function overlays(X, lx, rimL, rimR, gl) {
  const m = (a) => mirror(lx, a);
  return {
    h: lin(`${X}-h`, m([[0, rimL || "#fff", rimL ? 0.6 : 0.22], [0.06, "#000", 0.1], [0.18, "#fff", 0.26 * gl], [0.5, "#000", 0.06], [0.8, "#000", 0.32], [0.95, "#000", 0.5], [1, rimR || "#fff", rimR ? 0.65 : 0.14]])),
    hm: lin(`${X}-hm`, m([[0, rimL || "#000", rimL ? 0.6 : 0.4], [0.07, "#fff", 0.5 * gl], [0.15, "#000", 0.22], [0.3, "#fff", 0.4 * gl], [0.62, "#000", 0.2], [0.82, "#fff", 0.2], [0.93, "#000", 0.45], [1, rimR || "#000", rimR ? 0.65 : 0.5]])),
    hg: lin(`${X}-hg`, m([[0, rimL || "#000", rimL ? 0.55 : 0.3], [0.07, "#fff", 0.12], [0.2, "#fff", 0], [0.85, "#000", 0.16], [1, rimR || "#000", rimR ? 0.6 : 0.38]])),
    v: lin(`${X}-v`, [[0, "#fff", 0.12], [0.35, "#fff", 0], [1, "#000", 0.24]], 0, 0, 0, 1),
    sp: lin(`${X}-sp`, [[0, "#fff", 0], [0.5, "#fff", 0.9], [1, "#fff", 0]]),
  };
}
const rr = (x, y, w, h, rx = 0) => (fill, o) => el("rect", { x, y, width: w, height: h, rx: rx || null, fill, ...o });
const pp = (dd) => (fill, o) => el("path", { d: dd, fill, ...o });
const ee = (cx, cy, rx, ry) => (fill, o) => el("ellipse", { cx, cy, rx, ry, fill, ...o });
const shade = (X, mk, base, k = "h") => mk(base) + mk(url(`${X}-${k}`)) + mk(url(`${X}-v`));
const spec = (X, x, y, w, h, op = 0.8) => el("rect", { x, y, width: w, height: h, rx: w / 2, fill: url(`${X}-sp`), opacity: op });
const ridges = (x, y, w, h, n, op = 0.22) => {
  let s = "";
  for (let i = 0; i < n; i++) s += `M${f(x + ((i + 0.5) * w) / n)} ${f(y)}v${f(h)}`;
  return Pa(s, "none", { stroke: "#000", "stroke-opacity": op, "stroke-width": 0.8 });
};

// ---------- the minimal "label": stripe / monogram ring / abstract lines (no readable text)
function label(K, style, x, y, w, h, base) {
  const { r } = K, ink = inkOn(base), cx = x + w / 2, cy = y + h / 2;
  let ac = K.ac;
  if (Math.abs(lightness(ac) - lightness(base)) < 22) ac = ink;
  switch (style) {
    case "stripe":
      return R(x, cy - h * 0.14, w, h * 0.28, ac) + R(x, cy - h * 0.14 - 2.4, w, 0.9, ink, { opacity: 0.7 }) + R(x, cy + h * 0.14 + 1.5, w, 0.9, ink, { opacity: 0.7 });
    case "circle": {
      const rd = Math.min(w * 0.3, h * 0.28);
      const k = pick(r, [0, 1, 2]);
      const inner = k === 0 ? C(cx, cy - h * 0.06, rd * 0.4, ac) : k === 1 ? Pa(d`M${cx - rd * 0.5} ${cy - h * 0.06 + rd * 0.3}Q${cx} ${cy - h * 0.06 - rd * 0.9} ${cx + rd * 0.5} ${cy - h * 0.06 + rd * 0.3}Q${cx} ${cy - h * 0.06 + rd * 0.1} ${cx - rd * 0.5} ${cy - h * 0.06 + rd * 0.3}Z`, ac) : Pa(d`M${cx - rd * 0.55} ${cy - h * 0.06}A${rd * 0.55} ${rd * 0.55} 0 0 1 ${cx + rd * 0.55} ${cy - h * 0.06}`, "none", { stroke: ac, "stroke-width": 2.2 });
      return C(cx, cy - h * 0.06, rd, "none", { stroke: ink, "stroke-width": 1.3 }) + inner + R(cx - w * 0.2, y + h * 0.86, w * 0.4, 1.4, ink, { opacity: 0.75 });
    }
    case "lines": {
      const a = rg(r, 0.55, 0.8), b = rg(r, 0.35, 0.6), c = rg(r, 0.45, 0.7);
      return R(cx - (w * a) / 2, y + h * 0.28, w * a, 2.8, ink) + R(cx - (w * b) / 2, y + h * 0.5, w * b, 1.3, ink, { opacity: 0.8 }) + R(cx - (w * c) / 2, y + h * 0.64, w * c, 1.3, ink, { opacity: 0.8 }) + R(cx - w * 0.08, y + h * 0.82, w * 0.16, 1.8, ac);
    }
    case "band":
      return R(x, y, w, h * 0.13, ac) + R(x, y + h * 0.87, w, h * 0.13, ink, { opacity: 0.85 }) + C(cx, cy, Math.min(w, h) * 0.12, ac);
    case "arch": {
      const aw = Math.min(w * 0.42, h * 0.4);
      return Pa(d`M${cx - aw / 2} ${cy + h * 0.28}V${cy - h * 0.05}A${aw / 2} ${aw / 2} 0 0 1 ${cx + aw / 2} ${cy - h * 0.05}V${cy + h * 0.28}Z`, ac) + Pa(d`M${cx - aw / 4} ${cy + h * 0.28}V${cy + h * 0.05}A${aw / 4} ${aw / 4} 0 0 1 ${cx + aw / 4} ${cy + h * 0.05}V${cy + h * 0.28}Z`, base, { opacity: 0.55 });
    }
    case "dots": {
      let s = "";
      const n = ri(r, 3, 5), gap = Math.min(w * 0.14, 7);
      for (let i = 0; i < n; i++) s += C(cx + (i - (n - 1) / 2) * gap, cy - h * 0.1, 1.9, i === 0 ? ac : ink);
      return s + R(cx - w * 0.24, cy + h * 0.14, w * 0.48, 1.2, ink, { opacity: 0.7 });
    }
    default:
      return R(cx - w * 0.16, cy, w * 0.32, 0.9, ink, { opacity: 0.55 });
  }
}

// =====================================================================================================
// OBJECTS: drawn upright in local coordinates, origin = centre of the base, y pointing down (so the object is at y < 0).
// Each returns { svg, w, h, rd (roundness -1..1), n (details) }.
// =====================================================================================================
function bottle(K, mat, top) {
  const { r, X, lx, defs } = K;
  const sq = ch(r, mat === "frost" ? 0.4 : 0.3);
  const bw = rg(r, 38, 54), bh = rg(r, 64, 90);
  const sh = sq ? rg(r, 5, 12) : rg(r, 16, 28);
  const nw = bw * (top === "pump" ? rg(r, 0.26, 0.36) : rg(r, 0.3, 0.46));
  const nl = top === "pump" || top === "dropper" ? rg(r, 3, 6) : rg(r, 8, 18);
  const rb = sq ? rg(r, 2, 5) : rg(r, 7, 12);
  const b = bw / 2, n = nw / 2, yS = -bh, yN = yS - sh, yT = yN - nl;
  const c1 = sq ? 0.98 : 0.7, c2 = sq ? 0.03 : 0.3;
  const bodyD = d`M${-b + rb} 0H${b - rb}Q${b} 0 ${b} ${-rb}V${yS}C${b} ${yS - sh * c1} ${n} ${yN + sh * c2} ${n} ${yN}V${yT}H${-n}V${yN}C${-n} ${yN + sh * c2} ${-b} ${yS - sh * c1} ${-b} ${yS}V${-rb}Q${-b} 0 ${-b + rb} 0Z`;
  const body = pp(bodyD);
  const sp = lx < 0 ? -b + bw * 0.2 : b - bw * 0.2 - 4.5;
  let s = "", nn = 2;
  const hasLab = ch(r, 0.8);
  const lab = (base) => (hasLab ? R(-b, -bh * 0.72, bw, bh * 0.44, base) + label(K, K.lab, -b, -bh * 0.72, bw, bh * 0.44, base) : "");
  if (mat === "glass") {
    const g1 = `${X}-bg`, g2 = `${X}-bl`;
    const tint = K.tint, liq = K.liq;
    defs.push(lin(g1, mirror(lx, [[0, tint, 0.8], [0.2, lighten(tint, 0.5), 0.3], [0.5, lighten(tint, 0.7), 0.16], [0.8, tint, 0.4], [1, tint, 0.85]])));
    defs.push(lin(g2, mirror(lx, [[0, darken(liq, 0.35)], [0.25, lighten(liq, 0.12)], [0.5, liq], [0.8, darken(liq, 0.25)], [1, darken(liq, 0.45)]])));
    defs.push(`<clipPath id="${X}-cb"><path d="${bodyD}"/></clipPath>`);
    const yL = yS - sh * rg(r, 0, 0.7);
    s += body(url(g1));
    s += G({ "clip-path": url(`${X}-cb`) }, R(-b + 2.2, yL, bw - 4.4, -yL - 3.5, url(g2), { opacity: 0.93 }) + E(0, yL, b - 2.2, 2.4, lighten(liq, 0.35), { opacity: 0.85 }) + R(-b, -3.6, bw, 3.6, darken(K.tint, 0.3), { opacity: 0.35 }));
    s += body("none", { stroke: darken(tint, 0.25), "stroke-opacity": 0.55, "stroke-width": 1.1 });
    s += lab(K.paper);
    s += body(url(`${X}-hg`)) + spec(X, sp, yS - sh * 0.1, 4.5, bh * 0.82, 0.75) + spec(X, lx < 0 ? b - 7 : -b + 3, yS + bh * 0.1, 2, bh * 0.5, 0.35);
    nn += 2;
  } else if (mat === "frost") {
    const g1 = `${X}-bf`, t = K.tint;
    defs.push(lin(g1, mirror(lx, [[0, darken(t, 0.2)], [0.2, lighten(t, 0.6)], [0.5, lighten(t, 0.4)], [0.85, t], [1, darken(t, 0.3)]])));
    s += body(url(g1)) + lab(K.paper) + body(url(`${X}-h`)) + body(url(`${X}-v`)) + spec(X, sp - 1, yS - sh * 0.1, 7, bh * 0.8, 0.35);
  } else if (mat === "amber") {
    const g1 = `${X}-ba`;
    defs.push(lin(g1, mirror(lx, [[0, "#2a1004"], [0.18, "#8a4410"], [0.32, "#d58a2c"], [0.55, "#8d4710"], [0.85, "#3b1a07"], [1, "#1c0b03"]])));
    s += body(url(g1)) + lab(K.paper) + body(url(`${X}-hg`)) + spec(X, sp, yS - sh * 0.1, 4, bh * 0.78, 0.7);
    nn += 1;
  } else {
    s += shade(X, body, K.pc) + lab(K.pc === "" ? K.paper : K.pc) + spec(X, sp, yS - sh * 0.1, 4, bh * 0.7, 0.35);
  }
  // closure
  let tH;
  if (top === "cork") {
    const cw = nw + 2.5;
    tH = rg(r, 15, 21);
    const g3 = `${X}-bc`;
    defs.push(lin(g3, mirror(lx, [[0, "#6e4727"], [0.3, "#d3a574"], [0.7, "#b98652"], [1, "#6e4727"]])));
    s += R(-cw / 2, yT - tH, cw, tH, url(g3), { rx: 2 }) + Pa(d`M${-cw * 0.25} ${yT - tH * 0.7}h1.4M${cw * 0.1} ${yT - tH * 0.4}h1.4M${-cw * 0.05} ${yT - tH * 0.85}h1.2`, "none", { stroke: "#4a2d14", "stroke-width": 1.1, "stroke-opacity": 0.6 });
  } else if (top === "dropper") {
    tH = 36;
    const cw = nw + 6;
    s += shade(X, rr(-cw / 2, yT - 7, cw, 7, 1.5), K.cap, "hm");
    const bulb = d`M${-n * 0.8} ${yT - 7}C${-n * 0.95} ${yT - 22} ${-n * 0.55} ${yT - 36} 0 ${yT - 36}C${n * 0.55} ${yT - 36} ${n * 0.95} ${yT - 22} ${n * 0.8} ${yT - 7}Z`;
    s += shade(X, pp(bulb), lightness(K.cap) < 20 ? "#26221e" : K.cap) + spec(X, lx < 0 ? -n * 0.5 : n * 0.2, yT - 30, 3, 15, 0.5);
    tH = 36;
  } else if (top === "pump") {
    const cw = nw + 7, dir = ch(r, 0.5) ? 1 : -1;
    tH = rg(r, 30, 38);
    s += shade(X, rr(-cw / 2, yT - 8, cw, 8, 1.5), K.cap, "hm");
    s += shade(X, rr(-3, yT - 18, 6, 10, 1), K.metal, "hm");
    const hx = dir > 0 ? -9 : -13;
    s += shade(X, rr(hx, yT - 29, 22, 11, 3), K.cap, "hm");
    s += shade(X, rr(dir > 0 ? 8 : -22, yT - 27, 14, 5.5, 2), K.cap, "hm");
    tH = 29;
  } else {
    const cw = nw + 7;
    tH = rg(r, 12, 18);
    s += shade(X, rr(-cw / 2, yT - tH, cw, tH, 2.5), K.cap, "hm") + ridges(-cw / 2 + 1, yT - tH + 2, cw - 2, tH - 4, 9) + spec(X, lx < 0 ? -cw / 2 + 2 : cw / 2 - 5, yT - tH + 1.5, 3, tH - 3, 0.45);
  }
  return { svg: s, w: bw + (top === "pump" ? 8 : 0), h: bh + sh + nl + tH, rd: sq ? -0.1 : 0.55, n: nn + (hasLab ? 2 : 0) };
}

function can(K) {
  const { r, X, lx, defs } = K;
  const w = rg(r, 42, 52), h = rg(r, 98, 118), b = w / 2;
  const bodyD = d`M${-b} ${-6}Q${-b} 0 ${-b + 5} 0H${b - 5}Q${b} 0 ${b} -6V${-h + 9}L${b - 3} ${-h}H${-b + 3}L${-b} ${-h + 9}Z`;
  const body = pp(bodyD);
  const g1 = `${X}-cs`;
  defs.push(lin(g1, mirror(lx, [[0, "#9ea3aa"], [0.2, "#f2f4f6"], [0.5, "#c3c7cc"], [0.85, "#81868d"], [1, "#b2b6bb"]])));
  let s = body(K.pc) + R(-b, -h * 0.9, w, h * 0.12, K.ac, { opacity: 0.9 }) + R(-b, -h * 0.1, w, h * 0.09, K.ac, { opacity: 0.9 });
  s += label(K, K.lab === "none" ? "stripe" : K.lab, -b, -h * 0.78, w, h * 0.62, K.pc);
  s += body(url(`${X}-hm`)) + body(url(`${X}-v`));
  s += E(0, -h, b - 3, 3.8, url(g1)) + E(0, -h, b - 6.5, 2.4, "none", { stroke: "#000", "stroke-opacity": 0.35, "stroke-width": 0.8 }) + R(-4.5, -h - 1.2, 9, 2.4, "#e4e6e8", { rx: 1.2 }) + R(-b, -3, w, 3, "#000", { opacity: 0.2 });
  s += spec(X, lx < 0 ? -b + w * 0.22 : b - w * 0.22 - 4, -h * 0.88, 3.6, h * 0.8, 0.6);
  return { svg: s, w, h: h + 4, rd: 0.8, n: 4 };
}

function jar(K) {
  const { r, X, lx, defs } = K;
  const jw = rg(r, 56, 78), jh = rg(r, 48, 70), lh = rg(r, 15, 22), lw = jw * 0.94, b = jw / 2;
  const glass = ch(r, 0.6);
  const bodyD = d`M${-b + 8} 0H${b - 8}Q${b} 0 ${b} -8V${-jh + 10}Q${b} ${-jh} ${b - 4} ${-jh}H${-b + 4}Q${-b} ${-jh} ${-b} ${-jh + 10}V-8Q${-b} 0 ${-b + 8} 0Z`;
  const body = pp(bodyD);
  let s = "";
  const lab = R(-b, -jh * 0.75, jw, jh * 0.5, K.paper) + label(K, K.lab, -b, -jh * 0.75, jw, jh * 0.5, K.paper);
  if (glass) {
    const g1 = `${X}-jg`, g2 = `${X}-jl`, t = K.tint, liq = K.liq;
    defs.push(lin(g1, mirror(lx, [[0, t, 0.8], [0.2, lighten(t, 0.5), 0.3], [0.55, lighten(t, 0.7), 0.15], [0.85, t, 0.4], [1, t, 0.85]])));
    defs.push(lin(g2, mirror(lx, [[0, darken(liq, 0.4)], [0.25, lighten(liq, 0.15)], [0.5, liq], [0.82, darken(liq, 0.25)], [1, darken(liq, 0.5)]])));
    defs.push(`<clipPath id="${X}-cb"><path d="${bodyD}"/></clipPath>`);
    s += body(url(g1)) + G({ "clip-path": url(`${X}-cb`) }, R(-b + 2.2, -jh + 6, jw - 4.4, jh - 8, url(g2), { opacity: 0.94 })) + lab + body("none", { stroke: darken(t, 0.25), "stroke-opacity": 0.5, "stroke-width": 1.1 });
    s += body(url(`${X}-hg`)) + spec(X, lx < 0 ? -b + 6 : b - 10, -jh + 12, 4.5, jh * 0.7, 0.7);
  } else {
    s += shade(X, body, K.pc) + label(K, K.lab, -b, -jh * 0.75, jw, jh * 0.5, K.pc) + spec(X, lx < 0 ? -b + 6 : b - 10, -jh + 12, 4, jh * 0.6, 0.35);
  }
  const lidCol = pick(r, [K.cap, K.cap, K.gold, "#f1ede4", darken(K.pc, 0.4)]);
  s += shade(X, rr(-lw / 2, -jh - lh, lw, lh, 3.5), lidCol, "hm") + ridges(-lw / 2 + 1, -jh - lh + 3, lw - 2, lh - 6, 18, 0.18) + R(-lw / 2 + 1, -jh - lh + 1, lw - 2, 1.2, "#fff", { opacity: 0.35 });
  return { svg: s, w: jw, h: jh + lh, rd: 0.5, n: 4 };
}

function tube(K) {
  const { r, X, lx } = K;
  const tw = rg(r, 34, 46), th = rg(r, 100, 128), capH = rg(r, 16, 22), capW = rg(r, 22, 30);
  const bodyD = d`M${-capW / 2} ${-capH}Q${-capW / 2 - 1} ${-capH - 6} ${-tw / 2} ${-capH - 22}L${-tw / 2 + 0.5} ${-th + 12}L${-tw / 2} ${-th}H${tw / 2}L${tw / 2 - 0.5} ${-th + 12}L${tw / 2} ${-capH - 22}Q${capW / 2 + 1} ${-capH - 6} ${capW / 2} ${-capH}Z`;
  const body = pp(bodyD);
  let s = body(K.pc) + label(K, K.lab === "none" ? "circle" : K.lab, -tw / 2, -th + 30, tw, th - capH - 54, K.pc);
  s += R(-tw / 2, -capH - 22, tw, 2.2, K.ac, { opacity: 0.85 });
  s += body(url(`${X}-h`)) + body(url(`${X}-v`)) + spec(X, lx < 0 ? -tw / 2 + 5 : tw / 2 - 8.5, -th + 22, 3.5, th - 60, 0.4);
  let cr = "";
  for (let i = 0; i < 5; i++) cr += R(-tw / 2 + 1, -th + 2 + i * 2.4, tw - 2, 0.7, "#000", { opacity: 0.25 });
  s += cr + R(-tw / 2, -th, tw, 1.4, "#fff", { opacity: 0.35 });
  s += shade(X, rr(-capW / 2, -capH, capW, capH, 3), K.cap, "hm") + ridges(-capW / 2 + 1, -capH + 2, capW - 2, capH - 4, 8, 0.2);
  return { svg: s, w: tw, h: th, rd: 0.2, n: 5 };
}

function box(K) {
  const { r, X, lx } = K;
  const fw = rg(r, 40, 56), bh = rg(r, 86, 118), sw = rg(r, 14, 24), tp = rg(r, 6, 10);
  const fx0 = -(fw + sw) / 2, fx1 = fx0 + fw, sx1 = fx1 + sw;
  const sideCol = lx < 0 ? darken(K.pc, 0.28) : lighten(K.pc, 0.12), frontCol = lx < 0 ? K.pc : darken(K.pc, 0.1), topCol = lighten(K.pc, 0.32);
  const g1 = `${X}-xf`;
  K.defs.push(lin(g1, mirror(lx, [[0, lighten(frontCol, 0.12)], [0.6, frontCol], [1, darken(frontCol, 0.1)]])));
  let s = R(fx0, -bh, fw, bh, url(g1)) + label(K, K.lab === "none" ? "lines" : K.lab, fx0, -bh * 0.8, fw, bh * 0.62, K.pc);
  s += R(fx0, -bh + 8, fw, 0.9, "#000", { opacity: 0.16 }) + R(fx0, -bh * 0.1, fw, 5, K.ac, { opacity: 0.85 });
  s += Pa(d`M${fx1} 0L${sx1} ${-tp}V${-bh - tp}L${fx1} ${-bh}Z`, sideCol);
  s += Pa(d`M${fx0} ${-bh}H${fx1}L${sx1} ${-bh - tp}H${fx0 + sw}Z`, topCol);
  s += Pa(d`M${fx0} ${-bh}H${fx1}L${sx1} ${-bh - tp}`, "none", { stroke: "#fff", "stroke-opacity": 0.5, "stroke-width": 0.8 });
  s += R(fx0, -bh, fw, bh, url(`${X}-v`));
  return { svg: s, w: fw + sw, h: bh + tp, rd: -0.95, n: 4 };
}

function pouch(K) {
  const { r, X, lx } = K;
  const pw = rg(r, 60, 74), ph = rg(r, 92, 112), b = pw / 2, metallic = ch(r, 0.35);
  const bodyD = d`M${-b} -6Q${-b} 0 ${-b + 8} 0Q0 5 ${b - 8} 0Q${b} 0 ${b} -6C${b + 3} ${-ph * 0.35} ${b - 2} ${-ph * 0.7} ${b} ${-ph}H${-b}C${-b + 2} ${-ph * 0.7} ${-b - 3} ${-ph * 0.35} ${-b} -6Z`;
  const body = pp(bodyD);
  let s = body(K.pc) + label(K, K.lab === "none" ? "arch" : K.lab, -b, -ph * 0.78, pw, ph * 0.56, K.pc);
  s += R(-b, -ph * 0.1, pw, 4, K.ac, { opacity: 0.9 });
  s += body(url(`${X}-${metallic ? "hm" : "h"}`)) + body(url(`${X}-v`));
  s += Pa(d`M${-b * 0.5} ${-ph * 0.3}Q${-b * 0.1} ${-ph * 0.45} ${b * 0.2} ${-ph * 0.7}M${b * 0.2} ${-ph * 0.2}Q${b * 0.4} ${-ph * 0.4} ${b * 0.55} ${-ph * 0.6}`, "none", { stroke: "#fff", "stroke-opacity": metallic ? 0.3 : 0.16, "stroke-width": 4, "stroke-linecap": "round" });
  // crimped top, zipper
  let cr = "";
  for (let i = 0; i < 4; i++) cr += R(-b, -ph + 2 + i * 2.6, pw, 0.8, "#000", { opacity: 0.22 });
  s += R(-b, -ph, pw, 11, "#000", { opacity: 0.07 }) + cr + R(-b + 1, -ph + 17, pw - 2, 1.2, "#000", { opacity: 0.3 }) + R(-b + 1, -ph + 18.4, pw - 2, 0.8, "#fff", { opacity: 0.4 }) + C(b * 0.55, -ph + 7, 1.8, "#000", { opacity: 0.35 });
  return { svg: s, w: pw + 6, h: ph + 5, rd: -0.2, n: 6 };
}

function tin(K) {
  const { r, X, lx, defs } = K;
  const tw = rg(r, 76, 100), th = rg(r, 22, 38), rx = tw / 2, ry = tw * 0.1, lidH = rg(r, 8, 12), rx2 = rx + 2, ry2 = ry + 0.2;
  const yBT = -ry - th, yLT = yBT - lidH;
  const bodyD = d`M${-rx} ${yBT}V${-ry}A${rx} ${ry} 0 0 0 ${rx} ${-ry}V${yBT}Z`;
  const lidD = d`M${-rx2} ${yLT}V${yBT}A${rx2} ${ry2} 0 0 0 ${rx2} ${yBT}V${yLT}Z`;
  const g1 = `${X}-tt`;
  defs.push(rad(g1, [[0, lighten(K.metal, 0.35)], [0.6, K.metal], [1, darken(K.metal, 0.2)]], lx < 0 ? 0.35 : 0.65, 0.4, 0.75));
  let s = pp(bodyD)(K.pc) + label(K, K.lab === "none" ? "stripe" : K.lab, -rx, yBT + th * 0.1, tw, th * 0.8, K.pc) + pp(bodyD)(url(`${X}-hm`)) + pp(bodyD)(url(`${X}-v`));
  s += shade(X, pp(lidD), K.metal, "hm") + E(0, yLT, rx2, ry2, url(g1));
  s += E(0, yLT, rx2 * 0.8, ry2 * 0.8, "none", { stroke: "#000", "stroke-opacity": 0.25, "stroke-width": 1 }) + E(0, yLT, rx2 * 0.3, ry2 * 0.3, "none", { stroke: "#fff", "stroke-opacity": 0.5, "stroke-width": 1.2 });
  s += E(lx < 0 ? -rx2 * 0.4 : rx2 * 0.4, yLT - ry2 * 0.2, rx2 * 0.28, ry2 * 0.2, "#fff", { opacity: 0.45 });
  return { svg: s, w: tw + 4, h: th + lidH + ry * 2, rd: 0.85, n: 4 };
}

function compact(K) {
  const { r, X, lx, defs } = K;
  const cw = rg(r, 76, 92), th = rg(r, 12, 16), cdp = rg(r, 30, 38), lh = rg(r, 52, 70), b = cw / 2;
  const frame = K.metal, powder = pick(r, ["#d9b99b", "#e8c9b0", "#c98f78", "#b55f56", "#efe0cf"]);
  const g1 = `${X}-pw`, g2 = `${X}-mi`;
  defs.push(rad(g1, [[0, lighten(powder, 0.2)], [1, darken(powder, 0.12)]], 0.4, 0.35, 0.7));
  defs.push(lin(g2, [[0, "#eef3f7"], [0.4, "#b4c2cf"], [0.5, "#f6f9fb"], [0.72, "#9fb1c0"], [1, "#cbd7e1"]], 0, 0, 1, 1));
  const yh = -th - cdp + 3;
  const lidD = d`M${-b} ${yh}Q${-b - 1} ${yh - lh * 0.5} ${-b + 4} ${yh - lh}Q0 ${yh - lh - 3} ${b - 4} ${yh - lh}Q${b + 1} ${yh - lh * 0.5} ${b} ${yh}Z`;
  let s = pp(lidD)(frame) + pp(lidD)(url(`${X}-hm`)) + R(-b + 5, yh - lh + 6, cw - 10, lh - 10, url(g2), { rx: 4 });
  s += Pa(d`M${-b + 14} ${yh - 6}L${-b + 34} ${yh - lh + 8}H${-b + 40}L${-b + 20} ${yh - 6}Z`, "#fff", { opacity: 0.4 }) + R(-b + 5, yh - lh + 6, cw - 10, lh - 10, "none", { rx: 4, stroke: darken(frame, 0.3), "stroke-opacity": 0.5, "stroke-width": 1 });
  s += shade(X, rr(-b, -th, cw, th, 5), frame, "hm");
  s += shade(X, rr(-b, -th - cdp, cw, cdp, 8), lighten(frame, 0.08), "h");
  s += rr(-b + 5, -th - cdp + 4.5, cw - 10, cdp - 9, 6)(darken(frame, 0.45)) + E(0, -th - cdp / 2, (cw - 20) / 2, (cdp - 13) / 2, url(g1)) + E(0, -th - cdp / 2, (cw - 30) / 2, (cdp - 21) / 2, "none", { stroke: "#fff", "stroke-opacity": 0.3, "stroke-width": 0.9 });
  s += R(-4, -th - 2, 8, 2.4, darken(frame, 0.3), { rx: 1, opacity: 0.7 });
  return { svg: s, w: cw, h: th + cdp + lh, rd: 0.0, n: 6 };
}

function speaker(K) {
  const { r, X, lx, defs } = K;
  const sw = rg(r, 64, 84), sh = rg(r, 90, 116), rad_ = rg(r, 10, 22), b = sw / 2;
  const body = rr(-b, -sh, sw, sh, rad_);
  const dark = ch(r, 0.55);
  const base = dark ? hsl(rg(r, 0, 360), 0.08, rg(r, 0.12, 0.2)) : K.pc;
  const fabric = dark ? darken(base, 0.1) : mix(K.pc, "#000", 0.28);
  const pt = `${X}-gp`;
  defs.push(`<pattern id="${pt}" width="3.6" height="3.6" patternUnits="userSpaceOnUse"><circle cx="1.8" cy="1.8" r="0.95" fill="#000" fill-opacity="0.5"/></pattern>`);
  let s = shade(X, body, base);
  const gx = -b + 6, gy = -sh + 24, gw = sw - 12, gh = sh - 36;
  s += rr(gx, gy, gw, gh, Math.max(4, rad_ - 6))(fabric) + rr(gx, gy, gw, gh, Math.max(4, rad_ - 6))(url(pt)) + rr(gx, gy, gw, gh, Math.max(4, rad_ - 6))(url(`${X}-hg`));
  s += C(0, gy + gh * 0.5, Math.min(gw, gh) * 0.17, "none", { stroke: K.ac, "stroke-width": 1.6 }) + C(0, gy + gh * 0.5, 2.2, K.ac);
  s += C(-b + 14, -sh + 12, 3.4, "none", { stroke: "#fff", "stroke-opacity": 0.55, "stroke-width": 1.2 }) + C(-b + 26, -sh + 12, 3.4, "none", { stroke: "#fff", "stroke-opacity": 0.55, "stroke-width": 1.2 }) + C(b - 13, -sh + 12, 2, K.ac) + C(b - 13, -sh + 12, 6, K.ac, { opacity: 0.25 });
  s += R(-b + 8, -3, 12, 3, "#000", { opacity: 0.5 }) + R(b - 20, -3, 12, 3, "#000", { opacity: 0.5 }) + body("none", { stroke: "#fff", "stroke-opacity": 0.15, "stroke-width": 1 });
  return { svg: s, w: sw, h: sh, rd: -0.35 + rad_ / 60, n: 6 };
}

function perfume(K) {
  const { r, X, lx, defs } = K;
  const pw = rg(r, 50, 66), ph = rg(r, 64, 82), tb = rg(r, 10, 16), capW = pw * rg(r, 0.42, 0.55), capH = rg(r, 20, 30), b = pw / 2;
  const liq = K.liq, t = K.tint;
  const g1 = `${X}-pg`, g2 = `${X}-pl`;
  defs.push(lin(g1, mirror(lx, [[0, t, 0.85], [0.2, lighten(t, 0.55), 0.35], [0.6, lighten(t, 0.7), 0.18], [1, t, 0.8]])));
  defs.push(lin(g2, [[0, lighten(liq, 0.25)], [0.5, liq], [1, darken(liq, 0.3)]], 0, 0, 0, 1));
  let s = rr(-b, -ph, pw, ph, 6)(url(g1)) + rr(-b + 5, -ph + 9, pw - 10, ph - 9 - tb, 3)(url(g2), { opacity: 0.92 }) + R(-b, -tb, pw, tb, darken(t, 0.3), { opacity: 0.35 });
  s += Pa(d`M${-b + 5} ${-ph + 9}L${-b + 14} ${-ph + 3}M${b - 5} ${-ph + 9}L${b - 14} ${-ph + 3}M${-b + 5} ${-tb}L${-b} ${-tb + 5}M${b - 5} ${-tb}L${b} ${-tb + 5}`, "none", { stroke: "#fff", "stroke-opacity": 0.45, "stroke-width": 0.9 });
  const plateCol = pick(r, [K.gold, K.ac, "#f4efe6"]);
  s += rr(-pw * 0.2, -ph * 0.58, pw * 0.4, ph * 0.22, 2)(plateCol) + R(-pw * 0.12, -ph * 0.58 + ph * 0.07, pw * 0.24, 1.6, inkOn(plateCol), { opacity: 0.8 }) + R(-pw * 0.07, -ph * 0.58 + ph * 0.13, pw * 0.14, 1.2, inkOn(plateCol), { opacity: 0.6 });
  s += rr(-b, -ph, pw, ph, 6)(url(`${X}-hg`)) + rr(-b, -ph, pw, ph, 6)("none", { stroke: darken(t, 0.3), "stroke-opacity": 0.5, "stroke-width": 1.1 }) + spec(X, lx < 0 ? -b + 5 : b - 9, -ph + 12, 4, ph * 0.55, 0.65);
  const capCol = pick(r, [K.gold, "#1b1815", K.metal]);
  s += shade(X, rr(-capW / 2 - 2, -ph - 6, capW + 4, 7, 1.5), K.metal, "hm") + shade(X, rr(-capW / 2, -ph - 6 - capH, capW, capH, ch(r, 0.5) ? 2 : capW / 2.4), capCol, "hm") + spec(X, lx < 0 ? -capW / 2 + 2 : capW / 2 - 5, -ph - capH, 3, capH - 6, 0.5);
  return { svg: s, w: pw, h: ph + 6 + capH, rd: -0.65, n: 6 };
}

// ---------- top-down versions of the round forms (flat-lay); origin = centre
function topTin(K) {
  const { r, X, lx, defs } = K;
  const R0 = rg(r, 38, 50), g1 = `${X}-tt`;
  defs.push(rad(g1, [[0, lighten(K.metal, 0.4)], [0.6, K.metal], [1, darken(K.metal, 0.25)]], lx < 0 ? 0.35 : 0.65, 0.35, 0.8));
  let s = C(0, 0, R0, url(g1)) + C(0, 0, R0 - 3, "none", { stroke: "#000", "stroke-opacity": 0.25, "stroke-width": 1 }) + C(0, 0, R0 * 0.78, K.pc, { opacity: 0.92 }) + C(0, 0, R0 * 0.78, url(g1), { opacity: 0.25 });
  s += label(K, K.lab === "none" ? "circle" : "circle", -R0 * 0.6, -R0 * 0.6, R0 * 1.2, R0 * 1.2, K.pc) + C(0, 0, R0, "none", { stroke: "#fff", "stroke-opacity": 0.35, "stroke-width": 1.2 });
  return { svg: s, w: R0 * 2, h: R0 * 2, rd: 0.9, n: 4, top: true };
}
function topJar(K) {
  const { r, X, lx, defs } = K;
  const R0 = rg(r, 30, 42), g1 = `${X}-tj`;
  const lid = pick(r, [K.cap, K.gold, "#f1ede4", K.pc]);
  defs.push(rad(g1, [[0, lighten(lid, 0.35)], [0.7, lid], [1, darken(lid, 0.3)]], lx < 0 ? 0.35 : 0.65, 0.35, 0.8));
  let s = C(0, 0, R0, url(g1)) + C(0, 0, R0 - 1.5, "none", { stroke: "#000", "stroke-opacity": 0.35, "stroke-width": 2.6, "stroke-dasharray": "1.2 1.6" }) + C(0, 0, R0 * 0.7, "none", { stroke: "#fff", "stroke-opacity": 0.35, "stroke-width": 1 }) + C(0, 0, R0 * 0.25, "none", { stroke: inkOn(lid), "stroke-opacity": 0.6, "stroke-width": 1.2 });
  return { svg: s, w: R0 * 2, h: R0 * 2, rd: 0.9, n: 3, top: true };
}
function topCompact(K) {
  const { r, X, defs } = K;
  const cw = rg(r, 74, 90), chh = cw * 0.95, b = cw / 2, frame = K.metal, powder = pick(r, ["#d9b99b", "#e8c9b0", "#c98f78", "#b55f56"]);
  const g1 = `${X}-pw`, g2 = `${X}-mi`;
  defs.push(rad(g1, [[0, lighten(powder, 0.2)], [1, darken(powder, 0.12)]], 0.4, 0.35, 0.7));
  defs.push(lin(g2, [[0, "#eef3f7"], [0.4, "#b4c2cf"], [0.5, "#f6f9fb"], [0.72, "#9fb1c0"], [1, "#cbd7e1"]], 0, 0, 1, 1));
  let s = rr(-b, -chh / 2, cw, chh, 12)(frame) + rr(-b, -chh / 2, cw, chh, 12)(url(`${X}-hm`));
  s += rr(-b + 5, -chh / 2 + 5, cw - 10, chh / 2 - 8, 7)(url(g2)) + Pa(d`M${-b + 14} ${-6}L${-b + 30} ${-chh / 2 + 8}H${-b + 36}L${-b + 20} ${-6}Z`, "#fff", { opacity: 0.4 });
  s += rr(-b + 5, 4, cw - 10, chh / 2 - 9, 7)(darken(frame, 0.45)) + C(0, 4 + (chh / 2 - 9) / 2, (chh / 2 - 17) / 2 + 4, url(g1));
  return { svg: s, w: cw, h: chh, rd: -0.1, n: 6, top: true };
}

const BUILD = {
  bottleG: (K) => bottle(K, "glass", pick(K.r, ["screw", "screw", "cork"])),
  bottleF: (K) => bottle(K, "frost", pick(K.r, ["screw", "screw", "cork", "dropper"])),
  bottleA: (K) => bottle(K, "amber", pick(K.r, ["dropper", "dropper", "screw", "pump"])),
  pump: (K) => bottle(K, pick(K.r, ["opaque", "frost", "glass"]), "pump"),
  can, jar, tube, box, pouch, tin, compact, speaker, perfume,
};
const TOPDOWN = { tin: topTin, jar: topJar, compact: topCompact };

// =====================================================================================================
// PROPS
// =====================================================================================================
const leafCols = (r, g) => {
  const base = hsl(rg(r, 85, 160), rg(r, 0.28, 0.55), g.dark ? rg(r, 0.2, 0.3) : rg(r, 0.26, 0.4));
  return base;
};
function fronds(g, x, y, L, ang, flip, base) {
  const { r } = g;
  const bend = rg(r, 0.15, 0.4) * flip, n = ri(r, 6, 8);
  let sub = "";
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1) * 0.92 + 0.06, sx = bend * L * t * t, sy = -L * t;
    const ll = L * 0.3 * (Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7 + 0.18);
    for (const sd of [-1, 1]) {
      const tx = sx + sd * ll * 0.92, ty = sy - ll * 0.3 + ll * 0.45 * t;
      sub += d`M${sx} ${sy}Q${sx + sd * ll * 0.5} ${sy - ll * 0.42} ${tx} ${ty}`;
    }
  }
  const stem = Pa(d`M0 0Q${bend * L * 0.5} ${-L * 0.5} ${bend * L} ${-L}`, "none", { stroke: darken(base, 0.2), "stroke-width": 1.2 });
  return G({ transform: `translate(${f(x)} ${f(y)}) rotate(${f(ang)})` }, stem + Pa(sub, "none", { stroke: base, "stroke-width": 2.6, "stroke-linecap": "round" }));
}
function leafShape(g, x, y, L, w, ang, base) {
  const dd = d`M0 0C${w * 0.9} ${-L * 0.25} ${w * 0.75} ${-L * 0.78} 0 ${-L}C${-w * 0.75} ${-L * 0.78} ${-w * 0.9} ${-L * 0.25} 0 0Z`;
  const gid = g.gid();
  g.defs.push(lin(gid, [[0, darken(base, 0.28)], [0.5, base], [1, lighten(base, 0.18)]]));
  return G({ transform: `translate(${f(x)} ${f(y)}) rotate(${f(ang)})` }, Pa(dd, url(gid)) + Pa(d`M0 -1L0 ${-L * 0.92}`, "none", { stroke: lighten(base, 0.3), "stroke-opacity": 0.7, "stroke-width": 0.9 }) + Pa(d`M0 0C${w * 0.9} ${-L * 0.25} ${w * 0.75} ${-L * 0.78} 0 ${-L}L0 0Z`, "#000", { opacity: 0.16 }));
}
const fruitCols = [["#ee8a1a", "#ffd27a"], ["#f2d21c", "#fff0a0"], ["#8bbd28", "#e3f0a0"], ["#e2514a", "#ffc0b0"]];
function slice(g, x, y, rad_, fc) {
  const gid = g.gid();
  g.defs.push(rad(gid, [[0, lighten(fc[1], 0.2)], [1, fc[0]]], 0.5, 0.5, 0.55));
  let seg = "";
  const n = ri(g.r, 7, 10);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    seg += `M0 0L${f(Math.cos(a) * rad_ * 0.78)} ${f(Math.sin(a) * rad_ * 0.78)}`;
  }
  return G({ transform: `translate(${f(x)} ${f(y)})` }, C(0, 0, rad_, fc[0]) + C(0, 0, rad_ * 0.9, lighten(fc[1], 0.55)) + C(0, 0, rad_ * 0.82, url(gid)) + Pa(seg, "none", { stroke: lighten(fc[1], 0.7), "stroke-width": 0.9, "stroke-opacity": 0.8 }) + C(0, 0, rad_ * 0.07, lighten(fc[1], 0.6)));
}
function ball(g, x, y, rd, c) {
  const gid = g.gid();
  g.defs.push(rad(gid, [[0, lighten(c, 0.5)], [0.45, c], [1, darken(c, 0.5)]], g.lx < 0 ? 0.33 : 0.67, 0.3, 0.8));
  return C(x, y, rd, url(gid));
}
function cube(g, x, y, s, c) {
  const dp = s * 0.35;
  return Pa(d`M${x - s / 2} ${y}h${s}v${-s}h${-s}Z`, g.lx < 0 ? c : darken(c, 0.12)) + Pa(d`M${x + s / 2} ${y}l${dp} ${-dp * 0.8}v${-s}l${-dp} ${dp * 0.8}Z`, g.lx < 0 ? darken(c, 0.3) : lighten(c, 0.1)) + Pa(d`M${x - s / 2} ${y - s}h${s}l${dp} ${-dp * 0.8}h${-s}Z`, lighten(c, 0.3));
}
const shadowEl = (x, y, rx, ry, col, op = 0.35) => E(x, y, rx, ry, col, { opacity: op });

/** Draws one prop kind. g: geometry + context. Returns { back, front, n, rd, ar (share of frame), pat: [[hex, share]] }. */
function prop(kind, g) {
  const { r, ox, u, side, up } = g, ow = g.ow;
  const sc = g.shadowCol;
  let back = "", front = "", n = 1, rd = 0, ar = 0.03, pat = [];
  const anchors = g.anchors; // flat-lay: free spots, consumed in order
  const spot = () => anchors.length ? anchors.shift() : [rg(r, 30, 210), rg(r, 30, 270)];
  if (kind === "leaves") {
    const base = leafCols(r, g), palm = ch(r, 0.55);
    const k = up ? ri(r, 2, 3) : ri(r, 2, 4);
    for (let i = 0; i < k; i++) {
      const [px, py] = up ? [ox + side * (ow / 2 + rg(r, 6, 30)) + side * i * rg(r, 4, 14), g.yf - 1] : spot();
      const L = up ? u * rg(r, 0.7, 1.25) : rg(r, 70, 120), ang = up ? side * rg(r, 6, 34) * (i ? -0.6 : 1) : rg(r, 0, 360);
      back += palm ? fronds(g, px, py, L, ang, ch(r, 0.5) ? 1 : -1, base) : leafShape(g, px, py, L * 0.8, L * 0.2, ang, base);
    }
    n = 2 + (palm ? 1 : 0); rd = palm ? -0.1 : 0.2; ar = 0.07; pat = [[base, 0.07]];
  } else if (kind === "citrus") {
    const fc = pick(r, fruitCols), rs = up ? u * rg(r, 0.1, 0.15) : rg(r, 14, 22);
    const k = up ? 1 : ri(r, 2, 3);
    for (let i = 0; i < k; i++) {
      const [px, py] = up ? [ox + side * (ow / 2 + rs * 0.9), g.yf - rs * 0.95] : spot();
      front += (up ? shadowEl(px + 1, g.yf, rs * 1.0, rs * 0.17, sc, 0.4) : "") + slice(g, px, py, rs * (i ? rg(r, 0.8, 1.1) : 1), fc);
    }
    const [wx, wy] = up ? [ox + side * (ow / 2 + rs * 2.9), g.yf - rs * 0.8] : spot();
    front += (up ? shadowEl(wx, g.yf, rs * 0.85, rs * 0.14, sc, 0.4) : "") + ball(g, wx, wy, rs * 0.85, fc[0]);
    n = 3; rd = 1; ar = 0.05; pat = [[fc[0], 0.04], [fc[1], 0.02]];
  } else if (kind === "geo") {
    const cols = [g.col.ac, lighten(g.col.bg, 0.25), darken(g.col.bg, 0.2), "#f4f0e8"];
    const c1 = pick(r, cols), c2 = pick(r, cols);
    const rs = up ? u * rg(r, 0.1, 0.16) : rg(r, 14, 24);
    if (up) {
      const bx = ox + side * (ow / 2 + rs * 1.2);
      front += shadowEl(bx + 2, g.yf, rs * 1.1, rs * 0.2, sc, 0.4) + ball(g, bx, g.yf - rs, rs, c1);
      const cs = rs * 1.3, cx2 = ox + side * (ow / 2 + rs * 3.6);
      front += shadowEl(cx2 + 2, g.yf + 1, cs * 0.9, cs * 0.17, sc, 0.4) + cube(g, cx2, g.yf, cs, c2);
    } else {
      const [px, py] = spot(), [qx, qy] = spot();
      front += G({ filter: url(`${g.X}-ds`) }, ball(g, px, py, rs, c1) + R(qx - rs, qy - rs, rs * 2, rs * 2, c2, { rx: 3 }));
    }
    n = 2; rd = -0.15; ar = 0.04; pat = [[c1, 0.025], [c2, 0.025]];
  } else if (kind === "drops") {
    const k = up ? ri(r, 7, 10) : ri(r, 8, 11), wc = lighten(g.col.bg, 0.4);
    let sh = "", bd = "", hl = "";
    for (let i = 0; i < k; i++) {
      const air = up && i > k * 0.55;
      const sp = up ? null : spot();
      const px = up ? ox + rg(r, -1, 1) * (ow * 0.9 + 14) : sp[0], py = up ? (air ? g.yb - rg(r, 0.25, 0.9) * g.oh : g.yf + rg(r, -2, 8)) : sp[1];
      const rs = air ? rg(r, 1.5, 4.2) : rg(r, 2, 4.8), fl = air ? 1 : 0.78, k2 = g.lx < 0 ? 1 : -1;
      if (!air) sh += `<ellipse cx="${f(px + k2 * 1.4)}" cy="${f(py + rs * 0.5)}" rx="${f(rs * 1.1)}" ry="${f(rs * 0.55)}"/>`;
      bd += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(rs)}" ry="${f(rs * fl)}"/>`;
      hl += `<circle cx="${f(px - rs * 0.3 * k2)}" cy="${f(py - rs * 0.3)}" r="${f(rs * 0.28)}"/>`;
    }
    front += G({ fill: sc, opacity: 0.35 }, sh) + G({ fill: wc, "fill-opacity": 0.28, stroke: "#fff", "stroke-opacity": 0.65, "stroke-width": 0.7 }, bd) + G({ fill: "#fff", opacity: 0.9 }, hl);
    n = 2; rd = 1; ar = 0.02; pat = [[wc, 0.02]];
  } else if (kind === "petals") {
    const k = ri(r, 7, 11), pc1 = hsl(rg(r, -20, 20) + (ch(r, 0.4) ? 330 : 0), rg(r, 0.5, 0.8), rg(r, 0.75, 0.9)), pc2 = lighten(pc1, 0.35);
    const g1 = g.gid(), pid = `${g.X}-pt`;
    g.defs.push(lin(g1, [[0, pc1], [1, pc2]], 0, 1, 0, 0));
    g.defs.push(`<path id="${pid}" d="M0 0C7 -3 7 -10 0 -13C-7 -10 -7 -3 0 0Z" fill="${url(g1)}"/>`);
    let s = "";
    for (let i = 0; i < k; i++) {
      const [px, py] = up ? [ox + rg(r, -1, 1) * 85 * (i % 3 === 0 ? 1.2 : 0.7), g.yf + rg(r, -4, 20)] : spot();
      const air = up && i % 4 === 0, sy = up && !air ? 0.5 : 1, scl = rg(r, 0.8, 1.35);
      s += `<use href="#${pid}" transform="translate(${f(px)} ${f(air ? g.yb - rg(r, 0.3, 1) * g.oh : py)}) rotate(${f(rg(r, 0, 360))}) scale(${f(scl)} ${f(scl * sy)})"/>`;
    }
    front += up ? s : G({ filter: url(`${g.X}-ds`) }, s); n = 2; rd = 0.8; ar = 0.05; pat = [[pc1, 0.05]];
  } else if (kind === "stones") {
    const c0 = hsl(rg(r, 20, 50), rg(r, 0.05, 0.2), rg(r, 0.5, 0.7)), k = ri(r, 3, 4);
    let s = "";
    for (let i = 0; i < k; i++) {
      const rs = up ? u * rg(r, 0.06, 0.12) : rg(r, 8, 15);
      const [px, py] = up ? [ox + side * (ow / 2 + 6 + i * rs * 1.5 + rs), g.yf - rs * 0.35 + (i % 2) * 3] : spot();
      const cc = i % 2 ? lighten(c0, 0.1) : darken(c0, 0.1), gid = g.gid();
      g.defs.push(rad(gid, [[0, lighten(cc, 0.3)], [1, darken(cc, 0.35)]], 0.35, 0.3, 0.8));
      s += (up ? shadowEl(px + 1.5, py + rs * 0.45, rs * 1.05, rs * 0.2, sc, 0.4) : "") + E(px, py, rs * 1.15, rs * 0.8, url(gid));
    }
    front += up ? s : G({ filter: url(`${g.X}-ds`) }, s); n = 2; rd = 0.7; ar = 0.04; pat = [[c0, 0.04]];
  } else if (kind === "grass") {
    const gc = hsl(rg(r, 34, 46), rg(r, 0.3, 0.45), g.dark ? 0.62 : rg(r, 0.5, 0.66)), k = ri(r, 6, 9);
    let s = "";
    const [bx, by] = up ? [ox + side * (ow / 2 + 14), g.yf] : spot();
    const a0 = rg(r, 0, 360);
    for (let i = 0; i < k; i++) {
      const L = up ? u * rg(r, 0.8, 1.5) : rg(r, 70, 110), ang = up ? side * rg(r, -6, 30) + rg(r, -10, 10) : a0 + rg(r, -14, 14), bend = rg(r, -10, 18);
      const sx = bx + rg(r, -6, 6), sy = by + (up ? 0 : rg(r, -6, 6));
      const ex = Math.sin((ang * Math.PI) / 180) * L, ey = -Math.cos((ang * Math.PI) / 180) * L;
      s += Pa(d`M${sx} ${sy}Q${sx + ex * 0.5 + bend} ${sy + ey * 0.55} ${sx + ex} ${sy + ey}`, "none", { stroke: gc, "stroke-width": 0.9, "stroke-opacity": 0.9 }) + E(sx + ex, sy + ey, 1.6, 5, lighten(gc, 0.15), { transform: `rotate(${f(ang)} ${f(sx + ex)} ${f(sy + ey)})` });
    }
    back += up ? s : G({ filter: url(`${g.X}-ds`) }, s); n = 2; rd = -0.7; ar = 0.04; pat = [[gc, 0.03]];
  } else if (kind === "ribbon") {
    const c1 = g.col.ac, c2 = lighten(c1, 0.3), gid = g.gid();
    g.defs.push(lin(gid, [[0, darken(c1, 0.25)], [0.45, c2], [1, c1]]));
    if (up) {
      const y0 = g.yf + rg(r, 0, 10), t = rg(r, 14, 22), flip = ch(r, 0.5) ? 1 : -1;
      back += Pa(d`M-10 ${y0}C60 ${y0 - 30 * flip} 120 ${y0 + 25 * flip} 250 ${y0 - 8 * flip}L250 ${y0 - 8 * flip + t}C130 ${y0 + 25 * flip + t} 60 ${y0 - 30 * flip + t * 0.7} -10 ${y0 + t}Z`, url(gid), { opacity: 0.95 });
      back += Pa(d`M-10 ${y0 + 3}C60 ${y0 - 30 * flip + 2} 120 ${y0 + 25 * flip + 2} 250 ${y0 - 8 * flip + 2}`, "none", { stroke: "#fff", "stroke-opacity": 0.4, "stroke-width": 1 });
    } else {
      const flip = ch(r, 0.5) ? 1 : -1;
      front += G({ filter: url(`${g.X}-ds`) }, Pa(d`M-10 ${rg(r, 200, 260)}C70 ${150 * flip + 120} 150 ${120 - 60 * flip} 250 ${rg(r, 40, 100)}l-4 22C150 ${150 - 60 * flip} 70 ${180 + 40 * flip} -14 ${rg(r, 215, 280)}Z`, url(gid)));
    }
    n = 2; rd = 0.6; ar = 0.08; pat = [[c1, 0.08]];
  } else if (kind === "sun") {
    const cc = pick(r, [g.col.ac, lighten(g.col.bg, 0.3), darken(g.col.bg, 0.22), g.col.gold]);
    const gid = g.gid();
    g.defs.push(lin(gid, [[0, lighten(cc, 0.12)], [1, darken(cc, 0.1)]], 0, 0, 0.3, 1));
    if (up) {
      const rs = u * rg(r, 0.5, 0.75), cy = g.yb - g.oh * rg(r, 0.4, 0.62);
      back += C(ox + side * rg(r, -8, 24), cy, rs, url(gid)) + (ch(r, 0.5) ? C(ox + side * 8, cy, rs * 1.18, "none", { stroke: cc, "stroke-opacity": 0.5, "stroke-width": 1.2 }) : "");
      ar = Math.min(0.2, (Math.PI * rs * rs) / (W * H) * 0.8); pat = [[cc, ar]];
    } else {
      const rs = g.fr * 0.62;
      back += G({ filter: url(`${g.X}-ds`) }, C(g.fx, g.fy, rs, url(gid)) + C(g.fx, g.fy, rs * 0.86, "none", { stroke: lighten(cc, 0.3), "stroke-opacity": 0.5, "stroke-width": 1.4 }));
      ar = Math.min(0.2, (Math.PI * rs * rs) / (W * H) * 0.8); pat = [[cc, ar]];
    }
    n = 1; rd = 1;
  }
  return { back, front, n, rd, ar, pat };
}

// =====================================================================================================
// build
// =====================================================================================================
export function build(rand, ctx) {
  const r = rand, X = String(ctx.id);
  const season = String(ctx.season ?? "");
  const idx = ((Number(ctx.index) | 0) % 32 + 32) % 32;
  const slot = planShot(season)[idx];
  const defs = [];
  let uid = 0;
  const gid = () => `${X}-g${uid++}`;
  const patches = []; // [hex, share of frame]
  const rounds = []; // [roundness, weight]
  let nLayers = 0;
  let footprint = 0; // share of the frame occupied (object + stage + props)
  const flat = slot.stage === "flat";
  const M = colours(r, slot.mood, slot.tone);
  const dark = M.dark;
  const lx = ch(r, 0.5) ? -1 : 1; // side the light comes from
  const gel = slot.light === "gel";
  const gels = pick(r, [[330, 200], [20, 215], [280, 170], [2, 188], [45, 262]]);
  const gelA = hsl(gels[0], 1, 0.55), gelB = hsl(gels[1], 1, 0.5);
  const lightCol = slot.light === "soft" ? "#ffffff" : "#ffe3b0";
  const sunStrength = { soft: 0.06, window: 0.16, leaf: 0.12, gel: 0, spot: 0.1 }[slot.light];
  const tintBack = (c) => mix(c, lightCol, sunStrength);

  // ----- the object
  const K = { r, X, lx, defs, pc: M.pc, ac: M.ac, cap: M.cap, metal: M.metal, tint: M.tint, liq: M.liq, paper: M.paper, gold: M.gold, lab: slot.label };
  let flatAng = 0;
  if (flat) {
    flatAng = ch(r, 0.3) ? pick(r, [-90, 90, 0]) : rg(r, 25, 70) * (ch(r, 0.5) ? 1 : -1);
    const a = (flatAng * Math.PI) / 180, dot = Math.cos(a) * -0.6 + Math.sin(a) * -0.8;
    K.lx = dot > 0 ? 1 : -1;
  }
  const ovl = overlays(X, K.lx, gel ? (lx < 0 ? gelA : gelB) : null, gel ? (lx < 0 ? gelB : gelA) : null, slot.gloss ? 1.4 : 0.8);
  const topDown = flat && TOPDOWN[slot.form] && ch(r, 0.8);
  const obj = topDown ? TOPDOWN[slot.form](K) : BUILD[slot.form](K);
  nLayers += obj.n * 0.5;
  for (const k in ovl) if (obj.svg.includes(`#${X}-${k})`)) defs.push(ovl[k]);

  // ----- scale & placement
  const hFrac = [0.38, 0.5, 0.62, 0.74][slot.size];
  const comp = slot.comp;
  let ox = comp === "centre" ? 120 : comp === "left" ? rg(r, 78, 90) : rg(r, 150, 162);
  const layers = { bg: "", back: "", stage: "", shadow: "", obj: "", front: "", fx: "" };
  let sObj, yb, yf, hz, objBox, oh, ow;
  let surfaceCol, shadowCol;
  let stageRound = 0.3, stageW = 0, stageCover = 0, graphic = 0;
  const gdef = (s) => defs.push(s);

  const bgWall = (c) => patches.push([tintBack(c), 0.5]);

  let ph = 0;
  if (!flat) {
    // ======== upright stages
    let lift = 0;
    if (slot.stage === "floor" || slot.stage === "water") { yf = rg(r, 218, 246); yb = yf; }
    else if (slot.stage === "float") { yf = rg(r, 246, 262); lift = rg(r, 26, 44); yb = yf - lift; }
    else if (slot.stage === "steps") { ph = rg(r, 44, 66); yf = rg(r, 262, 272); yb = yf - ph; }
    else { ph = rg(r, 32, 58); yf = rg(r, 258, 272); yb = yf - ph; }
    const hmax = yb - (slot.stage === "float" ? 44 : 16);
    const wmaxBase = ["cyl", "block", "steps"].includes(slot.stage) ? 0.5 : 0.7;
    sObj = Math.min((hFrac * H) / obj.h, hmax / obj.h, (wmaxBase * W) / obj.w);
    ow = obj.w * sObj; oh = obj.h * sObj;
    ox = Math.max(ow / 2 + 14, Math.min(W - ow / 2 - 14, ox));
    hz = yf - rg(r, 38, 80);
    surfaceCol = M.front;
  } else {
    ow = 0; oh = 0;
  }

  // ----- backdrop
  const bk = slot.back;
  const texId = `${X}-tx`, grId = `${X}-gr`;
  let useTex = false;
  const bgLayer = () => {
    let s = "";
    if (flat) {
      const g1 = `${X}-bw`;
      if (bk === "gradient") {
        defs.push(lin(g1, [[0, M.gTop], [1, M.gBot]], 0, 0, 0.5, 1));
      } else {
        defs.push(lin(g1, [[0, M.lit], [1, M.front]], lx < 0 ? 0 : 1, 0, lx < 0 ? 1 : 0, 1));
      }
      s += R(0, 0, W, H, url(g1));
      patches.push([tintBack(bk === "gradient" ? mix(M.gTop, M.gBot, 0.5) : mix(M.lit, M.front, 0.5)), 1]);
      surfaceCol = mix(M.lit, M.front, 0.5);
      if (bk === "paper" || bk === "concrete") useTex = bk;
      if (bk === "concrete") surfaceCol = mix(surfaceCol, "#8a8a8a", 0.3);
    } else {
      const wallTop = bk === "gradient" ? M.gTop : M.dim, wallBot = bk === "gradient" ? M.gBot : M.lit;
      const floorTop = bk === "gradient" ? M.gBot : bk === "concrete" ? mix(M.front, "#8c8c8c", 0.35) : M.lit;
      const floorBot = bk === "gradient" ? darken(M.gBot, 0.12) : bk === "concrete" ? darken(mix(M.front, "#8c8c8c", 0.35), 0.1) : M.front;
      const w1 = `${X}-bw`, f1 = `${X}-fl`;
      let fT = floorTop, fB = floorBot;
      if (slot.stage === "water") { fT = mix(floorTop, "#7cc0dc", 0.35); fB = mix(floorBot, "#4f9ec0", 0.3); }
      if (bk === "bokeh") { fT = darken(floorTop, 0.18); fB = darken(floorBot, 0.28); }
      defs.push(lin(w1, [[0, wallTop], [1, wallBot]], 0, 0, 0, 1));
      defs.push(lin(f1, [[0, fT], [1, fB]], 0, 0, 0, 1));
      s += R(0, 0, W, hz + 1, url(w1)) + R(0, hz, W, H - hz, url(f1));
      if (bk === "concrete" || bk === "gradient" || bk === "bokeh") s += R(0, hz, W, 1, "#fff", { opacity: bk === "bokeh" ? 0.12 : 0.22 });
      patches.push([tintBack(mix(wallTop, wallBot, 0.5)), hz / H], [tintBack(mix(fT, fB, 0.5)), 1 - hz / H]);
      surfaceCol = mix(fT, fB, 0.4);
      if (bk === "paper") useTex = "paper";
      if (bk === "concrete") useTex = "concrete";
    }
    if (useTex) {
      const conc = useTex === "concrete";
      const col = dark ? "1" : "0";
      defs.push(`<filter id="${texId}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${conc ? "0.07 0.09" : "0.7 0.9"}" numOctaves="3" seed="${ri(r, 1, 99)}"/><feColorMatrix type="matrix" values="0 0 0 0 ${col} 0 0 0 0 ${col} 0 0 0 0 ${col} 0 0 0 ${conc ? "2.2 -0.8" : "1.7 -0.6"}"/></filter>`);
      const y0 = flat || !conc ? 0 : hz;
      s += R(0, y0, W, H - y0, "#000", { filter: url(texId), opacity: conc ? (dark ? 0.1 : 0.2) : dark ? 0.06 : 0.09 });
      nLayers += 1.2;
    }
    if (bk === "bokeh") {
      const cols = [lighten(M.lit, 0.45), "#fff3d6", M.ac];
      const gids = cols.map((c, i) => { const id = `${X}-bk${i}`; defs.push(rad(id, [[0, c, 0.25], [0.8, c, 0.6], [1, c, 0.0]])); return id; });
      defs.push(`<filter id="${X}-bb" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.4"/></filter>`);
      let bs = "";
      const n = ri(r, 8, 13);
      for (let i = 0; i < n; i++) bs += C(rg(r, 0, W), rg(r, 0, hz + 10), rg(r, 8, 26), url(gids[ri(r, 0, 2)]), { opacity: rg(r, 0.4, 0.9) });
      s += G({ filter: url(`${X}-bb`) }, bs);
      nLayers += 2;
      rounds.push([1, 0.2]);
    }
    return s;
  };
  layers.bg = bgLayer();
  if (!flat) shadowCol = darken(hsl(M.h, Math.min(0.5, M.s), 0.2), 0.3);
  else shadowCol = darken(hsl(M.h, Math.min(0.5, M.s), 0.2), 0.3);

  // ----- lighting (backdrop level)
  let vig = 0.2, lightRound = 0.6;
  {
    let s = "";
    const lxp = lx < 0 ? 40 : 200;
    if (slot.light === "soft") {
      const g1 = `${X}-lg`;
      defs.push(rad(g1, [[0, "#fff", 0.32], [1, "#fff", 0]], 0.5, 0.5, 0.5));
      s += R(lxp - 160, -120, 320, 320, url(g1));
      vig = dark ? 0.35 : 0.2; lightRound = 0.8;
    } else if (slot.light === "window") {
      defs.push(`<filter id="${X}-wb" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="0.9"/></filter>`);
      const pw = rg(r, 30, 38), ph2 = rg(r, 42, 52), gap = rg(r, 5, 7);
      let panes = "";
      for (let ci = 0; ci < 2; ci++) for (let ri_ = 0; ri_ < 3; ri_++) panes += R(ci * (pw + gap), ri_ * (ph2 + gap), pw, ph2, "#fff0cc");
      const tx = lx < 0 ? rg(r, -40, 0) : W - 2 * pw - gap - rg(r, 0, 40), ty = rg(r, -10, 30);
      s += R(0, 0, W, H, "#000", { opacity: 0.12 }) + G({ filter: url(`${X}-wb`), opacity: dark ? 0.32 : 0.5 }, G({ transform: `translate(${f(tx)} ${f(ty)}) skewX(${lx < 0 ? -16 : 16}) rotate(${lx < 0 ? 4 : -4})` }, panes));
      vig = 0.22; lightRound = -0.9; nLayers += 2;
    } else if (slot.light === "leaf") {
      defs.push(`<filter id="${X}-wb" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2.4"/></filter>`);
      let lv = "";
      const k = ri(r, 5, 7);
      for (let i = 0; i < k; i++) {
        const L = rg(r, 120, 200), w = rg(r, 14, 26), a = (lx < 0 ? 10 : -10) + (i - (k - 1) / 2) * 24 + rg(r, -6, 6);
        lv += `<path transform="rotate(${f(a)})" d="${d`M0 0C${w} ${-L * 0.3} ${w * 0.8} ${-L * 0.8} 0 ${-L}C${-w * 0.8} ${-L * 0.8} ${-w} ${-L * 0.3} 0 0Z`}"/>`;
      }
      s += R(0, 0, W, H, "#fff0cc", { opacity: 0.08 }) + G({ filter: url(`${X}-wb`), opacity: 0.3 }, G({ fill: "#000", transform: `translate(${lx < 0 ? -6 : W + 6} ${rg(r, 150, 230)}) rotate(${lx < 0 ? 62 : -62}) scale(1.1)` }, lv));
      vig = 0.22; lightRound = 0.2; nLayers += 2;
    } else if (slot.light === "gel") {
      const g1 = `${X}-ga`, g2 = `${X}-gb`;
      defs.push(rad(g1, [[0, gelA, 0.6], [1, gelA, 0]], 0.5, 0.5, 0.5), rad(g2, [[0, gelB, 0.55], [1, gelB, 0]], 0.5, 0.5, 0.5));
      s += R(-120, 20, 300, 300, url(g1)) + R(60, 20, 300, 300, url(g2));
      patches.push([gelA, 0.14], [gelB, 0.12]);
      vig = 0.5; lightRound = 0.3; nLayers += 1.5;
    } else {
      const g1 = `${X}-lg`, ex = ox;
      defs.push(rad(g1, [[0, "#ffe9bf", 0.5], [0.55, "#ffe9bf", 0.16], [1, "#ffe9bf", 0]], 0.5, 0.5, 0.5));
      s += R(ex - 150, (flat ? 150 : yb - oh * 0.5) - 150, 300, 300, url(g1));
      vig = 0.55; lightRound = 0.6; nLayers += 1;
    }
    if (dark && slot.light !== "gel") vig = Math.max(vig, 0.4);
    layers.back += s;
    rounds.push([lightRound, 0.12]);
  }

  // ----- props context
  const side0 = comp === "left" ? (ch(r, 0.4) ? 1 : -1) : comp === "right" ? (ch(r, 0.4) ? -1 : 1) : ch(r, 0.5) ? 1 : -1;
  const pctx = { r, X, defs, gid, up: !flat, ox, ow, oh, u: oh, yb, yf, side: side0, lx, col: M, dark, shadowCol, anchors: [], fx: 0, fy: 0, fr: 0 };
  const propsOut = [];
  const runProps = () => {
    for (const kind of slot.props) {
      const o = prop(kind, pctx);
      propsOut.push(o);
      patches.push(...o.pat);
      footprint += o.ar;
      rounds.push([o.rd, 0.18]);
      nLayers += o.n;
      if (kind === "sun" || kind === "geo") graphic += o.ar * 3;
    }
  };

  if (!flat) {
    // ======== podium / steps / water
    let stage = "", shadowClip = "", topY = yb;
    if (slot.stage === "cyl" || slot.stage === "block" || slot.stage === "steps") {
      const pc0 = ch(r, 0.55) ? hsl(M.h, M.s * 0.9, c01(M.l + (M.light ? -0.05 : 0.1))) : ch(r, 0.5) ? M.ac : M.light ? "#f4f0e8" : "#1b1a1c";
      const round = slot.stage === "cyl" || (slot.stage === "steps" && ch(r, 0.5));
      const pw0 = Math.max(ow * rg(r, 1.15, 1.45), 66);
      const nSteps = slot.stage === "steps" ? ri(r, 2, 3) : 1;
      const hh = slot.stage === "steps" ? ph / nSteps : ph;
      const topRx = pw0 / 2;
      let ytop = yf;
      for (let i = 0; i < nSteps; i++) {
        const rx = topRx * (1 + (nSteps - 1 - i) * 0.24), y1 = yf - hh * i, y0 = y1 - hh, ry = rx * 0.2;
        const col = i === nSteps - 1 ? pc0 : mix(pc0, M.light ? "#000" : "#fff", 0.07 * (nSteps - 1 - i));
        const gh = `${X}-ph${i}`;
        defs.push(lin(gh, mirror(lx, [[0, darken(col, 0.15)], [0.25, lighten(col, 0.18)], [0.6, col], [1, darken(col, 0.4)]])));
        if (round) {
          stage += Pa(d`M${ox - rx} ${y0}V${y1}A${rx} ${ry} 0 0 0 ${ox + rx} ${y1}V${y0}Z`, url(gh)) + E(ox, y0, rx, ry, lighten(col, 0.16)) + E(ox, y0, rx, ry, "none", { stroke: "#fff", "stroke-opacity": 0.35, "stroke-width": 0.8 });
        } else {
          const dp = rx * 0.34;
          stage += R(ox - rx, y0, rx * 2, hh, url(gh)) + Pa(d`M${ox - rx} ${y0}H${ox + rx}L${ox + rx - dp * 0.15} ${y0 - dp}H${ox - rx + dp * 0.15}Z`, lighten(col, 0.18)) + R(ox - rx, y0, rx * 2, 0.9, "#fff", { opacity: 0.4 });
        }
        if (i === nSteps - 1) {
          ytop = y0;
          const ry2 = rx * 0.2, dp = rx * 0.34;
          topY = round ? y0 + ry2 * 0.2 : y0 - dp * 0.35;
          shadowClip = round ? `<clipPath id="${X}-sc"><ellipse cx="${f(ox)}" cy="${f(y0)}" rx="${f(rx)}" ry="${f(ry2)}"/></clipPath>` : `<clipPath id="${X}-sc"><path d="M${f(ox - rx)} ${f(y0)}H${f(ox + rx)}L${f(ox + rx - dp * 0.15)} ${f(y0 - dp)}H${f(ox - rx + dp * 0.15)}Z"/></clipPath>`;
        }
        stageCover += (rx * 2 * (hh + (round ? ry : rx * 0.34))) / (W * H) * (i === 0 ? 1 : 0.5);
      }
      layers.stage += stage;
      stageRound = round ? 0.9 : -0.85;
      stageW = 0.22 + 0.06 * nSteps;
      if (slot.stage === "steps") { stageRound = round ? 0.3 : -0.7; stageW += 0.1; nLayers += 1.5; }
      nLayers += 1.5;
      patches.push([pc0, Math.min(0.2, stageCover * 1.1)]);
      graphic += Math.min(0.3, stageCover * 2) * Math.min(1, Math.abs(lightness(pc0) - lightness(M.bg)) / 40 + chroma(pc0) * 0.6);
      defs.push(shadowClip);
      // floor shadow of the podium
      layers.shadow += E(ox - lx * topRx * 0.35, yf + 2, topRx * 1.35, topRx * 0.28, shadowCol, { opacity: 0.4, filter: url(`${X}-b8`) });
      yb = topY;
    } else if (slot.stage === "water") {
      let rip = "";
      const k = ri(r, 3, 5);
      for (let i = 0; i < k; i++) {
        const rx = ow * (0.6 + i * rg(r, 0.3, 0.45)), ry = rx * 0.17;
        rip += E(ox, yf + 1, rx, ry, "none", { stroke: "#fff", "stroke-opacity": 0.6 - i * 0.1, "stroke-width": 1.4 - i * 0.15 });
        rip += E(ox, yf + 2.4, rx, ry, "none", { stroke: "#000", "stroke-opacity": 0.1, "stroke-width": 1 });
      }
      layers.stage += rip;
      stageRound = 1; stageW = 0.2; nLayers += 2; stageCover = 0.12;
    } else if (slot.stage === "float") {
      stageRound = 0.4; stageW = 0.05;
    } else {
      stageRound = 0.3; stageW = 0.05;
    }
    pctx.yb = yb; pctx.yf = slot.stage === "cyl" || slot.stage === "block" || slot.stage === "steps" ? yb + 2 : yf;
    pctx.oh = oh;

    // back / front props
    runProps();
    layers.back += propsOut.map((o) => o.back).join("");

    // halo behind the object
    {
      const g1 = `${X}-hl`;
      defs.push(rad(g1, [[0, "#fff", dark ? 0.18 : 0.26], [1, "#fff", 0]], 0.5, 0.5, 0.5));
      layers.back += E(ox, yb - oh * 0.55, Math.max(110, ow * 1.6), Math.max(110, oh * 0.9), url(g1));
    }

    // shadows
    const podium = ["cyl", "block", "steps"].includes(slot.stage);
    const hard = slot.light === "window" || slot.light === "leaf";
    const blurId = (std) => { const id = `${X}-b${String(std).replace(".", "p")}`; if (!defs.some((q) => q.includes(`id="${id}"`))) defs.push(`<filter id="${id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${std}"/></filter>`); return id; };
    blurId(8); blurId(4); blurId(1.6);
    const shF = `${X}-sf`;
    defs.push(`<filter id="${shF}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${hard ? 1.3 : podium ? 2.2 : 3.4}"/><feColorMatrix values="0 0 0 0 ${f(hexToRgbN(shadowCol)[0])} 0 0 0 0 ${f(hexToRgbN(shadowCol)[1])} 0 0 0 0 ${f(hexToRgbN(shadowCol)[2])} 0 0 0 ${hard ? 0.62 : 0.5} 0"/></filter>`);
    const sOff = slot.stage === "float" ? yf : yb;
    const len = podium ? 0.4 : hard ? rg(r, 0.9, 1.5) : rg(r, 0.4, 0.8);
    const sg = `<use href="#${X}-o" transform="matrix(${f(sObj)} 0 ${f(lx * len * sObj)} ${f(-sObj * (podium ? 0.14 : hard ? 0.26 : 0.2))} ${f(ox)} ${f(sOff)})"/>`;
    const shG = G({ filter: url(shF) }, sg);
    layers.shadow += podium ? G({ "clip-path": url(`${X}-sc`) }, shG) : shG;
    // contact shadow
    const cry = Math.max(2, ow * 0.06);
    if (slot.stage === "float") {
      layers.shadow += E(ox, yf + 2, ow * 0.5, ow * 0.075, shadowCol, { opacity: 0.55, filter: url(`${X}-b4`) });
      layers.shadow += E(ox, yf + 1, ow * 0.62, ow * 0.11, shadowCol, { opacity: 0.25, filter: url(`${X}-b8`) });
    } else {
      const cc = E(ox, yb, ow * 0.5, cry, shadowCol, { opacity: 0.75, filter: url(`${X}-b1p6`) }) + E(ox - lx * ow * 0.1, yb + 1, ow * 0.62, cry * 2.2, shadowCol, { opacity: 0.28, filter: url(`${X}-b8`) });
      layers.shadow += podium ? G({ "clip-path": url(`${X}-sc`) }, cc) : cc;
    }
    // reflection
    if (slot.gloss && (slot.stage !== "steps") && (slot.stage !== "float" || true)) {
      const rl = Math.min(oh * 0.5, 70), ry0 = slot.stage === "float" ? yf : yb;
      const mg = `${X}-rg`, mk = `${X}-rm`;
      defs.push(lin(mg, [[0, "#fff", 0.5], [1, "#fff", 0]], 0, f(ry0), 0, f(ry0 + rl), ` gradientUnits="userSpaceOnUse"`));
      defs.push(`<mask id="${mk}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="${f(ry0)}" width="${W}" height="${f(rl)}" fill="${url(mg)}"/></mask>`);
      const rf = `<use href="#${X}-o" transform="matrix(${f(sObj)} 0 0 ${f(-sObj)} ${f(ox)} ${f(slot.stage === "float" ? yf - 2 : yb)})" opacity="0.55"/>`;
      const refl = G({ mask: url(mk) }, rf);
      layers.shadow += podium ? G({ "clip-path": url(`${X}-sc`) }, refl) : refl;
      nLayers += 1;
    }
    // the object
    const tilt = slot.stage === "float" ? rg(r, -8, 8) : 0;
    layers.obj = `<use href="#${X}-o" transform="translate(${f(ox)} ${f(yb)})${tilt ? ` rotate(${f(tilt)} 0 ${f(-oh * 0.5)})` : ""} scale(${f(sObj)})"/>`;
    layers.front += propsOut.map((o) => o.front).join("");
    objBox = { x0: ox - ow / 2, x1: ox + ow / 2, y0: yb - oh, y1: yb };
  } else {
    // ======== flat-lay
    const a = (flatAng * Math.PI) / 180;
    const rot = topDown ? 0 : flatAng;
    const bw0 = obj.w, bh0 = obj.h;
    const ex = topDown ? bw0 : Math.abs(Math.cos(a)) * bw0 + Math.abs(Math.sin(a)) * bh0, ey = topDown ? bh0 : Math.abs(Math.sin(a)) * bw0 + Math.abs(Math.cos(a)) * bh0;
    sObj = Math.min((hFrac * 1.05 * H) / Math.max(bh0, bw0 * 1.1), (0.78 * W) / ex, (0.8 * H) / ey);
    ow = ex * sObj; oh = ey * sObj;
    const fx = Math.max(ow / 2 + 12, Math.min(W - ow / 2 - 12, ox)), fy = rg(r, H * 0.42, H * 0.58);
    ox = fx;
    pctx.fx = fx; pctx.fy = fy; pctx.fr = Math.max(ow, oh) / 2; pctx.ow = ow; pctx.oh = oh;
    // free spots for props
    const spots = [[34, 40], [206, 44], [32, 264], [208, 262], [120, 30], [120, 274], [24, 150], [216, 150], [70, 90], [170, 220], [180, 80], [60, 220]];
    pctx.anchors = shuffle(r, spots.filter(([px, py]) => Math.hypot(px - fx, py - fy) > Math.max(ow, oh) * 0.5 + 24));
    const dsHard = slot.light === "window" || slot.light === "leaf" || slot.light === "spot";
    const ox2 = lx < 0 ? 1 : -1;
    defs.push(`<filter id="${X}-ds" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feDropShadow dx="${ox2 * (dsHard ? 6 : 4)}" dy="${dsHard ? 8 : 6}" stdDeviation="${dsHard ? 1.3 : 4.5}" flood-color="${shadowCol}" flood-opacity="${dsHard ? 0.5 : 0.4}"/></filter>`);
    runProps();
    layers.back += propsOut.map((o) => o.back).join("");
    // object
    const tf = topDown ? `translate(${f(fx)} ${f(fy)}) scale(${f(sObj)})` : `translate(${f(fx)} ${f(fy)}) rotate(${f(rot)}) scale(${f(sObj)}) translate(0 ${f(bh0 / 2)})`;
    layers.obj = G({ filter: url(`${X}-ds`) }, `<use href="#${X}-o" transform="${tf}"/>`);
    layers.front += propsOut.map((o) => o.front).join("");
    objBox = { x0: fx - ow / 2, x1: fx + ow / 2, y0: fy - oh / 2, y1: fy + oh / 2 };
    stageRound = 0.2; stageW = 0.0;
    nLayers += 1.5;
    surfaceCol = surfaceCol ?? M.front;
  }

  // ----- finishing: vignette + grain (the second and last feTurbulence filter)
  {
    const gv = `${X}-vg`;
    defs.push(rad(gv, [[0.45, "#000", 0], [1, "#000", vig]], 0.5, flat ? 0.5 : 0.45, 0.78));
    layers.fx += R(0, 0, W, H, url(gv));
    defs.push(`<filter id="${grId}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${ri(r, 1, 99)}"/><feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1"/></filter>`);
    layers.fx += R(0, 0, W, H, "#808080", { filter: url(grId), opacity: dark ? 0.07 : 0.1 });
  }

  // object patches & footprint
  const objShare = Math.min(0.5, (ow * oh) / (W * H) * 0.7);
  patches.push([K.pc, objShare * 0.62], [K.ac, objShare * 0.2], [K.cap, objShare * 0.18]);
  footprint += objShare + stageCover * 0.9;
  rounds.push([obj.rd, 0.5 + objShare], [stageRound, stageW + 0.03]);

  defs.unshift(`<clipPath id="${X}-fr"><rect width="${W}" height="${H}"/></clipPath>`);
  const objDef = `<g id="${X}-o">${obj.svg}</g>`;
  const body = layers.bg + layers.back + layers.stage + layers.shadow + layers.obj + layers.front + layers.fx;
  const svg = svgRoot(W, H, `<defs>${defs.join("")}${objDef}</defs>${G({ "clip-path": url(`${X}-fr`) }, body)}`);

  // ----- traits
  let tot = 0, wa = 0, wl = 0, wc = 0, wwarm = 0, wwarmAcc = 0;
  for (const [hex, share] of patches) {
    tot += share;
  }
  tot = tot || 1;
  for (const [hex, share] of patches) {
    const w = share / tot, [h, s, l] = hexToHsl(hex), c = s * (1 - Math.abs(2 * l - 1));
    wl += w * lightness(hex);
    wc += w * c;
    const ww = w * c;
    wwarm += ww;
    wwarmAcc += ww * warmthOfHue(h);
  }
  const warm = wwarm < 0.004 ? 0 : clamp((wwarmAcc / wwarm) * 1.15);
  const vivid = clamp((wc - 0.22) / 0.24);
  const lAll = wl * (1 - 0.3 * vig);
  const dk = clamp(1 - lAll / 45);
  // bold
  const bgMix = mix(tintBack(M.bg), M.bg, 0.5);
  const dL = Math.abs(lightness(K.pc) - lightness(bgMix)) / 100;
  const [hb, sb] = hexToHsl(bgMix), [hp, sp_] = hexToHsl(K.ac);
  const hdist = Math.abs(((hp - hb + 540) % 360) - 180) / 180;
  const cc = dL * 0.9 + hdist * Math.min(chroma(K.ac), chroma(bgMix) + 0.15) * 0.8;
  const cT = clamp((cc - 0.4) / 0.5);
  const sT = clamp(((ow * oh) / (W * H) - 0.16) / 0.16);
  const bT = clamp((graphic - 0.08) / 0.14);
  const bold = clamp((0.5 * cT + 0.3 * sT + 0.2 * bT) * 1.2 - 0.14);
  // round
  let rs = 0, rw = 0;
  for (const [v, w] of rounds) { rs += v * w; rw += w; }
  const round = clamp((rs / (rw || 1) - 0.12) * 1.7);
  // airy
  const empty = 1 - Math.min(1, footprint * 1.25);
  const airy = clamp((empty - 0.62) / 0.22 + (comp !== "centre" && slot.size <= 1 ? 0.1 : 0));
  const rich = richOf(nLayers, 5, 13);

  return { name: slot.name, svg, traits: { warm, bold, round, airy, vivid, rich, dark: dk } };
}

function hexToRgbN(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
