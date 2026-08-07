import { chromium } from "@playwright/test";
const b = await chromium.launch();
const page = await b.newPage();
await page.goto("http://localhost:3000/compare?symbols=AAPL,MSFT,NVDA", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
// find the dark: variant element from compare page (yellow warning may not render); instead inject test element
const res = await page.evaluate(() => {
  const el = document.createElement("span");
  el.className = "text-yellow-600 dark:text-yellow-400 light:text-teal-700";
  el.textContent = "x";
  document.body.appendChild(el);
  const get = () => getComputedStyle(el).color;
  document.documentElement.setAttribute("data-theme", "dark");
  const dark = get();
  document.documentElement.setAttribute("data-theme", "light");
  const light = get();
  return { dark, light };
});
console.log(res);
await b.close();
