// An Arena specimen as a PNG, for the native apps (Android, Windows, Linux), which draw no SVG and run no browser:
//   GET /api/arena-specimen?season=202610&family=card&index=17&w=640&v=1
// It is the very generator the website uses (src/lib/arena/*), drawn with resvg, so a specimen looks the same everywhere and a vote on it means the
// same thing. A specimen is a pure function of (season, family, index), so the answer never changes and is cached for a year (`v` busts it if a generator is fixed).
import { Resvg } from "@resvg/resvg-js";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getStimulus, FAMILY_IDS } from "../src/lib/arena/stimuli.js";
import { INDEX_LIMIT } from "../src/lib/arena/catalog.js";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "_fonts");
const FONT_FILES = readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")).map((f) => join(FONT_DIR, f));

/** The specimen as a standalone SVG with a pixel size (the generators size theirs with CSS: width / height 100%). */
export function specimenSvg(season, family, index) {
  const stim = getStimulus(season, family, index);
  const svg = stim.svg.replace(/__ID__/g, "s");
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) throw new Error("specimen without a viewBox");
  const [w, h] = [Number(vb[1]), Number(vb[2])];
  return { svg: svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`), w, h };
}

export function renderPng(season, family, index, width) {
  const { svg, w, h } = specimenSvg(season, family, index);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
    shapeRendering: 2, textRendering: 1, imageRendering: 0,
  });
  return { png: resvg.render().asPng(), aspect: w / h };
}

export default function handler(req, res) {
  const q = req.query ?? Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const season = String(q.season ?? "");
  const family = String(q.family ?? "");
  const index = Number(q.index);
  const width = Math.min(1600, Math.max(96, Number(q.w) || 640));
  if (!/^\d{6}$/.test(season) || !FAMILY_IDS.includes(family) || !Number.isInteger(index) || index < 0 || index >= INDEX_LIMIT) {
    res.status(400).json({ error: "bad specimen" });
    return;
  }
  try {
    const { png } = renderPng(season, family, index, Math.round(width));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.status(200).send(Buffer.from(png));
  } catch (err) {
    res.status(500).json({ error: "render failed" });
  }
}
