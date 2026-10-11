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
