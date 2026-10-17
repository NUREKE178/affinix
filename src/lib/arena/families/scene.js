// Arena family "scene": photo-like generated scenes (atmospheric landscape / mood photography as used in ads and sites).
//
// Not flat vector icons: every scene is a stack of gradient layers with atmospheric haze, soft radial glows, light
// rays, bokeh, cloud banks made from ONE feTurbulence cloud filter, a film-grain overlay (the 2nd and last
// feTurbulence), a colour-grade tint and a vignette. Both filters are limited to the viewBox, numOctaves <= 3;
// no <image>, no fonts, no scripts, nothing fetched.
//
// 16 scene types (composition + subject): sunset mountains, misty forest, ocean horizon, desert dunes, neon/dusk
// city, snowy alpine peaks, tropical beach, rainy window bokeh, meadow at dawn, lake reflection, starry night,
// aurora, mesa canyon, sea of clouds, autumn grove, lone tree. 16 colour grades (golden, crimson, blue hour,
// teal-orange, mist, neon, pastel, moody, high-key, autumn, arctic, rosy, midnight, dusty, vivid, monochrome),
// each shifted a little in hue and exposed darker / brighter per specimen.
//
// A pool of 32 is *planned* per season (planScene, a pure function of ctx.season, memoised): the 16 types are dealt
// twice in shuffled blocks (every type 2x, never twice in a row at the seam), grades are dealt evenly (each ~2x)
// among those a type can wear, so no two specimens share "grade + type" (= the name); the knobs horizon, subject
// size, density, exposure, sun position and cloud cover are stratified over the 32 slots (a permutation each), so
// every axis is covered. build()'s own rand() only adds the per-specimen variation.
//
// Traits are MEASURED from what is drawn. Each drawing call also paints a coarse 30x38 raster of the frame
// (colour, "calm" = empty sky / water / snow, "shape" = solid form with its roundness) with the same geometry,
// the same gradients and the same glows / haze / tint / vignette as the SVG; the traits are read from that raster:
//   warm  = chroma-weighted mean of warmthOfHue over all cells (orange +1 ... blue -1)
//   vivid = mean chroma (max-min of the cell colour) over all cells
//   dark  = mean CIE L* of the whole frame (sky + ground weighted by area)
//   bold  = strength of the graphic masses: 0.45 * light/dark contrast (P92 - P8 of L*) + 0.35 * silhouette share
//           (solid-form cells that are darker than the frame) + 0.20 * size of the sun / moon / peak
//   round = area-weighted roundness of the solid forms (dunes, waves, hills, clouds, round sun/moon +1;
//           jagged peaks, pines, skyline blocks -1)
//   airy  = mean "calm" share of the frame (clear sky, still water, snow; clouds and detail reduce it)
//   rich  = richOf(number of layers / elements drawn)
// The raw values are mapped to [-1, 1] with fixed affine constants (CAL) calibrated so a pool spans the range.
import { svgRoot } from "../svgutil.js";
import { hexToRgb, hexToHsl, hsl, mix } from "../color.js";
import { warmthOfHue, clamp, richOf } from "../traits.js";
import { mulberry32, hashStringToSeed, shuffle } from "../../prng.js";

export const DIMS = ["preference", "attention", "quality", "premium", "friendly", "natural", "energetic", "modern"];
export const TEXT = false;
export const VIEWBOX = [240, 300];

const W = 240, H = 300;

/* ------------------------------------------------------------------ small helpers */
const f1 = (n) => { const v = Math.round(n * 10) / 10; return v === 0 ? 0 : v; };
const f2 = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const c01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a, b, t) => a + (b - a) * t;
const pt = (x, y) => f1(x) + " " + f1(y);
const polyD = (pts) => "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z";
const rg = (g, a, b) => a + (b - a) * g.r();
const mx = mix;
const RGB = new Map();
const rgbOf = (h) => { let v = RGB.get(h); if (!v) { v = hexToRgb(h); RGB.set(h, v); } return v; };
const SCR = ' style="mix-blend-mode:screen"';
const WHITE = "#ffffff", BLACK = "#000000";

/* ------------------------------------------------------------------ the frame raster (what is drawn, measured) */
const CW = 30, CH = 38, NC = CW * CH, CX = W / CW, CY = H / CH;
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const s = i / 255; LIN[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }

const newRaster = () => ({
  r: new Float32Array(NC), g: new Float32Array(NC), b: new Float32Array(NC),
  calm: new Float32Array(NC), rnd: new Float32Array(NC).fill(NaN),
});

/** Paints coverage `cov(x, y)` (0..1) of `col` (an [r,g,b] array or a gradient with .at(y)) into the raster. */
function paint(R, cov, col, m) {
  const grad = !Array.isArray(col);
  for (let j = 0; j < CH; j++) {
    const y = (j + 0.5) * CY;
    let c = grad && !col.cell ? col.at(y) : col;
    for (let i = 0; i < CW; i++) {
      let a = cov((i + 0.5) * CX, y);
      if (!(a > 0.003)) continue;
      if (a > 1) a = 1;
      if (col.cell) c = col.cell((i + 0.5) * CX, y);
      const k = j * CW + i;
      R.r[k] += (c[0] - R.r[k]) * a; R.g[k] += (c[1] - R.g[k]) * a; R.b[k] += (c[2] - R.b[k]) * a;
      if (m) { R.calm[k] += (m.calm - R.calm[k]) * a; if (a >= 0.5) R.rnd[k] = m.rnd; }
    }
  }
}

/** [r,g,b] -> CIE L* */
function lstar(r, g, b) {
  const y = 0.2126 * LIN[Math.round(r)] + 0.7152 * LIN[Math.round(g)] + 0.0722 * LIN[Math.round(b)];
  const t = y > 216 / 24389 ? Math.cbrt(y) : ((24389 / 27) * y + 16) / 116;
  return 116 * t - 16;
}

/* ------------------------------------------------------------------ gradients, filters, soft sprites */
const gid = (g, n) => `${g.id}${n}${g.k++}`;

/** Vertical user-space linear gradient; stops [offset, hex, alpha?]; returns { ref, at(y) -> [r,g,b] }. */
function vg(g, name, y0, y1, stops, noDef) {
  const id = noDef ? "" : gid(g, name);
  if (!noDef) g.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(y0)}" x2="0" y2="${f1(y1)}">${stops.map(([o, c, a]) => `<stop offset="${f2(o)}" stop-color="${c}"${a !== undefined && a < 1 ? ` stop-opacity="${f2(a)}"` : ""}/>`).join("")}</linearGradient>`);
  const S = stops.map(([o, c]) => [o, rgbOf(c)]), out = [0, 0, 0], span = y1 - y0 || 1;
  return {
    ref: `url(#${id})`,
    at(y) {
      const t = c01((y - y0) / span);
      let i = 0;
      while (i < S.length - 2 && t > S[i + 1][0]) i++;
      const a = S[i], b = S[i + 1] ?? S[i], u = b[0] === a[0] ? 0 : c01((t - a[0]) / (b[0] - a[0]));
      out[0] = a[1][0] + (b[1][0] - a[1][0]) * u; out[1] = a[1][1] + (b[1][1] - a[1][1]) * u; out[2] = a[1][2] + (b[1][2] - a[1][2]) * u;
      return out;
    },
  };
}

/** Horizontal gradient with hard steps, skewed so its steps lean (dune slip faces). stops [offset 0..1 over x -10..250, hex]. */
function hgx(g, stops, tan) {
  const id = gid(g, "x");
  g.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-10" x2="250" y1="0" y2="0" gradientTransform="skewX(${f1((Math.atan(tan) * 180) / Math.PI)})">${stops.map(([o, c]) => `<stop offset="${f2(o)}" stop-color="${c}"/>`).join("")}</linearGradient>`);
  const S = stops.map(([o, c]) => [o, rgbOf(c)]), out = [0, 0, 0];
  return {
    ref: `url(#${id})`,
    cell(x, y) {
      const t = c01((x - y * tan + 10) / 260);
      let i = 0;
      while (i < S.length - 2 && t > S[i + 1][0]) i++;
      const a = S[i], b = S[i + 1], u = b[0] === a[0] ? 1 : c01((t - a[0]) / (b[0] - a[0]));
      out[0] = a[1][0] + (b[1][0] - a[1][0]) * u; out[1] = a[1][1] + (b[1][1] - a[1][1]) * u; out[2] = a[1][2] + (b[1][2] - a[1][2]) * u;
      return out;
    },
  };
}

/** Cached objectBoundingBox vertical gradient (stops [offset, hex, alpha]); the element's `opacity` scales it. */
function bgrad(g, key, stops) {
  if (!g.cache[key]) {
    const id = gid(g, "q");
    g.defs.push(`<linearGradient id="${id}" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ""}/>`).join("")}</linearGradient>`);
    g.cache[key] = `url(#${id})`;
  }
  return g.cache[key];
}

/** Radial gradient in user space (for a big shaped glow); stops [offset, hex, alpha]. */
function rg2(g, name, cx, cy, r, stops) {
  const id = gid(g, name);
  g.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}">${stops.map(([o, c, a]) => `<stop offset="${f2(o)}" stop-color="${c}" stop-opacity="${f2(a)}"/>`).join("")}</radialGradient>`);
  return `url(#${id})`;
}

/** Bounding-box radial sprite, cached per kind + colour: "soft" (a glow) or "ball" (a bokeh disc with a brighter rim). */
function sprite(g, kind, col) {
  const key = kind + col;
  if (!g.cache[key]) {
    const id = gid(g, kind[0]);
    const stops = kind === "soft"
      ? [[0, 1], [0.4, 0.38], [1, 0]]
      : [[0, 0.5], [0.78, 0.68], [0.93, 1], [1, 0]];
    g.defs.push(`<radialGradient id="${id}">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>`).join("")}</radialGradient>`);
    g.cache[key] = `url(#${id})`;
  }
  return g.cache[key];
}

