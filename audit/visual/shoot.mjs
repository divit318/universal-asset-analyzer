/* Visual-audit screenshot harness. Read-only navigation against the running
   dev server. Usage: node audit/visual/shoot.mjs [outDir] [widths] [routes] */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.UAA_BASE ?? "http://localhost:3000";
const outDir = process.argv[2] ?? "audit/visual/shots";
const widths = (process.argv[3] ?? "1440").split(",").map(Number);
const routes = (
  process.argv[4] ??
  "/,/portfolio,/research,/screener,/wire,/compare,/watchlist,/calendar,/valuation,/engine,/ic-report,/thematic,/journal,/knowledge-graph,/settings,/landing"
).split(",");

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const width of widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    for (const route of routes) {
      const name = route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "_");
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({
          path: path.join(outDir, `${name}@${width}.png`),
          fullPage: true,
        });
        console.log(`ok ${name}@${width}`);
      } catch (e) {
        console.log(`FAIL ${name}@${width}: ${e.message?.slice(0, 120)}`);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
