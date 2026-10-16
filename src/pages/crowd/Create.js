// New crowd test: a name, one question, 2-4 options (an image and/or a caption each).
import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { Card, Button, Field, TextInput, Spinner, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import {
  TEST_DIMS, MIN_OPTIONS, MAX_OPTIONS, MIN_TITLE, MAX_TITLE, MAX_LABEL,
  prepareImage, createTest, validateDraft, useCreateGate,
} from "../../lib/crowdStore.js";
import { testPath } from "./parts.js";

let nextKey = 1;
const blankOption = () => ({ key: nextKey++, label: "", prepared: null, previewUrl: null, processing: false, error: null });

function OptionEditor({ index, option, onChange, onRemove, canRemove, t, busy }) {
  const fileRef = useRef(null);

  async function pick(file) {
    if (!file) return;
    onChange({ processing: true, error: null });
    try {
      const prepared = await prepareImage(file);
      onChange({ prepared, previewUrl: URL.createObjectURL(prepared.blob), processing: false, error: null });
    } catch (err) {
      onChange({ processing: false, error: err?.hint ?? "unreadable" });
    }
  }

  const letter = String.fromCharCode(65 + index);
  return html`
    <div class="cr-opt" data-testid="crowd-option">
      <div class="cr-opt-head">
        <span class="cr-opt-letter sk-num">${letter}</span>
        ${canRemove && html`<button type="button" class="cr-opt-remove" onClick=${onRemove} disabled=${busy} aria-label=${t("crowd.new.removeOption")} title=${t("crowd.new.removeOption")}><${Icon} name="close" size=${14} /></button>`}
      </div>
      <div class="cr-opt-slot" data-has=${!!option.previewUrl}
        onDragOver=${(e) => e.preventDefault()}
        onDrop=${(e) => { e.preventDefault(); pick(e.dataTransfer?.files?.[0]); }}>
        ${option.processing
          ? html`<${Spinner} size=${22} />`
          : option.previewUrl
            ? html`<img src=${option.previewUrl} alt="" draggable="false" />`
            : html`<button type="button" class="cr-opt-add" onClick=${() => fileRef.current?.click()} disabled=${busy} data-testid="crowd-option-add-image"><${Icon} name="image" size=${20} /><span>${t("crowd.new.addImage")}</span></button>`}
      </div>
      <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp" class="hidden" data-testid="crowd-option-file"
        onChange=${(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      ${option.previewUrl && html`
        <div class="cr-opt-actions">
          <button type="button" class="cr-link" onClick=${() => fileRef.current?.click()} disabled=${busy}>${t("crowd.new.replaceImage")}</button>
          <button type="button" class="cr-link" onClick=${() => onChange({ prepared: null, previewUrl: null, error: null })} disabled=${busy}>${t("crowd.new.removeImage")}</button>
        </div>`}
      ${option.error && html`<p class="cr-opt-error" role="alert">${t(`crowd.err.${option.error}`)}</p>`}
      <${TextInput} value=${option.label} maxlength=${MAX_LABEL} disabled=${busy} data-testid="crowd-option-label"
        placeholder=${t("crowd.new.optionLabel")} aria-label=${`${t("crowd.new.optionLabel")} ${letter}`}
        onInput=${(e) => onChange({ label: e.target.value })} />
    </div>
  `;
}

export function CrowdCreate() {
  const t = useT();
  const { xp, locked: gated } = useCreateGate({ sync: true });
  const [title, setTitle] = useState("");
  const [dim, setDim] = useState("preference");
  const [options, setOptions] = useState(() => [blankOption(), blankOption()]);
  const [phase, setPhase] = useState(null); // null | "uploading" | "publishing"
  const [error, setError] = useState(null);
  const [tried, setTried] = useState(false);
  const busy = phase !== null;

  // the object URLs of the previews are released when the page goes away
  const urls = useRef([]);
  urls.current = options.map((o) => o.previewUrl).filter(Boolean);
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const patch = (key, p) => setOptions((list) => list.map((o) => (o.key === key ? { ...o, ...p } : o)));
  const problem = validateDraft({ title, dim, options });
  const anyProcessing = options.some((o) => o.processing);

  async function publish() {
    setTried(true);
    if (problem || anyProcessing || busy) { if (problem) setError(problem); return; }
    setError(null);
    setPhase(options.some((o) => o.prepared) ? "uploading" : "publishing");
    try {
      const id = await createTest({ title, dim, options });
      toast(t("crowd.created"), "emerald");
      navigate(testPath(id));
    } catch (err) {
      setError(err?.pending ? "pending" : err?.hint ?? (navigator.onLine === false ? "offline" : "generic"));
      setPhase(null);
    }
  }

  const titleBad = tried && (title.trim().length < MIN_TITLE || title.trim().length > MAX_TITLE);
  return html`
    <div class="cr-create fade-in" data-testid="crowd-create-page">
      <div class="cr-back"><${Button} variant="secondary" size="sm" onClick=${() => navigate("/app/overview")}><${Icon} name="arrowLeft" size=${14} />${t("crowd.back")}<//></div>
      <div class="cr-create-head">
        <h2>${t("crowd.new.title")}</h2>
        <p class="ar-muted">${t("crowd.new.subtitle")}</p>
      </div>

      ${gated && html`<${Card} className="cr-gate-card p-4" data-testid="crowd-gate"><p>${t("crowd.gate", { xp })}</p><${Button} size="sm" variant="secondary" onClick=${() => navigate("/app/arena")}><${Icon} name="arena" size=${14} />${t("crowd.playFirst")}<//><//>`}

      <${Card} className="p-5">
        <${Field} label=${t("crowd.new.titleLabel")} required=${true}>
          <${TextInput} value=${title} maxlength=${MAX_TITLE} disabled=${busy} data-testid="crowd-title"
            placeholder=${t("crowd.new.titlePlaceholder")} onInput=${(e) => setTitle(e.target.value)} aria-invalid=${titleBad ? "true" : undefined} />
        <//>
        <div class="cr-field">
          <span class="cr-field-label">${t("crowd.new.questionLabel")}</span>
          <div class="cr-chips" role="radiogroup" aria-label=${t("crowd.new.questionLabel")}>
            ${TEST_DIMS.map((d) => html`
              <button type="button" key=${d} role="radio" aria-checked=${dim === d} data-on=${dim === d} class="cr-chip" disabled=${busy}
                onClick=${() => setDim(d)} data-testid=${`crowd-dim-${d}`}>${t(`builder.dimensions.${d}.label`)}</button>`)}
          </div>
          <p class="cr-question" data-testid="crowd-question">${t(`crowd.q.${dim}`)}</p>
        </div>
      <//>

      <${Card} className="p-5">
        <div class="cr-field-head">
          <span class="cr-field-label">${t("crowd.new.optionsLabel")}</span>
          <span class="ar-muted">${t("crowd.new.optionHint")}</span>
        </div>
        <div class="cr-opts">
          ${options.map((o, i) => html`
            <${OptionEditor} key=${o.key} index=${i} option=${o} busy=${busy} t=${t}
              canRemove=${options.length > MIN_OPTIONS}
              onChange=${(p) => patch(o.key, p)}
              onRemove=${() => setOptions((list) => list.filter((x) => x.key !== o.key))} />`)}
          ${options.length < MAX_OPTIONS && html`
            <button type="button" class="cr-opt cr-opt-new" onClick=${() => setOptions((l) => [...l, blankOption()])} disabled=${busy} data-testid="crowd-add-option">
              <${Icon} name="plus" size=${20} /><span>${t("crowd.new.addOption")}</span>
            </button>`}
        </div>
        ${tried && problem === "bad_items" && html`<p class="cr-opt-error" role="alert">${t("crowd.err.bad_items")}</p>`}
      <//>

      ${error && html`<div class="cr-error" role="alert" data-testid="crowd-error">${t(`crowd.err.${error}`)}</div>`}
      <p class="cr-rules">${t("crowd.new.rules")}</p>
      <div class="cr-create-foot">
        <${Button} onClick=${publish} loading=${busy} disabled=${anyProcessing} data-testid="crowd-publish">
          ${phase === "uploading" ? t("crowd.new.uploading") : phase === "publishing" ? t("crowd.new.publishing") : t("crowd.new.publish")}
        <//>
      </div>
    </div>
  `;
}
