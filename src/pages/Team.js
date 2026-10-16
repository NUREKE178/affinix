import { html, useState, useEffect } from "../lib/preact.js";
import { useCurrentOrg } from "../lib/currentOrg.js";
import { useSession } from "../lib/auth.js";
import { fetchOrgMembers, addMemberByEmail, updateMemberRole, removeMember } from "../lib/org.js";
import { Card, SectionHeading, Badge, Button, Modal, Field, TextInput, Select, toast, Skeleton } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { Avatar } from "../components/avatar.js";
import { PersonLink } from "../components/profileViewer.js";
import { useT } from "../lib/i18n.js";
import { SettingsTabs } from "../components/subNav.js";

const ROLE_TONE = { owner: "signal", admin: "steel", researcher: "neutral", viewer: "neutral" };

export function Team() {
  const t = useT();
  const { org, loading: orgLoading } = useCurrentOrg();
  const { user } = useSession();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("researcher");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const ROLES = [
    { value: "owner", label: t("team.roles.owner") },
    { value: "admin", label: t("team.roles.admin") },
    { value: "researcher", label: t("team.roles.researcher") },
    { value: "viewer", label: t("team.roles.viewer") },
  ];

  async function load() {
    if (!org) return;
    setLoading(true);
    try {
      setMembers(await fetchOrgMembers(org.id));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [org?.id]);

  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  async function invite() {
    setError(null);
    setBusy(true);
    try {
      const result = await addMemberByEmail(org.id, email.trim(), role);
      setEmail(""); setRole("researcher"); setOpen(false);
      toast(result.status === "invited" ? t("team.inviteSent", { email: result.email }) : t("team.memberAdded"));
      await load();
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(memberId, newRole) {
    try {
      await updateMemberRole(memberId, newRole);
      await load();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  async function remove(memberId) {
    try {
      await removeMember(memberId);
      await load();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  if (orgLoading || loading) {
    return html`
      <div class="fade-in max-w-3xl">
        <${SettingsTabs} current="team" />
        <div class="flex items-start justify-between gap-3 mb-5">
          <div>
            <${Skeleton} className="h-6 w-32" />
            <${Skeleton} className="h-4 w-56 mt-2" />
          </div>
          <${Skeleton} className="h-9 w-36 rounded-lg" />
        </div>
        <${Card} className="divide-y divide-graphite-800">
          ${[0, 1, 2].map((i) => html`
            <div key=${i} class="flex items-center justify-between gap-3 px-5 py-4">
              <div class="flex items-center gap-3 min-w-0">
                <${Skeleton} className="h-9 w-9 rounded-full shrink-0" />
                <div>
                  <${Skeleton} className="h-4 w-32" />
                  <${Skeleton} className="h-3 w-40 mt-1.5" />
                </div>
              </div>
              <${Skeleton} className="h-6 w-20 rounded-full" />
            </div>
          `)}
        <//>
      </div>
    `;
  }

  return html`
    <div class="fade-in max-w-3xl">
      <${SettingsTabs} current="team" />
      <${SectionHeading} title=${t("team.title")} subtitle=${t("team.subtitle")}
        action=${canManage && html`<${Button} onClick=${() => setOpen(true)}><${Icon} name="plus" size=${16}/> ${t("team.addMember")}<//>`} />

      <${Card} className="divide-y divide-graphite-800">
        ${members.map(
          (m) => html`
            <div key=${m.id} class="flex items-center justify-between gap-3 px-5 py-4">
              <${PersonLink} who=${{ id: m.userId, name: m.fullName, avatarUrl: m.avatarUrl }} className="sk-person-grow">
                <${Avatar} name=${m.name} url=${m.avatarUrl} size=${36} />
                <div class="min-w-0">
                  <div class="text-sm font-medium text-graphite-100 truncate sk-person-name">${m.name}</div>
                  <div class="text-xs text-graphite-500 truncate">${m.email}</div>
                </div>
              <//>
              <div class="flex items-center gap-3 shrink-0">
                ${canManage && m.role !== "owner"
                  ? html`<${Select} className="w-auto text-xs" options=${ROLES.filter((r) => r.value !== "owner")} value=${m.role} onChange=${(e) => changeRole(m.id, e.target.value)} />`
                  : html`<${Badge} tone=${ROLE_TONE[m.role] ?? "neutral"}>${t(`team.roles.${m.role}`) ?? m.role}<//>`}
                ${canManage && m.role !== "owner" && html`<button onClick=${() => remove(m.id)} class="text-graphite-500 hover:text-rose-400"><${Icon} name="trash" size=${15} /></button>`}
              </div>
            </div>
          `
        )}
      <//>

      <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t("team.modalTitle")}
        footer=${html`<${Button} variant="secondary" size="sm" onClick=${() => setOpen(false)}>${t("common.cancel")}<//><${Button} size="sm" loading=${busy} disabled=${!email.trim()} onClick=${invite}>${busy ? t("team.adding") : t("team.addMember")}<//>`}>
        ${error && html`<div class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">${error}</div>`}
        <p class="text-xs text-graphite-500 mb-4">${t("team.inviteHint")}</p>
        <${Field} label=${t("team.emailLabel")}><${TextInput} type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="jane@company.com" /><//>
        <${Field} label=${t("team.roleLabel")}><${Select} options=${ROLES.filter((r) => r.value !== "owner")} value=${role} onChange=${(e) => setRole(e.target.value)} /><//>
      <//>
    </div>
  `;
}
