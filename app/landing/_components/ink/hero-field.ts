"use client";

import { subscribe, wake, prefersReducedMotion } from "../motion/engine";

/**
 * The hero flow field. NOT a particle system, NOT stroked polylines: one
 * WebGL fragment shader renders a single continuous sheet of material —
 * domain-warped ridged noise advected along the spine, stretched strongly
 * along the direction of flow so the texture reads as anisotropic silk
 * rather than independent lines. There is nothing to pop, reset, orbit or
 * loop: every frame is a pure function of (pixel, time).
 *
 * Composition: a cubic bezier spine enters off the LEFT edge low (below
 * the CTA row), passes BELOW the text block, and rises to exit off the
 * RIGHT edge at mid height, so the luminous core sits in the LOWER right
 * and the field supports the headline instead of competing with it. Both
 * endpoints sit outside [0,1], so there is no visible start or end. The
 * material lives in an analytic envelope around that spine:
 *
 *   - a dense core (Gaussian in perpendicular distance, widening along
 *     the run) that carries the silhouette,
 *   - a soft halo at ~3 sigma that gives the sheet volume,
 *   - a lower fan that peels away below the spine past t = 0.55,
 *   - an entry ramp keeping the far left a single faint thread,
 *   - upward compression over the text region (t < ~0.6) so nothing
 *     climbs into the paragraph.
 *
 * Depth comes from three advection layers sampled from the same field at
 * different scales, speeds and contrasts (far: broad, slow, soft; near:
 * fine, fast, high-ridge) plus a low-frequency mass modulation so the
 * sheet has braids and gaps instead of even density. Colour is a density
 * ramp — near-black -> deep amber -> brass -> warm off-white — with a
 * soft-knee tone map, so white is EARNED by density, never assigned.
 *
 * Interaction: the pointer stir and parallax of the strand era are
 * REMOVED (they read as a gimmick against a continuous material). What
 * remains: scroll advects the flow slightly faster (smoothed, clamped,
 * always settles back), and the pipeline-row coupling is unchanged.
 *
 * Fallbacks: prefers-reduced-motion renders ONE composed frame and stops.
 * No WebGL renders a static painted ribbon on a 2D context.
 */

/* ---- spine: the strand-era control points, translated DOWN so the
   luminous core (widest sigma, t ~ 0.8+) settles in the LOWER right and
   the entry tail clears the CTA row. The curve character is unchanged:
   same enter-left-low, rise-through-the-middle, exit-right shape. ---- */
const BEZ = { p0: [-0.08, 0.97], p1: [0.46, 1.04], p2: [0.74, 0.7], p3: [1.1, 0.46] } as const;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uAmber;
uniform vec3 uBrass;
uniform vec3 uCore;
uniform float uDetail;   // 1 = all three layers; 0 = far + mid only
uniform float uDensity;  // global density trim

const vec2 P0 = vec2(${BEZ.p0[0]}, ${BEZ.p0[1]});
const vec2 P1 = vec2(${BEZ.p1[0]}, ${BEZ.p1[1]});
const vec2 P2 = vec2(${BEZ.p2[0]}, ${BEZ.p2[1]});
const vec2 P3 = vec2(${BEZ.p3[0]}, ${BEZ.p3[1]});

float bezX(float t) {
  float v = 1.0 - t;
  return v*v*v*P0.x + 3.0*v*v*t*P1.x + 3.0*v*t*t*P2.x + t*t*t*P3.x;
}
vec2 bezD(float t) {
  float v = 1.0 - t;
  return 3.0*(v*v*(P1-P0) + 2.0*v*t*(P2-P1) + t*t*(P3-P2));
}
float bezY(float t) {
  float v = 1.0 - t;
  return v*v*v*P0.y + 3.0*v*v*t*P1.y + 3.0*v*t*t*P2.y + t*t*t*P3.y;
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(19.7, 7.31);
    a *= 0.5;
  }
  return s * 1.0667; // renormalize ~0..1
}
/* Velocity-aligned silk: domain-warped ridged fbm. sharp raises ridge
   contrast (near layers are wirier, far layers softer). The warp lookup
   drifts on its own SLOW clock, so filaments re-knit as they travel
   instead of sliding past like a printed sheet. */
