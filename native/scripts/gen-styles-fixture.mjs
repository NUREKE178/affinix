// Records what the website's style insights (src/lib/styleInsights.js) say about a fixed set of specimen records, so the app's port (store/StyleStats.kt) is tested against
// the real thing. The traits are the real measured traits of real specimens (from the site's own generator). Run from the repo root:
//   node native/scripts/gen-styles-fixture.mjs
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../../src/lib/prng.js";
import { getStimulus, FAMILY_IDS } from "../../src/lib/arena/stimuli.js";
import { TRAIT_IDS } from "../../src/lib/arena/traits.js";
import { traitLifts, recipeOf, rankSpecimens, wilsonLow } from "../../src/lib/styleInsights.js";

const season = "202610";
const rand = mulberry32(20261101);
const seen = new Set();
const entries = [];
while (entries.length < 420) {
  const family = FAMILY_IDS[Math.floor(rand() * FAMILY_IDS.length)];
  const index = Math.floor(rand() * 32 * 31);
  const stim = `${family}:${index}`;
  if (seen.has(stim) && rand() < 0.7) continue; // a few specimens appear twice (two questions merged), most once
  seen.add(stim);
  const traits = getStimulus(season, family, index).traits;
  // the crowd likes warm, vivid specimens a little more: a real lift for the maths to find
  const p = 0.5 + 0.12 * (traits.warm ?? 0) + 0.1 * (traits.vivid ?? 0) - 0.06 * (traits.dark ?? 0);
  const n = 3 + Math.floor(rand() * 40);
  let wins = 0;
  for (let i = 0; i < n; i++) if (rand() < p) wins++;
  entries.push({ stim, family, index, wins, losses: n - wins, traits });
}

const pack = (e) => ({ stim: e.stim, family: e.family, index: e.index, wins: e.wins, losses: e.losses, traits: TRAIT_IDS.map((t) => e.traits[t]) });
const lifts = (list) => list.map((l) => ({ trait: l.trait, lift: l.lift, hiRate: l.hiRate, loRate: l.loRate, nHi: l.nHi, nLo: l.nLo, z: l.z, level: l.level }));
const ranked = (r) => ({ best: r.best.map((m) => ({ stim: m.stim, wins: m.wins, losses: m.losses, n: m.n, rate: m.rate })), worst: r.worst.map((m) => ({ stim: m.stim, wins: m.wins, losses: m.losses, n: m.n, rate: m.rate })) });

const small = entries.filter((e) => e.index < 64); // a thinner slice: the "no clear signal" side of the maths
const out = {
  season, traitOrder: TRAIT_IDS,
  entries: entries.map(pack),
  expected: {
    lifts: lifts(traitLifts(entries)),
    recipe: recipeOf(traitLifts(entries)).map((l) => l.trait),
    ranked: ranked(rankSpecimens(entries, { top: 12, bottom: 4, minAnswers: 6 })),
    rankedFew: ranked(rankSpecimens(entries, { top: 12, bottom: 4, minAnswers: 3 })),
    smallLifts: lifts(traitLifts(small)),
    smallRecipe: recipeOf(traitLifts(small)).map((l) => l.trait),
    wilson: [[0, 0], [1, 1], [5, 10], [30, 40], [7, 7], [0, 9]].map(([w, n]) => ({ w, n, v: wilsonLow(w, n) })),
  },
};
writeFileSync(new URL("../composeApp/src/desktopTest/resources/styles.json", import.meta.url), JSON.stringify(out));
const c = out.expected;
console.log(`styles.json: ${out.entries.length} records; recipe ${JSON.stringify(c.recipe)}; best ${c.ranked.best.length}, worst ${c.ranked.worst.length}; levels ${c.lifts.map((l) => l.level).join(",")}`);
