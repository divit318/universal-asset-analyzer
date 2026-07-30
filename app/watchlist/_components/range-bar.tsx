"use client";

/**
 * The 52-week range, with today's price and the user's target on the same axis.
 *
 * A watchlist's most-asked question after "what is it doing today" is "where is
 * this in its range" — and the answer was nowhere on the page even though the
 * quote already carried the high and the low (the CSV export has shipped both
 * for months). Putting the target on the same axis answers the follow-up in the
 * same glance: is the level I'm waiting for inside the range this thing has
 * actually traded in, or am I waiting for a new high?
 */

import { formatCurrency } from "@/lib/format";
import { isUsablePrice, rangePosition52Week } from "@/lib/watchlist-metrics";

export function RangeBar52Week({
  price,
  low,
  high,
  target,
  currency,
}: {
  price: number | null;
  low: number | null | undefined;
  high: number | null | undefined;
  target: number | null;
  currency: string;
}) {
  const position = rangePosition52Week(price, low, high);
  if (position == null || !isUsablePrice(low) || !isUsablePrice(high)) {
    return <p className="text-[11px] text-muted/60">52-week range unavailable.</p>;
  }

  // Only plot a target that falls inside the traded range; one outside it would
  // either clip to an endpoint (implying it has been reached) or stretch the
  // axis so the range itself became unreadable.
  const targetPct =
    isUsablePrice(target) && target >= low && target <= high
      ? ((target - low) / (high - low)) * 100
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-muted/60">
        <span>52-week range</span>
        <span className="font-mono tabular-nums normal-case tracking-normal text-muted">
          {position.toFixed(0)}% of range
        </span>
      </div>
      <div
        className="relative h-1.5 rounded-full bg-surface-2"
        role="img"
        aria-label={`${formatCurrency(price, currency)} sits ${position.toFixed(0)}% of the way up a 52-week range from ${formatCurrency(low, currency)} to ${formatCurrency(high, currency)}.`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand/30"
          style={{ width: `${position}%` }}
        />
        {targetPct != null && (
          <span
            title={`Your target ${formatCurrency(target, currency)}`}
            className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-warning"
            style={{ left: `calc(${targetPct}% - 1px)` }}
          />
        )}
        <span
          title={`Last ${formatCurrency(price, currency)}`}
          className="absolute -top-[3px] h-[13px] w-[3px] rounded-full bg-foreground"
          style={{ left: `calc(${position}% - 1.5px)` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted">
        <span>{formatCurrency(low, currency)}</span>
        {targetPct != null && <span className="text-warning">target {formatCurrency(target, currency)}</span>}
        <span>{formatCurrency(high, currency)}</span>
      </div>
    </div>
  );
}
