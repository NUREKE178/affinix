// An open chat on a phone must fit the screen exactly: the page itself never scrolls, so the chat's own header can never slip under the sticky top bar.
//   node tests/browser/chat-layout.cjs      (needs Playwright + Chromium; no backend)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "../..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = url.pathname.startsWith("/__h/") ? path.join(__dirname, url.pathname.slice(5)) : path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }); res.end(fs.readFileSync(file));
});
const metrics = () => ({
  vh: innerHeight,
  docH: document.documentElement.scrollHeight,
  scrollY: Math.round(scrollY),
  barBottom: Math.round(document.getElementById("bar").getBoundingClientRect().bottom),
  headTop: Math.round(document.getElementById("head").getBoundingClientRect().top),
  composerBottom: Math.round(document.getElementById("composer").getBoundingClientRect().bottom),
  chatBottom: Math.round(document.getElementById("pane").getBoundingClientRect().bottom),
});
server.listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}/__h/chat-layout.html`;
  const browser = await chromium.launch();
  const bad = [];
  try {
    for (const [w, h, bar] of [[390, 780, 68], [360, 640, 68], [412, 915, 88], [390, 420, 68]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
      await page.goto(`${base}?bar=${bar}`);
      await page.waitForFunction(() => window.__ready);
      const tag = `${w}x${h} bar ${bar}`;
      assert.equal(await page.evaluate(() => window.__varsError ?? null), null, `${tag}: layoutVars.js loads`);
      let m = await page.evaluate(metrics);
      assert.ok(m.docH <= m.vh, `${tag}: the page is ${m.docH - m.vh}px taller than the screen (${m.docH} > ${m.vh}), so it can scroll`);
      assert.ok(m.headTop >= m.barBottom, `${tag}: the chat header (top ${m.headTop}) starts above the bottom of the top bar (${m.barBottom})`);
      assert.ok(m.composerBottom <= m.vh, `${tag}: the composer is cut off (${m.composerBottom} > ${m.vh})`);
      // the empty field is one line tall, its hint does not wrap and no scrollbar shows
      const box = await page.evaluate(() => { const i = document.getElementById("input"); return { h: i.getBoundingClientRect().height, sh: i.scrollHeight, ch: i.clientHeight, ov: getComputedStyle(i).overflowY }; });
      assert.ok(box.h <= 44, `${tag}: the empty field is ${box.h}px tall (the hint wraps)`);
      assert.ok(box.sh <= box.ch + 1 && box.ov === "hidden", `${tag}: the empty field has a scrollbar (${box.sh} > ${box.ch}, overflow ${box.ov})`);
      // what used to push the header under the bar: focusing the field and dragging the page
      await page.focus("#input");
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(150);
      m = await page.evaluate(metrics);
      assert.equal(m.scrollY, 0, `${tag}: the page scrolled to ${m.scrollY}px after focus and a drag`);
      assert.ok(m.headTop >= m.barBottom, `${tag}: after focus and a drag the header is under the bar`);
      await page.screenshot({ path: path.join(require("node:os").tmpdir(), `chat-layout-${w}x${h}.png`) });
      await ctx.close();
    }
    // iOS with the keyboard up: the visual viewport is shorter and panned down; the chat must sit exactly on it, field included
    for (const [w, h] of [[390, 780], [360, 640]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(`${base}?bar=68&kb=1`);
      await page.waitForFunction(() => window.__ready);
      const k = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        return { top: Math.round(r("pane").top), bottom: Math.round(r("pane").bottom), left: Math.round(r("pane").left), right: Math.round(r("pane").right), comp: Math.round(r("composer").bottom), headTop: Math.round(r("head").top), vvTop: visualViewport.offsetTop, vvH: visualViewport.height, w: innerWidth };
      });
      const tag = `keyboard ${w}x${h}`;
      assert.equal(k.top, k.vvTop, `${tag}: the chat starts at ${k.top}, the visible area at ${k.vvTop}`);
      assert.equal(k.bottom, k.vvTop + k.vvH, `${tag}: the chat ends at ${k.bottom}, the visible area at ${k.vvTop + k.vvH}`);
      assert.ok(k.left === 0 && k.right === k.w, `${tag}: the chat is not full width (${k.left}..${k.right} of ${k.w})`);
      assert.ok(k.comp <= k.vvTop + k.vvH && k.headTop >= k.vvTop, `${tag}: the field or header is outside the visible area`);
      await page.screenshot({ path: path.join(require("node:os").tmpdir(), `chat-kb-${w}x${h}.png`) });
      await ctx.close();
    }
    // the conversation list (the dock is on screen there) fits the screen too
    for (const [w, h] of [[390, 780], [360, 640]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(`${base}?pane=list&bar=68`);
      await page.waitForFunction(() => window.__ready);
      const m = await page.evaluate(metrics);
      assert.ok(m.docH <= m.vh, `list ${w}x${h}: the page is ${m.docH - m.vh}px taller than the screen`);
      await page.screenshot({ path: path.join(require("node:os").tmpdir(), `chat-layout-list-${w}x${h}.png`) });
      await ctx.close();
    }
    console.log("CHAT LAYOUT OK: the open chat fits the screen at 4 phone sizes (header below the top bar, page never scrolls) and so does the list");
  } catch (e) {
    console.error("CHAT LAYOUT FAILED:", e.message ?? e);
    process.exitCode = 1;
  } finally {
    if (bad.length) { console.error(bad.join("\n")); process.exitCode = 1; }
    await browser.close(); server.close();
  }
});
