/**
 * shot-features.mjs — capture the Capabilities (feature showcase) strip on
 * /landing at a set of widths in both themes. Phase harness for the feature
 * panels rebuild; never ships to the client.
 *
 * Usage: node scripts/shot-features.mjs [--out DIR] [--widths 1920,1440,...]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = opt("out", "/tmp/features-shots");
const WIDTHS = opt("widths", "1920,1440,1024,768,390").split(",").map(Number);
const URL = opt("url", "http://localhost:3000/landing");

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 1200 },
      reducedMotion: "reduce",
    });
    await ctx.addInitScript((t) => {
      try { localStorage.setItem("uaa-theme", t); } catch {}
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", localStorage.getItem("uaa-theme") || "dark"));
    const section = page.locator("#features");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await section.screenshot({ path: `${OUT}/features-${theme}-${width}.png` });
    console.log(`captured features-${theme}-${width}.png`);
    await ctx.close();
  }
}
await browser.close();
