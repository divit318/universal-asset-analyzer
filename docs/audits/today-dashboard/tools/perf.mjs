import { chromium } from '@playwright/test';
const runs = [];
const browser = await chromium.launch();
for (let i = 0; i < 3; i++) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const apiTimes = {};
  page.on('requestfinished', async (req) => {
    if (req.url().includes('/api/')) {
      const t = req.timing();
      apiTimes[req.url().replace('http://localhost:3000','')] = Math.round(t.responseEnd);
    }
  });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(20000);
  const metrics = await page.evaluate(() => new Promise((resolve) => {
    const nav = performance.getEntriesByType('navigation')[0];
    let cls = 0;
    for (const e of performance.getEntriesByType('layout-shift')) if (!e.hadRecentInput) cls += e.value;
    const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const longTasks = performance.getEntriesByType('longtask') || [];
    const tbt = longTasks.reduce((s,t)=>s+Math.max(0,t.duration-50),0);
    resolve({
      ttfb: Math.round(nav.responseStart), domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: lcp ? Math.round(lcp.startTime) : null, cls: +cls.toFixed(4), tbt: Math.round(tbt),
      jsHeap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null,
    });
  }));
  runs.push({ run: i, ...metrics, apiTimes });
  await page.close();
}
console.log(JSON.stringify(runs, null, 1));
await browser.close();
