import { html, useState, useEffect } from "../lib/preact.js";
import { navigate } from "../router.js";
import { useSession, updatePassword, requestEmailChange, friendlyAuthError } from "../lib/auth.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { useMyProfile, updateMyProfile, uploadAvatar, fetchMyProfileStats, usernameAvailableLocally } from "../lib/profile.js";
import { useFriends } from "../lib/friendsStore.js";
import { Card, SectionHeading, Field, TextInput, TextArea, Select, Switch, Button, Badge, Tabs, toast, LoadingState, Spinner, Skeleton } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { COUNTRIES, TIMEZONES } from "../lib/questionTypes.js";
import { shortDate } from "../lib/format.js";
import { useT, useLocale, setLocale as setAppLocale, LOCALES } from "../lib/i18n.js";
import { withTimeout } from "../lib/async.js";
import { PushToggle } from "../components/PushToggle.js";
import { PlatformBadge } from "../components/platformBadge.js";
import { platformRoleOf } from "../lib/platformRole.js";

function initialsFor(nameOrEmail) {
  if (!nameOrEmail) return "?";
  const parts = nameOrEmail.split(/[\s@._]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

function AvatarEditor({ profile, displayName, t }) {
  const [uploading, setUploading] = useState(false);
  async function onFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadAvatar(file);
      toast(t("profile.personal.profileSaved"));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setUploading(false);
    }
  }
  // the camera badge is always visible: a phone has no hover, so nothing else says the picture can be changed
  return html`
    <label class="pf-avatar" title=${t("profile.personal.changePhoto")} data-testid="profile-avatar">
      ${profile?.avatar_url
        ? html`<img src=${profile.avatar_url} alt="" />`
        : html`<span class="sk-avatar pf-avatar-initials">${initialsFor(displayName)}</span>`}
      <span class="pf-avatar-badge">${uploading ? html`<${Spinner} size=${14} />` : html`<${Icon} name="image" size=${15} />`}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" disabled=${uploading} aria-label=${t("profile.personal.changePhoto")} onChange=${(e) => onFile(e.target.files?.[0])} />
    </label>
  `;
}

const formFrom = (profile) => ({
  full_name: profile?.full_name ?? "", username: profile?.username ?? "", role_title: profile?.role_title ?? "",
  country: profile?.country ?? "", bio: profile?.bio ?? "", research_interests: (profile?.research_interests ?? []).join(", "),
  public_profile_enabled: profile?.public_profile_enabled ?? false,
});

