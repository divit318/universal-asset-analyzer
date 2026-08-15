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

const SEGMENT_STYLE = [
  { swatch: "bg-chart-1", text: "text-chart-1" },
  { swatch: "bg-chart-2", text: "text-chart-2" },
  { swatch: "bg-chart-3", text: "text-chart-3" },
  { swatch: "bg-chart-4", text: "text-chart-4" },
  { swatch: "bg-chart-5", text: "text-chart-5" },
  { swatch: "bg-brand", text: "text-brand" },
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
  return { niceMin, niceMax, line, area: `${line} V48 H2 Z`, end: pts[pts.length - 1], months };
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
          style={{ "--seg": `${(seg.weight / 100) * c} ${c}`, transitionDelay: `${i * 130}ms` } as React.CSSProperties}
          className={`${SEGMENT_STYLE[i % SEGMENT_STYLE.length].text} transition-[stroke-dasharray] duration-[800ms] ease-out [stroke-dasharray:var(--seg)] [[data-mock=armed]_&]:[stroke-dasharray:0_105]`}
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
            {/* The wipe: a clip-path inset travelling left to right. */}
            <div className="h-full w-full transition-[clip-path] duration-[900ms] ease-out [clip-path:inset(0_0_0_0)] [[data-mock=armed]_&]:[clip-path:inset(0_100%_0_0)]">
              <svg viewBox="0 0 120 48" className="h-full w-full text-brand" preserveAspectRatio="none" aria-hidden="true">
                <path d={CHART.area} fill="currentColor" fillOpacity="0.12" stroke="none" />
                <path d={CHART.line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx={CHART.end[0]} cy={CHART.end[1]} r="2.4" fill="currentColor" />
              </svg>
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
        </div>

        <div className="rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Allocation</p>
          <div className="mt-2 flex flex-1 items-center gap-3">
            <Donut />
            <ul className="flex flex-col gap-1">
              {P.allocation.map((seg, i) => (
                <li key={seg.label} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SEGMENT_STYLE[i % SEGMENT_STYLE.length].swatch}`} />
                  <span className="text-micro text-muted">{seg.label}</span>
                  <span className="ml-auto pl-2 font-mono text-micro tabular-nums text-foreground">{seg.pct}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Engine read</p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {P.findings.map((tip, i) => (
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
