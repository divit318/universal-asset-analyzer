"use client";

import { Apple } from "lucide-react";
import { Odometer } from "../primitives/odometer";
import { useMockupEntry } from "../motion/mockup";
import { PANEL_DATA } from "./panel-data";

/**
 * Research Hub panel: REAL data for the ticker in panel-data.ts (quote,
 * fundamentals, reported revenue by fiscal year, live headlines), generated
 * by scripts/landing-panel-data.ts. The tab strip is the real Research
 * page's tab set (app/research/page.tsx TABS). Nothing is hand-authored.
 *
 * Choreographed ONCE on first viewport entry (useMockupEntry):
 *   - key metric values roll up on monospace odometers (30ms per column)
 *   - the revenue line draws left to right over 900ms (easeOutQuart) with
 *     the area fill fading in behind it at 60% of the draw
 *   - news items slide up 12px and fade, staggered 80ms
 *   - the active tab's underline slides in from the left
 * No-JS / reduced motion: final state, no observer, nothing hidden.
 */
const R = PANEL_DATA.research;

/* Chart geometry (viewBox 0 0 120 44), derived from the real revenue series. */
const CHART = (() => {
  const values = R.revenue.map((p) => p.value / 1e9);
  const niceMin = Math.floor(Math.min(...values) / 50) * 50;
  const niceMax = Math.ceil(Math.max(...values) / 50) * 50;
  const x = (i: number) => 4 + (i * 112) / (values.length - 1);
  const y = (v: number) => 40 - ((v - niceMin) / (niceMax - niceMin)) * 36;
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = `M${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(" L")}`;
  return { niceMin, niceMax, pts, line, area: `${line} V44 H4 Z` };
})();

export function ResearchHubPanel() {
  const { ref, phase, played } = useMockupEntry();

  return (
    <div ref={ref} data-mock={phase} className="flex h-full flex-col p-4 text-left">
      {/* Company header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-card border border-hairline bg-surface-2 text-foreground">
            <Apple className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-mk-small font-semibold text-foreground">
              {R.name} <span className="font-normal text-muted">{R.symbol}</span>
            </p>
            <p className="text-caption text-muted">
              {R.exchange} · {R.industry}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-mk-small font-semibold tabular-nums text-foreground">
            {R.price}{" "}
            <span className={`font-medium ${R.changePositive ? "text-positive" : "text-negative"}`}>
              ({R.changePercent})
            </span>
          </p>
          <p className="font-mono text-caption tabular-nums text-muted">As of {R.asOfShort}</p>
        </div>
      </div>

      {/* The real Research page's tab strip; the active underline slides in. */}
      <div className="mt-3 flex gap-4 overflow-x-auto border-b border-hairline">
        {R.tabs.map((t, i) => (
          <span key={t} className={`relative shrink-0 pb-1.5 text-caption ${i === 0 ? "font-semibold text-foreground" : "text-muted"}`}>
            {t}
            {i === 0 && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand transition-transform duration-500 ease-out [[data-mock=armed]_&]:scale-x-0"
              />
            )}
          </span>
        ))}
      </div>

      {/* Panels. Mobile collapse: the three cards stack full-width so every
          figure stays legible; nothing is cropped or shrunk. */}
      <div className="mt-3 grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Key metrics</p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {R.metrics.map(([label, value]) => (
              <li key={label} className="flex items-center justify-between gap-2">
                <span className="text-caption text-muted">{label}</span>
                <span className="font-mono text-caption font-medium tabular-nums text-foreground">
                  <Odometer value={value} play={played} />
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Revenue, US$B</p>
          <p className="mt-1 font-mono text-mk-lead font-semibold tabular-nums text-foreground">
            <Odometer value={R.revenueTtmDisplay} play={played} />
          </p>
          {R.revenueGrowthDisplay && (
            <p
              className={`font-mono text-caption font-medium tabular-nums ${
                R.revenueGrowthPositive ? "text-positive" : "text-negative"
              }`}
            >
              {R.revenueGrowthDisplay}
            </p>
          )}
          <div className="mt-2 flex h-24 gap-1.5 sm:h-auto sm:flex-1">
            <div className="flex flex-col justify-between text-right font-mono text-micro tabular-nums text-muted">
              <span>{CHART.niceMax}</span>
              <span>{(CHART.niceMax + CHART.niceMin) / 2}</span>
              <span>{CHART.niceMin}</span>
            </div>
            <svg viewBox="0 0 120 44" className="h-full w-full text-brand" preserveAspectRatio="none" aria-hidden="true">
              {/* Area fill fades in behind the line at 60% of the draw. */}
              <path
                d={CHART.area}
                fill="currentColor"
                fillOpacity="0.1"
                stroke="none"
                className="transition-opacity duration-[360ms] delay-[540ms] [[data-mock=armed]_&]:opacity-0"
              />
              <path
                d={CHART.line}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.25,1,0.5,1)] [stroke-dasharray:1] [stroke-dashoffset:0] [[data-mock=armed]_&]:[stroke-dashoffset:1]"
              />
              {CHART.pts.map(([x, y], i) => (
                <circle
                  key={x}
                  cx={x}
                  cy={y}
                  r="1.8"
                  fill="currentColor"
                  style={{ transitionDelay: `${(i / (CHART.pts.length - 1)) * 900}ms` }}
                  className="transition-opacity duration-200 [[data-mock=armed]_&]:opacity-0"
                />
              ))}
            </svg>
          </div>
          <div className="mt-1 flex justify-between pl-6 font-mono text-micro tabular-nums text-muted">
            {R.revenue.map((p) => (
              <span key={p.year}>{p.year}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Recent news</p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2.5">
            {R.news.map((n, i) => (
              <li
                key={n.headline}
                style={{ transitionDelay: `${300 + i * 80}ms` }}
                className="flex items-start justify-between gap-2 transition-[opacity,transform] duration-500 ease-out [[data-mock=armed]_&]:translate-y-3 [[data-mock=armed]_&]:opacity-0"
              >
                <span className="line-clamp-2 text-caption leading-snug text-foreground">{n.headline}</span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-muted">{n.date}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-2 text-caption font-medium text-brand">View all news →</p>
        </div>
      </div>
    </div>
  );
}
