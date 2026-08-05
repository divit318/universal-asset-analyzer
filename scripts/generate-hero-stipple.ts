/**
 * Hero stipple generator — "The Traceable Figure" (Concept C).
 *
 * Emits app/landing/_components/hero-stipple.tsx: an original, hand-authored
 * SVG illustration in the language of 19th-century engraved stipple — thousands
 * of small marks, dense where the form is solid, dissolving into drifting
 * particles at the edges.
 *
 * ── The idea ────────────────────────────────────────────────────────────────
 * Right, in ink: the raw source material — ragged ledger rows and filing-text
 * fragments ("evidence in ink"). Left, in brass: the computed structure — an
 * ordered lattice and one deterministic curve ("verdicts in brass"). Both
 * forms enter from their edge of the frame and dissolve toward the centre,
 * where they resolve into the one element both agree on: a diamond terminus —
 * the same geometry as the product mark (lib/brand/mark.ts, "Convergence
 * Point") — with a dotted citation line running from the diamond back through
 * the ink particles to its source at the right edge. Every figure traces back;
 * this is what that looks like.
 *
 * ── Reproducibility & tuning ───────────────────────────────────────────────
 * Deterministic: a fixed-seed PRNG (mulberry32), so the committed artwork is
 * exactly re-derivable. Tune the constants below and re-run:
 *
 *   node scripts/generate-hero-stipple.ts
 *
 * ── Performance contract ───────────────────────────────────────────────────
 * All marks render as sub-paths of FOUR <path> elements (static ink, static
 * brass, drifting ink, drifting brass) plus one crisp diamond — never
 * per-dot DOM nodes. The script prints mark counts and byte size; the
 * component's doc comment repeats them.
 *
 * Two colours only, both from theme tokens (currentColor + var(--brand)), so
 * the piece recolours correctly in both themes. Drift animates under
 * `@media (prefers-reduced-motion: no-preference)` only.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

/* ── Tunables ──────────────────────────────────────────────────────────── */

const SEED = 22;            // the one knob that reshuffles every mark
const W = 1440;             // viewBox width
const H = 480;              // viewBox height
const CX = W / 2;           // the meeting point
const CY = H / 2;

const DOT = 2.0;            // base mark size (viewBox units)
const DRIFT_FRACTION = 0.12; // share of loose particles that ambiently drift

/* ── Seeded PRNG ───────────────────────────────────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

/* ── Mark collection ───────────────────────────────────────────────────── */

interface Mark { x: number; y: number; s: number }

const inkStatic: Mark[] = [];
const inkDrift: Mark[] = [];
const brassStatic: Mark[] = [];
const brassDrift: Mark[] = [];

function put(list: "ink" | "brass", x: number, y: number, s: number, loose = false) {
  if (x < 4 || x > W - 4 || y < 4 || y > H - 4) return;
  const mark = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, s: Math.round(s * 100) / 100 };
  const drifts = loose && rand() < DRIFT_FRACTION;
  if (list === "ink") (drifts ? inkDrift : inkStatic).push(mark);
  else (drifts ? brassDrift : brassStatic).push(mark);
}

/** 0 at the meeting point → 1 at the outer edge, the density ramp both forms share. */
function edgeness(x: number, side: "left" | "right"): number {
  const t = side === "left" ? (CX - x) / (CX - 40) : (x - CX) / (W - 40 - CX);
  return Math.max(0, Math.min(1, t));
}

/* ── RIGHT / INK — the raw source material ─────────────────────────────────
   Ragged ledger rows: lines of dot-runs with word-like gaps, secondary faint
   rows between them, and a cloud of loose particles blowing toward centre. */

const ROWS = 16;
for (let r = 0; r < ROWS; r++) {
  const y0 = 52 + r * ((H - 104) / (ROWS - 1)) + (rand() - 0.5) * 10;
  // Each row starts somewhere right of centre and runs to the right edge.
  const rowStart = CX + 60 + rand() * 260;
  let x = rowStart;
  while (x < W - 24) {
    // A "word": a run of tightly packed marks…
    const word = 3 + Math.floor(rand() * 9);
    for (let i = 0; i < word; i++) {
      const e = edgeness(x, "right");
      // Solidity gate: keep probability rises toward the right edge.
      if (rand() < 0.25 + 0.75 * e) {
        put("ink", x + (rand() - 0.5) * 1.6, y0 + (rand() - 0.5) * 2.6, DOT * (0.75 + 0.5 * rand()));
        // Double-strike where solid, for engraved weight.
        if (e > 0.55 && rand() < 0.5) {
          put("ink", x + (rand() - 0.5) * 2.2, y0 + (rand() - 0.5) * 3.2, DOT * (0.6 + 0.4 * rand()));
        }
      }
      x += 3.4 + rand() * 1.4;
    }
    x += 7 + rand() * 16; // …then a gap.
  }
  // The row frays leftward into particles that cross into the gap.
  const frayCount = 14 + Math.floor(rand() * 10);
  for (let i = 0; i < frayCount; i++) {
    const fx = rowStart - Math.pow(rand(), 1.6) * 300;
    if (rand() < 0.5 * edgeness(fx, "right") + 0.18) {
      put("ink", fx, y0 + (rand() - 0.5) * 14, DOT * (0.5 + 0.45 * rand()), true);
    }
  }
}

