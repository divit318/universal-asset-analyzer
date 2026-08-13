/* Demo-section screenshot helper:
   node audit/demo-shot.mjs <width> <name> [--light] [--reduced] [--full] */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const width = Number(args[0] ?? 1440);
const name = args[1] ?? `demo-${width}`;
const light = args.includes("--light");
const reduced = args.includes("--reduced");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height: 1100 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.evaluate(() => document.getElementById("demo")?.scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(2500);
const el = await page.$("#demo");
const box = await el.boundingBox();
const scrollY = await page.evaluate(() => window.scrollY);
await page.screenshot({
  path: `/tmp/uaa-demo-shots/${name}.png`,
  clip: { x: 0, y: box.y + scrollY, width, height: box.height },
  fullPage: true,
});
if (errors.length) console.log("CONSOLE:", JSON.stringify(errors, null, 1));
console.log(`saved /tmp/uaa-demo-shots/${name}.png h=${Math.round(box.height)}`);
await browser.close();
