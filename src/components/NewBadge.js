// A small "New" tag on something that was added recently (a menu item, a switch). It goes away for good once the person has used the thing
// (markSeen) and for everybody after a cut-off date (lib/newTag.js).
import { html } from "../lib/preact.js";
import { useT } from "../lib/i18n.js";
import { isNew, markSeen } from "../lib/newTag.js";

export { markSeen };

export function NewBadge({ id }) {
  const t = useT();
  return isNew(id) ? html`<span class="sk-new" data-testid=${`new-${id}`}>${t("common.new")}</span>` : null;
}
