import { html, useState } from "../../lib/preact.js";
import { navigate } from "../../router.js";
import { AuthLayout, AuthError, AuthSuccess } from "./AuthLayout.js";
import { Field, TextInput, Button } from "../../components/ui.js";
import { requestPasswordReset, friendlyAuthError } from "../../lib/auth.js";
import { IS_CONFIGURED } from "../../lib/env.js";
import { useT } from "../../lib/i18n.js";

export function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(friendlyAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

  return html`
    <${AuthLayout}
      title=${t("auth.forgot.title")}
      subtitle=${t("auth.forgot.subtitle")}
      footer=${html`<button class="text-indigo-400 hover:text-indigo-300" onClick=${() => navigate("/login")}>${t("auth.forgot.back")}<//>`}
    >
      ${!IS_CONFIGURED && html`<${AuthError} message=${t("auth.forgot.notConfigured")} />`}
      ${sent
        ? html`<${AuthSuccess} message=${t("auth.forgot.sentMessage", { email })} />`
        : html`
          <${AuthError} message=${error} />
          <form onSubmit=${onSubmit}>
            <${Field} label=${t("auth.fields.email")} required>
              <${TextInput} type="email" required autocomplete="email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
            <//>
            <${Button} type="submit" className="w-full" loading=${loading} disabled=${!IS_CONFIGURED}>${loading ? t("auth.forgot.submitting") : t("auth.forgot.submit")}<//>
          </form>
        `}
    <//>
  `;
}
