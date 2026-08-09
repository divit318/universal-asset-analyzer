/* Evaluate JS on a page: node audit/visual/eval.mjs <route> <js-file-or-inline> [width] */
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const [, , route, fnArg, widthArg] = process.argv;
const width = Number(widthArg ?? 1440);
const src = existsSync(fnArg) ? readFileSync(fnArg, "utf8") : fnArg;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto((process.env.UAA_BASE ?? "http://localhost:3000") + route, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2500);
const result = await page.evaluate(src);
console.log(JSON.stringify(result, null, 2));
await browser.close();
