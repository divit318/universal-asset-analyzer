import { NextResponse } from "next/server";
import { getFundamentals, MODULES } from "@/lib/fundamentals";
import { getFinancialStatements, getFinancialStatementsYahoo } from "@/lib/statements";
import { getHistory, getQuote, getQuoteMeta, getQuoteSummaryMeta } from "@/lib/yahoo";
import { computeMomentum, computeScore, assessRisks } from "@/lib/scoring";
import { compareStocks } from "@/lib/ai-compare";
import { detectMarket, normalizeSymbol } from "@/lib/market";
import { findSectorRotationEntry, getLatestSectorRotation } from "@/lib/sector-rotation";
import { buildOpportunityProfile, type OpportunityProfile } from "@/lib/opportunity-engine";
import { computeEntryBenchmarks, peerGroupOf, loadBenchmarkUniverse, type PeerBenchmark } from "@/lib/compare/benchmarks";
import type { EntryFreshness } from "@/lib/compare/types";
import type { FinancialStatements, FundamentalsSnapshot, AnalystConsensus, ScoreResult, MomentumSignal, Quote, RiskItem } from "@/lib/types";

/** Which registry metric key each equity CompareEntry field corresponds to, for sector-benchmark lookup. Only fields with a like-for-like registry equivalent are included — the rest (analyst counts, the bespoke scoring.ts composite/bucket scores) have no universe-wide counterpart to benchmark against honestly. */
const BENCHMARK_METRICS = [
  "forwardPE", "pegRatio", "fcfYield", "roe", "grossMargin", "operatingMargin",
  "debtToEquity", "dividendYield", "revenueGrowthYoY", "oneYearReturn", "distanceFrom52WkHigh",
] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface CompareEntry {
  symbol: string;
  name: string;
  error?: string;
  quote?: Quote;
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  analyst?: AnalystConsensus;
  score?: ScoreResult;
  momentum?: MomentumSignal | null;
  oneYearReturn?: number | null;
  fcfYieldPct?: number | null;
  netDebtToEbitda?: number | null;
  risks?: RiskItem[];
  opportunity?: OpportunityProfile;
  benchmarks?: Record<string, PeerBenchmark>;
  freshness?: EntryFreshness;
}

/** Pull a bucket's percentage-of-max from a ScoreResult — reuses the same bucket shape the Compare page already renders. */
function bucketPct(score: ScoreResult, name: string): number | null {
  const b = score.buckets.find((bk) => bk.name === name);
  return b ? Math.round((b.points / b.max) * 100) : null;
}

function computeOneYearReturn(history: { date: string; close: number }[]): number | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const target = new Date(latest.date);
  target.setFullYear(target.getFullYear() - 1);
  const targetMs = target.getTime();
  let closest: { date: string; close: number } | null = null;
  let minDiff = Infinity;
  for (const h of sorted) {
    const diff = Math.abs(new Date(h.date).getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; closest = h; }
  }
  if (!closest || minDiff > 45 * 24 * 60 * 60 * 1000) return null;
  return ((latest.close - closest.close) / closest.close) * 100;
}

