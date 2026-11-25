// "Notifications about messages on this device": a switch for the profile, a slim banner for the chat list.
import { html, useState, useEffect } from "../lib/preact.js";
import { Switch, Button, toast } from "./ui.js";
import { pushStatus, enablePush, disablePush, subscribePushState } from "../lib/pushStore.js";

const DISMISS_KEY = "affinix.pushBannerDismissed";

function usePushStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => pushStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    refresh();
    const off = subscribePushState(refresh);
    return () => { alive = false; off(); };
  }, []);
  return status;
}

async function turnOn(t) {
  try { await enablePush(); }
  catch (err) {
    const code = err?.message;
    if (code === "denied") toast(t("profile.notifications.pushDenied"), "amber");
    else if (code === "push_not_configured") toast(t("profile.notifications.pushNotConfigured"), "amber");
    else toast(`${t("profile.notifications.pushFailed")} (${code ?? "?"})`, "rose");
  }
}

export function PushToggle({ t }) {
  const status = usePushStatus();
  if (!status) return null;
  const n = (k) => t(`profile.notifications.${k}`);
  const note = { on: n("pushHintOn"), off: n("pushHintOff"), denied: n("pushDenied"), install: n("pushInstall"), unsupported: n("pushUnsupported") }[status];
  const usable = status === "on" || status === "off";
  return html`
    <div data-testid="push-toggle">
      <${Switch} label=${n("pushLabel")} checked=${status === "on"} onChange=${(v) => (usable ? (v ? turnOn(t) : disablePush()) : toast(note, "amber"))} />
      <p class="push-note">${note}</p>
    </div>
  `;
}

/** Above the conversation list, until the device says yes or the person says "not now". Only where it can work (not unsupported / blocked). */
export function PushBanner({ t }) {
  const status = usePushStatus();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } });
  if (hidden || (status !== "off" && status !== "install")) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ } };
  return html`
    <div class="msg-push-banner" data-testid="push-banner">
      <span>${status === "install" ? t("profile.notifications.pushInstall") : t("profile.notifications.pushBanner")}</span>
      <span class="msg-push-actions">
        ${status === "off" && html`<${Button} size="sm" onClick=${() => turnOn(t)}>${t("profile.notifications.pushEnable")}<//>`}
        <button type="button" class="msg-push-x" onClick=${dismiss}>${t("profile.notifications.pushDismiss")}</button>
      </span>
    </div>
  `;
}
