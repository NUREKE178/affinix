// The money side of the Arena (migration 0027), for platform admins: what the platform owes players, which tests pay and
// how much is left of their budgets, accounts the quality checks put on review, the rules, and (once a payment provider
// is connected) withdrawal requests. Every change goes through a database function that checks the admin and audits it.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Button, Badge, Modal, Skeleton, EmptyState, Field, TextInput, Checkbox, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT, getLocale } from "../../lib/i18n.js";
import {
  fetchCashOverview, fetchCashTests, fundTest, fetchCashAccounts, setCashStatus, updateCashSettings,
  fetchPayouts, decidePayout, parseTenge, formatMoney, TIYN_PER_TENGE,
} from "../../lib/cashStore.js";
import { nf, AdminError } from "./parts.js";

const money = (tiyn) => formatMoney(tiyn, getLocale());
const tenge = (tiyn) => String((Number(tiyn ?? 0) / TIYN_PER_TENGE).toFixed(Number(tiyn ?? 0) % TIYN_PER_TENGE ? 2 : 0));
const errKey = (err) => `admin.cash.err.${["not_admin", "not_owner", "bad_reward", "bad_budget", "bad_status", "not_found", "note_required", "bad_patch"].includes(err?.hint) ? err.hint : "generic"}`;

function useLoad(fn, deps) {
  const [s, set] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    set((x) => ({ ...x, loading: true, error: null }));
    fn().then((data) => !off && set({ loading: false, data, error: null }), (error) => !off && set({ loading: false, data: null, error }));
    return () => { off = true; };
  }, [...deps, tick]);
  return { ...s, reload: () => setTick((n) => n + 1) };
}

function Kpis({ d, t }) {
  const items = [
    [t("admin.cash.kpi.pending"), money(d.pending), t("admin.cash.kpi.pendingHint"), "cash-kpi-pending"],
    [t("admin.cash.kpi.available"), money(d.available), t("admin.cash.kpi.availableHint"), "cash-kpi-available"],
    [t("admin.cash.kpi.paidOut"), money(d.paidOut), d.reserved > 0 ? t("admin.cash.kpi.reserved", { amount: money(d.reserved) }) : t("admin.cash.kpi.paidOutHint"), "cash-kpi-paid"],
    [t("admin.cash.kpi.today"), money(d.earnedToday), t("admin.cash.kpi.week", { amount: money(d.earned7d), n: nf(d.earners7d) }), "cash-kpi-today"],
    [t("admin.cash.kpi.budget"), money(d.budgetLeft), t("admin.cash.kpi.budgetHint", { n: nf(d.fundedOpen) }), "cash-kpi-budget"],
  ];
  return html`
    <section class="adm-group" data-testid="admin-cash-kpis">
      <div class="sk-caption mb-2">${t("admin.cash.owed")}</div>
      <div class="sk-stat-strip sk-stat-strip-well" style=${`--cols:${items.length}`}>
        ${items.map(([label, value, hint, id]) => html`
          <div class="sk-stat" key=${id} data-testid=${id}><div class="sk-stat-label">${label}</div><div class="sk-stat-value">${value}</div><div class="sk-stat-hint">${hint}</div></div>`)}
      </div>
    </section>
  `;
}

