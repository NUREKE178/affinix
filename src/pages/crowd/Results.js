// One crowd test: the verdict, every option's record with its confidence interval, every pair's split.
import { html, useState, useEffect } from "../../lib/preact.js";
import { Card, Button, Skeleton, EmptyState, ProgressBar, Modal, toast } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import { fetchResults, setTestStatus, deleteTest, testVerdict } from "../../lib/crowdStore.js";
import { StatusBadge, OptionThumb, optionName, verdictText } from "./parts.js";

const pct = (x) => Math.round(x * 100);

function OptionRow({ item, rank, lead, t }) {
  const has = item.rate !== null;
  return html`
    <div class="cr-res-row" data-lead=${lead} data-testid="crowd-result-row">
      <span class="cr-res-rank sk-num">${rank}</span>
      <${OptionThumb} item=${item} size=${56} />
      <div class="cr-res-main">
        <div class="cr-res-name">${optionName(item, t)}${lead && html` <span class="cr-res-tag">${t("crowd.res.leader")}</span>`}</div>
        <div class="cr-res-bar" role="img" aria-label=${has ? t("crowd.res.rate", { pct: pct(item.rate) }) : ""}>
          <i style=${{ width: `${has ? pct(item.rate) : 0}%` }}></i>
          ${has && html`<b class="cr-res-ci" style=${{ left: `${pct(item.ci[0])}%`, width: `${Math.max(1, pct(item.ci[1]) - pct(item.ci[0]))}%` }}></b>`}
        </div>
        <div class="cr-res-sub">
          ${has
            ? html`<span class="sk-num">${t("crowd.res.rate", { pct: pct(item.rate) })}</span> · <span>${t("crowd.res.ci", { lo: pct(item.ci[0]), hi: pct(item.ci[1]) })}</span> · <span>${t("crowd.res.duels", { n: item.games })}</span>`
            : html`<span>—</span>`}
        </div>
      </div>
      <div class="cr-res-pct sk-num">${has ? pct(item.rate) : "—"}${has && html`<span class="sk-unit">%</span>`}</div>
    </div>
  `;
}