/** A user-space Gaussian blur filter limited to the viewBox (no turbulence). */
function blur(g, sd) {
  const key = "b" + sd;
  if (!g.cache[key]) {
    const id = gid(g, "b");
    g.defs.push(`<filter id="${id}" x="0" y="0" width="240" height="300" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
    g.cache[key] = `url(#${id})`;
  }
  return g.cache[key];
}

/** THE cloud filter of the specimen (feTurbulence #1): composite the source gradient with a soft noise alpha. */
function cloudFilter(g) {
  if (!g.cache.cf) {
    const id = gid(g, "cf"), bx = rg(g, 0.0055, 0.0105), by = bx * rg(g, 2.2, 4.2);
    const K = 7, B = -K * (0.585 - 0.17 * g.s.cv);
    g.defs.push(`<filter id="${id}" x="0" y="0" width="240" height="300" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${f1(bx * 1000) / 1000} ${f1(by * 1000) / 1000}" numOctaves="3" seed="${Math.floor(g.r() * 900)}"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${K} 0 0 0 ${f2(B)}"/><feComposite in="SourceGraphic" operator="in"/></filter>`);
    g.cache.cf = `url(#${id})`;
  }
  return g.cache.cf;
}

/* ------------------------------------------------------------------ elementary scene parts */
/** Sky: a gradient from the top to the horizon (padded below), painted over the whole frame. */
function sky(g, hy, stops) {
  const p = g.p, v = vg(g, "s", 0, hy, stops ?? [[0, p.top], [0.55, p.mid], [1, p.low]]);
  g.body.push(`<rect width="240" height="300" fill="${v.ref}"/>`);
  paint(g.R, () => 1, v, { calm: 1, rnd: NaN });
}

/** A soft round glow (screen blended), SVG + raster. */
function glow(g, x, y, r, col, a, scr = true) {
  g.body.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${sprite(g, "soft", col)}" opacity="${f2(a)}"${scr ? SCR : ""}/>`);
  const c = rgbOf(col);
  paint(g.R, (px, py) => { const d = Math.hypot(px - x, py - y) / r; return d < 1 ? a * (1 - d) ** 1.8 : 0; }, c);
}

/** A flat translucent colour wash over the whole frame (grade, vignette is separate). */
function wash(g, col, a) { paint(g.R, () => a, rgbOf(col)); }

/** A horizontal haze band: transparent -> col at `pk` -> transparent. */
function haze(g, y0, y1, col, a, pk = 0.5) {
  const ref = bgrad(g, "h" + col + pk, [[0, col, 0], [pk, col, 1], [1, col, 0]]), c = rgbOf(col);
  g.body.push(`<rect y="${f1(y0)}" width="240" height="${f1(y1 - y0)}" fill="${ref}" opacity="${f2(a)}"/>`);
  paint(g.R, (x, y) => { if (y < y0 || y > y1) return 0; const t = (y - y0) / (y1 - y0); return a * (t < pk ? t / pk : (1 - t) / (1 - pk)); }, c);
}

/** Cloud / mist band (the turbulence filter): colours c0 (upper) .. c1 (lower), fading in and out vertically. */
function clouds(g, y0, y1, c0, c1, a = 1) {
  if (y1 - y0 < 8) return;
  const ref = bgrad(g, "c" + c0 + c1, [[0, c0, 0], [0.3, c0, 0.95], [0.7, c1, 0.9], [1, c1, 0]]);
  g.body.push(`<rect y="${f1(y0)}" width="240" height="${f1(y1 - y0)}" fill="${ref}" filter="${cloudFilter(g)}"${a < 1 ? ` opacity="${f2(a)}"` : ""}/>`);
  const m = mx(c0, c1, 0.5), cov = c01(0.5 + g.s.cv * 0.25) * a;
  paint(g.R, (x, y) => { if (y < y0 || y > y1) return 0; const t = (y - y0) / (y1 - y0); return cov * 0.85 * Math.sin(Math.PI * t) ** 0.8; }, rgbOf(m), { calm: 0.35, rnd: NaN });
  g.n++;
}

/** Terrain: a polyline of heights built by midpoint displacement. */
function mdisp(r, lv, rough) {
  let a = [r(), r()], amp = 1;
  for (let l = 0; l < lv; l++) {
    amp *= rough;
    const b = [];
    for (let i = 0; i < a.length - 1; i++) b.push(a[i], (a[i] + a[i + 1]) / 2 + (r() * 2 - 1) * amp);
    b.push(a[a.length - 1]);
    a = b;
  }
  let lo = 1e9, hi = -1e9;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const sp = hi - lo || 1;
  return a.map((v) => (v - lo) / sp);
}
function colsOf(xs, ys) {
  const out = [];
  let k = 0;
  for (let i = 0; i < CW; i++) {
    const x = (i + 0.5) * CX;
    while (k < xs.length - 2 && xs[k + 1] < x) k++;
    const t = c01((x - xs[k]) / (xs[k + 1] - xs[k] || 1));
    out.push(ys[k] + (ys[k + 1] - ys[k]) * t);
  }
  return out;
}
function smoothD(pts) {
  let d = "M" + pt(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += `C${pt(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${pt(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${pt(p2[0], p2[1])}`;
  }
  return d;
}
/** Builds a terrain object from points: { xs, ys, c (column heights), min, mean, d (closed), line }. */
function terFrom(pts, smooth) {
  pts = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const line = smooth ? smoothD(pts) : "M" + pts.map(([x, y]) => pt(x, y)).join("L");
  const c = colsOf(xs, ys);
  return { xs, ys, c, min: Math.min(...ys), mean: c.reduce((s, v) => s + v, 0) / CW, line, d: line + `L${W + 10} ${H + 10}L-10 ${H + 10}Z` };
}
/** o: base, amp, lv, rough, pw (>1 = sparse sharp peaks), tilt, smooth */
function ter(g, o) {
  const n = 1 << o.lv, u = mdisp(g.r, o.lv, o.rough ?? 0.55), dx = (W + 20) / n, pts = [];
  for (let i = 0; i <= n; i++) {
    const x = -10 + i * dx;
    pts.push([x, o.base - u[i] ** (o.pw ?? 1) * o.amp + (o.tilt ?? 0) * (x / W - 0.5)]);
  }
  return terFrom(pts, o.smooth);
}

/** A filled terrain layer: gradient top -> bot over `span` px, optional rim light along the ridge. */
function layer(g, T, o) {
  const y0 = Math.max(0, T.min - 2), y1 = Math.min(H + 10, y0 + (o.span ?? 90));
  const v = o.fill ?? vg(g, "l", y0, y1, [[0, o.top], [1, o.bot ?? o.top]]);
  g.body.push(`<path d="${T.d}" fill="${v.ref}"${o.rim ? ` stroke="${o.rim}" stroke-opacity="${f2(o.ra ?? 0.4)}" stroke-width=".8"` : ""}/>`);
  paint(g.R, (x, y) => c01((y + CY / 2 - T.c[(x / CX) | 0]) / CY), v, { calm: o.calm ?? 0, rnd: o.rnd ?? NaN });
  g.n++;
}

/** Colour of a layer at depth t (0 far .. 1 near): far = hazy, near = deep shade. */
function depthCol(g, t, far = g.p.far) {
  const p = g.p;
  return mx(mx(far, p.shade, t ** 0.85), p.low, (1 - t) * 0.4);
}
const fadeCol = (g, c, t) => mx(c, mx(g.p.low, g.p.far, 0.3), 0.6 * (1 - t) + 0.1);

function inPoly(pts) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c ? 1 : 0;
  };
}
/** A flat or gradient-filled polygon (SVG + raster). */
function poly(g, pts, fill, o = {}) {
  const grad = typeof fill !== "string", op = o.op ?? 1;
  g.body.push(`<path d="${polyD(pts)}" fill="${grad ? fill.ref : fill}"${op < 1 ? ` fill-opacity="${f2(op)}"` : ""}${o.attr ?? ""}/>`);
  const cov = inPoly(pts);
  paint(g.R, op < 1 ? (x, y) => cov(x, y) * op : cov, grad ? fill : rgbOf(fill), "calm" in o ? { calm: o.calm, rnd: o.rnd ?? NaN } : o.m);
}
const disc = (g, x, y, r, fill, o = {}) => {
  const grad = typeof fill !== "string", op = o.op ?? 1;
  g.body.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${grad ? fill.ref ?? fill : fill}"${op < 1 ? ` opacity="${f2(op)}"` : ""}${o.attr ?? ""}/>`);
  if (o.nr) return;
  paint(g.R, (px, py) => { const d = Math.hypot(px - x, py - y); return c01((r - d) / CX + 0.5) * op; }, o.col ? rgbOf(o.col) : rgbOf(fill), o.m);
};

/** Light shafts from an apex, screen blended and blurred. */
function rays(g, x, y, o) {
  const n = o.n, dir = o.dir, len = o.len, col = o.col, a = o.a, polys = [];
  const ex = x + len * Math.sin(dir), ey = y + len * Math.cos(dir);
  const id = gid(g, "r");
  g.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f1(x)}" y1="${f1(y)}" x2="${f1(ex)}" y2="${f1(ey)}"><stop offset="0" stop-color="${col}" stop-opacity="${f2(a)}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient>`);
  for (let i = 0; i < n; i++) {
    const an = dir + (n === 1 ? 0 : (i / (n - 1) - 0.5) * o.spread) + (g.r() - 0.5) * 0.08, w = rg(g, 0.015, 0.05);
    polys.push(`M${pt(x, y)}L${pt(x + len * 1.2 * Math.sin(an - w), y + len * 1.2 * Math.cos(an - w))}L${pt(x + len * 1.2 * Math.sin(an + w), y + len * 1.2 * Math.cos(an + w))}Z`);
  }
  g.body.push(`<path d="${polys.join("")}" fill="url(#${id})" filter="${blur(g, 2.4)}"${SCR}/>`);
  const c = rgbOf(col), half = o.spread / 2 + 0.06;
  paint(g.R, (px, py) => {
    const dx = px - x, dy = py - y, d = Math.hypot(dx, dy);
    if (d > len || d < 4) return 0;
    const da = Math.abs(Math.atan2(dx, dy) - dir);
    return da < half ? a * 0.32 * (1 - d / len) : 0;
  }, c);
  g.n++;
}

/** Bokeh discs. cols: hex list. */
function bokeh(g, n, x0, y0, x1, y1, rmin, rmax, cols, a, sd = 1.4) {
  let s = "";
  const items = [];
  for (let i = 0; i < n; i++) {
    const x = rg(g, x0, x1), y = rg(g, y0, y1), r = rmin + (rmax - rmin) * g.r() ** 1.6, col = cols[Math.floor(g.r() * cols.length)], o = a * rg(g, 0.45, 1);
    items.push([x, y, r, col, o]);
    s += `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${f1(r)}" fill="${sprite(g, "ball", col)}" opacity="${f2(o)}"/>`;
  }
  g.body.push(`<g filter="${blur(g, sd)}"${SCR}>${s}</g>`);
  for (const [x, y, r, col, o] of items) paint(g.R, (px, py) => { const d = Math.hypot(px - x, py - y); return d < r ? o * 0.7 : 0; }, rgbOf(col));
  g.n++;
}

/** Stars as zero-length round-capped strokes (cheap): n dots in three sizes. */
function stars(g, n, y0, y1, col, a = 1) {
  const bins = [[], [], []];
  for (let i = 0; i < n; i++) {
    const x = rg(g, 2, 238), y = y0 + (y1 - y0) * g.r() ** 0.9;
    bins[g.r() < 0.78 ? 0 : g.r() < 0.8 ? 1 : 2].push(`M${Math.round(x)} ${Math.round(y)}h0`);
  }
  [[0.8, 0.6], [1.3, 0.85], [1.9, 1]].forEach(([w, o], i) => {
    if (bins[i].length) g.body.push(`<path d="${bins[i].join("")}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-opacity="${f2(o * a)}"/>`);
  });
  g.n += 2;
}

function birds(g, n, x0, y0, x1, y1, col, sz) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = rg(g, x0, x1), y = rg(g, y0, y1), s = sz * rg(g, 0.7, 1.3);
    d += `M${pt(x - s, y)}q${f1(s * 0.5)} ${f1(-s * 0.7)} ${f1(s)} ${f1(s * 0.15)}q${f1(s * 0.5)} ${f1(-s * 0.85)} ${f1(s)} ${f1(-s * 0.15)}`;
  }
  g.body.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width=".8" stroke-linecap="round" stroke-opacity=".8"/>`);
  g.n++;
}

/* ------------------------------------------------------------------ sun / moon / flare */
function celestial(g, hy, o = {}) {
  const { s, p } = g, kind = s.cel;
  if (p.night) stars(g, 26 + Math.floor(60 * s.dens), 3, hy * 0.85, mx(WHITE, p.glow, 0.3), kind === "moon" ? 0.6 : 0.9);
  if (kind === "none") return null;
  const x = o.x ?? 34 + 172 * s.sx, rad = o.r ?? (kind === "moon" ? 8 + 12 * s.sz : 6 + 13 * s.sz);
  const y = o.y ?? Math.max(rad + 8, hy - 20 - (hy - 40) * g.r() * 0.8);
  const col = kind === "moon" ? mx(p.glow, "#e9eefc", 0.5) : p.glow;
  const halo = (kind === "moon" ? 5 : 8) * (o.halo ?? 1);
  glow(g, x, y, rad * halo, col, kind === "moon" ? 0.7 : 0.95);
  if (kind === "sun") {
    const v = rg2(g, "o", x, y, rad, [[0, WHITE, 1], [0.72, mx(col, WHITE, 0.7), 1], [1, mx(col, WHITE, 0.25), 1]]);
    disc(g, x, y, rad, v, { col: mx(col, WHITE, 0.6), m: { calm: 0.9, rnd: 1 } });
  } else {
    const crescent = g.r() < 0.35, mc = mx(col, WHITE, 0.55);
    if (crescent) {
      const q = rad * 0.8, d = `M${pt(x, y - rad)}A${f1(rad)} ${f1(rad)} 0 1 0 ${pt(x, y + rad)}A${f1(rad * 1.18)} ${f1(rad * 1.18)} 0 0 1 ${pt(x, y - rad)}Z`;
      g.body.push(`<path d="${d}" fill="${mc}" transform="rotate(${f1(rg(g, -35, 35))} ${f1(x)} ${f1(y)})"/>`);
      paint(g.R, (px, py) => { const dd = Math.hypot(px - x, py - y); return dd < rad * 0.9 && px < x + q * 0.2 ? 0.8 : 0; }, rgbOf(mc), { calm: 0.9, rnd: 1 });
    } else {
      disc(g, x, y, rad, mc, { m: { calm: 0.9, rnd: 1 } });
      let cr = "";
      for (let i = 0; i < 4; i++) cr += `<circle cx="${f1(x + rg(g, -0.5, 0.5) * rad)}" cy="${f1(y + rg(g, -0.5, 0.5) * rad)}" r="${f1(rad * rg(g, 0.12, 0.28))}" fill="${mx(col, p.far, 0.5)}" opacity=".18"/>`;
      g.body.push(cr);
    }
  }
  g.n++;
  g.sub = Math.max(g.sub, (rad / 19) ** 1.1);
  return { x, y, r: rad, kind };
}

/** Lens flare ghosts + anamorphic streak from the light source through the frame centre. */
function flare(g, c) {
  if (!c || !g.s.flare) return;
  const col = mx(g.p.glow, WHITE, 0.3);
  const streak = `<ellipse cx="${f1(c.x)}" cy="${f1(c.y)}" rx="${f1(rg(g, 70, 120))}" ry="1.3" fill="${sprite(g, "soft", col)}" opacity=".75" filter="${blur(g, 1.2)}"${SCR}/>`;
  g.body.push(streak);
  const dx = 120 - c.x, dy = 160 - c.y;
  for (const [k, r, a] of [[0.55, 9, 0.2], [0.9, 5, 0.28], [1.25, 14, 0.14], [1.7, 7, 0.2]]) {
    const x = c.x + dx * k, y = c.y + dy * k, hexa = g.r() < 0.4;
    if (hexa) g.body.push(`<path d="${polyD([0, 1, 2, 3, 4, 5].map((i) => [x + r * Math.cos((i * Math.PI) / 3), y + r * Math.sin((i * Math.PI) / 3)]))}" fill="${mx(g.p.acc, WHITE, 0.4)}" opacity="${f2(a * 0.7)}"${SCR}/>`);
    else g.body.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${sprite(g, "ball", g.r() < 0.5 ? col : g.p.acc)}" opacity="${f2(a * 1.4)}"${SCR}/>`);
  }
  paint(g.R, (px, py) => (Math.abs(py - c.y) < CY * 0.6 && Math.abs(px - c.x) < 90 ? 0.35 * (1 - Math.abs(px - c.x) / 90) : 0), rgbOf(col));
  g.n += 2;
}

