/**
 * Market-aware benchmark selection — the one place that decides what an asset
 * should be compared against.
 *
 * Before this existed, SPY was hardcoded into the research bundle, so an
 * Indian stock's "relative performance" line compared RELIANCE.NS against the
 * S&P 500 — a meaningless comparison an Indian investor would never make.
 *
 * Pure module (no I/O, no node imports) — safe for client components.
 * All index tickers verified live against Yahoo Finance (2026-08).
 */

import type { MarketRegion } from "./market";

export interface Benchmark {
  /** Yahoo symbol, e.g. "^NSEI". */
  symbol: string;
  /** Short display label used as the chart series name, e.g. "NIFTY 50". */
  label: string;
}

const MARKET_BENCHMARK: Record<MarketRegion, Benchmark> = {
  US: { symbol: "SPY", label: "S&P 500" },
  IN: { symbol: "^NSEI", label: "NIFTY 50" },
  JP: { symbol: "^N225", label: "Nikkei 225" },
  HK: { symbol: "^HSI", label: "Hang Seng" },
  AU: { symbol: "^AXJO", label: "ASX 200" },
  EU: { symbol: "^STOXX50E", label: "STOXX 50" },
  CRYPTO: { symbol: "BTC-USD", label: "BTC" },
};

export function marketBenchmark(region: MarketRegion): Benchmark {
  return MARKET_BENCHMARK[region] ?? MARKET_BENCHMARK.US;
}

/** Suffix-based region detection for contexts that only have the symbol
 *  (the research bundle picks its benchmark before the quote resolves). */
export function benchmarkForSymbol(symbol: string): Benchmark {
  const s = symbol.trim().toUpperCase();
  if (/\.(NS|BO)$/.test(s)) return MARKET_BENCHMARK.IN;
  if (s.endsWith(".T")) return MARKET_BENCHMARK.JP;
  if (s.endsWith(".HK")) return MARKET_BENCHMARK.HK;
  if (s.endsWith(".AX")) return MARKET_BENCHMARK.AU;
  return MARKET_BENCHMARK.US;
}

/**
 * The benchmark for a MIXED set of holdings — the market where most of the
 * symbols live. Symbol-count majority (not value-weighted: quotes may not
 * have resolved yet when the benchmark fetch is planned), which is right for
 * the common cases — an all-India book gets NIFTY 50, an all-US book keeps
 * SPY, and a genuinely mixed book gets the market it mostly holds.
 */
export function dominantBenchmark(symbols: string[]): Benchmark {
  const counts = new Map<string, number>();
  for (const s of symbols) {
    const b = benchmarkForSymbol(s);
    counts.set(b.symbol, (counts.get(b.symbol) ?? 0) + 1);
  }
  let best: Benchmark = MARKET_BENCHMARK.US;
  let bestCount = -1;
  for (const [symbol, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = Object.values(MARKET_BENCHMARK).find((b) => b.symbol === symbol) ?? MARKET_BENCHMARK.US;
    }
  }
  return best;
}

/**
 * Annual risk-free rate for Sharpe/Sortino-style excess-return math.
 * US: ~3M T-bill; IN: ~10Y GOI (the same 6.5% the valuation layer's WACC uses).
 */
export function riskFreeRate(region: MarketRegion): number {
  return region === "IN" ? 0.065 : 0.0425;
}

/** Region a benchmark belongs to — the inverse of marketBenchmark. */
export function regionForBenchmark(benchmark: Benchmark): MarketRegion {
  for (const [region, b] of Object.entries(MARKET_BENCHMARK) as [MarketRegion, Benchmark][]) {
    if (b.symbol === benchmark.symbol) return region;
  }
  return "US";
}

/**
 * NIFTY sectoral index for an Indian stock's sector (Yahoo's sector taxonomy
 * on .NS names). Null when no liquid sectoral index maps cleanly — the caller
 * falls back to no sector overlay, never to a US sector ETF.
 * (^CNXFIN returns degenerate history on Yahoo; financials use NIFTY Bank.)
 */
export function indiaSectorIndex(sector: string | null | undefined): Benchmark | null {
  if (!sector) return null;
  const s = sector.toLowerCase();
  if (s.includes("financial") || s.includes("bank")) return { symbol: "^NSEBANK", label: "NIFTY Bank" };
  if (s.includes("technology")) return { symbol: "^CNXIT", label: "NIFTY IT" };
  if (s.includes("consumer defensive")) return { symbol: "^CNXFMCG", label: "NIFTY FMCG" };
  if (s.includes("healthcare")) return { symbol: "^CNXPHARMA", label: "NIFTY Pharma" };
  if (s.includes("consumer cyclical") || s.includes("auto")) return { symbol: "^CNXAUTO", label: "NIFTY Auto" };
  if (s.includes("energy") || s.includes("utilities")) return { symbol: "^CNXENERGY", label: "NIFTY Energy" };
  if (s.includes("basic materials") || s.includes("metal")) return { symbol: "^CNXMETAL", label: "NIFTY Metal" };
  if (s.includes("real estate")) return { symbol: "^CNXREALTY", label: "NIFTY Realty" };
  if (s.includes("industrial")) return { symbol: "^CNXINFRA", label: "NIFTY Infra" };
  return null;
}
