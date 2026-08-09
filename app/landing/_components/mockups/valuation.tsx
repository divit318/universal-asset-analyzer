"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useMockupEntry } from "../motion/mockup";
import { Odometer } from "../primitives/odometer";

/**
 * Valuation Engine mockup — static, hand-authored sample data,
 * choreographed ONCE on first viewport entry:
 *   - historical bars (brass) grow from the baseline, staggered 60ms, with
 *     a minimal ease-out-back overshoot; projected bars (slate) follow
 *     after a 200ms gap, and the dotted projection line draws across them
 *   - the intrinsic value rolls digit by digit; the upside badge scales in
 *     from 0.9 with its arrow drawing
 * Interaction: selecting another model in the left rail morphs the bar
 * heights to that model's dataset over 500ms with per-bar stagger, and the
 * intrinsic value rolls to the new number. Five plausible datasets,
 * hardcoded. This is what "built-in valuation models" means.
 * No-JS / reduced motion: the DCF final state renders directly.
 */
interface Model {
  name: string;
  short: string;
  /** Bar heights, % of chart, 2021..2028E. */
  bars: number[];
  value: string;
  upside: string;
  up: boolean;
}

const MODELS: Model[] = [
  { name: "Discounted Cash Flow (DCF)", short: "DCF", bars: [34, 40, 46, 54, 60, 67, 75, 84], value: "$186.42", upside: "+24.3%", up: true },
  { name: "Comparable Companies", short: "Comps", bars: [34, 40, 46, 54, 57, 61, 66, 70], value: "$171.88", upside: "+14.6%", up: true },
  { name: "Precedent Transactions", short: "Precedents", bars: [34, 40, 46, 54, 62, 71, 78, 88], value: "$194.10", upside: "+29.4%", up: true },
  { name: "Sum-of-the-Parts", short: "SOTP", bars: [34, 40, 46, 54, 58, 64, 69, 75], value: "$178.55", upside: "+19.0%", up: true },
  { name: "Dividend Discount Model", short: "DDM", bars: [34, 40, 46, 54, 55, 57, 60, 62], value: "$152.30", upside: "+1.5%", up: true },
];

const YEARS = ["2021", "2022", "2023", "2024", "2025E", "2026E", "2027E", "2028E"];

/** Dotted projection line through the tops of bars 4..7 (viewBox 0-100). */
function projectionPath(bars: number[]): string {
  const pts = [4, 5, 6, 7].map((i) => `${(i + 0.5) * 12.5} ${100 - bars[i] + 2}`);
  return `M${pts.join(" L")}`;
}

export function ValuationMockup() {
  const { ref, phase, played } = useMockupEntry();
  const [model, setModel] = useState(0);
  const m = MODELS[model];

  return (
    <div ref={ref} data-mock={phase} className="flex h-full gap-2.5 p-4 text-left">
      {/* Sidebar: the model rail. Selecting a model morphs the chart. */}
      <div className="flex w-40 shrink-0 flex-col rounded-card border border-hairline bg-surface-2/60 p-2.5">
        <p className="px-1.5 text-caption font-semibold text-foreground">Valuation Models</p>
        <p className="px-1.5 pt-0.5 text-micro text-muted">Built-in models. Always up to date.</p>
        <ul className="mt-2 flex flex-col gap-0.5">
          {MODELS.map((mm, i) => (
            <li key={mm.name}>
              <button
                type="button"
                aria-pressed={i === model}
                onClick={() => setModel(i)}
                onMouseEnter={() => setModel(i)}
                className={`w-full rounded-control px-1.5 py-1.5 text-left text-micro leading-snug outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  i === model ? "bg-brand/12 font-semibold text-brand" : "text-muted hover:bg-surface-3/60 hover:text-foreground"
                }`}
              >
                {mm.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col rounded-card border border-hairline bg-surface-2/60 p-3.5">
        <p className="text-caption font-semibold text-foreground">{m.name}</p>
        <div className="mt-1.5 flex items-baseline gap-4">
          <div>
            <p className="text-micro uppercase tracking-wide text-muted">Intrinsic Value</p>
            <p className="font-mono text-mk-feature font-semibold tabular-nums text-foreground">
              <Odometer value={m.value} play={played} />
            </p>
          </div>
          <div
            className="transition-[opacity,transform] delay-[1100ms] duration-300 ease-out [[data-mock=armed]_&]:scale-90 [[data-mock=armed]_&]:opacity-0"
          >
            <p className="text-micro uppercase tracking-wide text-muted">Upside</p>
            <p className="flex items-center gap-0.5 font-mono text-mk-lead font-semibold tabular-nums text-positive">
              <ArrowUpRight
                className="h-4 w-4 transition-[stroke-dashoffset] delay-[1200ms] duration-300 [stroke-dasharray:48] [stroke-dashoffset:0] [[data-mock=armed]_&]:[stroke-dashoffset:48]"
                strokeWidth={2}
              />
              {m.upside}
            </p>
          </div>
        </div>

        {/* Bar chart: brass history, slate projections, dotted trend line.
            Entry: scaleY growth. Model morph: height transition, 40ms/bar. */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="relative flex flex-1 items-end gap-2">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full text-muted"
            >
              <path
                key={model}
                d={projectionPath(m.bars)}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="0.03 0.025"
                className="transition-[stroke-dashoffset] delay-[900ms] duration-[500ms] ease-out [stroke-dashoffset:0] [[data-mock=armed]_&]:[stroke-dashoffset:1]"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {m.bars.map((h, i) => (
              <div key={YEARS[i]} className="flex h-full flex-1 items-end">
                <div
                  style={{
                    height: `${h}%`,
                    transitionDelay: phase === "play" ? `${(i < 4 ? i * 60 : 200 + i * 60)}ms` : `${i * 40}ms`,
                  }}
                  className={`w-full origin-bottom rounded-t-xs transition-[height,transform] duration-500 ease-[cubic-bezier(0.34,1.2,0.64,1)] [[data-mock=armed]_&]:scale-y-0 ${
                    i < 4 ? "bg-brand/80" : "bg-border-strong"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2">
            {YEARS.map((y) => (
              <span key={y} className="flex-1 text-center font-mono text-micro tabular-nums text-muted">
                {y}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
