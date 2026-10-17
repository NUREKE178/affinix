import { html } from "../../lib/preact.js";
import { EmptyState, Button } from "../../components/ui.js";
import { getLocale } from "../../lib/i18n.js";

export const nf = (n) => new Intl.NumberFormat(getLocale()).format(Math.round(n ?? 0));

/** What to show when a call to the admin functions failed: the migration is missing, or something else went wrong. */
export function AdminError({ error, t, onRetry }) {
  const pending = error?.code === "updatePending";
  return html`
    <${EmptyState} title=${t(pending ? "admin.pendingTitle" : "admin.errorTitle")} body=${t(pending ? "admin.pendingBody" : "admin.errorBody")} icon="shield"
      action=${pending ? null : html`<${Button} onClick=${onRetry}>${t("common.retry")}<//>`} />
  `;
}
