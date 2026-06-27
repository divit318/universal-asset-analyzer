import { NextResponse } from "next/server";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements, getFinancialStatementsYahoo } from "@/lib/statements";
import { getHistory, getQuote } from "@/lib/yahoo";
import { computeMomentum, computeScore } from "@/lib/scoring";
import { compareStocks } from "@/lib/ai-compare";
import type { FinancialStatements, FundamentalsSnapshot, AnalystConsensus, ScoreResult, MomentumSignal, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5);
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

        return { symbol, name: quote.name, quote, snapshot: parts.snapshot, statements, analyst: parts.analyst, score, momentum, oneYearReturn, fcfYieldPct, netDebtToEbitda };
      } catch (err) {
        return { symbol, name: symbol, error: err instanceof Error ? err.message : "Failed to load" };
      }
    }),
  );

  return NextResponse.json({ entries });
}

export const maxDuration = 60;

/**
 * POST /api/compare
 * Body: { symbolA: string, symbolB: string }
 * Returns ComparisonResult — full structured AI comparison with metric table.
 */
export async function POST(request: Request) {
  let body: { symbolA?: string; symbolB?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const a = body.symbolA?.trim().toUpperCase();
  const b = body.symbolB?.trim().toUpperCase();
  if (!a || !b) {
    return NextResponse.json({ error: "symbolA and symbolB are required" }, { status: 400 });
  }
  if (a === b) {
    return NextResponse.json({ error: "Symbols must be different" }, { status: 400 });
  }

  try {
    const result = await compareStocks(a, b);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Comparison failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
