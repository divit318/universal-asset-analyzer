/**
 * The Indian equity universe provider — the ~500 largest NSE listings,
 * enriched through exactly the same dataset pipeline as US equities
 * (lib/dataset.ts: 12h SQLite fundamentals cache, 5-minute live price layer,
 * composite scores over the merge). Same machinery, different universe;
 * values are INR-native throughout.
 */

import { indiaEquityDataset } from "../../dataset";
import { ownershipQoQ, ownershipTrends, readIndiaOwnership, trickleEnrichIndiaOwnership } from "../../india-ownership";
import { ownershipTrendChips, type OwnershipObservation } from "../../india-ownership-trends";
import type { StockMetrics } from "../../types";
import type { ScreenerCandidate } from "../types";
import type { UniverseProvider } from "../universe-cache";
import { toCandidate, toStatus } from "./equity";

function toIndiaCandidate(m: StockMetrics): ScreenerCandidate {
  const c = { ...toCandidate(m), assetClass: "indiaEquity" as const };

  // Ownership + screener.in ratios: a read-only cache merge (never a fetch —
  // lib/india-ownership.ts). ROE keeps Yahoo's TTM value when present and
  // falls back to screener.in's latest-FY figure; ROCE is screener.in's own.
  const own = readIndiaOwnership(m.symbol);
  const qoq = ownershipQoQ(own);
  const trends = ownershipTrends(own);
  c.metrics = {
    ...c.metrics,
    promoterHolding: own?.promoterHolding ?? null,
    fiiHolding: own?.fiiHolding ?? null,
    diiHolding: own?.diiHolding ?? null,
    // Percentage-POINT deltas vs the previous disclosed quarter.
    promoterChangeQoQ: qoq.promoterChangeQoQ,
    fiiChangeQoQ: qoq.fiiChangeQoQ,
    diiChangeQoQ: qoq.diiChangeQoQ,
    // Multi-quarter trends (signed streaks in quarters; 4Q changes in pp).
    promoterStreak: trends.promoterStreak,
    fiiStreak: trends.fiiStreak,
    diiStreak: trends.diiStreak,
    promoterChange4Q: trends.promoterChange4Q,
    fiiChange4Q: trends.fiiChange4Q,
    diiChange4Q: trends.diiChange4Q,
    roce: own?.roce ?? null,
    roe: c.metrics.roe ?? own?.roe ?? null,
  };
  c.attributes = {
    ...c.attributes,
    // The disclosure quarter every ownership % is AS OF ("Jun 2026").
    ownershipAsOf: own?.period ?? null,
    // Serialized 12-quarter series for the inline sparkline (zero extra
    // requests — this is the cached extract). Missing quarters serialize as
    // empty cells so the renderer can GAP them rather than draw through.
    ownHist: serializeHistory(own?.history),
    // Compact trend chips ("FII ↓3Q · Prom +1.4pp/4Q") from the shared math.
    ownTrend: ownershipTrendChips(trends).join(" · ") || null,
  };
  return c;
}

/** "p1,p2,…|f1,…|d1,…|firstPeriod→lastPeriod" with empty cells for nulls. */
function serializeHistory(history: OwnershipObservation[] | undefined): string | null {
  if (!history || history.length < 2) return null;
  const s = (k: "promoter" | "fii" | "dii") => history.map((h) => (h[k] == null ? "" : String(h[k]))).join(",");
  return `${s("promoter")}|${s("fii")}|${s("dii")}|${history[0].period}→${history.at(-1)!.period}`;
}

export const indiaEquityUniverse: UniverseProvider = {
  assetClass: "indiaEquity",

  async load() {
    const { status, metrics } = await indiaEquityDataset.getData();
    // Kick the bounded background fill for names without ownership extracts
    // (≤25 per load, 4s apart, ≥30min between kicks). Never blocks the screen.
    trickleEnrichIndiaOwnership(metrics.map((m) => m.symbol));
    return { status: toStatus(status), candidates: metrics.map(toIndiaCandidate) };
  },

  refresh() {
    return toStatus(indiaEquityDataset.refresh());
  },

  peekStatus() {
    return toStatus(indiaEquityDataset.getStatus());
  },
};
