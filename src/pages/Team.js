// The company's team: who works on the shared experiments and what each role may do. The platform "owner" is a
// different thing (one person, shown on the profile); inside a company the person who created it is the founder.
import { html, useState, useEffect } from "../lib/preact.js";
import { useCurrentOrg, invalidateOrgs } from "../lib/currentOrg.js";
import { useSession } from "../lib/auth.js";
import { fetchOrgMembers, addMemberByEmail, updateMemberRole, removeMember } from "../lib/org.js";
import { requireSupabase } from "../lib/supabaseClient.js";
import { fetchAuthorsById } from "../lib/postsStore.js";
import { platformRoleOf } from "../lib/platformRole.js";
import { Card, SectionHeading, Badge, Button, Modal, Field, TextInput, Select, EmptyState, toast, Skeleton } from "../components/ui.js";
import { Icon } from "../components/icons.js";
import { Avatar } from "../components/avatar.js";
import { PersonLink } from "../components/profileViewer.js";
import { PlatformBadge } from "../components/platformBadge.js";
import { useT } from "../lib/i18n.js";
import { shortDate } from "../lib/format.js";
import { navigate } from "../router.js";
import { SettingsTabs } from "../components/subNav.js";

const ROLE_TONE = { owner: "signal", admin: "steel", researcher: "neutral", viewer: "neutral" };
const ROLE_ORDER = ["owner", "admin", "researcher", "viewer"];
// what each role may do -- mirrors the row-level security policies in supabase/migrations/0002_rls.sql and 0016
const MATRIX = [
  ["view", [1, 1, 1, 1]],
  ["edit", [1, 1, 1, 0]],
  ["members", [1, 1, 0, 0]],
  ["settings", [1, 1, 0, 0]],
  ["destroy", [1, 0, 0, 0]],
];

async function fetchExperimentStats(orgId) {
  const { data, error } = await requireSupabase().from("experiments").select("id, created_by, status").eq("organization_id", orgId);
  if (error) throw error;
  const byUser = {};
  let published = 0;
  for (const e of data ?? []) {
    byUser[e.created_by] = (byUser[e.created_by] ?? 0) + 1;
    if (e.status === "published") published += 1;
  }
  return { total: (data ?? []).length, published, byUser };
}

