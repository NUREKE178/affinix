# DecisionOS — production migration progress

## Phase 0 — repo scaffold ✅

## Phase 1 — DB schema, RLS, Auth, Organizations ✅ DEPLOYED

Schema + RLS pushed to the real project (`kjqqqovjapmktpdvfbyv`); all 4
Edge Functions (`start-session`, `submit-response`, `complete-session`,
`generate-insights`) deployed and `ACTIVE`. Real Supabase Auth
(register/login/logout/forgot/reset password). Organization model with
owner/admin/researcher/viewer roles. `/app/*` is a real protected route.

A real bug was found and fixed here, the hard way: `INSERT ... RETURNING`
(what `supabase-js`'s `.insert().select()` always sends) is filtered by a
table's SELECT policies, not just the INSERT policy's `WITH CHECK`. A
brand-new org's creator isn't a member of it yet at the moment of insert,
so the original "members can read" policy hid the row Postgres had just
correctly inserted, and reported that identically to an actual rejection.
Fixed in migration `0004` (a narrow "creator can read their own new org"
policy, plus folding org-create + owner-seating into one atomic
`create_organization_with_owner()` function). Verified with `SET LOCAL`
per simulated request (not a mid-session GUC flip, which had produced a
false pass earlier) against real PostgreSQL 16.

## Phase 2 — Real experiment CRUD + builder wired to DB ✅ (migrations 0005 not yet pushed to the live project — see below)

- `lib/experiments.js`: DB ⇄ JS shape mapping, draft save (full
  replace-sync of variants/questions/options while a draft), publish
  (generates a public slug), duplicate, delete (+ storage cleanup).
- `lib/storage.js` + migration `0005_storage.sql`: real file upload to a
  `variant-assets` Storage bucket, type/size validated client-side, RLS
  scoped by `<org_id>/<experiment_id>/...` path. Verified locally: an org
  member uploads into their own folder fine; a different org's member and
  `anon` are both blocked, even with a syntactically valid org-shaped
  path.
- `ExperimentBuilder.js` persists every step to Supabase (real UUIDs via
  `crypto.randomUUID()`, no more fake `exp_...` ids). `ExperimentsList.js`
  publishes / duplicates / deletes for real and copies a real public link
  (`#/research/<slug>`).

## Phase 3 — Public participant flow + real response collection ✅ (needs migration 0005 pushed to go fully live)

- `lib/participantApi.js` calls the three Phase-1 Edge Functions.
  `ParticipantRunner.js` now has two genuinely separate paths:
  - **Preview** (builder step 7, or "preview" from the experiments list) —
    100% local, no network call, nothing persisted. Exactly like before.
  - **Live** (`/research/:slug`) — calls `start-session` (server-assigned
    counterbalanced order), `submit-response` per answer (idempotent on
    retry, with a visible "couldn't send, retry" UI on network failure),
    `complete-session` at the end. Duplicate-run guard via localStorage
    keyed by slug, same rigor as the old demo build.
- `App.js`: `/r/:id` replaced with `/research/:slug`.

## Phase 4 — Real analytics from DB, demo data removed ✅

- `lib/participants.js` fetches real `participant_sessions` + `responses`
  and maps them into the exact shape `lib/stats.js` / `lib/insights.js`
  already expected — so the analytics engine and the AI-insight generator
  needed **zero logic changes** to work against real data.
- Overview, Results, Insights, Reports, Participants, Team, Settings all
  read live Supabase data. `lib/store.js` and `lib/demoData.js` (the
  entire localStorage/synthetic-data layer) are **deleted** — there is no
  code path left in this app that can show fabricated numbers.
- Team: migration `0006_team.sql` adds `profiles.email`, co-member profile
  visibility (scoped to shared org membership, verified non-members can't
  see it), and an `add_member_by_email()` RPC (owner/admin-only, existing
  accounts only).
- Landing page rewritten with the requested Russian copy
  ("Понимайте, почему люди выбирают…"). Most user-facing strings touched
  this pass are now Russian; a real i18n system (RU default, + KZ/EN
  switcher) is still Phase 6, not done piecemeal here.

## ⚠️ Action needed: push migrations 0005 + 0006

Only `0001`–`0004` are applied to the live project so far. From your
machine, in the repo:

```bash
git pull origin main
npx supabase db push
npx supabase functions list   # sanity check, unchanged this round
```

Until `0005` is pushed, uploading a variant image will fail (no bucket
yet). Until `0006` is pushed, Team will fail to load member names/emails
and "add by email" will error.

## Phase 5 — AI insights via Edge Function — stubbed only, deferred by request

## Phase 6 — i18n (RU default, KZ/EN switcher) — not started
(Most strings are already Russian as a side effect of Phases 2-4, but
there's no language-switching system, no KZ/EN translations, and no
per-user locale persistence yet.)

## Phase 7 — Error/loading states, responsive QA, security audit, final checklist — not started

## Bugfix — couldn't delete a user from Supabase Auth ✅ (migration 0007, needs push)

Real-world report: deleting a user from Supabase Dashboard → Authentication
→ Users failed with "Database error deleting user". Root cause: `created_by`
on `organizations`, `experiments`, `ai_insights`, `reports` referenced
`auth.users(id)` with the Postgres default `on delete no action`, so any
user who ever created an org/experiment could never be deleted.

Reproduced the exact error locally first (`organizations_created_by_fkey`
violation) against migrations `0001`-`0006` on real PostgreSQL 16, with no
`0007` applied — confirmed this was the real cause, not a guess. Fixed in
migration `0007_created_by_set_null.sql`: these FKs are now `on delete set
null` (an audit/attribution column shouldn't keep a user — or their
teammates' shared org data — hostage; `created_by` just becomes null for
rows made by a deleted account). Re-tested the same scenario end to end
against a fresh local DB with `0007` applied: the delete now succeeds, the
organization and experiment survive with `created_by = null`.

### ⚠️ Action needed: push migration 0007

```bash
git pull origin main
npx supabase db push
```

Until this is pushed, deleting a user who ever created an organization or
experiment will keep failing in the live project the same way it did in
your screenshot.

---

## MAJOR PRODUCT UPGRADE — comparison-first research platform v2

Requested: a full redesign into a premium, 10/10 "Consumer Decision
Intelligence" platform — design system, app shell, full profile/account
system, a comparison-first (A/B/C/D) research builder, redesigned
participant experience, redesigned results + comparison matrix, structured
AI insight cards, participant accounts + reward architecture, full RU/KZ/EN
i18n, and a production QA pass.

### Audit (before writing any code)

- Stack confirmed: Preact + htm, no build step, ES modules via import map;
  Tailwind compiled with the real CLI into `vendor/tailwind.css` (not CDN
  JIT) — **any new class needs `npx tailwindcss -i ./src/tailwind-input.css
  -o ./vendor/tailwind.css --config ./tailwind.config.js --minify` rerun**,
  done after every markup change in this pass.
- Backend: Supabase (Postgres + Auth + Storage + Edge Functions + RLS), no
  custom server — upgrade work stays in that model.
- The 7-step `ExperimentBuilder` (Information → Research type → Stimuli →
  Questions → Participants → Settings → Preview) was already close to the
  requested structure, already variant-aware (A-D), already has real upload
  + real randomization. It's being evolved (Phase 2 of this upgrade, not
  started yet), not rebuilt.
- `shell.js`'s nav was in English in a Russian product, had no user
  dropdown, no workspace section, no profile. `profiles` table existed
  (full_name/avatar_url/locale/email) but had no username, bio, role,
  country, timezone, or public-profile support. No `/profile`, `/u/:username`
  or `/app/billing` routes existed. `lib/format.js`'s relative/short dates
  were hardcoded English ("3d ago") inside an otherwise-Russian app — fixed
  as part of this pass.
- Reward/marketplace/participant-payment sections of the request need a real
  business decision (currency, payment provider, KYC/payout compliance) that
  isn't mine to make — consistent with the request's own "never fabricate
  real monetary balances" rule. Deferred until the user picks a provider;
  everything else in the 10-phase plan proceeds without blocking on it.

### Upgrade Phase 1 — design system + shell + profile ✅ (migration 0008, needs push)

- **Migration `0008_profile_system.sql`**: `profiles` gains `username`
  (unique, format-checked, case-insensitive), `bio`, `role_title`,
  `country`, `timezone`, `research_interests`, `public_profile_enabled`,
  `notify_email_responses`, `notify_email_digest`. A new `avatars` storage
  bucket (public read, write restricted to the owning user's own
  `<user_id>/...` folder — same pattern as `variant-assets` but keyed by
  user). A `get_public_profile(username)` SECURITY DEFINER function returns
  only safe columns, and only for rows that opted in — never a relaxed RLS
  policy on the table that already holds `email`. Tested locally end to end
  against real PostgreSQL 16: username uniqueness (case-insensitive)
  blocked a collision, `get_public_profile` returned Alice's data once she
  opted in and zero rows for Bob (who hadn't), anon still can't read the raw
  `profiles` table, and avatar storage RLS blocked both a cross-user upload
  and an anonymous upload while allowing a user's own. (The avatar storage
  test caught a gap in the local test harness itself — `storage.objects`
  had no RLS enabled, so every policy was silently bypassed; fixed the
  harness, not just worked around it, re-verified after the fix.)
- **`lib/profile.js`** (new): reactive `useMyProfile()` store (same
  listener-set pattern as `useCurrentOrg`), `updateMyProfile`, `uploadAvatar`
  (validates type/size, replaces + cleans up the old file), real
  `fetchMyProfileStats` (experiments created, completed participants — both
  real queries, nothing invented), `fetchPublicProfile` via the RPC.
  `lib/auth.js` gained `requestEmailChange`.
- **Shell redesign** (`components/shell.js`): nav translated to Russian
  (Обзор/Исследования/Участники/Результаты/Инсайты/Отчёты), a "Рабочее
  пространство" section (Команда/Биллинг/Профиль/Настройки), a real user
  menu (avatar, name, org, online dot, dropdown → Профиль/Настройки/Выйти),
  a functional search box (filters `/app/experiments` by name/objective —
  honestly scoped; it doesn't search participants/results yet, and the
  placeholder copy was corrected to stop implying it does), an honest
  notifications dropdown ("Пока нет уведомлений" — no fake notification
  feed), and a language switcher (RU/KZ/EN) that persists to
  `profiles.locale` — full UI translation into KZ/EN is still Phase 8
  (unchanged from the original plan), so this ships the control and the
  persisted preference now rather than pretending the whole app is
  translated.
- **`/profile`** (new): Личная информация (avatar upload, name, username,
  role, country, bio, research interests, public-profile opt-in, email
  change), Безопасность (password change), Уведомления, Предпочтения
  (locale + timezone), Сессии (real account-created date, real experiment
  and completed-participant counts — no fake "last active" tracking, since
  nothing logs that yet).
- **`/u/:username`** (new): opt-in public researcher profile via
  `get_public_profile()` — shows name/role/org/bio/interests, never email or
  private data; renders a clean "not found" state when the username doesn't
  exist or hasn't opted in.
- **`/app/billing`** (new): honest placeholder — states plainly that no
  paid plan or payment processing exists yet rather than showing an
  invented balance.
- **Overview**: personalized "Добро пожаловать, {имя}" header with a real
  secondary CTA ("Открыть последние результаты", only shown when a
  non-draft experiment actually has participant data).
- **`lib/format.js`**: fixed English date strings ("3d ago", "yesterday")
  that were leaking into the Russian UI everywhere `relativeDate`/`shortDate`
  were used (Overview, ExperimentsList, Reports, Results, Participants).

Verified: all touched files pass `node --check`; a Playwright pass over
every unauthenticated-reachable route (landing, login, register, public
profile 404, all `/app/*` and `/profile` auth gates, research-link 404) at
desktop and mobile widths shows zero console/page errors; an authenticated
pass (mocked Supabase session + REST responses, since this sandbox's
network policy blocks the real Supabase project) exercises the shell, all
five profile tabs, the user dropdown, billing and the public-profile view.

### ⚠️ Action needed: push migration 0008

```bash
git pull origin main
npx supabase db push
```

Until this is pushed, `/profile` will fail to load (missing columns) and
avatar upload will fail (no bucket yet).

### Remaining upgrade phases (not started)

2. Comparison-first builder upgrade: richer question library (best/worst
   pair, attribute comparison, 2D matrix, forced choice, recognition),
   question-recommendation engine, duration/burden estimate, mobile-ready
   drag-and-drop variant reordering.
3. Participant experience redesign: distraction-free mobile-first runner
   polish, smart/branching question flow, low-quality-response signal
   (flagged for review, never auto-deleted).
4. Results redesign: "winning variant" summary, full comparison matrix
   (metric × variant), "best for X" callouts grounded in the actual sample.
5. AI insights as structured cards (key finding / evidence / why it matters
   / who it applies to / next test) instead of prose paragraphs — still
   gated on a real AI_API_KEY the user hasn't provided yet.
6. Participant accounts + reward **architecture only** (budget/reserved/
   pending tracking schema) — real payment/withdrawal needs a provider
   decision from the user first; nothing here will show a fabricated
   balance.
7. Full RU/KZ/EN i18n across every string (the language switcher from
   Phase 1 currently only persists a preference).
8. Responsive/accessibility/performance pass, production QA checklist.

## Critical bugfix found during the i18n pass: publishing an experiment has always failed ✅

While wiring real i18n, `lib/experiments.js`'s `publishExperiment()` turned
out to write `status: "active"` -- but the DB enum (`experiment_status` in
migration `0001`) only accepts `draft | published | paused | completed |
archived`. Reproduced directly against real PostgreSQL 16: `update ... set
status = 'active'` throws `invalid input value for enum experiment_status:
"active"`. Every single publish attempt has been failing this whole time;
it only went unnoticed because `toast()` was a no-op (now fixed) so the
error was silently swallowed. Fixed the write (`"published"`) and every
frontend place that compared/filtered on `"active"` (shell active-count,
Overview, ExperimentsList, Results) to match -- the user-facing label
stays "Активные/Active/Белсенді", only the stored/compared value changed.

## i18n (RU default + real KZ/EN) -- infrastructure done, page coverage in progress

