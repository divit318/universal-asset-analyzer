#!/usr/bin/env node
/**
 * Real-browser benchmark of the Research page verdict path.
 *
 * Measures, from navigation start:
 *  - every relevant API request's start + finish (bundle, portfolio report, ai/report)
 *  - when the AI verdict's first useful content (headline text) renders in the DOM
 *  - when the thesis paragraph renders
 *
 * Usage: node scripts/research-page-bench.mjs SYMBOL [--base URL]
 */
import { chromium } from "playwright";

const symbol = process.argv[2] ?? "AAPL";
const baseIdx = process.argv.indexOf("--base");
const base = baseIdx !== -1 ? process.argv[baseIdx + 1] : "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage();

let t0 = 0;
const ms = () => (Date.now() - t0).toString().padStart(6);
const log = (line) => console.log(`${ms()}ms  ${line}`);

page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/")) {
    const u = new URL(url);
    log(`→ request  ${u.pathname}?${u.searchParams.toString().slice(0, 120)}`);
  }
});
page.on("response", (res) => {
  const url = res.url();
  if (/\/api\/(ai\/verdict|portfolio\/report|fundamentals)/.test(url)) {
    log(`← response ${new URL(url).pathname} (${res.status()})`);
  }
  if (/\/api\/research\/bundle/.test(url)) log(`← response headers /api/research/bundle (${res.status()})`);
  if (/\/api\/ai\/report/.test(url)) log(`← response headers /api/ai/report (${res.status()})`);
});
page.on("requestfinished", (req) => {
  const url = req.url();
  if (url.includes("/api/")) log(`✓ finished ${new URL(url).pathname}`);
});
page.on("requestfailed", (req) => {
  const url = req.url();
  if (url.includes("/api/")) log(`✗ FAILED   ${new URL(url).pathname} — ${req.failure()?.errorText}`);
});
page.on("console", (msg) => {
  const text = msg.text();
  if (/verdict|report|error/i.test(text)) log(`[console] ${text.slice(0, 140)}`);
});

t0 = Date.now();
await page.goto(`${base}/research?symbol=${encodeURIComponent(symbol)}`, { waitUntil: "commit" });
log("navigation committed");

// First useful verdict content: the AI headline (font-semibold in the hero) or
// deterministic score badge. Track several milestones.
const milestones = [
  { name: "hero score badge (deterministic)", sel: ".uaa-cursor-sheen .font-mono.text-2xl" },
  { name: "verdict skeleton visible", sel: 'text="Building the investment verdict"' },
  { name: "AI headline rendered", sel: ".uaa-cursor-sheen p.text-base.font-semibold" },
  { name: "AI thesis rendered", sel: ".uaa-cursor-sheen p.mb-5.text-sm:not(.text-muted)" },
  { name: "AI tension rendered", sel: ".uaa-cursor-sheen p.border-l-2" },
];
await Promise.allSettled(
  milestones.map(async (m) => {
    try {
      await page.waitForSelector(m.sel, { timeout: 90_000, state: "visible" });
      log(`★ ${m.name}`);
    } catch {
      log(`✗ ${m.name} — never appeared within 90s`);
    }
  }),
);

// Give the stream a moment to finish, then capture the headline text.
try {
  const headline = await page.textContent(".uaa-cursor-sheen p.text-base.font-semibold", { timeout: 5000 });
  log(`headline: ${headline?.slice(0, 90)}`);
} catch { /* none */ }

await browser.close();
