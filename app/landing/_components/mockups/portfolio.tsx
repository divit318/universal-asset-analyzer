"use client";

import { ChevronDown } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { Odometer } from "../primitives/odometer";
import { PANEL_DATA } from "./panel-data";

/**
 * Portfolio Intelligence panel: the REAL demo book, engine-computed.
 * Value, total return, the alignment score, the value trajectory and the
 * allocation come from the committed portfolio_snapshot rows the real
 * engines wrote (normalizeHoldings -> evaluate -> summaryOf); the movers
 * are live quotes for the book's actual holdings at generation time.
 * Baked by scripts/landing-panel-data.ts. Nothing is hand-authored.
 *
 * Choreographed ONCE on first viewport entry:
 *   - the allocation donut draws clockwise from 12 o'clock over 800ms,
 *     segments revealing in order of size
 *   - the value chart wipes left to right (clip-path)
 *   - the three engine findings stagger in 120ms apart
 *   - the movers strip does ONE slow pass on entry, then stops
 * No-JS / reduced motion: final state.
 */
const P = PANEL_DATA.portfolio;

/* Allocation tones: a brass luminance ramp, ordered by weight (the data
   already arrives sorted), so size is encoded twice — arc length AND
   luminance — and the landing page keeps its single-hue discipline. The
   in-app donut keeps the categorical chart palette; this is the marketing
   rendering of the same numbers. */
const SEGMENT_TONES = [
  "var(--brand)",
  "color-mix(in oklab, var(--brand) 68%, var(--surface-3))",
  "color-mix(in oklab, var(--brand) 46%, var(--surface-3))",
  "color-mix(in oklab, var(--brand) 30%, var(--surface-3))",
  "color-mix(in oklab, var(--brand) 18%, var(--surface-3))",
  "color-mix(in oklab, var(--brand) 10%, var(--surface-3))",
];

/* Value chart geometry (viewBox 0 0 120 48), x scaled by real time. */
const CHART = (() => {
  const t0 = Date.parse(P.trajectory[0].at);
  const t1 = Date.parse(P.trajectory[P.trajectory.length - 1].at);
  const values = P.trajectory.map((p) => p.value / 1e6);
  const niceMin = Math.floor(Math.min(...values) * 2) / 2;
  const niceMax = Math.ceil(Math.max(...values) * 2) / 2;
  const pts = P.trajectory.map((p) => {
    const x = 2 + ((Date.parse(p.at) - t0) / (t1 - t0)) * 116;
    const y = 45 - ((p.value / 1e6 - niceMin) / (niceMax - niceMin)) * 42;
    return [x, y] as const;
  });
  const line = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")}`;
  // Funding steps: a single-step rise of more than 15% is an addition to the
  // book (new lots), not a market move — mark it so the jump reads as an
  // event the engine tracked, never as a rendering error.
  const steps: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    if ((values[i] - values[i - 1]) / values[i - 1] > 0.15) steps.push({ x: pts[i][0], y: pts[i][1] });
  }
  // Month tick labels at their true positions along the time axis.
  const months: { label: string; pct: number }[] = [];
  const d = new Date(t0);
  d.setUTCDate(1);
  for (;;) {
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (d.getTime() >= t1) break;
    months.push({
      label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      pct: ((d.getTime() - t0) / (t1 - t0)) * 100,
    });
  }
  return { niceMin, niceMax, line, area: `${line} V48 H2 Z`, end: pts[pts.length - 1], months, steps };
})();

function Donut() {
  const c = 2 * Math.PI * 15.9155; // ≈ 100, the classic donut circumference
  const offsets = P.allocation.map((_, i) => 25 - P.allocation.slice(0, i).reduce((sum, s) => sum + s.weight, 0));
  return (
    <svg viewBox="0 0 42 42" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden="true">
      {P.allocation.map((seg, i) => (
        <circle
          key={seg.label}
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          stroke="currentColor"
          style={{ "--seg": `${(seg.weight / 100) * c} ${c}`, transitionDelay: `${i * 130}ms`, color: SEGMENT_TONES[i % SEGMENT_TONES.length] } as React.CSSProperties}
          className="transition-[stroke-dasharray] duration-[800ms] ease-out [stroke-dasharray:var(--seg)] [[data-mock=armed]_&]:[stroke-dasharray:0_105]"
          strokeWidth="6"
          strokeDashoffset={(offsets[i] / 100) * c - 25}
        />
      ))}
    </svg>
  );
}

