// A stand-in for supabaseClient.js that answers the two Styles (marketer) RPCs with made-up but stable numbers, so the page can be looked at / tested without a backend.
import { FAMILY_IDS } from "/src/lib/arena/stimuli.js";
import { stimulusKey } from "/src/lib/arena/stimuli.js";
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function rows(dim) {
  const out = [];
  for (const fam of FAMILY_IDS) for (let i = 0; i < 40; i++) {
    const n = 6 + Math.floor(rnd() * 22); const wins = Math.round(n * (0.25 + rnd() * 0.55));
    out.push([stimulusKey(fam, i), dim, wins, n - wins]);
  }
  return out;
}
export const supabase = {
  async rpc(name, args) {
    if (name === "arena_style_report") return { data: { season: args.p_season, votes: 640, voters: 43, rows: rows(args.p_dim ?? "preference") }, error: null };
    if (name === "arena_style_segments") return { data: { countries: [{ code: "KZ", voters: 21, votes: 300 }, { code: "RU", voters: 12, votes: 160 }], rows: [] }, error: null };
    if (name === "arena_reason_report") {
      const rs = ["color", "type", "layout", "clear", "trust", "mood"];
      const byReason = { color: 41, layout: 27, clear: 19, trust: 12, type: 9, mood: 6 };
      const bySpecimen = rows(args.p_dim ?? "preference").slice(0, 60).map(([stim], i) => [stim, rs[i % 6], 3 + (i % 5)]);
      return { data: { total: 114, byReason, bySpecimen }, error: null };
    }
    return { data: null, error: { message: "not stubbed", code: "PGRST202" } };
  },
};
export const requireSupabase = () => supabase;
export const IS_CONFIGURED = true;
