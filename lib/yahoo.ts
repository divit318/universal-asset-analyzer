import YahooFinance from "yahoo-finance2";
import type { HistoryPoint, Quote, SymbolSuggestion } from "./types";

// v3 requires an instance; suppress the one-time survey notice in server logs.
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/** Subset of the Yahoo quote payload we read. */
interface RawQuote {
  symbol?: string;
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  marketCap?: number;
  trailingPE?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
  fullExchangeName?: string;
  quoteType?: string;
}

/** Map a raw Yahoo quote into our domain Quote. Pure / testable. */
export function mapQuote(raw: RawQuote): Quote {
  const price = raw.regularMarketPrice ?? 0;
  const previousClose = raw.regularMarketPreviousClose ?? price;
  const change = raw.regularMarketChange ?? price - previousClose;
  const changePercent =
    raw.regularMarketChangePercent ??
    (previousClose ? (change / previousClose) * 100 : 0);

  return {
    symbol: raw.symbol ?? "",
    name: raw.longName ?? raw.shortName ?? raw.symbol ?? "",
    price,
    previousClose,
    change,
    changePercent,
    currency: raw.currency ?? "USD",
    marketCap: raw.marketCap ?? null,
    peRatio: raw.trailingPE ?? null,
    dayHigh: raw.regularMarketDayHigh ?? null,
    dayLow: raw.regularMarketDayLow ?? null,
    fiftyTwoWeekHigh: raw.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: raw.fiftyTwoWeekLow ?? null,
    volume: raw.regularMarketVolume ?? null,
    exchange: raw.fullExchangeName ?? null,
    assetType: raw.quoteType ?? null,
  };
}

interface RawChartQuote {
  date?: Date | string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  adjclose?: number | null;
  volume?: number | null;
}

/** Map raw chart rows into clean history points, dropping gaps. Pure. */
export function mapHistory(rows: RawChartQuote[]): HistoryPoint[] {
  return mapHistoryRows(rows, (d) => d.toISOString().slice(0, 10));
}

/**
 * Same mapping as `mapHistory`, but keeps the full ISO timestamp instead of
 * truncating to a bare `YYYY-MM-DD`. Daily bars only need calendar-day
 * granularity, but intraday bars (5m/15m/30m/60m) need their time-of-day
 * preserved — truncating it collapses every bar in a trading day onto the
 * same date-only string, which is why the chart's x-axis and crosshair panel
 * used to show an identical time for every intraday candle.
 */
export function mapIntradayHistory(rows: RawChartQuote[]): HistoryPoint[] {
  return mapHistoryRows(rows, (d) => d.toISOString());
}

function mapHistoryRows(rows: RawChartQuote[], formatDate: (d: Date) => string): HistoryPoint[] {
  return rows
    .filter((r): r is { date: Date | string; close: number; open?: number | null; high?: number | null; low?: number | null; adjclose?: number | null; volume?: number | null } =>
      r.close != null && r.date != null,
    )
    .map((r) => ({
      date: formatDate(new Date(r.date)),
      close: r.close,
      adjClose: r.adjclose ?? r.close,
      ...(r.open != null ? { open: r.open } : {}),
      ...(r.high != null ? { high: r.high } : {}),
      ...(r.low != null ? { low: r.low } : {}),
      ...(r.volume != null ? { volume: r.volume } : {}),
    }));
}

/** Maps sector names (Yahoo Finance format) to their SPDR sector ETF tickers. */
export const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK",
  Financials: "XLF",
  "Financial Services": "XLF",
  "Health Care": "XLV",
  Healthcare: "XLV",
  "Consumer Discretionary": "XLY",
  "Consumer Cyclical": "XLY",
  "Consumer Staples": "XLP",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  Materials: "XLB",
  "Basic Materials": "XLB",
  Industrials: "XLI",
  "Communication Services": "XLC",
};

export function getSectorEtf(sector: string | null | undefined): string | null {
  if (!sector) return null;
  return SECTOR_ETF[sector] ?? null;
}

/** Raw quoteSummary passthrough for the fundamentals layer. */
export async function getQuoteSummary(
  symbol: string,
  modules: string[],
): Promise<unknown> {
  // validateResult:false — yahoo-finance2 v3 otherwise *throws* when Yahoo adds
  // or changes a field vs its schema, discarding otherwise-good data. With many
  // modules per call that happens constantly, so we opt out of strict validation.
  return yahooFinance.quoteSummary(
    symbol,
    { modules } as unknown as Parameters<typeof yahooFinance.quoteSummary>[1],
    { validateResult: false } as unknown as Parameters<typeof yahooFinance.quoteSummary>[2],
  );
}

