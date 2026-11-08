// An end-to-end check of the first look and Taste Match in a real browser, with no backend:
//   node tests/browser/e2e.cjs            (needs Playwright: `npm i -g playwright` + `npx playwright install chromium`)
// It serves the repo, stands in for sign-in and the database (fake-auth.js, fake-supabase.js: the Arena then works from the
// device, as it does before its migrations are applied), and walks: a new player -> welcome -> a round -> the share link ->
// a friend opening it -> the welcome from a friend -> the match -> the landing invitation. Pictures go to $TMPDIR/affinix-shots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(os.tmpdir(), "affinix-shots");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      let file = url.pathname.startsWith("/__h/") ? path.join(__dirname, url.pathname.slice(5)) : path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      let body = fs.readFileSync(file);
      if (file.endsWith("harness.html")) body = Buffer.from(body.toString().replaceAll("__ORIGIN__", `http://${req.headers.host}`));
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function playRound(page, key) {
  for (let i = 0; i < 14; i++) {
    if (await page.locator('[data-testid="arena-summary"]').count()) return;
    await page.keyboard.press(typeof key === "function" ? key(i) : key);
    await page.waitForTimeout(120);
    await page.keyboard.press(" ");
    await page.waitForTimeout(120);
  }
}
const ledgerOf = (page, uid) => page.evaluate((u) => JSON.parse(localStorage.getItem("decisionos_arena_v1:" + u) ?? "null")?.ledger ?? null, uid);

