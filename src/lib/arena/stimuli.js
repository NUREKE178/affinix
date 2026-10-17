// Registry of the Arena's procedural specimens.
//
// Nothing here is stored or uploaded: a specimen is a pure function of
// (season, family, index), built with a seeded PRNG, so every browser (and the
// server, which only ever sees the keys) agrees on what "mark:7" looked like in
// 2026-11. Each season (a UTC month) re-seeds every pool, and every day of the month has its own DROP pool
// (index = pool * 32 + slot, see catalog.js), so the Arena stays fresh without anyone authoring content.
import { mulberry32, hashStringToSeed } from "../prng.js";
import { TRAIT_IDS, finishTraits } from "./traits.js";
import * as mark from "./families/mark.js";
import * as palette from "./families/palette.js";
import * as button from "./families/button.js";
import * as card from "./families/card.js";
import * as pack from "./families/pack.js";
import * as poster from "./families/poster.js";
import * as appicon from "./families/appicon.js";
import * as scene from "./families/scene.js";
import * as shot from "./families/shot.js";

import { POOL_SIZE, FAMILY_IDS, DIMENSIONS, DIMENSION_IDS, isObjective } from "./catalog.js";

export { POOL_SIZE, FAMILY_IDS, DIMENSIONS, DIMENSION_IDS, isObjective };

/** The pool a specimen belongs to: the season's own for the classics, "<season>-d<N>" for the drop of day N. */
const poolSeason = (season, pool) => (pool === 0 ? season : `${season}-d${pool}`);
const MODS = { mark, palette, button, card, pack, poster, appicon, scene, shot };

export function familyDims(famId) {
  return MODS[famId].DIMS;
}
export function familyHasText(famId) {
  return MODS[famId].TEXT === true;
}
export function familyAspect(famId) {
  const [w, h] = MODS[famId].VIEWBOX;
  return w / h;
}

export function stimulusKey(famId, index) {
  return `${famId}:${index}`;
}
export function parseStimulusKey(key) {
  const [family, index] = key.split(":");
  return { family, index: Number(index) };
}

const cache = new Map();
const warned = new Set();

/** A plain, honest stand-in when a builder throws: a tile with the family's initial, neutral traits. */
function fallback(famId, index, mod) {
  const [w, h] = mod.VIEWBOX;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect width="${w}" height="${h}" rx="${Math.round(w * 0.05)}" fill="#2a2c31"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(h * 0.28)}" font-weight="700" fill="#868993">${famId[0].toUpperCase()}</text></svg>`;
  const out = { name: `${famId} ${index + 1}`, svg, traits: {} };
  if (mod.TEXT) out.legibility = { score: 0.3, contrast: 3, size: 0.4 };
  return out;
}

/** The specimen `famId:index` of a season: { key, family, index, season, name, svg (template), traits, legibility? }. */
export function getStimulus(season, famId, index) {
  const ck = `${season}/${famId}/${index}`;
  let s = cache.get(ck);
  if (s) return s;
  const mod = MODS[famId];
  const rand = mulberry32(hashStringToSeed(ck));
  let built;
  try {
    // the family only ever sees its pool's slot (0..31) and the pool's own season key
    built = mod.build(rand, { id: "__ID__", season: poolSeason(season, Math.floor(index / POOL_SIZE)), index: index % POOL_SIZE });
  } catch (err) {
    // A generator bug must never take the game down: show a neutral placeholder (and say so once in the console).
    if (!warned.has(famId)) { warned.add(famId); console.error(`Arena: ${famId} specimen ${index} failed to build`, err); }
    built = fallback(famId, index, mod);
  }
  s = {
    key: stimulusKey(famId, index),
    family: famId,
    index,
    season,
    name: built.name ?? `${famId} ${index + 1}`,
    svg: built.svg,
    traits: finishTraits(built.traits),
    legibility: mod.TEXT ? built.legibility : undefined,
  };
  cache.set(ck, s);
  if (cache.size > 900) cache.delete(cache.keys().next().value);
  return s;
}

let idCounter = 0;
/** The SVG markup with its internal ids made unique, so the same specimen can sit on screen twice. */
export function renderSvg(stim) {
  idCounter = (idCounter + 1) % 1e6;
  return stim.svg.replace(/__ID__/g, `ar${idCounter.toString(36)}`);
}

/** Which of two specimens reads more clearly, or null when it is not clear-cut.
 * Only a pair where one wins on contrast AND is not meaningfully smaller counts,
 * so the "right answer" of an eye test is never a judgement call. */
export function legibilityWinner(a, b) {
  const la = a.legibility, lb = b.legibility;
  if (!la || !lb) return null;
  const aWins = la.contrast >= lb.contrast * 1.25 && la.size >= lb.size * 0.85;
  const bWins = lb.contrast >= la.contrast * 1.25 && lb.size >= la.size * 0.85;
  if (aWins && !bWins) return 0;
  if (bWins && !aWins) return 1;
  return null;
}

export { TRAIT_IDS };
