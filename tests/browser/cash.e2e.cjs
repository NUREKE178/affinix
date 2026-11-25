// Arena cash end to end: the real screens in Chromium, every database call answered by a REAL PostgreSQL with all the
// migrations (0001-0027) applied, as the person named by ?u= (auth.uid()).
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres node tests/browser/cash.e2e.cjs
// Needs: a local PostgreSQL 16 (see tests/sql/run.sh) and Playwright with Chromium. Pictures go to $TMPDIR/affinix-cash-shots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(os.tmpdir(), "affinix-cash-shots");
const DB = "affinix_cash_e2e";
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const OWNER = "00000000-0000-0000-0000-00000000e001";
const AIGERIM = "00000000-0000-0000-0000-00000000e003";
const NEWBIE = "00000000-0000-0000-0000-00000000e004";
const DAUREN = "00000000-0000-0000-0000-00000000e005";

// a fresh database: the migrations, then the people and tests of cash-seed.sql
execFileSync(path.join(ROOT, "tests/sql/run.sh"), [path.join(__dirname, "cash-seed.sql")], { env: { ...process.env, TEST_DB: DB }, stdio: "inherit" });

const lit = (v) => (v === null || v === undefined ? "null" : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`);
function callDb(name, args, uid) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) return Promise.resolve({ error: { message: "bad function name" } });
  const named = Object.entries(args ?? {}).filter(([k]) => /^p_[a-z_]+$/.test(k)).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  const sql = `select set_config('request.jwt.claim.sub', ${lit(uid ?? "")}, false); select coalesce(to_jsonb(r)::text, 'null') from ${name}(${named}) r;`;
  return new Promise((resolve) => {
    execFile("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", sql], { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) {
        const message = (stderr.match(/ERROR:\s+(.*)/) ?? [])[1] ?? String(stderr || err.message);
        const hint = (stderr.match(/HINT:\s+(.*)/) ?? [])[1] ?? null;
        resolve({ error: { message, hint, code: /does not exist/.test(message) ? "42883" : null } });
        return;
      }
      const lines = stdout.trim().split("\n");
      resolve({ data: JSON.parse(lines[lines.length - 1]) });
    });
  });
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      if (req.method === "POST" && url.pathname === "/__rpc") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", async () => {
          const { name, args, uid } = JSON.parse(body);
          const out = await callDb(name, args, uid);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(out));
        });
        return;
      }
      const file = url.pathname.startsWith("/__h/") ? path.join(__dirname, url.pathname.slice(5)) : path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      let body = fs.readFileSync(file);
      if (file.endsWith(".html")) body = Buffer.from(body.toString().replaceAll("__ORIGIN__", `http://${req.headers.host}`));
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const sql = (q) => execFileSync("psql", ["-X", "-q", "-At", "-d", DB, "-c", q]).toString().trim();
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, " ").trim();
// tiyn -> "10,32 ₸" the way the ru / kk screens write it (formatMoney: sign after, decimals only when there are any)
const kzt = (tiyn) => `${(Number(tiyn) / 100).toFixed(Number(tiyn) % 100 ? 2 : 0).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;

(async () => {
  const server = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}/__h/harness-db.html`;
  const browser = await chromium.launch();
  const errors = [];
  const checks = [];
  const ok = (cond, msg) => { assert.ok(cond, msg); checks.push(msg); };
  const open = async (query, viewport = { width: 1280, height: 900 }, hash = "") => {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto(`${BASE}?${query}${hash}`);
    await page.waitForSelector('[data-testid="arena-page"], [data-testid="admin-cash"], .lp-root', { timeout: 20000 });
    return page;
  };
  try {
    // 1. Aigerim (eligible, nothing earned yet): the wallet tab before any bonus
    const a = await open(`u=${AIGERIM}&name=Aigerim&l=kk`, undefined, "#/app/arena?tab=wallet");
    await a.waitForSelector('[data-testid="wallet-tab"]', { timeout: 20000 });
    const avail0 = await text(a, '[data-testid="wallet-available"]');
    ok(avail0 === "0 ₸", `wallet: starts at 0 ₸ (got ${JSON.stringify(avail0)})`);
    ok((await a.locator('[data-testid="wallet-withdraw"][data-open="false"]').count()) === 1, "wallet: withdrawals shown as not open yet");
    ok((await a.locator('[data-testid="wallet-request"]').count()) === 0, "wallet: no withdraw button while closed");
    ok((await a.locator('[data-testid="wallet-history-empty"]').count()) === 1, "wallet: empty history explained");
    ok((await a.locator('[data-testid="arena-wallet-chip"]').count()) === 0, "header: no wallet chip before the first bonus");
    ok((await text(a, '[data-testid="wallet-how"]')).includes("30"), "wallet: how-to names the 30 duels");
    ok((await text(a, '[data-testid="wallet-rate"]')) === "100 XP = 1 ₸", "wallet: the XP rate is shown");
    ok((await text(a, '[data-testid="wallet-month"]')).includes("3 000 ₸"), "wallet: the monthly limit (3 000 ₸) is shown");
    await a.screenshot({ path: `${OUT}/1-wallet-empty-kk.png`, fullPage: true });

    // 2. the lobby: the funded mission carries its reward; play it
    await a.locator('.sk-tab').first().click();
    await a.waitForSelector('[data-testid="mission-row"]', { timeout: 20000 });
    ok((await a.locator('[data-testid="mission-paid-note"]').count()) === 1, "lobby: paid missions explained");
    const paidRow = a.locator('[data-testid="mission-row"]', { has: a.locator('[data-testid="mission-reward"]') });
    ok((await paidRow.count()) === 1, "lobby: exactly the funded test shows a reward");
    ok((await text(a, '[data-testid="mission-reward"]')).includes("10 ₸"), "lobby: reward is +10 ₸");
    await a.locator('[data-testid="arena-missions"]').screenshot({ path: `${OUT}/2-lobby-paid-mission-kk.png` });
    await paidRow.locator('[data-testid="mission-start"]').click();
    await a.waitForSelector('[data-testid="arena-console"][data-mode="mission"]');
    await a.waitForTimeout(900); // a considered answer, not a reflex (min_answer_ms = 600)
    await a.keyboard.press("1");
    await a.waitForSelector('[data-testid="mission-cash"]', { timeout: 15000 });
    ok((await text(a, '[data-testid="mission-cash"]')).includes("10 ₸"), "console: the answer paid +10 ₸");
    await a.screenshot({ path: `${OUT}/3-mission-paid-kk.png` });
    ok(sql(`select count(*) from cash_ledger where user_id = '${AIGERIM}' and kind = 'earn' and state = 'pending' and amount = 1000`) === "1", "db: one pending 1000-tiyn bonus");
    ok(sql(`select cash_spent from arena_tests where id = 'e0000000-0000-0000-0000-000000000001'`) === "1000", "db: the test's budget is charged");
    const xpGain = Number(sql(`select sum(xp) from arena_test_votes where voter_id = '${AIGERIM}'`));
    ok(sql(`select coalesce(sum(amount), 0) from cash_ledger where user_id = '${AIGERIM}' and source = 'xp'`) === String(xpGain), `db: the mission's ${xpGain} XP became ${xpGain} tiyn`);
    await a.click('[data-testid="arena-next"]');
    await a.waitForSelector('[data-testid="arena-summary"][data-mode="mission"]');
    ok((await text(a, '[data-testid="arena-summary"]')).replace(/\s/g, "").includes("10₸"), "summary: the bonus tile");
    await a.screenshot({ path: `${OUT}/4-mission-summary-kk.png` });
    await a.click('[data-testid="arena-done"]');

    // 3. the header chip and the wallet after the bonus
    await a.waitForSelector('[data-testid="arena-wallet-chip"]', { timeout: 15000 });
    const owed = Number(sql(`select sum(amount) from cash_ledger where user_id = '${AIGERIM}'`));
    ok((await text(a, '[data-testid="arena-wallet-chip"]')).includes(kzt(owed)), `header: the chip shows ${kzt(owed)} (bonus + XP)`);
    await a.click('[data-testid="arena-wallet-chip"]');
    await a.waitForSelector('[data-testid="wallet-tab"]');
    ok((await text(a, '[data-testid="wallet-pending"]')).includes(kzt(owed)), `wallet: ${kzt(owed)} pending`);
    ok((await text(a, '[data-testid="wallet-month"]')).includes(kzt(owed)), "wallet: counted in this month");
    ok((await a.locator('[data-testid="wallet-row"]').count()) === 2, "wallet: two history lines (the mission, the day's XP)");
    ok((await a.locator('[data-testid="wallet-row"][data-kind="xp"]').count()) === 1, "wallet: the XP of the day is one line");
    ok((await text(a, '[data-testid="wallet-history"]')).includes("Кофехана логотипі"), "wallet: the mission row names the test");
    await a.screenshot({ path: `${OUT}/5-wallet-after-kk.png`, fullPage: true });

    // 4. an unfunded mission pays XP only and says nothing about money
    await a.locator('.sk-tab').first().click();
    await a.waitForSelector('[data-testid="mission-row"]');
    await a.locator('[data-testid="mission-row"]').first().locator('[data-testid="mission-start"]').click();
    await a.waitForSelector('[data-testid="arena-console"][data-mode="mission"]');
    await a.waitForTimeout(900);
    await a.keyboard.press("2");
    await a.waitForSelector('[data-testid="arena-xp"]', { timeout: 15000 });
    ok((await a.locator('[data-testid="mission-cash"], [data-testid="mission-cash-reason"]').count()) === 0, "unfunded: no money line at all");
    await a.close();

    // 5. a brand-new account answers the funded test: the answer counts, the bonus waits, and the screen says why
    const n = await open(`u=${NEWBIE}&name=New&l=ru`);
    await n.waitForSelector('[data-testid="mission-row"]', { timeout: 20000 });
    await n.locator('[data-testid="mission-row"]', { has: n.locator('[data-testid="mission-reward"]') }).locator('[data-testid="mission-start"]').click();
    await n.waitForSelector('[data-testid="arena-console"][data-mode="mission"]');
    await n.waitForTimeout(900);
    await n.keyboard.press("1");
    await n.waitForSelector('[data-testid="mission-cash-reason"]', { timeout: 15000 });
    ok((await text(n, '[data-testid="mission-cash-reason"]')).includes("Новый аккаунт"), "new account: the reason is shown (ru)");
    ok(sql(`select count(*) from cash_ledger where user_id = '${NEWBIE}'`) === "0", "db: no bonus for a new account");
    await n.screenshot({ path: `${OUT}/6-new-account-ru.png` });
    await n.close();

    // 6. Dauren (on review) sees why his bonus is not released, in English, on a phone
    const d = await open(`u=${DAUREN}&name=Dauren&l=en`, { width: 390, height: 844 }, "#/app/arena?tab=wallet");
    await d.waitForSelector('[data-testid="wallet-tab"][data-status="review"]', { timeout: 20000 });
    ok((await text(d, '[data-testid="wallet-status"]')).includes("under review"), "review: explained (en)");
    ok((await text(d, '[data-testid="wallet-available"]')).includes("15"), "review: the already-available 15 ₸ stays");
    ok((await d.locator('[data-testid="wallet-row"]').count()) === 2, "review: both history rows");
    await d.screenshot({ path: `${OUT}/7-wallet-review-en-phone.png`, fullPage: true });
    await d.close();

    // 7. the owner's Bonuses tab: what is owed, fund a test, clear a review
    const o = await open(`v=admin-cash&u=${OWNER}&name=Owner&l=kk`);
    await o.waitForSelector('[data-testid="admin-cash-kpis"]', { timeout: 20000 });
    const allPending = sql(`select sum(amount) from cash_ledger where kind = 'earn' and state = 'pending'`);
    ok((await text(o, '[data-testid="cash-kpi-pending"]')).includes(kzt(allPending)), `admin: pending = ${kzt(allPending)} (missions + XP)`);
    ok((await text(o, '[data-testid="admin-cash-rules"]')).includes("3 000 ₸") && (await text(o, '[data-testid="admin-cash-rules"]')).includes("100 XP = 1 ₸"), "admin: the monthly limit and the XP rate in the rules");
    ok((await o.locator('[data-testid="admin-cash-test"][data-funded="true"]').count()) === 1, "admin: one funded test listed");
    await o.screenshot({ path: `${OUT}/8-admin-cash-kk.png`, fullPage: true });
    await o.locator('[data-testid="admin-cash-test"][data-funded="false"]').first().locator('[data-testid="admin-cash-fund"]').click();
    await o.fill('[data-testid="admin-fund-reward"]', "5");
    await o.fill('[data-testid="admin-fund-budget"]', "500");
    ok((await text(o, '[data-testid="admin-fund-answers"]')).includes("94"), "admin: a 500 ₸ budget with 30 ₸ already spent covers 94 answers at 5 ₸");
    await o.screenshot({ path: `${OUT}/9-admin-fund-kk.png` });
    await o.click('[data-testid="admin-fund-save"]');
    await o.waitForFunction(() => document.querySelectorAll('[data-testid="admin-cash-test"][data-funded="true"]').length === 2, null, { timeout: 15000 });
    ok(sql(`select cash_reward || '/' || cash_budget from arena_tests where id = 'e0000000-0000-0000-0000-000000000002'`) === "500/50000", "db: funded at 500 tiyn / 50000 tiyn");
    ok(sql(`select count(*) from admin_audit where action = 'cash_fund_test'`) === "1", "db: funding audited");
    await o.locator('[data-testid="admin-cash-account"][data-status="review"] [data-testid="admin-cash-approve"]').click();
    await o.click('[data-testid="admin-cash-status-yes"]');
    await o.waitForFunction(() => !document.querySelector('[data-testid="admin-cash-account"][data-status="review"]'), null, { timeout: 15000 });
    ok(sql(`select status from cash_accounts where user_id = '${DAUREN}'`) === "ok", "db: review cleared");
    await o.close();

    // 8. the landing page explains who gains what, in Kazakh
    const l = await open(`v=landing&l=kk`, { width: 1280, height: 900 });
    await l.waitForSelector('[data-testid="landing-benefits"]');
    ok((await l.locator('[data-testid="landing-benefits"] .lp-bf').count()) === 3, "landing: three audiences");
    ok((await text(l, '[data-testid="landing-earn"]')).includes("Банкке шығару әлі ашылған жоқ"), "landing: honest about withdrawals");
    await l.locator('[data-testid="landing-benefits"]').scrollIntoViewIfNeeded();
    await l.waitForTimeout(900);
    await l.locator('[data-testid="landing-benefits"]').screenshot({ path: `${OUT}/10-landing-benefits-kk.png` });
    await l.close();

    assert.deepEqual(errors, [], "no script errors");
    console.log(`CASH E2E OK: ${checks.length} checks. Pictures: ${OUT}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("CASH E2E FAILED:", e.message ?? e); process.exit(1); });