/* ------------------------------------------------------------------ foreground pieces */
function pine(g, x, yb, h, w, col, o = {}) {
  const k = 5, pts = [[x, yb - h]], left = [];
  for (let i = 1; i <= k; i++) {
    const y = yb - h + h * 0.94 * (i / k), hw = w * (0.3 + 0.7 * (i / k)) * rg(g, 0.88, 1.1);
    pts.push([x + hw, y + 1.5]);
    left.unshift([x - hw * rg(g, 0.9, 1.1), y + 1.5]);
    if (i < k) { pts.push([x + hw * 0.42, y - h * 0.035]); left.unshift([x - hw * 0.42, y - h * 0.035]); }
  }
  pts.push([x + 1.5, yb + 2], [x - 1.5, yb + 2]);
  const all = pts.concat(left);
  poly(g, all, col, { m: { calm: 0, rnd: -0.85 }, ...o });
}
function treeline(g, base, h, sp, jit) {
  const pts = [[-12, H + 10]];
  for (let x = -12 + rg(g, 0, sp); x < W + 14; x += sp * rg(g, 0.8, 1.25)) {
    pts.push([x, base - h * rg(g, 0.08, 0.2) + rg(g, -jit, jit)], [x + sp * 0.5, base - h * rg(g, 0.55, 1)]);
  }
  pts.push([W + 14, base], [W + 14, H + 10]);
  for (const q of pts) { q[0] = Math.round(q[0]); q[1] = Math.round(q[1]); }
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const line = "M" + pts.slice(1, -1).map(([x, y]) => pt(x, y)).join("L");
  const c = colsOf(xs.slice(1, -1), ys.slice(1, -1));
  return { xs, ys, c, min: Math.min(...ys.slice(1)), mean: c.reduce((s, v) => s + v, 0) / CW, line, d: "M" + pts.map(([x, y]) => pt(x, y)).join("L") + "Z" };
}
function rocks(g, side, col) {
  const w = rg(g, 55, 95), h = rg(g, 28, 52), x0 = side ? W + 8 - w : -8, pts = [[x0, H + 5]];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n, hh = h * (side ? u ** 0.8 : (1 - u) ** 0.8) * rg(g, 0.75, 1.1);
    pts.push([x0 + u * w, H - 4 - hh - (i % 2) * rg(g, 0, 7)]);
  }
  pts.push([x0 + w, H + 5]);
  poly(g, pts, col, { m: { calm: 0, rnd: -0.7 } });
  g.n++;
}
function grass(g, col, hmax) {
  let d = "";
  const n = 34;
  for (let i = 0; i < n; i++) {
    const x = rg(g, -4, W + 4), h = hmax * rg(g, 0.35, 1), lean = rg(g, -9, 9);
    d += `M${pt(x, H + 2)}q${f1(lean * 0.2)} ${f1(-h * 0.55)} ${f1(lean)} ${f1(-h)}`;
  }
  g.body.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="1.15" stroke-linecap="round"/>`);
  paint(g.R, (x, y) => c01((y - (H - hmax * 0.5)) / (hmax * 0.5)) * 0.5, rgbOf(col), { calm: 0.2, rnd: 0.3 });
  g.n++;
}
function hillFore(g, col, h = 26, o = {}) {
  const T = ter(g, { base: H - h * (0.4 + g.r() * 0.7), amp: h, lv: 3, rough: 0.5, smooth: true, tilt: rg(g, -20, 20) });
  layer(g, T, { top: col, bot: col, calm: 0, rnd: 0.6, span: 60, ...o });
  return T;
}
/** Picks and draws the foreground silhouette; opts list of kinds. */
function foreground(g, opts) {
  const kind = opts[Math.floor(g.s.fu * opts.length)], c = g.p.shade;
  if (kind === "hill") hillFore(g, mx(c, g.p.far, 0.1), 30);
  else if (kind === "pines") {
    hillFore(g, c, 18);
    const left = g.r() < 0.5, n = 2 + Math.floor(g.s.dens * 2.4);
    for (let i = 0; i < n; i++) {
      const x = (left ? 14 + i * 22 : W - 14 - i * 22) + rg(g, -6, 6), h = rg(g, 70, 120) * (1 - i * 0.12), w = h * 0.2;
      pine(g, x, H - 6, h, w, c);
    }
    g.n++;
  } else if (kind === "rocks") { rocks(g, g.r() < 0.5 ? 0 : 1, c); if (g.s.dens > 0.5) rocks(g, 1, c); }
  else if (kind === "grass") { hillFore(g, c, 14); grass(g, c, 40 + 30 * g.s.sz); }
}

/* ------------------------------------------------------------------ the scene types */
function mountains(g) {
  const { r, p, s } = g, hy = 120 + 95 * s.hz;
  sky(g, hy + 8);
  const cel = celestial(g, hy);
  clouds(g, 6, hy - 6, mx(p.glow, p.mid, 0.2), mx(p.mid, p.top, 0.4), 0.9);
  const n = 3 + (s.dens > 0.4) + (s.dens > 0.78);
  const a0 = Math.min(hy - 24, 48 + 80 * s.sz);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), base = lerp(hy + 6, H - 30, t ** 0.9), amp = lerp(a0, a0 * 0.4, t) * rg(g, 0.85, 1.1);
    const T = ter(g, { base, amp, lv: i < 2 ? 5 : 6, rough: 0.54, pw: lerp(1.9, 1.15, t) });
    const c = depthCol(g, t);
    layer(g, T, { top: c, bot: fadeCol(g, c, t), span: amp + 40, rnd: -0.85, calm: 0.1, rim: i < n - 1 ? mx(p.glow, WHITE, 0.3) : null, ra: 0.35 * (1 - t * 0.6) });
    if (i < n - 1) haze(g, T.min + amp * 0.35, base + 36, p.low, 0.32 * (1 - t) + 0.12);
  }
  foreground(g, ["none", "hill", "pines", "rocks"]);
  if (cel) { glow(g, cel.x, cel.y, 70, p.glow, 0.28); g.flareAt = cel; }
  if (s.dens > 0.7) birds(g, 4 + Math.floor(s.dens * 3), 30, 40, 200, hy - 30, mx(p.shade, p.far, 0.3), 3.2);
}

function forest(g) {
  const { r, p, s } = g, hy = 100 + 70 * s.hz;
  sky(g, hy + 40, [[0, p.top], [0.6, mx(p.mid, p.low, 0.4)], [1, p.low]]);
  const cel = celestial(g, hy, { y: 28 + 52 * r(), halo: 1.5 });
  clouds(g, 0, hy, mx(p.low, WHITE, 0.4), mx(p.mid, p.low, 0.5), 0.8);
  const n = 4 + (s.dens > 0.45) + (s.dens > 0.82);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), base = lerp(hy + 30, H - 26, t ** 1.1), h = lerp(24, 74, t) * (0.75 + 0.55 * s.sz), sp = h * rg(g, 0.27, 0.36);
    const T = treeline(g, base, h, sp, 2 + 4 * t), c = mx(depthCol(g, t, mx(p.far, p.low, 0.2)), BLACK, 0.3 * t);
    layer(g, T, { top: c, bot: fadeCol(g, c, t * 0.8), span: h + 30, rnd: -0.8, calm: 0.05 });
    if (i < n - 1) clouds(g, base - h * 0.8, base + 28, mx(p.low, WHITE, 0.2), p.low, 0.55 + 0.3 * (1 - t));
  }
  if (cel) rays(g, cel.x, cel.y, { n: 4 + Math.floor(s.dens * 3), dir: rg(g, -0.35, 0.35), spread: 0.9, len: 260, col: mx(p.glow, WHITE, 0.4), a: 0.55 });
  foreground(g, ["pines", "pines", "pines", "hill"]);
  if (cel) g.flareAt = cel;
}

function ocean(g) {
  const { r, p, s } = g, hy = 105 + 100 * s.hz;
  sky(g, hy);
  const rad = 7 + 13 * s.sz, sx = 40 + 160 * s.sx;
  const cel = celestial(g, hy, { x: sx, y: hy - rad * (0.2 + r() * 0.9) - r() * 26, r: rad });
  clouds(g, 6, hy - 4, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.5), 0.9);
  const wTop = mx(p.low, p.mid, 0.3), wMid = mx(p.mid, p.far, 0.55), wBot = mx(p.far, p.shade, 0.7);
  const v = vg(g, "w", hy, H, [[0, wTop], [0.32, wMid], [1, wBot]]);
  g.body.push(`<rect y="${f1(hy)}" width="240" height="${f1(H - hy)}" fill="${v.ref}"/>`);
  paint(g.R, (x, y) => c01((y - hy) / CY + 0.5), v, { calm: 0.85, rnd: 0.75 });
  haze(g, hy - 12, hy + 8, p.low, 0.5);
  if (cel) {
    const cx = cel.x;
    g.body.push(`<ellipse cx="${f1(cx)}" cy="${f1(hy + (H - hy) * 0.28)}" rx="${f1(10 + rad * 0.9)}" ry="${f1((H - hy) * 0.5)}" fill="${sprite(g, "soft", p.glow)}" opacity=".55"${SCR}/>`);
    let d1 = "", d2 = "";
    for (let k = 0; k < 24; k++) {
      const yy = hy + 2.5 + (k + 1) ** 1.45 * (H - hy) / 100, w = (3 + (yy - hy) * 0.2) * rg(g, 0.5, 1), x = cx + rg(g, -1, 1) * (yy - hy) * 0.1;
      (k % 2 ? d1 : d2) !== undefined && (k % 2 ? (d1 += `M${pt(x - w, yy)}h${f1(2 * w)}`) : (d2 += `M${pt(x - w, yy)}h${f1(2 * w)}`));
    }
    const sc = mx(p.glow, WHITE, 0.6);
    g.body.push(`<path d="${d1}" stroke="${sc}" stroke-width="1.1" stroke-opacity=".85"/><path d="${d2}" stroke="${sc}" stroke-width="1.5" stroke-opacity=".45"/>`);
    paint(g.R, (px, py) => (py > hy ? 0.5 * (1 - (py - hy) / (H - hy)) * Math.exp(-(((px - cx) / (14 + (py - hy) * 0.3)) ** 2)) : 0), rgbOf(sc));
    g.n++;
  }
  let d = "";
  const wl = mx(wMid, p.glow, 0.28);
  for (let k = 0; k < 16; k++) {
    const t = (k + r()) / 16, y = hy + 5 + t ** 1.6 * (H - hy - 12), len = 14 + t * 60 * rg(g, 0.6, 1.3), x = rg(g, -10, W - len * 0.5);
    d += `M${pt(x, y)}q${f1(len / 4)} ${f1(-1 - t * 3)} ${f1(len / 2)} 0t${f1(len / 2)} 0`;
  }
  g.body.push(`<path d="${d}" fill="none" stroke="${wl}" stroke-width=".9" stroke-opacity=".38" stroke-linecap="round"/>`);
  g.n++;
  if (r() < 0.3) { // distant ship
    const bx = rg(g, 40, 200), by = hy + 2.5, c = mx(p.shade, p.far, 0.5);
    g.body.push(`<path d="M${pt(bx - 5, by)}h10l-1.5 2.4h-7zM${pt(bx - 0.5, by - 11)}l5 9.5h-5z" fill="${c}"/>`);
    g.n++;
  }
  foreground(g, ["none", "rocks", "hill", "rocks"]);
  if (cel) { glow(g, cel.x, cel.y, 80, p.glow, 0.25); g.flareAt = cel; }
  if (s.dens > 0.72) birds(g, 3 + Math.floor(s.dens * 3), 20, 30, 210, hy - 25, mx(p.shade, p.far, 0.3), 3);
}

/** Dense points of a Catmull-Rom spline through ctrl (same curve as smoothD). */
function dense(ctrl, steps = 5) {
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[i - 1] ?? ctrl[i], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

function dunes(g) {
  const { r, p, s } = g, hy = 105 + 85 * s.hz;
  sky(g, hy + 12);
  const cel = celestial(g, hy);
  clouds(g, 4, hy - 8, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.4), 0.75);
  const n = 3 + (s.dens > 0.4) + (s.dens > 0.8);
  const lit = mx(p.glow, p.far, 0.28), sh = mx(p.shade, p.far, 0.4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), base = lerp(hy + 16, H - 38, t ** 0.85), amp = lerp(22, 42, t) * (0.7 + 0.8 * s.sz) * rg(g, 0.8, 1.15), sp = lerp(70, 130, t) * rg(g, 0.85, 1.2);
    const ctrl = [];
    let xv = -10 - rg(g, 0, sp * 0.8);
    while (xv < 270) { ctrl.push([xv, base + amp * 0.2], [xv + sp * 0.66, base - amp * rg(g, 0.6, 1)]); xv += sp * rg(g, 0.9, 1.15); }
    ctrl.push([xv, base + amp * 0.2]);
    const rc = ctrl.map(([x, y]) => [Math.round(x), Math.round(y)]), D = dense(rc, 5), T = terFrom(D.map(([x, y]) => [x, y]), false);
    T.line = smoothD(rc); T.d = T.line + `L${W + 20} ${H + 10}L-20 ${H + 10}Z`;
    const hz = (1 - t) * 0.5, cl = mx(lit, p.low, hz), cs = mx(mx(sh, p.low, hz), p.mid, 0.12 * (1 - t));
    layer(g, T, { top: mx(cl, WHITE, 0.06), bot: mx(cl, cs, 0.5), span: amp * 3, rnd: 0.9, calm: 0.4, rim: mx(p.glow, WHITE, 0.45), ra: 0.6 });
    let wd = "";
    for (let k = 1; k < rc.length - 1; k += 2) {
      const [cx, cy] = rc[k], [vx, vy] = rc[k + 1];
      if (vx < 0 || cx > W) continue;
      const side = D.filter(([x]) => x >= cx && x <= vx), bp = [cx - (vx - cx) * 0.25, vy + (vy - cy) * 0.55 + 10];
      const pg = [...side, bp];
      wd += polyD(pg);
      const cov = inPoly(pg), y0 = cy, y1 = bp[1];
      paint(g.R, (x, y) => cov(x, y) * 0.8 * (1 - c01((y - y0) / (y1 - y0)) * 0.7), rgbOf(cs));
    }
    if (wd) g.body.push(`<path d="${wd}" fill="${bgrad(g, "w" + cs, [[0, cs, 1], [0.55, cs, 0.75], [1, cs, 0]])}" opacity=".95" filter="${blur(g, 1.1)}"/>`);
    if (i < n - 1) haze(g, T.min + amp * 0.3, base + 30, p.low, 0.22 * (1 - t) + 0.08);
  }
  foreground(g, ["none", "none", "rocks", "grass"]);
  if (cel) { glow(g, cel.x, cel.y, 70, p.glow, 0.25); g.flareAt = cel; }
}

function city(g) {
  const { r, p, s } = g, hy = 150 + 85 * s.hz, night = p.night || g.dark > 0.55;
  sky(g, hy);
  const cel = celestial(g, hy - 20, { halo: 0.8 });
  clouds(g, 8, hy - 20, mx(p.acc, p.mid, 0.5), mx(p.mid, p.top, 0.4), night ? 0.55 : 0.7);
  haze(g, hy - 40, hy + 6, p.low, 0.55);
  const n = 3 + (s.dens > 0.8);
  const winC = [mx(p.acc, WHITE, 0.25), mx(p.glow, WHITE, 0.3), mx(p.acc, p.glow, 0.5)];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), gy = lerp(hy + 2, H - 52, t), maxH = lerp(70, 130, t) * (0.65 + 0.7 * s.sz), c = depthCol(g, t, mx(p.far, p.low, 0.25));
    const pts = [[-10, H + 10]];
    let x = -10 + rg(g, 0, 8), prevEnd = -10;
    const rows = [];
    while (x < W + 10) {
      const w = lerp(17, 32, t) * rg(g, 0.8, 1.5), h = maxH * rg(g, 0.25, 1) * (0.5 + 0.5 * Math.sin(x * 0.03 + i + s.sx * 6) ** 2);
      const top = gy - h;
      if (x > prevEnd + 0.5) pts.push([prevEnd, gy - 20], [x, gy - 20]);
      pts.push([x, top]);
      if (r() < 0.2) pts.push([x + w * 0.4, top], [x + w * 0.45, top - rg(g, 8, 20)], [x + w * 0.5, top]);
      pts.push([x + w, top]);
      rows.push([x, w, top, gy]);
      prevEnd = x + w;
      x = prevEnd + (r() < 0.3 ? rg(g, 1, 4) : 0);
    }
    pts.push([prevEnd, gy - 20], [W + 10, gy - 20], [W + 10, H + 10]);
    for (const q of pts) { q[0] = Math.round(q[0]); q[1] = Math.round(q[1]); }
    poly(g, pts, c, { m: { calm: 0, rnd: -0.95 } });
    g.n++;
    if (night || t > 0.5) {
      const dd = [[], [], []];
      let budget = 300 - 55 * i;
      for (const [bx, bw, top] of rows) {
        const nr = Math.floor((gy - top) / lerp(4.5, 7, t));
        for (let q = 1; q < Math.min(nr, 12); q++) if (budget > 0 && r() < 0.55) { dd[Math.floor(r() * 3)].push(`M${Math.round(bx + 2)} ${Math.round(top + q * lerp(4.5, 7, t))}h${Math.round(Math.max(0, bw - 4))}`); budget--; }
      }
      const wa = (night ? 0.9 : 0.35) * (0.5 + 0.5 * t);
      dd.forEach((dstr, q) => { if (dstr.length) g.body.push(`<path d="${dstr.join("")}" stroke="${winC[q]}" stroke-width="${f1(lerp(1.1, 2, t))}" stroke-dasharray="${f1(lerp(1.1, 2, t))} ${f1(lerp(2, 3.4, t))}" stroke-opacity="${f2(wa)}"/>`); });
      paint(g.R, (px, py) => (py > gy - maxH && py < gy ? wa * 0.28 * (night ? 1 : 0.4) : 0), rgbOf(winC[0]));
    }
  }
  // street, wet reflections
  const sy = H - 50 + 10 * s.hz, gv = vg(g, "g", sy, H, [[0, mx(p.shade, p.mid, 0.3)], [1, p.shade]]);
  g.body.push(`<rect y="${f1(sy)}" width="240" height="${f1(H - sy)}" fill="${gv.ref}"/>`);
  paint(g.R, (x, y) => c01((y - sy) / CY + 0.5), gv, { calm: 0.5, rnd: -0.5 });
  let refl = "";
  const nb = 6 + Math.floor(s.dens * 4);
  for (let q = 0; q < nb; q++) {
    const x = rg(g, 6, 234), w = rg(g, 3, 9), c = [p.acc, p.glow, mx(p.acc, p.mid, 0.4)][q % 3];
    refl += `<rect x="${Math.round(x)}" y="${Math.round(sy)}" width="${Math.round(w)}" height="${Math.round(H - sy)}" fill="${c}" opacity="${f2(rg(g, 0.25, 0.6))}"/>`;
    paint(g.R, (px, py) => (py > sy && Math.abs(px - x - w / 2) < w ? 0.3 * (1 - (py - sy) / (H - sy)) : 0), rgbOf(c));
  }
  g.body.push(`<g filter="${blur(g, 2.2)}"${SCR} opacity="${night ? 0.9 : 0.4}">${refl}</g>`);
  if (night) bokeh(g, 4 + Math.floor(s.dens * 5), 0, sy - 30, W, sy + 20, 3, 9, [p.acc, p.glow, mx(p.acc, WHITE, 0.4)], 0.75);
  // neon sign strokes
  if (night && s.dens > 0.3) {
    const nx = rg(g, 20, 170), ny = rg(g, hy + 10, sy - 30);
    g.body.push(`<g filter="${blur(g, 1.6)}"${SCR}><path d="M${pt(nx, ny)}h${f1(rg(g, 24, 50))}" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round"/><path d="M${pt(nx + 6, ny + 8)}v14" stroke="${p.glow}" stroke-width="2.6" stroke-linecap="round" opacity=".9"/></g>`);
    glow(g, nx + 20, ny + 6, 36, p.acc, 0.35);
  }
  if (cel) { glow(g, cel.x, cel.y, 60, p.glow, 0.2); g.flareAt = cel; }
}