`lib/i18n.js`: a reactive locale store (`useT()`/`useLocale()`/`setLocale()`
following the same listener-set pattern as `useCurrentOrg`), backed by three
full dictionaries (`lib/locales/{ru,kk,en}.js`, 536 matching keys each,
parity-checked by script) covering the shell, landing, auth, overview,
experiments list, results, insights (including every AI-insight sentence
template, not just UI chrome), question/research-type vocabulary. Locale
resolution: an explicit choice (`localStorage`) always wins; failing that,
a signed-in user's saved `profiles.locale`; failing that, browser language;
default `ru`. Participant-facing copy is meant to follow the experiment's
own configured language rather than the researcher's -- plumbing (`t(locale,
key, vars)` with an explicit locale) is in place for this but
`ParticipantRunner.js` itself isn't wired yet (see below).

**Update — rollout now complete** for every researcher-facing page: Reports
(including the downloadable .md report text and date formatting per
locale), Team, Settings, Participants, Billing, Profile (all 5 tabs, incl.
its own language picker now writing through the same global `setLocale()`
instead of a disconnected local copy), PublicProfile, `lib/insights.js`
(every AI-insight sentence template -- was the one place still silently
hardcoded Russian even though `Insights.js`/`Reports.js` were already
passing it a `locale` argument), and `ParticipantRunner.js`. The last one
follows the **experiment's own configured language** (`experiments.language`,
default `ru`) rather than the researcher's own account locale, per the
architecture doc's §5 rationale -- participants are a different, often
differently-languaged, audience. Added the missing `language` field to
`lib/experiments.js`'s row mapper so the builder-preview path carries it
too (the live `/research/:slug` path already got it from `start-session`).

`ExperimentBuilder.js` is the one remaining page still hardcoded Russian --
left alone deliberately, since the UX architecture doc's §6 replaces its
Step 4 entirely; translating strings that are about to be deleted would be
wasted work. Everything else in the app now genuinely switches, in every
language, everywhere, as asked.

Verified with a full Playwright pass: every route's module graph loads
clean (catches any broken import across the whole app, since this is
native ESM with no bundler -- a single broken export anywhere fails every
page), a mocked-auth pass through every reworked page including all 5
Profile tabs, and -- the real test -- actually switching to KZ mid-session
and re-checking Overview/Team/Reports/Profile: sidebar, stats, charts,
empty states, the downloadable report, and the AI-insight disclaimer text
all rendered correctly in Kazakh, with live data flowing through
`lib/insights.js`'s real sentence generation, not just static labels.

## Next: full UX/IA redesign requested (superseded in part -- see below)

A large follow-up brief had come in: rethink navigation/IA around
Create → Collect → Understand → Decide, an adaptive (new/active/completed)
dashboard state, a guided multi-step research-creation flow, a
dimension-based (not form-based) comparison question builder, a
three-questions-in-10-seconds Results redesign, structured AI insight
cards with an evidence drill-down, a real participant marketplace account
view, and a mobile-first pass throughout. Its own §12 "Visual language"
explicitly said to *keep* the existing flat dark-surface/indigo-accent
system -- superseded by the skeuomorphic brief below, visual language only;
the IA/structural content (sitemap, dashboard states, creation flow,
comparison builder, Results reorder, profile tabs) still stands as the plan.

## FULL SKEUOMORPHIC REDESIGN + COMPLETE BUG FIX + PRODUCTION STABILITY

New brief: (1) find and fix every loading/runtime/data stability bug,
(2) only then redesign the entire visual language into full skeuomorphism
(dimensional surfaces, bevels, inset controls, tactile press states -- a
"physical research instrument", not flat cards or glassmorphism), in that
explicit order. This update covers stage (1), done first exactly as
instructed ("Do NOT guess. Inspect the actual implementation" before any
visual change). Stage (2) is tracked separately below, not started yet.

### Stability audit -- method

Grepped the whole `src/` tree for every `.then(` not immediately followed
by a `.catch(` on the same chain (the strongest available signal for "this
can get stuck in loading forever if the request fails"), then individually
read and classified each hit -- a line-based grep produces false positives
whenever a `.catch()` exists further down the same chain, so every hit was
confirmed by hand, not assumed. 11 hits total: 2 already safe (`Onboarding.js`'s
org-check, `ParticipantRunner.js`'s `startSession` call both already had a
`.catch()` a line or two down), 9 were real.

### Bug map (all 9 fixed)

| # | Root cause | Affected route / component | Fix |
|---|---|---|---|
| 1 | `lib/auth.js`: `supabase.auth.getSession()` had no `.catch()` -- a rejection left `initialized` false forever, hanging `useSession().loading` (and therefore every `/app/*` route + `/profile`) indefinitely, with zero recovery path. Highest-severity: this gated the entire authenticated app. | All of `/app/*`, `/profile` | Added `.catch()`: fail closed to signed-out (`currentSession=null; initialized=true`) instead of hanging. Also wrapped the call in a 10s `withTimeout` -- this exact "GoTrueClient session-restore hangs" failure mode was directly observed earlier in this session's own test harness. |
| 2 | `ExperimentBuilder.js`'s edit-mode fetch had no `.catch()` (stuck "Загрузка…" forever on a real error) **and** silently kept the blank new-experiment draft on a resolved-but-`null` result (a nonexistent/inaccessible id renders an empty "create new experiment" form under what looks like a real edit URL -- exactly the "fake success" the brief forbids). | `/app/experiments/:id/edit` | Added a `loadError` state distinguishing `"not_found"` from a thrown error, each with its own `EmptyState` (not-found → back to list; error → Retry, re-runs the fetch). 15s timeout. |
| 3 | `Profile.js`'s `SessionsTab` stats fetch had no `.catch()` -- the two stat rows stayed at `"…"` forever on error, indistinguishable from "still loading". | `/profile` → Sessions tab | Added `statsError` state + inline retry banner; rows show `"—"` instead of an eternal `"…"`. |
| 4 | `Results.js` / `Reports.js` / `Insights.js`: identical `fetchSessionsForExperiment(...).then(...)` with no `.catch()`. Insights/Reports: the whole page/card hung on "Загрузка ответов…" forever. Results: worse -- the page doesn't gate render on this fetch at all, so a real fetch error rendered a full results page with silently-zeroed stats, indistinguishable from "0 participants so far" (a fake-success case, not just a hang). | `/app/experiments/:id/results`, `/app/reports`, `/app/experiments/:id/insights` (+ their org-wide variants) | Added a `participantsError` state + `.catch()` to all three, each with a distinct, visible error banner/EmptyState and a Retry button that re-runs the fetch. 15s timeout each. |
| 5 | `ParticipantRunner.js`'s dashboard-preview path (`/app/experiments/:id/preview`): same double bug as #2 -- no `.catch()`, and a resolved-`null` silently left the UI on its "loading" text forever (looking identical to a real hang, not a distinct not-found state). | `/app/experiments/:id/preview` | Same `loadError` (`"not_found"` vs. error) pattern as #2, with a "back to experiments" action. 15s timeout. Also timeout-wrapped the live public flow's `startSession`/`submitResponse`/`completeSession` calls (already had `.catch()`/try-catch, but none had a ceiling against a connection that never settles at all -- the highest-stakes path, real participants, real research data). |
| 6 | `App.js`'s `ProtectedApp`: the org-fetch `.catch()` already existed, but **mis-categorized a real fetch error as "this user has zero organizations"**, silently redirecting them into the onboarding/create-org flow -- a legitimate existing org member could be shown "create a workspace" because of a transient network blip. | Every `/app/*` route, first load after sign-in | Added a distinct `orgError` state checked *before* the zero-orgs redirect, with its own error card + Retry (re-runs the fetch) instead of redirecting. 15s timeout. |
| 7 | `PublicProfile.js`: already had a `.catch()` and tracked `error` in state, but the render never used it -- a real fetch error and a genuine "this username doesn't exist" collapsed into the exact same message. | `/u/:username` | Added a distinct error branch (different title/body + Retry) ahead of the not-found branch. 15s timeout. |
| 8 | `auth/Onboarding.js`'s org-check: already safe (had a `.catch()`), but shared the same "could hang forever if the promise never settles at all" exposure as everything else, on a path every brand-new signup hits. | `/onboarding` | Added the 15s timeout wrapper (no behavior change otherwise). |
| 9 | No request in the app had any timeout at all -- a dropped connection that never resolves *or* rejects would hang a loading state forever even with a correct `.catch()`, since nothing ever calls it. | All of the above | New `src/lib/async.js`: `withTimeout(promise, ms, message)` races a promise against a timeout (default 15s; 10s for the app-gating `getSession` call). Doesn't abort the underlying request (no abstraction threads an `AbortSignal` through the data layer today, and building one was out of scope for this pass), but guarantees the UI always reaches an error state. Applied to all 9 fixes above. One regression caught and fixed while wiring this up: `ParticipantRunner.js`'s answer-submit error path did `err.message \|\| networkError`, which would have shown the raw English `"Request timed out"` debug string in the RU/KZ UI -- fixed to special-case `TimeoutError` into the localized network-error message instead. |

Scope note: timeouts were added to every fetch that gates a loading state on
page load/route change (the "blank/stuck page" class of bug the brief is
about), plus the live participant flow's three Edge Function calls
(highest real-world stakes). Button-triggered save/update actions elsewhere
(Settings, Team, Billing, Profile's save handlers, publish/persist in the
builder) already fail safely into a toast + re-enabled button via existing
try/catch/finally -- they weren't additionally time-boxed in this pass.

### Verification

Not just re-read -- reproduced. A Playwright harness (mocked Supabase
responses, real browser) drove each of the 9 fixes through its actual
failure path: forced a 500 on the exact table/RPC each bug depends on,
confirmed the new distinct error UI renders (not a hang, not silently
mistaken for empty/not-found), clicked the real Retry button, and confirmed
it re-fetches and recovers into real content. 15/15 scripted checks passed,
zero unexpected console/page errors. (One real methodology trap hit and
fixed along the way: Supabase's `detectSessionInUrl` races this app's own
hash router on a *fresh* navigation straight to a `#/...` URL, which can
hang client-side with zero network requests ever firing -- a known
pre-existing sandbox quirk, not an app bug; worked around with the
established two-step navigation pattern, same as earlier in this session.)
Re-ran the existing full-i18n and mobile-overflow regression smoke tests
against the current code afterward -- both still pass clean, confirming
nothing in this pass regressed the earlier i18n/mobile fixes.

## RELEASE BLOCKER fixed: direct URL / hard-refresh hung on "Загрузка..." forever

Real-world report: opening `https://decisionos-self.vercel.app/#/app/overview`
directly (hard refresh, fresh tab, incognito) often left the whole app stuck
on "Загрузка..." forever -- never an error, never content. This was
initially suspected to be a Supabase `detectSessionInUrl` vs. hash-router
conflict (a real, separate quirk also present in this project's Playwright
test harness -- worked around there with a two-step navigation), but
instrumented tracing proved the actual production root cause is different
and more fundamental:

**Root cause**: every module-level reactive store in this app (`useSession`,
`useRoute`, `useLocale`, `useExperiments`, `useCurrentOrg`, `useMyProfile`,
`useOrgSessions` -- 7 in total) subscribes to change notifications inside a
`useEffect`, which Preact (like React) defers until *after* the first paint.
`lib/auth.js`'s `getSession()` / `onAuthStateChange("INITIAL_SESSION")`
need only a few microtasks (a `localStorage` read, no network) and -- on a
cold boot through this app's large single-bundle static-import module graph
-- reliably *resolve before* `useSession()`'s effect has committed. Its
`notify()` fires into an **empty listener set** (nothing has subscribed
yet) and is silently lost forever; no later event ever fires again to
trigger the catch-up render. The component is left showing its first,
stale `loading: true` render permanently, even though the module-level
auth state resolved correctly in the background within milliseconds.
Confirmed by direct instrumented tracing (not guessed): `getSession()`
resolved in ~20ms every time, while `ProtectedApp` rendered exactly once
and never again, for the entire observed window.

This is a textbook "external store missed between render and effect commit"
race (the reason React later shipped `useSyncExternalStore`) -- and with
no code-splitting, every route hits the same module graph, so it isn't
unique to `/app/overview`; direct URL load for `/app/experiments`,
`/app/participants`, results/insights/reports, `/profile`, and
`/app/settings` all shared the identical exposure.

**Fix**: every one of the 7 stores now calls its own listener once,
immediately after subscribing (`listeners.add(listener); listener();`),
to re-sync against whatever the store's live state already is by the time
the effect commits -- cheap, idempotent, and the standard correct fix for
this pattern. `lib/auth.js` was the only one that could actually lose a
notification today (its write path runs at module-eval time, independent
of any component); the other six write from inside an effect gated behind
the same subscription, so they were latent rather than proven-exploitable,
but get the identical defensive fix for the same reason the brief asked
for a full audit, not a single patch.

**Verified by reproduction**: a fresh-context-per-route Playwright suite
(no shared state between loads, matching "hard refresh" / "fresh tab"
exactly) direct-loads `/app/overview`, `/app/experiments`,
`/app/participants`, `/app/experiments/:id/results`, `.../insights`,
`/app/reports`, `/profile`, `/app/settings`, plus a signed-out cold boot --
all 9 resolve to real content (or the login page) in under 450ms, zero
console errors. Before the fix, the exact same single-step direct
navigation hung for 24+ seconds straight with zero network requests ever
firing (confirmed instrumented, not inferred). Re-ran the full 15-check
stability-fix suite afterward too -- still 15/15, no regressions from
touching these shared hooks.

## Skeuomorphic visual redesign -- shipped across the whole app

The brief was explicit that this had to be a *visible* change now, not a
future phase, and that it had to look like "a physical research
instrument" -- dimensional surfaces, bevels, inset/raised controls -- not
1990s skeuomorphism, not neon/gaming/crypto, not just recolored flat cards.

**System** (`styles.css`, pure CSS, no raster textures, no rebuild step):
a set of `.sk-*` classes layered on the *existing* slate neutrals + indigo
accent (not a new palette) -- `sk-panel`/`sk-panel-flat` (raised, gradient
+ bevel + outer shadow), `sk-display`/`sk-display-deep` (recessed/inset,
for stat numbers, chart frames, upload slots), `sk-btn`/`sk-btn-primary`
(tactile, real `:active` press-down state), `sk-input`, `sk-tabs`/`sk-tab`,
`sk-switch-track`/`sk-switch-knob`, `sk-sidebar`/`sk-topbar`/`sk-nav-item`
(pressed/recessed active state), `sk-badge`, `sk-modal`, `sk-checkbox`,
`sk-slot`/`sk-slot-label` (the A/B/C/D "physical specimen slot" -- selected
state glows, used for variant cards, research-type picker, and every
A/B/C/D control in the participant flow).

**Applied to**: `components/ui.js` (every shared primitive --
Card/Button/Badge/StatTile/ProgressBar/EmptyState/Modal/Tabs/TextInput/
TextArea/Select/Checkbox/Switch/ToastHost) and `components/charts.js`
(every chart now sits in a recessed display frame) first, since nearly
every page composes from these and it cascades everywhere for free; then
`components/shell.js` (sidebar as a physical control panel, topbar as an
instrument strip, language switcher as a tactile segmented control);
then per-page bespoke surfaces that don't go through the shared
components: Landing, AuthLayout (Login/Register/Forgot/Reset all inherit
it), `ExperimentBuilder.js` (step tracker, research-type picker, A/B/C/D
variant upload slots, question cards, publish checklist -- all 7 steps),
`ParticipantRunner.js` (stimulus cards, progress track, timer ring,
yes/no + rating controls, consent/demographics/done icons -- kept
deliberately simpler/flatter than the researcher side per the brief's own
"distraction-free, mobile-first" instruction for participants), Profile,
PublicProfile, Reports, Results, Overview. Swept the rest of the app
(Team, Settings, Billing, ExperimentsList, Participants, Insights,
Login/Register/Onboarding) for any remaining bespoke flat surface after
the shared-component pass -- all were already clean, confirming they're
built entirely from the now-updated shared primitives.

**Left alone on purpose**: semantic alert/disclaimer banners (error, "small
sample", research disclaimers) keep a flat colored-tint treatment --
instrument "warning lights" read better as flat strips than bevelled
panels, and it keeps real errors visually distinct from structural chrome.

**Not done this pass**: the Question Builder's Step 4 is reskinned (new
question-card surface, tactile type/role selects) but still its original
generic-form-builder structure -- the brief's "three-panel, dimension-based
(pick what to measure, A/B/C/D auto-built)" rebuild is a data-model-facing
feature change, not a skin, and `UX_ARCHITECTURE.md` §6 already has that
design worked out (confirmed zero-migration, maps to the existing `role`
column) for whoever picks this up next.

**Verified**: not just screenshots. Rebuilt `vendor/tailwind.css` after
every markup pass. Re-ran the full 15-check stability suite, the 9-check
direct-URL suite, and the i18n regression suite after the *entire* redesign
-- all still pass, zero console errors, confirming the visual pass didn't
regress any of the stability work. Screenshotted desktop (Overview, Login,
builder steps 2/3, Results) and mobile 390px width (Overview, Profile,
builder) -- no horizontal overflow anywhere, language switcher still
visible on mobile (the earlier mobile fix holds).

### Bugfix -- small icon buttons rendered visibly skewed/notched (mobile and desktop) ✅

Real-world report (screenshot): the topbar's menu and notification icon
buttons looked "crooked." Reproduced at 8x device-scale-factor zoom on the
exact button in the real app (not a guess) -- the bottom-left corner had a
visible diagonal notch, all four other corners clean. Root cause: several
`.sk-*` classes gave a button/panel a uniform `border` color and then
overrode just one edge (`border-bottom-color` or `border-top-color`) to
fake a bevel -- Chromium renders the mitered seam between two
differently-colored adjacent border edges as a visible diagonal cut at
their shared rounded corner, invisible on large panels but glaring on a
32px square icon button. Fixed in all 6 affected classes (`sk-panel`,
`sk-panel-flat`, `sk-display`, `sk-btn`, `sk-btn-primary`, `sk-input`) plus
one inline style (`ui.js`'s `DANGER_STYLE`): single uniform border color
on every element, with the light-top/dark-bottom bevel illusion coming
entirely from `box-shadow` insets (which don't have this per-corner
color-mitering problem). Re-screenshotted the same button at the same zoom
afterward -- notch gone, all four corners clean -- then re-ran all three
regression suites (stability/direct-URL/i18n) to confirm the fix didn't
touch anything functional.

### Bugfix -- icon-only buttons rendered off-center (bell/menu icon not centered on its button) ✅

Second, distinct report on the same icon buttons (screenshot): after the
corner-notch fix above, the bell and menu icons themselves sat off-center
inside their button -- a different bug, not a regression of the first fix.
Root cause: the base `.sk-btn` class never declared `display`/alignment at
all, so a raw `<button class="sk-btn">` with no additional centering
classes of its own laid its icon out at the default inline position
instead of centered. Fixed at the base class (`display:inline-flex;
align-items:center; justify-content:center;` on `.sk-btn` itself), which
retroactively centers every call site, including three not-yet-reported
instances it also caught: the modal close button, and the participant
runner's yes/no and rating buttons. Verified via zoomed before/after
screenshots of the exact reported icons.

### Homepage redesign: real A/B/C/D demo, 5-step workflow, example report ✅

Full rebuild of `Landing.js` per the brief: a reader has to understand the
product and see it work within five seconds, with the interactive demo as
the centerpiece, not a feature list.

- **Hero**: new RU headline/subhead (`landing.heroTitle`/`heroSubtitle`),
  secondary CTA scrolls to `#demo` instead of linking out.
- **`<HomepageDemo/>`**: a real, self-contained, local-only A/B/C/D demo --
  4 visually distinct packaging variants (CSS gradients, no stock art),
  built from the same `sk-slot`/`sk-slot-label` components the real
  participant runner uses, so the demo *looks* like the actual product,
  not a mockup of it. Flow: pick a variant → immediate visual selection
  state → second question (perceived trust) → completion state showing
  what a participant would see, with a restart control. Keyboard nav
  (digit keys 1-4 map to `[data-demo-slot]`, guarded against stealing
  focus from a real input/textarea) and verified on a 390px mobile
  viewport with zero horizontal overflow. Clearly labelled as demo data
  throughout (`landing.demo.badge`/`hint`) -- never reads as live research.
- **5-step workflow strip** (`landing.workflow.*`): Upload → Questions →
  Collect → Analyze → Insights, replacing the old generic feature-card
  grid, each step with its own icon and one-line description.
- **`<ExampleReport/>`**: a static, explicitly-labelled
  ("Демонстрационные данные") sample results card -- preferred variant,
  response count, trust/quality/premium/purchase-intention metrics, an
  AI-interpretation block that keeps Observed/Interpretation/Limitation/
  Next-step distinct (never claims to read minds, hedges on sample size),
  and an explicit "the winner depends on your research objective" caveat
  so it can't be read as a universal verdict.
- **i18n**: the entire `landing` namespace was rebuilt in all three locale
  files (`ru`/`kk`/`en`) -- old `badge`/`heroTitlePre`/`steps.s1-s7` keys
  removed, new `heroTitle`/`demo.*`/`workflow.*`/`report.*` keys added.
  Parity re-verified: 603 matching dot-path keys across all three locales.

**Verified**: Playwright run exercising the full demo interaction (click
through both questions, completion state, restart, keyboard selection),
desktop + mobile (390px, zero overflow), zero console/page errors -- 13/13
checks passed. Manually reviewed screenshots of both viewports.

### Question Builder: real named measurement dimensions ✅

The brief called the Question Builder a core feature and asked for named
measurement types beyond generic question forms -- trust, perceived
quality, premium perception, clarity, recall, purchase intention, on top
of the existing selection/preference and attention roles. Implemented as
an *additive* quick-add layer on Step 4, not a replacement of the manual
question editor:

- `lib/questionTypes.js`: `DIMENSION_DEFS` (8 dimensions, each with an id,
  icon, underlying `question_type`, and `role`), `measurementDimensions(t)`
  (resolves current-locale label/blurb/default prompt via the existing
  `resolveT` fallback so callers don't need to import `useT()`), and
  `questionFromDimension(id, uid, t)` (builds a ready-to-insert question
  draft with the right type/role/prompt pre-filled).
- **Zero migration**: `experiment_questions.role` is already
  unconstrained free text and `question_type` already has every type this
  needs (`single_choice`, `rating`, `recall`) -- confirmed by reading the
  actual migration files rather than assuming.
- `ExperimentBuilder.js` Step 4: a new row of dimension chips ("Or pick
  what you want to measure -- the question is added automatically")
  above the existing manual question list. Clicking a chip appends a
  fully-formed question via `addDimension(id)`; chips already represented
  among the draft's questions show a checkmark. The question `role`
  dropdown was also expanded to include the new roles so they remain
  editable by hand.
- `locales/{ru,kk,en}.js`: new `builder.dimensions.*` namespace (intro +
  8 × `{label, blurb, prompt}`), kept in the same 603-key parity as above.

**Verified end-to-end, not just at the UI layer**: built a fully stateful
mocked-Supabase Playwright harness (tracking experiment/variants/
questions/options across POST/PATCH/DELETE/GET, not a generic empty-body
mock) and walked the real wizard -- fill Step 1, pick a research type,
name two variants, click the Trust and Premium dimension chips on Step 4,
and confirmed via the mock's captured insert payloads that both questions
reach the save pipeline correctly formed
(`{type: "single_choice", role: "trust", prompt: "Какой вариант вызывает
у вас больше доверия?"}` and the equivalent for premium) -- then advanced
through Steps 5-7 to the preview step without error. 6/6 checks passed.
Re-ran the full stability (15/15), direct-URL (9/9), i18n (zero errors),
locale-parity (603/603/603), and landing-page (13/13) regression suites
after this round's full diff -- all clean.

**Deferred** (unchanged from the brief's own priority order): objective-
based AI-assisted question suggestions -- the brief requires these to be
honest and reviewable, not fabricated, and there's still no real AI
provider wired in (`AI_API_KEY` not supplied), so this stays a rule-based
follow-up rather than something faked to look like a model output.

### Product-direction clarification: social/community layer

A later brief asked for a full pivot of the homepage to a Threads-style
marketing social network (feed-first, posts/comments/follows), which
directly conflicted with the homepage work above (sent only shortly
before). Flagged the contradiction rather than guessing silently, given
the size and one-way cost of standing up a social-network backend on a
possibly-wrong premise. Resolved: the research platform stays the primary
product (this redesign is it); a social/community layer is scoped as a
new, additive section alongside it, not a replacement -- not started yet.

### Homepage demo: added an intro gate before the first question ✅

Feedback on the live demo: it dropped straight into "Which variant would
you choose?" with no framing the instant the section scrolled into view.
Added a third phase to the demo's state machine (`intro -> q1 -> q2 ->
done`, was `q1 -> q2 -> done`) -- on load it now shows a centered card
(play icon, one-line explanation of what's about to happen, a primary
"Начать демо" button) and only mounts the variant tiles once that's
clicked. Deliberately mirrors the existing `done` state's layout (icon +
title + body + button) so the demo reads as a matched pair of bookends
around the two interactive questions, rather than a bolted-on screen.
`restart()` still returns straight to `q1`, not back through the intro --
a user who already finished the demo once doesn't need the explanation
again. New `landing.demo.intro.{title,body,cta}` keys in all three
locales (606/606/606 parity).

**Verified**: new 10-check Playwright pass (intro shows on load with zero
variant tiles present, Q1/tiles only appear after clicking start, full
q1→q2→done flow still works, restart skips the intro, zero console
errors) plus updated the existing landing-page regression script to click
through the new gate -- 14/14. Re-ran the stability (15/15) and
direct-URL (9/9) suites unchanged. Screenshots reviewed on desktop and
390px mobile.

### Auto-update on deploy: open tabs pick up a new push without a manual hard refresh ✅

Request: when a push ships a new version, users already sitting on the
site shouldn't have to notice and hard-refresh themselves -- the tab
should pick it up on its own, given a reference React hook that polls a
`version.json` and reloads on change.

Adapted rather than copied verbatim, because the premise (a build step
stamps a static `version.json` file) doesn't hold here -- this app has no
JS bundler/build step by design, so nothing exists to stamp that file on
every push, and bolting one on (a CI job that commits a version file back
to the repo) would mean every push triggers two back-to-back Vercel
deploys with a real (if small) window where the code is new but the
version file isn't yet. Used a Vercel zero-config serverless function
instead (`api/version.js`, plain CommonJS, no build step, no `package.json`
needed -- Vercel treats any file under `/api` as a function regardless of
the rest of the project): it reads `VERCEL_GIT_COMMIT_SHA`, which Vercel
itself sets fresh on every single deploy, so the reported version is
always correct by construction with nothing to keep in sync by hand.

- `src/lib/useAutoUpdate.js`: the reference hook ported to this project's
  Preact hooks (`lib/preact.js`) and plain JS (no TypeScript in this
  codebase). Same shape: polls `/api/version` every 2 minutes and on
  window focus, 3s request timeout, skips while a reload is already in
  flight, clears Cache Storage before reloading if any exists. One
  deliberate addition beyond the reference: if a text input or textarea is
  focused at the moment a new version is detected, the reload is deferred
  (retried on the next poll or focus event) instead of firing immediately
  -- the same focus-guard pattern already used by the homepage demo's
  keyboard handler -- so a background deploy can't silently discard an
  unsaved keystroke mid-form. Mounted once in `App()` (`App.js`), the
  single persistent root component, so it runs for every route.
- `api/version.js`: returns `{ version, env }` with `Cache-Control:
  no-store` so no CDN layer serves a stale answer.

**Verified**: dedicated 5-check Playwright pass against a mocked endpoint
-- no reload on first sighting of a version, a real version change causes
an actual `window.location.reload()` (not just a state flag), the reload
is deferred while an input is focused and fires on the next check once
it's blurred. Confirmed separately that a genuinely missing endpoint (this
sandbox's plain static file server has no serverless functions, so
`/api/version` 404s here) degrades silently with no thrown/uncaught error
-- the only console noise is Chromium's own "failed to load resource"
network log for the 404 itself, not application code, and it won't occur
in production once this is deployed to Vercel. Added a matching
`/api/version` mock to every existing Playwright regression script (same
pattern already used for mocking Supabase) since the hook now mounts
globally on every page; re-ran all of them clean: stability 15/15,
direct-URL 9/9, i18n, landing 14/14, demo-intro 10/10, dimension-picker
6/6.

### Bugfix -- Insights mislabeled "Purchase intention" data as "premium/quality" ✅

User report: "Experiments doesn't work, what about Results/Insights/Reports?"
after the dimension-picker round. Clicking through all four nav sections
with mocked data showed every page loading and rendering real content with
zero console errors -- so not a crash, a routing break, or anything the
earlier stability work would have caught. Went further: built a Playwright
scenario using the REAL `participant_sessions`/`responses` DB column shapes
(not the app's in-memory camelCase shape) for an experiment that actually
uses two of the new dimension roles (`trust`, `purchase_intention`) with
real participant answers, and found a genuine content-correctness bug in
`lib/insights.js`'s generated narrative.

Root cause: a pre-existing line (`const premiumQ = findQuestionByRole(...,
"premium") ?? experiment.questions.find(q => q.type === "rating" &&
q.appliesTo === "variants")`) was written back when a "premium" rating
question was the only kind of rating+variants question the app could
produce, so falling back to *any* such question was a safe way to still
surface a secondary signal for experiments that never set a role. The new
"Purchase intention" dimension (added this session) is also `type:
"rating"`+`appliesTo:"variants"` -- so for any experiment using it without
also using the Premium dimension, this fallback silently grabbed the
purchase-intention question and labelled its data "воспринимаемого
качества/премиальности" (perceived quality/premium) in the generated
insight text. Wrong semantic claim about real response data, not just a
missing nice-to-have.

Fixed by excluding any question whose role is a different *known* dimension
role (new `DIMENSION_ROLES` export from `questionTypes.js`, the role side
of the same table the dimension chips are built from) from the fallback,
while still allowing it for a question with no role or a free-text/legacy
one -- preserving the original fallback's intent for experiments built
before the dimension system existed. Verified both directions: the
trust+purchase_intention experiment no longer shows the mislabeled
sentence (falls through to the honest "no secondary pattern found"
message instead), and a second scenario with a legacy no-role rating
question confirms the fallback still fires for it exactly as before.
Also confirmed the `rating`+`appliesTo:"variants"` response value shape
end-to-end while building this test (one row, `value` is a `{variantId:
rating}` object, per `ParticipantRunner.js`'s real submit path and
`ratingStatsForQuestion` in `stats.js` -- not one row per variant, which
was my own test mock's first mistake before reading the real code).

Re-ran the full regression suite after the fix: stability 15/15,
direct-URL 9/9, i18n, landing 14/14, dimension-picker 6/6 -- all clean.

### Bugfix -- nav label mismatch, dead logo, and "Sign in" re-prompting an already-signed-in user ✅

Three small reports in one message.

**Nav/page name mismatch ("Эксперименты деген не түсінбедім" -- "I don't
understand what 'Эксперименты' is").** The sidebar link to the research
list was labelled "Исследования" (RU) / "Зерттеулер" (KZ) / "Research"
(EN), but every other place in the product -- the page's own heading once
you're there, "New experiment" button, builder subtitle, chart captions,
25+ strings total -- calls the same thing "Эксперименты"/"Эксперименттер"/
"Experiments". The nav label was the one outlier, in all three languages
symmetrically (confirmed by grepping each locale file, not guessing from
one). Renamed `shell.nav.experiments` to match the dominant term in all
three locales.

**Dashboard logo didn't go anywhere.** The DecisionOS logo + name block in
the sidebar was a plain `<div>` with no `onClick` at all -- clicking it,
the single most reflexive "take me home" gesture in any app, did nothing.
Turned it into a real `<button>` wired to the same `onNavigate` handler
the rest of the sidebar already uses (so it also closes the mobile drawer),
going to `/app/overview` -- the signed-in user's home, not the public
marketing page, since jumping a logged-in user out to the landing page
mid-task would be the more surprising behavior of the two.

**Already-authenticated user hitting "Войти" had to log in again.**
`Login.js` rendered the sign-in form unconditionally, with no check for an
existing session -- so a signed-in user who ended up back on `/login`
(e.g. clicking "Войти" on the public landing page without it noticing
they're already signed in) just saw the form again instead of going
straight into the app. Added a `useSession()` check at the top that
redirects to `/app/overview` once loading is resolved and a session
exists, following the exact same "call navigate() then return null"
pattern `ProtectedApp` already uses elsewhere in `App.js`, rather than
introducing a different pattern for one page. Deliberately scoped to
`Login.js` only, not `Register.js`: a successful sign-up already does its
own `navigate("/onboarding")` immediately after the session is set, and a
second, more general redirect-if-authenticated guard sitting above it
could race that -- overwrite the just-set `/onboarding` hash with
`/app/overview` on the brief re-render before the hash change is
processed, skipping org creation for a brand-new user. Not worth the risk
for a path the report didn't actually describe.

**Verified**: 7-check Playwright pass -- logo is a real clickable button
and navigates to the dashboard home from a deep page (Settings), an
already-signed-in session hitting `/login` lands on the dashboard without
ever showing the form, and a genuinely signed-out session still sees the
real form (no regression on the common case). Zero console errors across
all three. Re-ran the full regression suite: stability 15/15, direct-URL
9/9, i18n, landing 14/14, dimension-picker 6/6 -- all clean.

### Homepage demo intro: "powerful/release," not "placeholder demo" ✅

Feedback on the intro gate added earlier this round: it read as flat and
sparse -- a small static icon in a box, no sense of invitation. Asked for
it to feel like a finished, confident release, not a prototype screen.

- The play icon is now a real clickable control (not just decoration --
  clicking it also starts the demo, same as the button below), bigger
  (80px, was 56px), with a soft amber glow that breathes in and out
  (new `.sk-breathe` keyframe animation in `styles.css`) -- a standby/
  power-light effect consistent with the "physical instrument" language
  the rest of the skeuomorphic system already uses, not a generic UI
  pulse. Exactly one element on the page breathes, deliberately, so nothing
  competes with it for attention.
- Added a row of 4 small colored dots beneath the body copy, one per demo
  variant (orange/silver/green/indigo), teasing what's behind the gate
  without revealing it -- ties visually to the "4 варианта" already in the
  copy instead of leaving it as a bare number. (Had to add a dedicated
  `dot` color per variant in `DEMO_VARIANTS` -- variant B's existing
  `accent` value is near-black and would have been invisible on this dark
  UI; the dot needs to read clearly, the accent stripe doesn't.)
- The "Начать демо" button gets a new `.sk-btn-hero` modifier -- a
  stronger indigo bloom than the standard button glow, reserved for a
  single hero CTA rather than applied to buttons generally.

**Verified**: re-ran the 10-check demo-intro suite and the 14-check
landing suite (both still clean after the markup changes), added a
dedicated check that clicking the glowing icon itself -- not just the text
button -- starts the demo, and reviewed a screenshot at the same crop used
throughout this round. Full regression suite (stability 15/15, direct-URL
9/9, i18n, logo/login 7/7) re-run clean.

### Social layer, slice 1: posts + feed ("Создать" -- a place to post) ✅

Per the user's own earlier resolution (keep research primary, add a
social/community layer as a new, additive section, not a replacement),
the first real slice of it: a platform-wide feed where any signed-in user
can write and read posts.

- **`supabase/migrations/0009_posts.sql`**: new `posts` table --
  deliberately references `profiles` directly with no `organization_id`,
  since this is a cross-org social layer, not scoped to one org like
  experiments. `author_id` defaults to `auth.uid()` server-side and is
  never sent by the client, specifically repeating the pattern
  `0004_server_derived_ownership.sql` fixed for organizations/experiments
  rather than reintroducing the same staleness bug for a new table. RLS:
  any authenticated user can read every post (true platform feed); insert/
  update/delete only your own. Checked against the 0004 migration's
  documented RETURNING-filtered-by-SELECT-policy trap -- doesn't apply
  here, since the SELECT policy is unconditional (`using (true)`), so a
  freshly inserted row is always visible back to its own author regardless
  of timing.
- **`lib/postsStore.js`**: `createPost(body)` (sends only `body`, nothing
  else) and a reactive `usePosts()` cache, same module-level
  state+listeners+catch-up-notify shape as every other store this session.
  Caught a real bug in my own first draft before it ever ran: initializing
  `loading: true` while the mount effect's trigger condition was `!loading
  && !loaded` meant the very first load would never fire -- the exact
  "lost notification, stuck on loading forever" bug class this whole
  session has been about. Fixed before testing, not found by testing.
- **`pages/Feed.js`**: inline composer (avatar, textarea, char counter,
  disabled-until-non-empty submit) at the top, chronological post list
  below -- one page doing both jobs, matching this app's own existing
  pattern of "the page is named after the collection, creation is a
  button inside it" (Эксперименты + "Новый эксперимент") rather than
  splitting into a separate bare compose screen.
- **Nav**: new "Сообщество" group in the sidebar, below the research nav
  and above "Рабочее пространство" -- visually and structurally separate,
  not mixed into or reordering the existing research items, per the
  additive-not-replacing resolution. One item for this slice: "Лента".
- **i18n**: new `shell.community.*` and `feed.*` namespaces in all three
  locales (619/619/619 parity).

**Verified**: 14-check Playwright pass against a stateful mocked backend --
nav exists and routes correctly, empty state, composer enable/disable,
publish adds the post to the visible feed immediately, composer clears,
author name renders, and (the one that mattered most) the actual INSERT
payload captured by the mock contains only `{body}` -- no `author_id` --
confirming the client genuinely never sends it. Separate error+retry pass.
Added `/app/feed` to the direct-URL cold-load regression script (10/10).
Re-ran the full suite: stability 15/15, direct-URL 10/10, i18n, landing
14/14, logo/login 7/7 -- all clean.

**Not yet live**: this session has no `SUPABASE_ACCESS_TOKEN` /
`SUPABASE_PROJECT_REF` in its environment, so `npx supabase db push`
cannot be run from here -- the migration is written and committed but not
yet applied to the real database. The app code is correct and fully
tested against a faithful mock of the schema the migration creates, but
the Feed page will fail against the live backend (the `posts` table
doesn't exist yet) until someone with Supabase credentials runs the push
-- flagged explicitly rather than silently assumed to be live.

### Feed composer: compact, auto-growing, no raw browser chrome ✅

Real-screenshot feedback on the new composer (`Feed.js`): it looked out of
place -- a static 88px-tall box with the browser's own default resize
handle poking out of the corner, the one clearly unstyled element on an
otherwise fully bespoke skeuomorphic page.

Stopped using the shared `TextArea` component here specifically (it
always adds `resize-y`, with no clean override) and wrote the textarea
directly with `resize-none` plus a small auto-grow handler: starts at a
single compact line (44px, matching the avatar's height so the row reads
as one aligned unit instead of an oversized empty box next to a small
circle), and grows with `scrollHeight` as the author types, up to a 240px
cap, instead of ever exposing a manual resize affordance. Same `sk-input`
inset styling as every other field in the app -- the box itself wasn't
mis-themed, just mis-sized with a raw HTML artifact sitting on top of it.

**Verified**: measured the actual rendered height before (44px) and after
typing a two-line post (66px) to confirm the grow behavior fires, not just
that it compiles. Re-ran the 14-check Feed suite (still clean) and the
full regression suite: stability 15/15, direct-URL 10/10, i18n, landing
14/14.

### Feed: profanity guard on posting, hashtags (render + click-to-filter) ✅

Two requested additions to the composer: block posts containing strong
profanity, and support hashtags.

- **`lib/profanityFilter.js`**: a stem-based RU/KK/EN blocklist (common
  strong profanity roots, not an exhaustive dictionary) matched with a
  Unicode-aware word-boundary regex (`\p{L}`/`\p{N}` lookbehind, so it
  only triggers at the start of a word, not mid-word) and trailing
  `[\p{L}]*` so inflected/declined forms (very common in Russian/Kazakh --
  a single root can appear in a dozen grammatical forms) are still caught
  without hand-listing every one. `ё`/`е` normalized before matching, a
  common spelling variance, not evasion. Explicitly a client-side UX
  guard, documented in the file itself as not a hard security boundary --
  a request sent straight to the API bypasses it, same caveat as any
  client-only validation.
  Verified with a deliberate false-positive pass before wiring it into any
  UI: common benign words that merely *contain* a flagged substring
  ("Хусейн", "ассистент"-style "ass...", "Шипучка") all correctly pass,
  profane RU/KK/EN phrases including inflected forms ("ёбнутый",
  "сіктір") all correctly block -- caught and fixed one missed
  derivational form (the "-ну-" infix, e.g. "ёбнутый") during this pass,
  before it ever reached a browser test.
  `Composer.submit()` checks the trimmed body before calling `createPost`;
  on a hit it shows a toast and returns without submitting or clearing the
  draft, so the author can edit rather than losing what they wrote.
- **Hashtags**: `#word` tokens (Unicode-aware, so Cyrillic tags work) are
  parsed out of each post's body at render time and rendered as styled,
  clickable spans (`renderPostBody` in `Feed.js`) rather than plain text.
  Clicking one sets an active-filter chip above the list and narrows
  `visiblePosts` to posts containing that tag (plain client-side
  substring filtering over the already-fetched posts -- no new schema, no
  migration, so this works immediately with no backend dependency). A
  dedicated empty state (not the generic "no posts yet" one) covers zero
  matches for the active tag, with a clear-filter control to return to
  the full feed.

**Verified**: 12-check Playwright pass -- a profane post is blocked (toast
shown, zero insert requests sent, draft text preserved for editing, not
wiped), a clean post with two hashtags submits normally, both hashtags
render as distinct clickable elements, clicking one shows the filter chip
and narrows the visible list to only the matching post while hiding an
unrelated one, and clearing the filter restores the full feed. Re-ran the
original 14-check Feed suite (unaffected, still clean) and the full
regression suite: stability 15/15, direct-URL 10/10, i18n, landing 14/14.
New `feed.profanityBlocked`/`clearFilter`/`noHashtagTitle`/`noHashtagBody`
keys in all three locales (623/623/623 parity).

### Feed: photo attachments, softer/stricter moderation policy, and a real identity-resolution bug ✅

Three requests in one message: let people attach a photo to a post (with
real checking, not just a UI affordance); make the word filter stricter;
and change single-slip handling from a hard block to censoring just that
word, so an otherwise-fine post (e.g. about marketing) isn't killed over
one word -- multiple instances still hard-block, since that pattern reads
as abuse rather than a slip.

- **`supabase/migrations/0010_post_images.sql`**: `posts.image_url`
  column + a `post-images` Storage bucket, public read, upload/delete
  restricted to the uploader's own folder (`<author_id>/<file>`, checked
  against `auth.uid()` -- same shape as `0005_storage.sql`'s org-folder
  check, keyed to the user directly since posts aren't org-scoped).
- **`lib/storage.js`**: `uploadPostImage()`, reusing the existing
  `validateAssetFile()` (JPEG/PNG/WEBP/GIF only, 5MB max) rather than
  duplicating it. That validation is real and enforced (checked both at
  file-pick time for instant feedback and again inside the upload call) --
  but it's file type/size only. There is no visual content-moderation
  capability available in this environment (no image-moderation API
  credentials), so this does not and cannot inspect what's actually in the
  photo; said so plainly rather than implying a check that isn't real.
- **`lib/profanityFilter.js`** reworked from boolean `containsProfanity`
  to `moderatePost(text)`: zero matches -> post as-is, exactly one ->
  `censorProfanity()` masks that word (first letter kept, rest asterisks)
  and the post still goes through, two or more -> hard block, unchanged
  from before. Word list widened (added a compound form, "долбоеб", that
  the previous prefix-anchored stems couldn't reach since the profane
  root isn't at the start of the word -- plus a few more common RU/EN
  roots) and re-verified against the same false-positive set as before
  (benign RU/KZ/EN text, words merely containing a flagged substring)
  before wiring the new policy into the UI.
- **Found while building the image feature, not asked for but real**: the
  `Avatar` component in `Feed.js` only ever rendered initials -- it never
  had an image-rendering branch at all, unlike the one in `shell.js`
  (which already does this correctly for the sidebar). Fixed by matching
  that existing pattern.
- **The actual root cause of "doesn't my avatar show to everyone"**: a lot
  more significant than the component bug above. `profiles`' own RLS
  (`"profiles: read own"`, `id = auth.uid()`, from `0002_rls.sql`) means a
  user can only read their OWN profile row directly -- and `fetchPosts()`
  was embedding `author:profiles(...)` on the posts query, which
  PostgREST filters through the embedded table's own SELECT policy (the
  exact mechanism `0004_server_derived_ownership.sql` already documented
  for `RETURNING`, which turns out to apply the same way to a plain
  embedded SELECT). So on the real backend, every post NOT authored by
  the viewer was resolving its author to nothing, regardless of the
  component bug -- not a privacy feature, a side effect of a table-wide
  policy that predates this feature.
  Fixed with `supabase/migrations/0011_profiles_public.sql`: a narrow
  view exposing only the already-effectively-public identity columns
  (name, username, avatar -- never email/bio/notification settings) for
  every user, with no RLS of its own since views can't carry column-level
  security -- the SELECT list itself is the boundary. Runs as its owner
  (no `security_invoker`), the same mechanism `get_public_profile()`
  (0008) already relies on to read past the base table's restrictive
  policy. `postsStore.js`'s `fetchPosts()` now does two queries -- plain
  `posts`, then author identities from `profiles_public` for the distinct
  `author_id`s -- merged client-side, instead of one broken embed.
  `createPost()` simplified to not bother resolving/returning the author
  at all, since nothing read that return value; `invalidatePosts()`
  already triggers the real refresh.

**Verified**: 19-check Playwright pass covering the censor-vs-block split
(single word censored and published with a distinct gentler toast;
multiple words hard-blocked with zero insert; draft preserved either way
so nothing is silently lost), photo attachment (invalid file type
rejected before any upload attempt, valid image previewed locally then
actually uploaded on submit, saved with a real `image_url`), plus the
original 14-check base suite and 12-check moderation/hashtag suite
re-run clean. Then a dedicated 6-check test specifically reproducing the
real bug: mocked `/rest/v1/profiles` to only ever return the viewer's own
row (mirroring the real RLS) while `/rest/v1/profiles_public` correctly
serves any requested user -- confirmed BOTH a post's own author and a
different post's different author resolve to their own distinct real
name and distinct real avatar photo, scoped to each post's own card
(not a page-wide substring check, which would have falsely passed off
the sidebar's unrelated copy of the viewer's own name/avatar). Full
regression suite re-run clean: stability 15/15, direct-URL 10/10, i18n,
landing 14/14.

**Not yet live**: migrations 0010 and 0011, like 0009 before them, are
written and committed but not applied to the real database from this
session (same missing Supabase credentials as before) -- until they're
run, photo upload and cross-author identity resolution won't work on the
live site even though the code and tests are correct against the schema
they create.

### Collapsible sidebar, phone-only drawer, and a real pre-existing CSS bug ✅

Three asks: the mobile hamburger menu should only appear on an actual
phone; desktop/tablet should get an explicit collapse toggle instead of
relying on viewport width alone; and the Feed composer should sit below
the post list, not above it.

- **Breakpoint**: the mobile drawer pattern (hamburger + overlay) now
  switches in only below `md` (768px) instead of the old `lg` (1024px) --
  everything `md` and up (tablets included, not just wide desktops) gets
  the persistent sidebar. Every `lg:` class governing this layout in
  `shell.js` moved to `md:`.
- **Collapse**: new `collapsed` state in `Shell`, persisted to
  `localStorage` (`decisionos_sidebar_collapsed`) so it survives a
  reload. Collapsed, the desktop sidebar shrinks to a 72px icon rail --
  logo, nav icons (each with a `title` tooltip since the label is gone),
  section dividers become plain rules, the primary CTA and user menu
  collapse to icon-only. A toggle button (chevron, flips direction) sits
  right under the logo, in the same place whichever state it's in.
  Mobile's overlay drawer always renders expanded regardless of this
  state -- collapsing a temporary overlay you're about to close doesn't
  help anyone. Factored the three near-identical nav-item blocks (main/
  community/workspace) into one `NavItem` component while touching all
  three anyway for the new collapsed-state logic, rather than tripling
  the same conditional a third time.
- **Feed composer**: moved from the top of the page to below the post
  list (and its own `Card` margin flipped from `mb-6` to `mt-6` to match).

**A real, pre-existing bug found while verifying the hamburger actually
hides on desktop, not assumed from reading the JSX**: it didn't -- at any
width, before or after this change. `index.html` loads
`vendor/tailwind.css` before `styles.css`; `.sk-btn` (styles.css) sets
`display: inline-flex` with no `!important`, so at equal CSS specificity
it always wins the cascade over a later-irrelevant-order Tailwind
responsive utility like `md:hidden`/`lg:hidden` on the same element --
the hamburger button has combined `sk-btn` with a responsive `hidden`
class since the skeuomorphic pass gave it that class, so this had been
silently broken since then, independent of which breakpoint number was
used. Swept every other `sk-*` class in the app combined with a
responsive display utility (`sk-sidebar`, `sk-display`, `sk-badge`) --
none of the other three actually set `display` themselves, so only this
one button was affected, not a wider pattern. Fixed narrowly with
Tailwind's `!` important modifier (`md:!hidden`) on just that element,
rather than reordering the global stylesheet link order and risking
every other `sk-*`/Tailwind-utility interaction in the app.

**Verified**: a 14-check Playwright pass across two viewports -- phone
width (375px) shows the hamburger, hides the persistent sidebar, and
opening the drawer shows full labels; tablet width (900px, deliberately
chosen as above the old 768px `md` boundary's low end but below the old
1024px `lg` one, to directly probe the actual bug report) hides the
hamburger, shows the persistent sidebar expanded by default, and clicking
collapse actually shrinks it (measured 256px to 72px, not just checking a
class is present), hides labels, persists across a reload, and reverses
cleanly. This test caught the cascade bug directly -- the hamburger
visibility check failed first, which is what led to tracing it to the
stylesheet order rather than assuming the responsive class alone was
enough. A separate check confirms the Feed composer now renders below an
existing post, not above it. Full regression suite re-run clean:
stability 15/15, direct-URL 10/10, i18n, landing 14/14, logo/login 7/7.

### Bugfix -- native `<select>` dropdown options unreadable (light text on a near-white popup) ✅

Screenshot report: the country dropdown's open option list looked washed
out/odd, options barely readable. Root cause: a `<select>` styled via
`sk-input` gets light text color (`text-slate-100`), which `<option>`
elements inherit -- but the OPEN option list is rendered by the browser/
OS chrome, which ignores most CSS on the select (background, shadow,
gradient) while still applying the inherited text color, so the popup
fell back to the browser's own near-white default background under
light-on-light-ish text. `background-color`/`color` are the two
properties that do reliably apply to `<option>` across Chromium/Firefox,
unlike everything else on `.sk-input`.

Fixed with explicit `select.sk-input option` / `:checked` rules in
`styles.css` -- since every `<select>` in the app goes through the shared
`Select` component (which always applies `sk-input`), this fixes every
dropdown app-wide (timezone, research type, question type, ...), not
just the one in the report.

**Verified**: checked the actual computed `background-color`/`color` on a
rendered `<option>` (not just that the CSS rule compiles) -- confirmed
dark background + light readable text -- then opened the real dropdown
and screenshotted the native popup itself to visually confirm against the
original report. Stability and i18n suites re-run clean.

### Centered content on wide screens, delete your own post, admin can delete any post ✅

- **Content centering**: `<main class="... max-w-[1400px]">` had the
  width cap but no `mx-auto`, so on a wide monitor the 1400px box just
  sat flush against its parent's left edge (right after the sidebar),
  leaving all the extra space stacked on the right only -- exactly the
  "everything's glued to the menu" look in the report. Added `mx-auto`.
  The sidebar itself is unaffected (still a fixed column on the left,
  per the other request to leave it where it is) -- only the content
  box centers within the remaining width to its right.
- **`supabase/migrations/0012_post_deletion.sql`**: adds
  `profiles.is_admin` (a genuine platform-wide flag, unrelated to
  `member_role`, which is scoped to one organization and has no bearing
  on a cross-org feature like the feed -- default `false` for everyone,
  no UI to grant it, set directly via SQL by whoever controls the
  database) and a `posts_delete_admin` RLS policy. Deleting your own post
  needed no new policy -- `posts_delete_own` already covered it in 0009.
  `profiles`' existing "read own" policy already covers the new column
  for its own row, so no new SELECT policy either; deliberately not
  added to `profiles_public` (0011), since the UI only ever needs the
  viewer's own admin status, never anyone else's.
- `lib/postsStore.js`: `deletePost(id)`. `lib/profile.js`: added
  `is_admin` to the explicit profile column list (it's an explicit list,
  not `select *`, so a new column silently would not have been fetched).
- `Feed.js`: a delete (trash) icon appears on a post when
  `post.authorId === currentUserId || profile.is_admin`, opening the same
  confirm-dialog pattern `ExperimentsList.js` already uses (Cancel/Delete,
  danger-styled) rather than a different one-off pattern.

**Verified**: measured the actual rendered gap on each side of the
content box at a 1920px viewport (132px/132px, matching the user's own
screenshot's width) rather than eyeballing a screenshot. A 17-check
Playwright pass run twice (non-admin and admin profile) confirms: a
non-admin sees a delete button only on their own post, never on someone
else's; an admin sees it on every post; the confirm dialog blocks an
accidental click (Cancel truly sends no request); confirming actually
removes the post from the list and fires exactly one DELETE request; and
critically, the mock mirrors real RLS (a non-owner, non-admin DELETE
request is rejected server-side) so the test isn't just checking that a
button is hidden, but that the underlying permission actually holds.
Full regression suite re-run clean.

**Not yet live**: migration 0012 has the same credential gap as 0009-0011
-- written and committed, not yet applied. Once it is, set your own
account's flag with (replace the email):
```sql
update profiles set is_admin = true where email = 'you@example.com';
```

### Sidebar mode picker: Expanded / Collapsed / Expand on hover ✅

The prior round added a single collapse/expand toggle button. The user
sent two reference screenshots of Supabase's own dashboard sidebar (the
narrow icon rail, and a "Sidebar control" popover with three radio-style
options -- Expanded / Collapsed / Expand on hover -- each marked with a
small dot, not a checkmark) and asked for that exact pattern, including
the hover-to-peek behavior. A follow-up message then asked for the
trigger itself to sit at the *bottom* of the sidebar instead of near the
top.

- **`shell.js`**: replaced the old boolean `collapsed` state
  (`decisionos_sidebar_collapsed` in localStorage) with a 3-way
  `sidebarMode` (`"expanded" | "collapsed" | "hover"`, persisted under a
  new `decisionos_sidebar_mode` key, default `"expanded"`) plus a
  transient `hoverPeek` boolean that is never persisted -- it only
  tracks whether the pointer is currently over the sidebar while in
  hover mode.
- New `SidebarModePicker` component: a small chevron trigger button that
  opens a `Dropdown` listing the three modes, each with a dot indicator
  (filled indigo = active, transparent = inactive) -- matching the
  reference screenshots' visual language instead of a checkmark list.
- **Layout vs. visual width, kept deliberately separate**: the content
  area's reserved left padding (`md:pl-[72px]` vs `md:pl-64`) is driven
  by `sidebarMode !== "expanded"` alone -- hover mode *always* reserves
  the narrow width, even while peeking. The sidebar's own rendered width
  is driven by a separate `visuallyExpanded` flag
  (`sidebarMode === "expanded" || (hover mode && hoverPeek)`). This means
  the momentary hover-driven growth to 256px overlays the page (elevated
  to `z-40` with a drop shadow while peeking, `z-20` at rest) instead of
  shoving the dashboard content sideways on every mouse-in/mouse-out --
  the same non-reflowing behavior professional sidebars (Supabase's own
  included) use.
- **Trigger placement**: moved from a row under the logo/org header into
  the sidebar's bottom footer, directly above `UserMenu` -- the
  `Dropdown` component's `direction="down"` variant (added for the
  original top placement) was removed again since every remaining
  trigger now opens upward from the bottom, keeping the component at its
  original, simpler shape rather than carrying an unused option.
- i18n: removed the now-dead `shell.collapseSidebar` / `shell.expandSidebar`
  keys, added a nested `shell.sidebar.{label,expanded,collapsed,hover}`
  in all three locales. Key-parity check: ru=en=kk=634.
- No new migration -- this is pure frontend/localStorage state, nothing
  server-side changed.

**Verified**: two Playwright passes (15 checks, then re-run after the
footer move). Confirmed: default mode is Expanded (~256px); the dropdown
lists all three options with the correct dot on the active one; choosing
Collapsed actually shrinks the rail to ~72px *and* the main content's
left edge follows it; the choice survives a full page reload
(localStorage); choosing "Expand on hover" starts collapsed at rest;
hovering the rail grows it to ~256px while the main content's measured
left edge does not move by a single pixel (the overlay-not-reflow
requirement, checked via bounding-box comparison, not just visually);
moving the pointer away shrinks it back; hover mode itself also survives
a reload, correctly coming back collapsed-at-rest rather than
pre-expanded. A second pass re-confirmed every check after relocating
the trigger to the bottom footer. The older `test_sidebar_collapse.mjs`
regression test (originally written to catch the hamburger-never-hidden
CSS cascade bug) had its two assertions that clicked the old
`title="Свернуть меню"` button updated to drive the new picker instead
-- the button disappearing was an intended consequence of replacing the
toggle with the picker, not a regression, so the test was updated rather
than the app. Full regression suite (stability, direct-url, i18n,
landing/demo-intro, auto-update, feed + moderation + avatars + delete,
logo/login, content-centering, composer position) re-run clean after
both rounds of edits.

### Header/sidebar polish + a real mobile avatar bug found in a full-site sweep ✅

A follow-up round of feedback on the sidebar-mode-picker work, plus an
explicit request to check the entire site for bugs:

- **Header search bar, truly centered**: a naive `flex-1` column on each
  side of the search box only centers it *within the leftover space*
  between the two side columns -- since the left column (hamburger,
  empty on desktop) and right column (language switch + badge + bell)
  are very different widths, that left the search box visibly off-center
  (measured 130px off). Replaced the header with a CSS grid
  (`grid-cols-[1fr_auto_1fr]`, side content placed via
  `justify-self-start`/`justify-self-end`): the middle `auto` column is
  now centered in the *full* header width regardless of how asymmetric
  the side columns are. Verified centered (0px measured offset) and
  checked for overlap with the side columns at every breakpoint from
  640px (where the search box first appears) to 1280px -- none.
- **Sidebar-mode-picker button no longer jumps**: its wrapper switched
  between `justify-end` (expanded) and `justify-center` (collapsed),
  moving the button nearly 200px horizontally every time the mode
  changed. Pinned it to a constant `justify-start` so it stays at the
  same x-position in every mode, per the explicit request.
- **Expand/collapse animation spillover, found and fixed**: nav labels,
  the header title, the New Research button label, and the two section
  labels are conditionally *mounted* (`${!collapsed && ...}`), which
  commits to the DOM instantly, while the sidebar's width is a 150ms CSS
  transition -- so for the first frames of an expand, full-length text
  momentarily renders inside a still-narrow rail. Confirmed empirically
  with a Playwright probe before fixing (a descendant's measured right
  edge extended 12px past the rail's edge in the first sampled frame of
  the transition) and added `overflow-hidden`/`whitespace-nowrap` to
  just the specific label-containing buttons/divs -- deliberately *not*
  to the `<div class="relative">` wrappers that host the UserMenu/picker
  dropdowns, since clipping those would cut the popovers off instead.
  Re-verification needed a second methodology: `getBoundingClientRect()`
  on a clipped child still reports its pre-clip layout position (clipping
  is a paint-time effect, not a layout one), so the same "12px overflow"
  number persisted after the fix and looked like a non-fix at first. Used
  `document.elementFromPoint()` at the sidebar's animating edge instead,
  against an artificially slowed (2s) transition, to confirm what's
  actually *painted* there is the main content, never sidebar content --
  genuinely fixed, not just differently measured.
- **Site-wide sweep**: an automated pass (console/page-error capture +
  horizontal-overflow detection + full-page screenshots) across all 14
  dashboard routes, Landing, and Login, at desktop (1440px) and mobile
  (390px) -- 32 combinations, zero automated issues. A manual visual
  review of every screenshot on top of that caught two real bugs the
  automated pass couldn't: the mobile top-bar's avatar button
  (`<${Avatar} size=${30} />`, next to the bell icon) never passed a
  `name` or `url` prop, so `initialsFor(undefined)` rendered a literal
  "?" for every signed-in user on every single mobile page, every time;
  and the landing page's mobile header, in the user's own locale, wrapped
  the primary CTA's text ("Создать исследование") across two lines
  inside the button because there wasn't enough room next to the logo at
  390px (an English-locale screenshot had masked this during the sweep,
  since "Create research" happens to fit where the longer Russian phrase
  doesn't -- caught by re-testing explicitly with `decisionos_locale`
  forced to `ru`, the language this product's actual users are in).
  Fixed the avatar by wiring `Shell` to the same `useSession`/
  `useMyProfile` hooks `UserMenu` already uses. Fixed the wrap with
  `whitespace-nowrap` on the shared `Button` component (a button's own
  label shouldn't wrap, full stop) plus `flex-wrap` on the landing
  header so the two buttons drop to their own row below the logo if a
  narrow screen can't fit everything on one line, instead of either
  overflowing or squeezing text inside a button.

**Verified**: every fix above has its own before/after Playwright
measurement (not a screenshot eyeballed once) -- the search box's exact
pixel center, the picker button's x-position across mode switches, the
paint-point probe for the animation fix, the mobile avatar's actual
rendered text, and the landing CTA's rendered height pre/post fix. Full
regression suite plus the full-site sweep re-run clean after every
change in this round.

### Root-caused the duplicated-button/counter glitch: a `lang="en"` vs. actual-Russian mismatch ✅

The user hit a composer where "Опубликовать" and the "0/2000" counter
each rendered twice, overlapping -- and on the real deployed site, the
mobile header avatar was still showing the old "?" after the previous
fix had already been pushed.

- **The duplication's real cause**: the broken screenshot's Russian text
  didn't match this app's actual strings at all ("Делитесь с
  профессиональными сообществами и наблюдайте за ростом других." vs. the
  real "Делитесь с профессиональным сообществом и смотрите, чем делятся
  другие.") -- the signature of a browser re-translating a page that's
  already in Russian. `index.html` hardcodes `<html lang="en">`, a static
  file that can't know the detected locale ahead of time; `setLocale()`/
  `adoptProfileLocale()` already kept `documentElement.lang` in sync for
  every *later* change, but nothing synced it on the *first* load. Since
  `ru` is the default and most users (this one included) never touch the
  language switcher, that `lang="en"`-declared/Russian-rendered mismatch
  persisted for the entire session on every single visit -- exactly the
  condition that makes a browser offer or silently trigger translation,
  which is well known to corrupt reactive apps: a translation engine
  wraps text nodes in its own elements, and when the framework's own
  reconciliation tries to update those same nodes, the result is the
  visible double-render the user saw. Fixed at the root in `i18n.js`:
  `document.documentElement.lang` is now synced to the detected locale
  immediately on module load, not just on later switches. Also set
  `index.html`'s static fallback to `lang="ru"` (matching the product's
  actual default instead of a placeholder "en") and added
  `translate="no"` on `<html>` as a second layer of defense, so even a
  *manually* triggered translate (independent of the lang-mismatch
  trigger) is declined.
- **The mobile header avatar**: re-verified the previous fix is correctly
  in the code (it is), and traced why "?" could still appear -- not a
  residual bug in the new code (a Playwright probe confirmed
  `displayName` reliably falls back to the session email well before the
  separate profile fetch resolves, never leaving a real empty-string
  window in practice), almost certainly the user's phone catching the
  still-deploying previous build. As a genuine hardening regardless: both
  copies of the `Avatar` component (`shell.js`, and a separate
  near-identical one in `Feed.js` -- they're not shared, each page built
  its own) rendered a bare `"?"` character whenever a name was empty, for
  *any* reason (e.g. an OAuth sign-in that never grants an email scope,
  on top of a never-filled-in profile name) -- a real, if rare, path to
  an empty display name that no fallback email could rescue. Both now
  fall back to a generic person-icon glyph instead of `"?"` in that case,
  consistent with how every major app signals "no identity yet" without
  looking like an error state.

**Verified**: a fresh browser context with `locale: "ru-RU"` (simulating
this product's actual users) now gets `<html lang="ru">` from the very
first paint, confirmed against the previous (broken) static `"en"`; an
`"en-US"` context still correctly gets `lang="en"` (the existing
navigator-language detection isn't regressed); switching the in-app
language picker still live-updates `lang` as before; and a session with
no email at all plus a never-filled-in profile name renders the generic
icon, not `"?"`, in both `Avatar` copies. Could not directly reproduce
Google Translate's own DOM mutation in this sandbox (no network path to
Google's translate service here) to mechanically re-trigger and disprove
the duplication -- the fix targets the documented, known root cause
(the lang/content mismatch), not a simulated repro of the symptom.
Full regression suite plus the full-site sweep re-run clean.

### Mobile header rebalanced: avatar to the edge, language+bell to the center ✅

With the search box hidden below `sm`, the mobile topbar had nothing in
its center grid column -- hamburger on the far left, then everything
else (language switch, bell, avatar) bunched together on the right,
making it look lopsided. Gave the language-switch+bell group explicit
responsive grid placement (`col-start-2` by default, alongside where the
search box would be; `sm:col-start-3` once the search box actually
appears) instead of leaving it fixed in the right-hand column -- below
`sm` it now sits centered in the header, visually separated from the
avatar, which stays pinned (`col-start-3 justify-self-end`) at the right
edge. No component duplication: it's the same single `LanguageSwitch`/
`NotificationsMenu` instances, just reassigned to a different grid
column at different widths via CSS, not two copies.

**Caught and fixed before it ever shipped**: the first edit left a
leftover `</div>` from the markup it replaced, unbalancing the JSX-like
template and crashing the whole page (`document.querySelector("header")`
came back `null` in the very first verification run). Not a subtle bug --
loud and immediate on the first test, fixed by removing the stray tag
before anything was committed.

**Verified**: measured the actual gap between the avatar and the header's
right edge (16px, just the existing padding) and between the avatar and
the language+bell group (75px -- a real, visible separation, not a
guess); the language+bell group's measured horizontal center landed at
195.0px in a 390px-wide header whose center is 195.0px -- centered to
sub-pixel precision. Re-confirmed desktop is untouched (search still
centered, 0px measured offset). Full regression suite plus the full-site
sweep re-run clean.

### Fixed a regression the mobile header rebalance introduced: notifications dropdown clipped off-screen ✅

Immediately caught by the user: moving the bell icon to the header's
center column (the previous fix) broke `NotificationsMenu`'s own
dropdown, which was written assuming its trigger sits near the right
edge (`absolute right-0 top-full mt-2 w-72`). With the bell now near the
middle of a 390px screen, that 288px-wide panel opened mostly off the
*left* edge of the viewport (confirmed: "Уведомления" rendered as
"едомления", its first letter cut off).

Centering the dropdown under its trigger instead doesn't generalize
either -- confirmed by measurement that it would then clip off the
*right* edge on narrow phones (measured overflow of 6-21px at 360-390px)
while still being correct at `sm:` and up. Since the trigger's own
position now legitimately differs by breakpoint (centered below `sm`,
back at the right edge from `sm` up), anchoring the dropdown to the
trigger at all is the wrong approach below `sm`. Switched it to
`fixed right-4 top-[69px]` there -- pinned to the viewport's top-right
corner, independent of wherever the bell itself happens to sit -- and
kept the original `sm:absolute sm:right-0 sm:top-full sm:mt-2` (already
proven correct) from `sm` up, where the bell is back in the right-aligned
cluster. Added `max-w-[calc(100vw-2rem)]` as a backstop for any
viewport narrower than used to not have the pre-existing `absolute`-form
offset.

**Verified**: measured the dropdown's actual left/right edges against
the viewport at seven widths (360 through 1440) -- all seven now land
fully on-screen with zero clipping and the full "Уведомления" title
intact, including the exact 360-390px range that was broken immediately
before this fix and the 360-390px range the *first* attempted fix (center
-under-trigger) was still broken at. Full regression suite plus the
full-site sweep re-run clean.

### Feed: clicking a post author's avatar or name opens their profile ✅

`PostCard` rendered the author's avatar and name as plain, non-interactive
markup -- no way to see anything about who posted. The app already has a
working public-profile page at `/u/:username` (built earlier this
session, backed by the `get_public_profile()` RPC), so this didn't need
a new page -- just wiring the existing post data to it. `postsStore.js`
already resolves `authorUsername` per post (via the `profiles_public`
view), so both the avatar and the name are now buttons that `navigate()`
to `/u/${post.authorUsername}` on click. An author with no username set
(the one real edge case -- `username` is nullable) renders as a disabled,
non-interactive button rather than a broken link to `/u/null` or
`/u/undefined`.

**Verified**: a post from an author who has a username -- clicking either
the avatar or the name actually navigates to their `/u/...` page, and
that page genuinely renders their real bio/role from the mocked
`get_public_profile` RPC response (not just that the URL changed). A
second post from an author with `username: null` renders both as
disabled buttons -- confirmed via `isDisabled()`, not just visual
styling. Full regression suite re-run clean.

### Landing demo simplified to a single question ✅

The homepage demo asked two sequential questions after picking a variant
(Q1 "Which would you choose?", then a second "trust" follow-up on the
*same* four tiles) before reaching completion. With the Feed now giving
visitors a real way to interact with the product, the user asked to
simplify the demo -- it only needs to give a quick taste, not run a
two-item mini-survey.

- `HomepageDemo` (`Landing.js`): collapsed `intro | q1 | q2 | done` down
  to `intro | question | done`; one pick now goes straight to the
  completion screen. Replaced the per-phase `{q1: null, q2: null}` picks
  object with a single `pick` value, and the `q1Title`/`q2Title` ternary
  with one `questionTitle` key (also renamed in all three locales -- the
  `q1` prefix only made sense when a `q2` existed).
- Every piece of copy that said "two [short] questions" -- the intro
  blurb and the completion message, in all three locales -- now
  correctly says "one short question" instead of being left stale and
  wrong.
- Removed `landing.demo.q2Title` from all three locale files rather than
  leaving it as dead, unused copy. Key-parity check: ru=en=kk=633 (was
  634 -- net one key removed per locale after the q1→question rename and
  the q2 removal).

**Verified**: 11 Playwright checks -- the intro's and completion
screen's "one question" copy actually changed (not just that the old
"two questions" text is gone, which could pass vacuously); picking a
single variant goes straight to the completion screen in one measured
step, the exact removed Q2 question text never appears anywhere on the
page, and restarting returns to the (now single) question step rather
than back to the intro. The old pre-simplification test script asserted
a Q2 step that no longer exists by design, timing out waiting for it --
retired it in favor of the new test, since every other check it made is
already covered there. Full regression suite plus the full-site sweep
re-run clean.

### Senior-level loading UX: spinner, skeletons, a branded app-boot screen ✅

Every loading state in the app, with no exception, was the exact same
line: `<p class="text-sm text-slate-500">Загрузка…</p>` -- 21 occurrences
across 13 files, zero visual treatment, found by grepping `common.loading`
app-wide. The user asked for this raised to a senior level.

- **`styles.css`**: `.sk-spinner` (a rotating indigo-on-translucent ring,
  pure CSS, no SVG), `.sk-skeleton` (a content-shaped placeholder block
  with a light sweep animating across it via a `::after` overlay --
  `translateX` keyframe, not a repainted gradient, so it stays cheap), and
  `.sk-pulse-indigo` (a distinct glow for the app's own boot screen,
  deliberately not reusing `.sk-breathe` -- that one is reserved for a
  single amber call-to-action, per its own existing contract, and this
  context means something different: the system working, not "press to
  start").
- **`ui.js`**: three small reusable primitives -- `Spinner`, `Skeleton`
  (one placeholder block; callers compose a few into whatever shape the
  real content has), and `LoadingState` (spinner + label, the direct
  drop-in replacement for the old bare-text line).
- **`App.js`**'s `FullScreenLoading` (the very first thing anyone sees,
  on cold load, during the session/org check): now the DecisionOS logo in
  a pulsing indigo panel above a small spinner + label, instead of gray
  text floating alone on a black screen.
- **Skeletons matching real content shape** (not a generic gray box) on
  every list/table-shaped page: Overview's "Недавние эксперименты" rows
  and "Лучшие варианты" bars, `ExperimentsList`'s experiment cards,
  `Participants`' stat tiles + table rows, `Team`'s member rows (a
  genuine full-page skeleton, since its loading gate replaces the whole
  page), and `Feed`'s post cards. Each mimics its page's actual layout
  (avatar circle + two text lines + a trailing number, a title + badge +
  description + meta row, etc.) so nothing visually jumps once the real
  data lands.
- **`LoadingState` everywhere else** the page has no single dominant
  shape to mimic, or the wait is usually too short to be worth a bespoke
  skeleton: `Billing`, `Settings`, `Profile`'s top-level gate, `Results`/
  `Insights`/`Reports`' `experimentsLoading` and `loadingAnswers` gates,
  `PublicProfile`. `Profile`'s own tiny avatar-upload overlay (a circular
  spot, not a line of text) got a bare `Spinner` instead -- no label fits
  there.

**Verified**: 47 Playwright checks across 11 routes plus the full-screen
loader, using mocked Supabase responses with a real artificial network
delay (not instant) so the loading state is genuinely observable rather
than assumed -- confirms the *correct* loading primitive appears on each
page (skeleton where expected, spinner where expected, never a bare
"Загрузка…" paragraph anywhere), that it visually matches a real
screenshot reviewed for each page, and -- critically -- that it actually
clears once the delayed data resolves rather than getting stuck. Caught
and fixed two real test-timing bugs before trusting the results: the
first version checked at a fixed 500ms mark without accounting for the
*outer* app-level session/org gate resolving before the *inner* page's
own fetch even starts (switched to `waitForFunction` on `aside.sk-sidebar`
appearing, rather than a guessed delay); a few routes (`Results`/
`Insights`/`Reports`, which chain two sequential delayed fetches) proved
flaky specifically when run back-to-back with ~20 other fresh Chromium
launches in the same suite invocation, not when run alone -- confirmed
pure sandbox resource contention (not a real stuck-loading regression) by
re-running the same script in isolation three consecutive times with
zero failures, then widened the test's own settle-timeout margin rather
than changing any app code. Full regression suite plus the full-site
sweep re-run clean.

### Static pre-boot placeholder, and the Feed author-click actually showing info ✅

Two follow-ups from real production use.

- **The "Loading DecisionOS…" text was a different thing than the loader
  just built**: `index.html` has its own static placeholder inside
  `<div id="app">`, shown before `main.js` has even loaded -- it can't use
  the new Preact `FullScreenLoading` component, since no JS has run yet to
  render it. That placeholder was untouched by the previous round's work,
  so on a real phone's network (slower than instant local mocks) it was
  still plain English text on a bare screen, with a visible swap to the
  branded loader once the app actually mounted. Replicated the exact same
  markup in plain HTML/CSS (the same `sk-panel-flat`/`sk-pulse-indigo`/
  `sk-spinner` classes `styles.css` already defines, loaded before
  `<body>`, plus an inline copy of the logo SVG) directly in `index.html`,
  so there's no visible difference between the pre-boot and post-mount
  states at all.
- **The Feed author-click genuinely didn't show anything, for a real
  reason**: it navigated to `/u/:username`, which depends on
  `public_profile_enabled` -- an *external*, anonymous-link-sharing
  opt-in (0008) that defaults to `false` and essentially no one ever
  toggles. The click handler and navigation were working exactly as
  built; the destination was the wrong one. A signed-in user looking at
  the feed is not a stranger on the open internet, so gating "see who
  posted this" on the same flag as "make my profile visible to anyone
  with the link" was a mismatch between two features that happened to
  share a mechanism.
  - **`0013_profiles_public_bio.sql`**: extends `profiles_public` (0011 --
    already `authenticated`-only, never `anon`) to also carry `bio` and
    `role_title`. This is a real, deliberate narrowing of the stricter
    "bio is opt-in-only" boundary 0011 itself documented -- recorded
    explicitly in the migration's own comment, not done quietly: bio/role
    become visible to any *signed-in platform member*, same as name/
    avatar already were, still never to `anon`/the public internet. The
    external `/u/:username` page and its stricter opt-in flag are
    completely unchanged.
  - `postsStore.js`: `mapPost`/`fetchAuthorsById` now also carry
    `authorRoleTitle`/`authorBio` per post.
  - `Feed.js`: clicking an author's avatar or name now opens an in-app
    popover (reusing the same hand-rolled overlay pattern this file
    already uses for delete-confirmation, rather than introducing a
    second modal idiom) showing their real avatar, name, role, and bio --
    instead of navigating anywhere. An author with no bio gets a graceful
    "hasn't added a bio yet" line rather than a blank gap.
  - Clickability itself no longer requires `authorUsername` (that was
    only ever needed to build the old `/u/...` URL) -- now gated on
    `authorName` being present, which is true for every real post.

**Verified**: 12 Playwright checks -- clicking a name stays on the feed
(no navigation), the popover shows the real name/role/bio from a mocked
`profiles_public` response, and -- the specific regression check that
matters here -- the external `get_public_profile` RPC is mocked to fail
loudly if called at all, confirming the feed genuinely stopped depending
on it rather than just happening to work in this test. A second author
with no bio still opens correctly with the fallback line. Closing works
both via the popover's own button and via a backdrop click. The old test
script (written for the navigation-based version) was rewritten rather
than patched around, since the underlying behavior it checked no longer
exists by design. Full regression suite plus the full-site sweep re-run
clean.

**Not yet live**: migration 0013 has the same gap as every other
migration this session -- written and committed, not yet applied. Its
SQL (`create or replace view profiles_public as select id, full_name,
username, avatar_url, bio, role_title from profiles;`) needs to be run in
the Supabase SQL Editor before bios/roles will actually appear in the
feed on the real deployment.

### 10-step onboarding wizard, replacing the single-field org form ✅

The old post-signup screen asked for exactly one thing -- an organization
name -- then dropped the new user straight into the app with every other
profile field blank. Replaced it with a full guided setup wizard
(`src/pages/auth/Onboarding.js`, same file, completely rewritten): ten
steps behind a shared `WizardShell` (logo header, "Шаг N из 10" label, an
animated indigo progress bar) and a shared `StepNav` (Back/Skip/Next,
disables Next until a step's required field is valid, shows a busy state
on the final submit) --

1. Welcome
2. Organization name (required -- the one field the old form had)
3. Identity: full name (required) + role/title
4. Avatar upload
5. Username (validated live against the same rules as the Profile page)
6. Short bio
7. Country + timezone (reusing `COUNTRIES`/`TIMEZONES`, the latter moved
   from being `Profile.js`-local into `questionTypes.js` so both pages
   can share one list instead of duplicating it)
8. Research interests (comma-separated tags)
9. Email notification preferences (two switches, pre-checked)
10. Invite teammates (repeatable email+role rows) -> Finish

Steps 3-9 are all skippable; only the org name and full name are
actually required to finish. **Nothing is written to the database until
the final "Finish" click** -- every step just patches one local `form`
object in memory. This is deliberate, not an oversight: the app's route
guard decides whether to show the wizard at all based solely on whether
the signed-in user already belongs to an organization, so creating that
organization on step 2 instead of step 10 would mean a user who reloads
mid-wizard (closes the tab on step 5, say) lands back on step 2 next
time, not step 5 -- the org already exists, the guard sends them straight
into the app, and every field after step 2 silently never gets asked
again. Collecting everything in memory and sending one
`createOrganization` + one `updateMyProfile` + N `addMemberByEmail` calls
together at the end avoids that half-onboarded state entirely. The one
deliberate exception is the avatar (step 4): it uploads immediately on
file select, since `uploadAvatar()` doesn't depend on the org existing
and showing the real picture right away (instead of a "trust me, it
uploaded" promise) is better UX. A bad invite email doesn't block
finishing either -- the org and profile are already real by the time
invites are sent, so one typo'd address surfaces as a toast, not a
blocking error that strands the user with a half-finished account.

Other details: the full name already captured at signup, plus anything
already saved on the profile (role, username, bio, country, timezone),
pre-fills its step instead of asking again. Each step's first input
receives real focus on arrival -- the HTML `autofocus` attribute (and
React's `autoFocus` convention) only fires for markup present at the
page's *initial* parse, never for elements a framework mounts later, so
every step change runs a small `useEffect` that focuses
`.sk-panel input, .sk-panel textarea, .sk-panel select` imperatively.
Full `auth.onboarding.*` i18n tree (~45 keys) added to all three locales.

**A real layout bug was caught before this ever shipped**: the invite
step's role `<select>` was `class="w-auto shrink-0"`, and Chromium sizes
a *closed* native select by its **widest** `<option>` text -- not the
currently-selected one -- so as soon as a long Russian role label
(`"Администратор"`) was merely an available option, the select demanded
more width than it had, and `shrink-0` blocked it from being compressed
to fit, pushing it past the wizard card's right edge into the dark
background. Fixed by giving the select an explicit `w-36` (overrides
content-based auto-sizing entirely) and adding `min-w-0` to the adjacent
email input so that one can still shrink to make room.

**Verified**: `test_onboarding_wizard.mjs` drives the entire flow
end-to-end against mocked Supabase responses -- every one of the 10
steps in order, including actually choosing a file for the avatar
upload and confirming the storage call fires, typing an invalid then a
valid username and watching Next enable/disable accordingly, toggling a
notification switch off, and adding a teammate invite -- then checks that
Finish sends exactly one `create_organization_with_owner` call with the
typed name, one profile PATCH with every collected field (including the
toggled-off switch), one `add_member_by_email` call with the right
email/org, a redirect to `/app/overview`, and zero console errors.
`test_onboarding_skip.mjs` checks the other side of the same gate: a user
who already belongs to an org is redirected straight past the wizard and
never shown step 1 at all. `test_invite_row_overflow.mjs` stress-tests
the select fix specifically by picking the longest real role label and
measuring the rendered select's right edge against the card's -- it now
lands 1px inside it (sub-pixel rounding, not a real gap; the original bug
overflowed by double-digit pixels, clearly outside the card). Full
regression suite (26 scripts) re-run clean except one known flake:
`test_loading_upgrade.mjs` failed its `/app/reports` "not stuck" check
once under full-suite contention (~25 fresh Chromium launches back to
back), then passed 3/3 when re-run alone immediately after -- the same
sandbox-timing flake already documented in the loading-UX round above,
unrelated to anything changed here (this round never touched
`Reports.js`/`Insights.js`).

**Not yet live**: none -- this round is pure frontend (new component
logic + CSS), no new migration.

### Fixed a real "sign up and never get in" bug: email-confirmation links stuck forever on the loading screen ✅

A genuinely critical bug, reported from the actual deployed site
(`decisionos-self.vercel.app`): clicking the confirmation link Supabase
emails after signup landed back on the app frozen on the branded loading
screen, permanently. Root cause was a straight collision between two
systems that both think they own the URL:

- This app's router is hash-based (`#/app/overview`, etc.).
- Supabase's email-confirmation (and password-recovery) links redirect
  back to the site with the session tokens appended directly to the URL
  the exact same way -- `#access_token=...&refresh_token=...&type=signup`
  (implicit flow), or `?code=...` (PKCE).

On load, the router reads that hash, fails to recognize it as any real
route (it's token junk, not a path), and -- this is the actual bug --
immediately rewrites it away via its own "unrecognized path, go home"
fallback, *before* supabase-js's own token exchange (always asynchronous)
ever gets a chance to read it. The tokens are gone before Supabase sees
them. No error is ever shown anywhere, because nothing actually failed in
the normal sense -- the app just never looked at what it was given.

Fixed in `App.js`: a Supabase auth-callback hash/query is now detected
and its *intent* (any real path prefix a recovery link carries, e.g.
`/reset-password`) captured in a snapshot on the very first render --
before anything else runs. While that snapshot says we're still waiting,
the app renders nothing but the branded loader and touches neither the
hash nor the router; once the session has actually resolved (confirmed
or not, bounded by the existing 10s `getSession()` timeout so this can
never hang forever), it navigates for real: to the recovered path for a
password reset, to `/app/overview` for a newly-confirmed signup, or to
`/login` if the link turned out to be invalid or expired.

This took two real iterations to get right, both caught by testing against
the actual supabase-js client (mocking its network calls, not just
pre-seeding a session in localStorage the way every onboarding test this
session already did -- that would have skipped the exact code path the
bug lives in entirely):
- First attempt stored "are we still waiting" as component *state*.
  Flipping it forced an extra render -- and that render could land in the
  narrow gap between `navigate()` changing `location.hash` and the
  router's own `hashchange` listener actually catching up (a real event,
  dispatched on a later task, not synchronously). A render in that gap
  still held the *original* garbage path, which was enough to fall
  through to the same "unrecognized path" fallback all over again --
  confirmed by literally tracing every render with the real sequence
  logged, not guessed at.
- Fixed by gating purely on whether the router's own path has *actually*
  moved on from the original garbage value it first parsed, not on
  whether this component thinks it has "handled" anything -- a check
  that's correct no matter how many unrelated re-renders (another
  `onAuthStateChange` notification, anything else) land in that gap.

**Verified**: a dedicated test drives the real flow two ways -- a bare
signup-confirmation callback (no path of its own) and a path-prefixed
password-recovery callback -- against a mocked Supabase backend that only
responds correctly (`/auth/v1/user`, `/rest/v1/profiles`) if the tokens
actually survived to be used, plus a plain normal page load to confirm
the new guard never fires when it shouldn't. All 7 checks pass. Full
regression suite re-run clean afterward.

### Language picker on every public page, not just inside the app ✅

A real, simple gap: the language switch only existed in the authenticated
app's own header. Landing, login, register, forgot/reset-password, and
the onboarding wizard had no way to change language at all -- a visitor
whose browser doesn't report `kk`/`en` (the only two cases that override
the `ru` default) had zero recourse before ever creating an account.
Exported the existing `LanguageSwitch` component from `shell.js` instead
of duplicating it, and placed it on the Landing header, inside the shared
`AuthLayout` (covers login/register/forgot/reset-password in one place),
and in the onboarding wizard's own header. It already handled "not signed
in yet" correctly with no changes needed -- it only tries to persist the
choice to a profile when one exists, and always updates the visible
language immediately regardless.

Adding a third element to the Landing header's button row pushed it past
390px-wide mobile viewports -- a real regression, caught by the existing
`verify_avatar_and_landing.mjs` overflow check, not a new one written for
this. Fixed by letting that row wrap as two logical groups (the language
switch; the login+create-research pair, which always stay together)
instead of three independent items with no wrap point between them.

**Verified**: 20 Playwright checks confirm the switch is visible and
actually changes the rendered language on all five public pages. The
mobile-overflow regression was caught, then re-verified clean (4/4) in
isolation after the fix. Full regression suite re-run clean (the one
`test_loading_upgrade.mjs` flake was the same pre-existing sandbox-timing
issue documented earlier -- confirmed again by two isolated re-runs, one
clean, matching the established pattern exactly).

**Separately, not a code change**: the confirmation email itself was
reported as looking like a raw, unbranded Supabase system message rather
than something from DecisionOS. That's a Supabase Auth email template, a
dashboard setting with no git representation -- handed to the user as
ready-to-paste branded HTML (Confirm signup and Reset Password) instead.

### Enlarged the notification-toggle switches ✅

Flagged twice, with a screenshot circling the same onboarding step both
times, as "looking weird" -- but without a specific defect ever being
pinned down. Measured everything that could plausibly be wrong (overflow
at 320/360/393px, at up to 175% simulated text scaling, clicking the
label vs. the switch itself) and found nothing broken: the geometry was
always correct, the click target always worked. What *was* real: at
`h-5 w-9` (36x20 CSS px), the switch's own tap target sat well under the
~44px minimum most platform guidelines recommend for a touch target, and
looked noticeably thinner/flatter than the toggle proportions most
people are now used to from iOS/Material-style switches elsewhere. That
is a believable, if not strictly provable, explanation for "weird" with
no sharper bug behind it.

Resized `Switch` (`components/ui.js`, one shared component -- used by
onboarding, `Profile.js`'s notification tab, and `ExperimentBuilder.js`'s
settings panel, all three checked visually after the change) from
`h-5 w-9` track / `h-4 w-4` knob to `h-6 w-11` / `h-5 w-5` -- the same
44x24 proportions Tailwind's own documented toggle pattern uses, with the
knob's travel distance recalculated to match (16px -> 20px) rather than
left stale.

**Verified**: visual comparison against the user's own screenshot at the
same viewport, plus fresh screenshots of the other two usage sites.
No overflow at any previously-tested width. Full regression suite
re-run clean (27/28; the one `test_loading_upgrade.mjs` failure was the
same pre-existing sandbox-timing flake documented repeatedly above,
re-confirmed clean on an isolated re-run immediately after).

### Landing header regrouped: logo+language left, actions right ✅

Flagged a second time -- a real-device screenshot of the Landing page
header, same "looks a bit weird" phrasing as the switches. The overflow
from adding the language switch had already been fixed (nothing was cut
off any more), but the fix itself was the problem: the switch sat alone
on its own line, right-aligned, with "Войти"/"Создать исследование"
as a *separate* right-aligned pair on the line below -- two unrelated-
looking floating groups rather than one coherent header, even though
nothing technically overflowed.

Regrouped by what the elements actually *are*, not just what fits:
the logo and language switch are both "about the brand/preferences" and
now sit together on the left; the two CTAs stay together on the right,
exactly as they were laid out before the switch ever existed. The outer
header's own `flex-wrap` (already in place from an earlier round) now
does the only wrapping needed -- the whole left group drops below the
whole right group as one unit on narrow screens, never splitting a
group's own members across two lines the way the previous fix did.

**Verified**: no horizontal overflow at 320/360/390/412px (the previous
fix's regression plus the common surrounding device widths). Full
regression suite re-run clean (27/28, the one `test_loading_upgrade.mjs`
failure again the same documented sandbox flake -- isolated re-run
passed clean immediately after).

### Landing's mobile header simplified to a single menu icon ✅

A third round on the same header, this time with a concrete reference:
a screenshot of Supabase's own marketing site on mobile (logo left, one
compact menu icon right, nothing else competing for space) and "let
everything stay centered, don't push it to the edges." The regrouped
two-item layout from the previous round was still, structurally, trying
to fit multiple independent controls into one cramped row on narrow
screens -- a fundamentally different shape from the reference.

Replaced it outright below the `sm` breakpoint: the header now shows
just the logo and a single hamburger icon (the same `menu` icon and
`sk-btn` treatment the authenticated app shell already uses for its own
mobile nav, not a new pattern). Tapping it opens a centered overlay --
the same `fixed inset-0 flex items-center justify-center` backdrop
pattern already established elsewhere in this app for confirmation
dialogs, reused here for a menu instead -- holding the language switch
and both buttons stacked and centered, closable by its own button or a
backdrop click. `sm:` and wider is untouched: there was never a cramping
problem at those widths, so the original inline row still renders there.

**Verified**: a new dedicated test (`test_landing_mobile_menu.mjs`, 8
checks) -- no overflow with the menu closed or open, the desktop row is
actually `display:none` (not just visually overlapping), the menu's own
language switch and both buttons are real and clickable, switching
language from inside the menu works, and it closes on a backdrop click.
One pre-existing test's own check no longer meant anything after this
change (it measured a "Создать" button's height to confirm it wasn't
wrapping to two lines -- impossible now, the button lives in the menu
overlay, not the header) -- replaced with a check that the header's
mobile button is a single, sanely-sized square icon instead of silently
passing by accident on a hidden, zero-height element. Full regression
suite (29 scripts) re-run clean, including `test_loading_upgrade.mjs`'s
known sandbox-timing flake behaving this time.

### Two real bugs found in the live participant flow, from one vague bug report ✅

Reported as "clicking through to question 2 without answering question 1"
in the live research flow -- no screenshot, no exact repro steps. Rather
than guess at a fix, built a systematic reproduction harness first: drove
the real `ParticipantRunner` against a mocked Supabase backend across
*every* question type (single/multiple choice, yes/no, rating, ranking,
recall, price perception with and without preset options, both as
general questions and as per-variant ones) and tried every plausible
bypass -- Enter key, clicking the background, tabbing to a button and
activating it with the keyboard. 30 checks, all clean: every question
type already structurally blocks advancing without a real answer (no
Continue button exists at all for most types until something is picked;
the ones that do have one keep it `disabled` until every variant is
answered).

The actual bug needed a different lever: a configured **time limit**.
`QuestionTask`'s countdown timer already auto-submitted `value: null` and
advanced the instant it hit zero, with **no exception for a question
marked `required`** -- confirmed directly: a 2-second time limit on a
`required: true` question silently produces a null response and moves to
the next question the moment the clock runs out, with nothing on screen
explaining why. A sitting participant watching the countdown would see
exactly "moved to question 2 without answering question 1."

Fixed in `ParticipantRunner.js`: a required question that times out no
longer auto-submits -- the countdown still creates real pacing pressure
(it's visible throughout), but at zero it now shows a plain inline notice
("Time's up, but this question still needs an answer") and the question
stays fully interactive until a real answer is given. A question actually
marked optional (`required: false`) keeps the original auto-skip-on-
timeout behavior unchanged -- there's no way to create one from the
builder UI today (every question is hardcoded `required: true` there, so
this is the only reachable state in practice), but the distinction is
now real and tested either way, not just coincidentally safe.

**Verified**: the first reproduction harness (30 checks) confirmed no
other skip path exists anywhere. A second, targeted test confirms the
actual fix: a required timed-out question stays on screen, shows the
notice, sends nothing to the backend, and can still be answered for real
afterward (and that real answer is what gets sent, not a stale null); a
non-required one still auto-advances with a null response exactly as
before. 9/9 checks. Full regression suite re-run clean.

### Sidebar collapse-toggle icon no longer sits off the rail's center line ✅

A second screenshot, red arrow traced straight down the collapsed
sidebar's icon column, with a report that icons visibly shift on hover.
Measuring every icon's actual horizontal center confirmed the real
defect directly: `NavItem` correctly switches to `justify-center px-0`
when the sidebar is collapsed (centering each icon in the narrow rail),
but the sidebar-mode picker's own wrapper `<div>` was hardcoded to
`justify-start px-3` regardless of collapsed state -- the one icon in
the whole column that never recentered, sitting visibly left of every
other icon's shared line. Fixed by giving it the same collapsed-aware
class switch `NavItem` already uses.

The separate "icons shift on hover" report didn't reproduce under
measurement -- hovered every icon in turn and re-measured every other
icon's position each time; nothing moved (`.sk-nav-item`'s own CSS only
transitions background/color/box-shadow, never a transform). The most
likely explanation is this same misalignment: a column that's supposed
to read as one clean vertical line, with one icon visibly off of it,
reads as "something's moving" even with nothing animating.

**Verified**: every icon in the collapsed rail (14, including the
previously-offset picker) now shares the exact same horizontal center,
0px spread. A second test hovers each icon in turn and confirms no
icon's position ever changes. A third, pre-existing test had encoded the
*opposite* assumption from an earlier round (the picker should stay at a
fixed x between expanded and collapsed) -- correct at the time, but
structurally incompatible with centering it in a narrower collapsed rail
that starts at a different x than the expanded layout's left-aligned
content. Updated that assertion to check what actually matters now (left-
aligned when expanded, centered with the nav icons when collapsed) rather
than reverting the fix to satisfy a now-outdated expectation. Full
regression suite re-run clean.

### Real AI-generated insights, wired to the Claude API ✅

The Insights page's rule-based engine (`lib/insights.js`) was already
solid -- deterministic, fully explainable, correctly confidence-scored --
but it only handles structured/choice data, produces a list of templated
sentences rather than prose a marketer could show their team as-is, and
never reads open-ended text responses at all. The `generate-insights`
Edge Function existed only as a scaffold since an earlier round (real
auth, real org-membership check, a clearly-labeled `not_configured`
fallback when no AI key is set) with the actual model call left as a
comment. Wired in for real, via the official Anthropic TypeScript SDK
(not raw `fetch`, imported the same way this project already imports
`@supabase/supabase-js` into a Deno Edge Function -- a versioned esm.sh
URL) and `claude-opus-5-5`.

Deliberately does NOT re-derive the rule-based engine's full statistics
(confidence intervals, corroboration checks, influence-factor mining) in
TypeScript -- that would risk the AI quoting a number that quietly
disagrees with what the researcher sees one click away on the same
Insights page. Instead the function independently queries (never trusts
from the caller) just the one number everything else gets read against --
completed sample size and the primary selection question's own
per-variant counts, using the exact same question-precedence
`primarySelectionQuestion()` already uses client-side -- plus up to 40
raw open-text responses per open-text question, the one kind of data
nothing else in the app analyzes at all. The system prompt hard-rules
out stating any number not given verbatim in that data, any causal
("X caused Y") framing, and dropping the small-sample warning below 30
completed responses; Claude's job is synthesis and the open-text theme
read, never arithmetic of its own.

- **`supabase/functions/generate-insights/index.ts`**: full rewrite past
  the scaffold -- `buildAnalyticsContext()` (verified sample + primary
  result + capped open-text samples), the real `anthropic.messages.create`
  call, and three honestly-labeled outcomes stored to `ai_insights`
  (`ready` with real text, `failed` with a retry-able error, or the
  pre-existing `not_configured` when no key is set -- never a fabricated
  result standing in for any of those).
- **`lib/experiments.js`**: `fetchLatestAiInsight()` (loads any existing
  result on page open, so it isn't lost on navigation) and
  `generateAiInsight()` (invokes the function, same auth-forwarding and
  error-unwrapping pattern already used for the public participant Edge
  Functions).
- **`Insights.js`**: a new card above the existing rule-based ones --
  generate/regenerate button, loading state, the honest "not configured"
  explanation, error+detail on failure, and the rendered result with its
  generation timestamp and model name once ready.
- Full `insights.aiSummary.*` i18n block, all three locales.

**Verified**: 12 Playwright checks against a mocked Edge Function --
generating actually calls the function once with the right experiment
id and renders the real returned text; a previously-generated result
loads and displays on page open with *zero* Edge Function calls (no
regenerating just to show a cached result); the `not_configured` state
renders its explanation, never a fabricated insight. The real
`anthropic.messages.create` call itself is necessarily untested here (no
API key in this sandbox) -- that boundary is exactly what's mocked.
Full regression suite (34 scripts) re-run clean, zero failures including
the previously-flaky loading test.

**Not yet live**: this needs two things only the user can do, neither of
which is a database migration this time --
1. Add an `AI_API_KEY` secret (an Anthropic API key) to the Supabase
   project: Edge Functions -> Secrets in the dashboard, or
   `supabase secrets set AI_API_KEY=sk-ant-...` via the CLI.
2. Redeploy the function so the real code (not the old scaffold) is what
   actually runs: `supabase functions deploy generate-insights`.

Until both are done, the "Generate AI summary" button will correctly and
honestly report "not configured" rather than silently doing nothing or
faking a result -- exactly the behavior the original scaffold was built
around from the start.

### ExperimentBuilder: wired to i18n + fixed a real step-skip validation gap ✅

Two bugs reported from the live wizard ("Создать эксперимент"): (1) some
of the page was in English regardless of which language was selected --
the Information step's field labels/placeholders were hardcoded English
while the nav buttons were hardcoded Russian; (2) you could leave the
Information step empty and still move on to the next step.

Root cause of (1): `ExperimentBuilder.js` (the 7-step experiment-creation
wizard, 580+ lines) had **zero i18n wiring** -- no `useT()` import, no
`t()` calls anywhere -- apparently missed entirely during the earlier
i18n pass. The step-2 research-type cards happened to render correctly
anyway, purely as a side effect of `questionTypes.js`'s `researchTypes(t)`
falling back to the app's current locale when called with no `t` (a
fallback meant to keep *unmigrated* call sites safe, not a substitute for
real wiring) -- which is exactly why only part of the page looked wrong
and the rest looked fine, instead of the whole page being obviously
broken.

Root cause of (2): the step tabs (1-7 across the top) call `goTo(n)`
directly on click. Only the *Continue* button's `disabled` state ever
checked whether the current step's required fields were filled in --
clicking a step tab skipped that check entirely and jumped straight
there, empty fields and all.

Fixed both in one pass, deliberately *reusing* rather than duplicating
existing translation content: a `builder.*` locale namespace already
existed with near-complete, well-translated RU/KK/EN copy for this exact
page (titles, all 7 steps, dimension labels) -- drafted in the earlier
i18n phase but, consistent with the wiring gap above, never actually
referenced by the component (`grep` for `builder\.` outside `locales/`
returned nothing). Rewired the whole file to call `t("builder...")` /
`t("common...")` throughout instead of inventing a parallel namespace,
and added only the 12 keys that were genuinely missing (an incomplete-
step toast, not-found/load-error copy matching the existing pattern from
`Results.js`, a publish-success toast, and 5 missing question "role"
labels -- attention/trust/quality/clarity/purchase-intention, alongside
the 5 that already existed) to all three locale files.

- **`src/pages/ExperimentBuilder.js`**: added `useT()`; every step
  component now takes `t` as a prop and uses it for every label,
  placeholder, hint and button. New `stepIsValid(n, draft)` -- a single
  pure function (name+objective filled / research type picked / >=2
  named variants / >=1 question) used by *both* the Continue button's
  `disabled` state and the new `goTo(n)` guard: jumping forward now
  re-validates every step being skipped over and blocks with a toast if
  any of them is incomplete; jumping backward or to the current step is
  still always free (nothing to validate going back).
- **`src/lib/locales/{ru,kk,en}.js`**: added the 12 missing `builder.*`
  keys (699 keys/locale, parity confirmed).

**Verified**: 34 Playwright checks. Across all three locales: zero raw
`key.path`-style leakage anywhere on the page, the title/step-tabs/field
labels/nav buttons all render in the selected language, and clicking
Continue drives a full real save round trip (create experiment, write
variants, re-fetch, re-render step 2) with zero console errors in any
language -- not just a static render check. Separately, the exact
reported skip: clicking step tabs 3/4/5/7 directly while an earlier
required step is still incomplete is blocked every time (step stays put,
toast explains why); filling in each gated step (1, 2, 3, 4) and then
jumping forward past all of them in one click succeeds once they're
actually valid; jumping backward to step 1 after reaching step 7 remains
unrestricted and the previously-typed values are still there. Full
regression suite re-run clean (35 scripts, including this round's new
one).

### Sidebar: nav items now actually react to hover ✅

Reported against Supabase's own dashboard sidebar as a reference (clean
spacing, every row visibly lights up under the cursor): ours "looks bad"
and hovering a nav button did nothing noticeable. The hover effect
wasn't missing -- `.sk-nav-item[data-active="false"]:hover` has always
set a background -- it was just tuned to `rgba(255,255,255,.04)`, 4%
white against the sidebar's near-black gradient (`--sk-sidebar`,
`#15171e` to `#0e0f13`), which reads as functionally invisible. The
design system already defines a `--sk-hi-strong: rgba(255,255,255,.14)`
token for exactly this ("strong highlight") that nothing was actually
using yet.

- **`styles.css`**: `.sk-nav-item[data-active="false"]:hover` now uses
  `var(--sk-hi-strong)` instead of the hardcoded 4% value -- a single
  token swap, 3.5x stronger, clearly visible. Deliberately left the
  *active* item's styling untouched: its inset-bevel look (`--sk-inset`
  + `--sk-shadow-inset`) is the app's established "skeuomorphic /
  physical instrument" language used consistently across buttons, tabs
  and slots elsewhere, not a bug to fix.

**Verified**: hovering a non-active nav item now measurably changes its
background (`rgba(0,0,0,0)` -> `rgba(255,255,255,0.14)`, alpha >= 0.1)
and reverts cleanly when the pointer leaves; the active item's gradient
background is confirmed unchanged. Full regression suite re-run clean
(36 scripts).

### Dashboard polish round: CTA button, empty-state card, header sizing ✅

Four points of feedback against the live Experiments page (empty state),
with Supabase's own dashboard sidebar as the reference for "clean":

1. The "Новое исследование" (New Research) CTA button "stands out too
   strongly and is squeezed into the corner."
2. The empty-state card's border looked "too limited, rough-edged," and
   icon/font proportions felt unbalanced.
3. The header's search box and RU/KZ/EN language switch were "too small
   and positioned too far apart."
4. The "0 активных" active-count badge -- read literally ("removing it
   isn't necessary at all"), left untouched.

- **CTA button**: `.sk-btn-primary`'s outer glow opacity cut from `.55`
  to `.35` (still clearly the primary action, no longer the loudest
  thing on the page). Tried first to left-align its icon flush with the
  logo/nav icons above and below it (same instinct as the "squeezed"
  read), but `.sk-btn` -- the base class every button in the app shares
  -- sets `justify-content: center` directly in its own CSS, not via a
  togglable Tailwind class, so overriding only this one instance would
  have meant fighting a deliberate, system-wide convention for a theory
  that turned out not to hold up (confirmed empirically: the Tailwind
  utility toggle was a no-op, the button stayed centered either way).
  Reverted that path and used the lever that's actually true to the
  complaint instead -- more outer margin from the sidebar edge (`px-3`
  -> `px-4` on its wrapper) -- which directly answers "cornered"
  without making this button inconsistent with every other `.sk-btn` in
  the app.
- **Empty-state card** (`EmptyState` in `ui.js`): was `sk-panel-flat` +
  `rounded-2xl`, while the app's regular `Card` component (used
  everywhere else) is `sk-panel` + `rounded-xl` -- a real, visible
  mismatch between how an empty state and a normal content panel read,
  independent of anyone's taste. Matched `EmptyState` to `Card`'s own
  treatment exactly (fuller raised shadow, same corner radius) instead
  of inventing a new style.
- **Header search bar**: widening `max-w-md` -> `max-w-xl` on the form
  turned out to change nothing measurable -- the grid's `auto` middle
  column (the exact mechanism a prior round built and verified for
  true, offset-independent centering; left untouched here) was sizing
  off the `<input>`'s own tiny default intrinsic width, never reaching
  anywhere near the old max-width cap. Gave the `<input>` itself a
  `min-w-[18rem]`, which inflates the form's real content width and
  grows the column that sizes off it: measured 274px -> 344px.
  First shipped this unconditionally and the regression suite caught a
  real break it introduced: at 640-768px (right where the search box
  first appears, between `sm` and `lg`) the wider minimum didn't leave
  enough room for the right-hand cluster, pushing the notifications
  dropdown up to 156px off-screen
  (`test_notifications_overflow.mjs`, previously 21/21, now failing at
  exactly those two widths and no others). The original complaint was
  unambiguously about a wide desktop view, so scoped the wider minimum
  to `lg:` and up (`lg:min-w-[18rem]`, no bare `min-w-*`), leaving
  640-768px exactly as it rendered before this round. Re-verified
  21/21 again after the fix.
- **Language switch**: `text-xs` -> `text-sm`, tab padding bumped
  (`px-2 py-1` -> `px-2.5 py-1.5`). Shared by `Landing.js`'s header too
  (including its mobile hamburger-overlay rebuild from an earlier
  round) -- re-verified no horizontal overflow there at both a phone
  and a desktop width after the size bump.

**Verified**: CTA button's glow opacity and increased outer margin
measured directly; `EmptyState` confirmed on the real `sk-panel
rounded-xl` classes; search bar's rendered width measured before/after
(not just the irrelevant max-width value) at both its narrow and wide
breakpoints; language-switch font size measured; zero console/page
errors across every page touched; Landing page checked for new
overflow at both a mobile and a desktop viewport. Full regression
suite re-run clean (37 scripts) after fixing the breakpoint regression
it caught.

### Removed the active-count badge and the homepage demo; a real CSS bug found along the way ✅

Three requests, the first two unambiguous removals, the third "make the
landing header look more like Supabase's":

- **Dashboard header's "0 активных" badge**: removed outright (`shell.js`),
  along with the `useExperiments`/`activeCount` wiring and the
  `shell.activeCount` locale key that existed for nothing else once it
  was gone.
- **Homepage interactive demo**: removed the whole `HomepageDemo` /
  `DemoStimulus` components and the `#demo` section from `Landing.js` --
  a real, previously-shipped feature (A/B/C/D variant picker, keyboard
  shortcuts, the works), not just a card. The hero's secondary CTA
  existed only to scroll to that section, so it would have become a
  silent dead click left in place; removed it too rather than leave a
  button that does nothing. Dropped the now-fully-orphaned
  `landing.demo.*` block and `landing.ctaSecondary` key from all three
  locales (699 -> 682 keys/locale, parity re-confirmed).
- **Landing header, closer to the Supabase reference**: investigating
  "make it look similar" surfaced a real, pre-existing bug, not a style
  preference -- the mobile hamburger button has been visibly rendering
  at *every* viewport width, desktop included, since it was built. Its
  `sm:hidden` and the base `.sk-btn` class's own unconditional
  `display:inline-flex` are equal-specificity CSS, and `styles.css`
  loads after `vendor/tailwind.css` in `index.html`, so `.sk-btn`'s
  declaration always won the cascade regardless of viewport --
  `sm:hidden` never once actually hid it. Fixed with the same
  important-modifier pattern already used correctly elsewhere in the
  codebase for this exact conflict (`shell.js`'s own mobile button uses
  `md:!hidden`): changed to `sm:!hidden`. That alone visibly decluttered
  the desktop header to look much closer to the reference; also widened
  the gap between the language switch / login / CTA cluster (`gap-3` ->
  `gap-5`) to match its airier spacing.

**Verified**: badge text and element both confirmed gone from the
dashboard header; demo section text, the dead secondary CTA, and the
`#demo` DOM node all confirmed gone from Landing while the primary CTA
remains; the hamburger button measured hidden at 1280px and *visible*
at 375px (the critical regression check -- confirming the fix narrows
the bug rather than breaking the real mobile case), clicking it at
375px still opens the mobile menu overlay correctly. One existing test
(`test_demo_single_question.mjs`) retired from the active suite rather
than patched -- it exercised nothing but the removed demo's own flow
(intro text, picking a tile, completion), so once that feature is gone
by design there's no replacement behavior left to assert. Full
regression suite re-run clean (37 scripts).

### Removed Experiments/Results from the sidebar nav, for now ✅

Requested alongside an open question about pivoting toward a seller
marketplace -- a much bigger, separate decision not acted on here, only
discussed. The removal itself: deliberately scoped to the *nav*, not
the feature. `NAV` in `shell.js` dropped the `experiments` and
`results` entries; their routes, pages, and locale labels are all
untouched, so this is a one-line-diff revert whenever the direction is
settled, not a deletion to redo. Left `shell.nav.experiments` /
`shell.nav.results` in all three locale files for the same reason --
removing them now would just mean retyping identical translations
later for no benefit, unlike the demo-and-badge removals earlier this
round where the underlying feature was gone for good.

**Verified**: sidebar no longer shows "Эксперименты" or "Результаты";
every other item (Обзор, Участники, Инсайты, Отчёты, and the Community/
Workspace groups) still renders exactly as before. `/app/experiments`
and `/app/results` still load correctly when visited by direct URL,
confirming the routes themselves are untouched. Collapsed-sidebar icon
alignment re-verified with the shorter list (0px spread, matching the
careful fix from an earlier round). An existing test
(`test_sidebar_collapse.mjs`) specifically checked the collapse/expand
label-hiding behavior using "Эксперименты" as its example label text,
three separate places -- updated to a label that's still in the nav
("Обзор") rather than reverting the removal to keep an old test string
alive. Full regression suite re-run clean (38 scripts).

### New logo mark, designed and animated ✅

Requested: a genuinely strong mark, explicitly not "AI-generated-looking,"
with its own animation. The old mark was a generic isometric-cube line
icon -- pleasant enough, but that exact silhouette is one of the most
overused tropes in tech-product logos, arguably closer to the generic
feel being asked to avoid than a real identity. Prototyped three
directions standalone (an evolved asymmetric cube, a faceted "D"
monogram, and converging paths resolving to a point) outside the app
first, screenshotted each at sidebar/favicon scale before touching any
real file, and picked the converging-paths direction: it reads clearly
from 14px up, works on both dark and light backgrounds, and -- unlike
an arbitrary shape -- the convergence is literally what the product
does (comparing options, arriving at one decision), which also gives
the animation a reason to exist instead of motion for its own sake.

- **`components/icons.js`**: new `Logo` component, separate from the
  generic `Icon`/`PATHS` system -- unlike every other icon it needs
  more than one color at once (two muted paths + one resolved in the
  accent indigo), so it can't share `Icon`'s single `currentColor`
  stroke. Takes an `animated` prop: off (default) renders fully drawn,
  static except for a slow breathing glow on the resolved point,
  everywhere the mark is persistent chrome (sidebar, auth headers,
  onboarding, public profile); on plays the one-time reveal (paths draw
  themselves in, shortest/most-converged last and fastest, then the
  point pops in and settles into that same glow) -- used only for the
  full-screen loader and the landing page's first-impression header,
  the two places a visitor actually watches it load rather than
  glancing past it on every navigation.
- **`styles.css`**: the draw-in (`stroke-dasharray`/`dashoffset`), pop,
  and glow keyframes, path lengths hand-measured per line so the draw-in
  has no gap or overshoot at its end. Added to the existing
  `prefers-reduced-motion: reduce` block alongside the app's other
  animations -- skips straight to the fully-resolved state rather than
  leaving the mark stuck invisible mid-reveal for users who've asked
  for less motion.
- Replaced all 6 call sites (`shell.js`, `App.js`'s loader,
  `AuthLayout.js`, `Onboarding.js`, `PublicProfile.js`, `Landing.js`)
  and the browser-tab favicon (a matching static SVG data URI, since a
  favicon can't animate) consistently -- no leftover usage of the old
  mark anywhere.

**Verified**: the mark and all 3 paths + resolved point render at every
call site; the sidebar's persistent instance is confirmed static (not
the reveal variant); the landing header's animated instance is confirmed
*actually* animated -- caught mid-draw shortly after load
(`stroke-dashoffset > 0`) and fully resolved a moment later, not just a
CSS class declared but never exercised; `prefers-reduced-motion`
confirmed to render fully resolved immediately rather than stuck
invisible; zero console/page errors across the dashboard, landing, and
both auth routes. Full regression suite re-run clean (39 scripts).

### Feed social layer: likes, comments, saves, and real notifications ✅

Requested: strict spam/profanity watch on anything new that accepts
text, likes + comments + saves on every post, and a real notification
when someone comments on your post. Four new tables
(`supabase/migrations/0014_post_interactions.sql`): `post_likes`,
`post_saves`, `post_comments`, `notifications`. RLS mirrors `posts`'
own conventions throughout -- `post_likes`/`post_comments` are
platform-wide readable (`using (true)`, same as `posts`), own-row
write, and `post_comments` gets the same admin-delete-any backstop
`posts` already has (`is_admin`, 0012) layered alongside delete-own,
since a comment is exactly as much of an abuse surface as a post body.
`post_saves` is scoped to the owner's own rows instead -- a private
bookmark list, not a public count, so nobody else needs to read who
saved what.

`notifications` is the one table here that breaks the
"owner column defaults to `auth.uid()`" pattern every other table in
this schema follows: the party that matters is the *recipient* (the
post's author), not whoever's running the insert, so `recipient_id`
can't default to the caller. Left client-settable, that column would
let any signed-in user spam a notification into anyone's inbox. The
insert policy validates it server-side instead --
`recipient_id = (select author_id from posts where id = post_id)` --
so a forged recipient is rejected outright, and
`actor_id <> recipient_id` doubles as a hard backstop against
self-notifications even if the app code's own suppression (below) were
ever bypassed or buggy.

- **`lib/postsStore.js`**: `fetchPosts()` now pulls `post_likes(count)`
  / `post_comments(count)` as PostgREST aggregate embeds in the same
  request, plus two small targeted queries (same "separate query,
  merge client-side" shape `fetchAuthorsById` already used for authors)
  for which of the loaded posts the *current viewer* has liked/saved.
  `fetchAuthorsById` is now exported -- the new modules below reuse it
  verbatim for comment and notification authors rather than
  duplicating the same profiles_public lookup.
- **`lib/postInteractions.js`** (new): `toggleLike`/`toggleSave`
  (insert-or-delete by the viewer's current state, same no-optimistic-
  update/reload-after-mutation shape `createPost`/`deletePost` already
  use), `fetchComments`, `createComment` (takes already-moderated
  text, same division of labor as `createPost`/`Composer` -- moderation
  is a UI-layer decision, not baked into the data layer), `deleteComment`.
- **`lib/notificationsStore.js`** (new): same reactive module-store
  pattern as `postsStore.js`. `createCommentNotification` skips
  silently when the commenter *is* the post's author -- notifying
  yourself about your own comment is noise, and the RLS policy above
  would reject it anyway, so this is a UX optimization (skip a
  request that would fail), not the real boundary. `markAllNotificationsRead`,
  `unreadCount`.
- **`components/icons.js`**: three new icons (`heart`, `bookmark`,
  `comment`) and a `filled` prop on the shared `Icon` component
  (swaps `fill="none"` to `currentColor`) for the liked/saved toggle
  states -- one small reusable lever instead of a second path per icon.
- **`pages/Feed.js`**: `PostCard` gets a like/comment/save action row
  and an expandable `CommentThread` (lazy-loaded on first expand, its
  own composer reusing `moderatePost()` exactly like the top-level
  Composer -- one profanity match censors and posts, two or more
  blocks the comment entirely with the same toast treatment). Comment
  delete shows for the comment's own author or an admin, mirroring
  `canDelete` on posts.
- **`components/shell.js`**: `NotificationsMenu` wired to real data --
  an unread dot on the bell, a dropdown listing each notification's
  actor, comment snippet, and relative time, opening the dropdown
  marks everything read (no per-notification detail view to click
  through to besides the feed itself, so per-item read-tracking past
  that point has nothing to attach to).
- A real bug surfaced and fixed along the way, not just worked around
  in tests: `Feed`'s top-level render hid the *entire* post list
  behind `loading && …`, and every mutation here (`invalidatePosts()`
  after a like/save/comment) sets that `loading` flag again, same as
  `createPost`/`deletePost` always did. Before this feature, that
  briefly swapping the whole list for a skeleton on every mutation was
  invisible -- there was no per-card state to lose. Now there is
  (`commentsOpen`): every like click was snapping any open comment
  thread shut, because the skeleton swap unmounts and remounts every
  `PostCard` from scratch. Fixed at the root: the skeleton now only
  shows on a genuine first load (`loading && posts.length === 0`), and
  the post list stays mounted through a background refresh (stale
  data, refreshing silently), so `PostCard`'s local state survives any
  mutation the same way `UserMenu`'s open/closed state already
  survives an org switch.
- i18n: nine new `feed.*` keys and `shell.notifications.commentOn`
  across all three locales; reworded the existing `feed.profanityBlocked`
  from "Пост содержит…" ("The *post* contains…") to a generic "Текст
  содержит…" ("The *text* contains…") in all three, since that message
  is now shared between blocked posts and blocked comments and the old
  wording was factually wrong for the second case.

**Verified**: a new `test_feed_interactions.mjs` (42 checks) covers the
full surface against a small stateful mock of the new REST endpoints
(not just canned responses -- insert/delete/update calls actually
mutate the mock's state, so a toggle-then-reload genuinely round-trips):
like/save toggle on and off with the count and fill state confirmed
after each; comment thread loads and renders mocked comments with
resolved author names; posting a comment on someone else's post fires
both the `post_comments` insert and a `notifications` insert addressed
to the real post author; commenting on *your own* post is confirmed to
send no notification at all; the one-profanity-word (censor-and-post)
and two-or-more (block-entirely) moderation paths both verified against
the actual request traffic, not just the toast text; comment delete
confirmed visible-and-working for the comment's own author, visible for
an admin on someone else's comment, and absent for a non-admin
non-author; the notification bell's unread dot, dropdown contents, and
mark-all-read-on-open all confirmed against real request traffic.
Screenshots of the action row, open comment thread, and notification
dropdown reviewed directly, not just asserted. Full regression suite
(44 scripts, including all 5 pre-existing feed tests) re-run clean
except the one `test_loading_upgrade.mjs` failure -- this time
investigated harder than the usual isolated-re-run check, since it hit
the same two routes three times in a row rather than its usual
scattered pattern: stashed every change from this round (`git stash -u`)
and re-ran the exact same test against unmodified `main` -- same two
routes failed the same way with none of this round's code present,
which rules out this feature as the cause outright rather than just
re-confirming the flake in isolation. Stash restored immediately after
with nothing lost.

### Fixed: comment "Send" button pushed off-screen on mobile ✅

User-reported, with a screenshot from a real phone (KZ locale, the
comment thread open under a post) -- the "Жіберу" button was shoved
almost entirely past the right edge of the viewport, only a sliver of
its label still visible.

Root cause: the comment composer added in the previous round
(`CommentThread` in `pages/Feed.js`) lays the `<input>` and the submit
`Button` out side by side in one flex row (`<form class="flex
items-center gap-2.5">`). The input had `flex-1` but not `min-w-0`.
Flexbox's default `min-width: auto` means a flex item won't shrink
below its own content's intrinsic minimum size *regardless* of
`flex-1`/`flex-shrink` -- for a bare `<input>` that intrinsic minimum
is wide enough on its own to not leave room for a sibling button in a
narrow card, so the row overflowed its container instead of the input
actually shrinking to make space. This is a different-looking instance
of the same family of bug already documented in this file for a CSS
Grid `auto` track: the fix is never on an ancestor's `max-width`, it's
an explicit `min-width` (here, `min-w-0`) on the element that's
actually refusing to shrink. The top-level Composer never hit this
because its layout is stacked (textarea on its own row, the publish
button below in a separate row) -- CommentThread is the first place
this codebase puts a text input and a button in the *same* flex row.

Fix: `min-w-0` added to the comment `<input>` so it can actually give
up space; `shrink-0` added to the submit `Button` so it always renders
at its natural size once the input does. Two-line diff, same lever
already proven in this file, just applied to the new component that
needed it.

**Verified**: new `test_comment_input_overflow.mjs` opens a comment
thread (KZ locale, matching the report) at 360/390/412px -- the three
viewport widths spanning small-to-large Android phones -- and measures
the submit button's actual bounding box at each: fully inside the
viewport (not clipped past the right edge) and still a real, readable
width (not squashed to a sliver), at all three. Screenshot at 390px
reviewed directly against the original report -- the button now sits
fully inside the card with room to spare. Full regression suite
re-run clean (41 scripts, including the two new feed tests from this
session plus this one), modulo the same documented
`test_loading_upgrade.mjs` sandbox-timing flake.

### Notifications go live: realtime delivery, a sound, and OS push permission ✅

Three concrete asks: a comment notification shouldn't need a manual
page refresh to show up; it should have a sound; the site should ask
for OS-notification permission.

- **`supabase/migrations/0015_notifications_realtime.sql`**: `alter
  publication supabase_realtime add table notifications;` -- opts the
  table into Supabase's realtime publication (equivalent to the
  Database -> Replication toggle in the dashboard). No RLS change
  needed: `postgres_changes` events are filtered through the same
  `notifications_select_own` policy (0014) the table already has, so a
  subscriber can only ever receive rows addressed to them.
- **`lib/notificationsStore.js`**: `subscribeToLiveNotifications(userId)`
  opens one `postgres_changes` channel (`event: "INSERT"`, filtered to
  `recipient_id=eq.<viewer>`) for the lifetime of the tab, guarded by a
  module-level singleton so re-mounting the bell never opens a second
  socket. On a live INSERT, reloads the resolved notifications list
  (same reload-on-change shape every mutation in this store already
  uses) rather than hand-assembling the new row's author/comment text
  from the bare realtime payload, then fires a synthesized two-tone
  chime (Web Audio, no external audio asset -- same hand-built posture
  as the icon set) and, if permission was granted, an OS-level
  `Notification` popup reusing the exact same `shell.notifications.commentOn`
  copy as the in-app dropdown. `requestNotificationPermission()` asks
  once per browser profile (guarded on `Notification.permission ===
  "default"`, which is only ever true before the visitor has answered
  at all) -- never re-prompts once decided either way.
- **A real race condition found before it shipped, not just in a
  demo**: the first working version called `getCurrentUser()`
  synchronously inside `useNotifications()`'s mount effect to get the
  id to subscribe with. `auth.js`'s own session hydration is async (a
  localStorage read) and, on a cold page load, routinely hasn't
  resolved by the time that effect first fires -- so the subscription
  silently never happened on a fresh visit, only on a client-side
  navigation where a previous page had already warmed the session.
  Caught by a test assertion that should have been trivially true
  (`requestPermission` called once on mount) intermittently reading as
  "never called" -- traced to `getCurrentUser()` returning `null` at
  that exact moment. Fixed the same way `profile.js`'s
  `useMyProfile()` already solves this identical race: drive the
  subscribe off `useSession()`'s *reactive* `user`, in a
  `useEffect(..., [userId])` that re-fires once the id actually
  resolves, instead of a one-shot synchronous read at first mount.
- **`favicon.svg`** (new file) + `index.html`: the browser-tab icon was
  an inline `data:image/svg+xml` URI with nowhere else to point to --
  extracted to a real file so the OS notification popup's `icon` option
  can reference the same mark instead of either duplicating a long data
  URI in JS or shipping the popup with no icon at all.

**A second real bug, this one in the test suite itself, not the app**:
the realtime subscribe now fires on every authenticated page, and this
sandbox's egress proxy rejects the real websocket host -- Chromium logs
that failed handshake as a console error regardless of how gracefully
`supabase-js` handles it internally, which started tripping the "zero
console errors" check nearly every existing authenticated-route test
already had. Confirmed the actual subscribe attempt was firing
correctly first (a throwaway diagnostic with a patched `window.WebSocket`
constructor showed the real, correctly-targeted connection attempt,
twice -- supabase-js's own reconnect), which narrowed this to a test-
environment gap, not an app bug. Fixed at the test-infrastructure level
with `page.routeWebSocket("**/realtime/v1/**", () => {})` (mock-intercepts
the socket -- it opens and stays silent, no real network attempt, no
console error) added to every `newPage()`/mock-setup block across all
42 scripts in the regression suite, including ones with more than one
page per file (missed on the first mechanical pass, caught by three
files still failing after it; one of those also had a second,
unrelated bug this surfaced -- a block that called `page.routeWebSocket`
on an already-`browser.close()`'d `page` instead of that block's own
`page2`, fixed to reference the right variable). `page.on("websocket")`
does not fire for a mock-intercepted connection (confirmed empirically,
not assumed) -- `test_realtime_notifications.mjs`'s own verification
that a subscribe attempt really happens goes through the same patched-
constructor technique instead.

**What this sandbox genuinely cannot verify**: an actual live push over
a real realtime connection (no Supabase backend reachable here), so the
sound and OS-popup code paths that only fire from `handleLiveNotification`
are verified by code review and by confirming the subscribe attempt
targets the right endpoint with the right event filter, not by watching
a live notification actually arrive end-to-end. This is the same
category of gap as every Supabase migration handed to the user this
session -- follows the standard, documented `postgres_changes` API, not
a novel mechanism, so it should work once 0015 is applied, but it is a
claim resting on following the documented contract, not on having
watched it happen here.

**Verified**: `test_realtime_notifications.mjs` (new) confirms
`Notification.requestPermission()` fires exactly once on mount when
not yet decided, is never re-asked after navigating to another page or
when already granted, and that a real subscribe attempt is made
targeting this project's correct realtime endpoint. `favicon.svg`
confirmed served with the right content type and containing the real
mark, and `index.html`'s icon link confirmed pointing at the file
instead of the old inline data URI. Full regression suite (42 scripts)
re-run clean, modulo the one documented `test_loading_upgrade.mjs`
sandbox-timing flake (reconfirmed intermittent exactly as before, same
signature).

### A real comment-count bug, clickable post images, and a bell-ring animation ✅

Three reports from one screenshot: a post showing "2" comments with 3
visibly open underneath it; post images that don't do anything when
clicked; a request to animate the notification bell.

- **The count mismatch was a real bug, not a display quirk**: `PostCard`'s
  💬 badge reads `post.commentCount`, a `post_comments(count)` aggregate
  that comes back with the rest of the POSTS list -- fetched once, and
  only re-fetched by this viewer's OWN actions (`invalidatePosts()` after
  liking, saving, or commenting). Comments have no realtime channel (only
  notifications do), so the moment a *different* person comments, every
  other open tab's badge is stale until something unrelated happens to
  trigger a reload -- while the thread itself, when expanded, always
  fetches the real, current rows directly. Two numbers, two different
  staleness windows, same card. Fixed by having `CommentThread` report
  the count it actually just fetched (and each add/delete within it) back
  up to `PostCard` via `onCountChange`, which prefers that live number
  over the possibly-stale aggregate the instant it's known -- the badge
  and the open thread underneath it can no longer visibly disagree.
- **Post images now open in a full-size view on click** -- a `fixed
  inset-0` overlay matching the exact same modal idiom this file already
  uses for delete-confirm and the author-info popover (click the backdrop
  precisely, via `target === currentTarget`, to close; an explicit X too).
  Composer's own pre-publish image preview is untouched -- different
  context (removing a draft, not viewing a post), not what was reported.
- **The bell rings on live arrival**: `notificationsStore.js` now tracks
  a `ringSeq` counter (separate from `state`, which `load()` replaces
  wholesale on every refresh -- a counter living inside it wouldn't
  survive that) bumped once per realtime INSERT, alongside the sound and
  OS popup the previous round already added. `shell.js`'s bell diffs the
  value it's currently seeing against the one it saw last render; a
  change replays a hand-written `@keyframes skBellRing` for one cycle
  (pivoted near the icon's top, like a real clapper) and then clears
  itself -- a one-shot reaction to *this* arrival, not a state that could
  get stuck on. Added to the existing `prefers-reduced-motion` block
  alongside the logo's own animations.

**Verified**: new `test_feed_comment_image_bell.mjs` reproduces the exact
reported mismatch (mocks a post whose aggregate says 2 while
`post_comments` actually holds 3) and confirms the badge reads the stale
2 before the thread is opened, all 3 real comments render once it is,
and the badge then reads 3 -- the inconsistency the report showed is
gone. The lightbox is confirmed absent beforehand, opens with the exact
same image on click, and closes both via the backdrop and the explicit
button. For the bell-ring, the animation mechanics are verified directly
against the real `styles.css` (not a copy) -- confirmed actually rotated
partway through its cycle and settled back to no rotation once it
finished, since that hand-written CSS is the genuinely novel part; the
plain React state-diffing that triggers it is not independently
re-verified here, for the same reason as every other realtime-adjacent
piece this round -- no live backend in this sandbox to drive a real
arrival end-to-end. Full regression suite re-run clean (43 scripts),
modulo the one documented `test_loading_upgrade.mjs` flake.

### A real one: every member's role display could show a co-member's role instead of their own ✅

Reported with a screenshot of the Profile page reading "Nureke · owner"
and the objection that not everyone should be able to be an owner. The
real mechanism is worse than the literal complaint, and not cosmetic:
`fetchMyOrganizations()` (`lib/org.js`) queried `organization_members`
with no `user_id` filter at all. "members: read within own org"
(0002_rls.sql) is scoped to `is_org_member(organization_id)` -- *any*
row for an org the caller belongs to, not specifically the caller's own
row, the same visibility every co-member's row sits under. For an org
with more than one member, that unfiltered query came back with one row
per *membership*, not per org -- the owner's row (created first, at
org-creation time) sitting right alongside this viewer's own, lower
role. `currentOrg.js`'s `.find((o) => o.id === activeOrgId)` then
returned whichever of those rows came back first, with no guarantee
that was the caller's own -- which is exactly how a non-owner member
ends up reading "owner" on their own Profile page. Same root cause,
same wrong value, on Settings' "Your role" badge too (`Settings.js:46`)
-- a second, not-yet-reported casualty of the identical bug.

Fixed at the source: `fetchMyOrganizations(userId)` now carries
`.eq("user_id", ...)`, so it returns exactly one row per org the caller
is *actually* a member of, with their own real role -- never a
co-member's. `userId` is explicit at the two call sites that already
have it resolved (`currentOrg.js`'s `reload()`, `App.js`'s
`ProtectedApp`, both already guarded so the id is never stale/missing
when they call this); the one remaining call site
(`Onboarding.js`'s own-org existence check, which has no session guard
of its own) falls back to `getCurrentUser()`, the same pattern
`fetchPosts()`/`fetchNotifications()` already use elsewhere in this
codebase -- unchanged behavior there, not part of what was reported.
`fetchOrgMembers()` (the Team page's member list) was not touched --
returning every member's role, scoped by `organization_id`, is
correctly the whole point of that one; only the "my own orgs" query had
the missing filter.

**Verified**: new `test_org_role_scoping.mjs` reproduces the exact
mechanism, not just the symptom -- the mock responds to the
`organization_members` request based on whether it actually carries
`user_id=eq.<the signed-in viewer>`, returning the real (pre-fix) RLS-
visible shape (owner's row AND this viewer's own row together) when
that filter is absent, and only this viewer's own row when it's
present. Confirms the real request sent now includes that filter;
confirms a non-owner member's Profile page reads their real role
("researcher"), never "owner"; confirms the same for Settings' "Your
role" badge; and -- so the fix isn't just coincidentally hiding
"owner" for everyone -- confirms a *genuine* owner, signed in
separately, still correctly reads "owner". Full regression suite
re-run clean (44 scripts), modulo the one documented
`test_loading_upgrade.mjs` flake.

### Clickable comment authors, a real avatar-centering bug, and closing a real owner-escalation gap ✅

Three requests, the last one landing right after the previous round's
role-scoping fix: lock "owner" to one specific account; let a comment's
avatar/name open that person's profile, same as a post's already does;
and a screenshot showing a post's avatar sitting at the vertical middle
of the whole card instead of beside the author's name.

**Avatar centering was a real CSS bug, confirmed both ways.** `PostCard`'s
outer row was `<div class="flex gap-3">` -- no `items-start`, unlike
`Composer`'s own identical avatar+content row, which already has it. A
flex item's default cross-axis alignment is `stretch`; the avatar's
wrapping `<button>` stretched to the row's full height (which can be
substantial -- image, action row, an open comment thread), and the
button's own centered content then put the avatar at the middle of
*that*, not its top. Confirmed empirically, not just reasoned about:
temporarily removed `items-start` and re-measured -- the avatar's
vertical center landed exactly on the card's vertical center
(`avatarMidY === cardMidY`, both 447.6px in the test fixture), i.e.
pixel-identical to the reported bug; restored it and the two diverged by
250px, avatar back at the top next to the name. One class, `items-start`,
fixes it.

**Comment authors are now clickable**, reusing the exact popover a post's
own author already opens (`Feed()`'s `viewingAuthor` state) -- no new UI
surface. `postInteractions.js`'s `mapComment()` now carries
`authorRoleTitle`/`authorBio` through (the data was already fetched by
`fetchAuthorsById`, just not passed along before), so a comment author's
popover shows the same role/bio a post author's does. Both the avatar and
the name in `CommentThread` are now buttons wired to the same
`onAuthorClick` prop `PostCard` already receives from `Feed()`.

**The owner-lock scope**: per discussion, scoped per-organization (each
org's own creator is and stays its owner; someone creating their own,
separate org still becomes its owner the normal way) rather than a single
platform-wide identity. Investigating *how* to enforce "no one else can
become owner" found a real, currently-live gap, not a hypothetical one:
`"members: owner/admin can change roles"` (0002_rls.sql) is an UPDATE
policy with a `using` clause but no `with check` -- in Postgres RLS that
means it gates which rows can be targeted, but places no constraint
whatsoever on the new values. Any admin could already
`update organization_members set role = 'owner' ...` on themselves or
anyone else, server-side, with nothing stopping it -- Team.js's UI
already hides this (its role dropdowns exclude "owner" everywhere, and an
owner's row isn't shown as editable at all), but the client was never the
real boundary here, and a direct API call bypassing the UI was not
blocked. `add_member_by_email()` (0006_team.sql) had the same shape of
gap -- `member_role` was inserted straight from the caller's own
parameter, unvalidated.

New migration `0016_single_owner_per_org.sql`: the update policy now
reads `using (... and role <> 'owner') with check (role <> 'owner')` --
an owner's own row can never be the target of this policy, and no update
under it can ever set a new role of 'owner' either, both directions
closed. `add_member_by_email()` now rejects `member_role = 'owner'`
outright. The one path deliberately left untouched is "members: creator
can seat themselves as owner" (already correctly scoped: only the org's
real creator, only themselves, only once, at creation) -- that's the
*only* way "owner" can ever be assigned now, for any org, which is what
makes this a per-org rule rather than a single hardcoded identity. The
migration also reconciles existing data to that invariant before
enforcing it going forward: demotes any row that holds 'owner' in an org
it didn't create (a safety net -- the only insert path for 'owner' was
already creator-only, so this should be a no-op) and ensures every org's
actual creator currently holds 'owner'.

**Verified**: the avatar fix with a before/after pixel measurement (see
above) via `test_avatar_align_comment_profile.mjs`, which also confirms
clicking a comment's avatar *and* its name both open the popover with the
right name and role title. The owner-lock migration is pure SQL with no
client-side change (Team.js's UI already excluded "owner" correctly) --
verified by careful re-reading of the policy logic and the exact
Postgres RLS semantics it depends on (`using` vs. `with check`), not by a
Playwright test; this sandbox has no live Postgres/RLS to actually fire a
rejected update against, the same limitation as every other RLS change
this session. One pre-existing test's selector went stale from the
comment-author markup change (`span` → `button`, now that it's
clickable) -- updated to match, not reverted. Full regression suite
re-run clean (45 scripts), modulo the one documented
`test_loading_upgrade.mjs` flake.

## Site-wide motion & animation system ✅

A large, explicit request: animate the whole product -- menus, language
switching, page transitions, buttons, posts/comments, modals, loading
states, scroll reveals, micro-interactions -- consistently, with natural
easing, mobile-safe performance, no excessive movement, and full
`prefers-reduced-motion` support, without touching any existing
functionality or layout.

**One motion system, not per-component ad hoc timing.** `styles.css`
gained a `--sk-ease-*`/`--sk-dur-*` token set inside the existing
skeuomorphic `:root` block (`--sk-ease-out`/`-in`/`-standard`/`-spring`,
`--sk-dur-fast`/`-base`/`-slow`/`-exit`) -- every new rule and several
existing ones (`.sk-btn`, `.sk-input`, `.sk-tab`, `.sk-switch-*`,
`.sk-nav-item`, `.sk-slot`, `.sk-checkbox`) now read timing from these
instead of ad hoc `ease`/bare `cubic-bezier()` literals, so the whole
app shares one feel. New `src/lib/motion.js`: `useMountTransition(open)`
drives a `data-state` attribute (`entering`/`entered`/`exiting`) so a
closing overlay plays an exit transition instead of unmounting the
instant `open` flips false (`if (!open) return null` can't do that --
the DOM node is already gone); `useMountedValue(value)` is the same
thing for "the modal's content IS the selected object, which goes
`null` the moment it starts closing" (`confirmDelete`, `viewingAuthor`)
-- it keeps rendering the last non-null value through the exit fade
instead of crashing on `null.id` mid-transition; `useReveal()` is an
IntersectionObserver-backed scroll reveal; `prefersReducedMotion()`
backs both. New CSS primitives consumed by all of the above:
`.sk-overlay-anim` (+`-down`/`-center` direction variants) for
modals/dropdowns/popovers, `.sk-backdrop-anim` for their backdrops,
`.sk-drawer-anim` for the mobile sidebar's edge slide, `.sk-expand-anim`
for inline content expanding in place (a comment thread), `.sk-toast-anim`
for a dismissing toast, `.sk-reveal` for scroll reveals, `.sk-page-enter`
for routed-page entrances, `.sk-locale-fade` for the language-switch dip,
`.sk-icon-pop` for a like/save icon's one-shot pop. All of it is
opacity/transform only (compositor-only properties -- no layout or paint
cost), which is what keeps several overlays animating at once cheap on a
phone.

**Cascading through the shared components, not page by page.** `Modal`
(`ui.js`) and `Dropdown`/`NotificationsMenu`'s panel (`shell.js`) are
composed by nearly every page already, so fixing those three plus the
mobile sidebar drawer and `ToastHost` cascades the "modals/popups get
real entrance+exit" requirement across the whole app in five edits, not
dozens. `Feed.js`'s three hand-rolled overlays (`confirmDelete`,
`viewingAuthor`, the image lightbox) got the same treatment directly --
they don't use the shared `Modal` (different header-less layout), so
reusing `Modal` would have changed their look; they get the identical
`useMountTransition`/`sk-backdrop-anim`/`sk-overlay-anim-center` wiring
by hand instead.

**Language switching**: `i18n.js` gained a `localeChangeSeq` counter
bumped by both `setLocale()` and `adoptProfileLocale()`, and
`useLocaleFadeClass()` -- a hook that watches it and returns
`"sk-locale-fade"` for ~380ms after any real change, then drops it
(toggled, not just applied once, so the CSS animation replays every
time, the same convention the notification bell's ring already used).
Wired to the root element of every top-level layout a `LanguageSwitch`
actually appears in: `Shell` (the whole authenticated app), `AuthLayout`
(login/register/forgot/reset), `Onboarding`'s `WizardShell`, and
`Landing`. Translated text across the whole visible layout dips and
recovers together instead of flickering mid-swap.

**Page transitions**: `Shell`'s `<main>` now wraps `children` in a
`<div key=${currentPath} class="sk-page-enter">` -- Preact remounts that
wrapper on every route change (new key), replaying the entrance on every
one of the ~10 dashboard pages for free. `Onboarding`'s 10-step wizard
had a subtler gap: its panel already had `fade-in`, but since `step`
changing doesn't remount the panel (same component instance, just new
children), that fade never replayed between steps -- the wizard had
*zero* transition between steps 1 through 10. Fixed by keying only the
inner step-content wrapper (not the whole panel) by `step`; the progress
bar stays outside that keyed subtree so its own `width` transition keeps
animating smoothly instead of snapping (keying its ancestor would have
unmounted it fresh every step, breaking that animation -- caught by
reasoning through it, not by a failing test). `Landing`, `PublicProfile`,
and every reachable state of `ParticipantRunner`/`LocalPreviewRunner`/
`LiveRunner` (loading, not-found, already-done, and the live task flow)
now carry `fade-in`/`slide-up` on their own root too, so the public and
participant-facing surfaces aren't a gap in "the entire website."

**Feed**: posts get a staggered `slide-up` on mount (capped at 6×40ms of
delay so a long feed doesn't take forever to finish animating in) --
`.slide-up` needed `animation-fill-mode: backwards` added so a delayed
instance renders at its *from* keyframe during the delay instead of
flashing fully visible first, then snapping to invisible when the
animation actually starts. A comment thread opening/closing now plays
through `.sk-expand-anim`; the image lightbox and the two Feed-local
modals get full enter/exit via `useMountedValue`. Liking or saving a
post now pops the icon once (`.sk-icon-pop`, triggered only on the
false→true edge, never on mount or on the way back out) -- a small,
single-pop micro-interaction, not a bounce loop.

**Landing**: scroll reveal on the workflow section (title + a staggered
per-card reveal), the example report, the disclaimer, and the footer.
`useReveal()`'s first version had a real flash bug, caught by its own
test rather than assumed fixed: an element already on screen the instant
it mounts (true for the workflow heading at common viewport heights --
not actually "below the fold" the way the first draft of the test
assumed) rendered hidden for one frame before the necessarily-async
`IntersectionObserver` callback caught up and revealed it. Fixed with a
second effect, `useLayoutEffect` (not `useEffect` -- it runs before the
browser paints, not after), that checks `getBoundingClientRect()` once
on mount and marks the element visible immediately if it's already
on-screen, skipping the hidden-then-revealed dance entirely for that
case. The hero itself intentionally never uses `.sk-reveal` (a one-shot
`slide-up` instead) for the same reason -- it's always above the fold,
so gating it on an observer at all is pure flash risk with no benefit.
`html` also picked up `scroll-behavior: smooth` (reduced-motion-aware)
for the "scrolling effects" ask.

**Micro-interactions / consistency sweep**: `.sk-btn` gets a subtle
`-1px` hover lift (press still overrides it, same cascade order as
before); `ProgressBar`'s fill now transitions `width` instead of
snapping to a new value; `.sk-checkbox`'s check mark pops in instead of
appearing instantly; the sidebar mode picker's menu items got the
`transition-colors` its sibling `MenuItem` already had. Tooltips were
explicitly checked for, not assumed absent: the codebase only uses
native `title=` attributes (browser-chrome rendered, nothing to animate)
and Chart.js's own built-in tooltip plugin (animates itself) -- no
custom tooltip surface exists to add motion to.

**Reduced motion**: every new class above is covered in the existing
`prefers-reduced-motion: reduce` block, extended rather than
duplicated. Two different failure modes were deliberately avoided, not
just "turned off everything": a mount/unmount overlay (`.sk-overlay-anim`
etc.) just gets `transition: none` -- its visibility is driven by
`useMountTransition`'s own JS state machine, which always completes on
its own timer regardless of motion settings, so nothing gets stuck. A
scroll reveal is different -- `useReveal()`'s visibility depends on an
*external* signal (the user scrolling, or an observer callback that may
never fire for someone who never scrolls that far), so `.sk-reveal`
additionally forces `opacity:1; transform:none` unconditionally under
reduced motion, rather than relying on the observer at all; content can
never be stuck invisible waiting for a scroll that doesn't happen.
`useMountTransition`'s exit duration itself also drops to 0 under
reduced motion (checked live, not cached), so a reduced-motion user
never waits through an exit-transition delay that isn't visually
animating anyway.

**Verified**: two new Playwright scripts, both passing in full.
`test_motion_landing.mjs` (no auth) covers the public surface: a reveal
section already on screen at mount shows visible immediately (the
flash-fix, confirmed both by proving the bug first at 390×844 viewport
height and then proving the fix); a footer below the fold starts hidden
and reveals once scrolled into view (this one needed its own fix along
the way -- `scrollIntoView` now animates over ~900ms because of the new
`scroll-behavior: smooth`, so a test that scrolls and checks immediately
needs to wait past that animation, not just past the reveal transition --
confirmed by instrumenting scrollY over time rather than guessing);
the mobile menu modal reaches `entered`, survives one tick as `exiting`
instead of vanishing the instant it's told to close, then fully
unmounts; and a `reducedMotion:'reduce'` context confirms reveal content
is visible without scrolling and `.sk-btn`'s transition is actually
disabled. `test_motion_app.mjs` (authenticated, mocked Supabase + a
stateful `post_likes` mock so a like genuinely round-trips) covers the
UserMenu dropdown's same entered/exiting/unmounted sequence on Escape,
the locale-fade class appearing on `Shell`'s root on a language switch
and clearing itself after, a route change rendering inside the keyed
`.sk-page-enter` wrapper, the post stagger class, the comment thread and
lightbox both reaching `entered`, and the like icon popping within its
320ms window (an early draft checked at 400ms, after the pop had
already finished animating out -- caught by polling aria-pressed and the
pop class together over 800ms rather than guessing a single timeout, the
same discipline as the scroll-timing fix). Both scripts also assert zero
console/page errors across their full flows. Screenshotted the landing
page before and after a scroll to confirm nothing visually broke. Full
45-script regression suite re-run: 44 clean, the one pre-existing
documented `test_loading_upgrade.mjs` flake (stuck loading on
`/app/reports` and an experiment's `/results` page -- neither touched by
this round) -- not a new regression, checked directly rather than
assumed.

## Favorites + Friends ✅

Two full features: a private saved-posts list, and a complete friend
system (request/accept/decline/cancel/remove, a dedicated page, counts,
notifications) -- built on the existing posts/notifications architecture
rather than alongside it.

**Favorites turned out to be mostly already there.** `post_saves`
(migration 0014) already existed -- private by default (`select` scoped
to `user_id = auth.uid()`, unlike `post_likes`' `using (true)`), already
prevents duplicates (`unique(post_id, user_id)`), already animated (the
bookmark icon already pops via `.sk-icon-pop` from the animation round).
What was actually missing was a page to *look at* what you'd saved.
`postsStore.js` gained `fetchSavedPosts()`, reusing the same private
`mapPost()`/`fetchAuthorsById()`/`fetchViewerPostIds()` helpers
`fetchPosts()` itself uses (saved-post order is reapplied client-side
after the `.in()` lookup, since Postgres doesn't preserve it); a new
`favoritesStore.js` mirrors `postsStore.js`'s own reactive-cache shape
exactly. `Favorites.js` reuses `PostCard` directly (now exported from
`Feed.js`) -- same likes/comments, same author popover, same delete flow
for a post you own. Unsaving a card is already covered for free: the
bookmark button that saved it is the same button that un-saves it, and
toggling it off makes the card disappear from this list the moment
`favoritesStore` reloads. `toggleSave()` (postInteractions.js) now
invalidates both `postsStore` and `favoritesStore` regardless of which
page the toggle happened on; `deletePost()`'s two call sites (Feed,
Favorites) do the same, so a post deleted from one page can't linger in
the other's cache.

**Friends is new, and needed real database design.** `friendships`
(migration 0017) is one row per *pair* of users, not per direction:
`user_min`/`user_max` are generated columns (`least()`/`greatest()` of
`requester_id`/`addressee_id`), with a unique constraint on that pair --
so there can never be two contradictory rows between the same two people
(A→B pending *and* B→A pending at once), enforced by Postgres itself, not
just application logic. Three operations needed more validation than a
column-ownership RLS check can express, so -- the same split this schema
already uses for `add_member_by_email` (0006) and the owner-lock fix
(0016) -- they're `SECURITY DEFINER` functions instead of raw table
access:
- `send_friend_request` also has to notice "they already requested ME"
  and accept instead of inserting a second row (the DB wouldn't allow a
  second row for the pair anyway -- the unique constraint would reject
  it -- this is what makes the correct thing happen instead of an error).
- `accept_friend_request` is the one UPDATE this table ever needs, and
  deliberately has **no RLS UPDATE policy backing it** -- a raw
  `with check` can constrain the new row's shape but can't stop a caller
  from also smuggling a different `requester_id` into the same
  statement, the identical class of gap 0016 closed on
  `organization_members`. The function's `WHERE` clause
  (`id = p_friendship_id and addressee_id = me and status = 'pending'`)
  and its hardcoded `SET` (`status = 'accepted'` only) aren't
  caller-influenceable at all, which closes it by construction rather
  than by a cleverer policy.
- `friends_count` is `SECURITY DEFINER` so a count can show on *anyone's*
  profile (PublicProfile, the author popover) without widening
  `friendships`' own `select` policy to "anyone can read anyone's rows",
  which would leak who has a pending request out to a third party.
  Declining, cancelling, and removing don't need a function at all --
  all three are the same operation underneath (delete a row you're a
  party to), and a plain `using (requester_id = auth.uid() or
  addressee_id = auth.uid())` delete policy is already a complete,
  correct boundary for that.

**`notifications` (0014) generalized rather than growing a second
pipeline.** `post_id`/`comment_id` went nullable, a `type` column
(`comment` | `friend_request` | `friend_accept`) was added, and the
existing insert policy narrowed to `type = 'comment'` explicitly --
friend-type rows are only ever inserted by the two functions above
(`SECURITY DEFINER`, bypassing RLS internally but re-validating the real
authorization themselves), never by a direct client insert, so the
policy itself doesn't need to learn how to validate a friendship's
shape too. Everything built for comment notifications in the earlier
round -- realtime delivery, the sound, the OS push, the bell-ring
animation, mark-as-read -- now carries friend events for free.
`notificationsStore.js` gained `notificationCopyKey()`/
`notificationTargetPath()` (one translation key and one click-destination
per type, shared between the in-app bell and the OS popup so they can
never disagree), and cross-invalidates `friendsStore` when a live
friend-type notification arrives -- there's no separate realtime
subscription on `friendships` itself; this is what keeps an already-open
Friends page or FriendButton from going stale when something happens
elsewhere.

**FriendButton is one component with four states** (Add Friend / Request
Sent / Accept Request / Friends), driven by `useFriendStatus()` --
derived client-side from the same data `useFriends()` already loaded, no
per-button fetch. Renders nothing for your own profile (`status ===
"self"`) *and* nothing for a signed-out visitor (`status ===
"signed_out"`, distinct from `"none"`) -- a public `/u/:username` page is
reachable by anyone, and a button that would just fail server-side on
click is worse than no button. The "Friends" state needs its own confirm
step before it actually removes anyone: hover alone can't guard that on
a touch device, so the first click/tap relabels the button to "Remove
friend?" for a few seconds (or until the pointer leaves, on desktop); a
second click in that window is what actually removes. Every real status
change replays `.sk-btn-state-pop`, the same single-pop convention
`.sk-icon-pop` already established for the like/save buttons.

**`AuthorCard`**, a new shared component, is Feed.js's `viewingAuthor`
popover extracted and given a `FriendButton` row -- the same popover Feed
already used to show who commented or posted, now reused by Favorites.js
(same post/comment author shape) and Friends.js (friendship rows adapted
into the same `authorId`/`authorName`/... shape at the call site, so
`AuthorCard` itself only ever learns one field convention). This is the
same popover, not a new one, so "Add Friend button on user profiles"
reaches every place a profile was already viewable -- a post's author, a
comment's author, a friend-list row -- in one component change, plus
`PublicProfile.js` (the external `/u/:username` page) and `Profile.js`
(a friends-count link to `/app/friends`) directly.

**Friends.js**: incoming requests (Accept / Decline) and outgoing
requests (Cancel) only render when non-empty; the accepted-friends list
always renders, with the exact empty state asked for
("You don't have any friends yet..."). Each row's avatar/name opens the
same `AuthorCard` popover. The sidebar's Friends nav item carries a
live badge of the incoming-request count, the same red-dot/number
convention the notification bell already uses.

**A genuine staleness bug was caught and fixed before it shipped, not
assumed away.** `useFriends()`'s first draft copied `postsStore`'s
load-once-then-rely-on-invalidation pattern exactly -- fine for posts and
notifications, which only ever render inside the authenticated `Shell`,
but `FriendButton` is reachable from `/u/:username`, which an anonymous
visitor can land on. An anonymous visitor's empty load would permanently
stick if the SAME tab later signed in (the `!state.loaded` guard never
fires again). Fixed by borrowing `profile.js`'s own, more robust
pattern instead -- a `loadedForUserId` tracked against the live session,
reloading whenever they disagree (covers anonymous→signed-in *and* a
same-tab account switch), gated on `useSession()`'s own `loading` flag so
it doesn't fire a premature "signed out" load during an authenticated
page's brief hydration window.

**Verified**: two new Playwright scripts, 24 checks total, all passing.
`test_favorites_friends.mjs` (stateful mocks -- the `post_saves` and
`friendships` mock tables actually track inserts/deletes/RPC calls across
the flow, not static fixtures) covers: Favorites shows a saved post via
the real `PostCard` and unsaving removes it from the list; sending a
request from the Feed's author popover flips the button to "Request
Sent" with the real RPC call captured and its `target_id` checked;
cancelling flips it back to "Add Friend"; an incoming request shows on
the Friends page with a working Accept button that calls
`accept_friend_request` with the right id and moves the row into the
friends list. `test_friends_edge_cases.mjs` covers self-block (opening
your own post's author popover shows your own name but *no* friend
button at all -- confirmed by reading the actual popover HTML, not
guessed), zero horizontal overflow for Friends/Favorites at phone width,
and that `prefers-reduced-motion` actually disables the state-pop
animation (not just assumed from the stylesheet). One test bug surfaced
and was fixed along the way, not worked around: a mid-test mock mutation
followed by only a hash-navigation (not a real reload) doesn't reach an
already-loaded reactive store -- correct, existing behavior, not
something to patch around -- so the test now does a hard reload at that
point, matching how a real revisit would actually pick up new data.
Locale parity re-verified (722 keys × 3 locales, exact match) after
~30 new `favorites.*`/`friends.*`/`shell.*` keys. Full regression suite
(49 scripts, migration 0017 added) re-run: 47/49 clean on the first pass.
The 2 failures were both triaged, not waved through: `test_loading_upgrade.mjs`
hit the same 2 pre-existing `stillLoading=true` cases already on record from
before this feature (an experiment's `/results` page and `/app/reports`,
45/47 checks -- unrelated to Favorites/Friends, confirmed by reading its
log and comparing against the known baseline); `test_nav_experiments_results_removed.mjs`
failed on a stale hardcoded assertion ("exactly 9 nav items") written before
this feature existed -- updated to 11 (the correct count now that Favorites
and Friends are real nav items) and re-run clean, 14/14. Final state: 49/49
accounted for, 2 pre-existing/unrelated, 0 caused by this change.

**Not yet live**: migration 0017 is written and committed but, like
every migration this session, hasn't been applied to the real Supabase
project from here -- this sandbox has no `SUPABASE_ACCESS_TOKEN`/
`SUPABASE_PROJECT_REF`. Favorites and Friends are fully built and tested
against a faithful mock of the schema this migration creates, but
neither will work against the live backend (`friendships` doesn't exist
yet, `notifications` doesn't have a `type` column yet) until someone
with Supabase credentials runs `npx supabase db push` -- flagged
explicitly, the same as every other migration this session.

## Real-time everywhere + messenger (migration 0018)

**Live updates** (no refresh needed): friend request accepted/declined/removed
(`friendsStore` -> toast "X accepted your request"), the feed (posts, likes,
comments), the Participants/Overview session lists, and the Results page
(sessions + responses, with a pulsing **Live** badge; charts update in place
instead of being rebuilt). All of it rides one helper, `lib/realtime.js`
(`watchTables` + `debounce`): every event just triggers a quiet, RLS-scoped
refetch, so DELETE events (which carry only a primary key) are handled too.

**Messenger** (`pages/Messages.js`, `lib/messagesStore.js`, route
`/app/messages`): 1:1 chat between accepted friends -- instant delivery,
optimistic send with retry, ✓ sent / ✓✓ read receipts, "typing…", online
dot, unread badges (list + sidebar), sound/toast/OS notification for
incoming messages, day separators, older-history paging, emoji picker,
mobile list/chat layout. "Написать" button on the Friends page.

Server side (`0018_realtime_and_messaging.sql`): `conversations` +
`messages` with RLS; a conversation can only be created between accepted
friends and messages can only be sent while still friends (history stays
readable); `read_at` is written only by `mark_conversation_read()`; no
UPDATE policy, so nobody can edit a message or forge a receipt. It also
adds notifications/friendships/posts/post_likes/post_comments/
participant_sessions/responses/conversations/messages to the
`supabase_realtime` publication. Idempotent.

**Verified**: migration run twice on a local PostgreSQL 16 against the real
0001-0017 schema (Supabase auth/roles stubbed): friend gating, RLS
visibility, forged sender/read_at rejected, no direct UPDATE/DELETE,
unread counts, read marking, post-unfriend behaviour, anon blocked. UI
smoke-tested in headless Chromium against a stubbed Supabase client (27
checks: send/receive/retry, ticks, typing, presence, toasts, badges,
friend-accepted toast, mobile layout) with zero JS errors.

**Not yet live**: apply 0018 in the SQL Editor, then
`notify pgrst, 'reload schema';`.

**Known trade-offs**: online status uses one shared Presence channel and
the typing signal a per-conversation Broadcast channel -- both public
channels (no message text travels on them; text only flows through the
RLS-protected table). Supabase "Realtime Authorization" private channels
would harden this later. No new Tailwind utilities were used (the bundle
is prebuilt); chat styles are plain CSS in `styles.css`.

## Landing page redesign (dark / glass / violet glow) + PNG logo ✅

The public landing (`#/`) was rebuilt from the approved "DecisionOS Landing Page" Design artifact:
sticky glass header with a sliding RU/KZ/EN pill, hero with a 3D-tilted dashboard preview whose variant cards are
clickable (share chart, metrics and interpretation follow the selected variant), a 5-card bento "From stimulus to
decision" with a hover micro-interaction per card, a "Honest by design" row (30-response guard, Wilson 95% intervals,
predictions-not-certainty, no biometrics), a mobile showcase, final CTA and the honest "what it can / can't do"
footer. Copy is `landing.*` in `locales/{ru,kk,en}.js` (the old `landing.report.*` / `heroTitle` keys are gone with
the sections they fed; key sets are identical across the three files).

- **No build step, so no new Tailwind utilities**: all styling is `landing.css` -- every class `lp-` prefixed and
  scoped under `.lp-root` (it is generated from the artifact's stylesheet, see the header comment), so it cannot leak
  into the app. Fonts: Inter is vendored (`vendor/fonts/`, woff2 subsets latin / cyrillic / cyrillic-ext, SIL OFL)
  under the family name "Inter Landing", used only on the landing, so the rest of the app's typography is unchanged.
- **Logo is PNG now**: `assets/logo/` (mark 1024/256, dark + light lockups, 32/192/180 icons). `index.html` uses PNG
  favicons + apple-touch-icon; sidebar, auth pages, onboarding and the public profile use `<LogoMark/>` (icons.js).
  The old animated SVG `<Logo/>` was removed with the loading-screen redesign below. `favicon.svg` is no longer
  linked (left in place).
- **Phone mockups** are real screenshots of the app (demo data) in a device frame, one set per UI language:
  `assets/landing/phone-{participant,builder,report,chat}.{ru,kk,en}.webp`; pack photos `pack-{a..d}.jpg`.
- `LanguageSwitch` got a `variant="glass"` (same `choose()` logic: local immediately, profile persisted when signed in).
- Landing header on phones: mark-only logo, the CTA shortens to "Start / Начать / Бастау" (`landing.createShort`), and
  the "Log in" link is hidden to fit 360px -- login stays reachable from the register page and the final CTA block.

**Verified** in headless Chromium against the real app (Supabase stubbed): 1440 / 1024 / 768 / 390 px in ru, kk and en --
no horizontal overflow, no untranslated keys, no broken images, no console errors; language pill + copy switch,
variant selection, sticky header, scroll buttons, /login and /register routing, PNG logo in the shell and auth pages
(20 checks). First-load landing-specific weight ~270 KB (fonts 65-90 KB depending on locale, logos 90 KB, 4 pack
photos 87 KB); phone images lazy-load (~85 KB each, 4 per locale).

**Shipped in the same push (not part of the landing)**
- Org invite emails: `supabase/functions/invite-member` + `lib/org.js` fallback + Team/Onboarding toasts. When the
  email has no account yet, the function (service role, after checking the caller is an owner/admin of the org through
  an RLS-gated read) sends the Supabase invite and then inserts the `organization_members` row itself. An earlier
  draft carried org + role in the invite's `user_metadata` and read it back in the `handle_new_user()` trigger -- that
  was dropped before shipping: `user_metadata` can be set by anyone calling the public signup endpoint, so it would
  have let a stranger seat themselves in any org whose id they knew. **Not deployed or tested against a live
  project**: needs `supabase functions deploy invite-member` (no migration involved).
- Objective-based question suggestions (`lib/questionSuggestions.js`, builder step 4): plain keyword matching, not
  AI, and labelled as such. The amber ring/hint first used Tailwind utilities missing from the prebuilt CSS; now plain
  classes in `styles.css` (`.sk-suggested`, `.sk-suggest-hint`, `.sk-suggest-badge`).
- Messages: see the `0020` section at the end of this file (image attachments + reply-to, database side only so far).

## Loading screen redesign + loading animations everywhere ✅

Designed first in the "DecisionOS Loading States" Design artifact (boot screen on desktop and phone, a kit of every
loading state, and a dashboard that goes from loading to loaded), then ported. One visual language for every
"something is loading" moment: violet/indigo light on the app's dark slate, the PNG logo tile, and compositor-only
animation (transform/opacity) wherever possible.

- **Boot screen** -- `index.html`'s static pre-boot placeholder and `<BootScreen/>` (`components/ui.js`, used by
  `<FullScreenLoading/>` in `App.js`): space-blue ground with a faint grid, a breathing violet aura, the logo tile
  floating inside a comet ring (dashed outer ring with two orbiting points), the wordmark, an indeterminate hairline
  track and an animated-dots label. The label follows the real boot phase: pre-boot "Загрузка" in the visitor's own
  language (a tiny inline script mirrors `lib/i18n.js`: saved choice, then browser language, then ru), then
  "Проверяем вход…" while the session is checked, then "Открываем рабочее пространство…" while the organisation
  loads (`common.bootSession` / `common.bootWorkspace`, ru/kk/en).
  - The pre-boot markup and the Preact component are the same DOM and Preact adopts the nodes already on screen, so
    the animation carries on through the mount with no visible swap. That only holds if there are **no whitespace or
    comment nodes between the tags inside `#app` in `index.html`**: Preact re-inserts an adopted node that is not the
    first child of its parent, and a re-inserted element restarts its CSS animations. The markup there is written
    with each `>` glued onto the next line for exactly that reason -- keep it that way.
- **`Spinner`**: a comet-tail arc (conic gradient cut into a ring with a mask; thickness 2 / 2.5 / 3 px by size)
  instead of two quarter borders. **`Skeleton`**: a violet sweep, a slight breathing pulse, and sibling blocks start in
  a staggered wave (`:nth-child` delays, no per-call-site work). **`LoadingState`**: the logo in a turning ring plus a
  label (`compact`: spinner beside the label; `mark={false}`: a plain glowing core, used by the public participant
  loader). New: `LoadingLabel`/`Dots` (a trailing "…" in any loading label is drawn as three rising dots) and
  `GeneratingState` (AI summary: pulsing spark, a label with a light sweep, ghost lines of the paragraph to come).
- **`Button loading`**: spinner before the label and a sheen over the face, `aria-busy`, no clicks -- and it does not
  look disabled. Wired into the buttons that used to only swap their label: login, register, forgot/reset password,
  onboarding, profile (4), organisation settings, team invite, builder (continue / save and exit / publish), feed
  composer and comments, the participant retry button.
- **Top loading bar**: `<LoadingBar/>` in the shell lights a thin violet bar along the top edge while any `Skeleton`,
  `Spinner` or `LoadingState` is mounted (a tiny ref-count in `lib/loadingBar.js`, so no per-fetch bookkeeping).
  Debounced both ways: a load that settles in a blink never flashes it, and it fades out afterwards.
- Plain "…" placeholders became animated: the Feed comment loader, Messages' "older messages" and "opening chat",
  the Profile counters, the sidebar name/organisation lines.
- **`prefers-reduced-motion`**: nothing slides, floats or sweeps; spinners keep turning, slowly (3 s a turn), and the
  indeterminate bars become a gentle pulse.
- The old animated SVG `<Logo/>` and its `.sk-logo*` CSS are gone (the PNG mark is used everywhere). Loading CSS lives
  in one block of `styles.css` ("Loading system"); no new Tailwind utilities were needed.

**Verified** in headless Chromium: the pre-boot at 1440x900 and 390x844; the hand-off to the app in ru, kk and en
(adopted root and logo nodes, the arc's animation clock keeps counting through the mount, label switches to the
workspace phase); a component gallery in isolation (spinner sizes, busy-vs-disabled buttons, orbit/compact/AI states,
skeleton wave, bar on and off, reduced-motion computed styles -- 23 checks); real-app flows (the login button while a
slow request is in flight and after it fails, skeletons plus the bar on the overview page at desktop and phone width,
clean settle, no overflow, no console errors -- 11 checks); the landing still mounts over the new pre-boot with no
leftovers; and the older loading regression script (45/47 -- the same two results/reports cases already failed in its
log from before this change; they come from that script's mock data, not from the loaders).

## Messages, step 1: image attachments + reply-to (database side) ✅ (migration 0020, not applied to a live project yet)

`supabase/migrations/0020_message_attachments.sql` extends `messages`: `attachment_path`, `reply_to_id` (the quoted
message; nulled, not cascaded, if the original is deleted), a check that a message has text or an image (never
neither) and keeps the 4000-char cap, `conversations.last_message_has_attachment` so the chat list can say "Photo"
for an image-only message, and a private `message-images` storage bucket.

- Storage path: `<conversation_id>/<uploader_id>/<random>.<ext>`. Read: either participant. Upload and delete: only
  into/from your own folder of a conversation you are in -- so nobody can add to, or remove, the other person's files.
  The folder is compared as text, never cast to uuid (a cast on an arbitrary path segment can throw before the other
  conditions say "no").
- A trigger rejects an `attachment_path` that is not `<this conversation>/<this sender>/<one file>`, so a message can't
  point at another conversation's image or an arbitrary storage key; a reply must quote a message of the same
  conversation. That check is a `SECURITY DEFINER` helper (`message_in_conversation`, executable by `authenticated`
  only): written as a subquery on `messages` inside the policy on `messages` it fails with "infinite recursion
  detected in policy".
- Still no UPDATE or DELETE path for clients on `messages`; read receipts and realtime are untouched.

**Verified** on a local PostgreSQL 16 against the real 0001-0018 schema (Supabase `auth`/roles/storage stubbed): the
migration applies cleanly and a second time (idempotent); 47 checks -- text, image-only, empty/whitespace/oversized
rejected, attachment paths from another conversation / another user / nested / arbitrary / over-long rejected,
same-conversation, cross-conversation and non-existent replies, forged sender, stranger, no edit or delete,
`anon` cannot call the helper, deleting a quoted message keeps the reply, deleting a conversation cascades, the
preview flag on and off, and the storage matrix (member / other member / stranger / other conversation, upload,
read, delete, flat and non-uuid paths refused). Only the database side exists: **the client (upload, signed URLs,
reply UI) is not written yet**, so nothing in the app uses these columns.

**To go live**: apply `0020` (SQL editor or `supabase db push`), then `notify pgrst, 'reload schema';`.

## "Instrument" design language: graphite + one signal colour, tactile controls ✅ (supersedes the violet / glass look above)

Why: the navy + indigo/violet look (glow fields, gradient text, glass panels) read as an AI-template page. The brief was
"make it look like one senior designer + engineer built it", skeuomorphism **and** minimalism together, a better
"свернуть" (collapse) button, and an honest answer on whether violet suits. The answer is no -- violet is the 2023-25
default of AI products and sits at 4.0:1 on the graphite plates; the product now uses **signal orange on graphite**
(see the colour study in the Design artifact; swapping colour is one token, below).

**The rules** (also on the first board of the artifact): one signal colour, used only for the primary action and "on"
states; depth only on what you touch (keys, switches, segmented controls, inputs) while content plates stay flat;
one light source from above (1px highlight on every upper edge, soft shadow underneath); numbers in mono; no
gradient text, no neon, no glow fields -- light lives in LEDs.

- **Tokens.** `tailwind.config.js` has the palettes `graphite` (neutrals), `signal` (orange) and `steel` (muted blue,
  used for "completed" and the 2nd chart series); `src/**/*.js` was renamed mechanically `slate-`->`graphite-`,
  `indigo-`->`signal-`. `styles.css` -> "INSTRUMENT SYSTEM": `:root` tokens (`--g-*`, `--signal*`, `--lit*`, `--plate`,
  `--well`, `--key*`, `--sh-*`, status `--led-*`) and the materials: `.sk-panel` (plate), `.sk-display` (well),
  `.sk-btn` (key) / `.sk-btn-primary` (the lit key: dark legend on orange; a disabled key is simply not lit) /
  `.sk-btn-danger`, `.sk-input` (+ our own select chevron; width is `:where()`-zero-specificity so `w-auto` / `w-36`
  finally work -- they used to lose to `w-full`), `.sk-tabs` (segmented; `data-compact` drops the LED), `.sk-switch`,
  `.sk-checkbox`, `.sk-badge` + `.sk-led` (status LEDs), `.sk-count`, `.sk-avatar`, `.sk-tile`, `.sk-kbd`, `.sk-caption`
  (engraved caption), `.sk-num` / `.sk-stat-*` / `.sk-unit` (mono readouts). Pure CSS, no raster textures. Fonts are
  vendored: Inter (`@font-face` now declared -- it used to rely on a locally installed Inter) and JetBrains Mono 500
  (latin + both Cyrillic subsets, ~28 KB, so Russian/Kazakh text never falls back mid-word).
- **To change the colour**: edit `--signal`, `--signal-hi`, `--lit`/`--lit-hover`/`--lit-down`, `--signal-ink` (the legend
  colour on a lit key) and the `signal` ramp in `tailwind.config.js` (then rebuild Tailwind). Nothing else.
- **Sidebar.** `CollapseKey` in `components/shell.js`: a labelled key ("Свернуть" + a `[` keycap) at the foot of the
  sidebar, a square `»` key on the rail (tooltip "Развернуть  ["), "Закрепить" in expand-on-hover mode. `[` toggles it
  from the keyboard (physical `BracketLeft`, so it works on a Russian/Kazakh layout, ignored while typing),
  `aria-keyshortcuts="["`. The three modes moved into the user menu ("Боковая панель" section, LED on the active one).
  Active nav item = a pressed-in well with an orange strip on its edge; hover is a plain 10% white veil.
- **Dashboard & pages.** KPI row is one plate with hairline dividers (`StatTile` + `.sk-stat-strip`), `Readout` renders
  digits in mono and units ("мин", "с") small in the text face; flat charts (`components/charts.js`: orange line with a
  fading area, thin donut with a centre readout and an HTML legend, bars fall back to the series palette when a
  variant has no colour -- the column is nullable and the builder never sets it, which used to paint black bars).
  Reports preview, Insights (AI blocks no longer teal: one signal colour), participant runner (progress as an inset
  slot with lit segments), chat (my bubbles are a raised graphite key, "read" ticks and the send key carry the orange),
  builder stepper (all 7 steps fit), page-header actions wrap on phones.
- **i18n fixes found on the way**: durations ("2 мин 44 с" / "2 min 44 s"), relative dates and short dates followed Russian
  regardless of the UI language; the confidence-interval label was hard-coded "ДИ"/"CI". Now `common.unitMin/unitSec/
  today/yesterday/daysAgo/monthsAgo/yearsAgo/ci` in ru/kk/en; the chart's day labels follow the app language.
- **Loading system** retinted and quietened: the boot screen is a device powering on (the mark with its LED breathing
  -- a halo laid over the dot at 49.3% / 74.7% of the tile -- the wordmark, a lit bead travelling in an inset slot, a
  caption); no aura, rings or comet. Spinner / loading bar / AI orb are orange, skeletons a neutral sweep, the spinner on
  a lit key is dark. `index.html` pre-boot markup and `<BootScreen/>` stay identical (no whitespace in `#app`).
  `theme-color` is `#0e0e10`.
- **Brand.** New mark: a graphite key tile (gradient, 1px top light, dark keyline) carrying the three converging paths
  (graphite-600 / 400 / white) and one lit orange point -- the decision. PNG only: `assets/logo/` (mark 1024/256,
  dark + light lockups, 192 / 180 (full-bleed, for iOS) / 32 (heavier glyph for small sizes)). `favicon.svg` (violet)
  was deleted; desktop notifications use `icon-192.png`.
- **Landing** (`landing.css` rewritten, `Landing.js` trimmed): the same graphite/orange system -- flat plates, the
  language switch as a raised key sliding in a well, lit-key CTAs, the dashboard preview as an instrument panel
  (variants are keys; the chosen one is pressed in with a lit edge; no 3D tilt, no glow blobs, no gradient text),
  headline = muted lead + white punch (orange stays on the action). Fixed on the way: `.lp-root a { color: inherit }` beat
  the key classes, so the lit key's legend was white on orange (2.9:1) -- it is `:where(a)` now (6.6:1).
  The 12 phone mockups (`assets/landing/phone-{participant,builder,report,chat}.{ru,kk,en}.webp`) were re-shot from
  the new UI in a neutral titanium frame (the report one is now the real Reports page with a 248-response sample).
- **Design artifact**: "DecisionOS Instrument" (https://claude.ai/artifact/RBr7H69z4HssgSgFfBTFWh) -- language, controls
  kit with all states, the collapse-key study (old / chosen / edge handle / rail), the dashboard, the colour study
  (orange vs blue vs the old violet, same UI, computed contrast and hue collisions) and brand + boot.

**Verified** in headless Chromium against a realistic mock backend: every app route at 1440x900 and 390x844 (plus the
collapsed rail and the hover-peek), auth pages logged out, menus / modal / notifications, the landing at 7 widths
(no horizontal overflow), in ru / kk / en. Regression suite: the sidebar tests were updated for the collapse key and
the user-menu modes, selectors for the renamed classes (`text-slate-*` -> `text-graphite-*`, the bell dot is a
`.sk-led`), the favicon test now checks the PNG icons, the loader test the new boot screen, and the landing tests
(old hamburger header, old animated SVG logo -- already stale since the previous landing redesign) were replaced by
`test_landing_instrument.mjs` (24 checks: no gradient text / blur / violet, lit-key legend colour, no overflow at 7
widths, phone header, sliding language key, preview interaction, scroll-reveal, every image loads, reduced motion).
Two cases of `test_loading_upgrade.mjs` (results / reports "loading UI clears") still fail exactly as they did before
this work -- they come from that script's mock data.

---

## Arena -- design duels that keep people on the site for hours (migration 0021)

Goal of this pass: give people a reason to stay 3-4 hours instead of 5 minutes, and make that measurable.
**Arena** (sidebar -> Community -> Arena, `#/app/arena`) is a game built on what the product is about -- judging designs:
two specimens side by side, one question ("Which looks more premium?"), pick one.

**The loop.** Rounds of 10 duels; specimens are procedurally drawn SVGs of 7 families (logo marks, brand colour
cards, CTA buttons, UI cards, packaging, ad/type posters, app icons), questions are the experiment builder's own
dimensions (Preference, Attention, Trust, Quality, Premium, Clarity, Purchase intention), so researchers and players share
one vocabulary. Keys: `1`/`2` or arrows to pick, `Space`/`Enter` to continue, `S` to skip; auto-advance after the reveal is
a switch (default on, 2.6 s, shown as a countdown on the Next key). The reveal shows the community split when there is one
(the specimen's record over all its duels otherwise), XP, the combo bonus, an instant insight about the pick ("You went for
the warm one") and, for eye tests, the measured contrast of each side.

**What keeps people playing** (all real, nothing fabricated):
- XP = 10 per vote + up to +10 flow bonus (consecutive answers faster than 12 s and slower than 0.6 s) + 5 for the first vote
  ever on a duel; levels cost `50*L*(L-1)` XP (L2 = 100, L10 = 4 500), 8 ranks (Novice ... Maestro).
- Daily streak (local day), 3 quests a day (one easy / medium / hard, never two of a kind, e.g. "Spend 60 minutes in the
  Arena") + a clear bonus, 23 badges incl. 1 h and 3 h in a single day.
- **Daily challenge**: the same 10 duels for everybody on a given day (+100 XP). Because everyone answers the same pairs the
  community numbers fill in fast even with few players; afterwards a report shows how everyone answered and **who thinks
  like you** (agreement on the shared duels, friends flagged).
- **Eye tests**: some questions ("Which text is easier to read?") have a measurable right answer (WCAG contrast x size);
  a pair is only dealt when one side clearly wins, so feedback is never a judgement call.
- **Taste DNA**: seven trait axes (cool-warm, delicate-bold, sharp-round, dense-airy, muted-vivid, minimal-rich,
  light-dark), measured on every specimen; the player's lean on each axis (overall and per question), nine taste types,
  a one-line standout insight, "Share to Feed".
- Rankings (week / all time, everyone / friends, opt-out switch), a "Top this week" preview in the lobby, a dashboard card
  and an attention badge on the sidebar item once someone has played.
- **Seasons**: a season is a UTC month and re-seeds every pool, so the Arena never runs out of fresh specimens.

**Measuring the goal.** Active time (page visible, input within 20 s) is counted per day in 30 s slices and synced; the
Profile tab shows today / last 7 days / best day, and admins get an "Arena usage" panel in Rankings (players per day, avg
minutes, players over 1 h and over 3 h) from `arena_admin_stats()`.

**Architecture.**
- `src/lib/arena/` -- `catalog.js` (vocabulary), `stimuli.js` + `families/*.js` (specimen generators, pure functions of
  `(season, family, index)`; a throwing builder falls back to a neutral tile), `sampler.js` (round planner, daily set, eye-test
  pair finder), `rules.js` (XP / levels / quests / badges / streaks), `progress.js` (state = confirmed base + pending events,
  `fold`), `ledger.js` (every answered duel as one integer), `dna.js`, `traits.js`, `color.js`, `palettes.js`.
- `src/lib/arenaStore.js` -- local-first: everything is applied on screen and written to localStorage at once; votes, time slices
  and claims queue and sync in the background (UUID-keyed, so a retry never double-counts). Without migration 0021 (or offline)
  it keeps working from the device and catches up on the next visit. Flushes and state refreshes never overlap.
- `src/pages/Arena.js` + `src/pages/arena/{Play,Quests,Rankings,Profile,DailyReport,parts}.js`, `arena.css`. The page and the
  generators are a lazy chunk (`lib/lazyPage.js`): the dashboard only loads `arenaStore.js` (progress without network).
- **Database** `supabase/migrations/0021_arena.sql` (apply with `supabase db push`): `arena_votes` (private, one row per
  player/duel/question), `arena_stim` (per-specimen win/loss), `arena_profiles`, `arena_daily`, `arena_slices`,
  `arena_quest_defs`; RLS on, no direct access except reading your own totals; everything goes through SECURITY DEFINER
  functions `arena_state / arena_tallies / arena_submit / arena_claim / arena_my_votes / arena_leaderboard /
  arena_set_visibility / arena_daily_report / arena_admin_stats` which re-derive XP, streaks, quest claims and badges
  (the browser cannot forge the ranking). Eye accuracy is the one stat taken on trust (it is private and not ranked).

**Verified.** PostgreSQL 16 (local harness): 104 SQL assertions (idempotent retries, duplicate duels, XP rules, validation,
crowd match, streak gaps / back-dating / clamping, time slices, quest slate + claims, badges, tallies, paging, rankings,
friends filter, privacy, daily report, admin gate, closed tables, daily cap); JS rules vs SQL functions 1 598 comparisons,
0 mismatches. Headless Chromium with the arena RPCs wired to the real database: 80 checks (full round by keyboard, Esc to
leave, reload persistence, DB mirror, daily challenge + claim + report + twins, quests, offline and "migration not applied"
recovery, profile / DNA / badges / share, rankings and privacy, lobby board, phone layout, ru / kk / en, time tracking,
reduced motion, dashboard card, lazy loading), 0 failures. Specimens: all 7 families x 32 x 12 seasons built without
NaN / forbidden elements / unprefixed ids, deterministic, ~0.15-0.45 ms and 2.7-8.5 KB each; every pool of 48 consecutive
seasons spreads the seven traits (min <= -0.5, max >= +0.5, sd >= 0.3, a handful of near misses on `bold`); the four text
families (palette, button, card, poster) deal exactly 25 % poor (< 3.2:1) / 50 % middling / 25 % excellent (> 9:1) contrast,
which gives 255-337 eye-test pairs per pool, and all text of a banner follows the label's class so "which text is easier to
read" has one answer whichever line a player looks at. The nav-count regression test now expects 13 items (the Arena is one);
the rest of the regression suite passes, `test_loading_upgrade.mjs` keeps its two pre-existing failures.

**Not done / next.** Researchers opting real experiments into the Arena (a community-votes card in Results), sound, friend
challenges, a hall of fame per season.

## Arena becomes the home of the app; sidebar clean-up; jury script

- **Home is `/app/arena`** (`HOME_PATH` in `src/router.js`): the logo, a signed-in visit to `/login`, the end of onboarding,
  the password-reset success button, auth callbacks and any unknown address all lead there. The Arena is the first sidebar item
  (it moved out of "Community"; its attention badge works as before).
- **"Обзор" / Overview is now "Исследования" / "Зерттеулер" / "Research"** in the sidebar: it is the researcher dashboard (study
  KPIs and the "New research" action). The sidebar's own "Новое исследование" key duplicated the one on that page and was
  removed (`shell.newResearch` deleted from the three locales); participants / insights / reports stay, below the Arena.
- **Missing migration, friendly error**: the "visible in rankings" switch used to toast PostgREST's raw
  `Could not find the function public.arena_set_visibility(p_visible) in the schema cache` when migration 0021 had not been
  applied. It now undoes the optimistic flip and says the server update is pending (`arena.rankings.serverPending` /
  `saveFailed`). Checks D4b / D4c in the Arena suite.
- **`ғылыми_жоба.txt`** (repo root) is the user's Kazakh speaking script for the jury; `CLAUDE.md` tells every session to update
  it together with each product change (section edit + a dated line in its changelog).
- Regression tests adjusted to the new home / nav order / label (sidebar hover, collapse and mode tests, dashboard polish,
  logo + login redirect, auth callback, onboarding wizard + skip, nav-removed test).

## Icons: heavy, duotone, "powerful" (`components/icons.js`, `styles.css`)

- All 57 icons were redrawn on the same 24px grid: 2px strokes (2.25px up to 20px, so they stay strong in the sidebar and in
  buttons), round caps and joins, and a tinted body (`currentColor` at 20 %) inside every closed shape, so a glyph reads as a
  solid object instead of a wireframe. Three classes in `styles.css`: `.b` outline + tint, `.t` tint only, `.f` solid detail.
  `filled` still sets the svg's `fill="currentColor"` and also makes the tint solid (heart / bookmark toggles).
- Sidebar glyphs are 19px (were 17); the active page's glyph gets a soft signal-orange glow and a stronger tint. Empty-state
  icons went from 1.4 to 1.9 stroke. The `Icon` API is unchanged.

## People: find anyone by name or @username; every avatar + name opens a profile

No migration: everything reads `profiles_public` (0011 + 0013), the identity-only view the Feed already used for every
signed-in member (name, @username, avatar, role, bio; never e-mail; not readable by anon).

- **Find people** (`src/lib/people.js`, `pages/Friends.js`): a search box under the Friends heading. Two characters minimum,
  260 ms debounce, answers to text that is no longer current are dropped (closure flag per effect run), previous results stay
  on screen (dimmed) while the next ones load. Up to three parallel PostgREST queries, ordered and limited to 20: the name must
  contain every word typed (so "сатпаева алия" finds "Алия Сатпаева"), and for a one-word query the `@username` starts with /
  contains it. Results are ranked client-side: exact @username, username prefix, name prefix, the rest. `cleanQuery` strips a
  leading `@`, `*` and control characters; `%`, `_` and `\` are escaped, so typing `a_b` finds `a_b_c` and not `axb` and `%%`
  finds nobody (usernames may contain `_`). Each row has the avatar/name (opens the profile), `@username · role`, and the one
  action that fits the relationship: Add friend / Request sent / Accept (the shared `FriendButton`), Write for a friend, a "You"
  badge for yourself. Empty, "no one found", error + Retry and a one-character hint are covered.
- **One profile popover for the whole app** (`lib/profileViewer.js` store, `components/profileViewer.js`
  `ProfileViewerHost` mounted once in `Shell`): `openProfile(who, { arena })` accepts a person or any author-like object
  (`toPerson` understands `author*`, `other*`, `actor*`, a leaderboard row's `userId`; the specific id keys are tried before
  `id`, which on a notification / friendship / team row belongs to the row). It shows what the caller already knows at once,
  then replaces it with the authoritative `profiles_public` row (cached for 60 s). Content: avatar, name, `@username`, role,
  bio (skeleton while loading, the old "no bio" line afterwards), friends count (`friends_count`), the Arena strip (place /
  level / XP, plus streak) when the caller had those numbers, and the actions: the friend button, Write for friends; for yourself
  "This is you" + "My profile". Esc, backdrop, the X and the browser back button close it; focus moves in and returns to the
  element that opened it. `PersonLink` (avatar + name as one button) is the helper for the new call sites.
- **Where a person is now clickable**: Feed posts and comments (as before, now through the shared popover; comments also carry
  `authorUsername`), Favorites, Friends rows and search results, the open chat's header in Messages, the actor's avatar in the
  notification bell (the text still navigates), Team members (real avatars now; the name shown to others is the profile name,
  never the e-mail fallback: `fetchOrgMembers` returns `fullName` / `avatarUrl`), Arena Rankings rows, the lobby's top three
  and the "taste twins" of the daily report. `AuthorCard` and the per-page popover state in Feed / Favorites / Friends were
  removed. In the Messages list the avatar is its own button laid over the row's reserved slot (two sibling buttons, nothing
  interactive inside another): the avatar opens the profile, the rest of the row still opens the conversation.
- **Arena keys stand down** while a profile is open (`isProfileOpen()` in `useArenaKeys`); the popover's Esc is marked handled so
  it does not also mean "leave the round".
- **Bug fixed on the way**: the Friends state of `FriendButton` used the translation key `friends.friends`, which did not exist
  (raw key on screen); added to ru / kk / en. `friends.subtitle` / `friends.emptyBody` now mention the search.
- i18n: `people.*` (17 keys) + `friends.friends`; all three locales at 1,115 keys. Styles: `.sk-person*`, `.sk-profile*`,
  `.sk-pstats`, `.sk-find*` at the end of `styles.css` (no new Tailwind classes; the popover keeps `font-semibold
  text-graphite-100` / `text-sm text-graphite-400` on name / role so older selectors still match).
- Tests: `test_people.mjs` (68 checks: search incl. debounce, escaping, stale answers, error + retry, Kazakh letters, friend /
  self / stranger states; a search that never answers ends in the error state after 12 s; the popover from Feed, Friends, Messages (header and list avatars), Team, notifications, back button; phone width; ru / kk / en;
  screenshots), Arena suite extended with B4b–d and N1–N9 (twins, lobby board, rankings rows with the real database, Enter / Esc
  behind the popover). `check_locale_parity` now takes `ROOT` so it checks the working copy, not `main`.

## Arena clock = the Daily Challenge only; Research gets a purpose: crowd tests (migration 0022)

Two requests in one: "time should move only while the Daily Challenge is being played" and "Research must have a reason to exist for
a person".

### 1. The clock (client only, no migration)
- `startActivityTracking` ticks only while `clockRunning()` (`arenaStore.js`): a round of mode `daily` or `mission` is in its
  `choose` / `reveal` phase, the tab is visible and the player was active in the last `IDLE_CUTOFF_S`. Free play, the lobby, the
  summary and every other tab / page never move it. The slices still go out through `arena_submit` as before, so the server needs
  no change; nothing recomputes time that was counted earlier (older days keep their numbers).
- A chip in the duel console shows "Время идёт" (lit LED, counting) in the Daily Challenge and a muted "Время не идёт" in free play
  (`ClockChip` in `Play.js`, `.ar-clock*` in `arena.css`). Labels that promised more were reworded in ru / kk / en: lobby tile "Время
  в испытании", profile note, rankings admin panel ("Использование Арены": counts only the Daily Challenge), badge texts (1 h / 3 h
  "in the challenge").
- Time quests (`time_5/15/30/60`) are `retired: true` in `rules.js`: `pickSlate` no longer offers them (a ten-duel challenge cannot
  fill "play 30 minutes"), the definitions stay so a slate saved earlier still resolves.

### 2. Crowd tests: what Research is for
A person puts 2-4 options (images and/or short texts) and one question in front of the Arena crowd; the players answer as
**research missions** in a second stage of the Daily Challenge; the owner reads a verdict with confidence intervals.
- **Database** (`supabase/migrations/0022_crowd_tests.sql`, idempotent, tested on local PostgreSQL 16: 97 assertions in
  `/tmp/pgtest/test0022.sql`): tables `arena_tests`, `arena_test_items`, `arena_test_votes` (one row per voter and pair, unique),
  `arena_test_reports`; `arena_daily.mission_votes / mission_xp`; public storage bucket `arena-tests` (1 MB, jpeg/png/webp, a user
  writes only into `<uid>/`); every table is RLS-closed, all access goes through SECURITY DEFINER functions: `arena_test_create`
  (level 2 = 100 XP, at most 3 open tests, 5 new tests per 24 h, 2-4 options each with a label or an image path in the caller's own
  folder), `arena_test_mine`, `arena_test_results` (owner only: options, pair splits, average answer time; never who voted),
  `arena_test_set_status` / `arena_test_delete` (returns the image paths so the client can clean the bucket), `arena_test_queue`
  (other people's open tests with the pairs this player still owes; never own, closed, flagged, removed or reported-by-me tests;
  least-answered first), `arena_test_vote` (12 XP per accepted answer, +20 when the player has now answered every pair, at most 300
  XP a day from missions, answers past the cap still count for the author; duplicates refused, so a retry is harmless; closes the
  test at its target), `arena_test_report` (3 different reporters flag a test), `arena_test_flagged` / `arena_test_moderate`
  (admins: remove / restore); `arena_admin_stats` extended with test and test-answer counts and missions per day. A mission answer
  counts as an active day for the streak.
- **Verdict** (`crowdStore.testVerdict`): per option wins / duels with a 95 % Wilson interval (`stats.js`); `empty` -> `collecting`
  (leader below 30 duels, `MIN_RELIABLE_SAMPLE`: no verdict) -> `winner` (leader's interval wholly above the runner-up's) or `close`.
- **Research page** (`pages/crowd/Section.js` above the classic section of `Overview.js`): a hero that says what it is for (three
  steps, three reasons, use cases) and the XP gate (shown only after the Arena profile has synced, `useCreateGate`, so a level-2
  player never sees a notice that is about to vanish); once the person has tests, "Your tests" cards with progress and a one-line
  verdict. `Create.js`: title, one of the seven questions, 2-4 options with image (shrunk to 1024 px and re-encoded WebP / JPEG under
  900 KB in the browser, uploaded to `arena-tests/<uid>/<uuid>.<ext>`, removed again if the database refuses) or caption; the same
  checks as the database run before any upload. `Results.js`: verdict, ranked options with bars and interval ticks, pair splits,
  close / reopen / delete (with confirm). Routes `/app/overview/tests/new` and `/app/overview/tests/:id`. If 0022 is not applied
  the page says so ("server not updated") instead of failing.
- **Missions in the Arena** (`pages/arena/Mission.js`, `arenaStore.startMission / voteMission / sendMissionVote /
  retryMissionVote`): after the day's ten duels a "Stage 2 - researchers' missions" block in the lobby offers up to three tests
  (author, question, XP budget of the day). A mission is an Arena round of mode `mission`: the same duel console with the author's
  images / texts (`Specimen` got an `art` prop), the Arena clock lit, the author as a clickable profile, a Report link. Each answer
  goes to the server at once; Next waits for it (and Space / auto-advance too), a failed answer offers Retry, a closed test ends the
  mission. The reveal shows the real split of the crowd (my vote counted). Summary: XP earned, answers, speed, bonus; "Next mission"
  / back to the lobby (Enter). Mission answers do not enter the local ledger, so they do not change the Taste DNA.
- **Admins**: `CrowdModeration` under the usage panel in Rankings lists reported / flagged tests with reasons, Remove / Restore;
  usage panel shows tests and test answers.
- Fixed on the way: a network failure reaches the client as an error with an empty `hint`; `rpcHint()` (`rpcErrors.js`) now accepts
  only short machine words, so an empty hint or one of PostgREST's sentence hints can never pose as an error code.
- i18n: `crowd.*` (120 keys) + `arena.admin.tests / testVotes`; all three locales at 1,245 keys. Styles: `crowd.css` (new file,
  linked in `index.html`; no new Tailwind classes).
- Tests: `test_crowd.mjs` (115 browser checks against the real database: missing migration, hero + gate, create with image upload
  (mocked storage), verdict maths at 10 and 36 duels, owner controls, Stage 2 locked / unlocked, a full 3-pair mission with 12 + 12 + 32
  XP, retry after a failed answer, report -> hidden from the reporter -> flagged -> admin remove / restore, phone widths, ru / kk / en
  without raw keys, delete). `arena/env.mjs` knows the new RPCs, parses hints and mocks the storage bucket. The Arena suite
  (109 checks) passes with M3 narrowed to "no Arena *sync* calls from the dashboard" (the Research section's `arena_test_mine`
  is a separate call); the gate on the Research hero is announced only once the server has been asked by something else, while
  the create page asks it itself (`useCreateGate({ sync: true })`), so opening Research never starts Arena traffic.
- **To apply on the live project**: `supabase db push` (0022; 0020 and 0021 too if not yet), then `notify pgrst, 'reload schema';`.

## Navigation clean-up, Google + phone sign-in, "New research" chooser

Requested together: "remove Insights; every page must have an important purpose (what is Team for?); sign in with Google and with a phone
number; make it the place people want to stay in for hours".

- **Insights removed.** The sidebar item, both routes (`/app/insights`, `/app/experiments/:id/insights`), `pages/Insights.js`, the AI-summary
  client calls (`fetchLatestAiInsight`, `generateAiInsight`), the Results link and the page's translations are gone; the old URLs fall back to
  the Arena. What stays: `lib/insights.js` (the rule-based "what happened / why it might have / recommendation" text) which the Report
  still prints and downloads. The `generate-insights` Edge Function and the `ai_insights` table are untouched but no screen reaches them.
- **Every page has one home.** Sidebar = Arena, Research | Community (Feed, Favorites, Friends, Messages) | Account (Profile, Settings).
  Participants and Reports are tabs of Research, Team and Billing are tabs of Settings (`components/subNav.js`, nav items have `also`
  paths so the sidebar item stays lit). Team's subtitle now says what it is for (collaborators and roles).
- **"New research" asks what kind** (`pages/crowd/Chooser.js`): quick test (Arena crowd, one question, answers in hours) or full experiment
  (own participants, many questions, segments, report), each card saying who it is for.
- **Sign in with Google / phone** (`lib/auth.js`, `pages/auth/SocialAuth.js`, used by Login and Register): `signInWithOAuth` with the
  address pre-checked (a provider that is off becomes a worded error, not a raw JSON page), `signInWithOtp` + `verifyOtp`; numbers typed
  the Kazakh / Russian way become +7...; the code field is `one-time-code`, six digits submit by themselves, resend after 60 s, change
  number; a failed Google redirect returns to the sign-in page with a message; accounts without e-mail show the phone number. Needs the
  providers switched on in the Supabase dashboard (README, "Sign in with Google and with a phone number"); nothing in the database changes.
- i18n: 1,254 keys per language (+23 auth, +7 chooser, -`insights.*` page keys, +2 subnav). Tests: `test_auth_social.mjs` (37 checks),
  `test_nav_tabs.mjs` (31), `test_nav_experiments_results_removed.mjs` and `test_sidebar_collapse.mjs` updated, `test_ai_insights.mjs` removed.

## Daily Challenge, Stage 3: the marathon (sets, theme of the week, friends race)

Requested: "make your proposal, but don't touch the clock". The Daily Challenge was ten duels; once they were done there was little
reason to continue. Stage 3 opens after the ten duels and gives three things to do. **The clock rule did not change**: `TIMED_MODES`,
`clockRunning()` and the server's time rules are byte-identical (the test reads the source to prove it); the extra sets are Daily
Challenge rounds (`mode: "daily"`, `set: n`), so the existing code counts their time.

- **Five extra sets** (2-6): ten duels each, planned by `planSet(day, season, n)` (pure, seeded `set/${day}/${season}/${n}`, 14
  candidates, mostly the theme family of the week; slots 2/5/8 are other families, slot 6 an eye test when the family has one).
  Duels the player has already seen are skipped, so a set can shrink for a heavy player. Sets open in order; a set left half-way
  continues with the duels it still lacks (`startSet(n)`). Finishing a set claims `set_N` (+40 XP, once).
- **Theme of the week**: one design family per ISO week (`floor(mondayDayNumber / 7) % 7` over the seven families, same formula in JS
  `themeIndex()` and SQL `arena_theme_family()`; compared over 900 days). 60 theme duels Monday-Sunday (counted from
  `arena_daily.family_votes`, summed over the week's days) unlock claim `week_theme` (+150 XP, once per week).
- **Friends race**: `FriendsRace` in the lobby block, built from `fetchLeaderboard("week", true)`: you + friends by weekly XP, the gap to
  the leader in words, names open profiles; with no friends it points to the Friends page.
- **Server** (`0023_arena_marathon.sql`): columns `set_votes int[]`, `family_votes jsonb`; `arena_week_start`, `arena_theme_family`;
  `arena_day_json`, `arena_submit` (votes carry `set`; a set number never counts as a first-set vote; unknown numbers are ordinary
  votes), `arena_claim` (`set_2..set_6`, `week_theme`) replaced. XP and claims are recomputed on the server.
- **Client**: rules/progress/sampler extended (`view.sets`, `view.theme`), `arenaStore` (`startSet`, `roundSet`, `set` on wire votes,
  `dailyCodes` includes set duels so free play never repeats them, a refused claim becomes a "warn" notice), UI in
  `pages/arena/Marathon.js` (+ set tag / set-aware summary in `Play.js`), CSS in `arena.css`, `arena.marathon.*` in all locales
  (1,283 keys per language, +29).
- **Older database**: when a server answer carries day rows without `setVotes` (0023 not applied) the store sets `setsApi = "old"` and the
  block says the marathon switches on soon instead of offering sets it could not keep; the Daily Challenge itself is untouched.
- Tests: SQL `test0023.sql` (37 checks; the 104 older ones still pass on 0023), JS/SQL parity for the theme over 900 days,
  `test_marathon.mjs` (53 browser checks against the real database: clock source unchanged, locked -> open, theme equals the DB, set 2
  played with clock chip lit and DB `set_votes`, half-way leave/continue, claim from the lobby, free play never deals set duels, theme
  claim +150, friends race with/without friends, phone width, kk/en, an older database). Arena suite (109) still passes; `test_marathon`
  is in the regression list.
- **To apply on the live project**: `supabase db push` (0023; 0020-0022 too if not yet), then `notify pgrst, 'reload schema';`.

## Messages v2: a full messenger (migration 0024)

Requested: "develop messages (chat) and the feed well, keep UX/UI/design". The chat only sent text; 0020 had added the columns for
pictures and replies but the client never used them.

- **Server** (`supabase/migrations/0024_chat_actions.sql`): `messages.edited_at / deleted_at` (a deleted message keeps its row, loses text + file;
  the "text or picture" check allows it), `conversations.last_message_deleted`; `edit_message` (sender only, 48 h, a picture may lose its
  caption), `delete_message` (soft delete, returns the file path so the client removes it from storage, drops reactions, fixes the chat
  preview), `message_reactions` + `react_to_message` (one emoji per person from a fixed set of six, needs the friendship, taking one back
  does not), `conversation_prefs` + `set_conversation_pref` (pin / mute, private to each person), `search_messages` (substring, RLS decides what
  is visible, 2+ characters), `my_unread_counts` ignores deleted messages, `messages_before_insert` clears `edited_at / deleted_at` so a client
  cannot forge them. No INSERT / UPDATE / DELETE policies for the API roles: every write is a `SECURITY DEFINER` function that checks the caller.
  Errors are short words (`edit_expired`, `not_found`, `deleted`, `bad_text`, `bad_emoji`, `not_friends`). `message_reactions` joins the Realtime
  publication.
- **Store** (`lib/messagesStore.js`, rewritten): messages carry quote / reactions / picture / edited / deleted; reads use PostgREST embeds
  (`reactions:message_reactions(...)`, `reply:messages!reply_to_id(...)`) and fall back to a plain `select *` on a server without 0024
  (`caps.actions = "old"`, picture column missing -> `caps.images = "old"`), the UI hides what the server cannot do. Optimistic send / edit /
  delete / react / pin with rollback and a worded error. Pictures: `prepareChatImage` (new `lib/imageTools.js`, shared with the crowd
  tests; <= 1600 px, <= 1.5 MB, WebP / JPEG), upload to `message-images/<conversation>/<me>/<uuid>.<ext>`, signed URLs in batches with a
  cache, local preview kept until the server's copy has loaded, a message thrown away mid-upload is never sent. Realtime: messages + conversations
  on one channel, reactions on a channel of their own (a database without the table cannot break chat). Drafts per conversation in
  `localStorage`. `ensureMessageLoaded` reads the stretch of history up to a message (one `gte` query, else pages back) for quote / search jumps.
  The "N unread" divider is worked out once per visit.
- **UI** (`pages/Messages.js` is now the shell; pieces in `pages/messages/`: `ChatList`, `ChatPane`, `Bubble`, `ActionMenu`, `Composer`, `parts`):
  hover tools + right click + long press open one menu (quick reactions, Reply, Copy, Edit, Delete with an in-menu confirmation; a bottom sheet
  on phones), swipe right to reply, quote blocks that jump to the original, reactions as chips, edit / reply strips over the composer, picture
  attach / paste / drag & drop with preview, viewer, "N unread" line, jump-to-latest with a counter, header menu (open profile, pin, mute), pinned
  rows, drafts and picture / deleted previews in the list, message search with highlighted hits that jump to the message, linkified text,
  large emoji-only bubbles, keep-at-bottom on resize. Styles in the new `messages.css` (no new Tailwind classes), 5 new icons.
- i18n: `messages.*` +54 keys in each language (1,337 per language).
- Tests: `/tmp/pgtest/test0024.sql` (74 checks on PostgreSQL 16; the 47 of 0020 and the 104 of 0021 still pass on top of 0024),
  `test_messages.mjs` (164 browser checks) against `msgfake.mjs`, an in-memory Supabase stand-in (REST + RPC mirroring the SQL + storage + a
  Phoenix realtime socket); `test_people.mjs` (68) and the crowd tests still pass. Honest limit: not run against a live Supabase.
- **To apply on the live project**: `supabase db push` (0024; 0020 too if not yet), then `notify pgrst, 'reload schema';`.

## Feed v2: tabs, order, tags, edit, links to posts, paging (no migration)

Same request as Messages v2 ("develop the feed well, keep UX/UI/design"). The feed was one flat list of the latest 50 posts; the composer stays
below the list (an earlier, explicit decision).

- **Data** (`lib/postsStore.js`): pages of 30 (`loadMorePosts`, `hasMore`), a quiet refresh re-reads everything already loaded (the pages the reader
  scrolled through are not thrown away; a real error still gives the full reload that "Try again" needs), `fetchPostById` (a link to an older
  post), `updatePost` (RLS `posts_update_own` already exists; `updated_at` is stamped by the existing trigger, so "edited" = `updated_at` later
  than `created_at` + 3 s), `patchPost`. Likes and saves (`lib/postInteractions.js`) are optimistic with rollback and also patch the Favorites
  store (`patchFavoritePost`), so the heart answers at once on both pages.
- **Rich text** (`lib/richText.js`, pure): links (http / https only, trailing punctuation stays text, `#` inside a link is not a tag), hashtags
  (a `#` glued to a word is not one), `extractTags`, `hasTag` (exact: #ui does not match #uiux).
- **UI** (`pages/Feed.js` is the page; pieces in `pages/feed/`: `FeedBar`, `PostCard`, `CommentThread`, `Composer`, `parts`; `PostCard` is still
  exported from `Feed.js` for Favorites): tabs All / Friends / Mine and order New / Popular (likes x 2 + comments x 3), both remembered; trending
  tags with counts; long posts folded to six lines; inline editor (Ctrl+Enter saves, Esc leaves, refused saves keep the text); copy link + `?post=<id>`
  (scroll + flash, or the post fetched and shown on top when it is older than what is loaded); comments show the last 3, "earlier" on request, "Reply"
  starts `@Name `; posts that arrive while the reader is far down wait behind a "New posts: N" pill; the composer keeps a draft, Ctrl+Enter sends,
  and after a post the page goes up to it and lights it; `timeAgo` ("12 min ago", "3 h ago"). Styles in the new `feed.css`; arrowUp icon.
- i18n: +31 `feed.*` and +3 `common.*` keys (1,371 per language).
- Tests: `test_feed_v2.mjs` (75 browser checks) against the in-memory Supabase stand-in (`msgfake.mjs`, extended with posts / likes / saves / comments);
  all 14 earlier feed / favorites / notification tests still pass. Honest limit: not run against a live Supabase.

## Platform roles, admin panel, Team with a purpose (migration 0025)

Request: "make a strong admin panel; `owner` only for my account, nobody else may show `owner` on a profile; give Team a purpose".

- **Two different roles were being mixed.** The company role (`organization_members.role`: owner / admin / researcher / viewer) is "owner" for
  everybody, because every signup founds its own company. That is what showed on every profile. The *platform* role is new and separate:
  `profiles.is_owner` (exactly one person: partial unique index `profiles_single_owner`, check `is_owner => is_admin`) and `profiles.is_admin`.
  The company role is now called **Founder** in the UI (`team.roles.owner`) and the profile hides it; the platform badge (crown / shield, new
  `components/platformBadge.js`) shows only for the owner and admins: own profile, public profile, the profile popover, Team rows, the admin panel.
- **Security hole closed.** `profiles: update own` (0002) had no column list, so anyone could `update profiles set is_admin = true` on themselves
  and see the Arena admin panel. A BEFORE UPDATE trigger (`profiles_guard_platform_flags`) now refuses changes of `is_admin` / `is_owner` when
  `current_user` is `authenticated` or `anon`; SECURITY DEFINER functions and migrations still can. The owner is set by
  `bootstrap_platform_owner('nu4lan')` at the end of the migration (by username; if the username does not exist nobody is owner until it is run again).
- **Backend** (`supabase/migrations/0025_platform_admin.sql`): `profiles_public.platform_role`, `get_public_profile` returns it, table `admin_audit`
  (RLS on, no policies, written by triggers / functions only), triggers that log a post / comment deleted by somebody other than its author
  (cascade-deleted comments are skipped), `admin_overview()`, `admin_users(query, limit, offset)`, `admin_set_admin(user, bool)` (owner only),
  `admin_audit_list(limit)`. All `_require_admin()`; the stats tolerate tables that older migrations did not create.
- **Admin panel** (`/app/admin`, sidebar item for admins; tabs in `?tab=`): *Overview* (attention card for reported Arena tests, four KPI strips,
  the Arena usage block moved here from Rankings), *People* (search, paging, who is admin/owner, company chip, posts / XP / date; grant and revoke
  with a confirmation, owner only), *Moderation* (Arena crowd-test reports, latest posts and comments with remove + confirmation + link to the feed),
  *Log* (what admins did). Without migration 0025 it shows a friendly "not connected yet" state; client reads of `platform_role` fall back to the
  old columns when the column is missing (`lib/platformRole.js`).
- **Team** (`pages/Team.js`) now has a purpose: a strip that says what it is for, KPIs (members, experiments, published), member rows with avatar,
  platform badge, experiments created, "in the team since", role select (not for yourself / the founder), remove with confirmation, "Leave team" for
  a non-founder, an empty "just you" state with an invite button, a "who can do what" matrix that mirrors the RLS policies (cards on a phone),
  and a role description in the invite dialog.
- i18n: +~110 keys (`admin.*`, `platform.*`, `team.*`, `shell.workspace.admin`): 1,487 per language, parity OK. Styles: new `admin.css`.
- Tests: `/tmp/pgtest/test0025.sql` (62 checks on PostgreSQL 16), `test_admin.mjs` (browser, real database behind the admin RPCs), `test_crowd.mjs`
  adjusted (the moderation block moved from Rankings to the admin panel). Honest limit: not run against a live Supabase.
- **To apply on the live project**: `supabase db push` (0025; 0023 and 0024 too if not yet), then `notify pgrst, 'reload schema';`.

## Platform-wide search, a top bar that stays put, a calmer sidebar rail (no migration)

Request: "make it just `Поиск` and let it find everything on the platform, but nothing personal; the sidebar looked rough when opening and
closing; the search box must not move when the menu collapses, nothing should move".

- **Search** (`components/globalSearch.js`, `lib/globalSearch.js`): the box is now "Поиск" / "Іздеу" / "Search" and a small command palette:
  *Pages* (everything the person can reach; the admin panel only for admins), *People* (`searchPeople`, name or @username), *Posts* (newest 5
  public posts containing the text, with their author). Arrow keys + Enter, `/` focuses, Esc clears then closes, results debounced and stale answers
  ignored. Choosing a person opens the profile popover, a post opens `/app/feed?post=<id>`. A footer line says what is *not* searched (own
  experiments, results, messages). On a phone the box is a button that opens a full-screen sheet. The old behaviour (box = filter of your own
  experiments, `/app/experiments?q=`) is gone from the header; that page is unchanged.
- **Top bar** no longer sits inside the column that is pushed by the rail: it is full width with a constant left inset, so the search, language
  switch and bell have the same coordinates open, collapsed or peeking. The sidebar is above it (z 40) and simply covers its empty left end.
- **Rail** (`shell.css`): icons keep the same x in both states (every row has a 14px gutter and a fixed-size icon cell), labels are always rendered
  and fade (`.sk-fade`), the section captions turn into a hairline, counters become a dot on the icon, the collapse key and the user row keep their
  glyph/avatar in place. Width and the page's left padding animate together (0.2s), so the content slides instead of jumping. Reduced motion respected.
- i18n: `shell.searchPlaceholder` changed, +10 `search.*` keys (1,496 per language). Styles: new `shell.css` (no new Tailwind classes;
  `sm:block` and friends are not in the compiled sheet, so the top bar uses its own classes).
- Tests: `test_shell_search.mjs` (47 browser checks, incl. coordinates of the search, icons, logo, avatar and chevron before / during / after a
  collapse); `test_org_role_scoping.mjs` was adjusted earlier for the Founder label. Honest limit: the page still reflows when the rail is
  collapsed (that is what collapsing is for); only the top bar is fixed. A layout where nothing at all moves is the "expand on hover" mode.

## Feed composer docked at the bottom of the screen (no migration)

"The place where you write a post is awkward: it should sit at the bottom." The box used to be the last thing after the list, which
with paging / infinite scroll is effectively unreachable. It is now a docked bar (`position: sticky; bottom: 0` inside the feed column):
one quiet line (avatar, field, picture, send) while the feed scrolls under a fade; it opens up on focus or when there is text / a picture
(counter, "Ctrl+Enter" hint, field grows to 240px). On a phone the avatar is dropped and the send key is an arrow. "Write the first post"
now focuses the field; toasts move up while the dock is on screen. +1 key `feed.composerHint` (1,497 per language). Styles in `feed.css`.
Tests: the 14 feed / favorites / notification tests pass unchanged (the old `Опубликовать` label is still in the button).

## Arena: daily drops, photo-like families, new questions, Pro "Styles" page (migration 0026) + phone sign-in removed

Request: remove phone sign-in; develop the Arena; marketers need to learn which styles people prefer (Pro mode); more photos / generated
imagery, new styles every day, nothing repetitive or boring.

- **Phone sign-in removed** (commit b80d41d): Google + email remain. `SocialAuth.js` keeps only the Google button; phone helpers, locale keys
  and `.au-seg/.au-code/...` styles are gone.
- **Daily drops** (`arena/catalog.js`, `stimuli.js`, `sampler.js`): a specimen index is `pool*32 + slot`; pool 0 = the month's classics, pool N
  (1..31) = the drop of day-of-month N, so every day brings 32 new specimens per family (pure functions of season/family/index, no storage).
  Free play draws 0.7 today's drop / 0.18 classics / 0.12 yesterday's; daily challenge and extra sets come from today's drop. A "new" tag marks
  today's specimens; the lobby has a drop strip.
- **Two photo-like families**: `scene` (16 cinematic landscape types x 16 colour grades) and `shot` (studio product shots: 13 forms, stages,
  lighting, backdrops, moods). Algorithmic SVG, not real photographs. Now 9 families; four new non-core questions (friendly, modern, natural,
  energetic), 11 dimensions in total. Theme of the week rotates through 9 families.
- **Ledger v2 / Taste DNA**: encoding `((((family*1024+a)*1024+b)*16+dim)*2+pick)`; v1 ledgers are converted on load (`convertLedgerEntryV1`);
  DNA is incremental (`extendDna`, persisted `dnaAgg`).
- **Backward compatibility**: `ensureDrops()` probes the server (`arena_tallies` with a 3-digit pair); an old server -> "legacy" mode (classics
  only, first 7 families, core 7 questions). So the client can ship before the migration is applied.
- **Migration 0026**: wider pair check in `arena_tallies` / `arena_submit` (indexes < 1024, 11 dims), `arena_theme_family` (9), new
  `arena_style_report` and `arena_style_segments` (admin/pro only, country split only for countries with >= 8 distinct voters).
  Must be applied: `supabase db push` then `notify pgrst, 'reload schema';` (0023-0025 first if not yet).
- **Pro "Styles" page** (`/app/styles`, Research tab; `pages/Styles.js`, `lib/styleInsights.js`, `insights.css`): which style traits win, by
  family; lift = difference of win rates with a two-proportion z (>= 40 answers each side; hint 1.28 / clear 1.96 / strong 2.58); Wilson-ranked
  top specimens; country segments; CSV export. It shows the taste of Arena players, not of a target audience; no age/gender.
- Tests: `test_arena_engine.mjs` (55), `test_styles.mjs` (57), SQL `test0026.sql` (38) against local PostgreSQL 16; older SQL suites updated for
  9 families / wider pairs. Both new files added to the regression list. Locale parity: 1,537 keys per language.
- Honest limits: question format is still pairwise; imagery is generated vector art; live Supabase and the Vercel deploy were not verifiable
  from the sandbox.

## Own domain: affinix.space (no migration)

The public profile URL shown in the UI is now `affinix.space/u/{username}` (3 locales). Auth redirects, reset-password and share links already use
`location.origin`, so nothing else in the code depends on the host. Connecting the domain itself is dashboard work (Vercel domain + DNS record,
Supabase Auth Site URL / Redirect URLs, Google OAuth origins). The brand name in the UI and the logo PNG are still "DecisionOS".

## Rebrand: DecisionOS -> Affinix (no migration)

All user-visible "DecisionOS" strings are now "Affinix" (3 locales, shell, auth/onboarding headers, landing, public profile, `index.html` title and
description, README, CLAUDE.md, UX_ARCHITECTURE.md, jury script, migration/CSS comments, the `generate-insights` system prompt). The Kazakh suffix
form is "Affinix-ке". New `assets/logo/logo-lockup-{dark,light}.png` (same mark, new wordmark set in Inter Bold; 839x256, so the landing `<img>` widths
became 98 / 105 px). Deliberately NOT renamed: lower-case storage keys (`decisionos_*`, so nobody loses local state), the GitHub repo, the Vercel
project name. The Edge Function prompt changed: redeploy with `supabase functions deploy generate-insights`.

## Swipe between tabs on a phone (no migration)

`lib/swipeTabs.js` + `components/ui.js` `Tabs`. Every `<Tabs>` registers with one document-level touch listener; a horizontal swipe on the page moves to the
next / previous tab (state-based tabs: Profile, Admin, Feed, Experiments filter; route-based: Research, Settings, Arena). The content after the tab bar
(`contentAfter`: everything after the bar at the highest level of the page that has anything after it) follows the finger with resistance, slides out,
and the new tab's content slides in from the side (Web Animations API, 280ms); a tap on a tab plays the same slide-in. The active tab is scrolled into
view in the strip. Not taken: a swipe that starts at a screen edge (browser back gesture), in a focused field, in a dialog / sidebar / top bar, or over a
sideways-scrolling strip or table; vertical scrolls are left alone; first / last tab springs back. `swipe=${false}` opts a filter out (the Arena rankings
filters). Reduced motion: switching works, nothing animates. `[data-swipe-tabs] #app { touch-action: pan-y pinch-zoom }` is set while a page has tabs.
Test: `test_swipe_tabs.mjs` (26 checks, real touch events through CDP). Limit: touch only; there is no mouse drag on desktop.

Fix (swipe): the slide-out animation was created with `fill: "forwards"` and never cancelled, so after the new tab slid in the old animation took
over again and the content became invisible (seen on a phone: the tab bar and heading, an empty page below). The slide-out animations are now kept and
cancelled when the slide-in starts, and a 900ms timer releases everything whatever happens. `test_swipe_tabs.mjs` now checks the real picture after
every swipe (no finished animation left on an element, computed opacity 1), and it fails on the old code.

## One sliding key for every segmented control (no migration)

`lib/thumb.js` (`useThumb(host, thumb, activeKey, layoutKey)`) + `.sk-thumb` / `.sk-thumbhost` in `styles.css`. The raised key of a tab bar is one element
that glides (WAAPI, 400ms, `cubic-bezier(.3,.9,.3,1)` -- the same curve as the landing language pill) from the old choice to the new one and stretches over both
while it travels; the active button itself is flat while `data-thumb="on"` is set on the host. Used by: `Tabs` (so Profile, Research, Settings, Arena, Admin,
Feed, Experiments filter, Rankings), the header language switch, the Feed sort toggle, the Arena DNA dimension tabs, the experiment builder steps. Sizes that
change by themselves (font load, resize, a new language) re-place the key without animating (ResizeObserver); a change that lands in the middle of a glide re-aims
it; reduced motion jumps. No markup contract changed: buttons keep `data-active`. Test: `test_tab_thumb.mjs` (26 checks: geometry at rest, stretched while
travelling, rapid switching, language switch, resize, reduced motion, Arena, builder). Left as they were: the sidebar items (their icon alignment is pinned by
other tests) and the landing language pill (it already slides).

## Sidebar: the same sliding key (no migration)

`SidebarContent` (shell.js) uses `useThumb` on the `<nav>` (`sk-thumbhost`) with the id of the active item, so the held-down well and its lit edge are one
`.sk-thumb.sk-nav-thumb` element that glides vertically between rows, stretched over both while it travels (`lib/thumb.js` now stretches in both axes). The active
row is flat and its own lit edge (`::before`) is hidden while the key is placed. Collapsing / expanding the rail, a language change and the phone drawer re-place the
key without animating (ResizeObserver + `layoutKey`). Icons and labels did not move; the sidebar tests pass unchanged. Test: `test_nav_thumb.mjs` (11 checks).

## Motion, second pass (no migration)

A small shared vocabulary at the end of `styles.css`, all of it off under `prefers-reduced-motion`: `skGrowW` (a bar grows from empty to its inline width; applied by
selector to `.sk-progress-fill`, `.ar-spec-bar > i`, `.ar-split > i`, `.ar-badge-prog > i`, `.sty-bar`, `.cr-res-bar > i`, `.ar-fader-fill` and by the `sk-grow` class on the Overview
and Results bars), `skRise` + `.sk-stagger` (rows rise in one after another, the first twelve staggered; used on the experiments list, Arena quests, rankings, admin
people, incoming friend requests), `skFloat` (`.sk-empty-ico`, the empty-state icon), and in the Arena `arSpecInL/R` (the two specimens arrive from their sides), `arVsPop`,
`arPickPop` + `skRing` (the chosen specimen pops with a ring; the other steps back to .985), a rising result block and a popping "your pick" chip. No markup contracts changed.
Test: `test_motion2.mjs` (10 checks incl. reduced motion). Not done on purpose: counting numbers up (the text would change under tests and screen readers) and chart intros
(Chart.js already animates them).

## New brand identity + "affinix.space" wordmark (no migration)

- **Symbol** (`assets/brand/affinix-symbol.svg`): a bold A that leans forward (apex pushed right, flat top cut as a "blade"), no crossbar; one orange node sits in the counter,
  placed by construction (tangent distance 12 from both inner edges, on the bisector of the counter's angle). Silhouette reads at 16px.
- **Wordmark**: Inter Display SemiBold outlines (no live text, so the SVGs are self-contained) with three custom touches: the A's apex is cut like the symbol's, the two f's share
  one continuous crossbar, and only the last i carries the orange dot. "Nurlan Company" in Inter Medium, tracked, #92949E. Generator: scratchpad `brand2/compose.py` (sym3.py
  builds the symbol geometry); not part of the repo, the outputs are.
- **Files**: `assets/brand/` (primary on charcoal #101114, monochrome white / black, transparent dark + light, app icon 1024, symbol 1024, SVG masters) and the site's
  `assets/logo/` (lockups for the landing, the tile mark at 256 / 1024, favicon 32, icon 192, apple-touch 180). Landing `<img>` sizes changed to 128x30 / 136x32 (new aspect).
- **Text**: the sidebar, auth layout, onboarding header, public profile header and the boot screens now read `affinix.space` (".space" muted); the landing keeps the lockup image.
- Honest limits: the typeface is Inter (not a bespoke font); the symbol was drawn in code, not hand-refined by a designer; no trademark search was done.

## Arena: no more repeating images (no migration)

Cause found by simulation: `pickPair` preferred pairs at a "good" trait distance (|dist-1.7|), which kept picking the same specimens; on a server without migration 0026
the pool is also only 32 specimens per family. Fix: `exposure` (how many times this player already met each specimen this season, from the ledger via `exposureFor`) is
passed to `planRound`/`pickPair` and costs 0.55 per earlier meeting (capped at 5) -- also counted within the round being dealt; the distance term weighs 0.7, the random
term 1.1; 24 candidates instead of 10. Without drops (old server) free play now uses two pools (indexes 0-63, which the old server accepts). Measured over 20 rounds / 200 duels:
distinct specimens 285 -> 363 (drops), 179 -> 359 (old server); the most-shown specimen 5-6 times -> 2-3. Lobby: a quiet link to the Styles page for designers and marketers,
and an admin-only note when the probe found the server without migration 0026 (`arena.dropsOff`). Tests: engine F4 / F4b. The daily-drop generator itself (migration 0026)
is unchanged and still needs `supabase db push`.

## "For marketers" home + no specimen twice in a set (no migration)

- Sidebar: the research item is now **For marketers** (`shell.nav.marketers`, path `/app/styles`; the old experiment / participants / reports / results paths still light it). The Styles
  page lost its tab bar, got the title "What people love", a `scope` filter (all / today's drop / classics, filtered client-side by pool = index div 32), the gallery of the **12** best
  designs first (168px thumbs), then the recipe, then the style portrait, and a quiet link "My own experiments (advanced)" to `/app/overview`. The experiments, participants and reports pages
  are NOT deleted (routes, data, builder, public participant flow all work); only their navigation entry is gone. The old research tab bar now starts with Styles (the way back).
- Dealing: `planDaily` / `planSet` use a `used` set -> no specimen twice inside one set (`pickPair(exclude)` falls back to a reuse only when the pool has nothing fresh), and extra set
  `n` has its own drop pool (`((dayPool-1)+(n-1)*7) % 31 + 1`, distinct for the six sets of a day). Measured over 28 days: duplicates per extra set 2.4 -> 0, per daily set 0.2-0.4 -> 0.
- Tests adjusted: nav / tabs / styles expectations; engine D12 + D12b. Locale parity 1,547 keys.

## Download page, installable app (PWA), Windows / Android packages, smooth landing scroll (no migration)

- **PWA:** `manifest.webmanifest` (standalone, start `#/app/arena`, icons 192 / 512 any + maskable in `assets/pwa/`), `sw.js` (network-first, API never cached, offline falls back to the cached shell),
  `lib/pwaInstall.js` (keeps `beforeinstallprompt`, `promptInstall()`, `isStandalone()`, `detectPlatform()`; registers the worker on https / localhost; imported by `main.js`).
- **Download page** (`pages/Download.js`, `download.css`): public `/download` (own header) and in-app `/app/download` (inside the shell, sidebar item "Download the app" under Account). Platform order follows the device;
  reads `https://api.github.com/repos/NUREKE178/affinix/releases/latest` (cached 10 min) for `Affinix-Setup.exe` / `Affinix.apk`, with version / size / date; no release -> "being prepared", no dead links;
  an "Install from the browser" block with the real install button when the browser offers it. Landing: link in the header (hidden under 640px) and in the footer.
- **Packages:** `apps/desktop` (Electron 33 + electron-builder NSIS, appId `space.affinix.app`, icon.ico generated from the brand mark, Chromium user agent so Google sign-in is not refused, offline page),
  `apps/android` (Capacitor 6, `server.url` = affinix.space, launcher icons generated from the brand mark), workflow `.github/workflows/release-apps.yml` (windows, android, release jobs; manual or tag).
  NOT built or run here (no Android SDK / Windows in this sandbox): the workflow YAML, both package.json files and the Electron main.js are only syntax-checked. The first run on GitHub may need a fix.
- **Smooth scroll:** `lib/smoothScroll.js` eases the mouse wheel toward a target (11% per frame), enabled by `Landing` only; off for touch, reduced motion, ctrl+wheel, scrollable inner panels; inside the app the wheel stays native.
- Tests: `test_download.mjs` (25 checks). Locale parity 1,578 keys.

Linux: `Affinix.AppImage` (electron-builder `--linux AppImage`, new `linux` job in the release workflow, `dist-linux` script); `detectPlatform()` returns `linux` (Linux without Android / ChromeOS); the Download page puts the visitor's own system first (linux -> linux, windows, android, apple) but all cards and buttons stay usable for everyone. Cards now `auto-fit`. Test download: 29 checks. Nav tests expect 9 sidebar items.

## Landing scroll choreography (no migration)

`lib/smoothScroll.js` rewritten as an engine (`startLandingScroll`, `scrollToTarget`): wheel + keyboard (arrows, Space, PageUp/Down, Home/End; skipped when focus is on an input / button / link) move a
target and the page eases toward it with a frame-rate-independent exponential glide (tau 0.15s); anchors / buttons / the rail use an ease-in-out-expo tween (1.1s); every frame it emits
{y, velocity, progress} (also on touch, where the wheel / keys stay native). `Landing`: `useChoreography()` + `Choreography` -> an orange progress line at the top (`.lp-progress`), a rail of five section
dots on the right (>= 1180px, `.lp-rail`, active = section above 40% of the viewport, tooltips), and parallax (`data-par` on the dashboard preview and the phone fan; `--par` px each frame). Reduced motion: no glide,
no parallax, keys native. Off inside the app. i18n `landing.sections.*`. Tests: `test_landing_scroll.mjs` (17 checks); the glide checks in `test_download.mjs` still pass.

## Performance fix: the site stuttered (measured, no migration)

Measured with CDP `Performance.getMetrics` (scratchpad `perf.mjs`): the landing recalculated style on every frame while scrolling (332 recalcs / 3 s, 0.36 s of style CPU on a fast desktop, 0.45 s over 40 phone scroll steps),
because the parallax wrote a custom property (`--par`) on large subtrees each frame and the rail / parallax read `getBoundingClientRect()` each frame. Now: positions are measured once (and on resize / load / 0.8 s / 2.5 s), parallax writes
`style.transform` directly in half-pixel steps and only when it changes -> style CPU 0.357 -> 0.022 s (desktop), 0.447 -> 0.015 s (phone); total task time roughly halved to a quarter. Also: the swipe-between-tabs
`touchmove` listener is now passive (a blocking listener on `document` makes every phone scroll wait for script; `touch-action: pan-y` already keeps the browser from panning sideways), `useThumb` no longer measures on plain re-renders
(only when the choice, labels or host change; the ResizeObserver covers real size changes), and the service worker only handles page navigations (scripts / styles / images / data go straight to the browser; cache name v2).

## Performance fix 2: first load (module waterfall), measured (no migration)

Cause of "still laggy": the landing needed 130 requests (109 JS modules, the whole app) and `index.html` blocked parsing on two classic scripts (Chart.js 205 KB + supabase 218 KB). Emulated Slow 4G + 4x CPU
(scratchpad `load.mjs`): first content 10.5 s -> 5.8 s, requests 130 -> 53 (JS 109 -> 32), over the wire 1.29 -> 1.10 MB (local server is uncompressed; Vercel serves gzip / brotli, so real transfer is a fraction).
- `App.js`: Shell and every page except the landing are `lazyPage(...)` (fetched on first open). `LanguageSwitch` moved to `components/languageSwitch.js` (`shell.js` re-exports it), so the landing no longer pulls the whole shell.
- `index.html`: Chart.js removed from the head and loaded on demand by `components/charts.js` (`ensureChart()`); supabase script `defer`; generated `<link rel="modulepreload">` list for the first-screen module graph
  (`node scripts/gen-preload.mjs`, `--check` tells whether it is stale; rerun after adding a static import to the landing / App closure).
- `lib/idlePreload.js`: outside the landing, warms shell / Arena / feed / profile ... one module per idle slice; on the landing nothing is fetched on its own (no jank), only when a pointer / finger nears a sign-in / app / download link.
  Skipped on Save-Data and 2g.
- Not done (honest): the three locale dictionaries (315 KB raw) are still all in the first download.

## Smooth scroll engine: lighter, same behaviour (no migration)

`lib/smoothScroll.js`: the page height is cached (re-read on load / resize / body size change via ResizeObserver, and when a glide starts from rest) instead of reading `scrollHeight` every frame right after `scrollTo()`;
one event object is reused for every frame; the "is there a scrollable panel under the cursor" walk (`getComputedStyle` up the tree) is remembered for 150 ms for the same element and direction, so a burst of wheel events does it once.
`Landing.js`: the progress bar is written only when its value changes. Feel, constants (TAU 0.15, expo tween 1.1 s), keyboard and touch behaviour are unchanged.
Measured (CDP, 3 s of wheel): task 0.290 -> 0.259 s, script 0.035 -> 0.027 s; phone native scroll: task 0.146 -> 0.137 s. Small, because the earlier per-frame style fix already took most of the cost. Tests: test_landing_scroll 17/17, test_download 29/29, test_motion_landing 8/8, test_landing_instrument 24/24.

## Smooth scroll removed (no migration)

On request: no smoothing anywhere on the landing. `lib/smoothScroll.js` is replaced by `lib/scrollWatch.js`, which only watches the native scroll position (rAF-coalesced, page height cached) and notifies the progress line, the section rail and the parallax;
the wheel, keys and touch are fully native, `scrollToTarget()` jumps instantly (`behavior: "instant"`), and `html { scroll-behavior: smooth }` is removed from `styles.css`. `index.html` modulepreload list regenerated (it listed the old file -> 404).
Not touched: in-app `scrollIntoView({ behavior: "smooth" })` in Feed (jump to a post), Messages (chat to the newest message, jump to a replied message) and the tab swipe slide-in; those are not page smooth-scrolling.
Tests rewritten for native behaviour: test_landing_scroll 17/17, test_download 29/29; test_motion_landing 8/8, test_landing_instrument 24/24, test_swipe_tabs 27/27. Earlier smooth-scroll sections above describe the removed engine.

## Landing: progress line and section rail removed (no migration)

On request. `Landing.js`: `useChoreography` / `Choreography` replaced by `useParallax` (the data-par blocks only); the `.lp-progress` / `.lp-rail*` CSS is gone from `landing.css`; the page no longer re-renders when the section changes.
`landing.sections.*` locale keys are now unused (kept, parity unchanged). Tests: test_landing_scroll rewritten (11 checks: no line, no rail, native wheel / keys, parallax, buttons jump), test_download 29/29, test_motion_landing 8/8, test_landing_instrument 24/24.

## Icons: settings gear redrawn, platform icons on the Download page (no migration)

`components/icons.js`: `settings` is now a clean 8-tooth gear (generated geometry, centre hole) instead of the blobby cog; new `windows`, `linux`, `android`, `apple` glyphs in the same duotone style. `pages/Download.js` uses them on the four cards (tile icon 22 -> 26 px).
Tests: test_download 29/29, test_nav_tabs 31/31, test_nav_thumb 11/11, test_dashboard_polish 13/13. (Superseded below: the platform glyphs are now the official marks.)

## Download page: the platforms' own logos (no migration)

On request ("put their own icons, don't draw them yourself"): `windows`, `linux` (Tux), `android`, `apple` in `components/icons.js` are now the brands' real marks from the Simple Icons set (CC0 data; the Windows mark from Simple Icons 5.23.0 because later releases dropped it),
drawn solid in `currentColor` (no outline / tint). Trademarks stay with their owners; used only to label the matching download. Test download 29/29, nav tabs 31/31.

## Phone bottom dock (no migration)

`components/mobileTabBar.js` (rendered by `Shell`, below md only): a floating glass dock (10px side / bottom gap + safe area): Arena | Feed | Messages | Marketing | More (opens the existing drawer, which keeps everything else).
- Active tab: a tinted, glowing pill glides via `useThumb` (data-active sits on the pill, not the button); stronger icon tint + spring pop; More lights up on pages that are not a tab; re-tapping the current tab scrolls to the top (instant).
- Scrub: touchstart / move / end on the dock; the icon under the finger rises (`data-hot`), lifting opens it (the synthetic click is suppressed), `navigator.vibrate` ticks where supported.
- Auto-hide: `html[data-mtb-hide]` while reading down (passive scroll, one rAF per burst, 14px down hides, 6px up shows, top 48px / end of page show), `html[data-kb]` while a field is focused, and inside an open chat (`body:has(.sk-chat[data-pane="chat"])`).
- Counts: messages unread, Arena attention, incoming friend requests on More; the badge remounts per value so it pops.
- Layout: `--mtb-total` (62 + 10 + safe area) pads `main` and the phone chat list / Arena art; `--mtb-dock` (drops to the bare safe area while the dock is away) lifts the toast stack and the feed composer dock.
- Locale keys `shell.tabbar.{label,more,marketers}`. Test: `test_mobile_tabbar.mjs` (27 checks incl. real touch scrub and scroll hide). Desktop / tablet unchanged.
