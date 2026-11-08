import { test } from "node:test";
import assert from "node:assert/strict";
import ru from "../src/lib/locales/ru.js";
import kk from "../src/lib/locales/kk.js";
import en from "../src/lib/locales/en.js";

// every text exists in all three languages with the same structure, and a {placeholder} is never lost in translation
function walk(o, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key, out);
    else out.set(key, v);
  }
  return out;
}
const R = walk(ru), K = walk(kk), E = walk(en);
const holes = (s) => (typeof s === "string" ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",") : "");

test("ru, kk and en have exactly the same keys", () => {
  const missing = (a, b) => [...a.keys()].filter((k) => !b.has(k));
  assert.deepEqual(missing(R, K), [], "in ru but not in kk");
  assert.deepEqual(missing(K, R), [], "in kk but not in ru");
  assert.deepEqual(missing(R, E), [], "in ru but not in en");
  assert.deepEqual(missing(E, R), [], "in en but not in ru");
});

test("a translation keeps the same {placeholders} as the Russian text", () => {
  const bad = [];
  for (const [k, v] of R) if (typeof v === "string") for (const [name, M] of [["kk", K], ["en", E]]) if (holes(M.get(k)) !== holes(v)) bad.push(`${name}:${k}`);
  assert.deepEqual(bad, []);
});
