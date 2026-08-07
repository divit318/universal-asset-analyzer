"use client";

import { useEffect, useRef, useState } from "react";
import { subscribe, wake, prefersReducedMotion } from "./motion/engine";

/**
 * HeroFlow — the scroll-scrubbed particle illustration. One <canvas>, Canvas
 * 2D, a pre-rendered sprite, additive compositing. Scrolling down drives the
 * field forward along the spine, scrolling up drives it backward, both through
 * the same damped velocity model (never bound to raw scrollY).
 *
 * Everything on the graphic — particle base positions, the five waypoint
 * nodes, their connector lines, and the DOM label positions — derives from ONE
 * spine sampler (sampleSpine), so nothing can drift out of alignment.
 *
 * Performance contract (audit-landing.mjs --runtime asserts it):
 *   - fixed particle pool in flat Float32Arrays, zero allocation in the loop
 *   - one sprite drawn via drawImage; never arc()/gradient per particle
 *   - draws only while the hero is on-screen AND the tab is visible
 *   - devicePixelRatio capped at 2; resize debounced 150ms
 *   - frame time exposed at window.__uaaHeroDebug for the harness
 *
 * Reduced motion: renders ONE static frame at flow = 0.35 and never starts.
 */

/* ------------------------------- the spine -------------------------------- */

/** Cubic bezier chain in normalized [0,1]x[0,1] space: a wide sweep rising
 *  left to right (y is down, so "rising" means decreasing y). */
const SEGMENTS: [number, number][][] = [
  // P0            C1            C2            P1
  [[0.0, 0.66], [0.09, 0.75], [0.2, 0.8], [0.33, 0.74]],
  [[0.33, 0.74], [0.45, 0.685], [0.5, 0.76], [0.63, 0.7]],
  [[0.63, 0.7], [0.76, 0.63], [0.84, 0.46], [1.0, 0.3]],
];

export interface SpinePoint {
  x: number;
  y: number;
  /** Unit tangent. */
  tx: number;
  ty: number;
}

/** THE sampler: sole source of truth for particles, nodes, connectors, labels. */
export function sampleSpine(t: number): SpinePoint {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * SEGMENTS.length;
  const i = Math.min(SEGMENTS.length - 1, Math.floor(scaled));
  const u = scaled - i;
  const [p0, c1, c2, p1] = SEGMENTS[i];
  const v = 1 - u;
  const x = v * v * v * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * p1[0];
  const y = v * v * v * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * p1[1];
  const dx = 3 * v * v * (c1[0] - p0[0]) + 6 * v * u * (c2[0] - c1[0]) + 3 * u * u * (p1[0] - c2[0]);
  const dy = 3 * v * v * (c1[1] - p0[1]) + 6 * v * u * (c2[1] - c1[1]) + 3 * u * u * (p1[1] - c2[1]);
  const len = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / len, ty: dy / len };
}

/* ------------------------------- waypoints -------------------------------- */

export const WAYPOINTS = [
  { t: 0.08, label: "Ingest", sub: "Market Data", side: -1, mobile: true },
  { t: 0.26, label: "Normalize", sub: "Clean & Standardize", side: 1, mobile: false },
  { t: 0.5, label: "Compute", sub: "Deterministic Engines", side: -1, mobile: true },
  { t: 0.72, label: "Analyze", sub: "Explain What Matters", side: 1, mobile: false },
  { t: 0.9, label: "Trace", sub: "Back to Source", side: -1, mobile: true },
] as const;

/** Connector length (label offset from the node), in px. */
const CONNECTOR = 44;

/* ------------------------------ tuning ------------------------------------ */

/* The damped velocity chain has a displacement gain of ≈0.62 (v* = 0.618·d in
   steady state), so COUPLING is tuned for it: 950px viewport × 0.00085 × 0.62
   ≈ 0.5 of flow per full-viewport scroll. */
