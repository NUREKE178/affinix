// Records what the website's analytics (src/lib/stats.js, with the row mappers of experiments.js and participants.js) says about a fixed experiment, so the app's port
// (store/ResearchStats.kt) is tested against the real thing: database-shaped rows in, the site's numbers out. Run from the repo root:
//   node native/scripts/gen-research-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { mulberry32 } from "../../src/lib/prng.js";
import * as stats from "../../src/lib/stats.js";

// the mappers are not exported (the modules need a browser), so they are cut out of the source and evaluated here
const exp = readFileSync(new URL("../../src/lib/experiments.js", import.meta.url), "utf8");
const part = readFileSync(new URL("../../src/lib/participants.js", import.meta.url), "utf8");
const mappers = new Function(`${exp.slice(exp.indexOf("function mapVariant"), exp.indexOf("const NESTED_SELECT"))}\n${part.slice(part.indexOf("function mapSession"), part.indexOf("/** All participant sessions"))}\nreturn { mapExperiment, mapSession };`)();

const rand = mulberry32(20261030);
const pick = (a) => a[Math.floor(rand() * a.length)];
const id = (p, n) => `${p}-${String(n).padStart(4, "0")}`;

const variants = ["A", "B", "C"].map((l, i) => ({ id: id("var", i), label: l, name: `Option ${l}`, description: null, asset_url: null, asset_type: null, color: ["#ff6a1a", "#4aa3ff", "#37d67a"][i], position: i }));
const opt = (labels) => labels.map((label, position) => ({ label, position }));
const q = (n, type, applies_to, role, prompt, options = [], scale = null) => ({ id: id("q", n), type, applies_to, role, prompt, scale, required: true, position: n, experiment_question_options: opt(options) });
const questions = [
  q(0, "single_choice", "variants", "selection", "Which would you choose?"),
  q(1, "rating", "variants", null, "Rate each", [], { min: 1, max: 5 }),
  q(2, "yes_no", "variants", null, "Would you buy it?"),
  q(3, "ranking", "variants", null, "Rank them"),
  q(4, "single_choice", "general", null, "How often do you shop?", ["Daily", "Weekly", "Rarely"]),
  q(5, "multiple_choice", "general", null, "Where do you see ads?", ["TV", "Social", "Street", "Mail"]),
  q(6, "price_perception", "general", null, "Fair price band?", ["< $5", "$5-10", "> $10"]),
  q(7, "price_perception", "general", null, "How much would you pay?"),
  q(8, "open_text", "general", null, "Anything else?"),
  q(9, "rating", "general", null, "Overall impression", [], { min: 1, max: 5 }),
  q(10, "yes_no", "general", null, "Would you recommend it?"),
  q(11, "single_choice", "variants", "recall", "Which one do you remember?"),
];
const expRow = {
  id: "exp-0001", organization_id: "org-1", name: "Fixture", description: null, objective: "Pick a logo", category: null, language: "en", research_type: "logo_testing", target_audience: null,
  status: "published", public_slug: "abcd2345", settings: {}, participant_settings: { targetCount: 120 }, participant_limit: 100,
  created_at: "2026-10-01T10:00:00+00:00", updated_at: "2026-10-20T10:00:00+00:00", published_at: "2026-10-02T10:00:00+00:00", created_by: "u1",
  experiment_variants: variants, experiment_questions: questions,
};

const ages = ["18-24", "25-34", "35-44", "45+"], countries = ["KZ", "RU", "US", "DE"], langs = ["ru", "kk", "en"];
const sessions = [];
for (let n = 0; n < 72; n++) {
  const r = rand();
  const status = r < 0.76 ? "completed" : r < 0.88 ? "in_progress" : "abandoned";
  const started = Date.UTC(2026, 9, 3, 8) + n * 3_600_000;
  const completed = status === "completed" ? started + (60 + Math.floor(rand() * 240)) * 1000 : null;
  const demo = rand() < 0.9 ? { ageRange: pick(ages), country: pick(countries), language: pick(langs) } : { country: pick(countries) };
  const bias = rand() < 0.55 ? 0 : Math.floor(rand() * 3); // option A is liked a bit more
  const resp = [];
  const add = (qn, value, vid = null) => { if (rand() < 0.93) resp.push({ question_id: id("q", qn), variant_id: vid, value, response_time_ms: rand() < 0.05 ? null : 800 + Math.floor(rand() * 6000), created_at: new Date(started + (qn + 1) * 5000).toISOString() }); };
  const vid = (i) => variants[i].id;
  add(0, vid(bias)); // a choice
  add(1, Object.fromEntries(variants.map((v) => [v.id, 1 + Math.floor(rand() * 5)])));
  add(2, Object.fromEntries(variants.map((v) => [v.id, rand() < 0.5])));
  add(3, [...variants.map((v) => v.id)].sort(() => rand() - 0.5));
  add(4, pick(["Daily", "Weekly", "Rarely"]));
  add(5, ["TV", "Social", "Street", "Mail"].filter(() => rand() < 0.45));
  add(6, pick(["< $5", "$5-10", "> $10"]));
  add(7, Math.round(rand() * 2000) / 100);
  add(8, pick(["nice", "too bold", "love the colour", "boring"]));
  add(9, 1 + Math.floor(rand() * 5));
  add(10, rand() < 0.6);
  add(11, vid(Math.floor(rand() * 3)));
  sessions.push({
    id: id("ses", n), experiment_id: "exp-0001", status, started_at: new Date(started).toISOString(), completed_at: completed ? new Date(completed).toISOString() : null, consent_given: true,
    variant_order: variants.map((v) => v.id), question_order: questions.map((x) => x.id), demographics: demo, responses: resp,
  });
}

const experiment = mappers.mapExperiment(expRow);
const participants = sessions.map(mappers.mapSession);
const completed = stats.completedParticipants(participants);
const sel = stats.primarySelectionQuestion(experiment);
const expected = {
  questions: experiment.questions.map((qq) => ({ id: qq.id, result: stats.statsForQuestion(experiment, completed, qq) })),
  segments: Object.fromEntries(["ageRange", "country", "language"].map((k) => [k, stats.segmentBreakdown(experiment, completed, sel.id, k)])),
  responseTime: stats.responseTimeFor(completed, sel.id),
  summary: stats.experimentSummary(experiment, participants),
  completionRate: stats.completionRate(participants),
  avgCompletionTimeMs: stats.averageCompletionTimeMs(participants),
  selectionQuestion: sel.id,
  targetCount: experiment.participantSettings.targetCount,
  completedCount: completed.length,
};
writeFileSync(new URL("../composeApp/src/desktopTest/resources/research.json", import.meta.url), JSON.stringify({ experiment: expRow, sessions, expected }));
console.log("ok:", questions.length, "questions,", sessions.length, "sessions,", completed.length, "completed; top", expected.summary.topVariant?.label, "target", expected.targetCount);
