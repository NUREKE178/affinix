import { test } from "node:test";
import assert from "node:assert/strict";
import { deal } from "../api/arena-deal.mjs";
import { planRound } from "../src/lib/arena/sampler.js";
import { mulberry32 } from "../src/lib/prng.js";
import { encodeChallenge } from "../src/lib/arena/challenge.js";

const SEASON = "202611";
function link(n = 8, seed = 3) {
  const duels = planRound({ season: SEASON, rand: mulberry32(seed), size: 10, seen: new Set(), recent: [], focus: {}, day: "2026-11-08", drops: true, exposure: null }).filter((d) => !d.objective).slice(0, n);
  const answers = duels.map((d, i) => ({ family: d.family, a: d.a, b: d.b, dim: d.dim, pick: i % 2 }));
  return { answers, c: encodeChallenge({ season: SEASON, answers, name: "Aigerim" }) };
}

test("kind=pairs deals exactly the pairs of a friend's link, in their order, with what the screen shows", () => {
  const { answers, c } = link();
  const duels = deal({ kind: "pairs", c, seed: 7 });
  assert.equal(duels.length, answers.length);
  duels.forEach((d, i) => {
    assert.equal(d.season, SEASON);
    assert.deepEqual([d.family, d.a, d.b, d.dim], [answers[i].family, answers[i].a, answers[i].b, answers[i].dim]);
    assert.equal(d.pair, `${SEASON}/${d.family}/${d.a}-${d.b}`);
    assert.equal(d.objective, false);
    assert.equal(d.specimens.length, 2);
    assert.ok(d.specimens.every((s) => typeof s.name === "string" && s.name.length > 0), "both specimens are named");
    assert.equal(typeof d.swap, "boolean");
  });
});

test("the same seed deals the same sides, another seed may not", () => {
  const { c } = link();
  const swaps = (seed) => deal({ kind: "pairs", c, seed }).map((d) => d.swap).join("");
  assert.equal(swaps(7), swaps(7));
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(swaps)).size > 1, "the sides are drawn from the seed");
});

test("kind=pairs needs no day or season and refuses anything that is not a valid link", () => {
  const { c } = link();
  assert.ok(deal({ kind: "pairs", c }).length > 0);
  for (const bad of [undefined, "", "abc", c.replace(/^1\./, "2."), c.slice(0, -1) + "!", "1." + SEASON + ".zzzzzz-1-2-3-4."]) {
    assert.throws(() => deal({ kind: "pairs", c: bad }), (e) => e.status === 400, `refused: ${String(bad).slice(0, 30)}`);
  }
});

test("the other kinds still work", () => {
  assert.equal(deal({ kind: "daily", day: "2026-11-08", season: SEASON }).length, 10);
  assert.throws(() => deal({ kind: "daily", day: "x", season: SEASON }), (e) => e.status === 400);
});
