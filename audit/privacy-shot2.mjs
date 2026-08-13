/* Viewport-sized capture (no fullPage stitching): resize viewport to the
   section's height, then plain screenshot. node audit/privacy-shot2.mjs
   <width> <name> [--light] [--reduced] */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const width = Number(args[0] ?? 1440);
const name = args[1] ?? `privacy-${width}`;
const light = args.includes("--light");
const reduced = args.includes("--reduced");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height: 1000 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
let h = await page.evaluate(() => Math.ceil(document.getElementById("privacy").getBoundingClientRect().height));
await page.setViewportSize({ width, height: h + 4 });
await page.evaluate(() => document.getElementById("privacy").scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(2500);
// Height can change after the viewport resize re-runs clamp()s; re-measure.
h = await page.evaluate(() => Math.ceil(document.getElementById("privacy").getBoundingClientRect().height));
await page.setViewportSize({ width, height: h + 4 });
await page.evaluate(() => document.getElementById("privacy").scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(400);
await page.screenshot({ path: `/tmp/uaa-privacy-shots/${name}.png` });
if (errors.length) console.log("CONSOLE:", JSON.stringify(errors, null, 1));
console.log(`saved /tmp/uaa-privacy-shots/${name}.png h=${h}`);
await browser.close();
