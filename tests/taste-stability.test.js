import { test } from "node:test";
import assert from "node:assert/strict";
import { planRound } from "../src/lib/arena/sampler.js";
import { getStimulus } from "../src/lib/arena/stimuli.js";
import { duelCode } from "../src/lib/arena/ledger.js";
import { mulberry32 } from "../src/lib/prng.js";
import { ARCHETYPES, archetypeOf, emptyDna, addToDna, leanOf, MIN_VOTES_FOR_TYPE } from "../src/lib/arena/dna.js";
import { TRAIT_IDS } from "../src/lib/arena/traits.js";

// The honesty rule behind the Arena's taste type, as a measurement: simulated players (each of the nine types, noisy
// choices, real duels from the sampler), and how often the type read after n duels equals the type read after 140 duels
// of the same person. The design canvas "Affinix: First Look and Taste Match" has the full table (360 players: 49 % after
// 6 duels, 62 % after 10, 79 % after 20, 84 % after 40). If someone lowers MIN_VOTES_FOR_TYPE this test says what it costs.
const SEASON = "202611";
const PLAYERS_PER_TYPE = 12;
const BETA = 4;

function pool(seed) {
  const seen = new Set(), out = [];
  for (let r = 0; out.length < 140 && r < 60; r++) {
    for (const d of planRound({ season: SEASON, rand: mulberry32(seed * 1000 + r), size: 10, seen, recent: [], focus: {}, day: "2026-11-08", drops: true, exposure: null })) {
      const c = duelCode(d.family, d.a, d.b, d.dim);
      if (seen.has(c)) continue;
      seen.add(c);
      out.push({ ta: getStimulus(SEASON, d.family, d.a).traits, tb: getStimulus(SEASON, d.family, d.b).traits });
    }
  }
  return out.slice(0, 140);
}

function stability(ns) {
  const rnd = mulberry32(12345);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const hits = Object.fromEntries(ns.map((n) => [n, 0]));
  let players = 0;
  ARCHETYPES.forEach((arch, ai) => {
    for (let p = 0; p < PLAYERS_PER_TYPE; p++) {
      const w = TRAIT_IDS.map((t) => Math.max(-1, Math.min(1, arch.v[t] + 0.25 * gauss())));
      const duels = pool(1 + p + 100 * ai);
      const choose = (d) => 1 / (1 + Math.exp(-BETA * TRAIT_IDS.reduce((s, t, k) => s + w[k] * (d.ta[t] - d.tb[t]), 0))) > rnd();
      const full = emptyDna(), dna = emptyDna(), labels = {};
      duels.forEach((d, i) => {
        const a = choose(d);
        const [c, o] = a ? [d.ta, d.tb] : [d.tb, d.ta];
        addToDna(full, c, o);
        if (i < Math.max(...ns)) { addToDna(dna, c, o); if (ns.includes(i + 1)) labels[i + 1] = archetypeOf(leanOf(dna)).id; }
      });
      const ref = archetypeOf(leanOf(full)).id;
      for (const n of ns) if (labels[n] === ref) hits[n]++;
      players++;
    }
  });
  return Object.fromEntries(ns.map((n) => [n, hits[n] / players]));
}

test("a taste type is only promised from a number of duels at which it is mostly stable", () => {
  const r = stability([6, MIN_VOTES_FOR_TYPE]);
  assert.ok(r[MIN_VOTES_FOR_TYPE] >= 0.68, `after ${MIN_VOTES_FOR_TYPE} duels the type should match the long-run one at least 68 % of the time, got ${(100 * r[MIN_VOTES_FOR_TYPE]).toFixed(0)} %`);
  assert.ok(r[6] < 0.62, `after 6 duels it is still a coin flip (got ${(100 * r[6]).toFixed(0)} %), which is why no type is shown that early`);
  assert.ok(MIN_VOTES_FOR_TYPE >= 20, "the Arena shows a type from 20 duels at the earliest");
});
