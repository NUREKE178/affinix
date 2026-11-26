// Renders the Styles page on a phone and a desktop and checks the layout rules that were broken (cards fill the width, no sideways scroll,
// no chip wall). Screenshots go to the temp folder.   node tests/browser/styles-preview.cjs
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
      await page.goto(`${origin}/__h/styles-preview.html`);
      await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
      assert.deepEqual(errors, [], `${name}: page errors`);
      const m = await page.evaluate(() => {
        const specs = [...document.querySelectorAll(".sty-grid:not(.sty-grid-dim) .sty-spec")].map((e) => e.getBoundingClientRect());
        const rowTops = [...new Set(specs.map((r) => Math.round(r.top)))];
        const firstRow = specs.filter((r) => Math.round(r.top) === rowTops[0]);
        const panel = document.querySelector(".sty-card").getBoundingClientRect();
        return {
          docW: document.documentElement.scrollWidth, vw: innerWidth,
          perRow: firstRow.length, firstRowRight: Math.max(...firstRow.map((r) => r.right)), panelRight: panel.right,
          filtersH: Math.round(document.querySelector(".sty-filters").getBoundingClientRect().height),
        };
      });
      assert.ok(m.docW <= m.vw, `${name}: the page scrolls sideways (${m.docW} > ${m.vw})`);
      if (mobile) {
        assert.ok(m.perRow >= 2, `${name}: only ${m.perRow} poster per row`);
        assert.ok(m.panelRight - m.firstRowRight < 40, `${name}: the posters leave ${Math.round(m.panelRight - m.firstRowRight)}px of empty space on the right`);
        assert.ok(m.filtersH <= 400, `${name}: the filters take ${m.filtersH}px (a wall of chips)`);
      }
      // "why people chose": the card and a reason under the posters
      const why = await page.evaluate(() => ({ card: !!document.querySelector('[data-testid="styles-why"]'), rows: document.querySelectorAll(".sty-why-row").length, chips: document.querySelectorAll('[data-testid="styles-spec-why"]').length }));
      assert.ok(why.card && why.rows >= 3, `${name}: the "why people chose" card is missing (${JSON.stringify(why)})`);
      await page.screenshot({ path: path.join(os.tmpdir(), `styles-${name}.png`), fullPage: true });
      await ctx.close();
    }
    console.log("STYLES PAGE OK: posters fill the width, no sideways scroll, compact filters (screenshots in", os.tmpdir() + ")");
  } finally { await browser.close(); server.close(); }
});
