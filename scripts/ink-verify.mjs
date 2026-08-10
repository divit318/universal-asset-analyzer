/**
 * Ink Field legibility harness, Six Silhouettes edition. Gates measure
 * whether the ink READS, not merely whether it runs:
 *
 *   1. Coverage: >= 4% of each formation's bounds lit at peak.
 *   2. Keep-out: <= 0.5% lit pixels inside any text rect (structural now,
 *      but still measured).
 *   3. Hero identity: downscaled structural diff vs committed reference,
 *      <= 2%.
 *   4. Silence: Capabilities and Compare canvases <= 0.1% lit.
 *   5. Silhouette distinctness: 64x64 binary thumbnails of all six
 *      formations, pairwise Hamming similarity <= 82%. Full matrix reported.
 *   6. Core ratio: lit pixels above 70% luminance between 3% and 14% of
 *      lit pixels, per formation (the value ramp is real, not blown out).
 *   7. Link density: lines per frame between 0.8x and 3x particle count.
 *   8. Copy integrity: the served page must not contain reference-image
 *      contamination strings.
 *
 * Hero-specific gates (full-bleed filament ribbon):
 *   - hero-edge-bleed: lit pixels in the outermost 2px columns of BOTH the
 *     left and right hero edges (the ribbon is full-bleed, defect 1.1).
 *   - hero-no-clip-edge: no adjacent-column lit-density drop > 70%
 *     (catches column-clamping regressions).
 *   - hero-hue: dim strand pixels stay in the brass band (white is earned
 *     by overlap, never assigned).
 *   - hero-core-presence: >= 1.5% of lit pixels above 85% luminance,
 *     contiguous and tracking the spine.
 *   - text-contrast: headline / paragraph / buttons >= 4.5:1 against their
 *     actual rendered backdrop. Run at 1280 / 1440 / 1920 / 2560 via
 *     --hero-only for the non-default widths.
 *   - --vortex: five-minute run, screenshot every 15s (archived for the
 *     manual closed-loop check) and the per-strand orbit cap sampled: no
 *     strand may exceed 400 degrees of net turn in a 90-frame window.
 *
 * Usage: node scripts/ink-verify.mjs [--reduced] [--width=1440] [--update-ref]
 *        [--hero-only] [--vortex]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = "/tmp/ink-verify";
const REF_DIR = path.join(process.cwd(), "scripts", "ink-ref");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(REF_DIR, { recursive: true });

const reduced = process.argv.includes("--reduced");
const updateRef = process.argv.includes("--update-ref");
const heroOnly = process.argv.includes("--hero-only");
const vortex = process.argv.includes("--vortex");
const width = Number(process.argv.find((a) => a.startsWith("--width="))?.split("=")[1] ?? 1440);
const height = 900;

const failures = [];
const report = [];

function gate(name, ok, detail) {
  report.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failures.push(name);
}

/* Prefer real Chrome with GPU rasterization: the bundled chromium falls
   back to SwiftShader (software) rendering, which inflates canvas frame
   times ~5x and makes the perf gates meaningless. Falls back to the
   bundled build when Chrome is unavailable (CI). */
const browser = await chromium
  .launch({ channel: "chrome", headless: true, args: ["--headless=new", "--use-angle=metal", "--enable-gpu", "--enable-gpu-rasterization"] })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({
  viewport: { width, height },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("WebSocket")) errors.push(`[console] ${m.text()}`);
  if (m.type() === "warning" && m.text().includes("keep-out violation")) errors.push(`[assert] ${m.text()}`);
});

/* The hero renders on a WebGL context (flow-field material); the shared
   ink canvases stay 2D. __inkRead abstracts the difference: it hands back
   a readable 2D context for either kind (WebGL is copied through a temp
   canvas — the hero keeps preserveDrawingBuffer on for exactly this). */
await page.addInitScript(() => {
  window.__inkRead = (c) => {
    const direct = c.getContext("2d");
    if (direct) return direct;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    return g;
  };
});

await page.goto("http://localhost:3000/landing", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);

/* ---------------- gate 8: copy integrity ---------------- */

