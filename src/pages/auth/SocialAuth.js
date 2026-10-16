// Ways into the app besides an email and a password: Google, and a phone number with an SMS code. Shared by the
// sign-in and sign-up pages (for both of them the first use creates the account).
import { html, useState, useEffect, useRef } from "../../lib/preact.js";
import { navigate, HOME_PATH } from "../../router.js";
import { Field, TextInput, Button } from "../../components/ui.js";
import { signInWithGoogle, normalizePhone, requestPhoneCode, verifyPhoneCode, friendlyAuthError } from "../../lib/auth.js";
import { IS_CONFIGURED } from "../../lib/env.js";
import { useT } from "../../lib/i18n.js";

const RESEND_SECONDS = 60;

/** The four-colour Google "G" (brand mark, drawn inline so nothing is fetched). */
function GoogleMark() {
  return html`
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/>
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  `;
}

export function GoogleButton({ onError }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function go() {
    onError?.(null);
    setBusy(true);
    try {
      await signInWithGoogle(); // the browser leaves for Google; this page is gone a moment later
    } catch (err) {
      onError?.(friendlyAuthError(err, t));
      setBusy(false);
    }
  }
  return html`
    <${Button} variant="secondary" className="au-google" loading=${busy} disabled=${!IS_CONFIGURED} onClick=${go} data-testid="auth-google">
      <${GoogleMark} />${t("auth.social.google")}
    <//>
  `;
}

export function OrDivider() {
  const t = useT();
  return html`<div class="au-or" role="separator"><span>${t("auth.social.or")}</span></div>`;
}

/** Email | Phone switch above the form. */
export function MethodSwitch({ value, onChange }) {
  const t = useT();
  const items = [["email", t("auth.social.methodEmail")], ["phone", t("auth.social.methodPhone")]];
  return html`
    <div class="au-seg" role="tablist" data-testid="auth-method">
      ${items.map(([id, label]) => html`
        <button type="button" key=${id} role="tab" aria-selected=${value === id} data-on=${value === id} data-testid=${`auth-method-${id}`} onClick=${() => onChange(id)}>${label}</button>`)}
    </div>
  `;
}

/** Phone number -> SMS code -> signed in. */
export function PhoneAuth({ onError, note }) {
  const t = useT();
  const [step, setStep] = useState("phone"); // phone | code
  const [raw, setRaw] = useState("");
  const [phone, setPhone] = useState(null);   // the normalised number the code was sent to
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const checking = useRef(false);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(e) {
    e?.preventDefault();
    onError?.(null);
    const normal = normalizePhone(raw);
    if (!normal) { onError?.(t("auth.errors.badPhone")); return; }
    setBusy(true);
    try {
      await requestPhoneCode(normal);
      setPhone(normal);
      setCode("");
      setStep("code");
      setWait(RESEND_SECONDS);
    } catch (err) {
      onError?.(friendlyAuthError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify(token) {
    if (checking.current) return;
    checking.current = true;
    onError?.(null);
    setBusy(true);
    try {
      await verifyPhoneCode({ phone, token });
      navigate(HOME_PATH);
    } catch (err) {
      onError?.(friendlyAuthError(err, t));
      setCode("");
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  function onCodeInput(e) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setCode(digits);
    if (digits.length === 6) verify(digits); // the usual length; a longer code is sent with the button
  }

  if (step === "code") {
    return html`
      <form onSubmit=${(e) => { e.preventDefault(); if (code.length >= 4) verify(code); }} data-testid="auth-phone-code-form">
        <p class="au-note" data-testid="auth-code-sent">${t("auth.phone.codeSent", { phone })}</p>
        <${Field} label=${t("auth.phone.codeLabel")} required>
          <div class="au-code">
            <${TextInput} value=${code} inputmode="numeric" autocomplete="one-time-code" maxlength="10" autofocus=${true} disabled=${busy}
              data-testid="auth-code" onInput=${onCodeInput} />
          </div>
        <//>
        <${Button} type="submit" className="w-full" loading=${busy} disabled=${code.length < 4} data-testid="auth-verify">${busy ? t("auth.phone.verifying") : t("auth.phone.verify")}<//>
        <div class="au-links">
          <button type="button" class="au-link" disabled=${busy} onClick=${() => { onError?.(null); setStep("phone"); }} data-testid="auth-change-phone">${t("auth.phone.change")}</button>
          <button type="button" class="au-link" disabled=${busy || wait > 0} onClick=${send} data-testid="auth-resend">${wait > 0 ? t("auth.phone.resendIn", { s: wait }) : t("auth.phone.resend")}</button>
        </div>
      </form>
    `;
  }
  return html`
    <form onSubmit=${send} data-testid="auth-phone-form">
      <${Field} label=${t("auth.phone.label")} required hint=${t("auth.phone.hint")}>
        <${TextInput} type="tel" inputmode="tel" autocomplete="tel" required value=${raw} placeholder=${t("auth.phone.placeholder")}
          data-testid="auth-phone" onInput=${(e) => setRaw(e.target.value)} />
      <//>
      <${Button} type="submit" className="w-full" loading=${busy} disabled=${!IS_CONFIGURED || raw.trim().length < 6} data-testid="auth-send-code">${busy ? t("auth.phone.sending") : t("auth.phone.sendCode")}<//>
      ${note && html`<p class="au-note au-note-below">${note}</p>`}
    </form>
  `;
}
