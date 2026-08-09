import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
const rows = [];
page.on('requestfinished', async (req) => {
  const res = await req.response();
  const timing = req.timing();
  rows.push({ url: req.url().replace('http://localhost:3000',''), method: req.method(), status: res?.status(), start: +(timing.startTime? (timing.startTime): 0).toFixed(0), dur: +(timing.responseEnd).toFixed(0), type: req.resourceType(), size: (await res?.body().catch(()=>null))?.length ?? null });
});
await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(15000);
rows.sort((a,b)=>a.start-b.start);
console.log(JSON.stringify(rows.filter(r=>r.type==='fetch'||r.type==='xhr'||r.type==='document'||r.url.includes('/api/')), null, 1));
console.log('TOTAL requests:', rows.length, 'js:', rows.filter(r=>r.type==='script').length, 'js bytes:', rows.filter(r=>r.type==='script').reduce((s,r)=>s+(r.size||0),0));
await browser.close();
