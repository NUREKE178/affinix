// Records what the website's Taste DNA says about a fixed set of answers, so the app's port (store/Taste.kt) is tested against the real thing.
// Run from the repo root:  node native/scripts/gen-dna-fixture.mjs
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../../src/lib/prng.js";
import { FAMILY_IDS, DIMENSION_IDS, getStimulus } from "../../src/lib/arena/stimuli.js";
import { leanOf, confidenceOf, archetypeOf, topTraits, leanStrength, standoutDifference, emptyDna, addToDna } from "../../src/lib/arena/dna.js";
import { TRAIT_IDS } from "../../src/lib/arena/traits.js";
import { traitsFor } from "../../api/arena-traits.mjs";

const season = "202610";
const rand = mulberry32(20261030);
// answers with a deliberate lean (the picked specimen is warmer most of the time) so the archetype and the standout are not trivial
const votes = [];
for (let i = 0; i < 90; i++) {
  const family = FAMILY_IDS[Math.floor(rand() * FAMILY_IDS.length)];
  let a = Math.floor(rand() * 60), b = Math.floor(rand() * 60);
  if (a === b) b = (b + 1) % 60;
  if (a > b) [a, b] = [b, a];
  const dim = DIMENSION_IDS[Math.floor(rand() * DIMENSION_IDS.length)];
  const wa = getStimulus(season, family, a).traits.warm, wb = getStimulus(season, family, b).traits.warm;
  const pick = rand() < 0.75 ? (wa >= wb ? 0 : 1) : Math.floor(rand() * 2);
  votes.push([`${season}/${family}/${a}-${b}`, dim, pick]);
}
const items = [...new Set(votes.flatMap(([pair]) => { const [s, f, ab] = pair.split("/"); const [a, b] = ab.split("-"); return [[s, f, Number(a)], [s, f, Number(b)]].map((x) => x.join("|")); }))].map((k) => { const [s, f, i] = k.split("|"); return [s, f, Number(i)]; });
const { traits } = traitsFor(items);

const all = emptyDna(); const byDim = {};
for (const [pair, dim, pick] of votes) {
  const [s, f, ab] = pair.split("/"); const [a, b] = ab.split("-").map(Number);
  const sa = getStimulus(s, f, a), sb = getStimulus(s, f, b);
  const [chosen, other] = pick === 0 ? [sa, sb] : [sb, sa];
  addToDna(all, chosen.traits, other.traits);
  addToDna((byDim[dim] ??= emptyDna()), chosen.traits, other.traits);
}
const lean = leanOf(all);
const st = standoutDifference({ all, byDim });
const expected = {
  n: all.n,
  lean: TRAIT_IDS.map((t) => lean[t]),
  confidence: confidenceOf(all),
  strength: TRAIT_IDS.map((t) => leanStrength(lean[t])),
  archetype: archetypeOf(lean),
  top: topTraits(lean, 3),
  standout: st,
  byDimLean: Object.fromEntries(Object.entries(byDim).map(([d, v]) => [d, { n: v.n, lean: TRAIT_IDS.map((t) => leanOf(v)[t]) }])),
};
writeFileSync(new URL("../composeApp/src/desktopTest/resources/dna.json", import.meta.url), JSON.stringify({ order: TRAIT_IDS, votes, traits, expected }));
console.log("ok:", votes.length, "votes,", Object.keys(traits).length, "specimens, type", expected.archetype.id, "standout", st && `${st.dim}/${st.trait}`);