/** GET /api/compare?symbols=AAPL,MSFT,GOOGL — up to 5 symbols. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => normalizeSymbol(s)).filter((s): s is string => s !== null))].slice(0, 5);
  if (symbols.length < 1) {
    return NextResponse.json({ error: "At least one symbol is required" }, { status: 400 });
  }

  // Loaded once and shared across every symbol — sector peers for a benchmark
  // come from the same 1000-name universe the Screener uses, not a re-fetch
  // per compared stock. Best-effort with a short timeout: a cold universe
  // build must never make this lightweight compare request hang.
  const equityUniverse = await loadBenchmarkUniverse("equity");

  const entries: CompareEntry[] = await Promise.all(
    symbols.map(async (symbol): Promise<CompareEntry> => {
      try {
        const [parts, quote, history, quoteMeta, fundamentalsMeta] = await Promise.all([
          getFundamentals(symbol),
          getQuote(symbol),
          // 1825 days, matching lib/fundamentals-data.ts. `computeMomentum` reads
          // the series it is given, so a 420-day window produced a different
          // momentum signal — and therefore a different conviction score — than
          // /research for the same company. The window is part of the input, so it
          // has to match. The platform caches history by (symbol, days), so asking
          // for the same window the research bundle asks for is also a cache hit
          // rather than an extra fetch.
          getHistory(symbol, 1825),
          getQuoteMeta(symbol),
          getQuoteSummaryMeta(symbol, MODULES),
        ]);
        // Try Yahoo Finance first (works for all markets, more consistent).
        // Fall back to SEC EDGAR for deeper history when Yahoo returns < 3 FYs.
        const yahooStatements = await getFinancialStatementsYahoo(symbol);
        const edgarStatements = (yahooStatements?.fiscalYears.length ?? 0) < 3
          ? await getFinancialStatements(symbol).catch(() => null)
          : null;
        // Prefer whichever has more fiscal years.
        const usedEdgar = edgarStatements != null && (!yahooStatements || edgarStatements.fiscalYears.length > yahooStatements.fiscalYears.length);
        const statements: FinancialStatements | null = (() => {
          if (!yahooStatements && !edgarStatements) return null;
          if (!yahooStatements) return edgarStatements;
          if (!edgarStatements) return yahooStatements;
          return yahooStatements.fiscalYears.length >= edgarStatements.fiscalYears.length
            ? yahooStatements : edgarStatements;
        })();

        const momentum = computeMomentum(history);

        /* Sector rotation is threaded in EXPLICITLY, exactly as the research
           bundle does it.
        
           `computeScore`'s 5th argument is opt-in ("omit entirely to leave
           existing callers' output unchanged"), and this route used to omit it.
           Same engine, same company, different inputs — so /research and /compare
           reported different conviction scores for the same stock with nothing on
           either screen to explain it. Measured: NVDA scored 80 on Research
           (sector rotation 4/100 — Technology ranked 11 of 11) and 86 on Compare,
           which simply had not been told about the sector.
        
           `null` is a meaningful value here and distinct from `undefined`: it
           means "checked, this sector has no rotation entry", which still adds the
           bucket. So it is passed through rather than defaulted away. */
        const sectorRotation = parts.snapshot?.sector
          ? findSectorRotationEntry(getLatestSectorRotation(), parts.snapshot.sector)
          : null;

        const score = computeScore(
          parts.snapshot,
          statements,
          parts.analyst,
          momentum,
          sectorRotation,
          // Market-aware weighting: India leans harder on fundamentals because
          // analyst coverage is sparser. Research does this too, so omitting it
          // here would be a second source of divergence for NSE/BSE names.
          detectMarket(quote),
        );
        const oneYearReturn = computeOneYearReturn(history);

        const fcfYieldPct =
          parts.snapshot.freeCashflow != null && quote.marketCap
            ? (parts.snapshot.freeCashflow / quote.marketCap) * 100
            : null;

        const netDebtToEbitda =
          parts.snapshot.totalDebt != null &&
          parts.snapshot.totalCash != null &&
          parts.snapshot.ebitda
            ? (parts.snapshot.totalDebt - parts.snapshot.totalCash) / parts.snapshot.ebitda
            : null;

        const risks = assessRisks(parts.snapshot, statements, parts.analyst, parts.insider);

        const opportunity = buildOpportunityProfile({
          symbol,
          score: score.composite,
          dimensions: {
            value: bucketPct(score, "Valuation"),
            growth: bucketPct(score, "Growth"),
            quality: bucketPct(score, "Quality"),
            financialHealth: bucketPct(score, "Financial Health"),
            momentum: momentum?.score ?? null,
          },
          confidence: score.confidence,
          dividendYieldPct: parts.snapshot.dividendYield != null ? parts.snapshot.dividendYield * 100 : null,
          momentum3mReturn: momentum?.return3m ?? null,
          momentumTrend: momentum?.trend ?? null,
          riskItems: risks,
        });

        const peerGroup = peerGroupOf("equity", { sector: parts.snapshot.sector });
        const benchmarkValues: Record<string, number | null> = {
          forwardPE: parts.snapshot.forwardPE,
          pegRatio: parts.snapshot.pegRatio,
          fcfYield: fcfYieldPct,
          roe: parts.snapshot.returnOnEquity != null ? parts.snapshot.returnOnEquity * 100 : null,
          grossMargin: parts.snapshot.grossMargins != null ? parts.snapshot.grossMargins * 100 : null,
          operatingMargin: parts.snapshot.operatingMargins != null ? parts.snapshot.operatingMargins * 100 : null,
          debtToEquity: parts.snapshot.debtToEquity,
          dividendYield: parts.snapshot.dividendYield != null ? parts.snapshot.dividendYield * 100 : null,
          revenueGrowthYoY: parts.snapshot.revenueGrowth != null ? parts.snapshot.revenueGrowth * 100 : null,
          oneYearReturn,
          distanceFrom52WkHigh: momentum?.pctFrom52WkHigh ?? null,
        };
        const benchmarks = computeEntryBenchmarks(
          "equity", [...BENCHMARK_METRICS], symbol, benchmarkValues, peerGroup, equityUniverse,
        );

        const latestFiscalYear = statements?.fiscalYears.length ? statements.fiscalYears[statements.fiscalYears.length - 1] : null;
        const freshness: EntryFreshness = {
          price: { asOf: quoteMeta.fetchedAt, source: "yahoo" },
          fundamentals: { asOf: fundamentalsMeta.fetchedAt, source: "yahoo" },
          statements: latestFiscalYear != null
            ? { asOf: `${latestFiscalYear}-12-31`, source: usedEdgar ? "sec_edgar" : "yahoo", fiscalYear: latestFiscalYear }
            : null,
        };

        return { symbol, name: quote.name, quote, snapshot: parts.snapshot, statements, analyst: parts.analyst, score, momentum, oneYearReturn, fcfYieldPct, netDebtToEbitda, risks, opportunity, benchmarks, freshness };
      } catch (err) {
        return { symbol, name: symbol, error: err instanceof Error ? err.message : "Failed to load" };
      }
    }),
  );

  return NextResponse.json({ entries });
}

