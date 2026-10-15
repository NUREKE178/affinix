import { html, useState, useEffect, useMemo, useRef } from "../lib/preact.js";
import { navigate } from "../router.js";
import { assignRandomization } from "../lib/randomization.js";
import { fetchExperiment } from "../lib/experiments.js";
import { startSession, submitResponse, completeSession } from "../lib/participantApi.js";
import { Icon } from "../components/icons.js";
import { Button, Select, Checkbox, TextArea, TextInput, LoadingState } from "../components/ui.js";
import { AGE_RANGES, COUNTRIES, LANGUAGES } from "../lib/questionTypes.js";
import { t as translate } from "../lib/i18n.js";
import { withTimeout, TimeoutError } from "../lib/async.js";

function dedupeKey(slug) { return `decisionos_submitted_${slug}`; }

function mapVariantRow(row) {
  return { id: row.id, label: row.label, name: row.name, description: row.description, assetUrl: row.asset_url, assetType: row.asset_type, color: row.color };
}
function mapQuestionRow(row) {
  const options = (row.experiment_question_options ?? []).slice().sort((a, b) => a.position - b.position).map((o) => o.label);
  return { id: row.id, type: row.type, appliesTo: row.applies_to, role: row.role, prompt: row.prompt, scale: row.scale, required: row.required, options: options.length ? options : null };
}