(async () => {
  const server = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}/__h/harness.html`;
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport = { width: 390, height: 844 }) => {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return page;
  };
  try {
    // 0. the gate: a signed-in person with no workspace gets one made (once, named after them), never the old wizard.
    //    (The shell around the Arena needs a real backend for its other stores, so only the gate is judged here.)
    const g = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await g.goto(`${BASE}?v=app&u=u9&name=${encodeURIComponent("Нурлан Жайлау")}`);
    await g.waitForFunction(() => window.__workspaceCalls >= 1, null, { timeout: 15000 });
    await g.waitForTimeout(800);
    assert.equal(await g.evaluate(() => window.__workspaceCalls), 1, "one workspace is made, once");
    assert.equal(await g.evaluate(() => window.__workspaceUser), "Нурлан Жайлау");
    assert.equal(await g.evaluate(() => location.hash), "#/app/arena", "the person is in the Arena");
    assert.equal(await g.locator("text=/Шаг 1 из|Step 1 of/").count(), 0, "no wizard");
    await g.close();

    // 1. a brand-new player: the welcome, no questions, the person's own first name
    const p1 = await open();
    await p1.goto(`${BASE}?u=u1&name=${encodeURIComponent("Нурлан Жайлау")}&l=ru`);
    await p1.waitForSelector('[data-testid="arena-firstlook"]', { timeout: 15000 });
    assert.equal(await p1.getAttribute('[data-testid="arena-firstlook"]', "data-kind"), "own");
    assert.equal((await p1.textContent(".ar-first-title")).trim(), "Добро пожаловать, Нурлан");
    assert.equal(await p1.locator("input, textarea, select").count(), 0, "the welcome asks nothing");
    await p1.screenshot({ path: `${OUT}/1-welcome-own-ru.png` });

    // 2. the first round, its summary (no stray 0), and the share card
    await p1.click('[data-testid="arena-firstlook-start"]');
    await playRound(p1, "1");
    await p1.waitForSelector('[data-testid="arena-share-card"]', { timeout: 15000 });
    const stray = await p1.evaluate(() => [...document.querySelector('[data-testid="arena-summary"]').childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() !== "").map((n) => n.textContent.trim()));
    assert.deepEqual(stray, [], "no loose text (a bare 0) inside the round summary");
    await p1.waitForTimeout(5200); // the reward notices go away by themselves
    await p1.locator('[data-testid="arena-share-card"]').scrollIntoViewIfNeeded();
    await p1.screenshot({ path: `${OUT}/2-summary-share-ru.png`, fullPage: true });
    const url = (await p1.textContent('[data-testid="arena-share-url"]')).trim();
    assert.match(url, /\/\?c=1\.\d{6}\.[0-9a-z-]+\.[A-Za-z0-9_-]+$/);
    await p1.waitForTimeout(1200);
    const led1 = await ledgerOf(p1, "u1");
    await p1.reload();
    await p1.waitForSelector('[data-testid="arena-page"]');
    await p1.waitForTimeout(600);
    assert.equal(await p1.locator('[data-testid="arena-firstlook"]').count(), 0, "the welcome is gone once answers exist");

    // 3. a friend opens the link: address cleaned, the welcome names the sender, the answers stay hidden
    const p2 = await open();
    const c = new URL(url).searchParams.get("c");
    await p2.goto(`${BASE}?u=u2&name=${encodeURIComponent("Айгерим Сериккызы")}&l=ru&c=${c}`);
    await p2.waitForSelector('[data-testid="arena-firstlook"]', { timeout: 15000 });
    assert.ok(!p2.url().includes("c="), "the link's parameter is taken out of the address bar");
    assert.equal(await p2.getAttribute('[data-testid="arena-firstlook"]', "data-kind"), "challenge");
    assert.equal((await p2.textContent(".ar-first-title")).trim(), "Вызов от Нурлан");
    await p2.screenshot({ path: `${OUT}/3-welcome-challenge-ru.png` });
    await p2.click('[data-testid="arena-firstlook-start"]');
    await playRound(p2, (i) => (i % 3 === 0 ? "2" : "1"));
    await p2.waitForSelector('[data-testid="arena-match"]', { timeout: 15000 });
    await p2.waitForTimeout(5200);
    await p2.screenshot({ path: `${OUT}/4-match-ru.png`, fullPage: true });

    // 4. the number on screen equals an independent count from the two devices' ledgers
    const pct = Number(await p2.getAttribute('[data-testid="arena-match"]', "data-percent"));
    await p2.waitForTimeout(1200);
    const led2 = await ledgerOf(p2, "u2");
    const season = Object.keys(led1)[0];
    const mine = new Map(led1[season].map((e) => [e >> 1, e & 1]));
    let compared = 0, same = 0;
    for (const e of led2[season] ?? []) if (mine.has(e >> 1)) { compared++; if (mine.get(e >> 1) === (e & 1)) same++; }
    assert.ok(compared >= 5, "at least five shared duels");
    assert.equal(pct, Math.round((100 * same) / compared), `the match (${pct} %) equals ${same}/${compared} from the ledgers`);
    assert.equal(await p2.evaluate(() => localStorage.getItem("affinix.challenge")), null, "a played challenge is forgotten");
    assert.notEqual((await p2.textContent('[data-testid="arena-share-url"]')).trim(), url, "'send your own' is a new link");

    // 5. the landing invitation for a signed-out visitor, in Kazakh; a malformed link shows nothing
    const p3 = await open();
    await p3.goto(`${BASE}?v=landing&l=kk&c=${c}`);
    await p3.waitForSelector('[data-testid="challenge-invite"]', { timeout: 15000 });
    assert.match(await p3.textContent(".ar-invite-card h1"), /Нурлан сізді талғам дуеліне шақырады/);
    await p3.screenshot({ path: `${OUT}/5-landing-invite-kk.png` });
    const p4 = await open();
    await p4.goto(`${BASE}?v=landing&c=1.202611.zzzz-1-2-3-4.`);
    await p4.waitForSelector(".lp-root", { timeout: 15000 });
    assert.equal(await p4.locator('[data-testid="challenge-invite"]').count(), 0, "a malformed link is ignored");

    assert.deepEqual(errors, [], "no script errors");
    console.log(`E2E OK: welcome, round, share link, friend's match ${pct}% (${same}/${compared}), invitation. Pictures: ${OUT}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("E2E FAILED:", e.message ?? e); process.exit(1); });
