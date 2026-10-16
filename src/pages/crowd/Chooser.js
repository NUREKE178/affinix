// "New research": one button, two honest options, each saying what it is for.
import { html } from "../../lib/preact.js";
import { Modal } from "../../components/ui.js";
import { Icon } from "../../components/icons.js";
import { useT } from "../../lib/i18n.js";
import { navigate } from "../../router.js";
import { TESTS_NEW_PATH } from "./parts.js";

export function CreateChooser({ open, onClose }) {
  const t = useT();
  const go = (path) => { onClose(); navigate(path); };
  const options = [
    { key: "quick", icon: "arena", path: TESTS_NEW_PATH },
    { key: "full", icon: "experiments", path: "/app/experiments/new" },
  ];
  return html`
    <${Modal} open=${open} onClose=${onClose} title=${t("crowd.chooser.title")}>
      <div class="cr-choose" data-testid="create-chooser">
        ${options.map((o) => html`
          <button type="button" key=${o.key} class="cr-choice" onClick=${() => go(o.path)} data-testid=${`choose-${o.key}`}>
            <span class="sk-tile"><${Icon} name=${o.icon} size=${16} /></span>
            <span class="cr-choice-main">
              <span class="cr-choice-title">${t(`crowd.chooser.${o.key}Title`)}</span>
              <span class="cr-choice-tag">${t(`crowd.chooser.${o.key}Tag`)}</span>
              <span class="cr-choice-body">${t(`crowd.chooser.${o.key}Body`)}</span>
            </span>
            <${Icon} name="arrowRight" size=${16} />
          </button>`)}
      </div>
    <//>
  `;
}
