# Browser check (manual)

`node tests/browser/e2e.cjs` walks the first look and Taste Match in a real Chromium with no backend (see the header of
`e2e.cjs`). It needs Playwright (`npm i -g playwright`, `npx playwright install chromium`). It is not part of the
`Web tests` workflow (that one is plain Node, no browser); run it by hand before shipping a change to the Arena screens.