function facetPeak(g, px, py, w, yb, cc, snowT) {
  const r = g.r, k = 5, cl = [[px, py]];
  for (let i = 1; i <= k; i++) cl.push([px + (r() - 0.3) * w * 0.14 * i + w * 0.04 * i, py + ((yb - py) * i) / k]);
  const eL = [0.25, 0.5, 0.75].map((u) => [lerp(px, px - w, u) + rg(g, -0.1, 0.1) * w * (u < 0.7 ? 1 : 0.3), lerp(py, yb, u)]);
  const eR = [0.25, 0.5, 0.75].map((u) => [lerp(px, px + w, u) + rg(g, -0.1, 0.1) * w * (u < 0.7 ? 1 : 0.3), lerp(py, yb, u)]);
  const P0 = [px, py];
  poly(g, [P0, ...eL, [px - w, yb], ...cl.slice(1).reverse()], cc.lit, { m: { calm: 0.1, rnd: -0.9 } });
  poly(g, [P0, ...cl.slice(1), [px + w, yb], ...eR.slice().reverse()], cc.shade, { m: { calm: 0.1, rnd: -0.9 } });
  const ks = 3, mkZ = (a, b, rev) => { const z = []; for (let i = 1; i <= 3; i++) { const u = i / 4; z.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u) + (r() - 0.4) * (yb - py) * 0.08]); } return rev ? z.reverse() : z; };
  poly(g, [P0, eL[0], eL[1], ...mkZ(eL[1], cl[ks], false), cl[ks], ...cl.slice(1, ks).reverse()], cc.snowL, { m: { calm: 0.6, rnd: -0.8 } });
  poly(g, [P0, ...cl.slice(1, ks + 1), ...mkZ(cl[ks], eR[1], false), eR[1], eR[0]], cc.snowS, { m: { calm: 0.6, rnd: -0.8 } });
  g.n += 2;
}
function alpine(g) {
  const { r, p, s } = g, hy = 140 + 80 * s.hz;
  sky(g, hy);
  const cel = celestial(g, hy, { y: 30 + 60 * r() });
  clouds(g, 4, hy, WHITE, mx(p.mid, p.low, 0.5), 0.85);
  const cc = { lit: mx(p.glow, p.far, 0.55), shade: mx(p.shade, p.far, 0.5), snowL: mx(p.glow, WHITE, 0.6), snowS: mx(mx(p.mid, p.far, 0.4), WHITE, 0.45) };
  const far = { lit: mx(cc.lit, p.low, 0.5), shade: mx(cc.shade, p.low, 0.5), snowL: mx(cc.snowL, p.low, 0.3), snowS: mx(cc.snowS, p.low, 0.4) };
  const np = 2 + (s.dens > 0.55) + (s.dens > 0.85);
  const peaks = [];
  for (let i = 0; i < np; i++) peaks.push([34 + (i + rg(g, 0.1, 0.9)) * (172 / np), hy - (34 + 85 * s.sz * rg(g, 0.55, 1)), rg(g, 58, 88)]);
  peaks.sort((a, b) => a[1] - b[1]);
  peaks.forEach(([px, py, w], i) => { facetPeak(g, px, py, w * (0.8 + 0.3 * s.sz), hy + 40, i % 2 ? far : cc, rg(g, 0.45, 0.55)); });
  haze(g, hy - 40, hy + 30, p.low, 0.5);
  clouds(g, hy - 20, hy + 40, mx(p.low, WHITE, 0.4), p.low, 0.8);
  // snowy slopes + pines
  const T1 = ter(g, { base: hy + 40, amp: 26, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -20, 20) });
  layer(g, T1, { top: mx(p.glow, WHITE, 0.6), bot: mx(cc.snowS, WHITE, 0.2), span: 90, rnd: 0.7, calm: 0.7, rim: WHITE, ra: 0.6 });
  const T2 = ter(g, { base: H - 40, amp: 30, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -30, 30) });
  layer(g, T2, { top: mx(cc.snowS, WHITE, 0.45), bot: mx(cc.snowS, p.mid, 0.25), span: 80, rnd: 0.8, calm: 0.75, rim: WHITE, ra: 0.5 });
  const pc = mx(p.shade, p.far, 0.15);
  const k = 2 + Math.floor(s.dens * 3);
  for (let i = 0; i < k; i++) pine(g, rg(g, 10, 230), rg(g, hy + 46, H - 14), rg(g, 22, 50) * (0.8 + 0.5 * s.sz), rg(g, 6, 12), pc);
  if (cel) { glow(g, cel.x, cel.y, 70, p.glow, 0.28); g.flareAt = cel; }
}