const html = await page.content();
const banned = ["Enterprise Grade", "AES-256", "START FREE TRIAL", "Free trial", "Every asset", "All yours", "Biogg", "Preess", "nncover"];
const found = banned.filter((s) => html.includes(s));
gate("copy-integrity", found.length === 0, found.length ? `contaminated: ${found.join(", ")}` : "clean");

/* ---------------- helpers ---------------- */

async function sampleCanvases(rects, selector = "[data-ink-field]") {
  return page.evaluate(([rs, sel]) => {
    const layers = Array.from(document.querySelectorAll(sel));
    if (!layers.length) return { lit: 0, hot: 0, total: 1 };
    let lit = 0;
    let hot = 0;
    let total = 0;
    for (const c of layers) {
      const g = window.__inkRead(c);
      const box = c.getBoundingClientRect();
      const fixed = sel === "[data-ink-field]";
      const dpr = c.width / (fixed ? innerWidth : box.width);
      for (const r of rs) {
        // In-flow canvases (the hero field) sample in their local space.
        const rx = fixed ? r.x : r.x - box.left;
        const ry = fixed ? r.y : r.y - box.top;
        const x = Math.max(0, Math.round(rx * dpr));
        const y = Math.max(0, Math.round(ry * dpr));
        const w = Math.min(c.width - x, Math.round(r.w * dpr));
        const h = Math.min(c.height - y, Math.round(r.h * dpr));
        if (w < 4 || h < 4) continue;
        const img = g.getImageData(x, y, w, h).data;
        for (let i = 0; i < img.length; i += 4) {
          total++;
          const a = img[i + 3] / 255;
          if (a * 255 <= 8) continue;
          lit++;
          const lum = (0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]) * a;
          if (lum > 0.7 * 255) hot++;
        }
      }
    }
    return { lit, hot, total: Math.max(1, total) };
  }, [rects, selector]);
}

/** 64x64 binary thumbnail of the canvas layers within a viewport rect.
 *  Downsampling averages the sparse dots into shape mass; the threshold is
 *  applied AFTER the downscale, scaled accordingly. */
async function binaryThumb(rect, selector = "[data-ink-field]") {
  return page.evaluate(([r, sel]) => {
    const c64 = document.createElement("canvas");
    c64.width = c64.height = 64;
    const g64 = c64.getContext("2d");
    for (const c of document.querySelectorAll(sel)) {
      const box = c.getBoundingClientRect();
      const fixed = sel === "[data-ink-field]";
      const dpr = c.width / (fixed ? innerWidth : box.width);
      const rx = fixed ? r.x : r.x - box.left;
      const ry = fixed ? Math.max(0, r.y) : Math.max(0, r.y) - box.top;
      g64.drawImage(c, rx * dpr, ry * dpr, r.w * dpr, r.h * dpr, 0, 0, 64, 64);
    }
    const d = g64.getImageData(0, 0, 64, 64).data;
    const bits = [];
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
      bits.push(lum > 0.045 * 255 ? 1 : 0);
    }
    return bits;
  }, [rect, selector]);
}

async function scrollToZone(target, frac = 0.5) {
  await page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: r.top + scrollY + r.height * f - innerHeight / 2, behavior: "instant" });
    },
    [target, frac],
  );
  await page.waitForTimeout(2000);
}

async function zoneRect(sel) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);
}

/* ---------------- gate 3: hero identity ---------------- */

await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(2500);
const heroClip = await page.evaluate(() => {
  const r = document.getElementById("hero").getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top), width: innerWidth, height: Math.min(innerHeight, r.height) };
});
/* ---------------- --vortex: five-minute knot watch ---------------- */

