/* Privacy-section verification: contrast from sampled pixels, CLS, console.
   node audit/privacy-audit.mjs [--light] [--reduced] */
import { chromium } from "playwright";

const light = process.argv.includes("--light");
const reduced = process.argv.includes("--reduced");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: reduced ? "reduce" : "no-preference",
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const console_ = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console_.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => console_.push(`pageerror: ${e.message}`));

await page.addInitScript(() => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
});

await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
// Scroll through the page to the section (real scroll, so reveals + CLS fire).
await page.evaluate(async () => {
  const target = document.getElementById("privacy");
  const top = target.getBoundingClientRect().top + scrollY;
  for (let y = 0; y <= top + 400; y += 300) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 40));
  }
  target.scrollIntoView({ block: "start", behavior: "instant" });
});
await page.waitForTimeout(2600);

const cls = await page.evaluate(() => window.__cls);

// Collect every visible text element in the section.
const elements = await page.evaluate(() => {
  const out = [];
  const root = document.getElementById("privacy");
  const els = root.querySelectorAll("h2, p, span, li, code, pre");
  let i = 0;
  for (const el of els) {
    // Only leaf-ish elements with direct text.
    const direct = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!direct) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    out.push({
      id: i++,
      text: el.textContent.trim().slice(0, 48).replace(/\s+/g, " "),
      tag: el.tagName.toLowerCase(),
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      rect: { x: r.x, y: r.y + scrollY, w: r.width, h: r.height },
    });
  }
  return out;
});

// Full-page screenshot once; decode it in-page on a canvas (no image deps)
// and histogram each element's region from the real rendered pixels.
const shot = await page.screenshot({ fullPage: true });
const bgSamples = await page.evaluate(
  async ([b64, els]) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const out = {};
    for (const el of els) {
      const x0 = Math.max(0, Math.floor(el.rect.x) - 4);
      const y0 = Math.max(0, Math.floor(el.rect.y) - 4);
      const w = Math.min(img.width - x0, Math.ceil(el.rect.w) + 8);
      const h = Math.min(img.height - y0, Math.ceil(el.rect.h) + 8);
      const d = g.getImageData(x0, y0, w, h).data;
      const hist = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        hist.set(key, (hist.get(key) ?? 0) + 1);
      }
      out[el.id] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    return out;
  },
  [shot.toString("base64"), elements],
);

function parseColor(c) {
  const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
}
function lum({ r, g, b }) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
}

const results = [];
for (const el of elements) {
  // The modal color of the element's region is the background (text pixels
  // are the minority), sampled from real rendered pixels.
  const bgKey = bgSamples[el.id];
  const [br, bg_, bb] = bgKey.split(",").map(Number);
  const bgc = { r: br, g: bg_, b: bb };
  const fg = parseColor(el.color);
  // Composite semi-transparent text color over the sampled background.
  const comp =
    fg.a < 1
      ? {
          r: fg.r * fg.a + bgc.r * (1 - fg.a),
          g: fg.g * fg.a + bgc.g * (1 - fg.a),
          b: fg.b * fg.a + bgc.b * (1 - fg.a),
        }
      : fg;
  const r = ratio(comp, bgc);
  const large = el.fontSize >= 24 || (el.fontSize >= 18.66 && el.fontWeight >= 700);
  const min = large ? 3 : 4.5;
  results.push({ ...el, bg: bgKey, ratio: +r.toFixed(2), min, pass: r >= min });
}

const fails = results.filter((r) => !r.pass);
console.log(`THEME=${light ? "light" : "dark"} REDUCED=${reduced} CLS=${cls.toFixed(4)}`);
console.log(`text elements: ${results.length}, contrast failures: ${fails.length}`);
for (const f of fails) {
  console.log(`FAIL ${f.tag} "${f.text}" ${f.color} on rgb(${f.bg}) = ${f.ratio} (min ${f.min})`);
}
const worst = [...results].sort((a, b) => a.ratio - b.ratio).slice(0, 6);
console.log("lowest ratios:");
for (const w of worst) console.log(`  ${w.ratio} (min ${w.min}) ${w.tag} "${w.text}"`);
if (console_.length) console.log("CONSOLE:", JSON.stringify(console_, null, 1));
else console.log("CONSOLE: clean");
await browser.close();