function StimulusCard({ variant, selected, onClick, size = "md", t }) {
  const heights = { sm: "h-28", md: "h-40", lg: "h-48" };
  return html`
    <button
      onClick=${onClick}
      data-selected=${!!selected}
      class=${`sk-slot group text-left rounded-2xl overflow-hidden ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div class=${`sk-display ${heights[size]} relative flex items-center justify-center overflow-hidden rounded-t-xl m-1.5 mb-0`} style=${{ background: variant.assetUrl ? undefined : `linear-gradient(135deg, ${variant.color ?? "#6366f1"}33, transparent)` }}>
        ${variant.assetUrl
          ? html`<img src=${variant.assetUrl} class="h-full w-full object-cover" />`
          : html`<span class="text-5xl font-bold text-white/15 select-none">${variant.label}</span>`}
        <div class="sk-slot-label absolute top-2 left-2 h-6 w-6 rounded-md text-white text-xs font-bold flex items-center justify-center">${variant.label}</div>
        ${selected && html`<div class="absolute top-2 right-2 h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-lg"><${Icon} name="check" size=${14} strokeWidth=${2.4} /></div>`}
      </div>
      <div class="px-3.5 py-2.5">
        <div class="text-xs font-semibold text-slate-500">${t("participantRunner.variantLabel", { label: variant.label })}</div>
        <div class="text-sm font-medium text-slate-100 truncate">${variant.name || t("participantRunner.untitledVariant")}</div>
      </div>
    </button>
  `;
}

function ProgressBar({ current, total }) {
  return html`
    <div class="sk-display flex gap-1.5 mb-8 rounded-full p-1">
      ${Array.from({ length: total }).map(
        (_, i) => html`<div key=${i} class=${`h-1.5 flex-1 rounded-full ${i < current ? "bg-indigo-500" : i === current ? "bg-indigo-500/40" : "bg-transparent"}`} style=${i < current ? "box-shadow:0 0 6px -1px rgba(99,102,241,.7)" : ""}></div>`
      )}
    </div>
  `;
}

function TimerRing({ seconds, total }) {
  const pctLeft = Math.max(0, seconds / total);
  return html`
    <div class="flex items-center gap-1.5 text-xs text-slate-500 mb-4">
      <${Icon} name="clock" size=${13} />
      <div class="sk-display h-1.5 w-24 rounded-full overflow-hidden"><div class="h-full bg-amber-500 rounded-full" style=${{ width: `${pctLeft * 100}%`, boxShadow: "0 0 6px -1px rgba(245,158,11,.8)" }}></div></div>
      <span>${Math.ceil(seconds)}s</span>
    </div>
  `;
}

function variantsFor(variantsById, variantOrder) {
  return variantOrder.map((id) => variantsById.get(id)).filter(Boolean);
}

function QuestionTask({ question, variants, onAnswer, timeLimitSeconds, submitting, submitError, onRetry, t }) {
  const shownAt = useRef(performance.now());
  const [selected, setSelected] = useState(null);
  const [multi, setMulti] = useState([]);
  const [ratings, setRatings] = useState({});
  const [yesnos, setYesnos] = useState({});
  const [ranking, setRanking] = useState([]);
  const [text, setText] = useState("");
  const [timeLeft, setTimeLeft] = useState(timeLimitSeconds);
  const [timeUp, setTimeUp] = useState(false);
  const answeredRef = useRef(false);
  const pendingRef = useRef(null);

  useEffect(() => {
    shownAt.current = performance.now();
    answeredRef.current = false;
    pendingRef.current = null;
    setSelected(null); setMulti([]); setRatings({}); setYesnos({}); setRanking([]); setText("");
    setTimeLeft(timeLimitSeconds);
    setTimeUp(false);
  }, [question.id]);

  // A time limit still creates real pacing pressure (the countdown is
  // visible throughout), but running out of time must never silently
  // record a non-answer for a question the researcher marked required --
  // that reads to a participant as the screen randomly skipping ahead,
  // and leaves the researcher with a null response counted as real data.
  // Only a question explicitly marked optional auto-advances on timeout;
  // a required one just stops the clock and asks for a real answer.
  useEffect(() => {
    if (!timeLimitSeconds) return;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 0.2) {
          clearInterval(interval);
          if (!answeredRef.current) {
            if (question.required === false) submit(null);
            else setTimeUp(true);
          }
          return 0;
        }
        return t - 0.2;
      });
    }, 200);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  function submit(value) {
    if (answeredRef.current) return;
    answeredRef.current = true;
    const responseTimeMs = Math.round(performance.now() - shownAt.current);
    pendingRef.current = value;
    onAnswer({ questionId: question.id, value, responseTimeMs });
  }

  function retry() {
    answeredRef.current = false;
    onRetry();
    submit(pendingRef.current);
  }

  function pickSingleVariant(variantId) {
    setSelected(variantId);
    setTimeout(() => submit(variantId), 220);
  }

  const isVariantQuestion = question.appliesTo === "variants";

  if (submitError) {
    return html`
      <div class="slide-up text-center max-w-sm mx-auto">
        <${Icon} name="shield" size=${28} className="text-amber-400 mx-auto mb-3" />
        <p class="text-sm text-slate-300 mb-1">${t("participantRunner.submitFailed")}</p>
        <p class="text-xs text-slate-500 mb-5">${submitError}</p>
        <${Button} onClick=${retry} loading=${submitting}>${submitting ? t("participantRunner.retrying") : t("participantRunner.retryButton")}<//>
      </div>
    `;
  }

  return html`
    <div class="slide-up">
      ${timeLimitSeconds && html`<${TimerRing} seconds=${timeLeft} total=${timeLimitSeconds} />`}
      ${timeUp && html`
        <div class="flex items-center gap-2 mb-4 -mt-3 text-xs text-amber-400">
          <${Icon} name="clock" size=${13} /> ${t("participantRunner.timeUpStillRequired")}
        </div>
      `}
      <h2 class="text-xl sm:text-2xl font-semibold text-slate-50 leading-snug mb-6">${question.prompt}</h2>

      ${isVariantQuestion && (question.type === "single_choice" || question.type === "recall") && html`
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
          ${variants.map((v) => html`<${StimulusCard} key=${v.id} variant=${v} selected=${selected === v.id} onClick=${() => pickSingleVariant(v.id)} t=${t} />`)}
        </div>
      `}

      ${isVariantQuestion && question.type === "yes_no" && html`
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          ${variants.map(
            (v) => html`
              <div key=${v.id}>
                <${StimulusCard} variant=${v} size="sm" t=${t} />
                <div class="flex gap-2 mt-2">
                  <button onClick=${() => setYesnos((y) => ({ ...y, [v.id]: true }))} data-pressed=${yesnos[v.id] === true} class=${`sk-btn flex-1 rounded-lg py-1.5 text-sm font-medium ${yesnos[v.id] === true ? "text-white" : "text-slate-300"}`} style=${yesnos[v.id] === true ? "background:linear-gradient(180deg,#34d399,#10b981);border-color:rgba(255,255,255,.2)" : ""}>${t("common.yes")}</button>
                  <button onClick=${() => setYesnos((y) => ({ ...y, [v.id]: false }))} data-pressed=${yesnos[v.id] === false} class=${`sk-btn flex-1 rounded-lg py-1.5 text-sm font-medium ${yesnos[v.id] === false ? "text-white" : "text-slate-300"}`} style=${yesnos[v.id] === false ? "background:linear-gradient(180deg,#fb7185,#f43f5e);border-color:rgba(255,255,255,.2)" : ""}>${t("common.no")}</button>
                </div>
              </div>
            `
          )}
        </div>
        <${Button} disabled=${Object.keys(yesnos).length < variants.length} onClick=${() => submit(yesnos)}>${t("participantRunner.continueButton")}<//>
      `}

      ${isVariantQuestion && question.type === "rating" && html`
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          ${variants.map((v) => {
            const max = question.scale?.max ?? 5;
            return html`
              <div key=${v.id}>
                <${StimulusCard} variant=${v} size="sm" t=${t} />
                <div class="flex gap-1 mt-2 justify-center">
                  ${Array.from({ length: max }).map((_, i) => html`
                    <button key=${i} onClick=${() => setRatings((r) => ({ ...r, [v.id]: i + 1 }))}
                      data-pressed=${ratings[v.id] === i + 1}
                      class=${`sk-btn h-7 w-7 rounded-md text-xs font-medium ${ratings[v.id] === i + 1 ? "sk-btn-primary" : "text-slate-400"}`}>${i + 1}</button>
                  `)}
                </div>
              </div>
            `;
          })}
        </div>
        <${Button} disabled=${Object.keys(ratings).length < variants.length} onClick=${() => submit(ratings)}>${t("participantRunner.continueButton")}<//>
      `}

      ${isVariantQuestion && question.type === "ranking" && html`
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          ${variants.map((v) => {
            const rank = ranking.indexOf(v.id);
            return html`
              <div key=${v.id} onClick=${() => setRanking((r) => (r.includes(v.id) ? r.filter((x) => x !== v.id) : [...r, v.id]))} class="relative cursor-pointer">
                <${StimulusCard} variant=${v} size="sm" selected=${rank >= 0} t=${t} />
                ${rank >= 0 && html`<span class="sk-slot-label absolute -top-2 -left-2 h-6 w-6 rounded-full text-white text-xs font-bold flex items-center justify-center">${rank + 1}</span>`}
              </div>
            `;
          })}
        </div>
        <p class="text-xs text-slate-500 mb-3">${t("participantRunner.rankingHint", { picked: ranking.length, total: variants.length })}</p>
        <${Button} disabled=${ranking.length < variants.length} onClick=${() => submit(ranking)}>${t("participantRunner.continueButton")}<//>
      `}

      ${!isVariantQuestion && question.type === "single_choice" && html`
        <div class="space-y-2 max-w-md">
          ${(question.options ?? []).map(
            (opt) => html`
              <button key=${opt} onClick=${() => pickSingleVariant(opt)}
                data-selected=${selected === opt}
                class=${`sk-slot w-full text-left rounded-xl px-4 py-3 text-sm font-medium ${selected === opt ? "text-indigo-200" : "text-slate-300"}`}>
                ${opt}
              </button>
            `
          )}
        </div>
      `}

      ${!isVariantQuestion && question.type === "multiple_choice" && html`
        <div class="space-y-2 max-w-md mb-5">
          ${(question.options ?? []).map(
            (opt) => html`<${Checkbox} key=${opt} label=${opt} checked=${multi.includes(opt)}
              onChange=${() => setMulti((m) => (m.includes(opt) ? m.filter((x) => x !== opt) : [...m, opt]))} />`
          )}
        </div>
        <${Button} disabled=${multi.length === 0} onClick=${() => submit(multi)}>${t("participantRunner.continueButton")}<//>
      `}

      ${!isVariantQuestion && question.type === "yes_no" && html`
        <div class="flex gap-3 max-w-xs">
          <${Button} variant=${selected === true ? "primary" : "outline"} className="flex-1" onClick=${() => pickSingleVariant(true)}>${t("common.yes")}<//>
          <${Button} variant=${selected === false ? "primary" : "outline"} className="flex-1" onClick=${() => pickSingleVariant(false)}>${t("common.no")}<//>
        </div>
      `}

      ${question.type === "price_perception" && html`
        ${question.options
          ? html`
            <div class="flex flex-wrap gap-2">
              ${question.options.map((opt) => html`<button key=${opt} onClick=${() => pickSingleVariant(opt)} data-selected=${selected === opt} class=${`sk-slot rounded-xl px-4 py-2.5 text-sm font-medium ${selected === opt ? "text-indigo-200" : "text-slate-300"}`}>${opt}</button>`)}
            </div>
          `
          : html`
            <div class="max-w-xs">
              <${TextInput} type="number" min="0" step="0.01" placeholder=${t("participantRunner.enterAmount")} onInput=${(e) => setText(e.target.value)} />
              <div class="mt-3"><${Button} disabled=${!text} onClick=${() => submit(Number(text))}>${t("participantRunner.continueButton")}<//></div>
            </div>
          `}
      `}

      ${question.type === "open_text" && html`
        <div class="max-w-md">
          <${TextArea} placeholder=${t("participantRunner.enterAnswer")} value=${text} onInput=${(e) => setText(e.target.value)} />
          <div class="mt-3"><${Button} disabled=${!text.trim()} onClick=${() => submit(text.trim())}>${t("participantRunner.continueButton")}<//></div>
        </div>
      `}
    </div>
  `;
}

function ConsentScreen({ experiment, onAgree, t }) {
  const [checked, setChecked] = useState(false);
  return html`
    <div class="max-w-md mx-auto text-center fade-in">
      <div class="sk-display mx-auto h-14 w-14 rounded-xl flex items-center justify-center text-indigo-300 mb-5"><${Icon} name="shield" size=${22} /></div>
      <h1 class="text-xl font-semibold text-slate-50">${t("participantRunner.consentTitle")}</h1>
      <p class="text-sm text-slate-400 mt-3 leading-relaxed">${t("participantRunner.consentBody")}</p>
      <p class="text-xs text-slate-500 mt-3">${t("participantRunner.consentDataNote", { anonymous: experiment.settings?.anonymous ? t("participantRunner.consentAnonymousSuffix") : "" })}</p>
      <div class="mt-6 text-left">
        <${Checkbox} label=${t("participantRunner.consentCheckbox")} checked=${checked} onChange=${(e) => setChecked(e.target.checked)} />
      </div>
      <${Button} className="mt-5 w-full" disabled=${!checked} onClick=${onAgree}>${t("participantRunner.consentStart")}<//>
    </div>
  `;
}

function DemographicsScreen({ fields, onSubmit, t }) {
  const [ageRange, setAgeRange] = useState(AGE_RANGES[1]);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  return html`
    <div class="max-w-sm mx-auto fade-in">
      <h1 class="text-xl font-semibold text-slate-50 mb-1.5">${t("participantRunner.demographicsTitle")}</h1>
      <p class="text-sm text-slate-400 mb-6">${t("participantRunner.demographicsSubtitle")}</p>
      ${fields.includes("ageRange") && html`<div class="mb-4"><label class="block text-sm text-slate-300 mb-1.5">${t("participantRunner.demographicsAge")}</label><${Select} options=${AGE_RANGES} value=${ageRange} onChange=${(e) => setAgeRange(e.target.value)} /></div>`}
      ${fields.includes("country") && html`<div class="mb-4"><label class="block text-sm text-slate-300 mb-1.5">${t("participantRunner.demographicsCountry")}</label><${Select} options=${COUNTRIES} value=${country} onChange=${(e) => setCountry(e.target.value)} /></div>`}
      ${fields.includes("language") && html`<div class="mb-4"><label class="block text-sm text-slate-300 mb-1.5">${t("participantRunner.demographicsLanguage")}</label><${Select} options=${LANGUAGES} value=${language} onChange=${(e) => setLanguage(e.target.value)} /></div>`}
      <${Button} className="w-full mt-2" onClick=${() => onSubmit({ ageRange, country, language })}>${t("participantRunner.continueButton")}<//>
    </div>
  `;
}

function DoneScreen({ preview, onExitPreview, t }) {
  return html`
    <div class="max-w-sm mx-auto text-center fade-in">
      <div class="sk-display mx-auto h-14 w-14 rounded-xl flex items-center justify-center text-emerald-300 mb-5"><${Icon} name="check" size=${22} /></div>
      <h1 class="text-xl font-semibold text-slate-50">${t("participantRunner.doneTitle")}</h1>
      <p class="text-sm text-slate-400 mt-3">${t("participantRunner.doneBody")}</p>
      ${preview
        ? html`<${Button} className="mt-6" variant="secondary" onClick=${onExitPreview}>${t("participantRunner.exitPreview")}<//>`
        : html`<${Button} className="mt-6" variant="secondary" onClick=${() => navigate("/")}>${t("participantRunner.backHome")}<//>`}
    </div>
  `;
}

function firstPostConsentPhase(participantSettings) {
  return (participantSettings.demographicQuestions ?? []).length > 0 ? "demographics" : "task";
}

/** Builder preview (an unsaved draft) and dashboard "preview published
 * experiment" both run entirely client-side: local randomization, no
 * network calls, nothing persisted. Only the public /research/:slug flow
 * below talks to the real backend. */
function LocalPreviewRunner({ experiment, onExitPreview }) {
  const t = (key, vars) => translate(experiment.language ?? "ru", key, vars);
  const [phase, setPhase] = useState(() => (experiment.settings.requireConsent ? "consent" : firstPostConsentPhase(experiment.participantSettings)));
  const [taskIndex, setTaskIndex] = useState(0);

  const { variantOrder, questionOrder } = useMemo(() => assignRandomization(experiment, 0), [experiment]);
  const variantsById = useMemo(() => new Map(experiment.variants.map((v) => [v.id, v])), [experiment]);
  const orderedVariants = useMemo(() => variantsFor(variantsById, variantOrder), [variantsById, variantOrder]);
  const orderedQuestions = useMemo(() => {
    const map = new Map(experiment.questions.map((q) => [q.id, q]));
    return questionOrder.map((id) => map.get(id)).filter(Boolean);
  }, [experiment, questionOrder]);

  function handleAnswer() {
    if (taskIndex + 1 >= orderedQuestions.length) setPhase("done");
    else setTaskIndex((i) => i + 1);
  }

  return html`
    <div class="min-h-screen bg-slate-950 text-slate-100 px-6 py-10 flex flex-col fade-in">
      <div class="max-w-2xl w-full mx-auto mb-6 flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
        <${Icon} name="play" size=${13} /> ${t("participantRunner.previewBanner")}
        <button class="ml-auto underline" onClick=${onExitPreview ?? (() => history.back())}>${t("participantRunner.previewExit")}</button>
      </div>
      <div class="flex-1 flex items-center justify-center">
        <div class="w-full max-w-2xl">
          ${phase === "consent" && html`<${ConsentScreen} experiment=${experiment} onAgree=${() => setPhase(firstPostConsentPhase(experiment.participantSettings))} t=${t} />`}
          ${phase === "demographics" && html`<${DemographicsScreen} fields=${experiment.participantSettings.demographicQuestions} onSubmit=${() => setPhase("task")} t=${t} />`}
          ${phase === "task" && orderedQuestions.length > 0 && html`
            <${ProgressBar} current=${taskIndex} total=${orderedQuestions.length} />
            <${QuestionTask} key=${orderedQuestions[taskIndex].id} question=${orderedQuestions[taskIndex]} variants=${orderedVariants}
              timeLimitSeconds=${experiment.settings.timeLimitSeconds} onAnswer=${handleAnswer} submitting=${false} submitError=${null} onRetry=${() => {}} t=${t} />
          `}
          ${phase === "task" && orderedQuestions.length === 0 && html`<${DoneScreen} preview=${true} onExitPreview=${onExitPreview} t=${t} />`}
          ${phase === "done" && html`<${DoneScreen} preview=${true} onExitPreview=${onExitPreview} t=${t} />`}
        </div>
      </div>
    </div>
  `;
}

/** The real, public participant flow -- backed entirely by the
 * start-session / submit-response / complete-session Edge Functions. */
function LiveRunner({ slug }) {
  const [state, setState] = useState({ phase: "loading" }); // loading | consent | demographics | task | done | notfound | alreadyDone | error
  const [session, setSession] = useState(null); // {sessionId, clientToken, experiment, variantsById, questionsById, orderedVariants, orderedQuestions}
  const [taskIndex, setTaskIndex] = useState(0);
  const [demographics, setDemographics] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const pendingAnswerRef = useRef(null);
  const t = (key, vars) => translate(session?.experiment?.language ?? "ru", key, vars);

  useEffect(() => {
    if (typeof localStorage !== "undefined" && localStorage.getItem(dedupeKey(slug))) {
      setState({ phase: "alreadyDone" });
      return;
    }
    let cancelled = false;
    withTimeout(startSession(slug), 15000)
      .then((data) => {
        if (cancelled) return;
        const variantsById = new Map((data.variants ?? []).map((v) => [v.id, mapVariantRow(v)]));
        const questionsById = new Map((data.questions ?? []).map((q) => [q.id, mapQuestionRow(q)]));
        const orderedVariants = variantsFor(variantsById, data.variant_order ?? []);
        const orderedQuestions = (data.question_order ?? []).map((id) => questionsById.get(id)).filter(Boolean);
        setSession({
          sessionId: data.session_id,
          clientToken: data.client_token,
          experiment: data.experiment,
          orderedVariants,
          orderedQuestions,
        });
        setState({ phase: data.experiment.settings?.requireConsent ? "consent" : firstPostConsentPhase(data.experiment.participant_settings ?? {}) });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "notfound" });
      });
    return () => { cancelled = true; };
  }, [slug]);

  async function finish() {
    try {
      await withTimeout(completeSession({ sessionId: session.sessionId, clientToken: session.clientToken, consentGiven: true, demographics }), 15000);
    } catch {
      // the responses are already saved individually; a failure to mark
      // the session complete isn't worth blocking the thank-you screen on.
    }
    if (session.experiment.settings?.preventDuplicates && typeof localStorage !== "undefined") {
      try { localStorage.setItem(dedupeKey(slug), "1"); } catch {}
    }
    setState({ phase: "done" });
  }

  async function handleAnswer({ questionId, value, responseTimeMs }) {
    pendingAnswerRef.current = { questionId, value, responseTimeMs };
    setSubmitting(true);
    setSubmitError(null);
    try {
      const variantId = typeof value === "string" && session.orderedVariants.some((v) => v.id === value) ? value : null;
      await withTimeout(submitResponse({
        sessionId: session.sessionId,
        clientToken: session.clientToken,
        questionId,
        variantId,
        value,
        responseTimeMs,
        position: taskIndex,
      }), 15000);
      setSubmitting(false);
      if (taskIndex + 1 >= session.orderedQuestions.length) await finish();
      else setTaskIndex((i) => i + 1);
    } catch (err) {
      setSubmitting(false);
      // A TimeoutError's message is a hardcoded English debug string, not
      // UI copy -- never show it directly, always fall back to the
      // localized network-error text for it (same as a message-less error).
      setSubmitError(err instanceof TimeoutError ? t("participantRunner.networkError") : err.message || t("participantRunner.networkError"));
    }
  }

  function retrySubmit() {
    setSubmitError(null);
  }

  if (state.phase === "loading") {
    return html`<div class="min-h-screen flex items-center justify-center bg-slate-950 fade-in"><${LoadingState} mark=${false} label=${t("participantRunner.loading")} /></div>`;
  }
  if (state.phase === "notfound") {
    return html`
      <div class="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 px-6 fade-in">
        <div class="text-center">
          <p class="font-medium">${t("participantRunner.notFoundTitle")}</p>
          <${Button} className="mt-4" variant="secondary" onClick=${() => navigate("/")}>${t("participantRunner.backHome")}<//>
        </div>
      </div>
    `;
  }
  if (state.phase === "alreadyDone") {
    return html`
      <div class="min-h-screen flex items-center justify-center bg-slate-950 px-6 fade-in">
        <div class="max-w-sm text-center">
          <h1 class="text-xl font-semibold text-slate-50">${t("participantRunner.alreadyDoneTitle")}</h1>
          <p class="text-sm text-slate-400 mt-3">${t("participantRunner.alreadyDoneBody")}</p>
          <${Button} className="mt-6" variant="secondary" onClick=${() => navigate("/")}>${t("participantRunner.backHome")}<//>
        </div>
      </div>
    `;
  }

  return html`
    <div class="min-h-screen bg-slate-950 text-slate-100 px-6 py-10 flex flex-col fade-in">
      <div class="flex-1 flex items-center justify-center">
        <div class="w-full max-w-2xl">
          ${state.phase === "consent" && html`<${ConsentScreen} experiment=${session.experiment} onAgree=${() => setState({ phase: firstPostConsentPhase(session.experiment.participant_settings ?? {}) })} t=${t} />`}
          ${state.phase === "demographics" && html`<${DemographicsScreen} fields=${session.experiment.participant_settings?.demographicQuestions ?? []} onSubmit=${(d) => { setDemographics(d); setState({ phase: "task" }); }} t=${t} />`}
          ${state.phase === "task" && session.orderedQuestions.length > 0 && html`
            <${ProgressBar} current=${taskIndex} total=${session.orderedQuestions.length} />
            <${QuestionTask}
              key=${session.orderedQuestions[taskIndex].id}
              question=${session.orderedQuestions[taskIndex]}
              variants=${session.orderedVariants}
              timeLimitSeconds=${session.experiment.settings?.timeLimitSeconds}
              onAnswer=${handleAnswer}
              submitting=${submitting}
              submitError=${submitError}
              onRetry=${retrySubmit}
              t=${t}
            />
          `}
          ${state.phase === "task" && session.orderedQuestions.length === 0 && html`<${DoneScreen} preview=${false} t=${t} />`}
          ${state.phase === "done" && html`<${DoneScreen} preview=${false} t=${t} />`}
        </div>
      </div>
    </div>
  `;
}

/** props: either `slug` (public live flow), or `previewExperiment` (builder
 * draft preview), or `experimentId` + `preview=true` (dashboard preview of
 * a saved experiment, fetched read-only, nothing persisted). */
export function ParticipantRunner({ slug, experimentId, preview = false, previewExperiment = null, onExitPreview }) {
  const [fetchedExperiment, setFetchedExperiment] = useState(previewExperiment ?? null);
  const [loading, setLoading] = useState(!previewExperiment && preview && !!experimentId);
  const [loadError, setLoadError] = useState(null); // null | "not_found" | <error message>
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (previewExperiment || !preview || !experimentId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    withTimeout(fetchExperiment(experimentId), 15000)
      .then((exp) => {
        if (cancelled) return;
        if (exp) setFetchedExperiment(exp);
        else setLoadError("not_found"); // real row, found nothing -- not a blank preview
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message ?? String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [preview, experimentId, previewExperiment, retryTick]);

  if (!preview) return html`<${LiveRunner} slug=${slug} />`;

  if (loadError) {
    return html`
      <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-slate-400 text-sm px-6 text-center">
        <p>${translate("ru", loadError === "not_found" ? "participantRunner.previewNotFound" : "participantRunner.previewLoadError")}</p>
        <div class="flex items-center gap-3">
          ${loadError !== "not_found" && html`<${Button} size="sm" onClick=${() => setRetryTick((n) => n + 1)}>${translate("ru", "common.retry")}<//>`}
          <${Button} size="sm" variant="secondary" onClick=${() => navigate("/app/experiments")}>${translate("ru", "participantRunner.backToExperiments")}<//>
        </div>
      </div>
    `;
  }

  if (loading || !fetchedExperiment) {
    return html`<div class="min-h-screen flex items-center justify-center bg-slate-950"><${LoadingState} mark=${false} label=${translate("ru", "participantRunner.loading")} /></div>`;
  }
  return html`<${LocalPreviewRunner} experiment=${fetchedExperiment} onExitPreview=${onExitPreview} />`;
}
