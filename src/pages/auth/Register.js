import { html, useState } from "../../lib/preact.js";
import { navigate } from "../../router.js";
import { AuthLayout, AuthError, AuthSuccess } from "./AuthLayout.js";
import { Field, TextInput, Button } from "../../components/ui.js";
import { signUp, friendlyAuthError } from "../../lib/auth.js";
import { GoogleButton, OrDivider, MethodSwitch, PhoneAuth } from "./SocialAuth.js";
import { IS_CONFIGURED } from "../../lib/env.js";
import { useT } from "../../lib/i18n.js";

export function Register() {
  const t = useT();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("email");

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await signUp({ email, password, fullName });
      if (data.session) {
        // Email confirmation disabled on this project -- signed in immediately.
        navigate("/onboarding");
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(friendlyAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return html`
      <${AuthLayout} title=${t("auth.register.checkEmailTitle")} subtitle=${t("auth.register.checkEmailSubtitle")}>
        <${AuthSuccess} message=${t("auth.register.checkEmailSent", { email })} />
        <${Button} variant="secondary" className="w-full" onClick=${() => navigate("/login")}>${t("auth.register.toLogin")}<//>
      <//>
    `;
  }

  return html`
    <${AuthLayout}
      title=${t("auth.register.title")}
      subtitle=${t("auth.register.subtitle")}
      footer=${html`${t("auth.register.haveAccount")} <button class="text-signal-400 hover:text-signal-300" onClick=${() => navigate("/login")}>${t("auth.register.login")}<//>`}
    >
      ${!IS_CONFIGURED && html`<${AuthError} message=${t("auth.register.notConfigured")} />`}
      <${AuthError} message=${error} />
      <${GoogleButton} onError=${setError} />
      <${OrDivider} />
      <${MethodSwitch} value=${method} onChange=${(m) => { setError(null); setMethod(m); }} />
      ${method === "phone"
        ? html`<${PhoneAuth} onError=${setError} note=${t("auth.social.autoCreate")} />`
        : html`
      <form onSubmit=${onSubmit}>
        <${Field} label=${t("auth.fields.fullName")} required>
          <${TextInput} required autocomplete="name" value=${fullName} onInput=${(e) => setFullName(e.target.value)} />
        <//>
        <${Field} label=${t("auth.fields.email")} required>
          <${TextInput} type="email" required autocomplete="email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
        <//>
        <${Field} label=${t("auth.fields.password")} required hint=${t("auth.fields.passwordHint")}>
          <${TextInput} type="password" required minlength="6" autocomplete="new-password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
        <//>
        <${Button} type="submit" className="w-full" loading=${loading} disabled=${!IS_CONFIGURED}>${loading ? t("auth.register.submitting") : t("auth.register.submit")}<//>
      </form>`}
    <//>
  `;
}
