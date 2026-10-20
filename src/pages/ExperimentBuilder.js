import { html, useState, useEffect, useMemo, useRef } from "../lib/preact.js";
import { useThumb } from "../lib/thumb.js";
import { navigate } from "../router.js";
import { fetchExperiment, saveExperimentDraft, publishExperiment } from "../lib/experiments.js";
import { withTimeout } from "../lib/async.js";
import { uploadVariantAsset, deleteVariantAsset, pathFromPublicUrl } from "../lib/storage.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { invalidateExperiments } from "../lib/experimentsStore.js";
import {
  Card, SectionHeading, Button, Field, TextInput, TextArea, Select, Checkbox, Switch, Badge, EmptyState, LoadingState, toast,
} from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { researchTypes, questionTypes, typeSupportsVariants, measurementDimensions, questionFromDimension, AGE_RANGES, COUNTRIES, LANGUAGES, INFLUENCE_FACTORS } from "../lib/questionTypes.js";
import { suggestDimensions } from "../lib/questionSuggestions.js";
import { ParticipantRunner } from "./ParticipantRunner.js";
import { useT, useLocale } from "../lib/i18n.js";

const uid = () => crypto.randomUUID();

const STEP_IDS = [1, 2, 3, 4, 5, 6, 7];
const STEP_KEYS = {
  1: "info", 2: "researchType", 3: "stimuli", 4: "questions", 5: "participants", 6: "settings", 7: "preview",
};

const VARIANT_LABELS = ["A", "B", "C", "D"];

function emptyExperiment() {
  return {
    id: uid(),
    isDemo: false,
    status: "draft",
    name: "",
    objective: "",
    category: "",
    targetAudience: "",
    description: "",
    researchType: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "You",
    variants: [
      { id: uid(), label: "A", name: "", description: "", assetType: "image", assetUrl: null },
      { id: uid(), label: "B", name: "", description: "", assetType: "image", assetUrl: null },
    ],
    questions: [],
    participantSettings: {
      targetCount: 100,
      ageRange: ["18-24", "65+"],
      countries: [],
      languages: [],
      demographicQuestions: ["ageRange", "country", "language"],
    },
    settings: {
      randomizeVariantOrder: true,
      randomizeQuestionOrder: false,
      timeLimitSeconds: null,
      anonymous: true,
      requireConsent: true,
      preventDuplicates: true,
    },
  };
}

function emptyQuestion(type = "single_choice") {
  return {
    id: uid(),
    type,
    appliesTo: type === "single_choice" || type === "rating" || type === "yes_no" || type === "ranking" || type === "recall" ? "variants" : "general",
    role: null,
    prompt: "",
    options: type === "single_choice" || type === "multiple_choice" ? [...INFLUENCE_FACTORS] : null,
    scale: type === "rating" ? { min: 1, max: 5 } : null,
    required: true,
  };
}

/** Whether `draft` satisfies step `n`'s own requirement -- the single
 * source of truth for both the Continue button's disabled state and
 * whether jumping to a step tab is allowed. Steps with no hard
 * requirement (5-7) are always valid. */
function stepIsValid(n, draft) {
  // `?? ""`: a draft saved half-way (Save & exit on step 1) comes back from the database with null text fields.
  if (n === 1) return (draft.name ?? "").trim().length > 0 && (draft.objective ?? "").trim().length > 0;
  if (n === 2) return !!draft.researchType;
  if (n === 3) return draft.variants.filter((v) => (v.name ?? "").trim()).length >= 2;
  if (n === 4) return draft.questions.length >= 1;
  return true;
}

