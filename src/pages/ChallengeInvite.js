// A friend's Taste Match link, as it is met on the landing page (before sign-up): who is asking, what it is, one button.
import { html } from "../lib/preact.js";
import { Button } from "../components/ui.js";
import { useT } from "../lib/i18n.js";
import { useSession } from "../lib/auth.js";
import { navigate, HOME_PATH } from "../router.js";
import { pendingChallenge } from "../lib/arena/inbox.js";

export function ChallengeInvite() {
  const t = useT();
  const { session } = useSession();
  const ch = pendingChallenge();
  if (!ch) return null;
  const name = ch.name ?? t("arena.challenge.someone");
  return html`
    <section class="ar-invite" data-testid="challenge-invite">
      <div class="ar-invite-card sk-panel">
        <span class="ar-invite-badge"><i aria-hidden="true">${(Array.from(name)[0] ?? "?").toUpperCase()}</i>${t("arena.challenge.inviteBadge", { name })}</span>
        <h1>${t("arena.challenge.inviteTitle", { name })}</h1>
        <p>${t("arena.challenge.inviteBody", { n: ch.answers.length })}</p>
        <div class="ar-first-dots" aria-hidden="true">${ch.answers.map((_, i) => html`<i key=${i}>?</i>`)}</div>
        <div class="ar-first-fact">${t("arena.challenge.inviteHidden")}</div>
        <${Button} size="lg" onClick=${() => navigate(session ? HOME_PATH : "/register")} data-testid="challenge-accept">${t("arena.challenge.inviteAccept")}<//>
        ${!session && html`
          <p class="ar-invite-login">${t("arena.challenge.inviteLogin")} <button type="button" onClick=${() => navigate("/login")}>${t("arena.challenge.inviteLoginLink")}</button></p>
          <p class="ar-first-note">${t("arena.challenge.inviteFoot")}</p>`}
      </div>
    </section>
  `;
}
