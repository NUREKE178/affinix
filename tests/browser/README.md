# Browser check (manual)

`node tests/browser/e2e.cjs` walks the first look and Taste Match in a real Chromium with no backend (see the header of
`e2e.cjs`). It needs Playwright (`npm i -g playwright`, `npx playwright install chromium`). It is not part of the
`Web tests` workflow (that one is plain Node, no browser); run it by hand before shipping a change to the Arena screens.

`node tests/browser/cash.e2e.cjs` checks the Arena cash screens (wallet, paid missions, the admin Bonuses tab, the landing
section) against a **real** PostgreSQL: it builds a fresh database with `tests/sql/run.sh` (all migrations, then
`cash-seed.sql`) and answers every RPC of the page as the signed-in person. Needs a local PostgreSQL 16, e.g.
`PGHOST=/tmp PGPORT=54329 PGUSER=postgres node tests/browser/cash.e2e.cjs`. The SQL tests alone: `tests/sql/run.sh`.

`node tests/browser/chat-layout.cjs` checks the phone messenger layout (the open chat fits the screen and never scrolls the page, so its header stays under the top bar). No backend needed.
