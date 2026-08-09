// Capture the Knowledge Graph scopes at multiple widths for before/after
// verification (docs/kg/03_REPORT.md). Usage: node scripts/kg-screenshot.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "docs/kg/shots";
mkdirSync(out, { recursive: true });

const scopes = [
  ["symbol-AAPL", "/knowledge-graph?scope=symbol&id=AAPL"],
  ["portfolio", "/knowledge-graph?scope=portfolio"],
  ["watchlist", "/knowledge-graph?scope=watchlist"],
  ["sector-Technology", "/knowledge-graph?scope=sector&id=Technology"],
];
const widths = [1440, 1024, 390];

const browser = await chromium.launch();
for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const [name, path] of scopes) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(3200); // let the simulation settle + fit
    await page.screenshot({ path: `${out}/${name}@${width}.png`, fullPage: width === 390 });
    console.log(`${name}@${width} done`);
  }
  await page.close();
}
await browser.close();