// Ambient ink scatter over the right half (atmosphere between the rows).
for (let i = 0; i < 1400; i++) {
  const x = CX + rand() * (W / 2 - 30);
  const y = 30 + rand() * (H - 60);
  if (rand() < 0.4 * edgeness(x, "right") + 0.06) {
    put("ink", x, y, DOT * (0.45 + 0.4 * rand()), true);
  }
}

/* ── LEFT / BRASS — the computed structure ─────────────────────────────────
   An ordered lattice (the model grid) and one deterministic curve plotted
   through it, both solid at the left edge and dissolving toward centre. */

// The lattice.
const PITCH = 14;
for (let gx = 36; gx < CX - 24; gx += PITCH) {
  for (let gy = 56; gy < H - 40; gy += PITCH) {
    const e = edgeness(gx, "left");
    if (rand() < 0.08 + 0.8 * Math.pow(e, 1.35)) {
      const jitter = (1 - e) * 5; // the grid itself loosens as it dissolves
      put("brass", gx + (rand() - 0.5) * jitter, gy + (rand() - 0.5) * jitter, DOT * (0.55 + 0.35 * rand()),
        e < 0.35);
    }
  }
}

// The computed curve: dense dot-plot of a damped wave settling toward CY as
// it approaches the meeting point — computation converging on the answer.
for (let x = 40; x < CX - 18; x += 1.9) {
  const t = (x - 40) / (CX - 58);          // 0 at left edge → 1 near centre
  const amp = 118 * (1 - t) + 6;           // settles as it converges
  const y = CY - Math.sin(t * Math.PI * 2.2 + 0.4) * amp * Math.exp(-1.1 * t);
  const e = edgeness(x, "left");
  if (rand() < 0.5 + 0.5 * e) {
    put("brass", x + (rand() - 0.5) * 1.2, y + (rand() - 0.5) * 2.4, DOT * (0.9 + 0.4 * rand()));
    if (rand() < 0.65) put("brass", x, y + (rand() - 0.5) * 6, DOT * (0.5 + 0.4 * rand()));
  }
  // The curve sheds particles into the gap as it dissolves.
  if (e < 0.4 && rand() < 0.3) {
    put("brass", x + rand() * 60, y + (rand() - 0.5) * 22, DOT * (0.45 + 0.4 * rand()), true);
  }
}

// Ambient brass scatter left of centre.
for (let i = 0; i < 900; i++) {
  const x = 30 + rand() * (CX - 60);
  const y = 30 + rand() * (H - 60);
  if (rand() < 0.3 * edgeness(x, "left") + 0.05) {
    put("brass", x, y, DOT * (0.4 + 0.4 * rand()), true);
  }
}

/* ── THE GAP — the two clouds intermingle ─────────────────────────────── */

for (let i = 0; i < 420; i++) {
  const x = CX - 130 + rand() * 260;
  const y = CY + (rand() - 0.5) * (H - 120) * (0.35 + 0.65 * rand());
  const d = Math.abs(x - CX) / 130;
  if (rand() < 0.16 + 0.1 * d) {
    put(rand() < 0.5 ? "ink" : "brass", x, y, DOT * (0.4 + 0.35 * rand()), true);
  }
}

/* ── THE MEETING POINT — diamond terminus + halo + citation line ────────── */

// Halo: a ring of brass marks condensing on the diamond.
for (let i = 0; i < 90; i++) {
  const a = rand() * Math.PI * 2;
  const rr = 26 + Math.pow(rand(), 1.6) * 46;
  put("brass", CX + Math.cos(a) * rr * 1.15, CY + Math.sin(a) * rr, DOT * (0.5 + 0.4 * rand()));
}

// Citation line: a dotted brass trace from the diamond back through the ink
// mass to its source at the right edge. Doubled marks so it survives scaling.
for (let x = CX + 30; x < W - 18; x += 6.5) {
  const wobble = Math.sin((x - CX) / 46) * 1.2;
  put("brass", x, CY + wobble, 1.7);
  put("brass", x + 2.2, CY + wobble + 0.6, 1.1);
}
// …and a source bracket where the line meets the ledger.
for (let i = 0; i < 14; i++) {
  put("brass", W - 22 + (rand() - 0.5) * 3, CY - 26 + i * 4, 1.6);
}

/* ── Emit ──────────────────────────────────────────────────────────────── */

