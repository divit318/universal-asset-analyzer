/* Console error check: node audit/visual/console.mjs <routes-csv> [width] */
import { chromium } from "playwright-core";

const routes = (process.argv[2] ?? "/").split(",");
const width = Number(process.argv[3] ?? 1440);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`[${page.url()}] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => errors.push(`[pageerror ${page.url()}] ${String(e).slice(0, 200)}`));
for (const r of routes) {
  await page.goto((process.env.UAA_BASE ?? "http://localhost:3000") + r, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
