/**
 * THE price-field choice for return and trend math, in one place.
 *
 * Yahoo's daily `close` is split-adjusted but NOT dividend-adjusted;
 * `adjClose` is both. Return calculations, SMA distances, and 52-week ranges
 * must all be computed on the same basis or the same stock reports different
 * momentum depending on which code path ran (observed: lib/scoring.ts used
 * raw close while lib/portfolio-analytics.ts and the Screener's
 * metrics-util.ts preferred adjClose). Total-return basis (adjClose) is the
 * standard for every one of these, so this helper is the single fallback
 * rule — never repeat `adjClose ?? close` at a call site.
 *
 * Pure and client-safe (types only).
 */

import type { HistoryPoint } from "./types";

/** Dividend + split-adjusted close, falling back to raw close when the provider omitted it. */
export function totalReturnClose(p: HistoryPoint): number {
  return p.adjClose ?? p.close;
}

export interface PriceGap {
  date: string;
  /** Day-over-day change in percent, on the adjusted series. */
  changePct: number;
}

/**
 * Guard for unadjusted corporate actions: flags single-day moves on the
 * ADJUSTED series beyond `thresholdPct`. A split/bonus the provider adjusted
 * for leaves no gap here; a gap that remains is either a genuine shock
 * (crash, takeover bid) or a corporate action the series missed — either way
 * it deserves a flag before a return computed across it is trusted.
 */
export function detectUnexplainedGaps(
  history: HistoryPoint[],
  thresholdPct = 25,
): PriceGap[] {
  const gaps: PriceGap[] = [];
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  let prev: number | null = null;
  for (const p of sorted) {
    const c = totalReturnClose(p);
    if (!(c > 0)) continue;
    if (prev != null) {
      const changePct = (c / prev - 1) * 100;
      if (Math.abs(changePct) > thresholdPct) {
        gaps.push({ date: p.date, changePct });
      }
    }
    prev = c;
  }
  return gaps;
}
