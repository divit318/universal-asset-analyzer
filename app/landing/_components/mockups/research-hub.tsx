"use client";

import { Apple, ChevronDown } from "lucide-react";
import { Odometer } from "../primitives/odometer";
import { useMockupEntry } from "../motion/mockup";

/**
 * Research Hub mockup — static, hand-authored sample data (see MockupFrame),
 * choreographed ONCE on first viewport entry (useMockupEntry):
 *   - key metric values roll up on monospace odometers (30ms per column)
 *   - the revenue line draws left to right over 900ms (easeOutQuart) with
 *     the area fill fading in behind it at 60% of the draw
 *   - news items slide up 12px and fade, staggered 80ms
 *   - the active tab's underline slides in from the left
 * No-JS / reduced motion: final state, no observer, nothing hidden.
 */
const TABS = ["Overview", "Financials", "News", "Estimates", "Filings", "Peers"];

const METRICS = [
  ["Market Cap", "$3.02T"],
  ["Enterprise Value", "$3.18T"],
  ["Revenue (TTM)", "$394.3B"],
  ["Net Income (TTM)", "$99.8B"],
  ["P/E (TTM)", "34.6x"],
  ["Dividend Yield", "0.44%"],
] as const;

const NEWS = [
  ["Apple unveils new AI features", "2h ago"],
  ["Q3 earnings beat estimates", "1d ago"],
  ["Apple expands manufacturing", "2d ago"],
] as const;

const LINE = "M4 36 L28 30 L52 31 L76 22 L100 16 L116 10";
const AREA = "M4 36 L28 30 L52 31 L76 22 L100 16 L116 10 V44 H4 Z";

export function ResearchHubMockup() {
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
              Apple Inc. <span className="font-normal text-muted">AAPL</span>
            </p>
            <p className="text-caption text-muted">NASDAQ · Technology Hardware</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-mk-small font-semibold tabular-nums text-foreground">
            $197.96 <span className="font-medium text-positive">(+1.34%)</span>
          </p>
          <p className="font-mono text-caption tabular-nums text-muted">Market Closed · Aug 7</p>
        </div>
      </div>

      {/* Tab strip: the active underline slides in from the left on entry. */}
      <div className="mt-3 flex gap-4 border-b border-hairline">
        {TABS.map((t, i) => (
          <span key={t} className={`relative pb-1.5 text-caption ${i === 0 ? "font-semibold text-foreground" : "text-muted"}`}>
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

      {/* Panels */}
      <div className="mt-3 grid flex-1 grid-cols-3 gap-2.5">
        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="flex items-center gap-1 text-caption font-semibold text-foreground">
            Key metrics
            <ChevronDown className="h-3 w-3 text-muted" strokeWidth={2} />
          </p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2">
            {METRICS.map(([label, value]) => (
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
          <p className="text-caption font-semibold text-foreground">Revenue (TTM)</p>
          <p className="mt-1 font-mono text-mk-lead font-semibold tabular-nums text-foreground">
            <Odometer value="$394.3B" play={played} />
          </p>
          <p className="font-mono text-caption font-medium tabular-nums text-positive">+7.1% YoY</p>
          <div className="mt-2 flex flex-1 gap-1.5">
            <div className="flex flex-col justify-between text-right font-mono text-micro tabular-nums text-muted">
              <span>400B</span>
              <span>300B</span>
              <span>200B</span>
            </div>
            <svg viewBox="0 0 120 44" className="h-full w-full text-positive" preserveAspectRatio="none" aria-hidden="true">
              {/* Area fill fades in behind the line at 60% of the draw. */}
              <path
                d={AREA}
                fill="currentColor"
                fillOpacity="0.1"
                stroke="none"
                className="transition-opacity duration-[360ms] delay-[540ms] [[data-mock=armed]_&]:opacity-0"
              />
              <path
                d={LINE}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.25,1,0.5,1)] [stroke-dasharray:1] [stroke-dashoffset:0] [[data-mock=armed]_&]:[stroke-dashoffset:1]"
              />
              {[
                [4, 36],
                [28, 30],
                [52, 31],
                [76, 22],
                [100, 16],
                [116, 10],
              ].map(([x, y], i) => (
                <circle
                  key={x}
                  cx={x}
                  cy={y}
                  r="1.8"
                  fill="currentColor"
                  style={{ transitionDelay: `${(i / 5) * 900}ms` }}
                  className="transition-opacity duration-200 [[data-mock=armed]_&]:opacity-0"
                />
              ))}
            </svg>
          </div>
          <div className="mt-1 flex justify-between pl-6 font-mono text-micro tabular-nums text-muted">
            {["2021", "2022", "2023", "2024", "TTM"].map((y) => (
              <span key={y}>{y}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-card border border-hairline bg-surface-2/60 p-3">
          <p className="text-caption font-semibold text-foreground">Recent news</p>
          <ul className="mt-2 flex flex-1 flex-col justify-evenly gap-2.5">
            {NEWS.map(([headline, when], i) => (
              <li
                key={headline}
                style={{ transitionDelay: `${300 + i * 80}ms` }}
                className="flex items-start justify-between gap-2 transition-[opacity,transform] duration-500 ease-out [[data-mock=armed]_&]:translate-y-3 [[data-mock=armed]_&]:opacity-0"
              >
                <span className="text-caption leading-snug text-foreground">{headline}</span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-muted">{when}</span>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-2 text-caption font-medium text-brand">View all news →</p>
        </div>
      </div>
    </div>
  );
}
