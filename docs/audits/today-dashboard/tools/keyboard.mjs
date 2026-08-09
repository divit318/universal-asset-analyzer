import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(12000);
const order = [];
for (let i = 0; i < 40; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, boxShadow: cs.boxShadow !== 'none',
      href: el.getAttribute('href') };
  });
  order.push(info);
}
console.log(JSON.stringify(order, null, 0));
// Escape/other key handlers?
const palette = await page.keyboard.press('Meta+k').then(async () => {
  await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('[role="dialog"], [data-command-palette], dialog'));
});
console.log('cmdK opens palette:', palette);
await browser.close();
