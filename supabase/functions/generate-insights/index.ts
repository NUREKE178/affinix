// POST { experiment_id }
// Authenticated (Authorization: Bearer <user jwt>, forwarded automatically
// by supabase-js when invoked via supabase.functions.invoke). Requires the
// caller to be a member of the experiment's organization.
//
// Synthesizes, rather than duplicates: the dashboard's own rule-based
// engine (src/lib/insights.js) already computes confidence-scored
// findings client-side, with confidence intervals and corroboration
// checks -- re-deriving all of that here in TypeScript would risk the AI
// quoting a number that quietly disagrees with what the researcher sees
// on the Insights page. This function independently verifies only the
// one number everything else is read against (the completed sample size
// and the primary selection question's own per-variant counts, queried
// directly -- never trusted from the caller), and adds the one thing
// nothing else in the app does at all: reading open-ended text responses
// and surfacing their themes. The model is instructed to never state a
// number it wasn't given here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/[email protected]";
import { jsonResponse, handleOptions } from "../_shared/cors.ts";

const MIN_RELIABLE_SAMPLE = 30; // kept in sync with src/lib/stats.js's own constant
const MAX_OPEN_TEXT_SAMPLES_PER_QUESTION = 40;

const INSIGHTS_SYSTEM_PROMPT = `You are a research analyst helping a marketer interpret a consumer decision experiment (an A/B/C/D variant test on a site called DecisionOS). You will be given, as JSON:
- the experiment's name and the researcher's own stated objective for running it
- a verified sample size and verified per-variant counts/percentages for the primary selection question (computed directly from the database -- always correct; never recompute, round differently, or contradict these numbers)
- up to ${MAX_OPEN_TEXT_SAMPLES_PER_QUESTION} raw open-ended text responses per open-text question in the experiment, if any exist (a sample, not necessarily the full set -- totalResponses tells you the real count)

Write, in the same language as the experiment's objective/name appear to be written in (default to Russian if unclear):
1. A short executive summary (3-6 sentences) a busy marketer can read in 30 seconds and act on -- directly tied to their stated objective, not a generic recap.
2. If open-text data was provided, a brief "what people said" section (2-4 sentences) synthesizing the recurring themes across the sampled responses. Omit this section entirely if no open-text data was given -- do not invent one.

Hard rules, no exceptions:
- Never state, imply, or round to a percentage, count, or statistic that was not given to you verbatim in the data.
- Never claim a causal "X caused/made people choose Y" relationship. Use association language only ("tended to," "was associated with," "chose more often").
- If completed sample size is below ${MIN_RELIABLE_SAMPLE}, say explicitly and plainly that the result is directional/preliminary, not decisive -- never soften or drop this warning.
- Never invent or paraphrase a participant quote that wasn't in the provided samples; when you do reference one, keep it close to the original wording.
- Plain, direct language. No statistics jargon, no hedging filler, no "as an AI" framing.`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "unauthenticated" }, 401);

    const { experiment_id } = await req.json();
    if (!experiment_id) return jsonResponse({ error: "missing_experiment_id" }, 400);

    // Client scoped to the CALLER's own JWT, so this read goes through the
    // normal RLS org-membership policies -- if they're not a member, this
    // (correctly) returns no row rather than us having to re-derive that
    // check by hand.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: experiment, error: expError } = await callerClient
      .from("experiments")
      .select("id, name, objective, research_type")
      .eq("id", experiment_id)
      .maybeSingle();

    if (expError) return jsonResponse({ error: "lookup_failed", detail: expError.message }, 500);
    if (!experiment) return jsonResponse({ error: "not_found_or_forbidden" }, 404);

    const aiKey = Deno.env.get("AI_API_KEY");

    // Service-role client only for the ai_insights write (needs to succeed
    // regardless of the caller's role tier being >= researcher, already
    // checked implicitly by the SELECT above returning a row) and for the
    // analytics queries below (same reasoning -- the caller's own RLS
    // access to `experiments` already proved org membership once).
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!aiKey) {
      const { data: row } = await adminClient
        .from("ai_insights")
        .insert({
          experiment_id,
          input_summary: { experiment: experiment.name, note: "AI_API_KEY not configured" },
          status: "not_configured",
        })
        .select()
        .single();
      return jsonResponse({
        status: "not_configured",
        message: "AI-инсайты ещё не подключены для этого проекта (нет AI_API_KEY). Настройте Edge Function secret, чтобы включить.",
        row,
      });
    }

    const analyticsContext = await buildAnalyticsContext(adminClient, experiment_id, experiment);

    if (analyticsContext.sample.completed === 0) {
      const { data: row } = await adminClient
        .from("ai_insights")
        .insert({ experiment_id, input_summary: analyticsContext, status: "failed" })
        .select()
        .single();
      return jsonResponse({
        status: "failed",
        message: "Недостаточно данных: пока ни один участник не завершил прохождение.",
        row,
      });
    }

    try {
      const anthropic = new Anthropic({ apiKey: aiKey });
      const completion = await anthropic.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 1200,
        system: INSIGHTS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(analyticsContext) }],
      });

      const textBlock = completion.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
      const insightText = textBlock?.text?.trim() ?? "";
      if (!insightText) throw new Error("empty_completion");

      const { data: row, error: insertError } = await adminClient
        .from("ai_insights")
        .insert({
          experiment_id,
          model: completion.model,
          input_summary: analyticsContext,
          output: { text: insightText },
          status: "ready",
        })
        .select()
        .single();
      if (insertError) throw insertError;

      return jsonResponse({ status: "ready", insight: insightText, row });
    } catch (err) {
      const { data: row } = await adminClient
        .from("ai_insights")
        .insert({ experiment_id, input_summary: analyticsContext, status: "failed" })
        .select()
        .single();
      return jsonResponse({
        status: "failed",
        message: "Не удалось сгенерировать AI-инсайт. Попробуйте ещё раз позже.",
        detail: String(err),
        row,
      });
    }
  } catch (err) {
    return jsonResponse({ error: "unexpected", detail: String(err) }, 500);
  }
});

