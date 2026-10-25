import { html, useState, useEffect, useRef } from "./lib/preact.js";
import { useRoute, matchRoute, navigate, HOME_PATH } from "./router.js";
import { Landing } from "./pages/Landing.js";
import { useSession } from "./lib/auth.js";
import { fetchMyOrganizations } from "./lib/org.js";
import { IS_CONFIGURED } from "./lib/env.js";
import { useT } from "./lib/i18n.js";
import { Button, BootScreen } from "./components/ui.js";
import { withTimeout } from "./lib/async.js";
import { useAutoUpdate } from "./lib/useAutoUpdate.js";
import { lazyPage } from "./lib/lazyPage.js";

// Everything except the landing page is fetched the first time it is opened (and warmed up in the background right after the landing page
// is on screen, see lib/idlePreload.js): a visitor who only reads the landing page no longer downloads the whole app first.
const Shell = lazyPage(() => import("./components/shell.js"), "Shell");
const Feed = lazyPage(() => import("./pages/Feed.js"), "Feed");
const Favorites = lazyPage(() => import("./pages/Favorites.js"), "Favorites");
const Friends = lazyPage(() => import("./pages/Friends.js"), "Friends");
const Messages = lazyPage(() => import("./pages/Messages.js"), "Messages");
const Overview = lazyPage(() => import("./pages/Overview.js"), "Overview");
const ExperimentsList = lazyPage(() => import("./pages/ExperimentsList.js"), "ExperimentsList");
const ExperimentBuilder = lazyPage(() => import("./pages/ExperimentBuilder.js"), "ExperimentBuilder");
const Results = lazyPage(() => import("./pages/Results.js"), "Results");
const Participants = lazyPage(() => import("./pages/Participants.js"), "Participants");
const Reports = lazyPage(() => import("./pages/Reports.js"), "Reports");
const Team = lazyPage(() => import("./pages/Team.js"), "Team");
const Settings = lazyPage(() => import("./pages/Settings.js"), "Settings");
const Profile = lazyPage(() => import("./pages/Profile.js"), "Profile");
const PublicProfile = lazyPage(() => import("./pages/PublicProfile.js"), "PublicProfile");
const Billing = lazyPage(() => import("./pages/Billing.js"), "Billing");
const ParticipantRunner = lazyPage(() => import("./pages/ParticipantRunner.js"), "ParticipantRunner");
const Login = lazyPage(() => import("./pages/auth/Login.js"), "Login");
const Register = lazyPage(() => import("./pages/auth/Register.js"), "Register");
const ForgotPassword = lazyPage(() => import("./pages/auth/ForgotPassword.js"), "ForgotPassword");
const ResetPassword = lazyPage(() => import("./pages/auth/ResetPassword.js"), "ResetPassword");
const Onboarding = lazyPage(() => import("./pages/auth/Onboarding.js"), "Onboarding");
// The Arena (and the specimen generators behind it) loads the first time it is opened.
const Arena = lazyPage(() => import("./pages/Arena.js"), "Arena");
// Crowd tests: the page that makes one and the page that reads one (the list lives on the Research page).
const CrowdCreate = lazyPage(() => import("./pages/crowd/Create.js"), "CrowdCreate");
const CrowdResults = lazyPage(() => import("./pages/crowd/Results.js"), "CrowdResults");
const Admin = lazyPage(() => import("./pages/Admin.js"), "Admin");
const Styles = lazyPage(() => import("./pages/Styles.js"), "Styles");
const DownloadPage = lazyPage(() => import("./pages/Download.js"), "DownloadPage");

