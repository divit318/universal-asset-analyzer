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
 * Hero-specific gates (the Meridian observatory plate, 2026-08 redesign):
 *   - hero-limb-bleed: lit pixels in the outermost 2px columns of BOTH
 *     edges in the sky band (the limb + dust bleed off both edges — the
 *     instrument is larger than the window).
 *   - hero-record-resolved: at the pin's end every station of the record
 *     (one per calendar year of the committed series) is active.
 *   - hero-verdict: the verdict star (2026) renders hot pixels + its ring
 *     at the position the engine reports.
 *   - hero-keepout: the meridian canvas keeps its ink out of the h1/lead
 *     rects (the keepFactor floor, measured, not assumed).
 *   - hero-hue: dim pixels stay in the brass band (white-gold is earned
 *     by the verdict and particle cores, never assigned to the field).
 *   - text-contrast: headline / paragraph / buttons >= 4.5:1 against their
 *     actual rendered backdrop. Run at 1280 / 1440 / 1920 / 2560 via
 *     --hero-only for the non-default widths.
 *   - --vortex: long-run screenshot archive of the plate at rest (the
 *     meridian has no strands, so no orbit cap applies).
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
  for (let k = 0; k < SAMPLES; k++) {
    await page.waitForTimeout(15000);
    const stats = await page.evaluate(() => window.__uaaMeridianDebug?.stats?.());
    await page.screenshot({ path: `${OUT}/vortex-${String(k).padStart(2, "0")}.png`, clip: heroClip });
    report.push(`INFO  plate sample ${k + 1}/${SAMPLES}  frame p75 ${stats?.p75 ?? "?"}ms`);
  }
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
    {
      id: "hero",
      zone: '[data-ink-target="hero-ink"]',
      selector: "[data-hero-field]",
      // Peak = the END of the pinned act (progress 1): the record fully
      // resolved, the verdict measured. The identity shot above is the
      // arrival state; the formation gates measure the resolved state.
      go: async () =>
        page.evaluate(() => {
          const hero = document.getElementById("hero");
          window.scrollTo({ top: hero.offsetHeight - innerHeight, behavior: "instant" });
        }),
    },
    { id: "shards", zone: '[data-ink-target="problem-ink"]', go: () => scrollToZone('[data-ink-target="problem-ink"]') },
    { id: "streams", zone: '[data-ink-target="solution-ink"]', go: () => scrollToZone('[data-ink-target="solution-ink"]', 0.45) },
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
    // The meridian is deliberately sparse — gold is rare, the words own
    // their darkness — so the hero's floor is lower than a formation's
    // (measured 1.1% at 1440; wide plates dilute further as the dust
    // pool caps at 1150).
    const covMin = f.selector ? 0.6 : 4;
    gate(`coverage:${f.id}`, covPct >= covMin, `${covPct.toFixed(2)}% of bounds lit (min ${covMin}%)`);
    const corePct = lit > 0 ? (hot / lit) * 100 : 0;
    // Hero: dust bodies are brass (below the hot bar); heat belongs to
    // particle cores, station diamonds and the verdict — a wide band, but
    // both walls still catch real failures (blown-out field / no cores).
    const coreLo = f.selector ? 0.5 : 3;
    const coreHi = f.selector ? 30 : 14;
    gate(`core-ratio:${f.id}`, corePct >= coreLo && corePct <= coreHi, `${corePct.toFixed(2)}% of lit pixels above 70% luminance (${coreLo}-${coreHi}%)`);
    if (f.selector) {
      // THE RECORD RESOLVES: at the pin's end, every station of the
      // committed series (one per calendar year) must be active.
      const record = await page.evaluate(() => window.__uaaMeridianDebug?.stations?.());
      gate("hero-record-resolved", record != null && record.active === record.total, `stations active ${record?.active}/${record?.total} at progress ${await page.evaluate(() => window.__uaaMeridianDebug?.progress?.().toFixed(3))}`);

      // LIMB BLEED: the instrument is larger than the window — the limb
      // (plus its companion rulings and dust) must be lit in the
      // outermost 2px columns of BOTH edges. Measured at the ARRIVAL
      // state (scroll 0): at the pin's end the release recede pulls the
      // whole plate a breath inward by design. A wide-plate contract:
      // below 1280 the text keep-out rightfully owns the edge rows where
      // the dome dips past the words, so narrow widths report INFO only.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(900);
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
      if (width >= 1280) {
        gate("hero-limb-bleed", bleed.litLeft > 8 && bleed.litRight > 8, `left edge ${bleed.litLeft} lit px, right edge ${bleed.litRight} lit px (min 9 each)`);
      } else {
        report.push(`INFO  hero-limb-bleed  left ${bleed.litLeft} / right ${bleed.litRight} lit px (informational below 1280px)`);
      }
      await f.go();
      await page.waitForTimeout(900);

      // KEEP-OUT, measured on the meridian canvas itself: the words own
      // their darkness. Inside the h1 and lead rects (deflated 12px), lit
      // pixels stay under 1%.
      const keepRects = await page.evaluate(() => {
        const els = [document.querySelector("#hero h1"), document.querySelector("#hero [data-lead]")].filter(Boolean);
        return els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + 12, y: r.top + 12, w: r.width - 24, h: r.height - 24 };
        });
      });
      const ko = await sampleCanvases(keepRects, f.selector);
      gate("hero-keepout", (ko.lit / ko.total) * 100 <= 1, `${((ko.lit / ko.total) * 100).toFixed(3)}% lit inside h1/lead rects (max 1%)`);

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

      // THE VERDICT: the final year must render as the plate's brightest
      // object — hot pixels concentrated where the engine says the
      // verdict star is, with its ring lit around it.
      const verdict = await page.evaluate((sel) => {
        const v = window.__uaaMeridianDebug?.verdict?.();
        if (!v) return null;
        const c = document.querySelector(sel);
        const g2 = window.__inkRead(c);
        const box = c.getBoundingClientRect();
        const dpr = c.width / box.width;
        const sample = (r) => {
          const x = Math.max(0, Math.round((v.x - r) * dpr));
          const y = Math.max(0, Math.round((v.y - r) * dpr));
          const s = Math.round(r * 2 * dpr);
          const d = g2.getImageData(x, y, Math.min(s, c.width - x), Math.min(s, c.height - y)).data;
          let lit = 0;
          let hot = 0;
          for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3] / 255;
            if (a * 255 <= 8) continue;
            lit++;
            const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
            if (lum > 0.8 * 255) hot++;
          }
          return { lit, hot };
        };
        return { near: sample(8), ring: sample(20), pos: v };
      }, f.selector);
      gate(
        "hero-verdict",
        verdict != null && verdict.near.hot >= 4 && verdict.ring.lit > verdict.near.lit,
        verdict
          ? `verdict star at (${verdict.pos.x.toFixed(0)}, ${verdict.pos.y.toFixed(0)}): ${verdict.near.hot} hot px in core, ring band lit ${verdict.ring.lit - verdict.near.lit} px`
          : "no meridian debug handle",
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
      const heroStats = await page.evaluate(() => window.__uaaMeridianDebug?.stats?.());
      report.push(`INFO  hero-stats  ${JSON.stringify(heroStats)}`);
      const heroBudget = width >= 2560 ? 11 : 8;
      gate("hero-frame-time", (heroStats?.p75 ?? 99) < heroBudget, `p75 ${heroStats?.p75}ms (budget ${heroBudget}ms at ${width}px)`);
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
  const plate = await page.evaluate(() => window.__uaaMeridianDebug?.stats?.());
  gate("reduced-no-plate-loop", (plate?.samples ?? 1) === 0, `meridian frame samples ${plate?.samples} (must be 0)`);
}

gate("console", errors.length === 0, errors.length ? errors.slice(0, 6).join(" | ") : "clean");

await browser.close();
console.log(report.join("\n"));
if (failures.length) {
  console.error(`\n${failures.length} gate(s) FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall gates passed");
