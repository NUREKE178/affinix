import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, parseTenge, payoutProgress, daysUntil, TIYN_PER_TENGE } from "../src/lib/money.js";

// Arena cash amounts are integers in tiyn (migration 0027); the screens format them, admins type tenge.
const plain = (s) => s.replace(/[  ]/g, " ");

test("formatMoney: the sign after the number, decimals only when there are any", () => {
  assert.equal(plain(formatMoney(120000, "ru")), "1 200 ₸");
  assert.equal(plain(formatMoney(125050, "kk")), "1 250,50 ₸");
  assert.equal(plain(formatMoney(125050, "en")), "1,250.50 ₸");
  assert.equal(plain(formatMoney(1000, "ru")), "10 ₸");
  assert.equal(plain(formatMoney(0, "kk")), "0 ₸");
  assert.equal(plain(formatMoney(-50, "ru")), "-0,50 ₸");
  assert.equal(plain(formatMoney("not a number", "ru")), "0 ₸");
});

test("parseTenge: what an admin types, to tiyn; anything odd is refused", () => {
  assert.equal(parseTenge("10"), 10 * TIYN_PER_TENGE);
  assert.equal(parseTenge("10,5"), 1050);
  assert.equal(parseTenge("1 250.75"), 125075);
  assert.equal(parseTenge("0"), 0);
  for (const bad of ["", "abc", "1.234", "-5", "1e3", "10,"]) assert.equal(parseTenge(bad), null, bad);
});

test("payoutProgress and daysUntil", () => {
  assert.deepEqual(payoutProgress({ available: 50000, rules: { minPayout: 200000 } }), { ratio: 0.25, missing: 150000, ready: false });
  assert.deepEqual(payoutProgress({ available: 250000, rules: { minPayout: 200000 } }), { ratio: 1, missing: 0, ready: true });
  assert.deepEqual(payoutProgress(null), { ratio: 0, missing: 0, ready: false });
  const now = Date.parse("2026-11-25T12:00:00Z");
  assert.equal(daysUntil("2026-11-25T11:00:00Z", now), 0);
  assert.equal(daysUntil("2026-11-25T13:00:00Z", now), 1);
  assert.equal(daysUntil("2026-12-02T12:00:00Z", now), 7);
});

import { countUpAt, easeOut } from "../src/lib/money.js";

test("countUpAt: starts at the old value, rises monotonically, ends exactly on the new one", () => {
  assert.equal(countUpAt(0, 1032, 0), 0);
  assert.equal(countUpAt(0, 1032, 1), 1032);
  assert.equal(countUpAt(0, 1032, 5), 1032, "past the end stays on the target");
  let prev = -1;
  for (let i = 0; i <= 20; i++) { const v = countUpAt(0, 1032, i / 20); assert.ok(v >= prev, "monotonic"); prev = v; }
  assert.ok(countUpAt(0, 1000, 0.5) > 500, "ease-out: more than half done at half time");
  assert.equal(countUpAt(500, 200, 1), 200, "also downwards");
  assert.equal(countUpAt("x", 10, 1), 10);
  assert.equal(easeOut(-1), 0);
  assert.equal(easeOut(2), 1);
});