function palm(g, x, y, h, lean, col) {
  const cx = x + lean, cy = y - h;
  g.body.push(`<path d="M${pt(x - 3.4, y)}Q${pt(x + lean * 0.15, y - h * 0.55)} ${pt(cx - 1.4, cy)}L${pt(cx + 1.4, cy)}Q${pt(x + lean * 0.15 + 3.2, y - h * 0.55)} ${pt(x + 3.4, y)}Z" fill="${col}"/>`);
  paint(g.R, (px, py) => (py > cy && py < y && Math.abs(px - (x + (lean * (y - py)) / h)) < 3 ? 0.9 : 0), rgbOf(col), { calm: 0, rnd: 0.3 });
  let a = "", b = "";
  const n = 8;
  for (let i = 0; i < n; i++) {
    const an = (-172 + (164 * i) / (n - 1) + rg(g, -8, 8)) * Math.PI / 180, L = rg(g, 46, 72) * (1 - 0.35 * Math.abs(Math.sin(an)));
    const ex = cx + L * Math.cos(an) * 1.05, ey = cy + L * Math.sin(an) * 0.25 + L * 0.5;
    const seg = `M${pt(cx, cy)}Q${pt(cx + L * 0.55 * Math.cos(an), cy + L * 0.5 * Math.sin(an) - L * 0.12)} ${pt(ex, ey)}`;
    a += seg;
  }
  g.body.push(`<path d="${a}" fill="none" stroke="${col}" stroke-width="1.2" stroke-linecap="round"/><path d="${a}" fill="none" stroke="${col}" stroke-width="9" stroke-dasharray="1.2 1.3" opacity=".95"/>`);
  paint(g.R, (px, py) => { const d = Math.hypot(px - cx, (py - cy) * 1.4); return d < 34 ? 0.55 * (1 - d / 34) : 0; }, rgbOf(col), { calm: 0, rnd: -0.2 });
  g.n += 2;
}
function beach(g) {
  const { r, p, s } = g, hy = 105 + 80 * s.hz;
  sky(g, hy);
  const cel = celestial(g, hy, { y: 28 + (hy - 60) * r() });
  clouds(g, 6, hy - 4, mx(p.glow, WHITE, 0.4), mx(p.mid, p.top, 0.4), 0.85);
  const shallow = mx(mx(p.mid, p.low, 0.5), "#27c4c2", 0.34), deep = mx(mx(p.far, p.shade, 0.35), "#0b4a73", 0.25);
  const sandY = lerp(H * 0.66, H * 0.8, 1 - s.sz * 0.6), sandL = mx(mx(p.glow, "#e8cfa0", 0.55), p.low, 0.1), sandD = mx(mx(p.far, "#8a6a45", 0.5), p.shade, 0.3);
  const v = vg(g, "w", hy, sandY, [[0, deep], [0.45, mx(deep, shallow, 0.6)], [1, shallow]]);
  g.body.push(`<rect y="${f1(hy)}" width="240" height="${f1(H - hy)}" fill="${v.ref}"/>`);
  paint(g.R, (x, y) => c01((y - hy) / CY + 0.5), v, { calm: 0.8, rnd: 0.7 });
  haze(g, hy - 10, hy + 8, p.low, 0.5);
  if (cel) {
    g.body.push(`<ellipse cx="${f1(cel.x)}" cy="${f1(hy + (sandY - hy) * 0.3)}" rx="14" ry="${f1((sandY - hy) * 0.45)}" fill="${sprite(g, "soft", p.glow)}" opacity=".5"${SCR}/>`);
    paint(g.R, (px, py) => (py > hy && py < sandY ? 0.35 * Math.exp(-(((px - cel.x) / 20) ** 2)) : 0), rgbOf(p.glow));
  }
  // beach curve: sand
  const tilt = rg(g, -30, 30), T = ter(g, { base: sandY, amp: 14, lv: 3, rough: 0.45, smooth: true, tilt });
  // foam line and wet sand
  const wet = mx(sandL, shallow, 0.45);
  const TL = terFrom(T.xs.map((x, i) => [x, T.ys[i] - 9]), true);
  layer(g, TL, { top: mx(wet, p.glow, 0.15), bot: wet, span: 40, rnd: 0.8, calm: 0.6, rim: WHITE, ra: 0.75 });
  layer(g, T, { top: sandL, bot: sandD, span: H - sandY + 20, rnd: 0.85, calm: 0.5, rim: mx(WHITE, sandL, 0.3), ra: 0.5 });
  g.body.push(`<path d="${TL.line}" fill="none" stroke="${WHITE}" stroke-width="2.2" stroke-opacity=".35" filter="${blur(g, 1.4)}"/>`);
  haze(g, hy + (sandY - hy) * 0.4, sandY + 6, mx(shallow, WHITE, 0.4), 0.14, 0.7);
  const side = r() < 0.5 ? 0 : 1, px = side ? rg(g, 170, 215) : rg(g, 25, 70);
  const c = mx(p.shade, p.far, 0.1);
  palm(g, px, H + 6, rg(g, 130, 190) * (0.75 + 0.35 * s.sz), (side ? -1 : 1) * rg(g, 18, 50), c);
  if (s.dens > 0.55) palm(g, side ? px - 52 : px + 52, H + 12, rg(g, 80, 120), (side ? 1 : -1) * 20, mx(c, p.far, 0.15));
  if (cel) { glow(g, cel.x, cel.y, 80, p.glow, 0.25); g.flareAt = cel; }
  if (s.dens > 0.7) birds(g, 4, 30, 30, 200, hy - 25, mx(p.shade, p.far, 0.3), 3);
}

function rainWindow(g) {
  const { r, p, s } = g;
  const night = p.night || g.dark > 0.5, base = night ? mx(p.top, p.shade, 0.5) : mx(mx(p.mid, p.far, 0.4), p.shade, 0.4);
  const v = vg(g, "bg", 0, H, [[0, mx(base, p.mid, night ? 0.1 : 0.2)], [0.6, mx(base, p.low, night ? 0.15 : 0.4)], [1, mx(base, p.shade, night ? 0.5 : 0.25)]]);
  g.body.push(`<rect width="240" height="300" fill="${v.ref}"/>`);
  paint(g.R, () => 1, v, { calm: 0.75, rnd: NaN });
  const cols = [p.acc, p.glow, mx(p.acc, p.low, 0.45), mx(p.glow, p.acc, 0.5), mx(p.low, WHITE, 0.3)];
  const n = 13 + Math.floor(s.dens * 12);
  bokeh(g, n, -10, 70, 250, 280, 5, 12 + 22 * s.sz, cols, night ? 0.85 : 0.75, 3);
  bokeh(g, 7 + Math.floor(s.dens * 9), -10, 120, 250, 270, 2, 6 + 6 * s.sz, cols, night ? 0.95 : 0.85, 1.1);
  haze(g, 0, 150, mx(p.top, p.mid, 0.4), 0.25, 0.3);
  // fog on glass, drops, streaks
  clouds(g, 60, 280, mx(p.low, WHITE, 0.25), mx(p.low, p.mid, 0.4), night ? 0.25 : 0.3);
  let st = "";
  const ns = 5 + Math.floor(s.dens * 7);
  for (let i = 0; i < ns; i++) {
    const x = rg(g, 8, 232), y = rg(g, 5, 140), L = rg(g, 60, 150);
    st += `M${pt(x, y)}q${f1(rg(g, -3, 3))} ${f1(L * 0.3)} ${f1(rg(g, -2, 2))} ${f1(L * 0.5)}t${f1(rg(g, -2, 2))} ${f1(L * 0.5)}`;
  }
  g.body.push(`<path d="${st}" fill="none" stroke="${WHITE}" stroke-width="1.6" stroke-opacity=".2" stroke-linecap="round"/><path d="${st}" fill="none" stroke="${mx(p.shade, BLACK, 0.3)}" stroke-width=".7" stroke-opacity=".28" transform="translate(1.4 0)"/>`);
  const nd = 16 + Math.floor(s.dens * 14);
  let dr = "", hl = "";
  for (let i = 0; i < nd; i++) {
    const x = rg(g, 4, 236), y = rg(g, 4, 296), rx = rg(g, 1.3, 4.6) * (0.8 + 0.4 * s.sz), ry = rx * rg(g, 1.1, 1.5);
    dr += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rx)}" ry="${f1(ry)}"/>`;
    hl += `<circle cx="${f1(x - rx * 0.3)}" cy="${f1(y - ry * 0.35)}" r="${f1(Math.max(0.5, rx * 0.28))}"/>`;
  }
  g.body.push(`<g fill="${mx(p.shade, BLACK, 0.2)}" fill-opacity=".2">${dr}</g><g fill="${WHITE}" fill-opacity=".6">${hl}</g>`);
  wash(g, p.shade, night ? 0.1 : 0.04);
  g.n += 3;
  // sill / dark vignette bottom
  const bv = vg(g, "sl", 232, H, [[0, p.shade, 0], [1, p.shade, night ? 0.85 : 0.45]]);
  g.body.push(`<rect y="232" width="240" height="68" fill="${bv.ref}"/>`);
  paint(g.R, (x, y) => (y > 232 ? ((y - 232) / 68) * (night ? 0.85 : 0.45) : 0), rgbOf(p.shade));
}

function field(g) {
  const { r, p, s } = g, hy = 130 + 85 * s.hz;
  sky(g, hy + 6);
  const cel = celestial(g, hy, { y: hy - 8 - 22 * r() });
  clouds(g, 4, hy - 4, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.4), 0.85);
  if (cel) rays(g, cel.x, cel.y, { n: 5, dir: rg(g, -0.2, 0.2), spread: 1.1, len: 250, col: mx(p.glow, WHITE, 0.3), a: 0.45 });
  const n = 3 + (s.dens > 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), base = lerp(hy + 4, H - 56, t ** 0.9), amp = lerp(14, 34, t) * (0.8 + 0.5 * s.sz);
    const T = ter(g, { base, amp, lv: 3, rough: 0.5, smooth: true, tilt: rg(g, -18, 18) });
    const c = mx(depthCol(g, t, mx(p.far, p.shade, 0.15)), p.acc, 0.05 * t);
    layer(g, T, { top: mx(c, p.glow, 0.12 * (1 - t)), bot: fadeCol(g, c, t), span: amp * 2.4, rnd: 0.7, calm: 0.35, rim: mx(p.glow, WHITE, 0.3), ra: 0.35 });
    clouds(g, base - amp * 0.7, base + 26, mx(p.low, WHITE, 0.3), p.low, 0.5 + 0.3 * (1 - t));
  }
  hillFore(g, p.shade, 22);
  grass(g, p.shade, 52 + 30 * s.sz);
  // foreground out-of-focus blossoms / dew
  bokeh(g, 6 + Math.floor(s.dens * 9), 0, H - 70, W, H - 10, 3, 9, [mx(p.glow, WHITE, 0.2), p.acc, mx(p.acc, WHITE, 0.4)], 0.7, 2);
  if (cel) { glow(g, cel.x, cel.y, 80, p.glow, 0.3); g.flareAt = cel; }
}