/** Annual financial-statement time series (revenue, EPS, FCF, shares, …). */
export async function getFundamentalsTimeSeries(
  symbol: string,
  fromYear = new Date().getFullYear() - 6,
): Promise<Record<string, unknown>[]> {
  const result = await yahooFinance.fundamentalsTimeSeries(
    symbol,
    {
      period1: `${fromYear}-01-01`,
      type: "annual",
      module: "all",
    } as unknown as Parameters<typeof yahooFinance.fundamentalsTimeSeries>[1],
    { validateResult: false } as unknown as Parameters<typeof yahooFinance.fundamentalsTimeSeries>[2],
  );
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

/** A live price snapshot with the fields the screener's price layer needs. */
export interface RichQuote {
  symbol: string;
  name: string;
  price: number | null;
  marketCap: number | null;
  oneYearReturn: number | null; // %
  distanceFrom52WkHigh: number | null; // % (negative = below the high)
  exchange: string | null;
}

interface RawRichQuote extends RawQuote {
  fiftyTwoWeekChangePercent?: number;
  fiftyTwoWeekHigh?: number;
}

export function mapRichQuote(raw: RawRichQuote): RichQuote {
  const price = raw.regularMarketPrice ?? null;
  const high = raw.fiftyTwoWeekHigh ?? null;
  return {
    symbol: raw.symbol ?? "",
    name: raw.longName ?? raw.shortName ?? raw.symbol ?? "",
    price,
    marketCap: raw.marketCap ?? null,
    oneYearReturn: raw.fiftyTwoWeekChangePercent ?? null,
    distanceFrom52WkHigh:
      price != null && high ? ((price - high) / high) * 100 : null,
    exchange: raw.fullExchangeName ?? null,
  };
}

/**
 * Batch live quotes (rich fields) for the screener price layer. Yahoo caps a
 * single `quote()` call at ~250 symbols, so callers should chunk accordingly.
 */
export async function getRichQuotes(symbols: string[]): Promise<RichQuote[]> {
  if (symbols.length === 0) return [];
  const raw = await yahooFinance.quote(symbols);
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((r) => mapRichQuote(r as unknown as RawRichQuote))
    .filter((q) => q.symbol);
}

export async function getQuote(symbol: string): Promise<Quote> {
  try {
    const raw = await yahooFinance.quote(symbol);
    if (!raw || (raw as RawQuote).regularMarketPrice == null) {
      throw new Error(`No quote data found for "${symbol}"`);
    }
    return mapQuote(raw as unknown as RawQuote);
  } catch (err) {
    if (err instanceof Error && err.message.includes("No quote data")) throw err;
    throw new Error(`Failed to fetch quote for "${symbol}"`);
  }
}

/**
 * In-memory TTL cache for daily price history. Daily bars only change once per
 * day after the close (the live day's last bar is negligible against a
 * multi-month/year series), yet benchmark series like SPY and the sector ETFs
 * are re-requested on nearly every research/portfolio/compare call. Caching for
 * a few minutes turns those repeated multi-year Yahoo fetches into map lookups.
 * Live quotes are deliberately NOT cached (see getQuote/getQuotes).
 */
const HISTORY_TTL_MS = 15 * 60 * 1000;
const HISTORY_CACHE_MAX = 300;
const historyCache = new Map<string, { at: number; data: HistoryPoint[] }>();

export async function getHistory(
  symbol: string,
  rangeDays = 180,
): Promise<HistoryPoint[]> {
  const key = `${symbol.toUpperCase()}:${rangeDays}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.data;

  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - rangeDays);
    const result = (await yahooFinance.chart(symbol, {
      period1,
      interval: "1d",
    })) as { quotes?: RawChartQuote[] };
    const data = mapHistory(result?.quotes ?? []);
    // Only cache non-empty series so a transient failure isn't pinned for 15m.
    if (data.length > 0) {
      if (historyCache.size >= HISTORY_CACHE_MAX) {
        const oldest = historyCache.keys().next().value;
        if (oldest !== undefined) historyCache.delete(oldest);
      }
      historyCache.set(key, { at: Date.now(), data });
    }
    return data;
  } catch {
    // History is best-effort; an empty series still lets the page render.
    return [];
  }
}

/** Intraday intervals this app actually offers (see the chart workspace's Candle Interval control). */
export type IntradayInterval = "5m" | "15m" | "30m" | "60m";

/**
 * In-memory TTL cache for intraday bars — separate from `historyCache` since
 * intraday data goes stale far faster than daily bars (a few minutes, not a
 * full trading day).
 */
const INTRADAY_TTL_MS = 2 * 60 * 1000;
const INTRADAY_CACHE_MAX = 100;
const intradayCache = new Map<string, { at: number; data: HistoryPoint[] }>();

/**
 * Yahoo's real retention window per intraday interval. Confirmed empirically
 * (not documented anywhere): requesting a `period1` beyond this window doesn't
 * truncate to what's available — it silently returns a fully EMPTY series. So
 * unlike `getHistory`, this can't "return whatever it actually has"; the
 * request has to be clamped to a known-good window before it's sent.
 * 5m/15m/30m cut off at exactly 60 days (61 already returns 0 bars); 60m
 * showed no failure up to 730 days in testing, so 730 is used as a verified-
 * safe cap rather than a guessed limit.
 */
const INTRADAY_MAX_DAYS: Record<IntradayInterval, number> = {
  "5m": 60,
  "15m": 60,
  "30m": 60,
  "60m": 730,
};

export function intradayRetentionDays(interval: IntradayInterval): number {
  return INTRADAY_MAX_DAYS[interval];
}

/**
 * Real intraday history from Yahoo (5m/15m/30m/60m — confirmed supported by
 * yahoo-finance2's chart() interval enum). `rangeDays` is clamped to Yahoo's
 * actual retention window for the interval (see INTRADAY_MAX_DAYS) so a
 * request for more history than exists degrades to the max available window
 * instead of silently coming back empty.
 */
export async function getIntradayHistory(
  symbol: string,
  interval: IntradayInterval,
  rangeDays: number,
): Promise<HistoryPoint[]> {
  const clampedDays = Math.min(rangeDays, INTRADAY_MAX_DAYS[interval]);
  const key = `${symbol.toUpperCase()}:${interval}:${clampedDays}`;
  const hit = intradayCache.get(key);
  if (hit && Date.now() - hit.at < INTRADAY_TTL_MS) return hit.data;

  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - clampedDays);
    const result = (await yahooFinance.chart(symbol, {
      period1,
      interval,
    } as unknown as Parameters<typeof yahooFinance.chart>[1])) as { quotes?: RawChartQuote[] };
    const data = mapIntradayHistory(result?.quotes ?? []);
    if (data.length > 0) {
      if (intradayCache.size >= INTRADAY_CACHE_MAX) {
        const oldest = intradayCache.keys().next().value;
        if (oldest !== undefined) intradayCache.delete(oldest);
      }
      intradayCache.set(key, { at: Date.now(), data });
    }
    return data;
  } catch {
    // Best-effort, same as getHistory — an empty series still lets the chart render.
    return [];
  }
}

/** Raw subset of a Yahoo search "quote" result we surface for autocomplete. */
interface RawSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
  typeDisp?: string;
  isYahooFinance?: boolean;
}

/** Map a raw search hit into a clean suggestion. Pure / testable. */
export function mapSuggestion(raw: RawSearchQuote): SymbolSuggestion | null {
  if (!raw.symbol || !raw.isYahooFinance) return null;
  return {
    symbol: raw.symbol,
    name: raw.longname ?? raw.shortname ?? raw.symbol,
    exchange: raw.exchDisp ?? null,
    type: raw.typeDisp ?? raw.quoteType ?? null,
  };
}

// Rank tradeable asset types ahead of the long tail (options, futures, etc.).
const TYPE_RANK: Record<string, number> = {
  EQUITY: 0,
  ETF: 1,
  MUTUALFUND: 2,
  INDEX: 3,
  CRYPTOCURRENCY: 4,
  CURRENCY: 5,
};

/**
 * Autocomplete suggestions for a ticker OR company name (e.g. "Apple").
 * Returns the most relevant tradeable symbols first. Best-effort: an empty
 * list on failure keeps the typeahead non-blocking.
 */
export async function searchSymbols(
  query: string,
  limit = 8,
): Promise<SymbolSuggestion[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  try {
    const res = (await yahooFinance.search(q, {
      quotesCount: Math.max(limit * 3, 12),
      newsCount: 0,
      enableFuzzyQuery: true,
    } as unknown as Parameters<typeof yahooFinance.search>[1])) as {
      quotes?: RawSearchQuote[];
    };
    const seen = new Set<string>();
    const mapped = (res.quotes ?? [])
      .map(mapSuggestion)
      .filter((s): s is SymbolSuggestion => {
        if (!s || seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
      })
      .sort(
        (a, b) =>
          (TYPE_RANK[a.type?.toUpperCase() ?? ""] ?? 9) -
          (TYPE_RANK[b.type?.toUpperCase() ?? ""] ?? 9),
      );
    return mapped.slice(0, limit);
  } catch {
    return [];
  }
}

/** Raw subset of a Yahoo search "news" result. */
export interface RawNews {
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number | Date;
}

/**
 * Recent news headlines for a symbol via Yahoo search. Best-effort: returns []
 * on failure so the copilot's context assembly never blocks on news.
 */
export async function getNews(symbol: string, count = 8): Promise<RawNews[]> {
  try {
    const res = (await yahooFinance.search(symbol, {
      quotesCount: 0,
      newsCount: count,
    } as unknown as Parameters<typeof yahooFinance.search>[1])) as { news?: RawNews[] };
    return res.news ?? [];
  } catch {
    return [];
  }
}

/** Batch-fetch quotes for the screener. Missing symbols are simply omitted. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  try {
    const raw = await yahooFinance.quote(symbols);
    const list = Array.isArray(raw) ? raw : [raw];
    return list
      .map((r) => mapQuote(r as unknown as RawQuote))
      .filter((q) => q.symbol && q.price > 0);
  } catch {
    throw new Error("Failed to fetch quotes from Yahoo Finance");
  }
}
