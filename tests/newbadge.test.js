// The "New" tag: shows until the thing is used, never after the cut-off date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNew, markSeen } from "../src/lib/newTag.js";

test("a new feature is marked new until it has been used", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(isNew("chat-clear"), true);
  markSeen("chat-clear");
  assert.equal(isNew("chat-clear"), false, "used once -> no tag");
  assert.equal(isNew("chat-block"), true, "other features keep their own tag");
});

test("nothing stays new forever", () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const real = Date.now;
  Date.now = () => Date.UTC(2027, 1, 1);
  try { assert.equal(isNew("push"), false); } finally { Date.now = real; }
});
