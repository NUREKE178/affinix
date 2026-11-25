// Wallet tab: the money bonus from research missions (migration 0027). What is available, what is still in its holding
// period, the way to a bank transfer (switched off until a payment provider is connected), the history and the rules.
// Every number comes from the server (cash_wallet); this screen computes nothing that matters.
import { html, useState } from "../../lib/preact.js";
import { Button, Badge, ProgressBar, Skeleton, EmptyState, Modal, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { dayMonth } from "../../lib/format.js";
import { navigate } from "../../router.js";
import { useWallet, requestPayout, payoutProgress, daysUntil } from "../../lib/cashStore.js";
import { money } from "./parts.js";

const day = (iso) => dayMonth(iso);

function StatusNote({ wallet, t }) {
  const e = wallet.eligibility ?? {};
  if (wallet.status === "blocked") {
    return html`<div class="ar-wl-note" data-tone="bad" data-testid="wallet-status"><${Icon} name="lock" size=${16} /><span>${t("cash.status.blocked")}</span></div>`;
  }
  if (wallet.status === "review") {
    return html`<div class="ar-wl-note" data-tone="warn" data-testid="wallet-status"><${Icon} name="shield" size=${16} /><span>${t("cash.status.review")}</span></div>`;
  }
  if (!wallet.rules?.earningEnabled) {
    return html`<div class="ar-wl-note" data-tone="warn" data-testid="wallet-status"><${Icon} name="clock" size=${16} /><span>${t("cash.status.off")}</span></div>`;
  }
  if (e.reason === "need_play") {
    return html`
      <div class="ar-wl-note" data-tone="info" data-testid="wallet-status">
        <${Icon} name="arena" size=${16} />
        <div class="ar-wl-note-main">
          <span>${t("cash.status.needPlay", { n: e.needVotes, done: e.votes })}</span>
          <${ProgressBar} value=${Math.min(1, (e.votes ?? 0) / Math.max(1, e.needVotes ?? 1))} />
        </div>
        <${Button} size="sm" variant="secondary" onClick=${() => navigate("/app/arena")}>${t("cash.status.play")}<//>
      </div>`;
  }
  if (e.reason === "new_account") {
    return html`<div class="ar-wl-note" data-tone="info" data-testid="wallet-status"><${Icon} name="clock" size=${16} /><span>${t("cash.status.newAccount", { date: day(e.readyAt) })}</span></div>`;
  }
  return null;
}

function Balance({ wallet, t }) {
  const days = daysUntil(wallet.nextRelease?.at);
  return html`
    <section class="ar-wl-balance sk-panel" data-testid="wallet-balance">
      <div class="ar-wl-top">
        <span class="sk-tile"><${Icon} name="wallet" size=${15} /></span>
        <span class="sk-caption">${t("cash.available")}</span>
      </div>
      <div class="ar-wl-big sk-num" data-testid="wallet-available">${money(wallet.available)}</div>
      <div class="sk-stat-strip sk-stat-strip-well" style="--cols:3">
        <div class="sk-stat" data-testid="wallet-pending">
          <div class="sk-stat-label">${t("cash.pending")}</div>
          <div class="sk-stat-value">${money(wallet.pending)}</div>
          <div class="sk-stat-hint">${wallet.pending > 0 && wallet.nextRelease ? (days > 0 ? t("cash.nextRelease", { amount: money(wallet.nextRelease.amount), days }) : t("cash.releasing")) : t("cash.holdHint", { days: wallet.rules?.holdDays ?? 7 })}</div>
        </div>
        <div class="sk-stat" data-testid="wallet-today">
          <div class="sk-stat-label">${t("cash.today")}</div>
          <div class="sk-stat-value">${money(wallet.today)}</div>
          <div class="sk-stat-hint">${t("cash.dailyCap", { cap: money(wallet.rules?.dailyCap ?? 0) })}</div>
        </div>
        <div class="sk-stat" data-testid="wallet-total">
          <div class="sk-stat-label">${t("cash.earnedTotal")}</div>
          <div class="sk-stat-value">${money(wallet.earnedTotal)}</div>
          <div class="sk-stat-hint">${wallet.paidOut > 0 ? t("cash.paidOut", { amount: money(wallet.paidOut) }) : t("cash.earnedHint")}</div>
        </div>
      </div>
    </section>
  `;
}

function Withdraw({ wallet, t }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = payoutProgress(wallet);
  const open = wallet.rules?.payoutsEnabled;
  const can = open && p.ready && wallet.status === "ok" && !wallet.openPayout;

  async function send() {
    setBusy(true);
    try {
      await requestPayout(wallet.available);
      toast(t("cash.payout.sent"), "emerald");
      setAsking(false);
    } catch (err) {
      toast(t(`cash.payout.err.${["payouts_closed", "below_min", "too_much", "open_request", "not_allowed"].includes(err.hint) ? err.hint : "generic"}`), "rose");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <section class="ar-wl-out sk-panel" data-testid="wallet-withdraw" data-open=${!!open}>
      <div class="ar-wl-top">
        <span class="sk-tile"><${Icon} name="card" size=${15} /></span>
        <span class="sk-caption">${t("cash.payout.title")}</span>
        ${!open && html`<${Badge} tone="steel">${t("cash.payout.soon")}<//>`}
      </div>
      <p class="ar-wl-text">${open ? t("cash.payout.openBody", { min: money(wallet.rules?.minPayout ?? 0) }) : t("cash.payout.closedBody")}</p>
      <div class="ar-wl-progress">
        <${ProgressBar} value=${p.ratio} />
        <span class="sk-num ar-wl-progress-num">${money(wallet.available)}<span class="sk-unit">/ ${money(wallet.rules?.minPayout ?? 0)}</span></span>
      </div>
      <p class="ar-wl-small">${p.ready ? t("cash.payout.ready") : t("cash.payout.missing", { amount: money(p.missing) })}</p>
      ${wallet.openPayout
        ? html`<div class="ar-wl-note" data-tone="info" data-testid="wallet-open-payout"><${Icon} name="clock" size=${16} /><span>${t("cash.payout.waiting", { amount: money(wallet.openPayout.amount), date: day(wallet.openPayout.createdAt) })}</span></div>`
        : open && html`<${Button} disabled=${!can} onClick=${() => setAsking(true)} data-testid="wallet-request">${t("cash.payout.request")}<//>`}
      <${Modal} open=${asking} onClose=${() => !busy && setAsking(false)} title=${t("cash.payout.confirmTitle")}
        footer=${html`
          <${Button} variant="secondary" disabled=${busy} onClick=${() => setAsking(false)}>${t("common.cancel")}<//>
          <${Button} loading=${busy} onClick=${send} data-testid="wallet-request-yes">${t("cash.payout.request")}<//>`}>
        <p>${t("cash.payout.confirmBody", { amount: money(wallet.available) })}</p>
      <//>
    </section>
  `;
}

function rowLabel(r, t) {
  if (r.kind === "payout") return t("cash.row.payout");
  if (r.kind === "adjustment") return t("cash.row.adjustment");
  return r.test?.title ?? t("cash.row.mission");
}

function rowState(r, t) {
  if (r.state === "void") return html`<${Badge} tone="rose">${r.kind === "payout" ? t("cash.state.rejected") : t("cash.state.void")}<//>`;
  if (r.state === "settled") return html`<${Badge} tone="emerald">${t("cash.state.settled")}<//>`;
  if (r.state === "available") return html`<${Badge} tone="emerald">${t("cash.state.available")}<//>`;
  if (r.kind === "payout") return html`<${Badge} tone="amber">${t("cash.state.requested")}<//>`;
  return html`<${Badge} tone="steel">${t("cash.state.pending", { date: day(r.availableAt) })}<//>`;
}

function History({ wallet, t }) {
  const rows = wallet.history ?? [];
  return html`
    <section class="ar-wl-hist sk-panel" data-testid="wallet-history">
      <div class="ar-wl-top">
        <span class="sk-tile"><${Icon} name="reports" size=${15} /></span>
        <span class="sk-caption">${t("cash.history")}</span>
      </div>
      ${rows.length === 0
        ? html`<p class="ar-wl-text" data-testid="wallet-history-empty">${t("cash.historyEmpty")}</p>`
        : html`
          <ul class="ar-wl-rows">
            ${rows.map((r) => html`
              <li key=${r.id} class="ar-wl-row" data-state=${r.state} data-kind=${r.kind} data-testid="wallet-row">
                <div class="ar-wl-row-main">
                  <div class="ar-wl-row-title">${rowLabel(r, t)}</div>
                  <div class="ar-wl-row-sub">${day(r.at)}${r.note ? ` · ${r.note}` : ""}</div>
                </div>
                ${rowState(r, t)}
                <span class="sk-num ar-wl-amount" data-sign=${r.amount < 0 ? "minus" : "plus"}>${r.amount > 0 ? "+" : "−"}${money(Math.abs(r.amount))}</span>
              </li>`)}
          </ul>`}
    </section>
  `;
}

function HowTo({ wallet, t }) {
  const r = wallet?.rules ?? {};
  const steps = [
    { icon: "arena", title: t("cash.how.s1Title", { n: r.minArenaVotes ?? 30 }), body: t("cash.how.s1Body") },
    { icon: "wallet", title: t("cash.how.s2Title"), body: t("cash.how.s2Body") },
    { icon: "clock", title: t("cash.how.s3Title", { days: r.holdDays ?? 7 }), body: t("cash.how.s3Body") },
  ];
  return html`
    <section class="ar-wl-how sk-panel" data-testid="wallet-how">
      <div class="ar-wl-top"><span class="sk-tile"><${Icon} name="sparkle" size=${15} /></span><span class="sk-caption">${t("cash.how.title")}</span></div>
      <ol class="ar-wl-steps">
        ${steps.map((s, i) => html`
          <li key=${i}>
            <span class="ar-wl-step-n sk-num">${i + 1}</span>
            <div><b>${s.title}</b><p>${s.body}</p></div>
          </li>`)}
      </ol>
      <div class="ar-wl-top ar-wl-top-gap"><span class="sk-tile"><${Icon} name="shield" size=${15} /></span><span class="sk-caption">${t("cash.rules.title")}</span></div>
      <ul class="ar-wl-rules">
        <li>${t("cash.rules.funded")}</li>
        <li>${t("cash.rules.cap", { cap: money(r.dailyCap ?? 0) })}</li>
        <li>${t("cash.rules.hold", { days: r.holdDays ?? 7 })}</li>
        <li>${t("cash.rules.quality")}</li>
        <li>${t("cash.rules.fair")}</li>
        <li>${t("cash.rules.payout", { min: money(r.minPayout ?? 0) })}</li>
      </ul>
      <div class="ar-wl-top ar-wl-top-gap"><span class="sk-tile"><${Icon} name="heart" size=${15} /></span><span class="sk-caption">${t("cash.why.title")}</span></div>
      <p class="ar-wl-text">${t("cash.why.body")}</p>
    </section>
  `;
}

export function WalletTab() {
  const t = useT();
  const { wallet, loading, pending, error, reload } = useWallet();
  if (pending) {
    return html`<${EmptyState} title=${t("cash.pendingTitle")} body=${t("cash.pendingBody")} icon="wallet" />`;
  }
  if (loading && !wallet) {
    return html`<div class="ar-wl-grid"><${Skeleton} className="h-48 w-full rounded-xl" /><${Skeleton} className="h-48 w-full rounded-xl" /></div>`;
  }
  if (!wallet) {
    return html`<${EmptyState} title=${t("cash.errorTitle")} body=${t("cash.errorBody")} icon="wallet" action=${html`<${Button} onClick=${reload}>${t("common.retry")}<//>`} />`;
  }
  return html`
    <div class="ar-wl-grid sk-stagger" data-testid="wallet-tab" data-status=${wallet.status}>
      <div class="ar-wl-col">
        <${StatusNote} wallet=${wallet} t=${t} />
        <${Balance} wallet=${wallet} t=${t} />
        <${Withdraw} wallet=${wallet} t=${t} />
        <${History} wallet=${wallet} t=${t} />
        ${error && html`<p class="ar-wl-small">${t("cash.staleNote")}</p>`}
      </div>
      <${HowTo} wallet=${wallet} t=${t} />
    </div>
  `;
}

/** The header chip: the whole balance (available + pending), a way into the tab. Shown once there is something in it. */
export function WalletChip() {
  const t = useT();
  const { wallet } = useWallet();
  if (!wallet || !(wallet.earnedTotal > 0 || wallet.available > 0)) return null;
  return html`
    <button type="button" class="ar-wallet-chip" onClick=${() => navigate("/app/arena?tab=wallet")} title=${t("cash.chipTitle")} data-testid="arena-wallet-chip">
      <${Icon} name="wallet" size=${20} />
      <div><b class="sk-num">${money(wallet.available + wallet.pending)}</b></div>
      <span class="sk-caption">${wallet.pending > 0 ? t("cash.chipPending", { amount: money(wallet.pending) }) : t("cash.available")}</span>
    </button>
  `;
}

