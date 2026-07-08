import { NextResponse } from "next/server";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements, getFinancialStatementsYahoo } from "@/lib/statements";
import { getHistory, getQuote } from "@/lib/yahoo";
import { computeMomentum, computeScore, assessRisks } from "@/lib/scoring";
import { compareStocks } from "@/lib/ai-compare";
import { normalizeSymbol } from "@/lib/market";
import { buildOpportunityProfile, type OpportunityProfile } from "@/lib/opportunity-engine";
import type { FinancialStatements, FundamentalsSnapshot, AnalystConsensus, ScoreResult, MomentumSignal, Quote, RiskItem } from "@/lib/types";

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

  const entries: CompareEntry[] = await Promise.all(
    symbols.map(async (symbol): Promise<CompareEntry> => {
      try {
        const [parts, quote, history] = await Promise.all([
          getFundamentals(symbol),
          getQuote(symbol),
          getHistory(symbol, 420),
        ]);
        // Try Yahoo Finance first (works for all markets, more consistent).
        // Fall back to SEC EDGAR for deeper history when Yahoo returns < 3 FYs.
        const yahooStatements = await getFinancialStatementsYahoo(symbol);
        const edgarStatements = (yahooStatements?.fiscalYears.length ?? 0) < 3
          ? await getFinancialStatements(symbol).catch(() => null)
          : null;
        // Prefer whichever has more fiscal years.
        const statements: FinancialStatements | null = (() => {
          if (!yahooStatements && !edgarStatements) return null;
          if (!yahooStatements) return edgarStatements;
          if (!edgarStatements) return yahooStatements;
          return yahooStatements.fiscalYears.length >= edgarStatements.fiscalYears.length
            ? yahooStatements : edgarStatements;
        })();

        const momentum = computeMomentum(history);
        const score = computeScore(parts.snapshot, statements, parts.analyst, momentum);
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

        return { symbol, name: quote.name, quote, snapshot: parts.snapshot, statements, analyst: parts.analyst, score, momentum, oneYearReturn, fcfYieldPct, netDebtToEbitda, risks, opportunity };
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
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(symbols)];

  if (unique.length < 2) {
    return NextResponse.json({ error: "At least two distinct symbols are required" }, { status: 400 });
  }
  if (unique.length > 5) {
    return NextResponse.json({ error: "At most 5 symbols can be compared at once" }, { status: 400 });
  }

  try {
    const result = await compareStocks(unique);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Comparison failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
