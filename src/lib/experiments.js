import { requireSupabase } from "./supabaseClient.js";
import { deleteVariantAsset, pathFromPublicUrl } from "./storage.js";

// ---------------------------------------------------------------------------
// DB rows are snake_case; the rest of the app (builder, stats.js, pages --
// all written against the original demo data shape) expects camelCase with
// settings/participantSettings as nested objects. These mappers are the one
// place that boundary is crossed, so nothing else in the app needs to know
// the database schema's naming.
// ---------------------------------------------------------------------------

function mapVariant(row) {
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    description: row.description,
    assetUrl: row.asset_url,
    assetType: row.asset_type,
    color: row.color,
  };
}

function mapQuestion(row) {
  const options = (row.experiment_question_options ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((o) => o.label);
  return {
    id: row.id,
    type: row.type,
    appliesTo: row.applies_to,
    role: row.role,
    prompt: row.prompt,
    scale: row.scale,
    required: row.required,
    options: options.length ? options : null,
  };
}

function mapExperiment(row) {
  const variants = (row.experiment_variants ?? []).slice().sort((a, b) => a.position - b.position).map(mapVariant);
  const questions = (row.experiment_questions ?? []).slice().sort((a, b) => a.position - b.position).map(mapQuestion);
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    objective: row.objective,
    category: row.category,
    language: row.language ?? "ru",
    researchType: row.research_type,
    targetAudience: row.target_audience,
    status: row.status,
    publicSlug: row.public_slug,
    settings: row.settings ?? {},
    participantSettings: { targetCount: row.participant_limit ?? 0, ...(row.participant_settings ?? {}) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    isDemo: false,
    variants,
    questions,
  };
}

const NESTED_SELECT = `
  *,
  experiment_variants(*),
  experiment_questions(*, experiment_question_options(*))
`;

export async function fetchExperiments(orgId) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("experiments")
    .select(NESTED_SELECT)
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapExperiment);
}

export async function fetchExperiment(id) {
  const sb = requireSupabase();
  const { data, error } = await sb.from("experiments").select(NESTED_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapExperiment(data) : null;
}

function experimentPayload(orgId, draft) {
  return {
    organization_id: orgId,
    name: draft.name,
    description: draft.description || null,
    objective: draft.objective || null,
    category: draft.category || null,
    research_type: draft.researchType || null,
    target_audience: draft.targetAudience || null,
    status: draft.status,
    settings: draft.settings,
    participant_settings: draft.participantSettings,
    participant_limit: draft.participantSettings?.targetCount || null,
  };
}

/** Creates or updates an experiment's own row, then fully replaces its
 * variants/questions/options with the current draft contents. Safe while
 * drafting (status='draft'); once published, responses reference specific
 * variant/question ids, so this delete+reinsert sync path is only used by
 * the builder for experiments that are still drafts -- publishExperiment()
 * is a separate, additive-only step. */
export async function saveExperimentDraft(orgId, draft) {
  const sb = requireSupabase();
  const payload = experimentPayload(orgId, draft);

  const { data: existing } = await sb.from("experiments").select("id").eq("id", draft.id).maybeSingle();
  if (existing) {
    const { error } = await sb.from("experiments").update(payload).eq("id", draft.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("experiments").insert({ id: draft.id, ...payload });
    if (error) throw error;
  }

  await sb.from("experiment_variants").delete().eq("experiment_id", draft.id);
  await sb.from("experiment_questions").delete().eq("experiment_id", draft.id);

  if (draft.variants.length) {
    const { error } = await sb.from("experiment_variants").insert(
      draft.variants.map((v, i) => ({
        id: v.id,
        experiment_id: draft.id,
        label: v.label,
        name: v.name,
        description: v.description || null,
        asset_url: v.assetUrl || null,
        asset_type: v.assetType || null,
        color: v.color || null,
        position: i,
      }))
    );
    if (error) throw error;
  }

  for (let i = 0; i < draft.questions.length; i++) {
    const q = draft.questions[i];
    const { error: qError } = await sb.from("experiment_questions").insert({
      id: q.id,
      experiment_id: draft.id,
      type: q.type,
      applies_to: q.appliesTo,
      role: q.role,
      prompt: q.prompt,
      scale: q.scale,
      required: q.required ?? true,
      position: i,
    });
    if (qError) throw qError;
    if (q.options?.length) {
      const { error: oError } = await sb
        .from("experiment_question_options")
        .insert(q.options.map((label, pos) => ({ question_id: q.id, label, position: pos })));
      if (oError) throw oError;
    }
  }

  return fetchExperiment(draft.id);
}

function slugify() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function publishExperiment(id) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("experiments")
    .update({ status: "published", public_slug: slugify(), published_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateExperimentStatus(id, status) {
  const sb = requireSupabase();
  const { error } = await sb.from("experiments").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteExperiment(experiment) {
  const sb = requireSupabase();
  for (const v of experiment.variants) {
    const path = pathFromPublicUrl(v.assetUrl);
    if (path) await deleteVariantAsset(path);
  }
  const { error } = await sb.from("experiments").delete().eq("id", experiment.id);
  if (error) throw error;
}

export async function duplicateExperiment(orgId, experiment) {
  const copy = {
    ...experiment,
    id: crypto.randomUUID(),
    name: `${experiment.name} (копия)`,
    status: "draft",
    publicSlug: null,
    variants: experiment.variants.map((v) => ({ ...v, id: crypto.randomUUID() })),
    questions: experiment.questions.map((q) => ({ ...q, id: crypto.randomUUID() })),
  };
  return saveExperimentDraft(orgId, copy);
}


async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
