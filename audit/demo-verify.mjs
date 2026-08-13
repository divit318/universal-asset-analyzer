/* Try It section interaction verification:
   node audit/demo-verify.mjs <scenario> <width> <name> [--light] [--reduced]
   scenarios: preload | run:SYMBOL | error:SYMBOL | cls | contrast */
import { chromium } from "playwright";

const [scenario = "preload", widthArg = "1440", name = "verify"] = process.argv.slice(2);
const width = Number(widthArg);
const light = process.argv.includes("--light");
const reduced = process.argv.includes("--reduced");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height: 1100 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  const t = m.text();
  if ((m.type() === "error" || m.type() === "warning") && !t.includes("GL Driver Message")) errors.push(`${m.type()}: ${t}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
if (light) await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await page.evaluate(() => document.getElementById("demo")?.scrollIntoView({ block: "start", behavior: "instant" }));
await page.waitForTimeout(3000);

async function shoot(suffix) {
  const el = await page.$("#demo");
  const box = await el.boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: `/tmp/uaa-demo-shots/${name}${suffix ? "-" + suffix : ""}.png`,
    clip: { x: 0, y: box.y + scrollY, width, height: Math.min(box.height, 4000) },
    fullPage: true,
  });
  console.log(`saved ${name}${suffix ? "-" + suffix : ""}.png h=${Math.round(box.height)}`);
}

if (scenario === "preload") {
  await shoot("");
} else if (scenario.startsWith("mockerr:")) {
  // The two failure states that cannot be triggered on demand against live
  // sources (no_data, source_down): intercept the demo route and return the
  // exact NDJSON error event the server emits, then render the UI state.
  const code = scenario.split(":")[1];
  const messages = {
    no_data:
      "Yahoo Finance doesn't publish a fund profile for MOCKFUND.NS (common for India-listed ETFs and mutual funds), so the fund engine has nothing honest to score. Try the US-listed equivalent, or an NSE equity like RELIANCE.NS.",
    source_down: "The market data source didn't answer. That's the feed, not the engines. Try again in a few seconds.",
  };
  await page.route("**/api/landing/demo**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", code, message: messages[code] }) + "\n",
    }),
  );
  await page.fill("#demo-ticker", "MOCKFUND.NS");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  await shoot("done");
} else if (scenario.startsWith("run:") || scenario.startsWith("error:")) {
  const symbol = scenario.split(":")[1];
  await page.fill("#demo-ticker", symbol);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(180);
  await shoot("progress");
  await page.waitForTimeout(4000);
  await shoot("done");
} else if (scenario === "cls") {
  const cls = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 2500);
      }),
  );
  console.log("CLS (page load + scroll to demo):", cls);
  await page.click('button:has-text("SPY")');
  const cls2 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift" });
        setTimeout(() => resolve(total), 4000);
      }),
  );
  console.log("CLS (SPY live run, excluding recent-input window):", cls2);
} else if (scenario === "contrast") {
  // Resolve every color through a canvas (handles oklab/color-mix/alpha) and
  // composite the ancestor background stack under each text element.
  const samples = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const cx = canvas.getContext("2d", { willReadFrequently: true });
    const toRgba = (color) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#fff";
      cx.fillStyle = color; // invalid colors keep #fff; fine for an audit
      cx.fillRect(0, 0, 1, 1);
      return [...cx.getImageData(0, 0, 1, 1).data];
    };
    const composite = (top, bottom) => {
      const a = top[3] / 255;
      return [0, 1, 2].map((i) => Math.round(top[i] * a + bottom[i] * (1 - a))).concat([255]);
    };
    const section = document.getElementById("demo");
    const out = [];
    const seen = new Set();
    for (const el of section.querySelectorAll("p, span, li, button, input, label")) {
      if (!el.textContent?.trim() || el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      const key = `${cs.color}|${cs.fontSize}|${cs.fontWeight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Background stack: page base, then every ancestor with paint, bottom-up.
      const layers = [];
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "transparent" && !bg.includes("0, 0, 0, 0")) layers.unshift(toRgba(bg));
        node = node.parentElement;
      }
      layers.unshift(toRgba(getComputedStyle(document.documentElement).backgroundColor));
      layers.unshift([255, 255, 255, 255]);
      let bg = layers[0];
      for (let i = 1; i < layers.length; i++) bg = composite(layers[i], bg);
      const fg = composite(toRgba(cs.color), bg);
      out.push({ text: el.textContent.trim().slice(0, 32), fg, bg, size: cs.fontSize, weight: cs.fontWeight });
    }
    return out;
  });
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  for (const s of samples) {
    const [l1, l2] = [lum(s.fg), lum(s.bg)];
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(s.size);
    const large = px >= 24 || (px >= 18.66 && Number(s.weight) >= 700);
    const min = large ? 3 : 4.5;
    console.log(`${ratio.toFixed(2)}:1 ${ratio >= min ? "PASS" : "FAIL"} [${s.size}/${s.weight}] "${s.text}" fg=rgb(${s.fg.slice(0, 3)}) bg=rgb(${s.bg.slice(0, 3)})`);
  }
}

if (errors.length) console.log("CONSOLE:", JSON.stringify(errors, null, 1));
await browser.close();