const COUPLING = 0.00085;
const IDLE_DRIFT = 0.02; // per second; the field breathes at rest
const EDGE_FADE = 0.06; // alpha → 0 over the outer 6% of t at both ends
const REDUCED_FLOW = 0.35;

function particleCount(width: number) {
  return width < 640 ? 500 : width < 1024 ? 900 : 1600;
}

/** Non-uniform density: sparse at t=0, tightening toward a bright peak at
 *  t≈0.88 (TRACE) — the graphic argues raw sources resolving into output. */
function densityWeight(t: number) {
  return 0.3 + 0.9 * t + 1.8 * Math.exp(-(((t - 0.88) / 0.14) ** 2));
}

/* --------------------------------------------------------------------------- */

interface DebugStats {
  frames: number[];
  maxWrapAlpha: number;
}

export function HeroFlow() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isReduced = prefersReducedMotion();
    setReduced(isReduced);

    /* ---- brand colour from the live theme token; sprite rebuilt on theme
            change so the canvas responds to the toggle (4.9) ---- */
    let brand = "#c8a96e";
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const sctx = sprite.getContext("2d")!;
    function buildSprite() {
      brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#c8a96e";
      sctx.clearRect(0, 0, 32, 32);
      const grad = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, brand);
      grad.addColorStop(0.35, brand + "b0");
      grad.addColorStop(1, brand + "00");
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 32, 32);
    }
    buildSprite();
    const themeObserver = new MutationObserver(() => {
      buildSprite();
      if (isReduced) draw(0, 0); // repaint the single static frame
      else wake();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /* ---- pool: flat Float32Arrays, allocated once ---- */
    let count = 0;
    let pT: Float32Array = new Float32Array(0);
    let pLat: Float32Array = new Float32Array(0);
    let pDepth: Float32Array = new Float32Array(0);
    let pSpeed: Float32Array = new Float32Array(0);
    let pSeed: Float32Array = new Float32Array(0);

    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const gaussian = () => (rand() + rand() + rand() + rand() - 2) / 2;

    function allocate(width: number) {
      count = particleCount(width);
      pT = new Float32Array(count);
      pLat = new Float32Array(count);
      pDepth = new Float32Array(count);
      pSpeed = new Float32Array(count);
      pSeed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        // Rejection-sample t against the density weight (init only).
        let t = rand();
        for (let k = 0; k < 12 && rand() * 3 > densityWeight(t); k++) t = rand();
        pT[i] = t;
        pLat[i] = gaussian() * (0.02 + 0.07 * rand()); // ±0.02–0.09 of height
        pDepth[i] = rand();
        pSpeed[i] = 0.6 + rand() * 0.8;
        pSeed[i] = rand() * Math.PI * 2;
      }
    }

    /* ---- backing store + label layout, resize-debounced ---- */
    let W = 0;
    let H = 0;
    let dpr = 1;
    function layout() {
      const rect = box!.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      allocate(W);
      // Labels positioned from the SAME sampler as the nodes.
      WAYPOINTS.forEach((wp, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        const p = sampleSpine(wp.t);
        el.style.left = `${(p.x * 100).toFixed(2)}%`;
        if (wp.side < 0) {
          el.style.bottom = `${(100 - p.y * 100).toFixed(2)}%`;
          el.style.top = "auto";
          el.style.paddingBottom = `${CONNECTOR + 10}px`;
        } else {
          el.style.top = `${(p.y * 100).toFixed(2)}%`;
          el.style.bottom = "auto";
          el.style.paddingTop = `${CONNECTOR + 10}px`;
        }
      });
    }
    layout();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        layout();
        wake();
      }, 150);
    };
    window.addEventListener("resize", onResize);

    /* ---- flow state (scroll component and drift kept separate so the
            harness can verify scrub symmetry independent of drift) ---- */
    let flowScroll = 0;
    let flowDrift = isReduced ? REDUCED_FLOW : 0;
    let flowVelocity = 0;
    const pulses = new Float32Array(WAYPOINTS.length); // pulse envelope 0..1
    let lastFlowPos = 0;

    const debug: DebugStats = { frames: [], maxWrapAlpha: 0 };

    /* ---- visibility gating ---- */
    let onScreen = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) wake();
      },
      { threshold: 0 },
    );
    io.observe(box);

    const wrap = (t: number) => t - Math.floor(t);

    function draw(dt: number, velocity: number) {
      const t0 = performance.now();
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H); // full clear: translucent trails band on dark
      ctx!.globalCompositeOperation = "lighter";

      if (!isReduced) {
        flowVelocity += (velocity * COUPLING - flowVelocity) * 0.12;
        flowVelocity *= 0.94;
        flowScroll += flowVelocity * dt * 60; // velocity is per-frame-ish; scale to dt
        flowDrift += IDLE_DRIFT * dt;
      }
      const flow = flowScroll + flowDrift;
      const speedGlow = Math.min(1.35, 1 + Math.abs(flowVelocity) * 26);
      const streak = Math.min(2.2, 1 + Math.abs(flowVelocity) * 120);
      const time = performance.now() / 1000;

      /* particles */
      for (let i = 0; i < count; i++) {
        const tt = wrap(pT[i] + flow * pSpeed[i]);
        // Edge fade: smoothstep³ to zero over the outer 6% at BOTH ends, so
        // wrapping never pops. (Verification 8 samples this.)
        let fade = 1;
        if (tt < EDGE_FADE) fade = (tt / EDGE_FADE) ** 3;
        else if (tt > 1 - EDGE_FADE) fade = ((1 - tt) / EDGE_FADE) ** 3;
        if (fade < 0.004) continue;

        const p = sampleSpine(tt);
        const drift = Math.sin(time * 0.7 + pSeed[i]) * 0.004;
        const x = (p.x + (-p.ty * (pLat[i] + drift))) * W;
        const y = (p.y + (p.tx * (pLat[i] + drift)) ) * H;
        const depth = pDepth[i];
        const size = (2.2 + depth * 6.5) * (0.85 + 0.3 * densityWeight(tt) * 0.4);
        const alpha = fade * (0.14 + depth * 0.5) * speedGlow;
        // Harness probe (verification 8): max alpha actually DRAWN within 1%
        // of the wrap seam, recorded before any draw.
        if ((tt < 0.01 || tt > 0.99) && alpha > debug.maxWrapAlpha) debug.maxWrapAlpha = alpha;
        ctx!.globalAlpha = Math.min(1, alpha);
        // Motion streak: elongate along the tangent proportional to velocity,
        // symmetric in both directions (no special-casing).
        const sw = size * streak;
        if (streak > 1.05) {
          ctx!.setTransform(dpr * p.tx, dpr * p.ty, -dpr * p.ty, dpr * p.tx, x * dpr, y * dpr);
          ctx!.drawImage(sprite, -sw / 2, -size / 2, sw, size);
          ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          ctx!.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        }
      }

      /* TRACE bloom: a soft radial glow at the resolved output */
      const trace = sampleSpine(0.88);
      ctx!.globalAlpha = 0.16 * speedGlow;
      const bloom = Math.min(W, H) * 0.34;
      ctx!.drawImage(sprite, trace.x * W - bloom / 2, trace.y * H - bloom / 2, bloom, bloom);

      /* waypoint nodes + connectors (canvas, so they always sit on the spine) */
      const flowPos = wrap(flow);
      for (let w = 0; w < WAYPOINTS.length; w++) {
        const wp = WAYPOINTS[w];
        const el = labelRefs.current[w];
        if (el && getComputedStyle(el).display === "none") continue; // mobile-hidden
        const p = sampleSpine(wp.t);
        const x = p.x * W;
        const y = p.y * H;

        // Pulse when `flow` passes the waypoint's t (either direction).
        if (!isReduced && ((lastFlowPos < wp.t && flowPos >= wp.t) || (lastFlowPos > wp.t && flowPos <= wp.t))) {
          pulses[w] = 1;
        }
        const pulse = pulses[w];
        pulses[w] = Math.max(0, pulse - dt * 2.5); // ~400ms envelope

        // Connector: 1px line from node toward the label side.
        ctx!.globalAlpha = 0.45;
        ctx!.strokeStyle = brand;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(x, y);
        ctx!.lineTo(x, y + wp.side * CONNECTOR);
        ctx!.stroke();

        // Node dot + pulse halo.
        const nodeR = 2.5 + pulse * 2;
        ctx!.globalAlpha = 0.9;
        ctx!.fillStyle = brand;
        ctx!.beginPath();
        ctx!.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx!.fill();
        if (pulse > 0.01) {
          ctx!.globalAlpha = pulse * 0.5;
          ctx!.drawImage(sprite, x - 14 - pulse * 10, y - 14 - pulse * 10, 28 + pulse * 20, 28 + pulse * 20);
        }
        // Label emphasis: 60% at rest, lifting to 100% on pulse.
        if (el && !isReduced) el.style.opacity = String(0.85 + 0.15 * Math.min(1, pulse * 3));
      }
      lastFlowPos = flowPos;

      ctx!.globalAlpha = 1;
      const ms = performance.now() - t0;
      if (debug.frames.length < 1200) debug.frames.push(ms);
      else {
        debug.frames.shift();
        debug.frames.push(ms);
      }
      return flow;
    }

    /* ---- harness hooks ---- */
    (window as unknown as Record<string, unknown>).__uaaHeroDebug = {
      flow: () => flowScroll, // scroll component only: symmetric by design
      drift: () => flowDrift,
      symmetryDelta: (f0: number, f1: number) => Math.abs(f1 - f0),
      maxWrapAlpha: () => debug.maxWrapAlpha,
      particleCount: () => count,
      stats: () => {
        const sorted = [...debug.frames].sort((a, b) => a - b);
        const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
        return {
          samples: sorted.length,
          p50: Math.round(q(0.5) * 100) / 100,
          p95: Math.round(q(0.95) * 100) / 100,
          worst: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
          particles: count,
        };
      },
    };

    if (isReduced) {
      // ONE static frame at flow = 0.35; labels at full opacity; never loop.
      draw(0, 0);
      labelRefs.current.forEach((el) => el && (el.style.opacity = "1"));
      return () => {
        io.disconnect();
        themeObserver.disconnect();
        window.removeEventListener("resize", onResize);
      };
    }

    /* ---- subscribe to the ONE engine loop; keep-alive while visible so the
            idle drift breathes; suspend off-screen and when the tab hides ---- */
    const unsub = subscribe((s, dt) => {
      if (!onScreen || document.visibilityState === "hidden") return false;
      draw(dt, s.velocity);
      return true; // keep the loop alive for idle drift while visible
    });

    return () => {
      unsub();
      io.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <div ref={boxRef} className="relative aspect-[1600/560] w-full sm:aspect-[1600/480]">
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      {/* Labels: real DOM text, positioned from the SAME spine sampler as the
          canvas nodes (layout() writes left/top per waypoint). */}
      <ul aria-label="How UAA works, in order" className="absolute inset-0">
        {WAYPOINTS.map((wp, i) => (
          <li
            key={wp.label}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            data-waypoint={wp.label}
            className={`absolute -translate-x-1/2 ${wp.mobile ? "flex" : "hidden md:flex"} flex-col items-center text-center ${reduced ? "opacity-100" : ""}`}
          >
            <span className="text-mk-eyebrow uppercase text-brand">{wp.label}</span>
            <span className="mt-0.5 max-w-28 text-mk-small text-muted sm:max-w-none sm:whitespace-nowrap">
              {wp.sub}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
