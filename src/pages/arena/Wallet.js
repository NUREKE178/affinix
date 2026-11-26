// Wallet tab: the money bonus from research missions (migration 0027). What is available, what is still in its holding
// period, the way to a bank transfer (switched off until a payment provider is connected), the history and the rules.
// Every number comes from the server (cash_wallet); this screen computes nothing that matters.
import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { Button, Badge, ProgressBar, Skeleton, EmptyState, Modal, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { dayMonth } from "../../lib/format.js";
import { navigate } from "../../router.js";
import { useWallet, refreshWallet, requestPayout, payoutProgress, daysUntil } from "../../lib/cashStore.js";
import { useCountUp } from "../../lib/countUp.js";
import { money } from "./parts.js";

const day = (iso) => dayMonth(iso);

/** A money amount that rolls to its value; `data-value` carries the exact tiyn (tests and screen readers), `data-up` flashes
 * for a moment when the amount grew. */
function Counter({ value, className = "", testid }) {
  const shown = useCountUp(value);
  const prev = useRef(value);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (value > prev.current) { setUp(true); const id = setTimeout(() => setUp(false), 1100); prev.current = value; return () => clearTimeout(id); }
    prev.current = value;
    return undefined;
  }, [value]);
  return html`<span class=${className} data-value=${value} data-up=${up} data-testid=${testid}>${money(shown)}</span>`;
}

/** This month against its limit, as a ring that fills when the tab opens. */
function MonthRing({ month, cap, t }) {
  const ratio = cap > 0 ? Math.min(1, month / cap) : 0;
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  const R = 30, C = 2 * Math.PI * R;
  // a tiny share still shows a visible sliver; nothing at all is drawn at 0 (a round line cap would otherwise leave a lone dot)
  const shown = ratio <= 0 ? 0 : Math.max(ratio, 0.025);
  const pct = ratio > 0 && ratio < 0.01 ? "<1" : String(Math.round(ratio * 100));
  return html`
    <div class="ar-wl-ring" role="img" aria-label=${t("cash.monthHint", { cap: money(cap), left: money(Math.max(0, cap - month)) })} data-testid="wallet-ring" data-ratio=${ratio.toFixed(3)}>
      <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
        <circle class="ar-wl-ring-track" cx="36" cy="36" r=${R} />
        ${shown > 0 && html`<circle class="ar-wl-ring-fill" cx="36" cy="36" r=${R} stroke-dasharray=${C.toFixed(2)} stroke-dashoffset=${(C * (on ? 1 - shown : 1)).toFixed(2)} transform="rotate(-90 36 36)" />`}
      </svg>
      <span class="ar-wl-ring-in">
        <b class="ar-wl-ring-pct sk-num">${pct}<small>%</small></b>
        <span class="ar-wl-ring-of">${t("cash.ringOf")}</span>
      </span>
    </div>`;
}

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
      <div class="ar-wl-big-row">
        <div class="ar-wl-big-col">
          <${Counter} value=${wallet.available} className="ar-wl-big sk-num" testid="wallet-available" />
          ${wallet.rules?.xpPerTenge > 0 && html`<span class="ar-wl-rate" data-testid="wallet-rate"><${Icon} name="bolt" size=${14} />${t("cash.rate", { xp: wallet.rules.xpPerTenge })}</span>`}
        </div>
        ${wallet.rules?.monthlyCap > 0 && html`<${MonthRing} month=${wallet.month ?? 0} cap=${wallet.rules.monthlyCap} t=${t} />`}
      </div>
      <div class="sk-stat-strip sk-stat-strip-well" style="--cols:3">
        <div class="sk-stat" data-testid="wallet-pending">
          <div class="sk-stat-label">${t("cash.pending")}</div>
          <div class="sk-stat-value"><${Counter} value=${wallet.pending} /></div>
          <div class="sk-stat-hint">${wallet.pending > 0 && wallet.nextRelease ? (days > 0 ? t("cash.nextRelease", { amount: money(wallet.nextRelease.amount), days }) : t("cash.releasing")) : t("cash.holdHint", { days: wallet.rules?.holdDays ?? 7 })}</div>
        </div>
        <div class="sk-stat" data-testid="wallet-month">
          <div class="sk-stat-label">${t("cash.month")}</div>
          <div class="sk-stat-value"><${Counter} value=${wallet.month ?? 0} /></div>
          <div class="sk-stat-hint">${t("cash.monthHint", { cap: money(wallet.rules?.monthlyCap ?? 0), left: money(wallet.monthLeft ?? 0) })}</div>
        </div>
        <div class="sk-stat" data-testid="wallet-total">
          <div class="sk-stat-label">${t("cash.earnedTotal")}</div>
          <div class="sk-stat-value"><${Counter} value=${wallet.earnedTotal} /></div>
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
  if (r.kind === "xp") return t("cash.row.xp");
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
        ? html`
          <div class="ar-wl-empty" data-testid="wallet-history-empty">
            <span class="ar-coin" aria-hidden="true"><b>₸</b></span>
            <p class="ar-wl-text">${t("cash.historyEmpty")}</p>
          </div>`
        : html`
          <ul class="ar-wl-rows">
            ${rows.map((r, i) => html`
              <li key=${r.id} class="ar-wl-row" data-state=${r.state} data-kind=${r.kind} data-testid="wallet-row" style=${`--i:${Math.min(i, 8)}`}>
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
    { title: t("cash.how.s1Title", { n: r.minArenaVotes ?? 30 }), body: t("cash.how.s1Body") },
    r.xpPerTenge > 0 && { title: t("cash.how.xpTitle", { xp: r.xpPerTenge }), body: t("cash.how.xpBody", { cap: money(r.monthlyCap ?? 0) }) },
    { title: t("cash.how.s2Title"), body: t("cash.how.s2Body") },
    { title: t("cash.how.s3Title", { days: r.holdDays ?? 7 }), body: t("cash.how.s3Body") },
  ].filter(Boolean);
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
        <li>${t("cash.rules.month", { cap: money(r.monthlyCap ?? 0) })}</li>
        ${r.xpPerTenge > 0 && html`<li>${t("cash.rules.xp", { xp: r.xpPerTenge })}</li>`}
        <li>${t("cash.rules.funded")}</li>
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
  // XP earned since the last read has turned into tenge on the server: read the wallet again when the tab opens
  useEffect(() => { refreshWallet(); }, []);
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
      <div><${Counter} value=${wallet.available + wallet.pending} className="sk-num ar-chip-num" /></div>
      <span class="sk-caption">${wallet.pending > 0 ? t("cash.chipPending", { amount: money(wallet.pending) }) : t("cash.available")}</span>
    </button>
  `;
}

