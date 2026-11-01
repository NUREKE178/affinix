// Contract check: every sentence the friendship functions raise (supabase/migrations/0017_friendships.sql) maps to a locale key
// that exists, with text, in ru / kk / en. Run:  node scripts/check-friend-errors.mjs
import { readFileSync } from "node:fs";
import { friendErrorKey } from "../src/lib/rpcErrors.js";
import ru from "../src/lib/locales/ru.js";
import kk from "../src/lib/locales/kk.js";
import en from "../src/lib/locales/en.js";

const sql = readFileSync(new URL("../supabase/migrations/0017_friendships.sql", import.meta.url), "utf8");
const sentences = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
let failed = 0;
const fail = (msg) => { failed++; console.error("FAIL " + msg); };

if (sentences.length < 6) fail(`expected the migration's raise statements, found ${sentences.length}`);
for (const s of new Set(sentences)) {
  const key = friendErrorKey({ message: s });
  if (!key) { fail(`"${s}" is raised by the database but has no friends.err.* key`); continue; }
  for (const [name, loc] of [["ru", ru], ["kk", kk], ["en", en]]) {
    const text = get(loc, key);
    if (typeof text !== "string" || !text.trim()) fail(`${key} is missing in ${name}`);
  }
}
// the English text of each key says what the database says (so the two cannot drift apart unnoticed)
for (const s of ["You are already friends.", "Friend request already sent."]) {
  if (get(en, friendErrorKey({ message: s })) !== s) fail(`en text of "${s}" changed`);
}
// things that are not friendship errors stay as they are
for (const m of ["Failed to fetch", "", undefined, "permission denied for table friendships"]) {
  if (friendErrorKey({ message: m }) !== null) fail(`"${m}" must not be mapped`);
}
if (friendErrorKey(null) !== null) fail("null must not be mapped");
// the keys of the three languages match
const keys = (o) => Object.keys(o.friends.err).sort().join();
if (keys(ru) !== keys(kk) || keys(ru) !== keys(en)) fail("friends.err differs between languages");
for (const k of ["statusUnknown"]) for (const [n, l] of [["ru", ru], ["kk", kk], ["en", en]]) if (!l.friends[k]) fail(`friends.${k} missing in ${n}`);

if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log(`ok: ${new Set(sentences).size} database sentences mapped and translated in ru, kk, en`);