const DASHBOARD_ROUTES = [
  { pattern: "/app/overview", Page: Overview },
  // under /app/overview so the sidebar keeps "Research" lit
  { pattern: "/app/overview/tests/new", Page: CrowdCreate },
  { pattern: "/app/overview/tests/:id", Page: CrowdResults },
  { pattern: "/app/experiments", Page: ExperimentsList },
  { pattern: "/app/experiments/new", Page: ExperimentBuilder },
  { pattern: "/app/experiments/:id/edit", Page: ExperimentBuilder },
  { pattern: "/app/experiments/:id/results", Page: Results },
  { pattern: "/app/results", Page: Results },
  { pattern: "/app/arena", Page: Arena },
  { pattern: "/app/feed", Page: Feed },
  { pattern: "/app/favorites", Page: Favorites },
  { pattern: "/app/friends", Page: Friends },
  { pattern: "/app/messages", Page: Messages },
  { pattern: "/app/participants", Page: Participants },
  { pattern: "/app/reports", Page: Reports },
  { pattern: "/app/team", Page: Team },
  { pattern: "/app/billing", Page: Billing },
  { pattern: "/app/settings", Page: Settings },
  { pattern: "/app/admin", Page: Admin },
  { pattern: "/app/styles", Page: Styles },
  { pattern: "/app/download", Page: DownloadPage },
  { pattern: "/profile", Page: Profile },
];

const AUTH_ROUTES = [
  { pattern: "/login", Page: Login },
  { pattern: "/register", Page: Register },
  { pattern: "/forgot-password", Page: ForgotPassword },
  { pattern: "/reset-password", Page: ResetPassword },
];

/** Supabase email-confirmation and password-recovery links redirect back
 * here with the session tokens appended directly to the URL -- as
 * `#access_token=...&type=signup` (implicit flow), optionally with a real
 * path first (`#/reset-password&access_token=...&type=recovery`), or as
 * `?code=...` (PKCE). This app's own hash router would otherwise
 * immediately misread that hash as an unrecognized path and rewrite it
 * away, destroying the tokens before supabase-js's own (always-async)
 * exchange ever gets a chance to read them.
 *
 * Captured ONCE, synchronously, on App()'s very first render -- before
 * supabase-js's own async processing has had any chance to run. This
 * matters: supabase-js cleans up the URL itself once it's done (via
 * `history.replaceState`, which fires no `hashchange`), so re-deriving
 * "is this still a callback?" from the live URL on a later render would
 * flip back to `false` the instant supabase's own cleanup lands -- often
 * before this component's effect below ever gets to run -- at which point
 * the router's *own* state is still stuck on whatever garbage path it
 * first parsed (no `hashchange` ever fired to update it), and execution
 * falls through to the exact same unrecognized-path problem this exists
 * to prevent. Snapshotting the real intent up front sidesteps that race
 * entirely: what the URL looks like later never changes what this does. */
function detectAuthCallback() {
  const hash = location.hash.slice(1);
  const hasHashTokens = /(?:^|&)(access_token|error)=/.test(hash);
  const hasCode = new URLSearchParams(location.search).has("code");
  if (!hasHashTokens && !hasCode) return null;
  return { leadingPath: hasHashTokens && hash.startsWith("/") ? hash.split("&")[0] : null, done: false };
}

/** The boot screen, labelled with what the app is actually waiting for:
 * "session" while the sign-in is being checked (also the email-link
 * callback), "workspace" once that is known and the organisation is loading.
 * index.html shows the same screen, in plain HTML, until this takes over. */
function FullScreenLoading({ phase = "session" }) {
  const t = useT();
  return html`<${BootScreen} label=${t(phase === "workspace" ? "common.bootWorkspace" : "common.bootSession")} />`;
}

/** Gatekeeper for everything under /app: requires a signed-in session, then
 * requires the user to belong to at least one organization (routing them to
 * /onboarding to create one otherwise). */
