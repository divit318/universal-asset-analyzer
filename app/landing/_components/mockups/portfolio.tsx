"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { Odometer } from "../primitives/odometer";

/**
 * Portfolio Intelligence mockup — static, hand-authored sample data,
 * choreographed ONCE on first viewport entry:
 *   - the allocation donut draws clockwise from 12 o'clock over 800ms,
 *     segments revealing in order of size
 *   - the performance area chart wipes left to right (clip-path) with a
 *     leading dot travelling the line (SMIL animateMotion, JS-triggered,
 *     frozen at the final value)
 *   - the three AI Insight rows stagger in 120ms apart
 *   - the top movers strip does ONE slow marquee pass on entry, then stops
 * No-JS / reduced motion: final state.
 */
const ALLOCATION = [
  { label: "Equities", pct: "62.1%", swatch: "bg-chart-1", text: "text-chart-1", dash: 62.1 },
  { label: "Bonds", pct: "18.3%", swatch: "bg-chart-2", text: "text-chart-2", dash: 18.3 },
  { label: "Cash", pct: "10.4%", swatch: "bg-chart-3", text: "text-chart-3", dash: 10.4 },
  { label: "ETFs", pct: "6.1%", swatch: "bg-chart-4", text: "text-chart-4", dash: 6.1 },
  { label: "Other", pct: "3.1%", swatch: "bg-chart-5", text: "text-chart-5", dash: 3.1 },
];

const INSIGHTS = ["Consider reducing TECH exposure by 8%", "Cash level is above recommended range", "Income assets could help risk-adjusted returns"];

const MOVERS: { ticker: string; delta: string; up: boolean }[] = [
  { ticker: "AAPL", delta: "+2.63%", up: true },
  { ticker: "MSFT", delta: "+1.21%", up: true },
  { ticker: "NVDA", delta: "+3.12%", up: true },
  { ticker: "BRK.B", delta: "-0.45%", up: false },
  { ticker: "VTI", delta: "+0.87%", up: true },
];

const PERF_LINE = "M0 42 L14 36 L26 38 L38 26 L52 30 L66 18 L80 24 L94 14 L108 18 L120 8";

function Donut() {
  const c = 2 * Math.PI * 15.9155; // ≈ 100, the classic donut circumference
  // Each segment starts where the previous ones ended (12 o'clock = offset 25).
  const offsets = ALLOCATION.map((_, i) => 25 - ALLOCATION.slice(0, i).reduce((sum, s) => sum + s.dash, 0));
  // Reveal order: largest first (they happen to be declared in size order,
  // but rank explicitly so a data edit cannot silently break the choreography).
  const rank = ALLOCATION.map((_, i) => [...ALLOCATION.keys()].sort((a, b) => ALLOCATION[b].dash - ALLOCATION[a].dash).indexOf(i));
  return (
    <svg viewBox="0 0 42 42" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden="true">
      {ALLOCATION.map((seg, i) => (
        <circle
          key={seg.label}
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          stroke="currentColor"
          style={{ "--seg": `${(seg.dash / 100) * c} ${c}`, transitionDelay: `${rank[i] * 130}ms` } as React.CSSProperties}
          className={`${seg.text} transition-[stroke-dasharray] duration-[800ms] ease-out [stroke-dasharray:var(--seg)] [[data-mock=armed]_&]:[stroke-dasharray:0_105]`}
          strokeWidth="6"
          strokeDashoffset={(offsets[i] / 100) * c - 25}
        />
      ))}
    </svg>
  );
}