function Rules({ d, t, onChanged }) {
  const s = d.settings;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const edit = () => {
    setForm({ hold: String(s.hold_days), month: tenge(s.monthly_cap ?? 0), rate: String(s.xp_per_tenge ?? 0),
      max: tenge(s.max_reward), min: tenge(s.min_payout), votes: String(s.min_arena_votes) });
    setOpen(true);
  };
  async function toggleEarning() {
    setBusy(true);
    try { await updateCashSettings({ earning_enabled: !s.earning_enabled }); toast(t("admin.cash.saved"), "emerald"); onChanged(); }
    catch (err) { toast(t(errKey(err)), "rose"); }
    finally { setBusy(false); }
  }
  async function save() {
    const patch = {
      hold_days: Number.parseInt(form.hold, 10), monthly_cap: parseTenge(form.month),
      xp_per_tenge: Number.parseInt(form.rate, 10), max_reward: parseTenge(form.max),
      min_payout: parseTenge(form.min), min_arena_votes: Number.parseInt(form.votes, 10),
    };
    if (Object.values(patch).some((v) => v === null || !Number.isFinite(v) || v < 0)) { toast(t("admin.cash.err.bad_patch"), "rose"); return; }
    setBusy(true);
    try { await updateCashSettings(patch); toast(t("admin.cash.saved"), "emerald"); setOpen(false); onChanged(); }
    catch (err) { toast(t(errKey(err)), "rose"); }
    finally { setBusy(false); }
  }
  const rows = [
    [t("admin.cash.rule.earning"), s.earning_enabled ? t("admin.cash.on") : t("admin.cash.off")],
    [t("admin.cash.rule.payouts"), s.payouts_enabled ? t("admin.cash.on") : t("admin.cash.payoutsOff")],
    [t("admin.cash.rule.hold"), t("admin.cash.days", { n: s.hold_days })],
    [t("admin.cash.rule.month"), money(s.monthly_cap ?? 0)],
    [t("admin.cash.rule.rate"), s.xp_per_tenge > 0 ? t("admin.cash.rate", { xp: s.xp_per_tenge }) : t("admin.cash.off")],
    [t("admin.cash.rule.max"), money(s.max_reward)],
    [t("admin.cash.rule.min"), money(s.min_payout)],
    [t("admin.cash.rule.eligible"), t("admin.cash.eligible", { h: s.min_account_hours, n: s.min_arena_votes })],
    [t("admin.cash.rule.speed"), t("admin.cash.speed", { ms: s.min_answer_ms, gap: s.min_gap_ms })],
    [t("admin.cash.rule.checks"), t("admin.cash.checks", { rate: Math.round(Number(s.check_rate) * 100), floor: Math.round(Number(s.check_floor) * 100), min: s.check_min })],
  ];
  return html`
    <section class="adm-cash-rules sk-panel" data-testid="admin-cash-rules">
      <div class="adm-cash-head">
        <span class="sk-caption">${t("admin.cash.rules")}</span>
        <div class="adm-cash-actions">
          <${Button} size="sm" variant=${s.earning_enabled ? "secondary" : "primary"} loading=${busy && !open} onClick=${toggleEarning} data-testid="admin-cash-toggle">${s.earning_enabled ? t("admin.cash.pause") : t("admin.cash.resume")}<//>
          <${Button} size="sm" variant="secondary" onClick=${edit} data-testid="admin-cash-edit"><${Icon} name="edit" size=${14} />${t("admin.cash.edit")}<//>
        </div>
      </div>
      <dl class="adm-cash-dl">${rows.map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <p class="adm-cash-note">${t("admin.cash.payoutsNote")}</p>
      <${Modal} open=${open} onClose=${() => !busy && setOpen(false)} title=${t("admin.cash.edit")}
        footer=${html`<${Button} variant="secondary" disabled=${busy} onClick=${() => setOpen(false)}>${t("common.cancel")}<//><${Button} loading=${busy} onClick=${save} data-testid="admin-cash-save">${t("common.save")}<//>`}>
        ${form && html`
          <div class="adm-cash-form">
            <${Field} label=${t("admin.cash.rule.hold")}><${TextInput} className="w-full" inputmode="numeric" value=${form.hold} onInput=${(e) => setForm({ ...form, hold: e.target.value })} /><//>
            <${Field} label=${`${t("admin.cash.rule.month")}, ₸`}><${TextInput} className="w-full" inputmode="decimal" value=${form.month} onInput=${(e) => setForm({ ...form, month: e.target.value })} data-testid="admin-cash-month" /><//>
            <${Field} label=${t("admin.cash.xpPerTenge")}><${TextInput} className="w-full" inputmode="numeric" value=${form.rate} onInput=${(e) => setForm({ ...form, rate: e.target.value })} data-testid="admin-cash-rate" /><//>
            <${Field} label=${`${t("admin.cash.rule.max")}, ₸`}><${TextInput} className="w-full" inputmode="decimal" value=${form.max} onInput=${(e) => setForm({ ...form, max: e.target.value })} /><//>
            <${Field} label=${`${t("admin.cash.rule.min")}, ₸`}><${TextInput} className="w-full" inputmode="decimal" value=${form.min} onInput=${(e) => setForm({ ...form, min: e.target.value })} /><//>
            <${Field} label=${t("admin.cash.minVotes")}><${TextInput} className="w-full" inputmode="numeric" value=${form.votes} onInput=${(e) => setForm({ ...form, votes: e.target.value })} /><//>
          </div>`}
      <//>
    </section>
  `;
}

function FundModal({ test, t, maxReward, onClose, onDone }) {
  const [reward, setReward] = useState(test ? tenge(test.reward || 1000) : "");
  const [budget, setBudget] = useState(test ? tenge(test.budget || 100000) : "");
  const [busy, setBusy] = useState(false);
  if (!test) return null;
  const r = parseTenge(reward);
  const b = parseTenge(budget);
  const answers = r && b ? Math.floor((b - test.spent) / r) : 0;
  const valid = r !== null && b !== null && r <= maxReward && b >= test.spent;
  async function save(stop = false) {
    setBusy(true);
    try {
      await fundTest(test.id, stop ? 0 : r, stop ? test.spent : b);
      toast(t(stop ? "admin.cash.fund.stopped" : "admin.cash.fund.done"), "emerald");
      onDone();
    } catch (err) { toast(t(errKey(err)), "rose"); }
    finally { setBusy(false); }
  }
  return html`
    <${Modal} open=${true} onClose=${() => !busy && onClose()} title=${t("admin.cash.fund.title")}
      footer=${html`
        ${test.reward > 0 && html`<${Button} variant="danger" disabled=${busy} onClick=${() => save(true)} data-testid="admin-fund-stop">${t("admin.cash.fund.stop")}<//>`}
        <${Button} variant="secondary" disabled=${busy} onClick=${onClose}>${t("common.cancel")}<//>
        <${Button} loading=${busy} disabled=${!valid} onClick=${() => save(false)} data-testid="admin-fund-save">${t("admin.cash.fund.save")}<//>`}>
      <p class="adm-cash-note mb-3"><b>${test.title}</b> · ${t("admin.cash.votes", { n: nf(test.votes), target: nf(test.target) })}</p>
      <div class="adm-cash-form">
        <${Field} label=${t("admin.cash.fund.reward")} hint=${t("admin.cash.fund.rewardHint", { max: money(maxReward) })}>
          <${TextInput} className="w-full" inputmode="decimal" value=${reward} onInput=${(e) => setReward(e.target.value)} data-testid="admin-fund-reward" />
        <//>
        <${Field} label=${t("admin.cash.fund.budget")} hint=${t("admin.cash.fund.budgetHint", { spent: money(test.spent) })}>
          <${TextInput} className="w-full" inputmode="decimal" value=${budget} onInput=${(e) => setBudget(e.target.value)} data-testid="admin-fund-budget" />
        <//>
      </div>
      <p class="adm-cash-note" data-testid="admin-fund-answers">${valid ? t("admin.cash.fund.answers", { n: nf(Math.max(0, answers)) }) : t("admin.cash.err.bad_reward")}</p>
    <//>
  `;
}

function Tests({ t, maxReward, onChanged }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  useEffect(() => { const id = setTimeout(() => setQuery(text.trim()), 300); return () => clearTimeout(id); }, [text]);
  const s = useLoad(() => fetchCashTests(query, 30), [query]);
  return html`
    <section class="adm-cash-block sk-panel" data-testid="admin-cash-tests">
      <div class="adm-cash-head">
        <span class="sk-caption">${t("admin.cash.tests")}</span>
        <${TextInput} className="adm-cash-search" placeholder=${t("admin.cash.search")} value=${text} onInput=${(e) => setText(e.target.value)} />
      </div>
      <p class="adm-cash-note">${t("admin.cash.testsNote")}</p>
      ${s.loading && !s.data ? html`<${Skeleton} className="h-24 w-full rounded-xl" />`
        : s.error ? html`<${AdminError} error=${s.error} t=${t} onRetry=${s.reload} />`
        : (s.data ?? []).length === 0 ? html`<p class="adm-cash-note">${t("admin.cash.noTests")}</p>`
        : html`
          <ul class="adm-cash-rows">
            ${s.data.map((x) => html`
              <li key=${x.id} class="adm-cash-row" data-testid="admin-cash-test" data-funded=${x.reward > 0}>
                <div class="adm-cash-main">
                  <div class="adm-cash-title">${x.title} ${x.status !== "open" && html`<${Badge} tone="steel">${t("admin.cash.closed")}<//>`}</div>
                  <div class="adm-cash-sub">${x.owner?.name ?? x.owner?.username ?? "—"} · ${t("admin.cash.votes", { n: nf(x.votes), target: nf(x.target) })}</div>
                </div>
                <div class="adm-cash-money sk-num">
                  ${x.reward > 0
                    ? html`<b>${money(x.reward)}</b><span>${t("admin.cash.spent", { spent: money(x.spent), budget: money(x.budget) })}</span>`
                    : html`<span>${t("admin.cash.unfunded")}</span>`}
                </div>
                <${Button} size="sm" variant=${x.reward > 0 ? "secondary" : "primary"} disabled=${x.status !== "open"} onClick=${() => setEditing(x)} data-testid="admin-cash-fund">${x.reward > 0 ? t("admin.cash.change") : t("admin.cash.fund.action")}<//>
              </li>`)}
          </ul>`}
      ${editing && html`<${FundModal} key=${editing.id} test=${editing} t=${t} maxReward=${maxReward} onClose=${() => setEditing(null)} onDone=${() => { setEditing(null); s.reload(); onChanged(); }} />`}
    </section>
  `;
}

const STATUS_TONE = { ok: "emerald", review: "amber", blocked: "rose" };

function Accounts({ t, onChanged }) {
  const s = useLoad(() => fetchCashAccounts(null, 50), []);
  const [act, setAct] = useState(null); // { row, status }
  const [note, setNote] = useState("");
  const [voidAvail, setVoidAvail] = useState(false);
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    try {
      await setCashStatus(act.row.userId, act.status, note.trim() || null, act.status === "blocked" && voidAvail);
      toast(t("admin.cash.saved"), "emerald");
      setAct(null); setNote(""); setVoidAvail(false); s.reload(); onChanged();
    } catch (err) { toast(t(errKey(err)), "rose"); }
    finally { setBusy(false); }
  }
  return html`
    <section class="adm-cash-block sk-panel" data-testid="admin-cash-accounts">
      <div class="adm-cash-head"><span class="sk-caption">${t("admin.cash.accounts")}</span></div>
      <p class="adm-cash-note">${t("admin.cash.accountsNote")}</p>
      ${s.loading && !s.data ? html`<${Skeleton} className="h-24 w-full rounded-xl" />`
        : s.error ? html`<${AdminError} error=${s.error} t=${t} onRetry=${s.reload} />`
        : (s.data ?? []).length === 0 ? html`<p class="adm-cash-note">${t("admin.cash.noAccounts")}</p>`
        : html`
          <ul class="adm-cash-rows">
            ${s.data.map((a) => html`
              <li key=${a.userId} class="adm-cash-row" data-testid="admin-cash-account" data-status=${a.status}>
                <div class="adm-cash-main">
                  <div class="adm-cash-title">${a.name ?? a.username ?? "—"} <${Badge} tone=${STATUS_TONE[a.status]}>${t(`admin.cash.status.${a.status}`)}<//></div>
                  <div class="adm-cash-sub">
                    ${a.checks > 0 ? t("admin.cash.consistency", { p: Math.round((a.consistent / a.checks) * 100), n: a.checks }) : t("admin.cash.noChecks")}
                    ${a.note ? ` · ${a.note}` : ""}
                  </div>
                </div>
                <div class="adm-cash-money sk-num"><b>${money(a.available)}</b><span>${t("admin.cash.pendingShort", { amount: money(a.pending) })}</span></div>
                <div class="adm-cash-actions">
                  ${a.status !== "ok" && html`<${Button} size="sm" variant="secondary" onClick=${() => setAct({ row: a, status: "ok" })} data-testid="admin-cash-approve">${t("admin.cash.approve")}<//>`}
                  ${a.status === "ok" && html`<${Button} size="sm" variant="secondary" onClick=${() => setAct({ row: a, status: "review" })}>${t("admin.cash.toReview")}<//>`}
                  ${a.status !== "blocked" && html`<${Button} size="sm" variant="danger" onClick=${() => setAct({ row: a, status: "blocked" })} data-testid="admin-cash-block">${t("admin.cash.block")}<//>`}
                </div>
              </li>`)}
          </ul>`}
      <${Modal} open=${!!act} onClose=${() => !busy && setAct(null)} title=${act ? t(`admin.cash.confirm.${act.status}`, { name: act.row.name ?? act.row.username ?? "" }) : ""}
        footer=${html`<${Button} variant="secondary" disabled=${busy} onClick=${() => setAct(null)}>${t("common.cancel")}<//><${Button} variant=${act?.status === "blocked" ? "danger" : "primary"} loading=${busy} onClick=${apply} data-testid="admin-cash-status-yes">${t("common.save")}<//>`}>
        ${act && html`
          <p class="adm-cash-note mb-3">${t(`admin.cash.confirmBody.${act.status}`)}</p>
          <${Field} label=${t("admin.cash.note")}><${TextInput} className="w-full" value=${note} maxlength="300" onInput=${(e) => setNote(e.target.value)} /><//>
          ${act.status === "blocked" && html`<${Checkbox} label=${t("admin.cash.voidAvailable", { amount: money(act.row.available) })} checked=${voidAvail} onChange=${(e) => setVoidAvail(e.target.checked)} />`}`}
      <//>
    </section>
  `;
}

function Payouts({ t, onChanged }) {
  const s = useLoad(() => fetchPayouts("requested", 50), []);
  const [busy, setBusy] = useState(null);
  async function decide(id, decision) {
    setBusy(id);
    try { await decidePayout(id, decision); toast(t("admin.cash.saved"), "emerald"); s.reload(); onChanged(); }
    catch (err) { toast(t(errKey(err)), "rose"); }
    finally { setBusy(null); }
  }
  const rows = s.data ?? [];
  return html`
    <section class="adm-cash-block sk-panel" data-testid="admin-cash-payouts">
      <div class="adm-cash-head"><span class="sk-caption">${t("admin.cash.payouts")}</span></div>
      ${rows.length === 0
        ? html`<p class="adm-cash-note">${t("admin.cash.noPayouts")}</p>`
        : html`
          <ul class="adm-cash-rows">
            ${rows.map((r) => html`
              <li key=${r.id} class="adm-cash-row">
                <div class="adm-cash-main"><div class="adm-cash-title">${r.name ?? r.username}</div><div class="adm-cash-sub">${new Date(r.createdAt).toLocaleString(getLocale())}</div></div>
                <div class="adm-cash-money sk-num"><b>${money(r.amount)}</b></div>
                <div class="adm-cash-actions">
                  <${Button} size="sm" loading=${busy === r.id} onClick=${() => decide(r.id, "paid")}>${t("admin.cash.markPaid")}<//>
                  <${Button} size="sm" variant="danger" disabled=${busy === r.id} onClick=${() => decide(r.id, "rejected")}>${t("admin.cash.reject")}<//>
                </div>
              </li>`)}
          </ul>`}
    </section>
  `;
}

export function AdminCash() {
  const t = useT();
  const o = useLoad(() => fetchCashOverview(), []);
  if (o.error) {
    const pending = o.error?.pending;
    return pending
      ? html`<${EmptyState} title=${t("admin.pendingTitle")} body=${t("admin.cash.pendingBody")} icon="wallet" />`
      : html`<${AdminError} error=${o.error} t=${t} onRetry=${o.reload} />`;
  }
  if (o.loading && !o.data) return html`<div class="space-y-4"><${Skeleton} className="h-20 w-full rounded-xl" /><${Skeleton} className="h-40 w-full rounded-xl" /></div>`;
  const d = o.data;
  return html`
    <div class="adm-stack" data-testid="admin-cash">
      ${d.review > 0 && html`
        <section class="adm-attention sk-panel" data-flagged=${d.review}>
          <${Icon} name="shield" size=${20} />
          <div class="adm-attention-text">
            <div class="adm-attention-title">${t("admin.overview.attention")}</div>
            <div class="adm-attention-body">${t("admin.cash.reviewBody", { n: d.review })}</div>
          </div>
        </section>`}
      <${Kpis} d=${d} t=${t} />
      <${Tests} t=${t} maxReward=${d.settings.max_reward} onChanged=${o.reload} />
      <${Accounts} t=${t} onChanged=${o.reload} />
      ${(d.settings.payouts_enabled || d.openPayouts > 0) && html`<${Payouts} t=${t} onChanged=${o.reload} />`}
      <${Rules} d=${d} t=${t} onChanged=${o.reload} />
    </div>
  `;
}
