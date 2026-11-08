import { test } from "node:test";
import assert from "node:assert/strict";
import { planRound } from "../src/lib/arena/sampler.js";
import { mulberry32 } from "../src/lib/prng.js";
import { DIMENSIONS } from "../src/lib/arena/catalog.js";
import { encodeEntry } from "../src/lib/arena/ledger.js";
import {
  CHALLENGE_MIN, CHALLENGE_MAX, NAME_MAX, cleanName, isShareable, encodeChallenge, decodeChallenge, challengeParam,
  answersOfRound, matchOf, matchLabel, seasonIsLive,
} from "../src/lib/arena/challenge.js";

const SEASON = "202611";

/** n real, shareable answers from the sampler (eye tests are skipped, as the app skips them) */
function sample(n = 10, seed = 3) {
  const out = [];
  for (let k = 0; out.length < n && k < 20; k++) {
    const duels = planRound({ season: SEASON, rand: mulberry32(seed + k), size: 10, seen: new Set(out.map((x) => `${x.family}|${x.a}|${x.b}`)), recent: [], focus: {}, day: "2026-11-08", drops: true, exposure: null });
    for (const d of duels) if (!d.objective && out.length < n && !out.some((x) => x.family === d.family && x.a === d.a && x.b === d.b)) out.push({ family: d.family, a: d.a, b: d.b, dim: d.dim, pick: out.length % 2 });
  }
  return out;
}
const link = (season, entries, name = "") => `1.${season}.${entries.map((e) => e.toString(36)).join("-")}.${name}`;
const entryOf = (a) => encodeEntry(a.family, a.a, a.b, a.dim, a.pick);

test("a link round-trips: season, the answers in order, the first name", () => {
  const answers = sample(10);
  const text = encodeChallenge({ season: SEASON, answers, name: "Айгерим Сериккызы" });
  assert.match(text, /^1\.202611\.[0-9a-z-]+\.[A-Za-z0-9_-]+$/);
  const back = decodeChallenge(text);
  assert.equal(back.season, SEASON);
  assert.equal(back.name, "Айгерим");
  assert.deepEqual(back.answers, answers);
});

test("a link for ten answers stays short enough for any messenger", () => {
  assert.ok(encodeChallenge({ season: SEASON, answers: sample(10), name: "Aigerim" }).length <= 140);
});

test("a link without a name is allowed and decodes to no name", () => {
  const back = decodeChallenge(encodeChallenge({ season: SEASON, answers: sample(6), name: "" }));
  assert.equal(back.name, null);
  assert.equal(back.answers.length, 6);
});

test("too few or too many answers cannot be sent", () => {
  assert.equal(encodeChallenge({ season: SEASON, answers: sample(CHALLENGE_MIN - 1) }), null);
  assert.ok(encodeChallenge({ season: SEASON, answers: sample(CHALLENGE_MIN) }));
  assert.equal(encodeChallenge({ season: SEASON, answers: [...sample(10), ...sample(3, 99)] }), null);
  assert.ok(CHALLENGE_MAX >= 10);
});

test("an eye test is never part of a taste match", () => {
  const eye = DIMENSIONS.find((d) => d.objective);
  assert.ok(eye, "the catalog has an objective question");
  const answers = sample(6);
  assert.equal(isShareable({ ...answers[0], dim: eye.id }), false);
  assert.equal(encodeChallenge({ season: SEASON, answers: [{ ...answers[0], dim: eye.id }, ...answers.slice(1)] }), null);
  const crafted = link(SEASON, [encodeEntry(answers[0].family, answers[0].a, answers[0].b, eye.id, 0), ...answers.slice(1).map(entryOf)]);
  assert.equal(decodeChallenge(crafted), null);
});

test("the text of a link is never trusted: everything that is not exactly what we write is refused", () => {
  const answers = sample(8);
  const entries = answers.map(entryOf);
  const good = link(SEASON, entries);
  assert.ok(decodeChallenge(good));
  assert.equal(decodeChallenge(null), null);
  assert.equal(decodeChallenge(42), null);
  assert.equal(decodeChallenge(""), null);
  assert.equal(decodeChallenge(good.replace(/^1\./, "2.")), null, "another version");
  assert.equal(decodeChallenge(link("202613", entries)), null, "month 13");
  assert.equal(decodeChallenge(link("20261", entries)), null, "short season");
  assert.equal(decodeChallenge(link(SEASON, entries.slice(0, 4))), null, "four entries");
  assert.equal(decodeChallenge(link(SEASON, [...entries, ...entries, ...entries].slice(0, 11))), null, "eleven entries");
  assert.equal(decodeChallenge(good + "x"), null, "five parts");
  assert.equal(decodeChallenge(good.replace(/-/g, "+")), null, "wrong separator");
  assert.equal(decodeChallenge("1." + SEASON + ".zzzzzzz-1-2-3-4."), null, "an entry out of range");
  assert.equal(decodeChallenge(link(SEASON, [...entries.slice(0, 7), entries[0]])), null, "the same duel twice");
  assert.equal(decodeChallenge(link(SEASON, [...entries.slice(0, 7), encodeEntry("mark", 9, 3, "premium", 0)])), null, "lower index after the higher");
  assert.equal(decodeChallenge("1." + SEASON + ".zzzzzz-1-2-3-4."), null, "an entry above the largest ledger value");
  assert.equal(decodeChallenge(good.slice(0, -1) + "!"), null, "a character that is not URL-safe");
  assert.equal(decodeChallenge("1." + SEASON + "." + entries.join("-") + ".@@@@"), null, "a name that is not base64");
  assert.equal(decodeChallenge("x".repeat(500)), null, "far too long");
});

