/* Solution section contrast gate: WCAG ratio for every text element in
   #solution, measured against the ACTUAL rendered backdrop (text hidden,
   p95 backdrop luminance per line box), both themes.
   Usage: node audit/solution-contrast.mjs [--light] */
import { chromium } from "playwright";

const light = process.argv.includes("--light");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.evaluate(async () => {
  const el = document.getElementById("solution");
  const top = el.getBoundingClientRect().top + window.scrollY;
  for (let y = 0; y <= top; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
  window.scrollTo(0, top - Math.max(0, (window.innerHeight - el.offsetHeight) / 2));
});
await page.waitForTimeout(4200);

const info = await page.evaluate(() => {
  const sol = document.getElementById("solution");
  const els = Array.from(sol.querySelectorAll("h2, p, span, dt, dd, li")).filter((el) => {
    if (el.querySelector("h2, p, span, dt, dd")) return false; // leaves only
    const t = (el.textContent ?? "").trim();
    if (!t) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= innerHeight;
  });
  const out = els.map((el, i) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 4 && r.height > 4)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
    el.dataset.contrastIdx = String(i);
    return { rects, color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize), weight: getComputedStyle(el).fontWeight, text: el.textContent.trim().slice(0, 36) };
  });
  for (const el of els) el.style.visibility = "hidden";
  return out;
});
await page.waitForTimeout(200);
const shot = await page.screenshot();
const results = await page.evaluate(
  async ([b64, info]) => {
    for (const el of document.querySelectorAll("[data-contrast-idx]")) el.style.visibility = "";
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const relLum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    const parse = (s) => (s.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
    const out = [];
    for (const e of info) {
      const lums = [];
      for (const r of e.rects) {
        const d = g.getImageData(Math.round(r.x * scale), Math.round(r.y * scale), Math.max(1, Math.round(r.w * scale)), Math.max(1, Math.round(r.h * scale))).data;
        for (let i = 0; i < d.length; i += 4) lums.push(relLum(d[i], d[i + 1], d[i + 2]));
      }
      if (!lums.length) continue;
      lums.sort((a, b) => a - b);
      const [tr, tg, tb] = parse(e.color);
      const tl = relLum(tr, tg, tb);
      // Worst-case backdrop: the luminance percentile CLOSEST to the text
      // colour (p95 on dark themes, p5 on light).
      const backHi = lums[Math.floor(lums.length * 0.95)];
      const backLo = lums[Math.floor(lums.length * 0.05)];
      const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      out.push({ text: e.text, size: e.size, weight: e.weight, ratio: Math.min(ratio(tl, backHi), ratio(tl, backLo)) });
    }
    return out;
  },
  [shot.toString("base64"), info],
);

let fail = 0;
for (const r of results.sort((a, b) => a.ratio - b.ratio)) {
  // WCAG AA: 4.5:1 normal, 3:1 for large text (>= 24px, or >= 18.66px bold).
  const large = r.size >= 24 || (r.size >= 18.66 && Number(r.weight) >= 700);
  const min = large ? 3 : 4.5;
  const ok = r.ratio >= min;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.ratio.toFixed(2)}:1 (min ${min})  ${r.size}px/${r.weight}  "${r.text}"`);
}
console.log(fail ? `\n${fail} element(s) FAILED` : "\nall text passes AA");
await browser.close();
process.exit(fail ? 1 : 0);