function toPath(marks: Mark[]): string {
  // Each mark is a tiny axis-aligned square sub-path — a diamond at engraving
  // scale once anti-aliased, and ~40% cheaper than an arc pair per mark.
  return marks.map((m) => `M${m.x} ${m.y}h${m.s}v${m.s}h-${m.s}z`).join("");
}

const diamondHalf = 15;
const diamond = `M${CX} ${CY - diamondHalf}L${CX + diamondHalf} ${CY}L${CX} ${CY + diamondHalf}L${CX - diamondHalf} ${CY}z`;
const diamondInner = `M${CX} ${CY - 6.5}L${CX + 6.5} ${CY}L${CX} ${CY + 6.5}L${CX - 6.5} ${CY}z`;

const total = inkStatic.length + inkDrift.length + brassStatic.length + brassDrift.length;

const component = `/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: scripts/generate-hero-stipple.ts (seed ${SEED}).
 * Regenerate with:  node scripts/generate-hero-stipple.ts
 *
 * "The Traceable Figure" — the landing hero's engraved-stipple illustration.
 * Right, in ink: raw ledger rows dissolving into particles. Left, in brass:
 * a computed lattice and one deterministic curve. They meet at a diamond
 * terminus (the mark's own geometry) with a dotted citation line running
 * from the figure back through the ink to its source.
 *
 * Marks: ${total.toLocaleString()} total (ink ${inkStatic.length + inkDrift.length}, brass ${brassStatic.length + brassDrift.length}),
 * rendered as 5 <path> elements + 1 crisp diamond pair — never per-dot nodes.
 * Colours are theme tokens only (currentColor + var(--brand)); ambient drift
 * on ${inkDrift.length + brassDrift.length} loose particles runs only under prefers-reduced-motion:
 * no-preference, and the piece is complete when fully static.
 *
 * Decorative: aria-hidden, presentation role; never announced.
 */

const INK_STATIC = ${JSON.stringify(toPath(inkStatic))};
const INK_DRIFT = ${JSON.stringify(toPath(inkDrift))};
const BRASS_STATIC = ${JSON.stringify(toPath(brassStatic))};
const BRASS_DRIFT = ${JSON.stringify(toPath(brassDrift))};

export function HeroStipple({ className = "" }: { className?: string }) {
  return (
    <div className={\`pointer-events-none flex justify-center overflow-hidden \${className}\`}>
      {/* Scoped styles: the drift keyframes live with the artwork, not in
          globals.css, so the generated file is fully self-contained. */}
      <style>{\`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes uaa-stipple-drift-a {
            0%, 100% { transform: translate(0, 0); }
            50% { transform: translate(5px, -7px); }
          }
          @keyframes uaa-stipple-drift-b {
            0%, 100% { transform: translate(0, 0); }
            50% { transform: translate(-6px, 6px); }
          }
          .uaa-stipple-drift-a { animation: uaa-stipple-drift-a 13s ease-in-out infinite; }
          .uaa-stipple-drift-b { animation: uaa-stipple-drift-b 17s ease-in-out infinite; }
        }
      \`}</style>
      {/* On narrow screens the artwork keeps a fixed 860px width inside a
          flex-centred, overflow-hidden frame: both edges crop symmetrically,
          so the meeting point stays centred and the marks stay legible. */}
      <svg
        viewBox="0 0 ${W} ${H}"
        className="h-auto w-[860px] max-w-none shrink-0 text-foreground sm:w-full sm:max-w-[1200px]"
        aria-hidden="true"
        role="presentation"
        focusable="false"
      >
        <path d={INK_STATIC} fill="currentColor" fillOpacity="0.62" />
        <path d={BRASS_STATIC} fill="var(--brand)" fillOpacity="0.78" />
        <g className="uaa-stipple-drift-a">
          <path d={INK_DRIFT} fill="currentColor" fillOpacity="0.4" />
        </g>
        <g className="uaa-stipple-drift-b">
          <path d={BRASS_DRIFT} fill="var(--brand)" fillOpacity="0.5" />
        </g>
        {/* The one traceable figure — crisp, not stippled, because it is the
            only element the page asserts rather than suggests. */}
        <path d=${JSON.stringify(diamond)} fill="none" stroke="var(--brand)" strokeWidth="2" />
        <path d=${JSON.stringify(diamondInner)} fill="var(--brand)" />
      </svg>
    </div>
  );
}
`;

const outPath = path.join(process.cwd(), "app", "landing", "_components", "hero-stipple.tsx");
writeFileSync(outPath, component);

const bytes = Buffer.byteLength(component);
console.log(`hero-stipple.tsx written (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`  marks: ${total} total`);
console.log(`    ink   static ${inkStatic.length} / drift ${inkDrift.length}`);
console.log(`    brass static ${brassStatic.length} / drift ${brassDrift.length}`);
console.log(`  DOM: 5 <path> + 1 diamond pair + 1 <svg> + 1 wrapper <div>`);