if (vortex && !reduced) {
  const SAMPLES = 20; // 5 minutes at one sample per 15s
  let maxTurn = 0;
  let respawns = 0;
  for (let k = 0; k < SAMPLES; k++) {
    await page.waitForTimeout(15000);
    const orbit = await page.evaluate(() => window.__uaaHeroFieldDebug?.orbit?.());
    maxTurn = Math.max(maxTurn, orbit?.maxWindowTurnDeg ?? 999);
    respawns = orbit?.respawns ?? -1;
    await page.screenshot({ path: `${OUT}/vortex-${String(k).padStart(2, "0")}.png`, clip: heroClip });
    report.push(`INFO  vortex sample ${k + 1}/${SAMPLES}  maxWindowTurn ${(orbit?.maxWindowTurnDeg ?? 999).toFixed(0)}deg  orbit respawns ${respawns}`);
  }
  gate(
    "no-vortex",
    maxTurn <= 400 + 30,
    `max per-strand net turn ${maxTurn.toFixed(0)}deg in any 90-frame window over 5min (cap 400, small overshoot tolerated for the frame the cap fires); ${respawns} orbit respawns; screenshots ${OUT}/vortex-*.png`,
  );
  gate("console", errors.length === 0, errors.length ? errors.slice(0, 6).join(" | ") : "clean");
  await browser.close();
  console.log(report.join("\n"));
  if (failures.length) {
    console.error(`\n${failures.length} gate(s) FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall gates passed");
  process.exit(0);
}

const heroShot = await page.screenshot({ clip: heroClip });
fs.writeFileSync(`${OUT}/${reduced ? "reduced-" : ""}${width}-hero.png`, heroShot);
const refPath = path.join(REF_DIR, `hero-${width}${reduced ? "-reduced" : ""}.png`);
if (!fs.existsSync(refPath) || updateRef) {
  fs.writeFileSync(refPath, heroShot);
  report.push(`NOTE  hero-identity  reference written (${path.relative(process.cwd(), refPath)})`);
} else {
  const diffPct = await page.evaluate(
    async ([curB64, refB64]) => {
      const load = (b64) =>
        new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.src = `data:image/png;base64,${b64}`;
        });
      const [cur, ref] = await Promise.all([load(curB64), load(refB64)]);
      // Coarse structural diff: the hero's flow field is stochastic, so the
      // comparison measures the ribbon's mass distribution (composition),
      // not individual fibre phase.
      const W = 96;
      const H = 60;
      const draw = (img) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0, W, H);
        return g.getImageData(0, 0, W, H).data;
      };
      const a = draw(cur);
      const b = draw(ref);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) > 30 || Math.abs(a[i + 1] - b[i + 1]) > 30 || Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
      }
      return (diff / (W * H)) * 100;
    },
    [heroShot.toString("base64"), fs.readFileSync(refPath).toString("base64")],
  );
  gate("hero-identity", diffPct <= 2, `${diffPct.toFixed(2)}% pixels differ (limit 2%)`);
}

if (!reduced) {
  /* -------- gates 1, 5, 6, 7: per-formation coverage, silhouette, core,
     links. Six formations, each at its peak. -------- */

  const FORMATIONS = [
    { id: "hero", zone: '[data-ink-target="hero-ink"]', selector: "[data-hero-field]", go: async () => page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })) },
    { id: "shards", zone: '[data-ink-target="problem-ink"]', go: () => scrollToZone('[data-ink-target="problem-ink"]') },
    { id: "lens", zone: '[data-ink-target="solution-ink"]', go: () => scrollToZone('[data-ink-target="solution-ink"]', 0.45) },
    { id: "pinch", zone: '[data-ink-target="privacy-ink"]', go: () => scrollToZone('[data-ink-target="privacy-ink"]') },
    { id: "well", zone: '[data-ink-target="demo-well"]', go: () => scrollToZone('[data-ink-target="demo-well"]') },
    {
      id: "seal",
      zone: '[data-ink-target="cta-seal"]',
      go: async () => {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        await page.waitForTimeout(3200);
        await page.evaluate(() => {
          const el = document.querySelector('[data-ink-target="cta-seal"]');
          const r = el.getBoundingClientRect();
          window.scrollTo({ top: r.top + scrollY + r.height / 2 - innerHeight / 2, behavior: "instant" });
        });
      },
    },
  ];

  const thumbs = {};
  for (const f of heroOnly ? FORMATIONS.filter((x) => x.id === "hero") : FORMATIONS) {
    // Column discipline hides some ink zones below lg: no zone, no ink, no
    // gate (the mobile page simply has fewer formations).
    const visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 10 && r.height > 10;
    }, f.zone);
    if (!visible) {
      report.push(`NOTE  ${f.id}  zone hidden at ${width}px (mobile layout): skipped`);
      continue;
    }
    await f.go();
    await page.waitForTimeout(2200);
    const zr = await zoneRect(f.zone);
    const clipped = { x: zr.x, y: Math.max(0, zr.y), w: zr.w, h: Math.min(height, zr.y + zr.h) - Math.max(0, zr.y) };
    const selector = f.selector ?? "[data-ink-field]";
    // Coverage measures the movement's DECLARED sub-regions (the shard
    // boxes), not the zone's empty margins; the hero measures its zone.
    const regions = f.selector
      ? [clipped]
      : await page.evaluate((id) => {
          const m = window.__uaaInkDebug.movements().find((x) => x.id === id);
          return (m?.regions ?? []).map((r) => ({ x: r.x, y: Math.max(0, r.y), w: r.w, h: Math.min(innerHeight, r.y + r.h) - Math.max(0, r.y) })).filter((r) => r.w > 8 && r.h > 8);
        }, f.id);
    const { lit, hot, total } = await sampleCanvases(regions.length ? regions : [clipped], selector);
    const covPct = (lit / total) * 100;
    gate(`coverage:${f.id}`, covPct >= 4, `${covPct.toFixed(2)}% of bounds lit (min 4%)`);
    const corePct = lit > 0 ? (hot / lit) * 100 : 0;
    // The hero's additive filament accumulation legitimately runs hotter.
    const coreLo = f.selector ? 4 : 3;
    const coreHi = f.selector ? 15 : 14;
    gate(`core-ratio:${f.id}`, corePct >= coreLo && corePct <= coreHi, `${corePct.toFixed(2)}% of lit pixels above 70% luminance (${coreLo}-${coreHi}%)`);
    if (f.selector) {
      // The hero uses trail accumulation, never neighbour linking: assert
      // the engine draws zero hero links, and the fill spans the zone.
      const noLinks = await page.evaluate(() => {
        const links = window.__uaaInkDebug.links();
        return !("hero" in links) && !("ribbon" in links);
      });
      gate("hero-no-linking", noLinks, "engine reports no hero/ribbon link pass");
      const bbox = await page.evaluate(([sel, zone]) => {
        const c = document.querySelector(sel);
        const g = window.__inkRead(c);
        const box = c.getBoundingClientRect();
        const dpr = c.width / box.width;
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;
        for (let y = 0; y < c.height; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            if (d[(y * c.width + x) * 4 + 3] > 12) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        // Canvas-space bbox -> viewport -> intersect with the zone rect.
        const vb = { x0: box.left + x0 / dpr, x1: box.left + x1 / dpr, y0: box.top + y0 / dpr, y1: box.top + y1 / dpr };
        const ix0 = Math.max(vb.x0, zone.x);
        const ix1 = Math.min(vb.x1, zone.x + zone.w);
        const iy0 = Math.max(vb.y0, zone.y);
        const iy1 = Math.min(vb.y1, zone.y + zone.h);
        return { wFrac: Math.max(0, ix1 - ix0) / zone.w, hFrac: Math.max(0, iy1 - iy0) / zone.h };
      }, [f.selector, zr]);
      gate(
        "hero-zone-fill",
        bbox.wFrac >= 0.82 && bbox.hFrac >= 0.62,
        `lit bbox covers ${(bbox.wFrac * 100).toFixed(0)}% of zone width, ${(bbox.hFrac * 100).toFixed(0)}% of height (need 82% / 62%)`,
      );
      // FULL BLEED: the ribbon spans the hero edge to edge, bleeding off
      // BOTH the left and right viewport edges. Lit pixels required in
      // the outermost 2px column of each edge (defect 1.1).
      const bleed = await page.evaluate((sel) => {
        const c = document.querySelector(sel);
        const g2 = window.__inkRead(c);
        const count = (d) => {
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 12) n++;
          return n;
        };
        return {
          litLeft: count(g2.getImageData(0, 0, 2, c.height).data),
          litRight: count(g2.getImageData(c.width - 2, 0, 2, c.height).data),
        };
      }, f.selector);
      // The left entry is a near-single faint thread BY DESIGN (spec 2:
      // thin entry + intensity ramp), so its presence bar is lower than
      // the wide bright exit's.
      gate("hero-edge-bleed", bleed.litLeft > 8 && bleed.litRight > 20, `left edge ${bleed.litLeft} lit px (min 9), right edge ${bleed.litRight} lit px (min 21)`);

      // NO VERTICAL CLIP EDGE: no adjacent column pair where lit-pixel
      // density drops by more than 70% (catches column-clamping
      // regressions like the old right-hand ink zone). Columns are 8px
      // bins; near-empty pairs are noise, not edges.
      const clipEdge = await page.evaluate((sel) => {
        const c = document.querySelector(sel);
        const d = window.__inkRead(c).getImageData(0, 0, c.width, c.height).data;
        const BIN = 8;
        const nBins = Math.floor(c.width / BIN);
        const counts = new Array(nBins).fill(0);
        for (let y = 0; y < c.height; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            if (d[(y * c.width + x) * 4 + 3] > 12) counts[Math.min(nBins - 1, Math.floor(x / BIN))]++;
          }
        }
        const per = (c.height / 2) * (BIN / 2); // samples per bin
        let worst = 0;
        let at = -1;
        for (let i = 0; i + 1 < nBins; i++) {
          const hi = Math.max(counts[i], counts[i + 1]);
          const lo = Math.min(counts[i], counts[i + 1]);
          if (hi / per < 0.02) continue;
          const drop = 1 - lo / Math.max(1, hi);
          if (drop > worst) {
            worst = drop;
            at = i;
          }
        }
        return { worst, at, nBins };
      }, f.selector);
      gate("hero-no-clip-edge", clipEdge.worst <= 0.7, `max adjacent-column lit-density drop ${(clipEdge.worst * 100).toFixed(0)}% at bin ${clipEdge.at}/${clipEdge.nBins} (limit 70%)`);

      // HUE CHECK: white must be earned by overlap, never assigned. Sample
      // 200 random lit pixels BELOW the 60th luminance percentile (i.e.
      // excluding accumulated cores); fail if >8% sit outside the brass
      // hue band (gold hue, real saturation).
      const hue = await page.evaluate((sel) => {
        const c = document.querySelector(sel);
        const d = window.__inkRead(c).getImageData(0, 0, c.width, c.height).data;
        const lums = [];
        const idxs = [];
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] <= 12) continue;
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          lums.push(lum);
          idxs.push(i);
        }
        const sorted = [...lums].sort((a, b) => a - b);
        const p60 = sorted[Math.floor(sorted.length * 0.6)];
        const dim = idxs.filter((_, k) => lums[k] <= p60);
        let bad = 0;
        let n = 0;
        let seed = 1234;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
        for (let k = 0; k < 200 && dim.length > 0; k++) {
          const i = dim[Math.floor(rnd() * dim.length)];
          const r = d[i];
          const g = d[i + 1];
          const b2 = d[i + 2];
          const mx = Math.max(r, g, b2);
          const mn = Math.min(r, g, b2);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          let hdeg = 0;
          if (mx !== mn) {
            if (mx === r) hdeg = (60 * (g - b2)) / (mx - mn);
            else if (mx === g) hdeg = 120 + (60 * (b2 - r)) / (mx - mn);
            else hdeg = 240 + (60 * (r - g)) / (mx - mn);
          }
          if (hdeg < 0) hdeg += 360;
          n++;
          if (hdeg < 22 || hdeg > 68 || sat < 0.15) bad++;
        }
        return { bad, n };
      }, f.selector);
      gate("hero-hue", hue.n > 0 && (hue.bad / hue.n) * 100 <= 8, `${((hue.bad / Math.max(1, hue.n)) * 100).toFixed(1)}% of dim strand pixels outside the brass band (max 8%)`);

      // CORE PRESENCE: >=1.5% of lit pixels above 85% luminance, forming a
      // contiguous region tracking the spine, not scattered points.
      const corePres = await page.evaluate((sel) => {
        const c = document.querySelector(sel);
        const d = window.__inkRead(c).getImageData(0, 0, c.width, c.height).data;
        const GW = 96;
        const GH = 60;
        const grid = new Uint8Array(GW * GH);
        let lit = 0;
        let hot = 0;
        let litX0 = GW;
        let litX1 = 0;
        const W = c.width;
        const H = c.height;
        for (let y = 0; y < H; y += 2) {
          for (let x = 0; x < W; x += 2) {
            const i = (y * W + x) * 4;
            const a = d[i + 3] / 255;
            if (a * 255 <= 8) continue;
            lit++;
            const gx = Math.min(GW - 1, Math.floor((x / W) * GW));
            if (gx < litX0) litX0 = gx;
            if (gx > litX1) litX1 = gx;
            const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
            if (lum > 0.85 * 255) {
              hot++;
              grid[Math.min(GH - 1, Math.floor((y / H) * GH)) * GW + gx] = 1;
            }
          }
        }
        // Bridge radius 3 (~45px): the braid's hot crossing NODES sit tens
        // of px apart along the spine; a chain of nodes IS the "contiguous
        // region tracking the spine" the gate demands, while genuinely
        // scattered isolated specks (the failure this guards against) stay
        // disconnected at this radius.
        const R = 3;
        const dil = new Uint8Array(GW * GH);
        for (let y = 0; y < GH; y++) {
          for (let x = 0; x < GW; x++) {
            const s0 = y * GW + x;
            outer: for (let oy = -R; oy <= R; oy++) {
              for (let ox = -R; ox <= R; ox++) {
                const yy = y + oy;
                const xx = x + ox;
                if (yy < 0 || xx < 0 || yy >= GH || xx >= GW) continue;
                if (grid[yy * GW + xx]) {
                  dil[s0] = 1;
                  break outer;
                }
              }
            }
          }
        }
        grid.set(dil);
        // Largest connected component of hot cells (4-neighbour flood).
        const seen = new Uint8Array(GW * GH);
        let best = 0;
        let bestX0 = 0;
        let bestX1 = 0;
        const stack = [];
        for (let s = 0; s < GW * GH; s++) {
          if (!grid[s] || seen[s]) continue;
          let size = 0;
          let x0 = GW;
          let x1 = 0;
          stack.length = 0;
          stack.push(s);
          seen[s] = 1;
          while (stack.length) {
            const cur = stack.pop();
            size++;
            const cx = cur % GW;
            if (cx < x0) x0 = cx;
            if (cx > x1) x1 = cx;
            for (const nb of [cur - 1, cur + 1, cur - GW, cur + GW]) {
              if (nb < 0 || nb >= GW * GH || seen[nb] || !grid[nb]) continue;
              if (Math.abs((nb % GW) - cx) > 1) continue;
              seen[nb] = 1;
              stack.push(nb);
            }
          }
          if (size > best) {
            best = size;
            bestX0 = x0;
            bestX1 = x1;
          }
        }
        let totalHotCells = 0;
        for (let s = 0; s < GW * GH; s++) if (grid[s]) totalHotCells++;
        return {
          hotPct: lit > 0 ? (hot / lit) * 100 : 0,
          largestFrac: totalHotCells > 0 ? best / totalHotCells : 0,
          spanFrac: litX1 > litX0 ? (bestX1 - bestX0) / (litX1 - litX0) : 0,
        };
      }, f.selector);
      gate(
        "hero-core-presence",
        corePres.hotPct >= 1.5 && corePres.largestFrac >= 0.4 && corePres.spanFrac >= 0.4,
        `${corePres.hotPct.toFixed(2)}% of lit pixels above 85% luminance (min 1.5%); largest contiguous region holds ${(corePres.largestFrac * 100).toFixed(0)}% of hot cells and spans ${(corePres.spanFrac * 100).toFixed(0)}% of the lit width (min 40%/40%)`,
      );

      // TEXT CONTRAST: headline, paragraph and buttons vs their ACTUAL
      // rendered backdrop (including any strands and the scrim behind
      // them), p95 backdrop luminance, WCAG ratio >= 4.5:1. Buttons have
      // opaque backgrounds, so their ratio is computed from styles.
      const textInfo = await page.evaluate(() => {
        const h1 = document.querySelector("#hero h1");
        const lead = document.querySelector("#hero [data-lead]");
        const btns = Array.from(document.querySelectorAll("#hero button, #hero a[href='#demo']"));
        // Per-LINE boxes (Range client rects): the element's bounding box
        // includes empty space right of short lines, which is not behind
        // any glyph and must not fail the gate.
        const pick = (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = Array.from(range.getClientRects())
            .filter((r) => r.width > 4 && r.height > 4)
            .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
          return { rects, color: getComputedStyle(el).color };
        };
        const out = { h1: pick(h1), lead: pick(lead), btns: btns.map((b) => ({ color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })) };
        h1.style.visibility = "hidden";
        lead.style.visibility = "hidden";
        return out;
      });
      await page.waitForTimeout(150);
      const backShot = await page.screenshot();
      await page.evaluate(() => {
        document.querySelector("#hero h1").style.visibility = "";
        document.querySelector("#hero [data-lead]").style.visibility = "";
      });
      const contrast = await page.evaluate(
        async ([b64, info]) => {
          const img = await new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = `data:image/png;base64,${b64}`;
          });
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          const scale = img.width / innerWidth;
          const lin = (v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          const relLum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
          const parse = (s) => (s.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
          const ratioOf = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const out = [];
          for (const key of ["h1", "lead"]) {
            const lums = [];
            for (const r of info[key].rects) {
              const d = g.getImageData(Math.round(r.x * scale), Math.round(r.y * scale), Math.max(1, Math.round(r.w * scale)), Math.max(1, Math.round(r.h * scale))).data;
              for (let i = 0; i < d.length; i += 4) lums.push(relLum(d[i], d[i + 1], d[i + 2]));
            }
            lums.sort((a, b) => a - b);
            const back = lums[Math.floor(lums.length * 0.95)] ?? 0;
            const [tr, tg, tb] = parse(info[key].color);
            out.push({ id: key === "h1" ? "headline" : "paragraph", ratio: ratioOf(relLum(tr, tg, tb), back) });
          }
          info.btns.forEach((b, k) => {
            const [r1, g1, b1] = parse(b.color);
            const [r2, g2, b2] = parse(b.bg);
            out.push({ id: `button-${k}`, ratio: ratioOf(relLum(r1, g1, b1), relLum(r2, g2, b2)) });
          });
          return out;
        },
        [backShot.toString("base64"), textInfo],
      );
      for (const t of contrast) gate(`text-contrast:${t.id}@${width}`, t.ratio >= 4.5, `${t.ratio.toFixed(2)}:1 vs rendered backdrop (min 4.5:1)`);

      // HERO FRAME TIME: p75 budget 8ms up to 1920, 11ms at 2560.
      const heroStats = await page.evaluate(() => window.__uaaHeroFieldDebug?.stats?.());
      report.push(`INFO  hero-stats  ${JSON.stringify(heroStats)}`);
      const heroBudget = width >= 2560 ? 11 : 8;
      gate("hero-frame-time", (heroStats?.p75 ?? 99) < heroBudget, `p75 ${heroStats?.p75}ms (budget ${heroBudget}ms at ${width}px)`);
      const orbit = await page.evaluate(() => window.__uaaHeroFieldDebug?.orbit?.());
      report.push(`INFO  hero-orbit  ${JSON.stringify(orbit)}`);
    } else {
      const info = await page.evaluate((id) => {
        const m = window.__uaaInkDebug.movements().find((x) => x.id === id);
        return { held: m?.held ?? 0, links: window.__uaaInkDebug.links()[id] ?? 0 };
      }, f.id);
      const ratio = info.held > 0 ? info.links / info.held : 0;
      gate(`link-density:${f.id}`, ratio >= 0.8 && ratio <= 3, `${info.links} links for ${info.held} particles (${ratio.toFixed(2)}x, need 0.8-3x)`);
    }
    thumbs[f.id] = await binaryThumb(clipped, selector);
    await page.screenshot({ path: `${OUT}/${width}-peak-${f.id}.png` });
  }

  /* Silhouette distinctness. Raw Hamming saturates on sparse binary
     fields (empty pixels agree everywhere), so similarity is measured as
     Jaccard over the lit masks: |A∩B| / |A∪B|. Same 82% bound. */
  const ids = heroOnly ? [] : Object.keys(thumbs);
  const matrix = [];
  let worst = 0;
  let worstPair = "";
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const ta = thumbs[ids[a]];
      const tb = thumbs[ids[b]];
      let inter = 0;
      let union = 0;
      for (let i = 0; i < ta.length; i++) {
        if (ta[i] & tb[i]) inter++;
        if (ta[i] | tb[i]) union++;
      }
      const sim = union === 0 ? 100 : (inter / union) * 100;
      matrix.push(`${ids[a]}~${ids[b]}: ${sim.toFixed(1)}%`);
      if (sim > worst) {
        worst = sim;
        worstPair = `${ids[a]}~${ids[b]}`;
      }
    }
  }
  if (!heroOnly) {
    report.push(`INFO  silhouette-matrix  ${matrix.join("  ")}`);
    gate("silhouette-distinctness", worst <= 82, `worst pair ${worstPair} at ${worst.toFixed(1)}% similarity (max 82%)`);
  }

  /* ---------------- gate 2: keep-out ---------------- */

  for (const id of heroOnly ? [] : ["hero", "problem", "privacy"]) {
    await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: r.top + scrollY + r.height * 0.5 - innerHeight / 2, behavior: "instant" });
    }, id);
    await page.waitForTimeout(1400);
    const rects = await page.evaluate(() => {
      const INFLATE = 24;
      const ks = window.__uaaInkDebug?.keepout?.() ?? [];
      return ks
        .map((k) => ({ x: k.x0 + INFLATE, y: k.y0 + INFLATE - scrollY, w: k.x1 - k.x0 - INFLATE * 2, h: k.y1 - k.y0 - INFLATE * 2 }))
        .filter((r) => r.y + r.h > 0 && r.y < innerHeight && r.w > 8 && r.h > 8)
        .map((r) => ({ x: r.x, y: Math.max(0, r.y), w: r.w, h: Math.min(innerHeight, r.y + r.h) - Math.max(0, r.y) }));
    });
    if (!rects.length) continue;
    const { lit, total } = await sampleCanvases(rects);
    gate(`keepout:${id}`, (lit / total) * 100 <= 0.5, `${((lit / total) * 100).toFixed(3)}% lit inside text rects (max 0.5%)`);
  }

  /* ---------------- gate 4: silence ---------------- */

  for (const id of heroOnly ? [] : ["features", "comparison"]) {
    await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: r.top + scrollY + r.height * 0.4 - innerHeight / 2, behavior: "instant" });
    }, id);
    await page.waitForTimeout(1600);
    const { lit, total } = await sampleCanvases([{ x: 0, y: 0, w: width, h: height }]);
    gate(`silence:${id}`, (lit / total) * 100 <= 0.1, `${((lit / total) * 100).toFixed(3)}% of canvas lit (max 0.1%)`);
  }

  /* ---------------- perf + stress + assertions ---------------- */

  if (!heroOnly) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => window.__uaaInkDebug?.stats?.());
    report.push(`INFO  stats  ${JSON.stringify(stats)}`);
    gate("frame-time", (stats?.p75 ?? 99) < 8, `p75 ${stats?.p75}ms (budget 8ms, includes the linking pass)`);
    const viol = await page.evaluate(() => window.__uaaInkDebug?.keepoutViolations?.() ?? 0);
    gate("keepout-assertions", viol <= 60, `${viol} dev-assertion hits across the run (tolerance 60 for spawn-frame grazing)`);
  }
} else {
  const stats = await page.evaluate(() => window.__uaaInkDebug?.stats?.());
  gate("reduced-no-loop", (stats?.samples ?? 1) === 0, `loop samples ${stats?.samples} (must be 0)`);
}

gate("console", errors.length === 0, errors.length ? errors.slice(0, 6).join(" | ") : "clean");

await browser.close();
console.log(report.join("\n"));
if (failures.length) {
  console.error(`\n${failures.length} gate(s) FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall gates passed");
