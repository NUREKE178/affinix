import { html, useState, useEffect } from "../lib/preact.js";
import { navigate } from "../router.js";
import { fetchPublicProfile } from "../lib/profile.js";
import { LogoMark } from "../components/icons.js";
import { Button, LoadingState } from "../components/ui.js";
import { FriendButton } from "../components/friendButton.js";
import { useFriendsCount } from "../lib/friendsStore.js";
import { useT } from "../lib/i18n.js";
import { withTimeout } from "../lib/async.js";

function initialsFor(name) {
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function PublicProfile({ params }) {
  const t = useT();
  const username = params?.username;
  const [state, setState] = useState({ loading: true, profile: null, error: false });
  const [retryTick, setRetryTick] = useState(0);
  const friendsCount = useFriendsCount(state.profile?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, profile: null, error: false });
    withTimeout(fetchPublicProfile(username), 15000)
      .then((profile) => { if (!cancelled) setState({ loading: false, profile, error: false }); })
      .catch(() => { if (!cancelled) setState({ loading: false, profile: null, error: true }); });
    return () => { cancelled = true; };
  }, [username, retryTick]);

  return html`
    <div class="min-h-screen bg-graphite-950 text-graphite-100 flex flex-col fade-in">
      <header class="px-6 py-4 border-b border-graphite-800/80">
        <button onClick=${() => navigate("/")} class="flex items-center gap-2 text-sm font-semibold text-graphite-200">
          <${LogoMark} size=${28} />
          DecisionOS
        </button>
      </header>

      <main class="flex-1 flex items-start justify-center px-4 py-14">
        ${state.loading
          ? html`<${LoadingState} label=${t("common.loading")} />`
          : state.error
          ? html`
            <div class="text-center max-w-sm">
              <h1 class="text-lg font-semibold text-graphite-100">${t("publicProfile.errorTitle")}</h1>
              <p class="text-sm text-graphite-500 mt-2">${t("publicProfile.errorBody")}</p>
              <${Button} className="mt-5" onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}<//>
            </div>
          `
          : !state.profile
          ? html`
            <div class="text-center max-w-sm">
              <h1 class="text-lg font-semibold text-graphite-100">${t("publicProfile.notFoundTitle")}</h1>
              <p class="text-sm text-graphite-500 mt-2">${t("publicProfile.notFoundBody")}</p>
            </div>
          `
          : html`
            <div class="sk-panel w-full max-w-lg rounded-2xl p-7">
              <div class="flex items-center gap-4">
                ${state.profile.avatar_url
                  ? html`<img src=${state.profile.avatar_url} class="h-16 w-16 rounded-full object-cover" />`
                  : html`<div class="h-16 w-16 rounded-full sk-avatar flex items-center justify-center text-xl font-semibold">${initialsFor(state.profile.full_name)}</div>`}
                <div>
                  <h1 class="text-lg font-semibold text-graphite-100">${state.profile.full_name || `@${state.profile.username}`}</h1>
                  <p class="text-sm text-graphite-400">${[state.profile.role_title, state.profile.org_name].filter(Boolean).join(" · ") || " "}</p>
                  ${friendsCount !== null && html`<p class="text-xs text-graphite-500 mt-1">${t("friends.countLabel", { count: friendsCount })}</p>`}
                </div>
              </div>

              <div class="mt-5">
                <${FriendButton} targetUserId=${state.profile.id} />
              </div>

              ${state.profile.bio && html`<p class="text-sm text-graphite-300 mt-5 leading-relaxed">${state.profile.bio}</p>`}

              ${state.profile.research_interests?.length > 0 && html`
                <div class="mt-5 flex flex-wrap gap-1.5">
                  ${state.profile.research_interests.map((tag) => html`
                    <span key=${tag} class="rounded-full border border-graphite-700 bg-graphite-800/60 px-2.5 py-1 text-xs text-graphite-300">${tag}</span>
                  `)}
                </div>
              `}

              <p class="text-xs text-graphite-600 mt-7">${t("publicProfile.footerNote")}</p>
            </div>
          `}
      </main>
    </div>
  `;
}