export function ExperimentBuilder({ params }) {
  const t = useT();
  const editingId = params?.id ?? null;
  const { org, loading: orgLoading } = useCurrentOrg();
  const [draft, setDraft] = useState(() => ({ ...emptyExperiment(), id: editingId ?? uid() }));
  const [loadingExisting, setLoadingExisting] = useState(!!editingId);
  const [loadError, setLoadError] = useState(null); // null | "not_found" | <error message>
  const [retryTick, setRetryTick] = useState(0);
  const [step, setStep] = useState(1);
  const stepsHost = useRef(null);
  const stepsThumb = useRef(null);
  useThumb(stepsHost, stepsThumb, step);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    setLoadingExisting(true);
    setLoadError(null);
    withTimeout(fetchExperiment(editingId), 15000)
      .then((existing) => {
        if (cancelled) return;
        if (existing) setDraft(existing);
        else setLoadError("not_found"); // real row, found nothing -- not an empty new draft
        setLoadingExisting(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message ?? String(err));
        setLoadingExisting(false);
      });
    return () => { cancelled = true; };
  }, [editingId, retryTick]);

  function patch(fields) {
    setDraft((d) => ({ ...d, ...fields }));
    setSaved(false);
  }

  async function persist(extra = {}) {
    const toSave = { ...draft, ...extra };
    setSaving(true);
    try {
      const result = await saveExperimentDraft(org.id, toSave);
      setDraft(result);
      setSaved(true);
      invalidateExperiments();
      return result;
    } catch (err) {
      toast(err.message ?? String(err), "rose");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  // Jumping forward (via a step tab, or next()) is blocked by any
  // not-yet-satisfied step in between -- previously only the Continue
  // button's disabled state enforced this, so clicking a step tab
  // directly skipped the check entirely. Moving to the current step or
  // backward is always allowed (nothing to validate going back).
  async function goTo(n) {
    if (n > step) {
      for (let i = step; i < n; i++) {
        if (!stepIsValid(i, draft)) {
          toast(t("builder.incompleteStepToast"), "rose");
          return;
        }
      }
    }
    try { await persist(); setStep(n); } catch { /* error already toasted */ }
  }
  function next() { goTo(Math.min(7, step + 1)); }
  function back() { goTo(Math.max(1, step - 1)); }

  async function publish() {
    try {
      const saved = await persist();
      await publishExperiment(saved.id);
      invalidateExperiments();
      toast(t("builder.published"));
      navigate(`/app/experiments/${saved.id}/results`);
    } catch { /* error already toasted */ }
  }

  const canAdvance = useMemo(() => stepIsValid(step, draft), [draft, step]);

  if (orgLoading || loadingExisting) {
    return html`<${LoadingState} label=${t("common.loading")} />`;
  }

  if (loadError === "not_found") {
    return html`<${EmptyState}
      title=${t("builder.notFoundTitle")}
      body=${t("builder.notFoundBody")}
      icon="experiments"
      action=${html`<${Button} onClick=${() => navigate("/app/experiments")}>${t("builder.backToList")}<//>`}
    />`;
  }
  if (loadError) {
    return html`<${EmptyState}
      title=${t("builder.loadErrorTitle")}
      body=${t("builder.loadErrorBody")}
      icon="shield"
      action=${html`<${Button} onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}<//>`}
    />`;
  }

  return html`
    <div class="fade-in max-w-5xl">
      <${SectionHeading}
        title=${editingId ? t("builder.titleEdit") : t("builder.titleNew")}
        subtitle=${t("builder.subtitle")}
        action=${html`
          <div class="flex items-center gap-2">
            ${saved && html`<${Badge} tone="emerald">${t("builder.savedDraft")}<//>`}
            <${Button} variant="secondary" size="sm" loading=${saving} onClick=${async () => { await persist(); navigate("/app/experiments"); }}>${t("builder.saveAndExit")}<//>
          </div>
        `}
      />

      <div class="sk-display sk-thumbhost flex items-center gap-0.5 overflow-x-auto p-1.5 mb-6 rounded-xl" data-compact="true" ref=${stepsHost}>
        <span class="sk-thumb" ref=${stepsThumb} aria-hidden="true"></span>
        ${STEP_IDS.map(
          (id, i) => html`
            <div key=${id} class="flex items-center">
              <button
                onClick=${() => goTo(id)}
                data-active=${step === id}
                class=${`sk-tab flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap ${
                  step === id ? "text-white" : step > id ? "text-emerald-400" : "text-graphite-500"
                }`}
              >
                <span class=${`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step === id ? "bg-white/20" : "bg-black/30"}`}>
                  ${step > id ? html`<${Icon} name="check" size=${11} /> ` : id}
                </span>
                ${t(`builder.steps.${STEP_KEYS[id]}`)}
              </button>
              ${i < STEP_IDS.length - 1 && html`<div class="w-2 h-px bg-black/40"></div>`}
            </div>
          `
        )}
      </div>

      <${Card} className="p-5 sm:p-7">
        ${step === 1 && html`<${StepInfo} draft=${draft} patch=${patch} t=${t} />`}
        ${step === 2 && html`<${StepResearchType} draft=${draft} patch=${patch} t=${t} />`}
        ${step === 3 && html`<${StepStimuli} draft=${draft} patch=${patch} orgId=${org.id} t=${t} />`}
        ${step === 4 && html`<${StepQuestions} draft=${draft} patch=${patch} t=${t} />`}
        ${step === 5 && html`<${StepParticipants} draft=${draft} patch=${patch} t=${t} />`}
        ${step === 6 && html`<${StepSettings} draft=${draft} patch=${patch} t=${t} />`}
        ${step === 7 && html`<${StepPreview} draft=${draft} onPublish=${publish} t=${t} />`}

        <div class="flex items-center justify-between mt-8 pt-5 border-t border-black/40">
          <${Button} variant="ghost" onClick=${back} disabled=${step === 1 || saving}><${Icon} name="chevronLeft" size=${16}/> ${t("common.back")}<//>
          ${step < 7
            ? html`<${Button} onClick=${next} loading=${saving} disabled=${!canAdvance}>${saving ? t("common.saving") : t("common.continue")} ${!saving && html`<${Icon} name="chevronRight" size=${16}/>`}<//>`
            : html`<${Button} variant="primary" onClick=${publish} loading=${saving}>${!saving && html`<${Icon} name="play" size=${16}/>`} ${saving ? t("builder.publishing") : t("builder.publishButton")}<//>`}
        </div>
      <//>
    </div>
  `;
}

// ---- Step 1: Information --------------------------------------------------
function StepInfo({ draft, patch, t }) {
  return html`
    <div>
      <${Field} label=${t("builder.step1.nameLabel")} required>
        <${TextInput} value=${draft.name} placeholder=${t("builder.step1.namePlaceholder")} onInput=${(e) => patch({ name: e.target.value })} />
      <//>
      <${Field} label=${t("builder.step1.objectiveLabel")} required hint=${t("builder.step1.objectiveHint")}>
        <${TextArea} value=${draft.objective} placeholder=${t("builder.step1.objectivePlaceholder")} onInput=${(e) => patch({ objective: e.target.value })} />
      <//>
      <div class="grid sm:grid-cols-2 gap-x-4">
        <${Field} label=${t("builder.step1.categoryLabel")}>
          <${TextInput} value=${draft.category} placeholder=${t("builder.step1.categoryPlaceholder")} onInput=${(e) => patch({ category: e.target.value })} />
        <//>
        <${Field} label=${t("builder.step1.audienceLabel")}>
          <${TextInput} value=${draft.targetAudience} placeholder=${t("builder.step1.audiencePlaceholder")} onInput=${(e) => patch({ targetAudience: e.target.value })} />
        <//>
      </div>
      <${Field} label=${t("builder.step1.descriptionLabel")} hint=${t("builder.step1.descriptionHint")}>
        <${TextArea} value=${draft.description} onInput=${(e) => patch({ description: e.target.value })} />
      <//>
    </div>
  `;
}

// ---- Step 2: Research type -------------------------------------------------
function StepResearchType({ draft, patch, t }) {
  return html`
    <div>
      <p class="text-sm text-graphite-400 mb-4">${t("builder.step2.intro")}</p>
      <div class="grid sm:grid-cols-2 gap-3">
        ${researchTypes(t).map(
          (rt) => html`
            <button key=${rt.id} onClick=${() => patch({ researchType: rt.id })}
              data-selected=${draft.researchType === rt.id}
              class="sk-slot text-left rounded-xl p-4">
              <div class="font-medium text-graphite-100 text-sm">${rt.label}</div>
              <div class="text-xs text-graphite-500 mt-1">${rt.blurb}</div>
            </button>
          `
        )}
      </div>
    </div>
  `;
}

// ---- Step 3: Stimuli / variants --------------------------------------------
function StepStimuli({ draft, patch, orgId, t }) {
  const [uploadingId, setUploadingId] = useState(null);
  const ASSET_TYPES = [
    { value: "image", label: t("builder.step3.assetTypes.image") },
    { value: "video", label: t("builder.step3.assetTypes.video") },
    { value: "design", label: t("builder.step3.assetTypes.design") },
    { value: "ad", label: t("builder.step3.assetTypes.ad") },
    { value: "logo", label: t("builder.step3.assetTypes.logo") },
    { value: "screenshot", label: t("builder.step3.assetTypes.screenshot") },
  ];

  function updateVariant(id, fields) {
    patch({ variants: draft.variants.map((v) => (v.id === id ? { ...v, ...fields } : v)) });
  }
  function addVariant() {
    if (draft.variants.length >= 4) return;
    const label = VARIANT_LABELS[draft.variants.length];
    patch({ variants: [...draft.variants, { id: uid(), label, name: "", description: "", assetType: "image", assetUrl: null }] });
  }
  function removeVariant(id) {
    if (draft.variants.length <= 2) return;
    const removed = draft.variants.find((v) => v.id === id);
    if (removed?.assetUrl) { const p = pathFromPublicUrl(removed.assetUrl); if (p) deleteVariantAsset(p); }
    const remaining = draft.variants.filter((v) => v.id !== id).map((v, i) => ({ ...v, label: VARIANT_LABELS[i] }));
    patch({ variants: remaining });
  }
  async function onFile(id, file) {
    if (!file) return;
    setUploadingId(id);
    try {
      const previous = draft.variants.find((v) => v.id === id)?.assetUrl;
      const { url } = await uploadVariantAsset({ orgId, experimentId: draft.id, file });
      updateVariant(id, { assetUrl: url });
      if (previous) { const p = pathFromPublicUrl(previous); if (p) deleteVariantAsset(p); }
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setUploadingId(null);
    }
  }

  return html`
    <div>
      <p class="text-sm text-graphite-400 mb-4">${t("builder.step3.intro")}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${draft.variants.map(
          (v) => html`
            <div key=${v.id} class="sk-slot rounded-xl p-4">
              <div class="flex items-center justify-between mb-3">
                <span class="sk-slot-label flex h-6 w-6 items-center justify-center rounded-md text-white text-xs font-bold">${v.label}</span>
                ${draft.variants.length > 2 && html`<button onClick=${() => removeVariant(v.id)} class="text-graphite-500 hover:text-rose-400"><${Icon} name="trash" size=${14} /></button>`}
              </div>

              <label class="sk-display flex flex-col items-center justify-center rounded-lg h-28 mb-3 cursor-pointer overflow-hidden">
                ${uploadingId === v.id
                  ? html`<span class="text-xs text-graphite-500">${t("builder.step3.uploading")}</span>`
                  : v.assetUrl
                  ? html`<img src=${v.assetUrl} class="h-full w-full object-cover" />`
                  : html`<${Icon} name="upload" size=${18} className="text-graphite-500" /><span class="text-xs text-graphite-500 mt-1">${t("builder.step3.uploadLabel")}</span>`}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" disabled=${uploadingId === v.id} onChange=${(e) => onFile(v.id, e.target.files?.[0])} />
              </label>

              <${TextInput} className="mb-2" placeholder=${t("builder.step3.variantName")} value=${v.name} onInput=${(e) => updateVariant(v.id, { name: e.target.value })} />
              <${TextInput} className="mb-2" placeholder=${t("builder.step3.variantDescription")} value=${v.description} onInput=${(e) => updateVariant(v.id, { description: e.target.value })} />
              <${Select} options=${ASSET_TYPES} value=${v.assetType} onChange=${(e) => updateVariant(v.id, { assetType: e.target.value })} />
            </div>
          `
        )}
      </div>
      ${draft.variants.length < 4 && html`
        <button onClick=${addVariant} class="mt-4 flex items-center gap-1.5 text-sm text-signal-400 hover:text-signal-300">
          <${Icon} name="plus" size=${15} /> ${t("builder.step3.addVariant", { label: VARIANT_LABELS[draft.variants.length] })}
        </button>
      `}
    </div>
  `;
}

// ---- Step 4: Questions ------------------------------------------------------
function StepQuestions({ draft, patch, t }) {
  const locale = useLocale();
  function update(id, fields) {
    patch({ questions: draft.questions.map((q) => (q.id === id ? { ...q, ...fields } : q)) });
  }
  function add() {
    patch({ questions: [...draft.questions, emptyQuestion()] });
  }
  function remove(id) {
    patch({ questions: draft.questions.filter((q) => q.id !== id) });
  }
  function move(id, dir) {
    const idx = draft.questions.findIndex((q) => q.id === id);
    const target = idx + dir;
    if (target < 0 || target >= draft.questions.length) return;
    const list = draft.questions.slice();
    [list[idx], list[target]] = [list[target], list[idx]];
    patch({ questions: list });
  }
  function addDimension(id) {
    const q = questionFromDimension(id, uid);
    if (q) patch({ questions: [...draft.questions, q] });
  }
  const presentRoles = new Set(draft.questions.map((q) => q.role).filter(Boolean));
  // Rule-based only: a fixed keyword list per dimension (lib/questionSuggestions.js),
  // substring-matched against what the researcher already typed in step 1.
  // No model call -- the matched keyword is kept so the tooltip can show
  // exactly why a chip is highlighted, instead of asking for trust in a
  // black box.
  const suggestions = useMemo(
    () => suggestDimensions(`${draft.objective} ${draft.category}`, locale),
    [draft.objective, draft.category, locale]
  );
  const suggestionByDimension = new Map(suggestions.map((s) => [s.dimensionId, s.matchedKeyword]));
  const ROLE_OPTIONS = [
    { value: "", label: t("builder.step4.roleNone") },
    { value: "selection", label: t("builder.step4.roleSelection") },
    { value: "attention", label: t("builder.step4.roleAttention") },
    { value: "trust", label: t("builder.step4.roleTrust") },
    { value: "quality", label: t("builder.step4.roleQuality") },
    { value: "premium", label: t("builder.step4.rolePremium") },
    { value: "clarity", label: t("builder.step4.roleClarity") },
    { value: "purchase_intention", label: t("builder.step4.rolePurchaseIntention") },
    { value: "influence", label: t("builder.step4.roleInfluence") },
    { value: "recall", label: t("builder.step4.roleRecall") },
  ];

  return html`
    <div>
      <p class="text-sm text-graphite-400 mb-4">${t("builder.step4.intro")}</p>

      <div class="sk-panel-flat rounded-xl p-4 mb-5">
        <p class="text-xs text-graphite-500 mb-3">${t("builder.dimensions.intro")}</p>
        ${suggestionByDimension.size > 0 && html`
          <p class="text-xs sk-suggest-hint mb-3">${t("builder.dimensions.suggestedIntro")}</p>
        `}
        <div class="flex flex-wrap gap-2">
          ${measurementDimensions(t).map((d) => {
            const already = presentRoles.has(d.role);
            const matchedKeyword = suggestionByDimension.get(d.id);
            const suggested = !already && !!matchedKeyword;
            const title = suggested ? `${d.blurb} — ${t("builder.dimensions.suggestedBadge")}: "${matchedKeyword}"` : d.blurb;
            return html`
              <button key=${d.id} type="button" onClick=${() => addDimension(d.id)} title=${title}
                class=${`sk-slot flex items-center gap-1.5 rounded-lg pl-2.5 pr-3 py-2 text-xs font-medium text-graphite-200 ${suggested ? "sk-suggested" : ""}`}>
                <${Icon} name=${d.icon} size=${14} className=${already ? "text-signal-400" : suggested ? "text-amber-400" : "text-graphite-400"} />
                ${d.label}
                ${already && html`<${Icon} name="check" size=${11} className="text-signal-400" />`}
                ${suggested && html`<span class="sk-suggest-badge">${t("builder.dimensions.suggestedBadge")}</span>`}
              </button>
            `;
          })}
        </div>
      </div>

      <div class="space-y-3">
        ${draft.questions.map(
          (q, i) => html`
            <div key=${q.id} class="sk-panel-flat rounded-xl p-4">
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs font-mono text-graphite-500 w-5">${i + 1}.</span>
                <div class="flex-1"><${TextInput} placeholder=${t("builder.step4.promptPlaceholder")} value=${q.prompt} onInput=${(e) => update(q.id, { prompt: e.target.value })} /></div>
                <button onClick=${() => move(q.id, -1)} class="p-1.5 text-graphite-500 hover:text-graphite-200 disabled:opacity-30" disabled=${i === 0}><${Icon} name="chevronLeft" size=${14} className="rotate-90" /></button>
                <button onClick=${() => move(q.id, 1)} class="p-1.5 text-graphite-500 hover:text-graphite-200 disabled:opacity-30" disabled=${i === draft.questions.length - 1}><${Icon} name="chevronRight" size=${14} className="rotate-90" /></button>
                <button onClick=${() => remove(q.id)} class="p-1.5 text-graphite-500 hover:text-rose-400"><${Icon} name="trash" size=${14} /></button>
              </div>
              <div class="grid sm:grid-cols-3 gap-3 pl-7">
                <${Select} options=${questionTypes(t).map((qt) => ({ value: qt.id, label: qt.label }))} value=${q.type}
                  onChange=${(e) => update(q.id, emptyQuestionPatch(q, e.target.value))} />
                <${Select} options=${[{ value: "variants", label: t("builder.step4.appliesToVariants") }, { value: "general", label: t("builder.step4.appliesToGeneral") }]}
                  value=${q.appliesTo} onChange=${(e) => update(q.id, { appliesTo: e.target.value })} disabled=${!typeSupportsVariants(q.type)} />
                <${Select} options=${ROLE_OPTIONS}
                  value=${q.role ?? ""} onChange=${(e) => update(q.id, { role: e.target.value || null })} />
              </div>
              ${(q.type === "single_choice" || q.type === "multiple_choice") && q.appliesTo === "general" && html`
                <div class="pl-7 mt-3">
                  <${Field} label=${t("builder.step4.optionsLabel")}>
                    <${TextInput} value=${(q.options ?? []).join(", ")} onInput=${(e) => update(q.id, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  <//>
                </div>
              `}
              ${q.type === "rating" && html`
                <div class="pl-7 mt-3 flex items-center gap-2 text-sm text-graphite-400">
                  ${t("builder.step4.scalePrefix")}
                  <${Select} options=${["5", "7", "10"]} value=${String(q.scale?.max ?? 5)} onChange=${(e) => update(q.id, { scale: { min: 1, max: Number(e.target.value) } })} />
                </div>
              `}
              ${q.type === "price_perception" && html`
                <div class="pl-7 mt-3">
                  <${Field} label=${t("builder.step4.priceOptionsLabel")}>
                    <${TextInput} value=${(q.options ?? []).join(", ")} onInput=${(e) => update(q.id, { options: e.target.value.trim() ? e.target.value.split(",").map((s) => s.trim()) : null })} />
                  <//>
                </div>
              `}
            </div>
          `
        )}
      </div>
      <button onClick=${add} class="mt-4 flex items-center gap-1.5 text-sm text-signal-400 hover:text-signal-300">
        <${Icon} name="plus" size=${15} /> ${t("builder.step4.addQuestion")}
      </button>
    </div>
  `;
}
function emptyQuestionPatch(q, newType) {
  const fresh = emptyQuestion(newType);
  return { type: newType, appliesTo: fresh.appliesTo, options: fresh.options, scale: fresh.scale };
}

// ---- Step 5: Participant settings ------------------------------------------
function StepParticipants({ draft, patch, t }) {
  const ps = draft.participantSettings;
  function updatePs(fields) { patch({ participantSettings: { ...ps, ...fields } }); }
  function toggleDemo(key) {
    const has = ps.demographicQuestions.includes(key);
    updatePs({ demographicQuestions: has ? ps.demographicQuestions.filter((k) => k !== key) : [...ps.demographicQuestions, key] });
  }
  return html`
    <div>
      <div class="grid sm:grid-cols-2 gap-x-4">
        <${Field} label=${t("builder.step5.targetCountLabel")} required>
          <${TextInput} type="number" min="1" value=${ps.targetCount} onInput=${(e) => updatePs({ targetCount: Number(e.target.value) || 0 })} />
        <//>
        <${Field} label=${t("builder.step5.ageRangeLabel")}>
          <div class="flex items-center gap-2">
            <${Select} options=${AGE_RANGES} value=${ps.ageRange[0]} onChange=${(e) => updatePs({ ageRange: [e.target.value, ps.ageRange[1]] })} />
            <span class="text-graphite-500">${t("builder.step5.ageRangeTo")}</span>
            <${Select} options=${AGE_RANGES} value=${ps.ageRange[1]} onChange=${(e) => updatePs({ ageRange: [ps.ageRange[0], e.target.value] })} />
          </div>
        <//>
      </div>

      <${Field} label=${t("builder.step5.countriesLabel")} hint=${t("builder.step5.countriesHint")}>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          ${COUNTRIES.map(
            (c) => html`<${Checkbox} key=${c} label=${c} checked=${ps.countries.includes(c)}
              onChange=${() => updatePs({ countries: ps.countries.includes(c) ? ps.countries.filter((x) => x !== c) : [...ps.countries, c] })} />`
          )}
        </div>
      <//>

      <${Field} label=${t("builder.step5.languagesLabel")} hint=${t("builder.step5.languagesHint")}>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          ${LANGUAGES.map(
            (l) => html`<${Checkbox} key=${l} label=${l} checked=${ps.languages.includes(l)}
              onChange=${() => updatePs({ languages: ps.languages.includes(l) ? ps.languages.filter((x) => x !== l) : [...ps.languages, l] })} />`
          )}
        </div>
      <//>

      <${Field} label=${t("builder.step5.demographicLabel")} hint=${t("builder.step5.demographicHint")}>
        <div class="flex flex-wrap gap-x-5">
          <${Checkbox} label=${t("builder.step5.demoAge")} checked=${ps.demographicQuestions.includes("ageRange")} onChange=${() => toggleDemo("ageRange")} />
          <${Checkbox} label=${t("builder.step5.demoCountry")} checked=${ps.demographicQuestions.includes("country")} onChange=${() => toggleDemo("country")} />
          <${Checkbox} label=${t("builder.step5.demoLanguage")} checked=${ps.demographicQuestions.includes("language")} onChange=${() => toggleDemo("language")} />
        </div>
      <//>
    </div>
  `;
}

// ---- Step 6: Experiment settings -------------------------------------------
function StepSettings({ draft, patch, t }) {
  const s = draft.settings;
  function update(fields) { patch({ settings: { ...s, ...fields } }); }
  return html`
    <div class="divide-y divide-graphite-800">
      <${Switch} label=${t("builder.step6.randomizeVariants")} checked=${s.randomizeVariantOrder} onChange=${(v) => update({ randomizeVariantOrder: v })} />
      <${Switch} label=${t("builder.step6.randomizeQuestions")} checked=${s.randomizeQuestionOrder} onChange=${(v) => update({ randomizeQuestionOrder: v })} />
      <${Switch} label=${t("builder.step6.anonymous")} checked=${s.anonymous} onChange=${(v) => update({ anonymous: v })} />
      <${Switch} label=${t("builder.step6.requireConsent")} checked=${s.requireConsent} onChange=${(v) => update({ requireConsent: v })} />
      <${Switch} label=${t("builder.step6.preventDuplicates")} checked=${s.preventDuplicates} onChange=${(v) => update({ preventDuplicates: v })} />
      <div class="py-3">
        <${Checkbox} label=${t("builder.step6.timeLimitLabel")} checked=${s.timeLimitSeconds != null}
          onChange=${(e) => update({ timeLimitSeconds: e.target.checked ? 60 : null })} />
        ${s.timeLimitSeconds != null && html`
          <div class="mt-2 pl-6 flex items-center gap-2 text-sm text-graphite-400">
            <${TextInput} type="number" min="5" className="w-24" value=${s.timeLimitSeconds} onInput=${(e) => update({ timeLimitSeconds: Number(e.target.value) || 60 })} />
            ${t("builder.step6.timeLimitSuffix")}
          </div>
        `}
      </div>
    </div>
  `;
}

// ---- Step 7: Preview --------------------------------------------------------
function StepPreview({ draft, onPublish, t }) {
  const [showRunner, setShowRunner] = useState(false);
  const randomizedParts = [
    draft.settings.randomizeVariantOrder ? t("builder.step7.randomizedVariants") : "",
    draft.settings.randomizeQuestionOrder ? t("builder.step7.randomizedQuestions") : "",
  ].filter(Boolean);
  const randomizedOrderText = randomizedParts.length ? randomizedParts.join(" + ") : t("builder.step7.randomizedOff");
  return html`
    <div>
      <div class="grid sm:grid-cols-2 gap-5">
        <div>
          <h3 class="font-semibold text-graphite-100">${draft.name || t("builder.step7.untitled")}</h3>
          <p class="text-sm text-graphite-400 mt-1">${draft.objective}</p>
          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-graphite-500">${t("builder.step7.researchType")}</dt><dd class="text-graphite-200">${draft.researchType || "—"}</dd></div>
            <div class="flex justify-between"><dt class="text-graphite-500">${t("builder.step7.variants")}</dt><dd class="text-graphite-200">${draft.variants.length}</dd></div>
            <div class="flex justify-between"><dt class="text-graphite-500">${t("builder.step7.questions")}</dt><dd class="text-graphite-200">${draft.questions.length}</dd></div>
            <div class="flex justify-between"><dt class="text-graphite-500">${t("builder.step7.targetParticipants")}</dt><dd class="text-graphite-200">${draft.participantSettings.targetCount}</dd></div>
            <div class="flex justify-between"><dt class="text-graphite-500">${t("builder.step7.randomizedOrder")}</dt><dd class="text-graphite-200">${randomizedOrderText}</dd></div>
          </dl>
        </div>
        <div class="sk-panel-flat rounded-xl p-4">
          <div class="text-sm font-medium text-graphite-200 mb-2">${t("builder.step7.beforePublish")}</div>
          <ul class="text-sm text-graphite-500 space-y-1.5">
            <li class="flex gap-2"><${Icon} name=${draft.name && draft.objective ? "check" : "close"} size=${14} className=${draft.name && draft.objective ? "text-emerald-400 mt-0.5" : "text-rose-400 mt-0.5"} /> ${t("builder.step7.checkInfo")}</li>
            <li class="flex gap-2"><${Icon} name=${draft.variants.filter((v) => v.name).length >= 2 ? "check" : "close"} size=${14} className=${draft.variants.filter((v) => v.name).length >= 2 ? "text-emerald-400 mt-0.5" : "text-rose-400 mt-0.5"} /> ${t("builder.step7.checkVariants")}</li>
            <li class="flex gap-2"><${Icon} name=${draft.questions.length >= 1 ? "check" : "close"} size=${14} className=${draft.questions.length >= 1 ? "text-emerald-400 mt-0.5" : "text-rose-400 mt-0.5"} /> ${t("builder.step7.checkQuestions")}</li>
          </ul>
        </div>
      </div>

      <div class="mt-5">
        <${Button} variant="secondary" onClick=${() => setShowRunner(true)}><${Icon} name="play" size=${15}/> ${t("builder.step7.previewButton")}<//>
      </div>
    </div>

    ${showRunner && html`
      <div class="fixed inset-0 z-50 bg-graphite-950 overflow-y-auto">
        <button onClick=${() => setShowRunner(false)} class="fixed top-4 right-4 z-50 rounded-lg bg-graphite-800 p-2 text-graphite-300 hover:bg-graphite-700"><${Icon} name="close" size=${18} /></button>
        <${ParticipantRunner} experimentId=${draft.id} preview=${true} previewExperiment=${draft} />
      </div>
    `}
  `;
}