export function PersonalTab({ profile, user, org, t }) {
  const { friends } = useFriends();
  const [form, setForm] = useState(() => formFrom(profile));
  const [saving, setSaving] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);

  useEffect(() => { setForm(formFrom(profile)); }, [profile?.id]);

  function patch(fields) { setForm((f) => ({ ...f, ...fields })); }

  // the save bar shows only when something differs from what is stored
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(profile));
  const usernameValid = !form.username || usernameAvailableLocally(form.username);

  async function save() {
    if (!usernameValid) { toast(t("profile.personal.usernameInvalid"), "rose"); return; }
    setSaving(true);
    try {
      await updateMyProfile({
        full_name: form.full_name.trim() || null,
        username: form.username.trim().toLowerCase() || null,
        role_title: form.role_title.trim() || null,
        country: form.country || null,
        bio: form.bio.trim() || null,
        research_interests: form.research_interests.split(",").map((s) => s.trim()).filter(Boolean),
        public_profile_enabled: form.public_profile_enabled,
      });
      toast(t("profile.personal.profileSaved"));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setSaving(false);
    }
  }

  async function changeEmail() {
    if (!emailDraft.trim() || emailDraft === user?.email) return;
    setChangingEmail(true);
    try {
      await requestEmailChange(emailDraft.trim());
      toast(t("profile.personal.emailSent"));
      setEmailDraft("");
    } catch (err) {
      toast(friendlyAuthError(err, t), "rose");
    } finally {
      setChangingEmail(false);
    }
  }

  const pn = (k, vars) => t(`profile.personal.${k}`, vars);
  return html`
    <div class="pf" data-testid="profile-personal">
      <section class="pf-hero">
        <${AvatarEditor} profile=${profile} displayName=${form.full_name || user?.email || user?.phone} t=${t} />
        <h3 class="pf-name">${form.full_name || t("profile.noName")}</h3>
        <div class="pf-badges"><${PlatformBadge} role=${platformRoleOf(profile)} /></div>
        <!-- the role in the company is shown only when it says something: everyone founds their own company, so "owner" is on everybody -->
        <div class="pf-sub" data-testid="profile-org-line">${org?.name ?? ""}${org?.role && org.role !== "owner" ? ` · ${t(`team.roles.${org.role}`)}` : ""}</div>
        <div class="pf-meta">
          ${profile?.username && html`<span class="pf-url">${t("profile.publicProfileUrl", { username: profile.username })}</span>`}
          <button type="button" onClick=${() => navigate("/app/friends")} class="pf-friends">${t("friends.countLabel", { count: friends.length })}</button>
        </div>
      </section>

      <section class="pf-sec">
        <h4 class="pf-cap">${pn("sectionBasic")}</h4>
        <div class="pf-grid">
          <${Field} label=${pn("fullNameLabel")}>
            <${TextInput} value=${form.full_name} onInput=${(e) => patch({ full_name: e.target.value })} />
          <//>
          <${Field} label=${pn("usernameLabel")} hint=${form.username && !usernameValid ? pn("usernameHintInvalid") : pn("usernameHint")}>
            <${TextInput} value=${form.username} placeholder=${pn("usernamePlaceholder")} onInput=${(e) => patch({ username: e.target.value.toLowerCase() })} />
          <//>
        </div>
      </section>

      <section class="pf-sec">
        <h4 class="pf-cap">${pn("sectionAbout")}</h4>
        <div class="pf-grid">
          <${Field} label=${pn("roleTitleLabel")} hint=${pn("roleTitleHint")}>
            <${TextInput} value=${form.role_title} onInput=${(e) => patch({ role_title: e.target.value })} />
          <//>
          <${Field} label=${pn("countryLabel")}>
            <${Select} options=${[{ value: "", label: pn("countryNone") }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]} value=${form.country} onChange=${(e) => patch({ country: e.target.value })} />
          <//>
        </div>
        <${Field} label=${pn("bioLabel")} hint=${pn("bioHint")}>
          <${TextArea} value=${form.bio} onInput=${(e) => patch({ bio: e.target.value })} />
        <//>
        <${Field} label=${pn("interestsLabel")} hint=${pn("interestsHint")}>
          <${TextInput} value=${form.research_interests} placeholder=${pn("interestsPlaceholder")} onInput=${(e) => patch({ research_interests: e.target.value })} />
        <//>
      </section>

      <section class="pf-sec">
        <h4 class="pf-cap">${pn("sectionPublic")}</h4>
        <${Switch} label=${pn("publicToggle")} checked=${form.public_profile_enabled} onChange=${(v) => patch({ public_profile_enabled: v })} />
        <p class="pf-hint">${pn("publicHint", { username: form.username || "username" })}</p>
      </section>

      <section class="pf-sec">
        <h4 class="pf-cap">${pn("emailTitle")}</h4>
        <p class="pf-hint pf-hint-first">${pn("emailCurrent", { email: user?.email ?? user?.phone ?? "—" })}</p>
        <div class="pf-email">
          <${TextInput} type="email" placeholder=${pn("emailPlaceholder")} value=${emailDraft} onInput=${(e) => setEmailDraft(e.target.value)} />
          <${Button} variant="secondary" size="sm" loading=${changingEmail} disabled=${!emailDraft.trim()} onClick=${changeEmail}>${pn("emailChange")}<//>
        </div>
        <p class="pf-hint">${pn("emailHint")}</p>
      </section>

      <div class="pf-savebar" data-show=${dirty} data-testid="profile-savebar" aria-hidden=${!dirty}>
        <span class="pf-savebar-text">${pn("unsaved")}</span>
        <button type="button" class="pf-discard" tabindex=${dirty ? 0 : -1} onClick=${() => setForm(formFrom(profile))}>${pn("discard")}</button>
        <${Button} onClick=${save} loading=${saving} disabled=${!dirty}>${saving ? t("common.saving") : pn("saveButton")}<//>
      </div>
    </div>
  `;
}

