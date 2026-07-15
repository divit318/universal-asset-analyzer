/**
 * Module 5 — Market Intelligence.
 *
 * The one genuinely new *data* surface on the homepage: a cross-asset tape.
 * The Scanner already fetches a macro set (`lib/scanner/signals.ts`), but it is
 * scoped to what regime detection needs — no equity indices beyond the S&P, no
 * crypto, no FX pairs. Rather than fork that list, this module fetches its own
 * tape through `getQuotes()`, which is platform-routed: the `quotes.batch`
 * dataset gives it a 15s TTL, request deduplication, and provenance for free.
 * Symbols that overlap with the Scanner's set (^VIX, ^GSPC, ^TNX, GC=F, CL=F)
 * therefore collapse into the same cache entry rather than costing a second
 * provider call.
 *
 * Breadth and regime are NOT recomputed here — they come from the Scanner
 * snapshot / sector-rotation engines via the caller. This module does no
 * scoring beyond the sentiment proxy, which is itself pure and lives in
 * sentiment.ts.
 */

import { getQuotes } from "../yahoo";
import { computeSentiment } from "./sentiment";
import type { MarketGroup, MarketGroupId, MarketIntelligence, MarketTicker, SectorAttentionChange } from "./contracts";
import type { CardStatus } from "../mission-control";
import type { MarketRegime } from "../types";

/**
 * The tape. Grouped the way an investor scans it, not the way Yahoo returns it.
 *
 * Deliberately excludes anything that needs a paid feed (no options flow, no
 * real-time futures depth) and anything where the free symbol is unreliable.
 */
const TAPE: { id: MarketGroupId; label: string; tickers: { symbol: string; label: string }[] }[] = [
  {
    id: "indices",
    label: "Indices",
    tickers: [
      { symbol: "^GSPC", label: "S&P 500" },
      { symbol: "^IXIC", label: "Nasdaq" },
      { symbol: "^DJI", label: "Dow" },
      { symbol: "^RUT", label: "Russell 2000" },
    ],
  },
  {
    id: "volatility",
    label: "Volatility",
    tickers: [{ symbol: "^VIX", label: "VIX" }],
  },
  {
    id: "rates",
    label: "Rates",
    tickers: [
      { symbol: "^TNX", label: "US 10Y" },
      { symbol: "^FVX", label: "US 5Y" },
      { symbol: "^TYX", label: "US 30Y" },
    ],
  },
  {
    id: "commodities",
    label: "Commodities",
    tickers: [
      { symbol: "GC=F", label: "Gold" },
      { symbol: "CL=F", label: "Crude (WTI)" },
      { symbol: "HG=F", label: "Copper" },
      { symbol: "NG=F", label: "Nat Gas" },
    ],
  },
  {
    id: "currencies",
    label: "Currencies",
    tickers: [
      { symbol: "DX-Y.NYB", label: "Dollar (DXY)" },
      { symbol: "EURUSD=X", label: "EUR/USD" },
      { symbol: "USDJPY=X", label: "USD/JPY" },
    ],
  },
  {
    id: "crypto",
    label: "Crypto",
    tickers: [
      { symbol: "BTC-USD", label: "Bitcoin" },
      { symbol: "ETH-USD", label: "Ethereum" },
    ],
  },
];

const ALL_SYMBOLS = TAPE.flatMap((g) => g.tickers.map((t) => t.symbol));

export interface MarketIntelInputs {
  /** From the Scanner snapshot or the live regime computation. Not recomputed here. */
  regime: MarketRegime | null;
  /** Share of sectors advancing, from the sector-rotation engine. */
  breadthPct: number | null;
  /** Leadership changes in sectors the user holds — from buildSectorAttention(). */
  sectorAttention: SectorAttentionChange[];
}

/**
 * Builds the tape. One batched quote call for every symbol on the page.
 *
 * A provider failure degrades to `status: "degraded"` with whatever quotes did
 * arrive, rather than failing the module: a missing EUR/USD is not a reason to
 * hide the S&P.
 */
export async function buildMarketIntelligence(inputs: MarketIntelInputs): Promise<MarketIntelligence> {
  let quotes;
  try {
    quotes = await getQuotes(ALL_SYMBOLS);
  } catch {
    return {
      status: "degraded",
      groups: [],
      breadthPct: inputs.breadthPct,
      sentiment: null,
      regime: toRegimeSummary(inputs.regime),
      sectorAttention: inputs.sectorAttention,
    };
  }

  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const groups: MarketGroup[] = TAPE.map((g) => ({
    id: g.id,
    label: g.label,
    tickers: g.tickers.map<MarketTicker>((t) => {
      const q = bySymbol.get(t.symbol.toUpperCase());
      return {
        symbol: t.symbol,
        label: t.label,
        price: q?.price ?? null,
        changePct: q?.changePercent ?? null,
      };
    }),
  })).filter((g) => g.tickers.some((t) => t.price != null));

  const vix = bySymbol.get("^VIX");
  const sp500 = bySymbol.get("^GSPC");

  const sentiment = computeSentiment({
    // The VIX *level* is the sentiment input, not its daily change.
    vixLevel: vix?.price ?? null,
    breadthPct: inputs.breadthPct,
    sp500ChangePct: sp500?.changePercent ?? null,
  });

  const received = groups.reduce((n, g) => n + g.tickers.filter((t) => t.price != null).length, 0);
  const status: CardStatus = received === 0 ? "empty" : received < ALL_SYMBOLS.length / 2 ? "degraded" : "ok";

  return {
    status,
    groups,
    breadthPct: inputs.breadthPct,
    sentiment,
    regime: toRegimeSummary(inputs.regime),
    sectorAttention: inputs.sectorAttention,
  };
}

function toRegimeSummary(regime: MarketRegime | null): MarketIntelligence["regime"] {
  if (!regime) return null;
  return { trend: regime.trend, summary: regime.summary, breadthPct: regime.breadthPct ?? null };
}
