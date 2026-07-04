import { NextResponse } from "next/server";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements, getFinancialStatementsYahoo } from "@/lib/statements";
import { getFundamentalsTimeSeries, getHistory } from "@/lib/yahoo";
import { assessRisks, classifyInvestmentPersonality, computeMomentum, computeScore } from "@/lib/scoring";
import { detectMarket, normalizeSymbol } from "@/lib/market";
import { getLatestSectorRotation, findSectorRotationEntry } from "@/lib/sector-rotation";
import type { FinancialStatements, FundamentalsData, HistoryPoint, ValuationPoint } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
function buildValuation(
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
/* Route handler                                                               */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/fundamentals?symbol=AAPL
 * Yahoo snapshot/analyst/insider + EDGAR statements → composite score + risks.
 * Now also includes earnings history, institutional ownership, and valuation history.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid `symbol` query parameter is required" },
      { status: 400 },
    );
  }

  let parts;
  try {
    parts = await getFundamentals(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fundamentals lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  // Fetch statements, 5yr price history (for momentum + valuation),
  // and the annual fundamentals time series all in parallel.
  // Yahoo Finance is tried first (works for all markets); EDGAR is the fallback
  // for deeper US history when Yahoo returns fewer than 3 fiscal years.
  const [statementsResult, history, timeSeries] = await Promise.all([
    (async (): Promise<{ statements: FinancialStatements | null; error: string | null }> => {
      const yahoo = await getFinancialStatementsYahoo(symbol);
      if (yahoo && yahoo.fiscalYears.length >= 3) return { statements: yahoo, error: null };
      // fallback to EDGAR for US-listed companies with deeper history
      const edgar = await getFinancialStatements(symbol).catch((e: unknown) => ({
        err: e instanceof Error ? e.message : "EDGAR statements unavailable",
      }));
      if ("err" in edgar) {
        // If EDGAR also fails, return Yahoo result even if short (better than nothing)
        if (yahoo) return { statements: yahoo, error: null };
        return { statements: null, error: edgar.err };
      }
      // prefer whichever source has more years
      const best = yahoo && yahoo.fiscalYears.length >= edgar.fiscalYears.length ? yahoo : edgar;
      return { statements: best, error: null };
    })(),
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

  const payload: FundamentalsData = {
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
  return NextResponse.json(payload);
}