function SecurityTab({ t }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (password.length < 6) return toast(t("profile.security.tooShort"), "rose");
    if (password !== confirm) return toast(t("profile.security.mismatch"), "rose");
    setSaving(true);
    try {
      await updatePassword(password);
      toast(t("profile.security.passwordUpdated"));
      setPassword(""); setConfirm("");
    } catch (err) {
      toast(friendlyAuthError(err, t), "rose");
    } finally {
      setSaving(false);
    }
  }

  return html`
    <div class="max-w-md space-y-4">
      <h4 class="text-sm font-semibold text-graphite-200">${t("profile.security.changePassword")}</h4>
      <${Field} label=${t("profile.security.newPasswordLabel")} hint=${t("profile.security.passwordHint")}>
        <${TextInput} type="password" autocomplete="new-password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
      <//>
      <${Field} label=${t("profile.security.repeatLabel")}>
        <${TextInput} type="password" autocomplete="new-password" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} />
      <//>
      <${Button} onClick=${save} loading=${saving} disabled=${!password}>${saving ? t("common.saving") : t("profile.security.updateButton")}<//>
    </div>
  `;
}

function NotificationsTab({ profile, t }) {
  const [responses, setResponses] = useState(profile?.notify_email_responses ?? true);
  const [digest, setDigest] = useState(profile?.notify_email_digest ?? true);

  async function toggle(key, value, setter) {
    setter(value);
    try {
      await updateMyProfile({ [key]: value });
    } catch (err) {
      setter(!value);
      toast(err.message ?? String(err), "rose");
    }
  }

  return html`
    <div class="max-w-md divide-y divide-graphite-800">
      <${Switch} label=${t("profile.notifications.emailOnResponses")} checked=${responses} onChange=${(v) => toggle("notify_email_responses", v, setResponses)} />
      <${Switch} label=${t("profile.notifications.weeklyDigest")} checked=${digest} onChange=${(v) => toggle("notify_email_digest", v, setDigest)} />
      <${PushToggle} t=${t} />
    </div>
  `;
}

function PreferencesTab({ profile, t }) {
  const appLocale = useLocale();
  const [timezone, setTimezone] = useState(profile?.timezone ?? "Asia/Almaty");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateMyProfile({ locale: appLocale, timezone });
      toast(t("profile.preferences.saved"));
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setSaving(false);
    }
  }

  return html`
    <div class="max-w-md space-y-4">
      <${Field} label=${t("profile.preferences.languageLabel")}>
        <div class="flex items-center gap-1.5">
          ${LOCALES.map((l) => html`
            <button key=${l.id} type="button" onClick=${() => setAppLocale(l.id)}
              class=${`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${appLocale === l.id ? "border-signal-500 bg-signal-500/10 text-signal-200" : "border-graphite-700 text-graphite-400 hover:border-graphite-500"}`}>${l.label}</button>
          `)}
        </div>
      <//>
      <${Field} label=${t("profile.preferences.timezoneLabel")}>
        <${Select} options=${TIMEZONES.map((tz) => ({ value: tz, label: tz }))} value=${timezone} onChange=${(e) => setTimezone(e.target.value)} />
      <//>
      <${Button} onClick=${save} loading=${saving}>${saving ? t("common.saving") : t("common.save")}<//>
    </div>
  `;
}

