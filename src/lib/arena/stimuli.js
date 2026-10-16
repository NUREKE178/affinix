// Registry of the Arena's procedural specimens.
//
// Nothing here is stored or uploaded: a specimen is a pure function of
// (season, family, index), built with a seeded PRNG, so every browser (and the
// server, which only ever sees the keys) agrees on what "mark:7" looked like in
// 2026-11. Each season (a UTC month) re-seeds every pool, so the Arena stays
// fresh without anyone authoring content.
import { mulberry32, hashStringToSeed } from "../prng.js";
import { TRAIT_IDS, finishTraits } from "./traits.js";
import * as mark from "./families/mark.js";
import * as palette from "./families/palette.js";
import * as button from "./families/button.js";
import * as card from "./families/card.js";
import * as pack from "./families/pack.js";
import * as poster from "./families/poster.js";
import * as appicon from "./families/appicon.js";

export const POOL_SIZE = 32;
export const FAMILY_IDS = ["mark", "palette", "button", "card", "pack", "poster", "appicon"];
const MODS = { mark, palette, button, card, pack, poster, appicon };

/** The measurement dimensions of the Arena. Ids match the builder's own
 * (builder.dimensions.*), so researchers and players use one vocabulary.
 * `objective` ones have a right answer that the specimens themselves decide. */
export const DIMENSIONS = [
  { id: "preference", objective: false },
  { id: "attention", objective: false },
  { id: "trust", objective: false },
  { id: "quality", objective: false },
  { id: "premium", objective: false },
  { id: "clarity", objective: true },
  { id: "purchaseIntent", objective: false },
];
export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);
export const isObjective = (dimId) => DIMENSIONS.find((d) => d.id === dimId)?.objective === true;

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

/** The specimen `famId:index` of a season: { key, family, index, season, name, svg (template), traits, legibility? }. */
export function getStimulus(season, famId, index) {
  const ck = `${season}/${famId}/${index}`;
  let s = cache.get(ck);
  if (s) return s;
  const mod = MODS[famId];
  const rand = mulberry32(hashStringToSeed(ck));
  const built = mod.build(rand, { id: "__ID__", season, index });
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