export function PortfolioPanel() {
  const { ref, phase, played } = useMockupEntry();

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-mk-small font-semibold text-foreground">
          My Portfolio
          <ChevronDown className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
        </p>
        <div className="flex flex-wrap gap-5 text-right">
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Value</p>
            <p className="font-mono text-caption font-semibold tabular-nums text-foreground">
              <Odometer value={P.valueDisplay} play={played} />
            </p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">P&L vs cost</p>
            <p
              className={`font-mono text-caption font-semibold tabular-nums ${
                P.totalReturnPositive ? "text-positive" : "text-negative"
              }`}
            >
              {P.totalReturnDisplay}
            </p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Alignment</p>
            <p className="font-mono text-caption font-semibold tabular-nums text-foreground">
              {P.alignment}
            </p>
          </div>
        </div>
      </div>

      {/* Panels. Mobile collapse: the three cards stack full-width so the
          value chart, allocation and engine read all stay legible. */}
      <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-caption font-semibold text-foreground">Value, US$M</p>
            <span className="rounded-control border border-hairline bg-surface-3 px-1.5 py-0.5 font-mono text-micro tabular-nums text-muted">
              since {P.sinceLabel}
            </span>
          </div>
          <div className="mt-2 flex h-24 gap-1 sm:h-auto sm:flex-1">
            <div className="flex flex-col justify-between text-right font-mono text-micro tabular-nums text-muted">
              <span>{CHART.niceMax.toFixed(1)}</span>
              <span>{((CHART.niceMax + CHART.niceMin) / 2).toFixed(1)}</span>
              <span>{CHART.niceMin.toFixed(1)}</span>
            </div>
            {/* The wipe: a clip-path inset travelling left to right. The
                markers are HTML overlays, not SVG children: the chart svg is
                non-uniformly scaled (preserveAspectRatio none), which would
                stretch any circle into a smear. */}
            <div className="relative h-full w-full transition-[clip-path] duration-[900ms] ease-out [clip-path:inset(0_0_0_0)] [[data-mock=armed]_&]:[clip-path:inset(0_100%_0_0)]">
              <svg viewBox="0 0 120 48" className="h-full w-full text-brand" preserveAspectRatio="none" aria-hidden="true">
                <path d={CHART.area} fill="currentColor" fillOpacity="0.12" stroke="none" />
                <path d={CHART.line} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {/* Funding-step diamonds: the engine's event markers. */}
              {CHART.steps.map((s) => (
                <span
                  key={`${s.x}-${s.y}`}
                  aria-hidden="true"
                  style={{ left: `${(s.x / 120) * 100}%`, top: `${(s.y / 48) * 100}%` }}
                  className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-background bg-brand"
                />
              ))}
              <span
                aria-hidden="true"
                style={{ left: `${(CHART.end[0] / 120) * 100}%`, top: `${(CHART.end[1] / 48) * 100}%` }}
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
              />
            </div>
          </div>
          <div className="relative mt-1 h-3.5 pl-6">
            {CHART.months.map((m) => (
              <span
                key={m.label}
                style={{ left: `calc(1.5rem + ${m.pct}% * 0.8)` }}
                className="absolute font-mono text-micro tabular-nums text-muted"
              >
                {m.label}
              </span>
            ))}
          </div>
          {/* Read the steps honestly: they are funding events the engine
              tracked, and the true return sits beside them. */}
          <p className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap font-mono text-micro tabular-nums text-muted">
            <span aria-hidden="true" className="h-1 w-1 shrink-0 rotate-45 bg-brand" />
            steps = additions · return vs cost{" "}
            <span className={P.totalReturnPositive ? "text-positive" : "text-negative"}>{P.totalReturnDisplay}</span>
          </p>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Allocation</p>
          <div className="mt-2 flex flex-1 items-center gap-3">
            <Donut />
            <ul className="flex flex-col gap-1">
              {P.allocation.map((seg, i) => (
                <li key={seg.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: SEGMENT_TONES[i % SEGMENT_TONES.length] }}
                    className="h-1.5 w-1.5 rounded-full"
                  />
                  <span className="text-micro text-muted">{seg.label}</span>
                  <span className="ml-auto pl-2 font-mono text-micro tabular-nums text-foreground">{seg.pct}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Engine read</p>
          {/* Bullets and meter share the card's height as one centred group;
              the deep link stays pinned to the bottom edge. */}
          <div className="flex flex-1 flex-col justify-center gap-3">
          {/* The first finding restates health and volatility, which the
              meter below now draws — skip it rather than say it twice. */}
          <ul className="flex flex-col gap-2">
            {P.findings.slice(1).map((tip, i) => (
              <li
                key={tip}
                style={{ transitionDelay: `${400 + i * 120}ms` }}
                className="flex items-start gap-2 transition-[opacity,transform] duration-500 ease-out [[data-mock=armed]_&]:translate-y-2 [[data-mock=armed]_&]:opacity-0"
              >
                <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" />
                <span className="text-micro leading-snug text-muted">{tip}</span>
              </li>
            ))}
          </ul>
          {/* The grade, drawn: health 75/100 as a measured bar, not just a
              figure — the one place this panel earns a meter. */}
          <div
            style={{ transitionDelay: "820ms" }}
            className="border-t border-hairline pt-2.5 transition-opacity duration-500 [[data-mock=armed]_&]:opacity-0"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-micro uppercase tracking-wide text-muted">Health</span>
              <span className="font-mono text-micro font-semibold tabular-nums text-foreground">
                {P.health}/100 <span className="text-brand">({P.healthGrade})</span>
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                style={{ "--health": `${P.health}%` } as React.CSSProperties}
                className="h-full w-[var(--health)] rounded-full bg-brand transition-[width] delay-[900ms] duration-[700ms] ease-out [[data-mock=armed]_&]:w-0"
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-micro tabular-nums text-muted">
              <span>volatility {P.volatilityDisplay}</span>
              <span>{P.allocation.length} asset classes</span>
            </div>
          </div>
          </div>
          <p className="mt-auto pt-1.5 text-micro font-medium text-brand">Open the portfolio →</p>
        </div>
      </div>

      {/* Movers strip: live quotes for the book's holdings at generation time.
          ONE slow pass on entry, then still. Never loops. */}
      <div className="mt-2.5 flex items-center gap-4 overflow-hidden rounded-card border border-hairline bg-surface-2/60 px-3 py-2">
        <span className="shrink-0 text-micro uppercase tracking-wide text-muted">Movers · {P.moversAsOf.slice(5)}</span>
        <div className="flex gap-4 transition-transform duration-[4000ms] ease-out [[data-mock=armed]_&]:translate-x-[70%]">
          {P.movers.map((m) => (
            <span key={m.ticker} className="flex items-center gap-1.5 font-mono text-micro tabular-nums">
              <span className="font-semibold text-foreground">{m.ticker}</span>
              <span className={m.up ? "text-positive" : "text-negative"}>{m.delta}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
