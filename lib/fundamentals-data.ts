/**
 * Fundamentals assembly — snapshot + statements + score + risks + valuation.
 *
 * Promoted out of `app/api/fundamentals/route.ts` so the orchestrated research
 * bundle (lib/research-bundle.ts) can build the exact same FundamentalsData
 * without paying an HTTP round-trip to its own API route. The route is now a
 * thin wrapper over this.
 *
 * Every fetch inside goes through the Platform Data Layer via lib/yahoo.ts and
 * lib/statements.ts, so calling this from both places costs one set of provider
 * requests, not two.
 */

import { getFundamentals } from "./fundamentals";
import { getStatementsWithFallback } from "./statements";
import { getFundamentalsTimeSeries, getHistory } from "./yahoo";
import { assessRisks, classifyInvestmentPersonality, computeMomentum, computeScore } from "./scoring";
import { detectMarket } from "./market";
import { getLatestSectorRotation, findSectorRotationEntry } from "./sector-rotation";
import type { FinancialStatements, FundamentalsData, HistoryPoint, ValuationPoint } from "./types";

/* -------------------------------------------------------------------------- */
/* Valuation history helpers                                                  */
/* -------------------------------------------------------------------------- */

/** Unwrap { raw } wrapper or accept bare number. */
const rv = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    const x = (v as { raw?: number }).raw;
    return x != null && Number.isFinite(x) ? x : null;
  }
  return null;
};

/** Latest price on or before `isoDate`, or null if history doesn't reach back. */
function priceAtDate(history: HistoryPoint[], isoDate: string): number | null {
  let best: HistoryPoint | null = null;
  for (const p of history) {
    if (p.date <= isoDate) {
      if (!best || p.date > best.date) best = p;
    }
  }
  // Only accept if within 45 calendar days of the target (guards against very
  // old fiscal years where we have no price data at all).
  if (!best) return null;
  const diffDays =
    (new Date(isoDate).getTime() - new Date(best.date).getTime()) / 86_400_000;
  return diffDays <= 45 ? best.close : null;
}

/**
 * Build annual P/E and P/S snapshots from Yahoo's fundamentals time series.
 * Each row in `ts` corresponds to one fiscal year and contains fields like
 * `dilutedEPS`, `totalRevenue`, `dilutedAverageShares`, and `asOfDate`.
 */
export function buildValuation(
  ts: Record<string, unknown>[],
  history: HistoryPoint[],
): ValuationPoint[] {
  const points: ValuationPoint[] = [];
  for (const row of ts) {
    // Yahoo returns `date` as a Date object; normalize to ISO string for comparison.
    const rawDate = row.asOfDate ?? row.date;
    if (!rawDate) continue;
    let asOfDate: string;
    try {
      asOfDate = new Date(rawDate as string | Date).toISOString().slice(0, 10);
    } catch {
      continue;
    }

    const year = new Date(asOfDate).getFullYear();
    const price = priceAtDate(history, asOfDate);
    if (!price) continue;

    const eps = rv(row.dilutedEPS);
    const revenue = rv(row.totalRevenue);
    const shares = rv(row.dilutedAverageShares);

    const peRatio =
      eps != null && eps > 0 && price > 0
        ? parseFloat((price / eps).toFixed(1))
        : null;

    const psRatio =
      revenue != null && revenue > 0 && shares != null && shares > 0 && price > 0
        ? parseFloat(((price * shares) / revenue).toFixed(2))
        : null;

    // Sanity filter: skip obviously wrong values (e.g. ADR currency mismatches)
    const pe = peRatio != null && peRatio >= 1 && peRatio <= 500 ? peRatio : null;
    const ps = psRatio != null && psRatio >= 0.1 && psRatio <= 100 ? psRatio : null;

    if (pe != null || ps != null) {
      points.push({ year, peRatio: pe, psRatio: ps });
    }
  }
  // Deduplicate by year (keep last occurrence, which is the most refined data).
  const byYear = new Map<number, ValuationPoint>();
  for (const p of points) byYear.set(p.year, p);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo snapshot/analyst/insider + EDGAR statements → composite score + risks,
 * plus earnings history, institutional ownership, and valuation history.
 *
 * Throws when the base snapshot is unavailable (no company to analyze).
 */
export async function buildFundamentalsData(symbol: string): Promise<FundamentalsData> {
  const parts = await getFundamentals(symbol);

  // Statements, 5yr price history (for momentum + valuation), and the annual
  // fundamentals time series are mutually independent — all three at once.
  // Yahoo Finance is tried first (works for all markets); EDGAR is the fallback
  // for deeper US history when Yahoo returns fewer than 3 fiscal years.
  const [statementsResult, history, timeSeries] = await Promise.all([
    getStatementsWithFallback(symbol),
    getHistory(symbol, 1825),
    getFundamentalsTimeSeries(symbol).catch(() => [] as Record<string, unknown>[]),
  ]);

  const { statements, error: statementsError } = statementsResult;
  const momentum = computeMomentum(history);

  // Market-aware scoring: symbol suffix alone (no live quote needed here)
  // is enough for detectMarket()'s IN/JP/HK/AU/EU branches, which is what
  // distinguishes India research's fundamentals-over-analyst-consensus
  // weighting. Sector rotation entry is a cheap synchronous DB read.
  const market = detectMarket({ symbol, currency: "", exchange: null, assetType: null });
  const rotation = getLatestSectorRotation();
  const sectorRotationEntry = findSectorRotationEntry(rotation, parts.snapshot.sector);

  const score = computeScore(parts.snapshot, statements, parts.analyst, momentum, sectorRotationEntry, market);
  const risks = assessRisks(parts.snapshot, statements, parts.analyst, parts.insider);
  const valuation = buildValuation(timeSeries, history);
  const personality = classifyInvestmentPersonality(score, parts.snapshot, momentum);

  return {
    snapshot: parts.snapshot,
    statements,
    statementsError,
    analyst: parts.analyst,
    insider: parts.insider,
    score,
    risks,
    momentum,
    earnings: parts.earnings,
    ownership: parts.ownership,
    valuation,
    personality,
  };
}