function RoleMatrix() {
  const t = useT();
  return html`
    <${Card} className="tm-matrix" data-testid="team-matrix">
      <div class="tm-matrix-head">
        <div class="sk-caption">${t("team.matrix.title")}</div>
        <p>${t("team.matrix.hint")}</p>
      </div>
      <div class="tm-matrix-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              ${ROLE_ORDER.map((r) => html`<th key=${r}>${t(`team.roles.${r}`)}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${MATRIX.map(([row, cells]) => html`
              <tr key=${row}>
                <td>${t(`team.matrix.${row}`)}</td>
                ${cells.map((on, i) => html`<td key=${i} data-on=${on ? "1" : "0"} aria-label=${on ? "✓" : "—"}>${on ? html`<${Icon} name="check" size=${15} strokeWidth=${2.4} />` : html`<span aria-hidden="true">·</span>`}</td>`)}
              </tr>
            `)}
          </tbody>
        </table>
      </div>
      <ul class="tm-matrix-list">
        ${MATRIX.map(([row, cells]) => html`
          <li key=${row}>
            <span>${t(`team.matrix.${row}`)}</span>
            <div>${ROLE_ORDER.filter((_, i) => cells[i]).map((r) => html`<i key=${r}>${t(`team.roles.${r}`)}</i>`)}</div>
          </li>
        `)}
      </ul>
    </${Card}>
  `;
}

export function Team() {
  const t = useT();
  const { org, loading: orgLoading } = useCurrentOrg();
  const { user } = useSession();
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState({ total: 0, published: 0, byUser: {} });
  const [platform, setPlatform] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("researcher");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { member, self }

  const ROLES = [
    { value: "admin", label: t("team.roles.admin") },
    { value: "researcher", label: t("team.roles.researcher") },
    { value: "viewer", label: t("team.roles.viewer") },
  ];

  async function load() {
    if (!org) return;
    setLoading(true);
    try {
      const list = await fetchOrgMembers(org.id);
      setMembers(list);
      const [s, people] = await Promise.all([
        fetchExperimentStats(org.id).catch(() => ({ total: 0, published: 0, byUser: {} })),
        fetchAuthorsById(list.map((m) => m.userId)).catch(() => ({})),
      ]);
      setStats(s);
      setPlatform(people);
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
      toast(t("team.roleChanged"), "emerald");
      await load();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    }
  }

  async function confirmRemove() {
    const { member, self } = confirm;
    setBusy(true);
    try {
      await removeMember(member.id);
      setConfirm(null);
      if (self) {
        toast(t("team.left"), "emerald");
        invalidateOrgs();
        navigate("/app");
        return;
      }
      toast(t("team.removed"), "emerald");
      await load();
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusy(false);
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

  const alone = members.length <= 1;
  const nameOf = (m) => m.fullName || m.email || m.name;

  return html`
    <div class="fade-in max-w-3xl tm" data-testid="team-page">
      <${SettingsTabs} current="team" />
      <${SectionHeading} title=${t("team.title")} subtitle=${t("team.subtitle")}
        action=${canManage && html`<${Button} onClick=${() => setOpen(true)} data-testid="team-add"><${Icon} name="plus" size=${16}/> ${t("team.addMember")}<//>`} />

      <div class="tm-purpose" data-testid="team-purpose">
        <${Icon} name="team" size=${20} />
        <div>
          <b>${t("team.purpose.title")}</b>
          <p>${t("team.purpose.body")}</p>
        </div>
      </div>

      <div class="tm-kpis" data-testid="team-kpis">
        <div><span class="sk-num" data-testid="team-kpi-members">${members.length}</span><small>${t("team.kpi.members")}</small></div>
        <div><span class="sk-num" data-testid="team-kpi-experiments">${stats.total}</span><small>${t("team.kpi.experiments")}</small></div>
        <div><span class="sk-num" data-testid="team-kpi-published">${stats.published}</span><small>${t("team.kpi.published")}</small></div>
      </div>

      ${alone && html`
        <div class="mb-4" data-testid="team-alone">
          <${EmptyState} icon="userPlus" title=${t("team.emptyTitle")} body=${t("team.emptyBody")}
            action=${canManage && html`<${Button} onClick=${() => setOpen(true)}><${Icon} name="plus" size=${16}/> ${t("team.addMember")}<//>`} />
        </div>
      `}

      <${Card} className="divide-y divide-graphite-800" data-testid="team-members">
        ${members.map((m) => {
          const mine = m.userId === user?.id;
          const platformRole = platformRoleOf(platform[m.userId]);
          const count = stats.byUser[m.userId] ?? 0;
          const canEditRole = canManage && m.role !== "owner" && !mine;
          const canRemove = canManage && m.role !== "owner" && !mine;
          const canLeave = mine && m.role !== "owner";
          return html`
            <div key=${m.id} class="tm-row" data-testid="team-member" data-role=${m.role} data-self=${mine ? "1" : "0"}>
              <${PersonLink} who=${{ id: m.userId, name: m.fullName, avatarUrl: m.avatarUrl }} className="sk-person-grow">
                <${Avatar} name=${m.name} url=${m.avatarUrl} size=${38} />
                <div class="min-w-0">
                  <div class="tm-name">
                    <span class="sk-person-name truncate">${m.name}</span>
                    ${mine && html`<i class="tm-you">${t("team.you")}</i>`}
                    ${platformRole && html`<${PlatformBadge} role=${platformRole} />`}
                  </div>
                  <div class="text-xs text-graphite-500 truncate">${m.email}</div>
                  <div class="tm-meta">
                    <span class="sk-num">${t("team.experimentsCount", { n: count })}</span>
                    ${m.joinedAt && html`<span>${t("team.since", { date: shortDate(m.joinedAt) })}</span>`}
                  </div>
                </div>
              <//>
              <div class="tm-actions">
                ${canEditRole
                  ? html`<${Select} className="w-auto text-xs" options=${ROLES} value=${m.role} onChange=${(e) => changeRole(m.id, e.target.value)} aria-label=${t("team.roleLabel")} data-testid="team-role-select" />`
                  : html`<span title=${m.role === "owner" ? t("team.founderHint") : t(`team.roleDesc.${m.role}`)}><${Badge} tone=${ROLE_TONE[m.role] ?? "neutral"}>${t(`team.roles.${m.role}`)}<//></span>`}
                ${canRemove && html`<button type="button" class="tm-icon-btn" onClick=${() => setConfirm({ member: m, self: false })} aria-label=${t("common.delete")} data-testid="team-remove"><${Icon} name="trash" size=${15} /></button>`}
                ${canLeave && html`<${Button} variant="secondary" size="sm" onClick=${() => setConfirm({ member: m, self: true })} data-testid="team-leave">${t("team.leave")}<//>`}
              </div>
            </div>
          `;
        })}
      <//>

      <${RoleMatrix} />

      <${Modal} open=${!!confirm} onClose=${() => !busy && setConfirm(null)}
        title=${confirm ? (confirm.self ? t("team.leaveTitle") : t("team.removeTitle", { name: nameOf(confirm.member) })) : ""}
        footer=${html`<${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => setConfirm(null)}>${t("common.cancel")}<//><${Button} variant="danger" size="sm" loading=${busy} onClick=${confirmRemove} data-testid="team-confirm">${confirm?.self ? t("team.leave") : t("common.delete")}<//>`}>
        <p class="text-sm text-graphite-400">${confirm ? t(confirm.self ? "team.leaveBody" : "team.removeBody") : ""}</p>
      <//>

      <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t("team.modalTitle")}
        footer=${html`<${Button} variant="secondary" size="sm" onClick=${() => setOpen(false)}>${t("common.cancel")}<//><${Button} size="sm" loading=${busy} disabled=${!email.trim()} onClick=${invite} data-testid="team-invite-send">${busy ? t("team.adding") : t("team.addMember")}<//>`}>
        ${error && html`<div class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">${error}</div>`}
        <p class="text-xs text-graphite-500 mb-4">${t("team.inviteHint")}</p>
        <${Field} label=${t("team.emailLabel")}><${TextInput} type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} placeholder="jane@company.com" data-testid="team-invite-email" /><//>
        <${Field} label=${t("team.roleLabel")} hint=${t(`team.roleDesc.${role}`)}><${Select} options=${ROLES} value=${role} onChange=${(e) => setRole(e.target.value)} /><//>
      <//>
    </div>
  `;
}
