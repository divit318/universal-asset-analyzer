// Perf baseline harness for docs/redesign/PLAN.md §3/§6.
// Re-run after every redesign phase and compare against the Phase 0 table.
//
// Usage:
//   node scripts/perf-baseline.mjs lcp   [baseURL]   # LCP/TTI for the five heaviest pages
//   node scripts/perf-baseline.mjs fps   [baseURL]   # screener scroll FPS at full universe
//   node scripts/perf-baseline.mjs heap  [baseURL] [minutes]  # heap after a simulated session
//
// Requires a production server (npm run build && npm run start -- -p 3100).

import { chromium } from "@playwright/test";

const mode = process.argv[2] ?? "lcp";
const base = process.argv[3] ?? "http://localhost:3100";
const ROUTES = ["/", "/research", "/screener", "/portfolio", "/ic-report"];
const RUNS = 3;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

async function measureRoute(browser, route) {
  const page = await newPage(browser);
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, fcp: 0, longTasks: [] };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (e.name === "first-contentful-paint") window.__perf.fcp = e.startTime;
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        window.__perf.longTasks.push({ start: e.startTime, end: e.startTime + e.duration });
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(base + route, { waitUntil: "load" });
  // Quiet window for the TTI proxy: wait 5.5s after load, then
  // TTI = max(FCP, end of last long task that precedes a 5s quiet window).
  await page.waitForTimeout(5500);
  const r = await page.evaluate(() => {
    const p = window.__perf;
    let tti = p.fcp;
    for (const t of p.longTasks) tti = Math.max(tti, t.end);
    return { lcp: p.lcp, fcp: p.fcp, tti, longTasks: p.longTasks.length };
  });
  await page.context().close();
  return r;
}

async function runLcp(browser) {
  console.log("route\trun\tFCPms\tLCPms\tTTIms(proxy)\tlongtasks");
  for (const route of ROUTES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await measureRoute(browser, route);
      runs.push(r);
      console.log(`${route}\t${i + 1}\t${r.fcp.toFixed(0)}\t${r.lcp.toFixed(0)}\t${r.tti.toFixed(0)}\t${r.longTasks}`);
    }
    console.log(
      `${route}\tMEDIAN\t${median(runs.map((r) => r.fcp)).toFixed(0)}\t${median(runs.map((r) => r.lcp)).toFixed(0)}\t${median(runs.map((r) => r.tti)).toFixed(0)}`
    );
  }
}

async function runFps(browser) {
  const page = await newPage(browser);
  await page.goto(base + "/screener", { waitUntil: "load" });
  await page.waitForTimeout(8000); // let the full universe load and prices settle
  const rows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.scrollingElement;
        const frames = [];
        let last = performance.now();
        let dir = 1;
        const start = last;
        function tick(t) {
          frames.push(t - last);
          last = t;
          el.scrollTop += 40 * dir;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) dir = -1;
          if (el.scrollTop <= 0) dir = 1;
          if (t - start < 6000) requestAnimationFrame(tick);
          else {
            const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
            const dropped = frames.filter((f) => f > 26).length; // >26ms ≈ missed 60fps frame budget + margin
            resolve({ avgMs: avg, avgFps: 1000 / avg, dropped, total: frames.length });
          }
        }
        requestAnimationFrame(tick);
      })
  );
  console.log(`screener rows rendered: ${rows}`);
  console.log(
    `scroll: avg ${fps.avgFps.toFixed(1)}fps (avg frame ${fps.avgMs.toFixed(1)}ms), ${fps.dropped}/${fps.total} frames >26ms`
  );
  await page.context().close();
}

async function runHeap(browser, minutes) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const until = Date.now() + minutes * 60 * 1000;
  let cycles = 0;
  while (Date.now() < until) {
    for (const route of ROUTES) {
      if (Date.now() >= until) break;
      await page.goto(base + route, { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(4000);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(2000);
    }
    cycles++;
  }
  const heap = await page.evaluate(() => {
    const m = performance.memory;
    return m ? { usedMB: m.usedJSHeapSize / 1048576, totalMB: m.totalJSHeapSize / 1048576 } : null;
  });
  console.log(`simulated session: ${minutes} min, ${cycles} full cycles over ${ROUTES.join(" ")}`);
  console.log(
    heap
      ? `JS heap: ${heap.usedMB.toFixed(1)} MB used / ${heap.totalMB.toFixed(1)} MB total`
      : "performance.memory unavailable"
  );
  await ctx.close();
}

const browser = await chromium.launch();
try {
  if (mode === "lcp") await runLcp(browser);
  else if (mode === "fps") await runFps(browser);
  else if (mode === "heap") await runHeap(browser, Number(process.argv[4] ?? 30));
  else throw new Error(`unknown mode ${mode}`);
} finally {
  await browser.close();
}
