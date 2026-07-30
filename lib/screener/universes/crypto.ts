/**
 * The crypto universe. Pages Yahoo's CRYPTOCURRENCY screener by market cap.
 *
 * The screener row carries `marketCap`, `circulatingSupply`, `totalSupply`,
 * `maxSupply` and `volume24Hr` — verified live against BTC (21M max supply),
 * ETH and SOL. That's enough to compute FDV and the circulating share of
 * supply for real, which is the closest honest read on unlock/dilution risk
 * available without a vesting-schedule feed.
 *
 * Everything on-chain (TVL, staking, addresses, dev activity, flows, whales)
 * is declared unavailable in the registry and is not computed here. See
 * lib/assets/crypto.ts.
 */

import { displayAssetName } from "../../format";
import { getHistory } from "../../yahoo";
import { pageRawScreener, q, type RawQuoteRow } from "../../yahoo-screener";
import {
  annualizedVolatility,
  drawdown,
  mapPool,
  trailingReturn,
  withRetry,
} from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import { cryptoSector } from "../../assets/reference/crypto-sectors";

const UNIVERSE_LIMIT = Number(process.env.SCREENER_CRYPTO_LIMIT) || 250;
const TTL_MS = 60 * 60 * 1000; // crypto moves; refresh hourly

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

interface HistoryStats {
  return90d: number | null;
  oneYearReturn: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
}

/**
 * Fully-diluted valuation. `maxSupply` is 0 for tokens with no hard cap (ETH,
 * SOL — verified), so it falls back to `totalSupply`, and finally to circulating
 * supply, in which case FDV equals market cap and mcapToFdv is 1 (correct: a
 * fully-circulating token has no dilution ahead of it).
 */
export function computeFdv(row: RawQuoteRow, price: number | null): number | null {
  const max = num(row.maxSupply);
  const total = num(row.totalSupply);
  const circ = num(row.circulatingSupply);
  const supply = (max != null && max > 0 ? max : null) ?? (total != null && total > 0 ? total : null) ?? circ;
  if (price == null || supply == null || supply <= 0) return null;
  return price * supply;
}

export function toCandidate(row: RawQuoteRow, stats: HistoryStats | undefined): ScreenerCandidate {
  const symbol = row.symbol as string;
  const price = num(row.regularMarketPrice);
  const marketCap = num(row.marketCap);
  const fdv = computeFdv(row, price);
  const volume24h = num(row.volume24Hr) ?? num(row.regularMarketVolume);

  return {
    symbol,
    // Yahoo appends the quote currency to every pair's name, which is already the
    // second half of the symbol — see displayAssetName(). Normalized here so a
    // candidate carries the name the rest of the app will show, rather than each
    // surface that ever persists it (the watchlist did) storing the raw duplicate.
    name: displayAssetName(symbol, str(row.longName) ?? str(row.shortName) ?? symbol),
    assetClass: "crypto",
    price,
    changePercent: num(row.regularMarketChangePercent),
    metrics: {
      marketCap,
      fdv,
      // Cap at 1: circulating supply occasionally exceeds a stale maxSupply in
      // Yahoo's data, which would otherwise report >100% of supply circulating.
      mcapToFdv:
        marketCap != null && fdv != null && fdv > 0 ? Math.min(marketCap / fdv, 1) : null,
      volume24h,
      volumeToMcap:
        volume24h != null && marketCap != null && marketCap > 0 ? volume24h / marketCap : null,
      return90d: stats?.return90d ?? null,
      oneYearReturn: stats?.oneYearReturn ?? null,
      distanceFrom52WkHigh: distanceFrom52Wk(row),
      volatility: stats?.volatility ?? null,
      maxDrawdown: stats?.maxDrawdown ?? null,
    },
    attributes: {
      sector: cryptoSector(symbol),
    },
  };
}

/** From the screener row's own 52-week high, so it's available even without history. */
function distanceFrom52Wk(row: RawQuoteRow): number | null {
  const price = num(row.regularMarketPrice);
  const high = num(row.fiftyTwoWeekHigh);
  if (price == null || high == null || high <= 0) return null;
  return ((price - high) / high) * 100;
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  const rows = await pageRawScreener(
    {
      quoteType: "CRYPTOCURRENCY",
      // USD-quoted pairs only: Yahoo lists the same token against dozens of
      // fiat currencies, and BTC-EUR is the same asset as BTC-USD wearing a
      // different denominator.
      query: q.and(q.eq("currency", "USD")),
      sortField: "intradaymarketcap",
      sortDir: "desc",
    },
    UNIVERSE_LIMIT,
  );

  report(0, rows.length);

  const stats = new Map<string, HistoryStats>();
  let done = 0;
  await mapPool(rows, 4, async (row) => {
    const symbol = row.symbol as string;
    const h = await withRetry(() => getHistory(symbol, 400));
    if (h && h.length > 20) {
      stats.set(symbol, {
        return90d: trailingReturn(h, 90),
        oneYearReturn: trailingReturn(h, 365),
        // 365, not 252: crypto trades every day of the year, and annualising a
        // daily stddev on an exchange calendar would understate its volatility.
        volatility: annualizedVolatility(h, 365),
        maxDrawdown: drawdown(h),
      });
    }
    report(++done, rows.length);
  });

  return rows.map((r) => toCandidate(r, stats.get(r.symbol as string)));
}

export const cryptoUniverse: UniverseProvider = createUniverseCache({
  assetClass: "crypto",
  ttlMs: TTL_MS,
  build,
});