function lake(g) {
  const { r, p, s } = g, hy = 135 + 60 * s.hz;
  const gid1 = gid(g, "sc");
  const saved = g.body;
  g.body = [];
  sky(g, hy);
  const cel = celestial(g, hy, { y: 30 + (hy - 80) * r() });
  clouds(g, 4, hy - 4, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.4), 0.85);
  const n = 3, a0 = Math.min(hy - 22, 50 + 70 * s.sz);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), base = hy + 1 - (1 - t) * 4, amp = lerp(a0, a0 * 0.4, t) * rg(g, 0.85, 1.1);
    const T = ter(g, { base, amp, lv: 6, rough: 0.5, pw: lerp(1.7, 1.1, t) });
    const c = depthCol(g, t * 0.8, p.far);
    layer(g, T, { top: c, bot: fadeCol(g, c, t), span: amp + 30, rnd: -0.8, calm: 0.1, rim: mx(p.glow, WHITE, 0.3), ra: 0.3 * (1 - t) });
    if (i < n - 1) haze(g, T.min + amp * 0.3, hy + 4, p.low, 0.28);
  }
  haze(g, hy - 12, hy + 3, p.low, 0.5);
  if (cel) glow(g, cel.x, cel.y, 60, p.glow, 0.2);
  const scene = g.body.join("");
  g.body = saved;
  g.body.push(`<g id="${gid1}">${scene}</g>`);
  const cid = gid(g, "cp");
  g.defs.push(`<clipPath id="${cid}"><rect y="${f1(hy)}" width="240" height="${f1(H - hy)}"/></clipPath>`);
  const refl = `<g clip-path="url(#${cid})"><use href="#${gid1}" transform="matrix(1 0 0 -1 0 ${f1(2 * hy)})" filter="${blur(g, 1.6)}" opacity=".78"/></g>`;
  g.body.push(refl);
  // mirror in raster
  const R = g.R, wc = rgbOf(mx(p.mid, p.far, 0.4));
  for (let j = 0; j < CH; j++) {
    const y = (j + 0.5) * CY;
    if (y <= hy) continue;
    const sj = Math.floor((2 * hy - y) / CY);
    if (sj < 0) continue;
    for (let i = 0; i < CW; i++) {
      const k = j * CW + i, q = sj * CW + i;
      R.r[k] = R.r[q] * 0.78 + wc[0] * 0.22; R.g[k] = R.g[q] * 0.78 + wc[1] * 0.22; R.b[k] = R.b[q] * 0.78 + wc[2] * 0.22;
      R.calm[k] = 0.85; R.rnd[k] = 0.4;
    }
  }
  const wv = vg(g, "wt", hy, H, [[0, mx(p.far, p.low, 0.3), 0.18], [1, p.shade, 0.55]]);
  g.body.push(`<rect y="${f1(hy)}" width="240" height="${f1(H - hy)}" fill="${wv.ref}"/>`);
  paint(g.R, (x, y) => (y > hy ? 0.1 + 0.3 * (y - hy) / (H - hy) : 0), rgbOf(p.shade));
  let d = "";
  for (let k = 0; k < 13; k++) {
    const t = (k + r()) / 13, y = hy + 4 + t ** 1.5 * (H - hy - 14), len = 16 + t * 55 * rg(g, 0.6, 1.3), x = rg(g, -10, W - len * 0.5);
    d += `M${pt(x, y)}q${f1(len / 4)} ${f1(-0.8 - t * 2)} ${f1(len / 2)} 0t${f1(len / 2)} 0`;
  }
  g.body.push(`<path d="${d}" fill="none" stroke="${mx(p.glow, WHITE, 0.4)}" stroke-width=".8" stroke-opacity=".28" stroke-linecap="round"/>`);
  g.n++;
  foreground(g, ["pines", "rocks", "grass", "hill"]);
  if (cel) g.flareAt = cel;
}

function starry(g) {
  const { r, p, s } = g, hy = 190 + 60 * s.hz;
  sky(g, hy);
  const cel = s.cel === "moon" ? celestial(g, hy, { y: 40 + 60 * r() }) : null;
  const dim = cel ? 0.45 : 1;
  // milky way
  const ang = rg(g, -42, -12), mc = mx(p.acc, WHITE, 0.45);
  g.body.push(`<g transform="rotate(${f1(ang)} 120 130)" filter="${blur(g, 7)}"${SCR}><ellipse cx="120" cy="130" rx="190" ry="${f1(22 + 18 * s.sz)}" fill="${sprite(g, "soft", mx(p.acc, p.mid, 0.4))}" opacity="${f2(0.8 * dim)}"/><ellipse cx="${f1(rg(g, 90, 150))}" cy="130" rx="120" ry="${f1(10 + 8 * s.sz)}" fill="${sprite(g, "soft", mc)}" opacity="${f2(0.75 * dim)}"/></g>`);
  g.body.push(`<g transform="rotate(${f1(ang)} 120 130)" filter="${blur(g, 3)}" opacity="${f2(0.55 * dim)}"><ellipse cx="${f1(rg(g, 70, 170))}" cy="${f1(rg(g, 124, 136))}" rx="${f1(rg(g, 24, 50))}" ry="4" fill="${p.top}"/></g>`);
  paint(g.R, (x, y) => { const a = (ang * Math.PI) / 180, dx = x - 120, dy = y - 130, v = -dx * Math.sin(a) + dy * Math.cos(a); return 0.5 * dim * Math.exp(-((v / (24 + 14 * s.sz)) ** 2)); }, rgbOf(mx(p.acc, p.mid, 0.5)));
  stars(g, 70 + Math.floor(150 * s.dens), 2, hy, mx(WHITE, p.glow, 0.25), 1 - 0.5 * (cel ? 1 : 0));
  if (r() < 0.5) g.body.push(`<path d="M${pt(rg(g, 100, 200), rg(g, 20, 70))}l-34 12" stroke="${WHITE}" stroke-width=".9" stroke-linecap="round" stroke-opacity=".8" filter="${blur(g, 0.4)}"/>`);
  paint(g.R, () => 0.03, rgbOf(WHITE));
  const T = ter(g, { base: hy + 12, amp: 36 + 26 * s.sz, lv: 6, rough: 0.5, pw: 1.4 });
  const c = mx(p.shade, p.far, 0.12);
  layer(g, T, { top: mx(c, p.far, 0.25), bot: c, span: 90, rnd: -0.75, calm: 0.05, rim: mx(p.acc, WHITE, 0.3), ra: 0.2 });
  const T2 = ter(g, { base: H - 22, amp: 24, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -16, 16) });
  layer(g, T2, { top: p.shade, bot: p.shade, span: 60, rnd: 0.5, calm: 0 });
  const opt = Math.floor(s.fu * 3);
  if (opt === 0) { // tent with warm glow
    const tx = rg(g, 50, 190), ty = Math.min(T2.c[(tx / CX) | 0] + 2, H - 14), tw = rg(g, 22, 34), th = tw * 0.8;
    glow(g, tx, ty - th * 0.4, tw * 1.8, "#ffb35a", 0.5);
    poly(g, [[tx - tw / 2, ty], [tx, ty - th], [tx + tw / 2, ty]], mx("#ff9a3c", p.shade, 0.35), { m: { calm: 0, rnd: -0.8 } });
    poly(g, [[tx - tw * 0.1, ty], [tx, ty - th * 0.5], [tx + tw * 0.1, ty]], "#ffd89a", { m: { calm: 0, rnd: -0.5 } });
    g.n += 2;
  } else if (opt === 1) {
    for (let i = 0; i < 3; i++) pine(g, rg(g, 20, 220), H - 8, rg(g, 50, 100), rg(g, 12, 20), p.shade);
  }
}

function aurora(g) {
  const { r, p, s } = g, hy = 200 + 50 * s.hz;
  sky(g, hy);
  stars(g, 50 + Math.floor(90 * s.dens), 2, hy - 20, WHITE, 0.9);
  const acs = [p.acc, mx(p.acc, "#b06bff", 0.45), mx(p.acc, "#3fe0ff", 0.4)];
  const nr = 2 + (s.dens > 0.5) + (s.sz > 0.7);
  let ribbons = "", stri = "";
  for (let i = 0; i < nr; i++) {
    const yb = rg(g, 70, 140) + i * 4, th = rg(g, 40, 95) * (0.7 + 0.6 * s.sz), pts = [], pts2 = [];
    const ph = r() * 6, am = rg(g, 14, 34);
    for (let k = 0; k <= 6; k++) { const x = -20 + k * 47; const yy = yb + Math.sin(k * 0.9 + ph) * am; pts.push([x, yy]); pts2.push([x, yy + th * (0.7 + 0.5 * Math.sin(k * 1.3 + ph))]); }
    const d = smoothD(pts) + "L" + pts2.slice().reverse().map(([x, y]) => pt(x, y)).join("L") + "Z";
    const col = acs[i % acs.length], v = vg(g, "au", yb - am, yb + th + am, [[0, col, 0], [0.22, col, 0.85], [0.6, mx(col, p.mid, 0.4), 0.35], [1, col, 0]]);
    ribbons += `<path d="${d}" fill="${v.ref}"/>`;
    let sd = "";
    for (let k = 0; k < 12; k++) { const x = rg(g, 0, 240), ph2 = pts[Math.min(6, Math.max(0, Math.round((x + 20) / 47)))][1]; sd += `M${pt(x, ph2 + 6)}v${f1(th * rg(g, 0.4, 0.9))}`; }
    stri += `<path d="${sd}" stroke="${mx(col, WHITE, 0.3)}" stroke-width=".9" stroke-opacity=".22"/>`;
    paint(g.R, (x, y) => { const m = yb + am * 0.1; return y > yb - am && y < yb + th + am ? 0.6 * Math.exp(-(((y - (yb + th * 0.35)) / (th * 0.6)) ** 2)) : 0; }, rgbOf(mx(col, p.mid, 0.2)));
  }
  g.body.push(`<g filter="${blur(g, 3.4)}"${SCR}>${ribbons}</g><g filter="${blur(g, 0.9)}"${SCR}>${stri}</g>`);
  g.n += nr + 1;
  const T = ter(g, { base: hy + 10, amp: 22, lv: 5, rough: 0.5, smooth: true, tilt: rg(g, -20, 20) });
  layer(g, T, { top: mx(p.far, p.acc, 0.1), bot: mx(p.shade, p.far, 0.3), span: 80, rnd: 0.6, calm: 0.6, rim: p.acc, ra: 0.35 });
  const T2 = ter(g, { base: H - 18, amp: 22, lv: 4, rough: 0.5, smooth: true });
  layer(g, T2, { top: p.shade, bot: p.shade, span: 40, rnd: 0.5 });
  const np = 3 + Math.floor(s.dens * 5);
  for (let i = 0; i < np; i++) { const t = r(); pine(g, rg(g, 6, 234), lerp(hy + 14, H - 10, t), lerp(26, 80, t), lerp(7, 16, t), mx(p.shade, p.far, 0.15 * (1 - t))); }
}

function mesa(g) {
  const { r, p, s } = g, hy = 150 + 60 * s.hz;
  sky(g, hy);
  const cel = celestial(g, hy, { y: 30 + (hy - 90) * r() });
  clouds(g, 6, hy - 6, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.4), 0.8);
  const n = 2 + (s.dens > 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), yb = lerp(hy + 10, H - 62, t ** 0.9), c0 = depthCol(g, t, mx(p.far, p.acc, 0.3));
    const bc = [mx(c0, p.glow, 0.28), c0, mx(c0, p.shade, 0.3), mx(c0, p.acc, 0.25), mx(c0, p.shade, 0.15)];
    const nm = n === 2 ? 3 : 2;
    const stops = [[0, bc[0]]];
    let o = 0;
    for (let k = 1; k < 4; k++) { o += rg(g, 0.14, 0.28); if (o > 0.9) break; stops.push([o - 0.001, stops[stops.length - 1][1]], [o, bc[k]]); }
    stops.push([1, mx(c0, p.low, 0.35)]);
    const sref = bgrad(g, "m" + i, stops.map(([a, c]) => [f2(a), c, 1]));
    for (let q = 0; q < nm; q++) {
      const cx = (q + rg(g, 0.25, 0.75)) * (W / nm) + rg(g, -10, 10), w = rg(g, 40, 70) * lerp(0.7, 1.25, t), h = rg(g, 55, 120) * (0.6 + 0.8 * s.sz) * lerp(0.6, 1.1, t), yt = yb - h, yl = yt + h * rg(g, 0.4, 0.55);
      const pts = [[cx - w, yb + 14], [cx - w * 0.6, yl + 8], [cx - w * 0.5, yl - 2], [cx - w * 0.46, yt + 4], [cx - w * 0.43, yt], [cx + w * 0.43, yt], [cx + w * 0.47, yt + 4], [cx + w * 0.5, yl - 2], [cx + w * 0.6, yl + 8], [cx + w, yb + 14]];
      const fv = vg(g, "m", yt, yb + 14, stops, true);
      fv.ref = sref;
      poly(g, pts, fv, { m: { calm: 0.1, rnd: -0.7 } });
      poly(g, [[cx + w * 0.05, yt], [cx + w * 0.43, yt], [cx + w * 0.47, yt + 4], [cx + w * 0.5, yl - 2], [cx + w * 0.6, yl + 8], [cx + w, yb + 14], [cx + w * 0.15, yb + 14], [cx + w * 0.1, yl]], p.shade, { op: 0.3 + 0.12 * t, m: { calm: 0.1, rnd: -0.7 } });
      g.n++;
    }
    const F = ter(g, { base: yb + 6, amp: 9, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -10, 10) });
    layer(g, F, { top: mx(c0, p.glow, 0.1), bot: mx(c0, p.shade, 0.3 + 0.2 * t), span: 70, rnd: 0.6, calm: 0.35, rim: mx(p.glow, WHITE, 0.3), ra: 0.3 });
    if (i < n - 1) haze(g, yb - 50, yb + 14, p.low, 0.3 * (1 - t) + 0.08);
  }
  const base = ter(g, { base: H - 30, amp: 18, lv: 5, rough: 0.5, pw: 1.2 });
  layer(g, base, { top: mx(depthCol(g, 1, p.far), p.acc, 0.1), bot: p.shade, span: 60, rnd: -0.5, rim: mx(p.glow, WHITE, 0.2), ra: 0.3 });
  foreground(g, ["none", "rocks", "grass"]);
  if (cel) { glow(g, cel.x, cel.y, 70, p.glow, 0.25); g.flareAt = cel; }
}

