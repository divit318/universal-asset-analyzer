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
  close?: number | null;
  adjclose?: number | null;
  volume?: number | null;
}

/** Map raw chart rows into clean history points, dropping gaps. Pure. */
export function mapHistory(rows: RawChartQuote[]): HistoryPoint[] {
  return rows
    .filter((r): r is { date: Date | string; close: number; adjclose?: number | null; volume?: number | null } =>
      r.close != null && r.date != null,
    )
    .map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      close: r.close,
      adjClose: r.adjclose ?? r.close, // fallback to close if adjclose absent
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

export async function getHistory(
  symbol: string,
  rangeDays = 180,
): Promise<HistoryPoint[]> {
  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - rangeDays);
    const result = (await yahooFinance.chart(symbol, {
      period1,
      interval: "1d",
    })) as { quotes?: RawChartQuote[] };
    return mapHistory(result?.quotes ?? []);
  } catch {
    // History is best-effort; an empty series still lets the page render.
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