export function CrowdResults({ params }) {
  const t = useT();
  const id = params?.id;
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function load(silent) {
    if (!silent) setState((s) => ({ ...s, loading: !s.data }));
    try {
      const data = await fetchResults(id);
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState((s) => (silent && s.data ? s : { loading: false, data: null, error }));
    }
  }
  useEffect(() => {
    load(false);
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 20000);
    return () => clearInterval(timer);
  }, [id]);

  async function toggle(test) {
    setBusy(true);
    try {
      await setTestStatus(test.id, test.status === "open" ? "closed" : "open");
      await load(true);
    } catch (err) {
      toast(t(`crowd.err.${err?.hint ?? "generic"}`), "rose");
    } finally {
      setBusy(false);
    }
  }

  async function remove(test) {
    setBusy(true);
    try {
      await deleteTest(test.id);
      setConfirmDelete(false);
      navigate("/app/overview");
    } catch (err) {
      setConfirmDelete(false);
      toast(t(`crowd.err.${err?.hint ?? "generic"}`), "rose");
    } finally {
      setBusy(false);
    }
  }

  const back = html`<div class="cr-back"><${Button} variant="secondary" size="sm" onClick=${() => navigate("/app/overview")}><${Icon} name="arrowLeft" size=${14} />${t("crowd.back")}<//></div>`;

  if (state.loading) {
    return html`<div class="cr-results">${back}<${Skeleton} className="h-8 w-72" /><${Skeleton} className="h-28 w-full rounded-xl" /><${Skeleton} className="h-48 w-full rounded-xl" /></div>`;
  }
  if (state.error || !state.data) {
    return html`<div class="cr-results">${back}<${EmptyState} icon="shield" title=${t("crowd.loadError")} body=${t(`crowd.err.${state.error?.pending ? "pending" : "generic"}`)} /></div>`;
  }

  const { test, pairs, avgMs } = state.data;
  const v = testVerdict(test);
  const names = Object.fromEntries((test.items ?? []).map((i) => [i.id, optionName(i, t)]));
  const posOf = Object.fromEntries((test.items ?? []).map((i) => [i.id, i.pos ?? 0]));
  // the server keys a pair by the lower item id; people read it in the order the options were entered
  const readable = pairs.map((p) => (posOf[p.a] > posOf[p.b] ? { a: p.b, b: p.a, aVotes: p.bVotes, bVotes: p.aVotes } : p))
    .sort((x, y) => posOf[x.a] - posOf[y.a] || posOf[x.b] - posOf[y.b]);
  const reviewing = test.status === "flagged" || test.status === "removed";

  return html`
    <div class="cr-results fade-in" data-testid="crowd-results">
      ${back}
      <div class="cr-results-head">
        <div class="cr-results-title">
          <h2>${test.title}</h2>
          <div class="cr-test-q">${t(`crowd.q.${test.dim}`)}</div>
        </div>
        <${StatusBadge} status=${test.status} t=${t} />
      </div>

      ${reviewing && html`<div class="cr-error" role="status">${t(`crowd.err.under_review`)}${test.note ? ` · ${test.note}` : ""}</div>`}

      <${Card} className="cr-verdict p-5" data-testid="crowd-verdict" data-state=${v.state}>
        <div class="cr-verdict-state sk-caption">${t(`crowd.status.${test.status}`)} · ${t("crowd.votesOf", { votes: test.votes, target: test.target })}</div>
        <p class="cr-verdict-text">${verdictText(test, t)}</p>
        <${ProgressBar} value=${v.progress} />
        <div class="cr-verdict-meta">
          <span>${t("crowd.voters", { n: test.voters })}</span>
          ${avgMs ? html`<span>${t("crowd.res.avgTime", { s: (avgMs / 1000).toFixed(1) })}</span>` : null}
        </div>
      <//>

      <${Card} className="p-2">
        ${v.ranked.map((it, i) => html`<${OptionRow} key=${it.id} item=${it} rank=${i + 1} lead=${v.state === "winner" && i === 0} t=${t} />`)}
      <//>

      ${pairs.length > 0 && html`
        <${Card} className="p-5">
          <div class="sk-caption">${t("crowd.res.pairs")}</div>
          <ul class="cr-pairs">
            ${readable.map((p) => html`<li key=${`${p.a}|${p.b}`} class="sk-num">${t("crowd.res.pairLine", { a: names[p.a] ?? "?", b: names[p.b] ?? "?", av: p.aVotes, bv: p.bVotes })}</li>`)}
          </ul>
        <//>`}

      <p class="cr-note">${t("crowd.res.note")}</p>

      <div class="cr-results-foot">
        ${!reviewing && html`<${Button} variant="secondary" disabled=${busy} onClick=${() => toggle(test)} data-testid="crowd-toggle">${test.status === "open" ? t("crowd.closeTest") : t("crowd.reopen")}<//>`}
        <${Button} variant="danger" disabled=${busy} onClick=${() => setConfirmDelete(true)} data-testid="crowd-delete"><${Icon} name="trash" size=${14} />${t("crowd.delete")}<//>
      </div>

      <${Modal} open=${confirmDelete} onClose=${() => setConfirmDelete(false)} title=${t("crowd.delete")}
        footer=${html`<${Button} variant="secondary" size="sm" onClick=${() => setConfirmDelete(false)}>${t("common.cancel")}<//><${Button} variant="danger" size="sm" loading=${busy} onClick=${() => remove(test)} data-testid="crowd-delete-confirm">${t("crowd.delete")}<//>`}>
        <p class="text-sm text-graphite-300">${t("crowd.deleteConfirm")}</p>
      <//>
    </div>
  `;
}
