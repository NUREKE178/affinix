import { html, useState } from "../../lib/preact.js";
import { navigate, HOME_PATH } from "../../router.js";
import { AuthLayout, AuthError, AuthSuccess } from "./AuthLayout.js";
import { Field, TextInput, Button } from "../../components/ui.js";
import { updatePassword, friendlyAuthError } from "../../lib/auth.js";
import { useSession } from "../../lib/auth.js";
import { useT } from "../../lib/i18n.js";

export function ResetPassword() {
  const t = useT();
  const { session, loading: sessionLoading } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError(t("auth.reset.passwordTooShort"));
    if (password !== confirm) return setError(t("auth.reset.passwordsMismatch"));
    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(friendlyAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return html`
      <${AuthLayout} title=${t("auth.reset.successTitle")} subtitle=${t("auth.reset.successSubtitle")}>
        <${AuthSuccess} message=${t("auth.reset.success")} />
        <${Button} className="w-full" onClick=${() => navigate(HOME_PATH)}>${t("auth.reset.successCta")}<//>
      <//>
    `;
  }

  if (!sessionLoading && !session) {
    return html`
      <${AuthLayout} title=${t("auth.reset.invalidTitle")} subtitle=${t("auth.reset.invalidSubtitle")}>
        <${Button} variant="secondary" className="w-full" onClick=${() => navigate("/forgot-password")}>${t("auth.reset.requestNew")}<//>
      <//>
    `;
  }

  return html`
    <${AuthLayout} title=${t("auth.reset.title")} subtitle=${t("auth.reset.subtitle")}>
      <${AuthError} message=${error} />
      <form onSubmit=${onSubmit}>
        <${Field} label=${t("auth.fields.password")} required hint=${t("auth.fields.passwordHint")}>
          <${TextInput} type="password" required minlength="6" autocomplete="new-password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
        <//>
        <${Field} label=${t("auth.fields.repeatPassword")} required>
          <${TextInput} type="password" required autocomplete="new-password" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} />
        <//>
        <${Button} type="submit" className="w-full" loading=${loading}>${loading ? t("auth.reset.submitting") : t("auth.reset.submit")}<//>
      </form>
    <//>
  `;
}
