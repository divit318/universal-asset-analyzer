/* Element-level screenshot: node audit/visual/clip.mjs <route> <selector> <out> [width] */
import { chromium } from "playwright-core";

const [, , route, selector, out, widthArg] = process.argv;
const width = Number(widthArg ?? 1440);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto((process.env.UAA_BASE ?? "http://localhost:3000") + route, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2500);
const el = page.locator(selector).first();
await el.screenshot({ path: out });
console.log("ok", out);
await browser.close();