float silk(vec2 q, float sharp, float warp, float evolve) {
  vec2 e = vec2(evolve, -evolve * 0.7);
  q += (vec2(fbm(q * 0.55 + vec2(3.1, 7.7) + e), fbm(q * 0.55 + vec2(11.3, 2.9) - e)) - 0.5) * warp;
  float r = 1.0 - abs(fbm(q) * 2.0 - 1.0);
  return pow(r, sharp);
}
float ss(float e0, float e1, float x) { return smoothstep(e0, e1, x); }

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);

  /* Invert x(t) by Newton (x is strictly monotonic on the spine). */
  float t = clamp((uv.x + 0.08) / 1.18, 0.0, 1.0);
  for (int k = 0; k < 4; k++) {
    t -= (bezX(t) - uv.x) / max(0.05, bezD(t).x);
    t = clamp(t, 0.0, 1.0);
  }
  float aspect = uRes.x / uRes.y;
  vec2 dpx = bezD(t) * vec2(aspect, 1.0);
  float ct = dpx.x / length(dpx);         // cos of local slope
  float v = (uv.y - bezY(t)) * ct;        // approx perpendicular offset, h units

  /* Envelope. vE compresses the upward side over the text block only;
     the texture itself samples the raw v so the material never warps. */
  float sigma = 0.015 + 0.088 * ss(0.05, 0.85, t);
  float vE = v < 0.0 ? v / (0.22 + 0.78 * ss(0.44, 0.66, t)) : v;
  float g = vE / sigma;
  float env = exp(-g * g);
  env += 0.16 * exp(-(g * g) / 9.0);      // volumetric halo
  /* Lower fan: a soft lobe peeling below the spine on the right. */
  float fanC = 0.11 * ss(0.52, 0.95, t);
  float fanW = sigma * 1.7;
  float gf = (v - fanC) / fanW;
  env += 0.34 * exp(-gf * gf) * ss(0.55, 0.8, t);
  /* Entry ramp: the far left is a faint single thread, but PRESENT. */
  env *= mix(0.22, 1.0, ss(0.02, 0.34, t));
  /* The canvas is a cross-section of a larger system: the material must
     DISSOLVE before the top and bottom edges, never terminate on them. */
  env *= ss(0.0, 0.07, uv.y) * ss(1.0, 0.97, uv.y);
  /* Upper-right falloff: the top-right terminus reads as a tapering exit,
     never a bright mass — the headline must win the first glance. */
  env *= 1.0 - 0.36 * ss(0.55, 0.95, uv.x) * (1.0 - ss(0.08, 0.42, uv.y));

  /* Three advection layers of the same material: depth without seams. */
  float evo = uTime * 0.011;
  float far = silk(vec2(t * 2.4 - uTime * 0.020, v * 36.0) + 5.0, 1.7, 0.42, evo * 0.6);
  float mid = silk(vec2(t * 3.6 - uTime * 0.041, v * 70.0) + 13.0, 3.0, 0.55, evo);
  float body = 0.30 * far + 0.46 * mid;
  float glint = 0.0;
  if (uDetail > 0.5) {
    float near = silk(vec2(t * 5.0 - uTime * 0.072, v * 120.0) + 27.0, 4.5, 0.6, evo * 1.5);
    body += 0.42 * near;
    /* Convergence glints: where the mid and near sheets ridge TOGETHER
       the material runs hot — rare by construction (a product of two
       sparse ridges), always on the dense spine. */
    glint = pow(mid * near, 1.6) * 2.6;
  } else {
    body *= 1.35;
    glint = mid * mid * mid * 1.4;
  }
  /* Braids and gaps: low-frequency mass so density is never uniform. */
  float m0 = fbm(vec2(t * 1.7 - uTime * 0.013, v * 9.0) + 31.0);
  float mass = 0.22 + 1.05 * m0 * m0;

  float dens = env * body * mass * uDensity;
  dens += exp(-g * g) * glint * mass;
  dens += env * 0.028;                     // haze floor inside the envelope

  /* Soft-knee tone map; dither kills 8-bit banding in the halo. */
  float d = 1.0 - exp(-dens * 2.2);
  d += (hash(gl_FragCoord.xy + 0.5) - 0.5) * 0.012;
  d = max(d, 0.0);

  vec3 col = mix(uAmber, uBrass, ss(0.14, 0.58, d));
  col = mix(col, uCore, ss(0.7, 1.0, d));
  float a = clamp(d * 1.12, 0.0, 0.97);
  gl_FragColor = vec4(col * a, a);        // premultiplied
}
`;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function bezPoint(t: number): { x: number; y: number } {
  const v = 1 - t;
  return {
    x: v ** 3 * BEZ.p0[0] + 3 * v * v * t * BEZ.p1[0] + 3 * v * t * t * BEZ.p2[0] + t ** 3 * BEZ.p3[0],
    y: v ** 3 * BEZ.p0[1] + 3 * v * v * t * BEZ.p1[1] + 3 * v * t * t * BEZ.p2[1] + t ** 3 * BEZ.p3[1],
  };
}

/* ---- palette: derived from the live tokens, never hardcoded ---- */
const rgbOf = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const shade = (a: string, valueMul: number, desat: number) => {
  const p = rgbOf(a).map((x) => Math.min(255, x * valueMul));
  const luma = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  return p.map((x) => Math.min(255, Math.max(0, x + (luma - x) * desat)));
};

/**
 * Static fallback: one composed painted frame. Reached when WebGL is
 * unavailable OR when GL setup fails on a context that cannot serve it
 * (e.g. an HMR re-run against a canvas whose context was lost). In the
 * latter case the original canvas is permanently claimed by WebGL, so the
 * still is painted onto an injected sibling and the original is hidden —
 * NEVER a crash, never a blank hero with an error boundary.
 */
function createStaticField(canvas: HTMLCanvasElement): { destroy(): void } {
  let target = canvas;
  let injected: HTMLCanvasElement | null = null;
  let g2 = canvas.getContext("2d");
  if (!g2) {
    injected = document.createElement("canvas");
    injected.className = canvas.className;
    injected.setAttribute("aria-hidden", "true");
    canvas.parentElement?.insertBefore(injected, canvas);
    canvas.style.display = "none";
    target = injected;
    g2 = injected.getContext("2d");
  }
  if (!g2) return { destroy() {} };
  const ctx = g2;
  const paintStill = () => {
    const r = canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    target.width = w;
    target.height = h;
    const cs = getComputedStyle(document.documentElement);
    const brass = cs.getPropertyValue("--brand").trim() || "#c8a96e";
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let s = 0; s < 42; s++) {
      const off = ((s % 7) - 3) / 3;
      ctx.strokeStyle = brass;
      ctx.globalAlpha = 0.05 + 0.05 * (1 - Math.abs(off));
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        const p = bezPoint(t);
        const sig = (0.017 + 0.105 * smoothstep(0.05, 0.85, t)) * h;
        const y = p.y * h + off * sig * (1 + 0.3 * Math.sin(t * 9 + s));
        if (k === 0) ctx.moveTo(p.x * w, y);
        else ctx.lineTo(p.x * w, y);
      }
      ctx.lineWidth = 0.8 + 1.4 * (1 - Math.abs(off));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
  paintStill();
  const roStill = new ResizeObserver(paintStill);
  roStill.observe(canvas.parentElement!);
  return {
    destroy() {
      roStill.disconnect();
      if (injected) {
        injected.remove();
        canvas.style.display = "";
      }
    },
  };
}

export function createHeroField(canvas: HTMLCanvasElement): { destroy(): void } {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      /* Kept ON so the visual-QA harness (scripts/ink-verify.mjs) can
         sample the buffer via drawImage; the material is one quad, so the
         cost is a single resolve. */
      preserveDrawingBuffer: true,
    });
  } catch {
    gl = null;
  }
  if (gl && gl.isContextLost()) gl = null;
  if (!gl) return createStaticField(canvas);
  try {
    return createFlowField(canvas, gl);
  } catch (err) {
    /* A failed GL setup must degrade, never take the page down. */
    console.warn("hero-field: WebGL setup failed, using the static fallback", err);
    return createStaticField(canvas);
  }
}

function createFlowField(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): { destroy(): void } {
  const reduced = prefersReducedMotion();
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mobile = coarse || window.innerWidth < 1024;

  /* ---- quality: buffer scale + layer count; the ladder lowers both ---- */
  let bufScale = mobile ? 0.5 : 0.75;
  let detail = mobile ? 0 : 1;
  const dprCap = mobile ? 1.5 : 2;

  /* ---- GL resources, rebuilt wholesale after a context restore ---- */
  let prog: WebGLProgram | null = null;
  let quad: WebGLBuffer | null = null;
  let U: Record<string, WebGLUniformLocation | null> = {};

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      console.warn(`hero-field shader: ${log ?? "no log (context lost?)"}`);
      return null;
    }
    return sh;
  };

  function buildResources(): boolean {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const p = gl.createProgram();
    if (!vs || !fs || !p) return false;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn(`hero-field link: ${gl.getProgramInfoLog(p) ?? "no log"}`);
      gl.deleteProgram(p);
      return false;
    }
    gl.useProgram(p);
    const q = gl.createBuffer();
    if (!q) {
      gl.deleteProgram(p);
      return false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND); // the quad writes premultiplied RGBA directly
    prog = p;
    quad = q;
    U = {
      res: gl.getUniformLocation(p, "uRes"),
      time: gl.getUniformLocation(p, "uTime"),
      amber: gl.getUniformLocation(p, "uAmber"),
      brass: gl.getUniformLocation(p, "uBrass"),
      core: gl.getUniformLocation(p, "uCore"),
      detail: gl.getUniformLocation(p, "uDetail"),
      density: gl.getUniformLocation(p, "uDensity"),
    };
    return true;
  }

  if (!buildResources()) throw new Error("hero-field: could not build GL resources");

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const brass = cs.getPropertyValue("--brand").trim() || "#c8a96e";
    /* The full density ramp stays unambiguously GOLD; the off-white core
       is a value lift with strong desaturation — luminous, never neon. */
    const amber = shade(brass, 0.52, 0.12);
    const bras = rgbOf(brass);
    const core = shade(brass, 1.55, 0.62);
    gl.uniform3f(U.amber, amber[0] / 255, amber[1] / 255, amber[2] / 255);
    gl.uniform3f(U.brass, bras[0] / 255, bras[1] / 255, bras[2] / 255);
    gl.uniform3f(U.core, core[0] / 255, core[1] / 255, core[2] / 255);
  }

  let w = 0;
  let h = 0;
  let pageTop = 0;
  function measure() {
    const r = canvas.parentElement!.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    pageTop = r.top + window.scrollY;
    const scale = Math.min(dprCap, window.devicePixelRatio || 1) * bufScale;
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);
  }

  let time = 40; // start in a developed region of the field
  function draw() {
    gl.uniform1f(U.time, time);
    gl.uniform1f(U.detail, detail);
    gl.uniform1f(U.density, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readPalette();
  measure();

  const stages = Array.from(document.querySelectorAll<HTMLElement>("[data-pipeline-stage]"));

  /* ---- exit: drift down-right and fade as a unit via the element ---- */
  function applyPresence(): number {
    const top = pageTop - window.scrollY;
    const k = Math.min(1, Math.max(0, -(top + h * 0.12) / (h * 0.55)));
    canvas.style.opacity = String(1 - k);
    canvas.style.transform = k > 0 ? `translate(${k * 46}px, ${k * 36}px)` : "";
    return 1 - k;
  }

  /* ---- lifecycle ---- */
  let onScreen = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) wake();
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measure();
      if (reduced) draw();
      wake();
    }, 150);
  });
  ro.observe(canvas.parentElement!);

  const themeObserver = new MutationObserver(() => {
    readPalette();
    if (reduced) draw();
    wake();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const onContextLost = (e: Event) => e.preventDefault();
  const onContextRestored = () => {
    /* Every GL object died with the old context: rebuild them all. */
    if (!buildResources()) return;
    readPalette();
    measure();
    if (reduced) draw();
    wake();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const frames: number[] = [];
  const dts: number[] = [];
  let unsub: (() => void) | null = null;
  let laddered = false;

  if (reduced) {
    draw();
  } else {
    unsub = subscribe((scroll, dt) => {
      if (document.visibilityState === "hidden" || !onScreen) return false;
      if (gl.isContextLost()) return false; // parked until the restore event
      const t0 = performance.now();
      const presence = applyPresence();
      if (presence <= 0) return false;
      /* Scroll advects the flow slightly faster: smoothed upstream by the
         motion engine, clamped here, settles back to 1 on its own. */
      const flow = 1 + Math.min(0.5, Math.abs(scroll.velocity) * 0.0016);
      time += Math.min(0.05, dt) * flow;
      draw();

      const ms = performance.now() - t0;
      if (frames.length >= 240) frames.shift();
      frames.push(ms);
      if (dts.length >= 240) dts.shift();
      dts.push(dt * 1000);
      /* Degradation ladder: a full-screen fragment pass is GPU-bound, so
         the honest signal is the frame-to-frame interval, not JS cost. */
      if (!laddered && dts.length === 90) {
        const sorted = [...dts].sort((a, b) => a - b);
        if (sorted[67] > 22) {
          bufScale *= 0.66;
          detail = 0;
          measure();
        }
        laddered = true;
      }

      /* One-way pipeline coupling: the travelling bulge brightens stages. */
      if (stages.length) {
        const b = time * 0.05 - Math.floor(time * 0.05);
        for (let k = 0; k < stages.length; k++) {
          const sx = (k + 0.5) / stages.length;
          const d = Math.min(Math.abs(b - sx), 1 - Math.abs(b - sx));
          stages[k].style.opacity = String(0.72 + 0.28 * Math.exp(-((d / 0.09) ** 2)));
        }
      }
      return true;
    });
  }

  (window as unknown as Record<string, unknown>).__uaaHeroFieldDebug = {
    particleCount: () => 0,
    /* A stateless field cannot orbit or knot: every frame is a pure
       function of (pixel, time). The vortex gate holds by construction. */
    orbit: () => ({ respawns: 0, maxWindowTurnDeg: 0 }),
    stats: () => {
      const q = (arr: number[], p: number) => {
        const s = [...arr].sort((a, b) => a - b);
        return Math.round((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0) * 100) / 100;
      };
      return {
        samples: frames.length,
        p50: q(frames, 0.5),
        p75: q(frames, 0.75),
        p95: q(frames, 0.95),
        dtP75: q(dts, 0.75),
        renderer: "webgl-flow",
        bufScale,
        detail,
      };
    },
  };

  return {
    destroy() {
      unsub?.();
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      window.clearTimeout(resizeTimer);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      /* Free the program and geometry but DO NOT loseContext(): an HMR or
         strict-mode re-run reuses this canvas, and getContext on a
         deliberately-lost context returns a corpse. The browser reclaims
         the context with the element. */
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      delete (window as unknown as Record<string, unknown>).__uaaHeroFieldDebug;
    },
  };
}
