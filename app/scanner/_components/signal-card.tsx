"use client";

import Link from "next/link";
import type { EventSignal } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

const DIR_STYLE = {
  bullish: {
    badge: "bg-positive/15 text-positive border-positive/30",
    bar:   "bg-positive",
    arrow: "↑",
    label: "Bullish",
  },
  bearish: {
    badge: "bg-negative/15 text-negative border-negative/30",
    bar:   "bg-negative",
    arrow: "↓",
    label: "Bearish",
  },
  neutral: {
    badge: "bg-muted/15 text-muted border-muted/30",
    bar:   "bg-muted",
    arrow: "→",
    label: "Neutral",
  },
};

const TIMEFRAME_LABEL = {
  short:  "Short-term",
  medium: "Medium-term",
  long:   "Long-term",
};

function ConfidenceRing({ value }: { value: number }) {
  const radius = 10;
  const circ = 2 * Math.PI * radius;
  const filled = (value / 100) * circ;
  const color = value >= 75 ? "#4ade80" : value >= 50 ? "#4ade80" : "#9aa3af";

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
        <circle cx="16" cy="16" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-surface-3" />
        <circle
          cx="16" cy="16" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function SignalCard({ signal, priority }: { signal: EventSignal; priority?: boolean }) {
  const dir = DIR_STYLE[signal.direction];
  const positive = (signal.quote?.changePercent ?? 0) >= 0;
  const researchHref = `/stocks/${encodeURIComponent(signal.ticker)}`;

  return (
    <div className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 transition-all hover:bg-surface-2 ${
      priority ? "border-accent/25 shadow-[0_0_0_1px_rgba(74,222,128,0.06)]" : "border-border hover:border-border/80"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={researchHref}
              className="font-mono font-semibold text-accent hover:underline"
            >
              {signal.ticker}
            </Link>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dir.badge}`}>
              {dir.arrow} {dir.label}
            </span>
          </div>
          <span className="truncate text-xs text-muted">{signal.name}</span>
        </div>

        {signal.quote ? (
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm font-medium">
              {formatCurrency(signal.quote.price, signal.quote.currency)}
            </div>
            <div className={`font-mono text-xs ${positive ? "text-positive" : "text-negative"}`}>
              {formatPercent(signal.quote.changePercent)}
            </div>
          </div>
        ) : null}
      </div>

      {/* Theme + timeframe tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground">
          {signal.theme}
        </span>
        <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted">
          {TIMEFRAME_LABEL[signal.timeframe]}
        </span>
      </div>

      {/* Rationale */}
      <p className="text-xs leading-5 text-muted line-clamp-3">{signal.rationale}</p>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
        <div className="flex items-center gap-2">
          <ConfidenceRing value={signal.confidence} />
          <div className="flex flex-col gap-0">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted/60">Confidence</span>
            <span className="text-xs font-semibold text-foreground">{signal.confidence}%</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Link
            href={`/intelligence?view=timeline&scope=symbol&id=${encodeURIComponent(signal.ticker)}`}
            className="rounded-md border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-accent"
          >
            Timeline
          </Link>
          <Link
            href={researchHref}
            className="rounded-md border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-accent"
          >
            Research →
          </Link>
        </div>
      </div>
    </div>
  );
}
