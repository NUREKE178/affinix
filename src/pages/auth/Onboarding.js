import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { navigate } from "../../router.js";
import { Icon, LogoMark } from "../../components/icons.js";
import { LanguageSwitch } from "../../components/shell.js";
import { AuthError } from "./AuthLayout.js";
import { Field, TextInput, TextArea, Select, Switch, Button, toast } from "../../components/ui.js";
import { createOrganization, fetchMyOrganizations, addMemberByEmail } from "../../lib/org.js";
import { useMyProfile, updateMyProfile, uploadAvatar, usernameAvailableLocally } from "../../lib/profile.js";
import { COUNTRIES, TIMEZONES } from "../../lib/questionTypes.js";
import { useT, useLocaleFadeClass } from "../../lib/i18n.js";
import { withTimeout } from "../../lib/async.js";

const TOTAL_STEPS = 10;
const INVITE_ROLES = ["admin", "researcher", "viewer"];

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

/** Wider than the narrow single-field AuthLayout this replaces -- a 10-step
 * wizard with select/textarea fields and a repeatable invite list needs
 * more room than a password-reset form does. Keeps the same dark panel +
 * top logo-button language as the rest of the auth flow. */
function WizardShell({ step, children }) {
  const t = useT();
  const localeFadeClass = useLocaleFadeClass();
  const pct = Math.round(((step + 1) / TOTAL_STEPS) * 100);
  return html`
    <div class=${`min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-10 ${localeFadeClass}`}>
      <div class="w-full max-w-lg">
        <div class="flex items-center justify-between mb-8">
          <button onClick=${() => navigate("/")} class="flex items-center gap-2.5">
            <${LogoMark} size=${36} />
            <span class="font-semibold text-lg tracking-tight">DecisionOS</span>
          </button>
          <${LanguageSwitch} />
        </div>
        <div class="sk-panel rounded-2xl p-6 sm:p-8 fade-in">
          <div class="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>${t("auth.onboarding.stepLabel", { current: step + 1, total: TOTAL_STEPS })}</span>
          </div>
          <div class="sk-display h-1.5 w-full rounded-full overflow-hidden mb-6">
            <div class="h-full rounded-full transition-all duration-300" style=${{ width: `${pct}%`, background: "linear-gradient(90deg,#818cf8,#6366f1)", boxShadow: "0 0 8px -1px rgba(99,102,241,.6)" }}></div>
          </div>
          <!-- Keyed by step so this (and only this) remounts and replays its
               entrance per step -- the progress bar above stays mounted so
               its own width transition keeps animating smoothly. -->
          <div key=${step} class="slide-up">
            ${children}
          </div>
        </div>
      </div>
    </div>
  `;
}

function StepHeading({ title, subtitle }) {
  return html`
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-slate-50">${title}</h1>
      ${subtitle && html`<p class="text-sm text-slate-400 mt-1.5">${subtitle}</p>`}
    </div>
  `;
}

