// Records what the live dealer really answers (the Vercel handler api/arena-deal.mjs, called the way Vercel calls it, whole HTTP body) for 28 daily challenges,
// the 5 extra sets and 20 free rounds, so the app's decoder is tested against the true wire format. Run from the repo root:  node native/scripts/gen-deal-fixture.mjs
import handler from "../../api/arena-deal.mjs";
import { writeFileSync } from "node:fs";

function call(req) {
  let out = { status: 0, body: null };
  const res = { setHeader() {}, status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  return handler(req, res).then(() => out);
}
const season = (d) => d.slice(0, 4) + d.slice(5, 7);
const cases = [];
for (let i = 1; i <= 28; i++) { const day = "2026-10-" + String(i).padStart(2, "0"); cases.push({ k: "daily " + day, req: { method: "GET", query: { kind: "daily", day, season: season(day) } } }); }
for (let n = 2; n <= 6; n++) cases.push({ k: "set " + n, req: { method: "GET", query: { kind: "set", n: String(n), day: "2026-10-30", season: "202610" } } });
for (let s = 1; s <= 15; s++) cases.push({ k: "free " + s, req: { method: "POST", query: {}, body: { kind: "free", day: "2026-10-30", season: "202610", seed: s * 7919, seen: [], recent: [] } } });
for (let s = 1; s <= 5; s++) cases.push({ k: "free-eye " + s, req: { method: "POST", query: {}, body: { kind: "free", day: "2026-10-30", season: "202610", seed: s * 104729, seen: [], recent: [], focus: { eye: true, unseenFamilies: ["mark", "card"], unseenDims: ["trust"] } } } });
const out = [];
for (const c of cases) { const r = await call(c.req); if (r.status !== 200) throw new Error(c.k + " -> " + r.status); out.push({ k: c.k, v: r.body }); }
writeFileSync(new URL("../composeApp/src/desktopTest/resources/deals.json", import.meta.url), JSON.stringify(out));
console.log(out.length, "responses,", out.reduce((n, c) => n + c.v.duels.length, 0), "duels; top-level keys:", Object.keys(out[0].v).join(","));