test("a name is the first word only, without invisible or direction-changing characters", () => {
  assert.equal(cleanName("  Айгерим   Сериккызы "), "Айгерим");
  assert.equal(cleanName("Ai​ger‮im"), "Aigerim");
  assert.equal(cleanName("\u0000\u0007"), "");
  assert.equal(cleanName(null), "");
  assert.equal(Array.from(cleanName("А".repeat(80))).length, NAME_MAX);
  const emoji = cleanName("😀".repeat(40));
  assert.equal(Array.from(emoji).length, NAME_MAX);
  assert.ok(!/[\ud800-\udbff]$/.test(emoji), "no lone surrogate");
  const text = encodeChallenge({ season: SEASON, answers: sample(6), name: "Ai‮gerim" });
  assert.equal(decodeChallenge(text).name, "Aigerim");
});

test("challengeParam reads the c value out of an address", () => {
  assert.equal(challengeParam("?c=1.202611.a-b-c-d-e."), "1.202611.a-b-c-d-e.");
  assert.equal(challengeParam("?x=1&c=abc"), "abc");
  assert.equal(challengeParam("?x=1"), null);
  assert.equal(challengeParam(""), null);
  assert.equal(challengeParam(undefined), null);
});

test("the match counts duels picked the same way, and the ones where two people split", () => {
  const answers = sample(10);
  const mine = answers.map((a) => a.pick);
  assert.deepEqual(matchOf(answers, mine), { compared: 10, same: 10, percent: 100, splits: [], sameAt: Array(10).fill(true) });
  const flipped = mine.map((p, i) => (i === 2 || i === 5 || i === 9 ? 1 - p : p));
  const m = matchOf(answers, flipped);
  assert.equal(m.same, 7);
  assert.equal(m.percent, 70);
  assert.deepEqual(m.splits, [2, 5, 9]);
  assert.equal(m.sameAt[2], false);
});

test("a skipped duel is not counted for or against", () => {
  const answers = sample(10);
  const picks = answers.map((a) => a.pick);
  picks[0] = null; picks[1] = null;
  const m = matchOf(answers, picks);
  assert.equal(m.compared, 8);
  assert.equal(m.percent, 100);
  assert.equal(matchOf(answers, Array(10).fill(null)).percent, null);
});

test("the names of the four closeness bands", () => {
  assert.equal(matchLabel(100), "twins");
  assert.equal(matchLabel(90), "twins");
  assert.equal(matchLabel(89), "close");
  assert.equal(matchLabel(70), "close");
  assert.equal(matchLabel(60), "mixed");
  assert.equal(matchLabel(40), "mixed");
  assert.equal(matchLabel(39), "opposite");
  assert.equal(matchLabel(0), "opposite");
  assert.equal(matchLabel(null), "mixed");
});

test("answersOfRound sends what was answered: no skipped duel, no eye test, and nothing when fewer than five", () => {
  const eye = DIMENSIONS.find((d) => d.objective).id;
  const answers = sample(10);
  const duels = answers.map((a, i) => ({ id: `d${i}`, season: SEASON, family: a.family, a: a.a, b: a.b, dim: a.dim }));
  const results = answers.map((a, i) => ({ duelId: `d${i}`, pick: a.pick }));
  const round = { season: SEASON, duels, results };
  assert.equal(answersOfRound(round).answers.length, 10);
  const skipped = { ...round, results: results.map((r, i) => (i < 3 ? { duelId: r.duelId, skipped: true } : r)) };
  assert.equal(answersOfRound(skipped).answers.length, 7);
  const withEye = { ...round, duels: duels.map((d, i) => (i === 0 ? { ...d, dim: eye } : d)) };
  assert.equal(answersOfRound(withEye).answers.length, 9);
  const few = { ...round, results: results.map((r, i) => (i < 6 ? { duelId: r.duelId, skipped: true } : r)) };
  assert.deepEqual(answersOfRound(few).answers, []);
  assert.deepEqual(answersOfRound(null).answers, []);
});

test("a season is live for this month and last month only (what the server takes votes for)", () => {
  const now = new Date(Date.UTC(2026, 10, 8));
  assert.equal(seasonIsLive("202611", now), true);
  assert.equal(seasonIsLive("202610", now), true);
  assert.equal(seasonIsLive("202609", now), false);
  assert.equal(seasonIsLive("202612", now), false);
  assert.equal(seasonIsLive("202601", new Date(Date.UTC(2026, 0, 3))), true);
  assert.equal(seasonIsLive("202512", new Date(Date.UTC(2026, 0, 3))), true);
});
