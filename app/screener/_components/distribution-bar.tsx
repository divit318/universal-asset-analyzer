"use client";

/**
 * The shape of the universe, under the filter that aims at it.
 *
 * Screening blind is the default experience everywhere: you type a number into a
 * box with no idea whether it will return four rows or four hundred, so you
 * discover the distribution by trial and error, one round-trip at a time. Every
 * screener does this, and it is the reason people land on empty results and give
 * up. Showing the histogram turns aiming a filter from guesswork into reading.
 *
 * Two things are drawn:
 *  - the distribution of this metric across the whole universe, 24 buckets
 *  - the span the current filter admits, highlighted against it
 *
 * Costs nothing to produce: `MetricDistribution` is computed once per universe
 * build alongside the percentiles (lib/screener/universe-stats.ts) and fetched
 * once per asset class, not per screen.
 *
 * Coverage is stated in the same breath, because it is the other half of aiming:
 * a filter on a metric only 60% of the universe reports will silently drop the
 * other 40%, and that is invisible without being told.
 */

import type { MetricDistribution } from "@/lib/screener/universe-stats";
import type { MetricDef } from "@/lib/assets/types";
import { formatMetricValue } from "@/lib/screener/format";

interface Props {
  distribution: MetricDistribution;
  metric: MetricDef;
  /** Current bounds, in the metric's own storage units (already unscaled by the caller). */
  min: number | null;
  max: number | null;
  /** True when the filter is a percentile, in which case the histogram is of raw values and the span can't be drawn. */
  framed: boolean;
}

export function DistributionBar({ distribution, metric, min, max, framed }: Props) {
  const { histogram, min: lo, max: hi, covered, total, median } = distribution;
  const peak = Math.max(...histogram, 1);
  const span = hi - lo;

  /** Which buckets the current filter admits. Null bound = open on that side. */
  const bucketIn = (i: number): boolean => {
    if (framed || (min == null && max == null)) return true;
    // Bucket i covers [lo + i/n·span, lo + (i+1)/n·span].
    const from = lo + (i / histogram.length) * span;
    const to = lo + ((i + 1) / histogram.length) * span;
    if (min != null && to < min) return false;
    if (max != null && from > max) return false;
    return true;
  };

  const coveragePct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const thin = coveragePct < 80;

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="flex h-4 items-end gap-px"
        // A11y: the bars are decorative; the numbers below carry the same
        // information in text, so a screen reader gets the useful version.
        aria-hidden
        title={
          framed
            ? `${metric.label} across the universe — the filter is a percentile, so the highlight doesn't apply`
            : `${metric.label}: ${formatMetricValue(metric, lo)} to ${formatMetricValue(metric, hi)}, median ${formatMetricValue(metric, median)}`
        }
      >
        {histogram.map((count, i) => {
          const inRange = bucketIn(i);
          return (
            <span
              key={i}
              className={`min-h-px flex-1 rounded-sm transition-colors ${
                inRange ? "bg-brand/55" : "bg-border"
              }`}
              style={{ height: `${Math.max(6, (count / peak) * 100)}%` }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[9px] leading-none text-muted/60">
        <span className="tabular-nums">{formatMetricValue(metric, lo)}</span>
        <span className={thin ? "font-medium text-warning" : ""}>
          {thin ? `only ${coveragePct}% have this` : `median ${formatMetricValue(metric, median)}`}
        </span>
        <span className="tabular-nums">{formatMetricValue(metric, hi)}</span>
      </div>
    </div>
  );
}