function cloudSea(g) {
  const { r, p, s } = g, hy = 130 + 80 * s.hz;
  sky(g, hy + 30, [[0, p.top], [0.5, p.mid], [1, mx(p.low, p.mid, 0.2)]]);
  const cel = celestial(g, hy, { y: 28 + (hy - 70) * r(), halo: 1.3 });
  clouds(g, 0, hy - 40, mx(p.glow, WHITE, 0.3), mx(p.mid, p.low, 0.4), 0.5);
  if (s.dens > 0.35) for (let i = 0; i < 2; i++) {
    const T = ter(g, { base: hy + 24, amp: rg(g, 30, 70) * (0.6 + 0.6 * s.sz), lv: 5, rough: 0.52, pw: 2 });
    const c = mx(p.far, p.low, 0.55 - 0.15 * i);
    layer(g, T, { top: c, bot: mx(c, p.low, 0.5), span: 80, rnd: -0.8, calm: 0.1 });
  }
  // sea of clouds
  const T = ter(g, { base: hy + 20, amp: 14, lv: 4, rough: 0.55, smooth: true, tilt: rg(g, -20, 20) });
  layer(g, T, { top: mx(p.glow, WHITE, 0.5), bot: mx(mx(p.low, p.mid, 0.4), p.shade, 0.18), span: H - hy, rnd: 0.9, calm: 0.7, rim: WHITE, ra: 0.5 });
  clouds(g, hy - 22, hy + 70, mx(p.glow, WHITE, 0.6), mx(p.low, WHITE, 0.25), 1);
  clouds(g, hy + 40, H - 10, mx(p.low, WHITE, 0.3), mx(p.mid, p.shade, 0.45), 0.9);
  haze(g, hy - 10, hy + 40, mx(p.glow, WHITE, 0.4), 0.3);
  if (cel) rays(g, cel.x, cel.y, { n: 4, dir: rg(g, -0.25, 0.25), spread: 0.9, len: 240, col: mx(p.glow, WHITE, 0.5), a: 0.4 });
  foreground(g, ["none", "rocks", "none"]);
  if (cel) { glow(g, cel.x, cel.y, 90, p.glow, 0.3); g.flareAt = cel; }
}

function grove(g) {
  const { r, p, s } = g, hy = 150 + 50 * s.hz;
  const bg = vg(g, "bg", 0, H, [[0, mx(p.mid, p.glow, 0.25)], [0.45, mx(p.glow, p.low, 0.5)], [1, mx(p.far, p.low, 0.3)]]);
  g.body.push(`<rect width="240" height="300" fill="${bg.ref}"/>`);
  paint(g.R, () => 1, bg, { calm: 0.7, rnd: NaN });
  glow(g, rg(g, 60, 180), rg(g, 20, 70), 130, p.glow, 0.7);
  // distant hazy trunks
  const nt = 7 + Math.floor(s.dens * 7), fol = [p.acc, mx(p.acc, p.glow, 0.5), mx(p.glow, p.acc, 0.3), mx(p.acc, p.far, 0.4)];
  const trunk = (x, w, y0, c, o = {}) => {
    const lean = rg(g, -4, 4);
    poly(g, [[x - w / 2, H + 4], [x - w * 0.35 + lean, y0], [x + w * 0.35 + lean, y0], [x + w / 2, H + 4]], c, { m: { calm: 0, rnd: -0.3 }, ...o });
  };
  bokeh(g, 8 + Math.floor(s.dens * 8), -10, -5, 250, 130, 14, 34, fol, 0.85, 5);
  for (let i = 0; i < nt; i++) trunk(rg(g, 0, 240), rg(g, 3, 6), rg(g, -4, 40), mx(p.far, p.low, 0.55), { op: 0.7 });
  clouds(g, 70, 240, mx(p.low, WHITE, 0.3), p.low, 0.55);
  bokeh(g, 6 + Math.floor(s.dens * 8), -10, 20, 250, 150, 12, 28 + 14 * s.sz, fol, 0.8, 4);
  const ground = ter(g, { base: 232, amp: 14, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -20, 20) });
  layer(g, ground, { top: mx(p.far, p.acc, 0.2), bot: mx(p.shade, p.far, 0.25), span: 80, rnd: 0.5, calm: 0.2 });
  // path
  const px0 = rg(g, 90, 150);
  poly(g, [[px0 - 6, 232], [px0 + 6, 232], [px0 + 60 + rg(g, -20, 20), H + 4], [px0 - 60 + rg(g, -20, 20), H + 4]], mx(p.glow, p.low, 0.3), { op: 0.7, m: { calm: 0.6, rnd: 0.3 } });
  const nn = 2 + Math.floor(s.dens * 3);
  for (let i = 0; i < nn; i++) { const x = i % 2 ? rg(g, 190, 232) : rg(g, 6, 50); trunk(x, rg(g, 14, 24) * (0.8 + 0.5 * s.sz), rg(g, -4, 20), mx(p.shade, p.far, 0.12)); }
  rays(g, rg(g, 40, 200), -10, { n: 4, dir: rg(g, -0.3, 0.3), spread: 0.8, len: 260, col: mx(p.glow, WHITE, 0.3), a: 0.5 });
  bokeh(g, 7 + Math.floor(s.dens * 10), 0, 150, W, H, 3, 9, [p.glow, p.acc, mx(p.acc, WHITE, 0.4)], 0.7, 1.6);
}

function loneTree(g) {
  const { r, p, s } = g, hy = 150 + 60 * s.hz;
  sky(g, hy + 10);
  const rad = 12 + 14 * s.sz, cel = celestial(g, hy, { r: rad, y: hy - 30 - 40 * r(), x: 40 + 160 * s.sx });
  clouds(g, 4, hy - 4, mx(p.glow, p.mid, 0.3), mx(p.mid, p.top, 0.4), 0.85);
  const T1 = ter(g, { base: hy + 14, amp: 18, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -20, 20) });
  const c1 = depthCol(g, 0.35, p.far);
  layer(g, T1, { top: c1, bot: fadeCol(g, c1, 0.35), span: 60, rnd: 0.7, calm: 0.3, rim: mx(p.glow, WHITE, 0.3), ra: 0.3 });
  haze(g, T1.min, T1.min + 50, p.low, 0.3);
  const T2 = ter(g, { base: H - 62, amp: 34, lv: 4, rough: 0.5, smooth: true, tilt: rg(g, -30, 30) });
  const tx = (cel && s.sx < 0.5 ? rg(g, 140, 200) : rg(g, 40, 100));
  layer(g, T2, { top: mx(p.shade, p.far, 0.15), bot: p.shade, span: 90, rnd: 0.7, calm: 0.1, rim: mx(p.glow, WHITE, 0.3), ra: 0.3 });
  // the tree
  const ty = T2.c[(tx / CX) | 0] + 2, th = 62 + 42 * s.sz, col = p.shade, cy0 = ty - th;
  g.body.push(`<path d="M${pt(tx - 2.6, ty)}Q${pt(tx - 1, ty - th * 0.5)} ${pt(tx - 1.2, cy0 + 8)}L${pt(tx + 1.2, cy0 + 8)}Q${pt(tx + 1.6, ty - th * 0.5)} ${pt(tx + 2.8, ty)}Z" fill="${col}"/>`);
  let br = "";
  for (let i = 0; i < 5; i++) { const y = ty - th * rg(g, 0.45, 0.95), dir = i % 2 ? 1 : -1, L = rg(g, 14, 30); br += `M${pt(tx, y + 10)}Q${pt(tx + dir * L * 0.5, y + 2)} ${pt(tx + dir * L, y - rg(g, 4, 14))}`; }
  g.body.push(`<path d="${br}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round"/>`);
  let cn = "";
  const nc = 30 + Math.floor(s.dens * 16), cr = 24 + 12 * s.sz;
  for (let i = 0; i < nc; i++) { const a = r() * 6.283, d = r() ** 0.6 * cr; cn += `<circle cx="${f1(tx + Math.cos(a) * d * 1.25)}" cy="${f1(cy0 + 6 + Math.sin(a) * d * 0.85)}" r="${f1(rg(g, 3, 7.5))}"/>`; }
  g.body.push(`<g fill="${col}" filter="${blur(g, 0.9)}">${cn}</g>`);
  paint(g.R, (px, py) => { const d = Math.hypot((px - tx) / 1.25, (py - cy0 - 6) / 0.85); return d < cr * 0.9 ? 0.95 : Math.abs(px - tx) < 2.4 && py > cy0 && py < ty ? 0.9 : 0; }, rgbOf(col), { calm: 0, rnd: 0.35 });
  g.sub = Math.max(g.sub, 0.4 + 0.5 * s.sz);
  g.n += 3;
  if (cel && Math.hypot(cel.x - tx, cel.y - cy0) < 80) glow(g, cel.x, cel.y, 60, p.glow, 0.2);
  if (s.dens > 0.5) birds(g, 3 + Math.floor(s.dens * 4), 20, 30, 210, hy - 40, mx(p.shade, p.far, 0.2), 3.2);
  foreground(g, ["none", "grass", "grass", "hill"]);
  if (cel) { glow(g, cel.x, cel.y, 80, p.glow, 0.25); g.flareAt = cel; }
}

