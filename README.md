# DecisionOS

AI-powered Consumer Decision Intelligence platform. Companies run controlled
consumer experiments (packaging, ads, logos, pricing, UX), collect real
behavioral responses from participants through a public link, get
deterministic statistical analysis, and an AI-assisted research
interpretation that is always labeled as a prediction, never a certainty.

```
Stimulus → Controlled experiment → Participant response → Behavioral data
  → Statistical analysis → AI interpretation → Decision recommendation
```

## Status: production migration in progress

This repo is being migrated from a client-only demo prototype to a real
multi-tenant SaaS backed by Supabase. See **PROGRESS.md** for exactly what's
wired to a real backend vs. still running on the old local demo store, phase
by phase.

## Stack

- **Frontend**: no build step -- plain ES modules, Preact 10 + htm, Chart.js,
  Tailwind pre-compiled to static CSS. Everything in `vendor/` is vendored
  (not CDN-loaded), including `@supabase/supabase-js`.
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions + RLS).
  No custom server -- the frontend talks to Supabase directly (gated by RLS)
  for authenticated researcher operations, and to Edge Functions (service
  role, server-validated) for the anonymous participant flow.

## Setup

1. Create a Supabase project at supabase.com.
2. Copy `.env.example` to `.env` and fill in the values (see comments for
   where each one comes from in the Supabase dashboard).
3. Apply the schema:
   ```
   npx supabase login            # uses SUPABASE_ACCESS_TOKEN
   npx supabase link --project-ref $SUPABASE_PROJECT_REF
   npx supabase db push          # runs supabase/migrations/*.sql in order
   ```
4. Deploy the Edge Functions:
   ```
   npx supabase functions deploy start-session
   npx supabase functions deploy submit-response
   npx supabase functions deploy complete-session
   npx supabase functions deploy generate-insights
   npx supabase functions deploy invite-member
   ```
5. Put `SUPABASE_URL` / `SUPABASE_ANON_KEY` into `src/lib/env.js` (the anon
   key is meant to be public -- Supabase's security model is anon key + RLS,
   not a secret key). Never put the service role key or `AI_API_KEY` there.
6. Serve the frontend (still no build step): `npx http-server . -p 8080`.

### Sign in with Google

Ready in the app; it needs one switch flipped in the Supabase dashboard (until then the app says so in words: "Google sign-in is
not switched on yet"). Phone / SMS sign-in was removed on purpose (SMS costs money and Kazakhstan sender registration is a chore).

- **Google.** In Google Cloud Console create an OAuth client (type *Web application*); as its *Authorised redirect URI* use
  `https://<project-ref>.supabase.co/auth/v1/callback`. In Supabase: Authentication -> Providers -> Google -> enable, paste the
  client ID and secret. In Authentication -> URL Configuration add the site address (for example
  `https://<your-domain>/index.html` and the Vercel preview domain) to *Redirect URLs*, and set *Site URL*.
- A person who signs in for the first time gets an account automatically; the onboarding wizard asks for the name.

### Running the migrations locally without a Supabase project

`supabase/migrations/*.sql` were authored and verified against real
PostgreSQL 16 using a local stand-in for Supabase's `auth` schema and roles,
including functional tests that two different organizations' data is
actually isolated from each other and that the anonymous role cannot read
or write any participant-facing table directly (see PROGRESS.md for what
was tested and how).

## Database schema

`profiles`, `organizations`, `organization_members`, `experiments`,
`experiment_variants`, `experiment_questions`, `experiment_question_options`,
`participant_sessions`, `responses`, `response_events`, `ai_insights`,
`reports`. Full definitions + RLS policies: `supabase/migrations/`.

**Security model**: every org-scoped table is RLS-protected by organization
membership (owner/admin/researcher can write, viewer is read-only). The
anonymous participant surface (`/r/:slug` or `/research/:slug`) has **zero**
direct table access -- no anon SELECT or INSERT policy exists on any
participant-facing table. All public reads/writes go through Edge Functions
running with the service role, which validate everything server-side
(experiment is published, session token matches, no duplicate answers). This
also means variant/question randomization is assigned server-side at session
creation, not just shuffled in the browser.

## Research & ethics design choices (unchanged from the prototype)

- Predictions, never certainty -- AI insights are structured, traceable to
  concrete statistics, and the "why" is explicitly associational, never
  causal.
- Sample-size honesty -- under 30 completed responses triggers an explicit
  insufficient-sample warning everywhere, and caps AI confidence at "low".
- Wilson score confidence intervals (not the normal approximation, which
  misbehaves at small n).
- Minimal data collection -- only what a participant explicitly submits,
  plus up to three optional demographic fields a researcher enables. No
  camera/microphone/biometric data, ever, without its own explicit consent
  flow (not implemented here).

## License notices for vendored code

See `vendor/NOTICE.md`.
