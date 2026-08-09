/* Viewport screenshots at scroll offsets: node audit/visual/viewport.mjs <route> <outPrefix> <offsets> [width] */
import { chromium } from "playwright-core";

const [, , route, prefix, offsetsArg, widthArg] = process.argv;
const offsets = (offsetsArg ?? "0").split(",").map(Number);
const width = Number(widthArg ?? 1440);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto((process.env.UAA_BASE ?? "http://localhost:3000") + route, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2500);
for (const y of offsets) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${prefix}-y${y}.png` });
  console.log(`ok ${prefix}-y${y}.png`);
}
await browser.close();