function StepNav({ onBack, onNext, onSkip, nextLabel, nextDisabled, busy, showBack = true }) {
  const t = useT();
  return html`
    <div class="flex items-center justify-between mt-7">
      <div>
        ${showBack && html`<${Button} type="button" variant="ghost" onClick=${onBack} disabled=${busy}>${t("auth.onboarding.back")}<//>`}
      </div>
      <div class="flex items-center gap-2">
        ${onSkip && html`<${Button} type="button" variant="ghost" onClick=${onSkip} disabled=${busy}>${t("auth.onboarding.skip")}<//>`}
        <${Button} type="submit" disabled=${nextDisabled || busy}>${busy ? t("auth.onboarding.saving") : nextLabel}<//>
      </div>
    </div>
  `;
}

export function Onboarding() {
  const t = useT();
  const { profile } = useMyProfile();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    orgName: "",
    fullName: "",
    roleTitle: "",
    username: "",
    bio: "",
    country: "",
    timezone: "Asia/Almaty",
    interests: "",
    notifyResponses: true,
    notifyDigest: true,
    invites: [],
  });
  function patch(fields) { setForm((f) => ({ ...f, ...fields })); }

  useEffect(() => {
    withTimeout(fetchMyOrganizations(), 15000)
      .then((orgs) => {
        if (orgs.length > 0) navigate("/app/overview");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  // Focus the step's first field on every step change -- the HTML
  // `autofocus` attribute only fires for markup present at initial parse,
  // never for elements a framework inserts later, so each step change
  // needs this done imperatively. Scoped to the wizard's own panel; this
  // is the only thing on screen while onboarding is active.
  useEffect(() => {
    const el = document.querySelector(".sk-panel input, .sk-panel textarea, .sk-panel select");
    el?.focus();
  }, [step, checking]);

  // Pre-fill what's already known (full_name is set at signup) so the
  // wizard never asks for something it could already show.
  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      fullName: f.fullName || profile.full_name || "",
      roleTitle: f.roleTitle || profile.role_title || "",
      username: f.username || profile.username || "",
      bio: f.bio || profile.bio || "",
      country: f.country || profile.country || "",
      timezone: f.timezone === "Asia/Almaty" && profile.timezone ? profile.timezone : f.timezone,
    }));
  }, [profile?.id]);

  if (checking) return null;

  const usernameValid = !form.username.trim() || usernameAvailableLocally(form.username.trim());

  function next(e) {
    e?.preventDefault();
    setError(null);
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }
  function skip() {
    setError(null);
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }

  async function onAvatarFile(file) {
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      await uploadAvatar(file);
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setUploadingAvatar(false);
    }
  }

  function addInviteRow() {
    patch({ invites: [...form.invites, { email: "", role: "researcher" }] });
  }
  function updateInviteRow(i, fields) {
    patch({ invites: form.invites.map((inv, idx) => (idx === i ? { ...inv, ...fields } : inv)) });
  }
  function removeInviteRow(i) {
    patch({ invites: form.invites.filter((_, idx) => idx !== i) });
  }

  async function finish(e) {
    e.preventDefault();
    setError(null);
    setFinishing(true);
    try {
      const org = await createOrganization(form.orgName.trim());
      await updateMyProfile({
        full_name: form.fullName.trim() || null,
        role_title: form.roleTitle.trim() || null,
        username: form.username.trim().toLowerCase() || null,
        bio: form.bio.trim() || null,
        country: form.country || null,
        timezone: form.timezone || null,
        research_interests: form.interests.split(",").map((s) => s.trim()).filter(Boolean),
        notify_email_responses: form.notifyResponses,
        notify_email_digest: form.notifyDigest,
      });
      const validInvites = form.invites.filter((inv) => inv.email.trim());
      for (const inv of validInvites) {
        try {
          const result = await addMemberByEmail(org.id, inv.email.trim(), inv.role);
          if (result.status === "invited") toast(t("team.inviteSent", { email: result.email }));
        } catch (err) {
          // A bad invite (typo, already a member) shouldn't block finishing
          // onboarding -- the org/profile are already real and saved by
          // this point. Surface it as a toast, not a blocking form error.
          toast(`${inv.email}: ${err.message ?? String(err)}`, "rose");
        }
      }
      navigate("/app/overview");
    } catch (err) {
      setError(err.message ?? String(err));
      setFinishing(false);
    }
  }

  // --- Step content ---------------------------------------------------

  if (step === 0) {
    return html`
      <${WizardShell} step=${step}>
        <div class="text-center py-4">
          <div class="sk-display mx-auto h-14 w-14 rounded-2xl flex items-center justify-center text-indigo-300 mb-5"><${Icon} name="sparkle" size=${24} /></div>
          <h1 class="text-xl font-semibold text-slate-50">${t("auth.onboarding.steps.welcome.title")}</h1>
          <p class="text-sm text-slate-400 mt-2.5 leading-relaxed max-w-sm mx-auto">${t("auth.onboarding.steps.welcome.body")}</p>
        </div>
        <form onSubmit=${next}>
          <${StepNav} showBack=${false} onNext=${next} nextLabel=${t("auth.onboarding.steps.welcome.cta")} />
        </form>
      <//>
    `;
  }

  if (step === 1) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.org.title")} subtitle=${t("auth.onboarding.steps.org.subtitle")} />
        <${AuthError} message=${error} />
        <form onSubmit=${next}>
          <${Field} label=${t("auth.onboarding.steps.org.label")} required>
            <${TextInput} required placeholder=${t("auth.onboarding.steps.org.placeholder")} value=${form.orgName} onInput=${(e) => patch({ orgName: e.target.value })} />
          <//>
          <${StepNav} onBack=${back} nextLabel=${t("auth.onboarding.next")} nextDisabled=${!form.orgName.trim()} />
        </form>
      <//>
    `;
  }

  if (step === 2) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.identity.title")} subtitle=${t("auth.onboarding.steps.identity.subtitle")} />
        <form onSubmit=${next}>
          <${Field} label=${t("auth.onboarding.steps.identity.nameLabel")} required>
            <${TextInput} required value=${form.fullName} onInput=${(e) => patch({ fullName: e.target.value })} />
          <//>
          <${Field} label=${t("auth.onboarding.steps.identity.roleLabel")} hint=${t("auth.onboarding.steps.identity.roleHint")}>
            <${TextInput} placeholder=${t("auth.onboarding.steps.identity.rolePlaceholder")} value=${form.roleTitle} onInput=${(e) => patch({ roleTitle: e.target.value })} />
          <//>
          <${StepNav} onBack=${back} nextLabel=${t("auth.onboarding.next")} nextDisabled=${!form.fullName.trim()} />
        </form>
      <//>
    `;
  }

  if (step === 3) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.avatar.title")} subtitle=${t("auth.onboarding.steps.avatar.subtitle")} />
        <${AuthError} message=${error} />
        <div class="flex justify-center py-2">
          <label class="relative group cursor-pointer">
            ${profile?.avatar_url
              ? html`<img src=${profile.avatar_url} class="h-24 w-24 rounded-full object-cover" />`
              : html`<div class="h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center text-3xl font-semibold text-white">${initialsFor(form.fullName)}</div>`}
            <div class="absolute inset-0 rounded-full bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              ${uploadingAvatar ? html`<span class="sk-spinner" style="width:20px;height:20px"></span>` : html`<${Icon} name="upload" size=${20} className="text-slate-100" />`}
            </div>
            <input ref=${fileRef} type="file" accept="image/jpeg,image/png,image/webp" class="hidden" disabled=${uploadingAvatar} onChange=${(e) => onAvatarFile(e.target.files?.[0])} />
          </label>
        </div>
        <p class="text-center text-xs text-slate-500 mt-3">${t("auth.onboarding.steps.avatar.hint")}</p>
        <form onSubmit=${next}>
          <${StepNav} onBack=${back} onSkip=${skip} nextLabel=${t("auth.onboarding.next")} busy=${uploadingAvatar} />
        </form>
      <//>
    `;
  }

  if (step === 4) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.username.title")} subtitle=${t("auth.onboarding.steps.username.subtitle")} />
        <form onSubmit=${next}>
          <${Field} label=${t("auth.onboarding.steps.username.label")} hint=${usernameValid ? t("auth.onboarding.steps.username.hint") : t("profile.personal.usernameHintInvalid")}>
            <${TextInput} placeholder=${t("auth.onboarding.steps.username.placeholder")} value=${form.username} onInput=${(e) => patch({ username: e.target.value.toLowerCase() })} />
          <//>
          <${StepNav} onBack=${back} onSkip=${skip} nextLabel=${t("auth.onboarding.next")} nextDisabled=${!usernameValid} />
        </form>
      <//>
    `;
  }

  if (step === 5) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.bio.title")} subtitle=${t("auth.onboarding.steps.bio.subtitle")} />
        <form onSubmit=${next}>
          <${Field} label=${t("auth.onboarding.steps.bio.label")}>
            <${TextArea} rows=${4} placeholder=${t("auth.onboarding.steps.bio.placeholder")} value=${form.bio} onInput=${(e) => patch({ bio: e.target.value })} />
          <//>
          <${StepNav} onBack=${back} onSkip=${skip} nextLabel=${t("auth.onboarding.next")} />
        </form>
      <//>
    `;
  }

  if (step === 6) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.location.title")} subtitle=${t("auth.onboarding.steps.location.subtitle")} />
        <form onSubmit=${next}>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <${Field} label=${t("auth.onboarding.steps.location.countryLabel")}>
              <${Select} options=${[{ value: "", label: t("auth.onboarding.steps.location.countryPlaceholder") }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]}
                value=${form.country} onChange=${(e) => patch({ country: e.target.value })} />
            <//>
            <${Field} label=${t("auth.onboarding.steps.location.timezoneLabel")}>
              <${Select} options=${TIMEZONES.map((z) => ({ value: z, label: z }))} value=${form.timezone} onChange=${(e) => patch({ timezone: e.target.value })} />
            <//>
          </div>
          <${StepNav} onBack=${back} onSkip=${skip} nextLabel=${t("auth.onboarding.next")} />
        </form>
      <//>
    `;
  }

  if (step === 7) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.interests.title")} subtitle=${t("auth.onboarding.steps.interests.subtitle")} />
        <form onSubmit=${next}>
          <${Field} label=${t("auth.onboarding.steps.interests.label")} hint=${t("auth.onboarding.steps.interests.hint")}>
            <${TextInput} placeholder=${t("auth.onboarding.steps.interests.placeholder")} value=${form.interests} onInput=${(e) => patch({ interests: e.target.value })} />
          <//>
          <${StepNav} onBack=${back} onSkip=${skip} nextLabel=${t("auth.onboarding.next")} />
        </form>
      <//>
    `;
  }

  if (step === 8) {
    return html`
      <${WizardShell} step=${step}>
        <${StepHeading} title=${t("auth.onboarding.steps.notifications.title")} subtitle=${t("auth.onboarding.steps.notifications.subtitle")} />
        <form onSubmit=${next}>
          <div class="sk-display rounded-lg px-4 divide-y divide-black/40">
            <${Switch} label=${t("auth.onboarding.steps.notifications.responsesLabel")} checked=${form.notifyResponses} onChange=${(v) => patch({ notifyResponses: v })} />
            <${Switch} label=${t("auth.onboarding.steps.notifications.digestLabel")} checked=${form.notifyDigest} onChange=${(v) => patch({ notifyDigest: v })} />
          </div>
          <${StepNav} onBack=${back} nextLabel=${t("auth.onboarding.next")} />
        </form>
      <//>
    `;
  }

  // step === 9 -- invite teammates, then Finish.
  return html`
    <${WizardShell} step=${step}>
      <${StepHeading} title=${t("auth.onboarding.steps.invite.title")} subtitle=${t("auth.onboarding.steps.invite.subtitle")} />
      <${AuthError} message=${error} />
      <div class="space-y-2.5">
        ${form.invites.map((inv, i) => html`
          <div key=${i} class="flex items-center gap-2">
            <${TextInput} className="flex-1 min-w-0" type="email" placeholder=${t("auth.onboarding.steps.invite.emailPlaceholder")}
              value=${inv.email} onInput=${(e) => updateInviteRow(i, { email: e.target.value })} />
            <${Select} className="w-36 shrink-0" options=${INVITE_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))}
              value=${inv.role} onChange=${(e) => updateInviteRow(i, { role: e.target.value })} />
            <button type="button" onClick=${() => removeInviteRow(i)} class="shrink-0 text-slate-500 hover:text-rose-400 p-1">
              <${Icon} name="close" size=${15} />
            <//>
          </div>
        `)}
      </div>
      <button type="button" onClick=${addInviteRow} class="mt-3 text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5">
        <${Icon} name="plus" size=${14} /> ${t("auth.onboarding.steps.invite.addAnother")}
      </button>
      <form onSubmit=${finish}>
        <${StepNav} onBack=${back} nextLabel=${t("auth.onboarding.finish")} busy=${finishing} />
      </form>
    <//>
  `;
}
