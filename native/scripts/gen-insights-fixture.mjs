// Records what the website's report says (src/lib/insights.js and the markdown report of src/pages/Reports.js) about the research fixture's experiment, in ru / kk / en and for
// three situations (a full sample, a thin one, no answers), so the app's port (store/ResearchInsights.kt) is tested against the real thing. Run from the repo root, after
// gen-research-fixture.mjs:   node native/scripts/gen-insights-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";

// the site's i18n imports the browser's preact: for this script it is replaced by an empty stand-in (nothing here renders)
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "preact" || spec.startsWith("preact/") || spec.endsWith("/preact.js")) {
    return { url: "data:text/javascript," + encodeURIComponent("export const useState=(v)=>[v,()=>{}];export const useEffect=()=>{};export const useRef=(v)=>({current:v});export const useMemo=(f)=>f();export const html=()=>null;export const h=()=>null;export const render=()=>{};export const Fragment=null;"), shortCircuit: true };
  }
  return next(spec, ctx);
}`), import.meta.url);

const root = new URL("../../", import.meta.url);
const { generateInsights } = await import(new URL("src/lib/insights.js", root));
const stats = await import(new URL("src/lib/stats.js", root));
const { t: translate } = await import(new URL("src/lib/i18n.js", root));
const { pct } = await import(new URL("src/lib/format.js", root));
const { researchTypeLabel } = await import(new URL("src/lib/questionTypes.js", root));

// the mappers and the markdown builder are not exported (their modules need a browser), so they are cut out of the source and evaluated here
const read = (p) => readFileSync(new URL(p, root), "utf8");
const exp = read("src/lib/experiments.js"), part = read("src/lib/participants.js"), rep = read("src/pages/Reports.js");
const mappers = new Function(`${exp.slice(exp.indexOf("function mapVariant"), exp.indexOf("const NESTED_SELECT"))}\n${part.slice(part.indexOf("function mapSession"), part.indexOf("/** All participant sessions"))}\nreturn { mapExperiment, mapSession };`)();
const buildMarkdownReport = new Function("pct", "researchTypeLabel", `${rep.slice(rep.indexOf("const DATE_LOCALE"), rep.indexOf("function downloadText"))}\nreturn buildMarkdownReport;`)(pct, researchTypeLabel);

const fx = JSON.parse(readFileSync(new URL("native/composeApp/src/desktopTest/resources/research.json", root), "utf8"));
const allSessions = fx.sessions.map(mappers.mapSession);
const scenarios = {
  full: { experiment: mappers.mapExperiment(fx.experiment), participants: allSessions },
  small: { experiment: mappers.mapExperiment(fx.experiment), participants: allSessions.slice(0, 14) },
  empty: { experiment: mappers.mapExperiment(fx.experiment), participants: [] },
  randomized: { experiment: mappers.mapExperiment({ ...fx.experiment, settings: { randomizeVariantOrder: true } }), participants: allSessions },
};

const cases = [];
for (const [scenario, { experiment, participants }] of Object.entries(scenarios)) {
  for (const locale of ["ru", "kk", "en"]) {
    const t = (key, vars) => translate(locale, key, vars);
    const insights = generateInsights(experiment, participants, locale);
    const completed = stats.completedParticipants(participants.filter((p) => p.experimentId === experiment.id));
    const selQ = stats.primarySelectionQuestion(experiment);
    const choice = selQ ? stats.choiceStatsForQuestion(experiment, completed, selQ.id) : null;
    const segments = selQ ? stats.segmentBreakdown(experiment, completed, selQ.id, "ageRange") : [];
    const summary = stats.experimentSummary(experiment, participants);
    const markdown = buildMarkdownReport(experiment, summary, choice, segments, insights, t, locale);
    cases.push({
      scenario, locale,
      insights: { whatHappened: insights.whatHappened, why: insights.whyMightHaveHappened, recommendation: { text: insights.recommendation.text, confidence: insights.recommendation.confidence }, sample: { sufficient: insights.sample.sufficient, n: insights.sample.n }, disclaimer: insights.disclaimer },
      markdown,
    });
  }
}
writeFileSync(new URL("native/composeApp/src/desktopTest/resources/insights.json", root), JSON.stringify({ smallCount: 14, cases }));
const full = cases.find((c) => c.scenario === "full" && c.locale === "en");
console.log(`insights.json: ${cases.length} cases; full/en confidence ${full.insights.recommendation.confidence}; ${full.insights.whatHappened.length} findings, ${full.insights.why.length} reasons`);
console.log(full.insights.recommendation.text);
