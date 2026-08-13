/* Section screenshot helper:
   node audit/solution-shot.mjs <width> <name> [--light] [--reduced] [--section id] [--settle ms] [--fold]
   Scrolls the target section into view, waits for the reveal + ink to settle,
   and screenshots the section element (clipped to viewport when taller). */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const width = Number(args[0] ?? 1440);
const name = args[1] ?? `solution-${width}`;
const light = args.includes("--light");
const reduced = args.includes("--reduced");
const sIdx = args.indexOf("--section");
const section = sIdx >= 0 ? args[sIdx + 1] : "solution";
const settleIdx = args.indexOf("--settle");
const settle = settleIdx >= 0 ? Number(args[settleIdx + 1]) : 2400;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height: 950 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
if (light) {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}
// Scroll gradually so scroll-linked ink behaves like a real reader arriving.
await page.evaluate(async (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no section #${id}`);
  const top = el.getBoundingClientRect().top + window.scrollY;
  for (let y = 0; y <= top; y += 300) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 30));
  }
  window.scrollTo(0, top - Math.max(0, (window.innerHeight - el.offsetHeight) / 2));
}, section);
await page.waitForTimeout(settle);
const box = await page.evaluate((id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top), width: window.innerWidth, height: Math.min(window.innerHeight - Math.max(0, r.top), r.height) };
}, section);
await page.screenshot({ path: `/tmp/uaa-shots/${name}.png`, clip: box });
if (errors.length) console.log("CONSOLE:", JSON.stringify(errors, null, 1));
console.log(`saved /tmp/uaa-shots/${name}.png`);
await browser.close();