/* ------------------------------------------------------------------ catalogue: types and grades */
const GRADES = {
  gold: { w: "Golden-hour", top: "#5b86b0", mid: "#e6b784", low: "#ffd89a", glow: "#ffd27a", far: "#b8957f", shade: "#2a1d19", acc: "#ffb45c", tint: "#ff9a3c", ta: 0.14 },
  crim: { w: "Crimson", top: "#2e2a5e", mid: "#b8447a", low: "#ff8a4c", glow: "#ffa15e", far: "#7a3a6a", shade: "#1a0f26", acc: "#ff5a6a", tint: "#ff4a7a", ta: 0.12 },
  blue: { w: "Blue-hour", top: "#0b1636", mid: "#28467f", low: "#8fa9d0", glow: "#ffb98a", far: "#3a5589", shade: "#080d1c", acc: "#ffc27a", tint: "#3a6aff", ta: 0.14, night: 1 },
  teal: { w: "Cinematic", top: "#12353f", mid: "#2c6f78", low: "#f0a066", glow: "#ffb46a", far: "#3c6a6e", shade: "#0b1b20", acc: "#ff9a4a", tint: "#1e8c96", ta: 0.14 },
  mist: { w: "Misty", top: "#8696a2", mid: "#b4c0c8", low: "#e1e7ea", glow: "#f6f9fa", far: "#a1aeb6", shade: "#36434b", acc: "#d4dde1", tint: "#9fb4c0", ta: 0.12 },
  neon: { w: "Neon", top: "#10052c", mid: "#4a1380", low: "#ff2f92", glow: "#ff49ac", far: "#3a1470", shade: "#07031a", acc: "#19e1ff", tint: "#7a2cff", ta: 0.16, night: 1 },
  past: { w: "Pastel", top: "#b3c4ff", mid: "#ffcfdc", low: "#ffeacb", glow: "#fff1d8", far: "#d3b3e0", shade: "#8a6a9c", acc: "#ffb0c6", tint: "#ffc2e0", ta: 0.14 },
  moody: { w: "Moody", top: "#0f1a1c", mid: "#243b3d", low: "#5d7a74", glow: "#b9d4c0", far: "#2d4a49", shade: "#040809", acc: "#8bb8a3", tint: "#1d3b36", ta: 0.16 },
  bright: { w: "Bright", top: "#79c2f2", mid: "#bde4fa", low: "#f5fbff", glow: "#ffffff", far: "#b8d0e0", shade: "#4a6a80", acc: "#ffe27a", tint: "#ffffff", ta: 0 },
  autumn: { w: "Autumn", top: "#5a6f86", mid: "#dca05c", low: "#f6c577", glow: "#ffb64d", far: "#a8643a", shade: "#2b1308", acc: "#d9531e", tint: "#d9741e", ta: 0.14 },
  arctic: { w: "Arctic", top: "#05182e", mid: "#0d4f66", low: "#2fb8b0", glow: "#7dffd0", far: "#0f5766", shade: "#031018", acc: "#6bffb8", tint: "#15b3a0", ta: 0.12, night: 1 },
  rose: { w: "Rosy", top: "#8d7bb8", mid: "#f5a6b5", low: "#ffd9c4", glow: "#ffe0c0", far: "#b98aa8", shade: "#3d2a4a", acc: "#ff9eb5", tint: "#ff8fb0", ta: 0.12 },
  mid: { w: "Midnight", top: "#02030a", mid: "#0a1230", low: "#1c3260", glow: "#cfe0ff", far: "#121d3d", shade: "#010206", acc: "#9fc0ff", tint: "#1a2c6c", ta: 0.14, night: 1 },
  dusty: { w: "Dusty", top: "#d6b08a", mid: "#ebc79e", low: "#f6dcb8", glow: "#fff1d0", far: "#c28f62", shade: "#6b3f26", acc: "#e8a85c", tint: "#c8854a", ta: 0.16 },
  vivid: { w: "Vivid", top: "#0a64e0", mid: "#2f95f0", low: "#bde6ff", glow: "#fff6c8", far: "#4a8fb8", shade: "#12582c", acc: "#ffd23a", tint: "#2f95f0", ta: 0 },
  mono: { w: "Monochrome", top: "#262626", mid: "#8c8c8c", low: "#e4e4e4", glow: "#ffffff", far: "#9a9a9a", shade: "#101010", acc: "#d0d0d0", tint: "#808080", ta: 0 },
};
const ALL = Object.keys(GRADES);
const ex = (...no) => ALL.filter((x) => !no.includes(x));
const TYPES = [
  { id: "mountains", noun: "mountains", fn: mountains, ok: ALL },
  { id: "forest", noun: "forest", fn: forest, ok: ex("crim", "neon", "dusty", "mid") },
  { id: "ocean", noun: "ocean", fn: ocean, ok: ex("moody", "autumn", "arctic") },
  { id: "dunes", noun: "dunes", fn: dunes, ok: ex("moody", "vivid", "arctic", "neon") },
  { id: "city", noun: "city", fn: city, ok: ex("dusty", "arctic", "vivid") },
  { id: "alpine", noun: "alpine peaks", fn: alpine, ok: ex("neon", "mid", "autumn") },
  { id: "beach", noun: "beach", fn: beach, ok: ["gold", "crim", "teal", "past", "bright", "rose", "vivid", "dusty", "blue", "autumn", "mist"] },
  { id: "rain", noun: "rainy window", fn: rainWindow, ok: ex("dusty", "vivid", "rose", "bright") },
  { id: "field", noun: "meadow", fn: field, ok: ex("neon", "arctic", "mid") },
  { id: "lake", noun: "lake reflection", fn: lake, ok: ex("neon", "dusty") },
  { id: "stars", noun: "night sky", fn: starry, ok: ["blue", "mid", "neon", "arctic", "moody", "crim", "mono", "teal"] },
  { id: "aurora", noun: "aurora", fn: aurora, ok: ["arctic", "mid", "neon", "moody", "blue", "teal", "mono"] },
  { id: "mesa", noun: "canyon", fn: mesa, ok: ["gold", "crim", "teal", "autumn", "dusty", "rose", "past"] },
  { id: "clouds", noun: "sea of clouds", fn: cloudSea, ok: ex("moody", "autumn", "arctic") },
  { id: "grove", noun: "grove", fn: grove, ok: ["gold", "autumn", "moody", "mist", "teal", "arctic", "rose", "past", "bright", "vivid", "mono", "dusty"] },
  { id: "tree", noun: "lone tree", fn: loneTree, ok: ex("neon", "arctic") },
];

/* ------------------------------------------------------------------ the pool plan */
const plans = new Map();
function planScene(season) {
  let plan = plans.get(season);
  if (plan) return plan;
  const r = mulberry32(hashStringToSeed(`${season}/scene/plan`));
  const ids = TYPES.map((_, i) => i);
  let order = shuffle(r, ids);
  const second = shuffle(r, ids);
  if (second[0] === order[order.length - 1]) second.push(second.shift());
  order = order.concat(second);
  const slots = order.map((t) => ({ type: t }));
  // grades: least-used compatible grade, constrained types first, never the same grade twice for one type
  const used = Object.fromEntries(ALL.map((x) => [x, 0]));
  const seen = new Set();
  const byTight = slots.map((s, i) => i).sort((a, b) => TYPES[slots[a].type].ok.length - TYPES[slots[b].type].ok.length || a - b);
  for (const i of byTight) {
    const t = TYPES[slots[i].type];
    let cands = t.ok.filter((x) => !seen.has(t.id + x));
    if (!cands.length) cands = t.ok;
    const lo = Math.min(...cands.map((x) => used[x]));
    const best = cands.filter((x) => used[x] === lo);
    const gr = best[Math.floor(r() * best.length)];
    slots[i].grade = gr; used[gr]++; seen.add(t.id + gr);
  }
  // stratified knobs: one permutation of 0..31 each
  for (const k of ["hz", "sz", "dens", "expo", "sx", "cv"]) {
    const perm = shuffle(r, [...Array(32).keys()]);
    slots.forEach((s, i) => { s[k] = (perm[i] + r()) / 32; });
  }
  slots.forEach((s) => {
    const gd = GRADES[s.grade];
    s.cel = gd.night ? (r() < 0.55 ? "moon" : "none") : r() < 0.72 ? "sun" : "none";
    s.flare = r() < 0.28;
    s.fu = r();
    s.dh = (r() - 0.5) * 16;
    s.vig = 0.25 + r() * 0.3;
    s.grain = 0.1 + r() * 0.1;
  });
  plans.set(season, slots);
  if (plans.size > 40) plans.delete(plans.keys().next().value);
  return slots;
}

/* ------------------------------------------------------------------ calibration (raw measurement -> [-1, 1]) */
const CAL = {
  dark: [45, 31],   // (mid - L) / span
  vivid: [0.17, 0.18], // (chroma - mid) / span
  bold: [0.336, 0.205],
  round: [0.03, 0.87],
  airy: [0.6, 0.23],
  warm: [0, 0.8],
};

/** Shifts a colour's hue and exposes it darker (ex < 0) or lighter (ex > 0). */
function tone(hex, dh, e) {
  if (dh) { const [h, s, l] = hexToHsl(hex); hex = hsl(h + dh, s, l); }
  return e < 0 ? mix(hex, BLACK, -e) : mix(hex, WHITE, e);
}

function stats(R) {
  const L = new Float32Array(NC);
  let sumL = 0, chr = 0, wsum = 0, wacc = 0, calm = 0, shapes = 0, rsum = 0;
  for (let k = 0; k < NC; k++) {
    const r = R.r[k], g = R.g[k], b = R.b[k], l = lstar(r, g, b);
    L[k] = l; sumL += l;
    const mxv = Math.max(r, g, b), mnv = Math.min(r, g, b), c = (mxv - mnv) / 255;
    chr += c;
    if (c > 0.02) {
      const lum = (mxv + mnv) / 510, d = (mxv - mnv) / 255;
      const s = d / (1 - Math.abs(2 * lum - 1) || 1);
      let h;
      if (mxv === r) h = (((g - b) / (mxv - mnv)) % 6) * 60; else if (mxv === g) h = ((b - r) / (mxv - mnv) + 2) * 60; else h = ((r - g) / (mxv - mnv) + 4) * 60;
      const w = Math.min(1, s) * (1 - Math.abs(2 * lum - 1) * 0.6);
      wsum += w; wacc += w * warmthOfHue((h + 360) % 360);
    }
    calm += R.calm[k];
    if (!Number.isNaN(R.rnd[k])) { shapes++; rsum += R.rnd[k]; }
  }
  const mean = sumL / NC, sorted = Array.from(L).sort((a, b) => a - b);
  const p08 = sorted[Math.floor(NC * 0.08)], p92 = sorted[Math.floor(NC * 0.92)];
  let sil = 0;
  for (let k = 0; k < NC; k++) if (!Number.isNaN(R.rnd[k]) && L[k] < mean * 0.8) sil++;
  return { mean, chroma: chr / NC, warm: wsum < 1 ? 0 : wacc / wsum, contrast: p92 - p08, sil: sil / NC, shape: shapes / NC, round: shapes > 20 ? rsum / shapes : 0, calm: calm / NC };
}

/* ------------------------------------------------------------------ build */
export function build(rand, ctx) {
  const season = String(ctx.season), idx = (((ctx.index | 0) % 32) + 32) % 32;
  const s = planScene(season)[idx], type = TYPES[s.type], gr = GRADES[s.grade];
  const g = { id: ctx.id + "-", r: rand, s, k: 0, defs: [], body: [], cache: {}, R: newRaster(), n: 0, sub: 0.15, flareAt: null };
  // grade realised: hue shift + exposure
  const e = s.expo < 0.5 ? -(0.5 - s.expo) * 0.9 : (s.expo - 0.5) * 0.45, dh = s.dh;
  g.p = { w: gr.w, night: gr.night };
  for (const key of ["top", "mid", "low", "far", "shade"]) g.p[key] = tone(gr[key], dh, e);
  for (const key of ["glow", "acc"]) g.p[key] = tone(gr[key], dh, e * 0.25);
  g.p.tint = gr.tint; g.p.ta = gr.ta;
  g.dark = c01(0.5 - e * 0.9) * (gr.night ? 1 : 0.7) + (gr.night ? 0.3 : 0);
  type.fn(g);
  flare(g, g.flareAt);
  // grade, grain, vignette
  if (g.p.ta > 0) {
    g.body.push(`<rect width="240" height="300" fill="${g.p.tint}" opacity="${f2(Math.min(0.55, g.p.ta * 3))}" style="mix-blend-mode:soft-light"/>`);
    wash(g, g.p.tint, g.p.ta * 0.9);
  }
  const vid = rg2(g, "v", 120, 150, 200, [[0.45, BLACK, 0], [1, BLACK, s.vig]]);
  g.body.push(`<rect width="240" height="300" fill="${vid}"/>`);
  paint(g.R, (x, y) => { const d = Math.hypot((x - 120) / 120, (y - 150) / 150) / 1.2; return s.vig * c01((d - 0.35) / 0.65) ** 1.5; }, rgbOf(BLACK));
  const gf = gid(g, "gr");
  g.defs.push(`<filter id="${gf}" x="0" y="0" width="240" height="300" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${f2(0.7 + rand() * 0.35)}" numOctaves="2" seed="${Math.floor(rand() * 900)}"/><feColorMatrix values=".33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 0 1"/></filter>`);
  g.body.push(`<rect width="240" height="300" filter="url(#${gf})" opacity="${f2(s.grain)}" style="mix-blend-mode:overlay"/>`);

  const m = stats(g.R);
  const traits = {
    warm: (m.warm - CAL.warm[0]) / CAL.warm[1],
    vivid: (m.chroma - CAL.vivid[0]) / CAL.vivid[1],
    dark: (CAL.dark[0] - m.mean) / CAL.dark[1],
    bold: ((0.45 * m.contrast) / 100 + 0.35 * m.sil + 0.2 * g.sub - CAL.bold[0]) / CAL.bold[1],
    round: (m.round - CAL.round[0]) / CAL.round[1],
    airy: (m.calm - CAL.airy[0]) / CAL.airy[1],
    rich: richOf(g.n + s.dens * 2, 4, 16),
  };
  for (const k in traits) traits[k] = clamp(traits[k]);
  m.sub = g.sub;
  const out = { name: `${gr.w} ${type.noun}`, svg: svgRoot(W, H, `<defs>${g.defs.join("")}</defs>${g.body.join("")}`).replace(/(^|[^\d.])0\.(\d)/g, "$1.$2"), traits };
  if (ctx.debug) out.debug = { m };
  return out;
}
