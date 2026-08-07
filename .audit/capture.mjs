/* Light-mode audit capture: screenshots (both themes, 3 viewports) and an
   in-page WCAG contrast sweep. Drives the running dev server at :3000.
   Usage:
     node .audit/capture.mjs shots [themes=dark,light] [widths=1440,1024,390] [only=route1,route2]
     node .audit/capture.mjs contrast [theme=light] [only=...]
*/
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = ".audit/screenshots";

export const ROUTES = [
  ["home", "/"],
  ["wire", "/wire"],
  ["screener", "/screener"],
  ["engine", "/engine"],
  ["thematic", "/thematic"],
  ["research-hub", "/research"],
  ["research-aapl", "/research?symbol=AAPL"],
  ["research-india", "/research/india?symbol=RELIANCE"],
  ["compare-landing", "/compare"],
  ["compare-run", "/compare?symbols=AAPL,MSFT,NVDA"],
  ["valuation", "/valuation?symbol=AAPL"],
  ["valuation-register", "/valuation/register"],
  ["ic-report", "/ic-report?symbol=AAPL"],
  ["knowledge-graph", "/knowledge-graph"],
  ["portfolio", "/portfolio"],
  ["watchlist", "/watchlist"],
  ["calendar", "/calendar"],
  ["journal", "/journal"],
  ["settings", "/settings"],
  ["settings-account", "/settings/account"],
  ["landing", "/landing"],
  ["dev-tokens", "/dev/tokens"],
];

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(k + "="));
  return m ? m.split("=")[1] : d;
};

async function preparePage(context, theme) {
  await context.addInitScript(
    (t) => {
      try {
        localStorage.setItem("uaa-theme", t);
        // Skip the boot splash if it keys off sessionStorage
        sessionStorage.setItem("uaa-boot-seen", "1");
      } catch {}
    },
    theme,
  );
}

async function settle(page) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1800);
  // Boot splash overlay, if present, should have dissolved; force-remove if stuck
  await page
    .evaluate(() => document.querySelectorAll(".uaa-boot-splash").forEach((n) => n.remove()))
    .catch(() => {});
}

async function shots() {
  const themes = arg("themes", "dark,light").split(",");
  const widths = arg("widths", "1440,1024,390").split(",").map(Number);
  const only = arg("only", "");
  const routes = only ? ROUTES.filter(([n]) => only.split(",").includes(n)) : ROUTES;
  const browser = await chromium.launch();
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 900 },
        reducedMotion: "reduce",
      });
      await preparePage(context, theme);
      const page = await context.newPage();
      for (const [name, route] of routes) {
        const dir = path.join(OUT, theme);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${name}@${width}.png`);
        try {
          await page.goto(BASE + route, { timeout: 90000, waitUntil: "domcontentloaded" });
          await settle(page);
          await page.screenshot({ path: file, fullPage: true });
          console.log("ok", theme, width, name);
        } catch (e) {
          console.log("FAIL", theme, width, name, String(e).slice(0, 120));
        }
      }
      await context.close();
    }
  }
  await browser.close();
}

/* ── Contrast sweep ────────────────────────────────────────────────────── */
const CONTRAST_SNIPPET = `(() => {
  const parse = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effBg = (el) => {
    // composite ancestor background-colors bottom-up
    let layers = [];
    let n = el;
    while (n && n instanceof Element) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a >= 1) break;
      n = n.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    let acc = rootBg;
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
    return acc;
  };
  const sel = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; n && n instanceof Element && i < 4; i++) {
      let p = n.tagName.toLowerCase();
      const cls = (n.className && typeof n.className === "string") ? n.className.split(/\\s+/).filter(Boolean).slice(0, 3).join(".") : "";
      if (cls) p += "." + cls;
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const fails = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = t.textContent.replace(/\\s+/g, " ").trim();
    if (!text || text.length < 2) continue;
    const el = t.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const bg = effBg(el);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const r = ratio(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const threshold = large ? 3 : 4.5;
    if (r < threshold - 0.04) {
      const key = sel(el) + "|" + cs.color + "|" + Math.round(r * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      fails.push({
        text: text.slice(0, 60),
        selector: sel(el),
        color: cs.color,
        bg: "rgb(" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + ")",
        ratio: Math.round(r * 100) / 100,
        threshold,
        fontSize: size,
        fontWeight: weight,
      });
    }
  }
  return fails.sort((a, b) => a.ratio - b.ratio);
})()`;

async function contrast() {
  const theme = arg("theme", "light");
  const only = arg("only", "");
  const routes = only ? ROUTES.filter(([n]) => only.split(",").includes(n)) : ROUTES;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await preparePage(context, theme);
  const page = await context.newPage();
  const report = {};
  for (const [name, route] of routes) {
    try {
      await page.goto(BASE + route, { timeout: 90000, waitUntil: "domcontentloaded" });
      await settle(page);
      report[name] = await page.evaluate(CONTRAST_SNIPPET);
      console.log(name, ":", report[name].length, "failures");
    } catch (e) {
      report[name] = { error: String(e).slice(0, 200) };
      console.log("FAIL", name, String(e).slice(0, 120));
    }
  }
  fs.mkdirSync(".audit", { recursive: true });
  fs.writeFileSync(`.audit/contrast-${theme}.json`, JSON.stringify(report, null, 1));
  await browser.close();
}

const mode = process.argv[2];
if (mode === "shots") await shots();
else if (mode === "contrast") await contrast();
else console.log("usage: node .audit/capture.mjs shots|contrast");
