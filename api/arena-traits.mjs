// The measured taste traits of Arena specimens, for the native apps' Taste DNA. A specimen is a pure function of (season, family, index) and its seven traits
// come from the very generator the website uses (src/lib/arena/*), so the DNA computed in an app agrees with the one on the site.
//   POST /api/arena-traits  { items: [[season, family, index], ...] }   (up to 3000)
//   ->   { order: ["warm","bold","round","airy","vivid","rich","dark"], traits: { "202610/mark/3": [-0.22, 0.12, 0.25, 0.57, 1, -0.38, -0.23], ... } }
import { getStimulus, FAMILY_IDS } from "../src/lib/arena/stimuli.js";
import { INDEX_LIMIT } from "../src/lib/arena/catalog.js";
import { TRAIT_IDS } from "../src/lib/arena/traits.js";

export const MAX_ITEMS = 3000;

export function traitsFor(items) {
  if (!Array.isArray(items)) throw Object.assign(new Error("items must be a list"), { status: 400 });
  if (items.length > MAX_ITEMS) throw Object.assign(new Error("too many items"), { status: 413 });
  const out = {};
  for (const it of items) {
    const [season, family, index] = Array.isArray(it) ? it : [];
    const i = Number(index);
    if (!/^\d{6}$/.test(String(season)) || !FAMILY_IDS.includes(family) || !Number.isInteger(i) || i < 0 || i >= INDEX_LIMIT) {
      throw Object.assign(new Error("bad specimen"), { status: 400 });
    }
    const key = `${season}/${family}/${i}`;
    if (out[key]) continue;
    const t = getStimulus(String(season), family, i).traits;
    out[key] = TRAIT_IDS.map((id) => t[id] ?? 0);
  }
  return { order: TRAIT_IDS, traits: out };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(traitsFor(body?.items));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : "failed" });
  }
}
