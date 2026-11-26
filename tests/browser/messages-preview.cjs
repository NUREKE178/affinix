// Renders the messenger (the real Bubble / Composer / list components on made-up data) on phones; checks nothing scrolls sideways, my bubbles are told apart
// from theirs, and a lone emoji's time sits under it. Screenshots go to the temp folder.   node tests/browser/messages-preview.cjs
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
    for (const [w, h] of [[390, 760], [360, 640]]) {
      for (const pane of ["list", "chat"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${origin}/__h/messages-preview.html?u=u1&pane=${pane}`);
        await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
        await page.waitForTimeout(300);
        const tag = `${w}x${h} ${pane}`;
        assert.deepEqual(errors, [], `${tag}: page errors`);
        const m = await page.evaluate(() => {
          const bg = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundImage : null; };
          const meta = document.querySelector(".sk-bubble.jumbo .sk-bubble-meta"), text = document.querySelector(".sk-bubble.jumbo .sk-bubble-text");
          return { docW: document.documentElement.scrollWidth, vw: innerWidth, mine: bg(".sk-bubble.mine"), theirs: bg(".sk-bubble:not(.mine):not(.jumbo):not(.deleted)"),
            metaBelow: meta && text ? meta.getBoundingClientRect().top >= text.getBoundingClientRect().bottom - 2 : null };
        });
        assert.ok(m.docW <= m.vw, `${tag}: the page scrolls sideways (${m.docW} > ${m.vw})`);
        if (pane === "chat") {
          assert.notEqual(m.mine, m.theirs, `${tag}: my bubbles look the same as theirs`);
          assert.equal(m.metaBelow, true, `${tag}: the time of a lone emoji is not under it`);
        }
        await page.screenshot({ path: path.join(os.tmpdir(), `messages-${w}-${pane}.png`) });
        await ctx.close();
      }
    }
    console.log("MESSENGER PREVIEW OK: no sideways scroll, my bubbles stand apart, a lone emoji's time sits under it (screenshots in", os.tmpdir() + ")");
  } finally { await browser.close(); server.close(); }
});