function ProtectedApp({ path, query }) {
  const t = useT();
  const { session, loading: sessionLoading } = useSession();
  const [orgChecked, setOrgChecked] = useState(false);
  const [hasOrg, setHasOrg] = useState(false);
  const [orgError, setOrgError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setOrgError(false);
    withTimeout(fetchMyOrganizations(session.user.id), 15000)
      .then((orgs) => { if (!cancelled) { setHasOrg(orgs.length > 0); setOrgChecked(true); } })
      .catch(() => { if (!cancelled) { setOrgError(true); setOrgChecked(true); } });
    return () => { cancelled = true; };
  }, [session, retryTick]);

  if (!IS_CONFIGURED) {
    return html`
      <div class="min-h-screen flex items-center justify-center bg-graphite-950 px-6">
        <div class="max-w-md text-center">
          <h1 class="text-lg font-semibold text-graphite-100">${t("common.notConfiguredTitle")}</h1>
          <p class="text-sm text-graphite-400 mt-2">${t("common.notConfiguredBody")}</p>
        </div>
      </div>
    `;
  }

  if (sessionLoading) return html`<${FullScreenLoading} phase="session" />`;
  if (!session) { navigate("/login"); return null; }
  if (!orgChecked) return html`<${FullScreenLoading} phase="workspace" />`;
  if (orgError) {
    return html`
      <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-graphite-950 px-6 text-center">
        <div class="max-w-sm">
          <h1 class="text-lg font-semibold text-graphite-100">${t("common.loadOrgErrorTitle")}</h1>
          <p class="text-sm text-graphite-400 mt-2">${t("common.loadOrgErrorBody")}</p>
        </div>
        <${Button} onClick=${() => setRetryTick((n) => n + 1)}>${t("common.retry")}<//>
      </div>
    `;
  }
  if (!hasOrg) { navigate("/onboarding"); return null; }

  for (const route of DASHBOARD_ROUTES) {
    const params = matchRoute(route.pattern, path);
    if (params) {
      const Page = route.Page;
      return html`
        <${Shell} currentPath=${path}>
          <${Page} params=${params} query=${query} />
        <//>
      `;
    }
  }
  navigate(HOME_PATH);
  return null;
}

export function App() {
  useAutoUpdate();
  const { session, loading: sessionLoading } = useSession();
  const { path, query } = useRoute();
  const [authCallback] = useState(detectAuthCallback);
  const originalPathRef = useRef(path); // the garbage path as first parsed, captured once
  const handledRef = useRef(false);

  // Hold here, untouched, while a Supabase auth-callback link is still
  // being processed -- see detectAuthCallback()'s own comment. Once the
  // session has resolved (confirmed or not), decide where to go for
  // real: a password-recovery link carries its own intended path,
  // everything else lands wherever a signed-in user normally would.
  //
  // The render guard below compares `path` against the ORIGINAL garbage
  // path, not against `handledRef`. That distinction matters: navigate()
  // changes `location.hash` immediately, but useRoute()'s own `path`
  // state only catches up once the native `hashchange` event is actually
  // processed, which happens on a later task -- and unrelated renders
  // (e.g. another useSession() listener notifying on a second auth
  // event) can land in that gap. A render in that gap still has a
  // not-yet-updated (garbage) `path`, so gating on "have we decided
  // where to go" alone would let exactly one such render fall through to
  // App()'s own catch-all with that stale path, undoing everything this
  // exists to prevent. Gating on "has the router's path actually moved
  // on yet" is immune to how many renders happen in between -- it only
  // flips once, for good, when it's genuinely safe to.
  useEffect(() => {
    if (!authCallback || handledRef.current || sessionLoading) return;
    handledRef.current = true;
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
    navigate(authCallback.leadingPath === "/reset-password" ? "/reset-password" : (session ? HOME_PATH : "/login"));
  }, [authCallback, sessionLoading, session]);
  if (authCallback && path === originalPathRef.current) return html`<${FullScreenLoading} phase="session" />`;

  if (path === "/" || path === "") return html`<${Landing} />`;

  if (path === "/download") return html`<${DownloadPage} standalone=${true} />`;

  if (path.startsWith("/research/")) {
    const params = matchRoute("/research/:slug", path);
    return html`<${ParticipantRunner} slug=${params.slug} preview=${false} />`;
  }

  if (path.startsWith("/u/")) {
    const params = matchRoute("/u/:username", path);
    if (params) return html`<${PublicProfile} params=${params} />`;
  }

  if (path.startsWith("/app/experiments/") && path.endsWith("/preview")) {
    const params = matchRoute("/app/experiments/:id/preview", path);
    if (params) {
      return html`<${ParticipantRunner} experimentId=${params.id} preview=${true} />`;
    }
  }

  if (path === "/onboarding") return html`<${Onboarding} />`;

  for (const route of AUTH_ROUTES) {
    if (matchRoute(route.pattern, path)) {
      const Page = route.Page;
      return html`<${Page} />`;
    }
  }

  if (path.startsWith("/app") || path === "/profile") {
    return html`<${ProtectedApp} path=${path} query=${query} />`;
  }

  navigate("/");
  return null;
}
