import { chromium } from '@playwright/test';
const outDir = process.argv[2] || 'docs/audits/today-dashboard/shots/baseline';
const url = process.argv[3] || 'http://localhost:3000/';
const widths = [[390,844],[768,1024],[1024,768],[1440,900],[2560,1440]];
const browser = await chromium.launch();
for (const [w,h] of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${outDir}/${w}.png`, fullPage: true });
  await page.close();
}
await browser.close();
