/* Privacy-section screenshot helper:
   node /tmp/uaa-privacy-shot.mjs <width> <name> [--light] [--reduced] */
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
await page.evaluate(() => document.getElementById("privacy")?.scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(2500);
const el = await page.$("#privacy");
const box = await el.boundingBox();
await page.screenshot({
  path: `/tmp/uaa-privacy-shots/${name}.png`,
  clip: { x: 0, y: Math.max(0, box.y + (await page.evaluate(() => window.scrollY)) - 0), width, height: box.height },
  fullPage: true,
});
if (errors.length) console.log("CONSOLE:", JSON.stringify(errors, null, 1));
console.log(`saved /tmp/uaa-privacy-shots/${name}.png h=${Math.round(box.height)}`);
await browser.close();
