// Renders the personal tab of the profile on phones and a desktop; checks it does not scroll sideways, the controls are not squeezed, and the save bar
// appears only after an edit (and goes after discarding). Screenshots go to the temp folder.   node tests/browser/profile-preview.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
let origin = "";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = url.pathname.startsWith("/__h/") ? path.join(__dirname, url.pathname.slice(5)) : path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith(".html")) body = Buffer.from(body.toString().replaceAll("__ORIGIN__", origin));
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }); res.end(body);
});
server.listen(0, "127.0.0.1", async () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [name, w, h, mobile] of [["phone", 390, 800, true], ["narrow", 360, 740, true], ["desktop", 1100, 900, false]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${origin}/__h/profile-preview.html?u=u1`);
      await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
      await page.waitForTimeout(300);
      assert.deepEqual(errors, [], `${name}: page errors`);
      const m = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll(".pf input:not([type=file]):not([type=email]), .pf select, .pf textarea")].map((e) => e.getBoundingClientRect().width);
        const bar = document.querySelector('[data-testid="profile-savebar"]');
        return { docW: document.documentElement.scrollWidth, vw: innerWidth, minInput: Math.min(...inputs), barShown: getComputedStyle(bar).visibility !== "hidden", avatar: document.querySelector(".pf-avatar").getBoundingClientRect().width };
      });
      assert.ok(m.docW <= m.vw, `${name}: the page scrolls sideways (${m.docW} > ${m.vw})`);
      assert.ok(m.minInput >= (mobile ? w - 120 : 200), `${name}: a field is squeezed to ${Math.round(m.minInput)}px`);
      assert.equal(m.barShown, false, `${name}: the save bar shows before any change`);
      await page.screenshot({ path: path.join(os.tmpdir(), `profile-${name}.png`), fullPage: true });
      await page.locator('.pf-sec input').nth(2).fill("Founder");
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="profile-savebar"]')).visibility), "visible", `${name}: the save bar does not appear after an edit`);
      const barBox = await page.evaluate(() => { const r = document.querySelector('[data-testid="profile-savebar"]').getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, right: r.right, vw: innerWidth }; });
      assert.ok(barBox.bottom <= barBox.vh && barBox.right <= barBox.vw, `${name}: the save bar is cut off`);
      await page.screenshot({ path: path.join(os.tmpdir(), `profile-${name}-dirty.png`) });
      await page.click(".pf-discard");
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="profile-savebar"]')).visibility), "hidden", `${name}: the save bar stays after discarding`);
      // the other tabs: same plates, no sideways scroll, nothing cut off
      for (const tab of ["security", "notifications", "preferences", "sessions"]) {
        await page.goto(`${origin}/__h/profile-preview.html?u=u1&tab=${tab}`);
        await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
        await page.waitForTimeout(250);
        const w2 = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth, plates: document.querySelectorAll(".pf-sec").length }));
        assert.ok(w2.docW <= w2.vw, `${name}/${tab}: the page scrolls sideways (${w2.docW} > ${w2.vw})`);
        assert.ok(w2.plates >= 1, `${name}/${tab}: no plate rendered`);
        assert.deepEqual(errors, [], `${name}/${tab}: page errors`);
        await page.screenshot({ path: path.join(os.tmpdir(), `profile-${name}-${tab}.png`), fullPage: true });
      }
      await ctx.close();
    }
    console.log("PROFILE PAGE OK: no sideways scroll, fields full width, the save bar comes with an edit and goes with a discard (screenshots in", os.tmpdir() + ")");
  } finally { await browser.close(); server.close(); }
});