/**
 * POST /api/compare
 * Body: { symbols: string[] } (2-5 symbols) — also accepts the legacy
 * { symbolA, symbolB } shape for backward compatibility.
 * Returns ComparisonResult — full structured AI comparison with metric table
 * covering every symbol requested, not just a pair.
 */
export async function POST(request: Request) {
  let body: { symbols?: string[]; symbolA?: string; symbolB?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbols = (
    Array.isArray(body.symbols) && body.symbols.length > 0
      ? body.symbols
      : [body.symbolA, body.symbolB].filter((s): s is string => Boolean(s))
  )
    .map((s) => normalizeSymbol(s))
    .filter((s): s is string => s !== null);
  const unique = [...new Set(symbols)];

  if (unique.length < 2) {
    return NextResponse.json({ error: "At least two distinct symbols are required" }, { status: 400 });
  }
  if (unique.length > 5) {
    return NextResponse.json({ error: "At most 5 symbols can be compared at once" }, { status: 400 });
  }

  try {
    // Forward the client's own abort signal: if the browser cancels this
    // request (user changed symbols, re-triggered analysis, or navigated
    // away), that cancellation now propagates all the way down to the
    // in-flight AI call instead of running to completion unobserved.
    // On the old serializing local backend, a single abandoned request used to
    // occupy the queue behind every other AI call on the box until it
    // finished on its own.
    const result = await compareStocks(unique, { signal: request.signal });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // The client is gone; nothing to respond to. Next.js treats a thrown
      // AbortError from a cancelled request as a non-issue, but return
      // something well-formed in case a proxy/test harness still reads it.
      return NextResponse.json({ error: "Cancelled" }, { status: 499 });
    }
    const message = err instanceof Error ? err.message : "Comparison failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