/** Independently verified sample size + primary-question results (never
 * trusted from the caller), plus a capped sample of raw open-text
 * responses. Mirrors src/lib/stats.js's primarySelectionQuestion()
 * precedence (role "selection" -> first variants single_choice -> first
 * question at all) so the AI's headline number is always about the same
 * question the dashboard itself treats as primary. */
async function buildAnalyticsContext(adminClient: ReturnType<typeof createClient>, experimentId: string, experiment: { name: string; objective: string | null; research_type: string | null }) {
  const { data: sessions } = await adminClient
    .from("participant_sessions")
    .select("id, status")
    .eq("experiment_id", experimentId);
  const allSessions = sessions ?? [];
  const completedIds = allSessions.filter((s: { status: string }) => s.status === "completed").map((s: { id: string }) => s.id);

  const { data: variants } = await adminClient
    .from("experiment_variants")
    .select("id, label, name")
    .eq("experiment_id", experimentId)
    .order("position");
  const variantsById = new Map((variants ?? []).map((v: { id: string }) => [v.id, v]));

  const { data: questions } = await adminClient
    .from("experiment_questions")
    .select("id, type, applies_to, role, prompt")
    .eq("experiment_id", experimentId)
    .order("position");
  const allQuestions = questions ?? [];

  let responses: { question_id: string; variant_id: string | null; value: unknown }[] = [];
  if (completedIds.length > 0) {
    const { data } = await adminClient
      .from("responses")
      .select("question_id, variant_id, value")
      .in("session_id", completedIds);
    responses = data ?? [];
  }

  const selectionQ =
    allQuestions.find((q: { role: string | null }) => q.role === "selection") ??
    allQuestions.find((q: { applies_to: string; type: string }) => q.applies_to === "variants" && q.type === "single_choice") ??
    allQuestions[0] ??
    null;

  let primarySelectionResult = null;
  if (selectionQ) {
    const counts = new Map<string, number>();
    let n = 0;
    for (const r of responses) {
      if (r.question_id !== selectionQ.id || !r.variant_id) continue;
      counts.set(r.variant_id, (counts.get(r.variant_id) ?? 0) + 1);
      n++;
    }
    const results = [...counts.entries()]
      .map(([variantId, count]) => {
        const v = variantsById.get(variantId) as { label: string; name: string } | undefined;
        return { variant: v ? `${v.label} (${v.name})` : variantId, count, pct: n ? Math.round((count / n) * 1000) / 10 : 0 };
      })
      .sort((a, b) => b.count - a.count);
    primarySelectionResult = { question: selectionQ.prompt, n, results };
  }

  const openText = allQuestions
    .filter((q: { type: string }) => q.type === "open_text")
    .map((q: { id: string; prompt: string }) => {
      const texts = responses
        .filter((r) => r.question_id === q.id && typeof r.value === "string" && (r.value as string).trim())
        .map((r) => (r.value as string).trim());
      return { question: q.prompt, totalResponses: texts.length, samples: texts.slice(0, MAX_OPEN_TEXT_SAMPLES_PER_QUESTION) };
    })
    .filter((q: { totalResponses: number }) => q.totalResponses > 0);

  return {
    experiment: { name: experiment.name, objective: experiment.objective ?? null, researchType: experiment.research_type ?? null },
    sample: { completed: completedIds.length, started: allSessions.length, minReliable: MIN_RELIABLE_SAMPLE },
    primarySelectionResult,
    openText,
  };
}
