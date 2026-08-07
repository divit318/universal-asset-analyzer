/**
 * audit-landing.mjs — headless measurement harness for the marketing landing
 * page. Every layout/verification claim about /landing must cite a number this
 * script produced; "verified visually" is not evidence.
 *
 * Modes:
 *   node scripts/audit-landing.mjs                     # layout report at 5 widths
 *   node scripts/audit-landing.mjs --widths 1440       # subset of widths
 *   node scripts/audit-landing.mjs --runtime           # CLS, long tasks, scripted-scroll frame times, hero canvas stats
 *   node scripts/audit-landing.mjs --reduced-motion    # layout report under prefers-reduced-motion emulation
 *   node scripts/audit-landing.mjs --no-js             # JS disabled: completeness + layout
 *   node scripts/audit-landing.mjs --overlap-sweep     # waypoint overlap test from 375 to 2560
 *   node scripts/audit-landing.mjs --out FILE          # write JSON to FILE (default stdout summary + /tmp/landing-audit.json)
 *
 * Uses the repo's existing Playwright devDependency. Never ships to the client.
 */

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const URL = opt("url", "http://localhost:3000/landing");
const WIDTHS = opt("widths", "1440,1280,1024,768,375").split(",").map(Number);
const OUT = opt("out", "/tmp/landing-audit.json");

/* ------------------------------------------------------------------------- */
/* In-page measurement (serialized into the browser)                          */
/* ------------------------------------------------------------------------- */

