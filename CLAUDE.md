# Affinix: notes for Claude

## `ғылыми_жоба.txt` (the jury script): keep it in sync with every change

`ғылыми_жоба.txt` in the repo root is the user's speaking script for the jury, written in Kazakh:
pitch, problem, goals, novelty, how it works, methodology, evidence, demo script, Q&A, honest
limits and a changelog.

Whenever you change the product in a way a juror could notice (a feature, a screen, a route, user-facing
text, the database, test or size numbers, or a limitation that is fixed or new), update that file in the
same commit:

- edit the section that describes the change (and any numbers: tests, files, strings, counts);
- add a dated entry at the top of section "13. ӨЗГЕРІСТЕР ЖУРНАЛЫ" saying what changed and what to
  say to the jury about it;
- keep it truthful: never describe something as working that is not (see sections 10 and 11, the
  "do not say" list and the honest limits), and move an item out of those lists once it really works.

Write in Kazakh, in short sentences that can be spoken aloud.

## Other conventions

- `PROGRESS.md` is the engineering log; add a section for substantial work.
- Database changes go in `supabase/migrations/` and are applied by the user with `supabase db push`;
  say so in the final report whenever a new migration is added.
- The app is plain ES modules (Preact + htm, no build step) deployed from `main` by Vercel; Tailwind is
  pre-compiled into `vendor/tailwind.css` (rebuild it after adding new utility classes).
- Texts exist in three languages (`src/lib/locales/{ru,kk,en}.js`); every key must exist in all three
  with the same structure.
