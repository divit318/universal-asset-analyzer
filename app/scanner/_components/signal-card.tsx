"use client";

import Link from "next/link";
import type { EventSignal } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

const DIR_STYLE = {
  bullish: {
    badge: "bg-positive/15 text-positive border-positive/30",
    arrow: "↑",
    label: "Bullish",
  },
  bearish: {
    badge: "bg-negative/15 text-negative border-negative/30",
    arrow: "↓",
    label: "Bearish",
  },
  neutral: {
    badge: "bg-muted/15 text-muted border-muted/30",
    arrow: "→",
    label: "Neutral",
  },
};

const TIMEFRAME_LABEL = {
  short: "Short-term",
  medium: "Medium-term",
  long: "Long-term",
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 75 ? "bg-positive" : value >= 50 ? "bg-accent" : "bg-muted";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs text-muted">{value}</span>
    </div>
  );
}

export function SignalCard({ signal }: { signal: EventSignal }) {
  const dir = DIR_STYLE[signal.direction];
  const positive = (signal.quote?.changePercent ?? 0) >= 0;
  const researchHref = `/research?symbol=${encodeURIComponent(signal.ticker)}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border/80 hover:bg-surface-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Link
              href={researchHref}
              className="font-mono font-semibold text-accent hover:underline"
            >
              {signal.ticker}
            </Link>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${dir.badge}`}
            >
              {dir.arrow} {dir.label}
            </span>
          </div>
          <span className="text-sm text-muted">{signal.name}</span>
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

      {/* Theme + timeframe */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground">
          {signal.theme}
        </span>
        <span className="text-xs text-muted">{TIMEFRAME_LABEL[signal.timeframe]}</span>
      </div>

      {/* Rationale */}
      <p className="text-sm leading-5 text-muted">{signal.rationale}</p>

      {/* Footer: confidence + actions */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Confidence</span>
          <ConfidenceBar value={signal.confidence} />
        </div>
        <Link
          href={researchHref}
          className="rounded-md border border-border px-3 py-1 text-xs transition-colors hover:bg-surface-2"
        >
          Research →
        </Link>
      </div>
    </div>
  );
}