function measureLayout() {
  const sections = [...document.querySelectorAll("main section[id]")];
  const report = { sections: {}, measure: {}, lines: {}, rows: {}, trust: [], contrast: [], overlap: [] };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  };

  /* -- DEAD SPACE: scanline union of painted rects inside the content box -- */
  for (const sec of sections) {
    const cs = getComputedStyle(sec);
    const r = sec.getBoundingClientRect();
    const top = r.top + parseFloat(cs.paddingTop);
    const bottom = r.bottom - parseFloat(cs.paddingBottom);
    // Painted content: leaf elements, or elements with their own background/border.
    const rects = [];
    for (const el of sec.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const ecs = getComputedStyle(el);
      const isLeaf = el.children.length === 0 && (el.textContent.trim().length > 0 || ["IMG", "CANVAS", "SVG", "INPUT", "BUTTON"].includes(el.tagName));
      // Elements with their OWN text nodes (mixed inline content) paint too.
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      const er = el.getBoundingClientRect();
      // A large surface (card/panel) hides its internal dead space, so treat
      // only SMALL painted containers as opaque; descend into tall ones.
      const hasBg =
        (ecs.backgroundColor !== "rgba(0, 0, 0, 0)" && ecs.backgroundColor !== "transparent") ||
        ecs.backgroundImage !== "none" ||
        parseFloat(ecs.borderTopWidth) > 0;
      const painted = isLeaf || hasOwnText || (hasBg && er.height < 240);
      if (er.width < 40 || er.height <= 0) continue;
      const decorative = !!el.closest('[aria-hidden="true"]') && !isLeaf && !hasOwnText;
      const tag = el.tagName + "." + String(el.className).slice(0, 50);
      const push = (t, b, tg) => {
        t = Math.max(t, top);
        b = Math.min(b, bottom);
        if (b > t) rects.push({ top: t, bottom: b, tag: tg });
      };
      if (painted) {
        push(er.top, er.bottom, tag);
      } else if (hasBg && !decorative) {
        // Tall bordered/tinted CONTENT container (card/panel): its top and
        // bottom edges paint, so count thin strips there while still
        // descending into it for interior dead space. Decorative full-bleed
        // layers (band dissolve, particle fields) are excluded.
        push(er.top, er.top + 2, tag + "::top-edge");
        push(er.bottom - 2, er.bottom, tag + "::bottom-edge");
      }
    }
    rects.sort((a, b) => a.top - b.top);
    // Merge intervals, find the largest gap (including leading/trailing).
    let cursor = top;
    let cursorTag = "content-box-top";
    let largest = { gap: 0, between: null, atY: null };
    for (const seg of rects) {
      if (seg.top > cursor) {
        const gap = seg.top - cursor;
        if (gap > largest.gap) largest = { gap: Math.round(gap), between: [cursorTag, seg.tag], atY: Math.round(cursor - r.top) };
      }
      if (seg.bottom > cursor) {
        cursor = seg.bottom;
        cursorTag = seg.tag;
      }
    }
    if (bottom > cursor) {
      const gap = bottom - cursor;
      if (gap > largest.gap) largest = { gap: Math.round(gap), between: [cursorTag, "content-box-bottom"], atY: Math.round(cursor - r.top) };
    }
    report.sections[sec.id] = largest;
  }

  /* -- MEASURE: content container width + left offset per section ---------- */
  for (const sec of sections) {
    const container = sec.querySelector("[data-measure]") ?? sec.firstElementChild;
    if (!container) continue;
    const cr = container.getBoundingClientRect();
    report.measure[sec.id] = { left: Math.round(cr.left), width: Math.round(cr.width), token: container.getAttribute("data-measure") ?? "(untagged)" };
  }
  // Footer too
  const footer = document.querySelector("footer [data-measure]");
  if (footer) {
    const fr = footer.getBoundingClientRect();
    report.measure["footer"] = { left: Math.round(fr.left), width: Math.round(fr.width), token: footer.getAttribute("data-measure") };
  }

  /* -- LINE COUNTS for headlines and leads --------------------------------- */
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = [];
    for (const r of range.getClientRects()) {
      if (r.height === 0 || r.width < 4) continue;
      tops.push(r.top);
    }
    tops.sort((a, b) => a - b);
    // Cluster tops with a tolerance of 60% of the font size: rects on one
    // visual line (mixed spans, ascender boxes) collapse to one cluster.
    const tol = parseFloat(getComputedStyle(el).fontSize) * 0.6;
    let lines = 0;
    let lastTop = -Infinity;
    for (const t of tops) {
      if (t - lastTop > tol) {
        lines++;
        lastTop = t;
      }
    }
    return lines;
  };
  for (const sec of sections) {
    const h = sec.querySelector("h1, h2");
    const lead = sec.querySelector("[data-lead]");
    report.lines[sec.id] = {
      headline: h && visible(h) ? lineCount(h) : null,
      headlineText: h ? h.textContent.slice(0, 40) : null,
      lead: lead && visible(lead) ? lineCount(lead) : null,
    };
  }

  /* -- ROW HEIGHTS: capability rows + mockup frames ------------------------ */
  report.rows.capRows = [...document.querySelectorAll("[data-cap-row]")].map((el) => Math.round(el.getBoundingClientRect().height));
  report.rows.frames = [...document.querySelectorAll('section#features [role="img"]')].map((el) => Math.round(el.getBoundingClientRect().height));
  report.rows.markers = [...document.querySelectorAll("[data-illustrative]")].map((el) => {
    const frame = el.closest('[role="img"]')?.querySelector("[data-frame-body]") ?? el.parentElement;
    const fr = frame.getBoundingClientRect();
    const mr = el.getBoundingClientRect();
    return { right: Math.round(fr.right - mr.right), bottom: Math.round(fr.bottom - mr.bottom), opacity: getComputedStyle(el).opacity };
  });

  /* -- TRUST STRIPS --------------------------------------------------------- */
  for (const strip of document.querySelectorAll("[data-trust-strip]")) {
    const sr = strip.getBoundingClientRect();
    const labels = [...strip.querySelectorAll("[data-trust-label]")].filter(visible);
    const baselines = labels.map((l) => Math.round(l.getBoundingClientRect().top)).sort((a, b) => a - b);
    // Below md the strip wraps 2x2; spread is meaningful within a VISUAL row,
    // so cluster baselines (>24px apart = a new row) and take the worst
    // in-row spread.
    let spread = 0;
    let rowStart = baselines[0] ?? 0;
    let rowMax = rowStart;
    for (const b of baselines) {
      if (b - rowStart > 24) {
        spread = Math.max(spread, rowMax - rowStart);
        rowStart = b;
      }
      rowMax = b;
    }
    spread = Math.max(spread, rowMax - rowStart);
    report.trust.push({
      section: strip.closest("section")?.id ?? "?",
      items: strip.querySelectorAll("li").length,
      width: Math.round(sr.width),
      centerOffset: Math.round(sr.left + sr.width / 2 - window.innerWidth / 2),
      baselines,
      baselineSpread: baselines.length ? spread : null,
    });
  }

  /* -- CONTRAST: every visible text node ------------------------------------ */
  const parseColor = (str) => {
    const m = str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const effectiveBg = (el) => {
    let acc = null;
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) acc = acc === null ? c : (acc.a >= 1 ? acc : blend(acc, c));
      if (acc && acc.a >= 1) return acc;
      node = node.parentElement;
    }
    const root = parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 10, g: 11, b: 14, a: 1 };
    return acc ? blend(acc, root) : root;
  };
  const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let tn;
  while ((tn = walker.nextNode())) {
    const el = tn.parentElement;
    if (!el || seen.has(el) || !tn.textContent.trim() || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    let fg = parseColor(cs.color);
    if (!fg) continue;
    const elOpacity = (() => {
      let o = 1;
      let n = el;
      while (n && n !== document.body) {
        o *= parseFloat(getComputedStyle(n).opacity);
        n = n.parentElement;
      }
      return o;
    })();
    const bg = effectiveBg(el);
    if (fg.a < 1 || elOpacity < 1) fg = blend({ ...fg, a: fg.a * elOpacity }, bg);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) {
      report.contrast.push({
        text: tn.textContent.trim().slice(0, 40),
        ratio: Math.round(ratio * 100) / 100,
        ariaHidden: !!el.closest('[aria-hidden="true"]'),
        sel: el.tagName + "." + String(el.className).slice(0, 60),
      });
    }
  }
  report.contrast.sort((a, b) => a.ratio - b.ratio);

  /* -- WAYPOINT OVERLAP ------------------------------------------------------ */
  const wps = [...document.querySelectorAll("[data-waypoint]")].filter(visible);
  for (let i = 0; i < wps.length; i++) {
    for (let j = i + 1; j < wps.length; j++) {
      const a = wps[i].getBoundingClientRect();
      const b = wps[j].getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0 && y > 0) {
        report.overlap.push({ pair: [wps[i].dataset.waypoint, wps[j].dataset.waypoint], x: Math.round(x), y: Math.round(y) });
      }
    }
  }
  report.waypointCount = wps.length;

  return report;
}