export function PortfolioMockup() {
  const { ref, phase, played } = useMockupEntry();
  const motionRef = useRef<SVGAnimateMotionElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);

  // The leading dot: travels with the wipe, settles at the final value.
  useEffect(() => {
    if (phase !== "play") return;
    const dot = dotRef.current;
    const m = motionRef.current;
    if (!dot || !m) return;
    dot.setAttribute("cx", "0");
    dot.setAttribute("cy", "0");
    m.beginElement();
  }, [phase]);

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-mk-small font-semibold text-foreground">
          My Portfolio
          <ChevronDown className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
        </p>
        <div className="flex gap-5 text-right">
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Value</p>
            <p className="font-mono text-caption font-semibold tabular-nums text-foreground">
              <Odometer value="$1,245,870" play={played} />
            </p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Day Change</p>
            <p className="font-mono text-caption font-semibold tabular-nums text-positive">+1.23%</p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Total Return YTD</p>
            <p className="font-mono text-caption font-semibold tabular-nums text-positive">+12.45%</p>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="mt-3 grid flex-1 grid-cols-3 gap-2.5">
        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-caption font-semibold text-foreground">Performance</p>
            <span className="flex items-center gap-0.5 rounded-control border border-hairline bg-surface-3 px-1.5 py-0.5 font-mono text-micro tabular-nums text-muted">
              YTD
              <ChevronDown className="h-2.5 w-2.5" strokeWidth={2} />
            </span>
          </div>
          <div className="mt-2 flex flex-1 gap-1">
            <div className="flex flex-col justify-between text-right font-mono text-micro tabular-nums text-muted">
              <span>1.4M</span>
              <span>1.1M</span>
              <span>0.8M</span>
            </div>
            {/* The wipe: a clip-path inset travelling left to right. */}
            <div className="h-full w-full transition-[clip-path] duration-[900ms] ease-out [clip-path:inset(0_0_0_0)] [[data-mock=armed]_&]:[clip-path:inset(0_100%_0_0)]">
              <svg viewBox="0 0 120 48" className="h-full w-full text-positive" preserveAspectRatio="none" aria-hidden="true">
                <path d={`${PERF_LINE} V48 H0 Z`} fill="currentColor" fillOpacity="0.12" stroke="none" />
                <path d={PERF_LINE} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                {/* Leading dot: rides the line via animateMotion, freezes at
                    the final value. Final position for SSR/no-JS. */}
                <circle ref={dotRef} cx="120" cy="8" r="2.4" fill="currentColor">
                  <animateMotion
                    ref={motionRef}
                    dur="900ms"
                    begin="indefinite"
                    fill="freeze"
                    keyPoints="0;1"
                    keyTimes="0;1"
                    calcMode="linear"
                    path={PERF_LINE}
                  />
                </circle>
              </svg>
            </div>
          </div>
          <div className="mt-1 flex justify-between pl-6 font-mono text-micro tabular-nums text-muted">
            {["Jan '24", "Mar '24", "May '24", "Jul '24"].map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Allocation</p>
          <div className="mt-2 flex flex-1 items-center gap-3">
            <Donut />
            <ul className="flex flex-col gap-1">
              {ALLOCATION.map((seg) => (
                <li key={seg.label} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${seg.swatch}`} />
                  <span className="text-micro text-muted">{seg.label}</span>
                  <span className="ml-auto font-mono text-micro tabular-nums text-foreground">{seg.pct}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">AI Insights</p>
          {/* justify-evenly absorbs the stretched panel's leftover height at
              tablet widths instead of pooling it above the pinned link. */}
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {INSIGHTS.map((tip, i) => (
              <li
                key={tip}
                style={{ transitionDelay: `${400 + i * 120}ms` }}
                className="flex items-start justify-between gap-2 transition-[opacity,transform] duration-500 ease-out [[data-mock=armed]_&]:translate-y-2 [[data-mock=armed]_&]:opacity-0"
              >
                <span className="text-micro leading-snug text-muted">{tip}</span>
                <span className="shrink-0 text-micro font-medium text-brand">View</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-1.5 text-micro font-medium text-brand">View all insights →</p>
        </div>
      </div>

      {/* Top movers strip: ONE slow pass on entry, then still. Never loops. */}
      <div className="mt-2.5 flex items-center gap-4 overflow-hidden rounded-card border border-hairline bg-surface-2/60 px-3 py-2">
        <span className="shrink-0 text-micro uppercase tracking-wide text-muted">Top Movers</span>
        <div className="flex gap-4 transition-transform duration-[4000ms] ease-out [[data-mock=armed]_&]:translate-x-[70%]">
          {MOVERS.map((m) => (
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