function SessionsTab({ user, t }) {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setStatsError(false);
    withTimeout(fetchMyProfileStats(user.id), 15000)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStatsError(true); });
    return () => { cancelled = true; };
  }, [user?.id, retryTick]);

  return html`
    <div class="max-w-md space-y-5">
      <div class="sk-panel-flat rounded-lg p-3.5">
        <div class="flex items-center justify-between text-sm">
          <span class="text-graphite-300">${t("profile.sessions.currentSession")}</span>
          <${Badge} tone="emerald">${t("profile.sessions.active")}<//>
        </div>
        <p class="text-xs text-graphite-500 mt-1.5">${t("profile.sessions.sessionNote")}</p>
      </div>
      <dl class="space-y-2.5 text-sm">
        <div class="flex justify-between"><dt class="text-graphite-500">${t("profile.sessions.accountCreated")}</dt><dd class="text-graphite-200">${shortDate(user?.created_at)}</dd></div>
        <div class="flex justify-between"><dt class="text-graphite-500">${t("profile.sessions.experimentsCreated")}</dt><dd class="text-graphite-200">${stats ? stats.experimentCount : statsError ? "—" : html`<${Skeleton} className="h-4 w-8" />`}</dd></div>
        <div class="flex justify-between"><dt class="text-graphite-500">${t("profile.sessions.completedParticipants")}</dt><dd class="text-graphite-200">${stats ? stats.completedParticipants : statsError ? "—" : html`<${Skeleton} className="h-4 w-8" />`}</dd></div>
      </dl>
      ${statsError && html`
        <div class="flex items-center justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <span>${t("profile.sessions.statsError")}</span>
          <button class="font-medium underline shrink-0" onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}</button>
        </div>
      `}
    </div>
  `;
}

export function Profile() {
  const t = useT();
  const { user } = useSession();
  const { org } = useCurrentOrg();
  const { profile, loading, error } = useMyProfile();
  const [tab, setTab] = useState("personal");

  const TABS = [
    { id: "personal", label: t("profile.tabs.personal") },
    { id: "security", label: t("profile.tabs.security") },
    { id: "notifications", label: t("profile.tabs.notifications") },
    { id: "preferences", label: t("profile.tabs.preferences") },
    { id: "sessions", label: t("profile.tabs.sessions") },
  ];

  if (loading) return html`<${LoadingState} label=${t("common.loading")} />`;

  if (error || !profile) {
    return html`
      <div class="fade-in max-w-lg">
        <${SectionHeading} title=${t("profile.title")} subtitle=${t("profile.errorTitle")} />
        <${Card} className="p-5">
          <p class="text-sm text-rose-400 break-words">${error ?? t("profile.errorNotFound")}</p>
          <p class="text-sm text-graphite-500 mt-3 leading-relaxed">${t("profile.errorHint")}</p>
          <${Button} className="mt-4" variant="secondary" onClick=${() => location.reload()}>${t("profile.reloadPage")}<//>
        <//>
      </div>
    `;
  }

  return html`
    <div class="fade-in max-w-3xl">
      <${SectionHeading} title=${t("profile.title")} subtitle=${t("profile.subtitle")} />
      <div class="mb-5 pf-tabs"><${Tabs} tabs=${TABS} active=${tab} onChange=${setTab} /></div>
      ${tab === "personal" && html`<${PersonalTab} profile=${profile} user=${user} org=${org} t=${t} />`}
      <${Card} className=${`p-5 sm:p-7 ${tab === "personal" ? "hidden" : ""}`}>
        ${tab === "security" && html`<${SecurityTab} t=${t} />`}
        ${tab === "notifications" && html`<${NotificationsTab} profile=${profile} t=${t} />`}
        ${tab === "preferences" && html`<${PreferencesTab} profile=${profile} t=${t} />`}
        ${tab === "sessions" && html`<${SessionsTab} user=${user} t=${t} />`}
      <//>
    </div>
  `;
}