/* ------------------------------------------------------------------------- */
/* Runners                                                                    */
/* ------------------------------------------------------------------------- */

async function preparePage(page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  // Wait for hydration (the Reveal system stamps data-reveal after mount) so
  // the scroll pass below actually triggers every IntersectionObserver.
  await page.waitForSelector("[data-reveal]", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);
  // Scroll through so every reveal fires and lazy images load, then settle.
  const h = await page.evaluate(() => document.body.scrollHeight);
  // behavior:"instant" — the page sets scroll-behavior:smooth, which would
  // animate (and effectively swallow) programmatic hops.
  for (let y = 0; y <= h; y += 400) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  // Long settle: signature transitions run up to ~2.2s after a section's
  // reveal (bar growth, findings check-in); measure the final state.
  await page.waitForTimeout(2600);
}

async function layoutMode(browser, { reducedMotion = false, javaScriptEnabled = true } = {}) {
  const out = {};
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 950 },
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
      javaScriptEnabled,
    });
    const page = await ctx.newPage();
    if (javaScriptEnabled) await preparePage(page);
    else {
      await page.goto(URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
    }
    out[width] = await page.evaluate(measureLayout);
    await ctx.close();
  }
  return out;
}

async function overlapSweep(browser) {
  const out = {};
  for (let width = 375; width <= 2560; width += Math.max(65, Math.round(width * 0.08))) {
    const ctx = await browser.newContext({ viewport: { width: Math.min(width, 2560), height: 950 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const wps = [...document.querySelectorAll("[data-waypoint]")].filter(visible);
      const overlaps = [];
      for (let i = 0; i < wps.length; i++)
        for (let j = i + 1; j < wps.length; j++) {
          const a = wps[i].getBoundingClientRect();
          const b = wps[j].getBoundingClientRect();
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 0 && y > 0) overlaps.push([wps[i].dataset.waypoint, wps[j].dataset.waypoint, Math.round(x), Math.round(y)]);
        }
      return { count: wps.length, overlaps };
    });
    out[width] = r;
    await ctx.close();
  }
  return out;
}

