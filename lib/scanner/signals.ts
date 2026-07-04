/**
 * Scanner v2 — supplementary signal sources.
 *
 * Fetches macro, market-structure, and commodity signals from Yahoo Finance
 * to give the pipeline real context beyond headlines.
 * All sources are free / no-auth required.
 */

import type { MacroSignal } from "../types";
import { SECTOR_ETFS as CANONICAL_SECTOR_ETFS } from "../sector-rotation";

const MACRO_TICKERS: { ticker: string; name: string }[] = [
  { ticker: "^TNX",   name: "10Y Treasury Yield" },
  { ticker: "^VIX",   name: "VIX (Fear Index)" },
  { ticker: "DX-Y.NYB", name: "US Dollar Index (DXY)" },
  { ticker: "GC=F",   name: "Gold" },
  { ticker: "CL=F",   name: "Crude Oil (WTI)" },
  { ticker: "^GSPC",  name: "S&P 500" },
  { ticker: "^NSEI",  name: "NIFTY 50" },
  { ticker: "^BSESN", name: "BSE Sensex" },
  { ticker: "HG=F",   name: "Copper" },
  { ticker: "NG=F",   name: "Natural Gas" },
];

// Single source of truth for sector ETF tickers: lib/sector-rotation.ts
const SECTOR_ETFS: { ticker: string; sector: string }[] = CANONICAL_SECTOR_ETFS;

interface YahooQuoteRaw {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
}

async function fetchQuoteBatch(
  tickers: string[],
): Promise<Map<string, YahooQuoteRaw>> {
  const map = new Map<string, YahooQuoteRaw>();
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

    // Fetch in batches of 10 to avoid hitting rate limits
    const batchSize = 10;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((t) =>
          yf.quote(t).catch(() => null),
        ),
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value) {
          map.set(batch[j], r.value as YahooQuoteRaw);
        }
      }
    }
  } catch {
    // Silently degrade — macro signals are best-effort
  }
  return map;
}

function deriveTrend(changePct: number | null | undefined): "rising" | "falling" | "flat" {
  if (changePct == null) return "flat";
  if (changePct > 0.3) return "rising";
  if (changePct < -0.3) return "falling";
  return "flat";
}

/** Fetch live macro signals (yields, indices, commodities). Best-effort. */
export async function fetchMacroSignals(): Promise<MacroSignal[]> {
  const tickers = MACRO_TICKERS.map((t) => t.ticker);
  const quotes = await fetchQuoteBatch(tickers);

  return MACRO_TICKERS.map(({ ticker, name }) => {
    const q = quotes.get(ticker);
    const changePct = q?.regularMarketChangePercent ?? null;
    return {
      ticker,
      name,
      price: q?.regularMarketPrice ?? null,
      changePercent: changePct,
      trend: deriveTrend(changePct),
    };
  });
}

/** Fetch live sector ETF performance for sector rotation context. */
export interface SectorPerformance {
  sector: string;
  etfTicker: string;
  changePercent: number | null;
  trend: "rising" | "falling" | "flat";
}

export async function fetchSectorPerformance(): Promise<SectorPerformance[]> {
  const tickers = SECTOR_ETFS.map((e) => e.ticker);
  const quotes = await fetchQuoteBatch(tickers);

  return SECTOR_ETFS.map(({ ticker, sector }) => {
    const q = quotes.get(ticker);
    const changePct = q?.regularMarketChangePercent ?? null;
    return {
      sector,
      etfTicker: ticker,
      changePercent: changePct,
      trend: deriveTrend(changePct),
    };
  });
}

/**
 * Derive a simple market breadth approximation from sector ETF performance.
 * Returns the percentage of sectors that are advancing.
 */
export function computeMarketBreadth(sectors: SectorPerformance[]): number | null {
  const valid = sectors.filter((s) => s.changePercent != null);
  if (valid.length === 0) return null;
  const advancing = valid.filter((s) => (s.changePercent ?? 0) > 0).length;
  return Math.round((advancing / valid.length) * 100);
}
