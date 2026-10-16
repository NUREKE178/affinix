// The top of the Research page: what Research is FOR. A person puts their own options in front of the Arena crowd
// and reads a verdict; this section explains that and lists the person's tests.
import { html } from "../../lib/preact.js";
import { Card, Button, Skeleton, ProgressBar, EmptyState } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import { useMyTests, testVerdict, useCreateGate } from "../../lib/crowdStore.js";
import { StatusBadge, OptionThumb, verdictText, TESTS_NEW_PATH, testPath } from "./parts.js";

const STEPS = [
  { icon: "upload", key: "step1" },
  { icon: "arena", key: "step2" },
  { icon: "results", key: "step3" },
];

function Hero({ t, canCreate, xp }) {
  return html`
    <${Card} className="cr-hero p-6" data-testid="crowd-hero">
      <div class="cr-hero-top">
        <span class="sk-caption cr-kicker"><i class="sk-led" aria-hidden="true"></i>${t("crowd.heroKicker")}</span>
        <h2 class="cr-hero-title">${t("crowd.heroTitle")}</h2>
        <p class="cr-hero-body">${t("crowd.heroBody")}</p>
        <div class="cr-hero-cta">
          <${Button} onClick=${() => navigate(TESTS_NEW_PATH)} data-testid="crowd-create"><${Icon} name="plus" size=${16} />${t("crowd.create")}<//>
          ${!canCreate && html`<${Button} variant="secondary" onClick=${() => navigate("/app/arena")} data-testid="crowd-open-arena"><${Icon} name="arena" size=${16} />${t("crowd.playFirst")}<//>`}
        </div>
        ${!canCreate && html`<p class="cr-gate" data-testid="crowd-gate">${t("crowd.gate", { xp })}</p>`}
      </div>
      <div class="cr-steps">
        ${STEPS.map((s, i) => html`
          <div class="cr-step" key=${s.key}>
            <span class="sk-tile"><${Icon} name=${s.icon} size=${15} /></span>
            <div class="cr-step-n sk-num">${i + 1}</div>
            <div class="cr-step-title">${t(`crowd.${s.key}Title`)}</div>
            <p class="cr-step-body">${t(`crowd.${s.key}Body`)}</p>
          </div>`)}
      </div>
      <ul class="cr-why">
        ${["why1", "why2", "why3"].map((k) => html`<li key=${k}><${Icon} name="check" size=${14} />${t(`crowd.${k}`)}</li>`)}
      </ul>
      <p class="cr-usecases">${t("crowd.useCases")}</p>
    <//>
  `;
}

function TestCard({ test, t }) {
  const v = testVerdict(test);
  return html`
    <div class="cr-test sk-panel" data-testid="crowd-test" data-status=${test.status}>
      <div class="cr-test-head">
        <div class="cr-test-main">
          <button type="button" class="cr-test-title" onClick=${() => navigate(testPath(test.id))}>${test.title}</button>
          <div class="cr-test-q">${t(`crowd.q.${test.dim}`)}</div>
        </div>
        <${StatusBadge} status=${test.status} t=${t} />
      </div>
      <div class="cr-test-opts">
        ${(test.items ?? []).map((it) => html`<${OptionThumb} key=${it.id} item=${it} size=${40} />`)}
      </div>
      <div class="cr-test-prog">
        <${ProgressBar} value=${v.progress} />
        <span class="cr-test-count sk-num">${t("crowd.votesOf", { votes: test.votes, target: test.target })}</span>
      </div>
      <p class="cr-test-verdict" data-state=${v.state}>${verdictText(test, t)}</p>
      <div class="cr-test-foot">
        <span class="ar-muted">${t("crowd.voters", { n: test.voters })}</span>
        <${Button} size="sm" variant="secondary" onClick=${() => navigate(testPath(test.id))}>${t("crowd.open")}<//>
      </div>
    </div>
  `;
}

export function CrowdSection() {
  const t = useT();
  const { tests, loading, error, pending } = useMyTests({ poll: true });
  const { xp, locked } = useCreateGate();
  const canCreate = !locked;

  if (pending) {
    return html`<${Card} className="p-6 mb-6" data-testid="crowd-pending"><${EmptyState} icon="lock" title=${t("crowd.pendingTitle")} body=${t("crowd.pendingBody")} /><//>`;
  }
  if (loading && tests.length === 0) {
    return html`<${Card} className="p-6 mb-6"><${Skeleton} className="h-6 w-56" /><${Skeleton} className="h-4 w-full mt-3" /><${Skeleton} className="h-24 w-full mt-4 rounded-xl" /><//>`;
  }
  if (error) {
    return html`<${Card} className="p-6 mb-6"><${EmptyState} icon="shield" title=${t("crowd.loadError")} body=${t("crowd.err.generic")} /><//>`;
  }
  if (tests.length === 0) {
    return html`<div class="mb-6"><${Hero} t=${t} canCreate=${canCreate} xp=${xp ?? 0} /></div>`;
  }
  const open = tests.filter((x) => x.status === "open").length;
  return html`
    <section class="cr-mine mb-6" data-testid="crowd-mine">
      <div class="cr-mine-head">
        <div>
          <span class="sk-caption cr-kicker"><i class="sk-led" aria-hidden="true"></i>${t("crowd.heroKicker")}</span>
          <h2 class="cr-mine-title">${t("crowd.mineTitle")}</h2>
          <p class="ar-muted">${t("crowd.heroTitle")} · ${open}</p>
        </div>
        <${Button} onClick=${() => navigate(TESTS_NEW_PATH)} data-testid="crowd-create"><${Icon} name="plus" size=${16} />${t("crowd.create")}<//>
      </div>
      <div class="cr-mine-grid">
        ${tests.map((x) => html`<${TestCard} key=${x.id} test=${x} t=${t} />`)}
      </div>
    </section>
  `;
}