async function runtimeMode(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });

  const metrics = await page.evaluate(async () => {
    const result = { cls: 0, longTasks: [], frames: null, hero: null, flowSymmetry: null, wrapAlpha: null };

    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) result.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) result.longTasks.push(Math.round(e.duration));
    }).observe({ type: "longtask", buffered: true });

    // Scripted 10s scroll while sampling frame durations.
    const durations = [];
    let last = performance.now();
    let sampling = true;
    const sample = (now) => {
      durations.push(now - last);
      last = now;
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);

    const total = document.body.scrollHeight - innerHeight;
    const t0 = performance.now();
    const DUR = 10000;
    await new Promise((resolve) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / DUR);
        // Down for the first 60%, back up for the rest, with varying speed.
        const pos = p < 0.6 ? (p / 0.6) * total : total * (1 - (p - 0.6) / 0.4);
        scrollTo({ top: pos, behavior: "instant" });
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    sampling = false;
    durations.sort((a, b) => a - b);
    const q = (p) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))];
    result.frames = {
      count: durations.length,
      p50: Math.round(q(0.5) * 100) / 100,
      p95: Math.round(q(0.95) * 100) / 100,
      worst: Math.round(durations[durations.length - 1] * 100) / 100,
    };

    // Hero canvas instrumentation, if exposed.
    const dbg = window.__uaaHeroDebug;
    if (dbg) {
      result.hero = dbg.stats();
      // Scroll symmetry: N px down then N px up, compare flow.
      scrollTo({ top: 0, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 900));
      const f0 = dbg.flow();
      const N = 800;
      for (let i = 1; i <= 20; i++) { scrollTo({ top: (N / 20) * i, behavior: "instant" }); await new Promise((r) => setTimeout(r, 16)); }
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 19; i >= 0; i--) { scrollTo({ top: (N / 20) * i, behavior: "instant" }); await new Promise((r) => setTimeout(r, 16)); }
      await new Promise((r) => setTimeout(r, 1500));
      const f1 = dbg.flow();
      // Subtract idle drift accumulated during the test window.
      result.flowSymmetry = { start: f0, end: f1, deltaMinusDrift: dbg.symmetryDelta(f0, f1) };
      result.wrapAlpha = dbg.maxWrapAlpha();
    }
    return result;
  });

  await ctx.close();
  return metrics;
}

/* ------------------------------------------------------------------------- */

const browser = await chromium.launch();
let report;
if (flag("runtime")) report = { mode: "runtime", runtime: await runtimeMode(browser) };
else if (flag("overlap-sweep")) report = { mode: "overlap-sweep", sweep: await overlapSweep(browser) };
else if (flag("no-js")) report = { mode: "no-js", layout: await layoutMode(browser, { javaScriptEnabled: false }) };
else if (flag("reduced-motion")) report = { mode: "reduced-motion", layout: await layoutMode(browser, { reducedMotion: true }) };
else report = { mode: "layout", layout: await layoutMode(browser) };
await browser.close();

writeFileSync(OUT, JSON.stringify(report, null, 2));

/* Console summary */
if (report.layout) {
  for (const [width, r] of Object.entries(report.layout)) {
    console.log(`\n=== ${width}px ===`);
    console.log("DEAD SPACE (largest gap per section):");
    for (const [id, g] of Object.entries(r.sections)) {
      const mark = g.gap > 80 ? "  ✘" : "   ";
      console.log(`${mark} ${id.padEnd(12)} ${String(g.gap).padStart(4)}px  ${g.between ? g.between.join("  →  ").slice(0, 90) : ""}`);
    }
    console.log("MEASURE (left/width):", Object.entries(r.measure).map(([id, m]) => `${id}:${m.left}/${m.width}`).join("  "));
    console.log("LINES:", Object.entries(r.lines).filter(([, l]) => l.headline).map(([id, l]) => `${id}:h${l.headline}${l.lead ? "/l" + l.lead : ""}`).join("  "));
    console.log("CAP ROWS:", r.rows.capRows.join(","), "FRAMES:", r.rows.frames.join(","), "MARKERS:", JSON.stringify(r.rows.markers));
    console.log("TRUST:", r.trust.map((t) => `${t.section}[${t.items}] c${t.centerOffset} spread${t.baselineSpread}`).join("  "));
    console.log("CONTRAST <4.5 (non-decorative):", r.contrast.filter((c) => !c.ariaHidden).length, "decorative:", r.contrast.filter((c) => c.ariaHidden).length);
    for (const c of r.contrast.filter((c) => !c.ariaHidden).slice(0, 8)) console.log("    ", c.ratio, JSON.stringify(c.text), c.sel.slice(0, 60));
    console.log("WAYPOINTS:", r.waypointCount, "OVERLAPS:", JSON.stringify(r.overlap));
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}
console.log(`\nFull JSON → ${OUT}`);
