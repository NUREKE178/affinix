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
  return html`
    <label class="relative group cursor-pointer shrink-0">
      ${profile?.avatar_url
        ? html`<img src=${profile.avatar_url} class="h-20 w-20 rounded-full object-cover" />`
        : html`<div class="h-20 w-20 rounded-full sk-avatar flex items-center justify-center text-2xl font-semibold">${initialsFor(displayName)}</div>`}
      <div class="absolute inset-0 rounded-full bg-graphite-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        ${uploading ? html`<${Spinner} size=${18} />` : html`<${Icon} name="upload" size=${18} className="text-graphite-100" />`}
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" disabled=${uploading} onChange=${(e) => onFile(e.target.files?.[0])} />
    </label>
  `;
}

function PersonalTab({ profile, user, org, t }) {
  const { friends } = useFriends();
  const [form, setForm] = useState(() => ({
    full_name: profile?.full_name ?? "", username: profile?.username ?? "", role_title: profile?.role_title ?? "",
    country: profile?.country ?? "", bio: profile?.bio ?? "", research_interests: (profile?.research_interests ?? []).join(", "),
    public_profile_enabled: profile?.public_profile_enabled ?? false,
  }));
  const [saving, setSaving] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);

  useEffect(() => {
    setForm({
      full_name: profile?.full_name ?? "", username: profile?.username ?? "", role_title: profile?.role_title ?? "",
      country: profile?.country ?? "", bio: profile?.bio ?? "", research_interests: (profile?.research_interests ?? []).join(", "),
      public_profile_enabled: profile?.public_profile_enabled ?? false,
    });
  }, [profile?.id]);

  function patch(fields) { setForm((f) => ({ ...f, ...fields })); }

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

  return html`
    <div class="space-y-6">
      <div class="flex items-center gap-4">
        <${AvatarEditor} profile=${profile} displayName=${form.full_name || user?.email || user?.phone} t=${t} />
        <div>
          <div class="font-semibold text-graphite-100">${form.full_name || t("profile.noName")}</div>
          <div class="text-sm text-graphite-500">${org?.name ?? ""}${org?.role ? ` · ${org.role}` : ""}</div>
          ${profile?.username && html`<div class="text-xs text-graphite-600 mt-0.5">${t("profile.publicProfileUrl", { username: profile.username })}</div>`}
          <button type="button" onClick=${() => navigate("/app/friends")} class="text-xs text-signal-300 hover:text-signal-200 mt-1">
            ${t("friends.countLabel", { count: friends.length })}
          </button>
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-x-4">
        <${Field} label=${t("profile.personal.fullNameLabel")}>
          <${TextInput} value=${form.full_name} onInput=${(e) => patch({ full_name: e.target.value })} />
        <//>
        <${Field} label=${t("profile.personal.usernameLabel")} hint=${form.username && !usernameValid ? t("profile.personal.usernameHintInvalid") : t("profile.personal.usernameHint")}>
          <${TextInput} value=${form.username} placeholder=${t("profile.personal.usernamePlaceholder")} onInput=${(e) => patch({ username: e.target.value.toLowerCase() })} />
        <//>
      </div>
      <div class="grid sm:grid-cols-2 gap-x-4">
        <${Field} label=${t("profile.personal.roleTitleLabel")} hint=${t("profile.personal.roleTitleHint")}>
          <${TextInput} value=${form.role_title} onInput=${(e) => patch({ role_title: e.target.value })} />
        <//>
        <${Field} label=${t("profile.personal.countryLabel")}>
          <${Select} options=${[{ value: "", label: t("profile.personal.countryNone") }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]} value=${form.country} onChange=${(e) => patch({ country: e.target.value })} />
        <//>
      </div>
      <${Field} label=${t("profile.personal.bioLabel")} hint=${t("profile.personal.bioHint")}>
        <${TextArea} value=${form.bio} onInput=${(e) => patch({ bio: e.target.value })} />
      <//>
      <${Field} label=${t("profile.personal.interestsLabel")} hint=${t("profile.personal.interestsHint")}>
        <${TextInput} value=${form.research_interests} placeholder=${t("profile.personal.interestsPlaceholder")} onInput=${(e) => patch({ research_interests: e.target.value })} />
      <//>

      <div class="sk-panel-flat rounded-lg p-3.5">
        <${Switch} label=${t("profile.personal.publicToggle")} checked=${form.public_profile_enabled} onChange=${(v) => patch({ public_profile_enabled: v })} />
        <p class="text-xs text-graphite-500 mt-1">${t("profile.personal.publicHint", { username: form.username || "username" })}</p>
      </div>

      <div class="flex justify-end">
        <${Button} onClick=${save} loading=${saving}>${saving ? t("common.saving") : t("profile.personal.saveButton")}<//>
      </div>

      <div class="pt-5 border-t border-graphite-800">
        <h4 class="text-sm font-semibold text-graphite-200 mb-3">${t("profile.personal.emailTitle")}</h4>
        <p class="text-sm text-graphite-400 mb-3">${t("profile.personal.emailCurrent", { email: user?.email ?? user?.phone ?? "—" })}</p>
        <div class="flex gap-2 max-w-md">
          <${TextInput} type="email" placeholder=${t("profile.personal.emailPlaceholder")} value=${emailDraft} onInput=${(e) => setEmailDraft(e.target.value)} />
          <${Button} variant="secondary" size="sm" loading=${changingEmail} disabled=${!emailDraft.trim()} onClick=${changeEmail}>${t("profile.personal.emailChange")}<//>
        </div>
        <p class="text-xs text-graphite-500 mt-1.5">${t("profile.personal.emailHint")}</p>
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
      <div class="mb-5"><${Tabs} tabs=${TABS} active=${tab} onChange=${setTab} /></div>
      <${Card} className="p-5 sm:p-7">
        ${tab === "personal" && html`<${PersonalTab} profile=${profile} user=${user} org=${org} t=${t} />`}
        ${tab === "security" && html`<${SecurityTab} t=${t} />`}
        ${tab === "notifications" && html`<${NotificationsTab} profile=${profile} t=${t} />`}
        ${tab === "preferences" && html`<${PreferencesTab} profile=${profile} t=${t} />`}
        ${tab === "sessions" && html`<${SessionsTab} user=${user} t=${t} />`}
      <//>
    </div>
  `;
}
