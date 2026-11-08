import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Preact prints a number: `${set && html`...`}` with set = 0 puts a bare "0" on the screen (it did, under the stats of every
// round summary). A condition on a count must be a boolean: `${set > 0 && ...}`. This scans the sources for the usual
// count-like names used as a bare condition before html`...`.
const COUNTISH = ["set", "n", "count", "total", "votes", "streak", "level", "xp", "idx", "index", "length"];
const RE = new RegExp("\\$\\{\\s*(?:[\\w.]*\\.)?(" + COUNTISH.join("|") + ")\\s*&&\\s*html`", "g");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith(".js")) yield p;
  }
}

test("no count is used as a bare condition in a template (it would print 0)", () => {
  const hits = [];
  for (const f of files(new URL("../src", import.meta.url).pathname)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(RE)) hits.push(`${f.split("/src/")[1]}:${src.slice(0, m.index).split("\n").length}  ${m[0]}`);
  }
  assert.deepEqual(hits, []);
});
