/**
 * Yahoo Finance provider.
 *
 * Every exported fetch in this file routes through the Platform Data Layer
 * (`getDataset`), which means it is cached under its dataset's own policy and
 * deduplicated against concurrent identical requests. This is deliberately done
 * at the *provider boundary* rather than at each of the ~48 call sites: it makes
 * bypassing the platform impossible by construction, and it means Research,
 * Screener, Portfolio, Compare, Scanner, and the AI context builder all observe
 * the same normalized value for a given asset without any of them knowing the
 * platform exists.
 *
 * The mappers below (mapQuote, mapHistory, …) stay pure and separately exported —
 * they are the normalization step, and they are unit-tested on their own.
 */

import YahooFinance from "yahoo-finance2";
import type { FundProfileData, FundSectorWeight, HistoryPoint, OptionContract, OptionsChainData, OptionsExpirationChain, Quote, SymbolSuggestion } from "./types";
import { computeMacroSummary, YIELD_CURVE_SYMBOLS, type MacroSummary, type YieldLevels } from "./macro-analysis";
import { getDataset } from "./platform/data-layer";
import { countryForSuggestion } from "./market";
import type { CacheMeta } from "./platform/types";

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

/**
 * Raw quoteSummary passthrough for the fundamentals layer.
 *
 * Keyed on the *sorted module list*, so `["price","assetProfile"]` and
 * `["assetProfile","price"]` are one cache entry rather than two — the research
 * route and the fundamentals route ask for overlapping module sets constantly.
 */
async function getQuoteSummaryResult(
  symbol: string,
  modules: string[],
): Promise<{ data: unknown; meta: CacheMeta }> {
  return getDataset<unknown>(
    "quoteSummary",
    { symbol: symbol.toUpperCase(), modules: [...modules].sort().join(",") },
    async () =>
      // validateResult:false — yahoo-finance2 v3 otherwise *throws* when Yahoo adds
      // or changes a field vs its schema, discarding otherwise-good data. With many
      // modules per call that happens constantly, so we opt out of strict validation.
      yahooFinance.quoteSummary(
        symbol,
        { modules } as unknown as Parameters<typeof yahooFinance.quoteSummary>[1],
        { validateResult: false } as unknown as Parameters<typeof yahooFinance.quoteSummary>[2],
      ),
  );
}

export async function getQuoteSummary(
  symbol: string,
  modules: string[],
): Promise<unknown> {
  const result = await getQuoteSummaryResult(symbol, modules);
  return result.data;
}

/**
 * Cache metadata for the same quoteSummary call `getFundamentals` makes —
 * same params, so this is a cache hit (no extra provider round-trip) that
 * hands back *when* that data was actually fetched, for freshness badges.
 */
export async function getQuoteSummaryMeta(symbol: string, modules: string[]): Promise<CacheMeta> {
  const result = await getQuoteSummaryResult(symbol, modules);
  return result.meta;
}

/** Annual financial-statement time series (revenue, EPS, FCF, shares, …). */
export async function getFundamentalsTimeSeries(
  symbol: string,
  fromYear = new Date().getFullYear() - 6,
): Promise<Record<string, unknown>[]> {
  const result = await getDataset<Record<string, unknown>[]>(
    "fundamentalsTimeSeries",
    { symbol: symbol.toUpperCase(), fromYear },
    async () => {
      const raw = await yahooFinance.fundamentalsTimeSeries(
        symbol,
        {
          period1: `${fromYear}-01-01`,
          type: "annual",
          module: "all",
        } as unknown as Parameters<typeof yahooFinance.fundamentalsTimeSeries>[1],
        { validateResult: false } as unknown as Parameters<typeof yahooFinance.fundamentalsTimeSeries>[2],
      );
      return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    },
  );
  return result.data;
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
 *
 * validateResult:false for the same reason getQuoteSummary opts out below: a
 * batch of up to 200 symbols only needs ONE of them to have a field Yahoo's
 * schema doesn't expect (a new listing, an odd share class, an options/ECN
 * quote shape) for yahoo-finance2 v3 to throw on the *whole array* — silently
 * discarding marketCap (and therefore fcfYield, which is derived from it) for
 * every other symbol in the chunk. This was the primary cause of "many stocks
 * missing market cap": the failure was total-batch, not per-symbol, and threw
 * before any per-symbol data could be salvaged.
 */
export async function getRichQuotes(symbols: string[]): Promise<RichQuote[]> {
  if (symbols.length === 0) return [];
  const result = await getDataset<RichQuote[]>(
    "quotes.batch",
    { rich: true, symbols: [...symbols].map((s) => s.toUpperCase()).sort().join(",") },
    async () => {
      const raw = await yahooFinance.quote(
        symbols,
        {} as unknown as Parameters<typeof yahooFinance.quote>[1],
        { validateResult: false } as unknown as Parameters<typeof yahooFinance.quote>[2],
      );
      const list = Array.isArray(raw) ? raw : [raw];
      return list
        .map((r) => mapRichQuote(r as unknown as RawRichQuote))
        .filter((q) => q.symbol);
    },
  );
  return result.data;
}

async function getQuoteResult(symbol: string): Promise<{ data: Quote; meta: CacheMeta }> {
  return getDataset<Quote>(
    "quote",
    { symbol: symbol.toUpperCase() },
    async () => {
      try {
        const raw = await yahooFinance.quote(
          symbol,
          {} as unknown as Parameters<typeof yahooFinance.quote>[1],
          { validateResult: false } as unknown as Parameters<typeof yahooFinance.quote>[2],
        );
        if (!raw || (raw as RawQuote).regularMarketPrice == null) {
          throw new Error(`No quote data found for "${symbol}"`);
        }
        return mapQuote(raw as unknown as RawQuote);
      } catch (err) {
        if (err instanceof Error && err.message.includes("No quote data")) throw err;
        throw new Error(`Failed to fetch quote for "${symbol}"`);
      }
    },
  );
}

export async function getQuote(symbol: string): Promise<Quote> {
  const result = await getQuoteResult(symbol);
  return result.data;
}

/** Cache metadata for the same quote call `getQuote` makes — see getQuoteSummaryMeta. */
export async function getQuoteMeta(symbol: string): Promise<CacheMeta> {
  const result = await getQuoteResult(symbol);
  return result.meta;
}

/**
 * Daily price history.
 *
 * The 15-minute in-memory cache that used to live here (the codebase's only
 * cache of any kind on this path) is now the platform's `history` dataset
 * policy — same intent, but with disk persistence, stale-while-revalidate, and,
 * crucially, deduplication. The old cache stampeded: SPY's five-year series is
 * requested by nearly every research/portfolio/compare call, and concurrent
 * callers all missed the cache together and all hit Yahoo together.
 *
 * Still best-effort — an empty series lets the page render — and an empty result
 * is never cached, so a transient outage isn't pinned for the dataset's TTL.
 */
export async function getHistory(
  symbol: string,
  rangeDays = 180,
): Promise<HistoryPoint[]> {
  try {
    const result = await getDataset<HistoryPoint[]>(
      "history",
      { symbol: symbol.toUpperCase(), days: rangeDays },
      async () => {
        const period1 = new Date();
        period1.setDate(period1.getDate() - rangeDays);
        const chart = (await yahooFinance.chart(symbol, {
          period1,
          interval: "1d",
        })) as { quotes?: RawChartQuote[] };
        const data = mapHistory(chart?.quotes ?? []);
        // Throw rather than return [] so the platform never caches an empty
        // series; getHistory's own catch below still degrades it to [].
        if (data.length === 0) throw new Error(`No history for "${symbol}"`);
        return data;
      },
    );
    return result.data;
  } catch {
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
    country: countryForSuggestion(raw.symbol, raw.quoteType),
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
    const result = await getDataset<SymbolSuggestion[]>(
      "search",
      { q: q.toLowerCase(), limit },
      async () => {
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
      },
    );
    return result.data;
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
    const result = await getDataset<RawNews[]>(
      "news",
      { symbol: symbol.toUpperCase(), count },
      async () => {
        const res = (await yahooFinance.search(symbol, {
          quotesCount: 0,
          newsCount: count,
        } as unknown as Parameters<typeof yahooFinance.search>[1])) as { news?: RawNews[] };
        return res.news ?? [];
      },
    );
    return result.data;
  } catch {
    return [];
  }
}

/** Raw shapes read from the `fundProfile`/`topHoldings`/`fundPerformance` quoteSummary modules. */
interface RawFundProfile {
  family?: string | null;
  categoryName?: string | null;
  legalType?: string | null;
  feesExpensesInvestment?: {
    annualReportExpenseRatio?: number;
    annualHoldingsTurnover?: number;
    totalNetAssets?: number;
  };
}
interface RawTopHoldings {
  holdings?: { symbol: string; holdingName: string; holdingPercent: number }[];
  sectorWeightings?: Record<string, number>[];
  stockPosition?: number;
  bondPosition?: number;
  cashPosition?: number;
  otherPosition?: number;
}
interface RawFundPerformance {
  trailingReturns?: { ytd?: number; oneYear?: number; threeYear?: number; fiveYear?: number };
  trailingReturnsCat?: { ytd?: number; oneYear?: number; threeYear?: number; fiveYear?: number };
  riskOverviewStatistics?: { riskStatistics?: { year: string; beta: number; alpha: number; stdDev?: number; sharpeRatio: number }[] };
  fundCategoryName?: string | null;
}

const SECTOR_LABEL: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

/**
 * Fund-shaped data (ETFs, mutual funds, closed-end funds) via the same Yahoo
 * quoteSummary endpoint the equity path already uses — no new external
 * provider needed. Any module missing from Yahoo's response (common for
 * thinly-covered closed-end funds) degrades to nulls/[] rather than failing
 * the whole call, matching getQuoteSummary's non-fatal-by-module convention.
 */
export async function getFundProfile(symbol: string): Promise<FundProfileData> {
  const result = await getDataset<FundProfileData>(
    "fundProfile",
    { symbol: symbol.toUpperCase() },
    () => buildFundProfile(symbol),
  );
  return result.data;
}

async function buildFundProfile(symbol: string): Promise<FundProfileData> {
  // Reads through getQuoteSummary, so the underlying Yahoo call is itself
  // cached/deduped one layer down — the mapping work is what this dataset caches.
  const raw = (await getQuoteSummary(symbol, [
    "fundProfile",
    "topHoldings",
    "fundPerformance",
  ])) as { fundProfile?: RawFundProfile; topHoldings?: RawTopHoldings; fundPerformance?: RawFundPerformance };

  const profile = raw.fundProfile ?? {};
  const holdings = raw.topHoldings ?? {};
  const perf = raw.fundPerformance ?? {};

  const sectorWeights: FundSectorWeight[] = (holdings.sectorWeightings ?? [])
    .flatMap((row) => Object.entries(row))
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([key, v]) => ({ sector: SECTOR_LABEL[key] ?? key, weightPercent: (v as number) * 100 }))
    .sort((a, b) => b.weightPercent - a.weightPercent);

  const latestRisk = perf.riskOverviewStatistics?.riskStatistics?.at(-1) ?? null;

  return {
    family: profile.family ?? null,
    category: profile.categoryName ?? null,
    legalType: profile.legalType ?? null,
    expenseRatio: profile.feesExpensesInvestment?.annualReportExpenseRatio ?? null,
    turnoverPercent: profile.feesExpensesInvestment?.annualHoldingsTurnover ?? null,
    // Yahoo reports this in millions (e.g. 486986.6 = $487B for SPY) —
    // converted to raw dollars so every consumer's "$X" formatting is correct.
    totalNetAssets:
      profile.feesExpensesInvestment?.totalNetAssets != null
        ? profile.feesExpensesInvestment.totalNetAssets * 1e6
        : null,
    holdings: (holdings.holdings ?? []).map((h) => ({
      symbol: h.symbol,
      name: h.holdingName,
      weightPercent: h.holdingPercent * 100,
    })),
    sectorWeights,
    assetAllocation: {
      stock: holdings.stockPosition != null ? holdings.stockPosition * 100 : null,
      bond: holdings.bondPosition != null ? holdings.bondPosition * 100 : null,
      cash: holdings.cashPosition != null ? holdings.cashPosition * 100 : null,
      other: holdings.otherPosition != null ? holdings.otherPosition * 100 : null,
    },
    // Yahoo returns these as fractions (0.222 = 22.2%) — converted to
    // percentage-points here so every consumer (fund-scoring.ts's ranges,
    // the UI's pct1/pp1 formatters) works in the same units as holdings/
    // sectorWeights/assetAllocation above, which are already percentage-points.
    trailingReturns: {
      ytd: perf.trailingReturns?.ytd != null ? perf.trailingReturns.ytd * 100 : null,
      oneYear: perf.trailingReturns?.oneYear != null ? perf.trailingReturns.oneYear * 100 : null,
      threeYear: perf.trailingReturns?.threeYear != null ? perf.trailingReturns.threeYear * 100 : null,
      fiveYear: perf.trailingReturns?.fiveYear != null ? perf.trailingReturns.fiveYear * 100 : null,
    },
    categoryRelativeReturns: {
      oneYear:
        perf.trailingReturns?.oneYear != null && perf.trailingReturnsCat?.oneYear != null
          ? (perf.trailingReturns.oneYear - perf.trailingReturnsCat.oneYear) * 100
          : null,
      threeYear:
        perf.trailingReturns?.threeYear != null && perf.trailingReturnsCat?.threeYear != null
          ? (perf.trailingReturns.threeYear - perf.trailingReturnsCat.threeYear) * 100
          : null,
    },
    risk: latestRisk
      ? { beta: latestRisk.beta ?? null, alpha: latestRisk.alpha ?? null, stdDev: latestRisk.stdDev ?? null, sharpeRatio: latestRisk.sharpeRatio ?? null }
      : null,
  };
}

interface RawOptionContract {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}
interface RawOptionExpiration {
  expirationDate: Date;
  calls: RawOptionContract[];
  puts: RawOptionContract[];
}
interface RawOptionsResult {
  underlyingSymbol: string;
  expirationDates: Date[];
  quote: { regularMarketPrice?: number };
  options: RawOptionExpiration[];
}

function mapContract(c: RawOptionContract): OptionContract {
  return {
    contractSymbol: c.contractSymbol,
    strike: c.strike,
    lastPrice: c.lastPrice,
    bid: c.bid ?? null,
    ask: c.ask ?? null,
    volume: c.volume ?? null,
    openInterest: c.openInterest ?? null,
    impliedVolatility: c.impliedVolatility ?? null,
    inTheMoney: c.inTheMoney,
  };
}

function mapExpiration(o: RawOptionExpiration): OptionsExpirationChain {
  return {
    expirationDate: o.expirationDate.toISOString().slice(0, 10),
    calls: o.calls.map(mapContract),
    puts: o.puts.map(mapContract),
  };
}

/**
 * Options chain for an underlying — near-term expiration plus (if more are
 * listed) one further out, roughly a month past the near-term, for a rough
 * volatility term-structure read. Yahoo gives one expiration per call unless
 * a specific `date` is passed, so this is two (or three) requests, not one.
 */
export async function getOptionsChain(symbol: string): Promise<OptionsChainData | null> {
  const result = await getDataset<OptionsChainData | null>(
    "options",
    { symbol: symbol.toUpperCase() },
    () => buildOptionsChain(symbol),
  );
  return result.data;
}

async function buildOptionsChain(symbol: string): Promise<OptionsChainData | null> {
  try {
    const initial = (await yahooFinance.options(symbol)) as unknown as RawOptionsResult;
    if (!initial.expirationDates?.length) return null;

    const expirationDates = initial.expirationDates.map((d) => d.toISOString().slice(0, 10));

    // Same-day (0-DTE) expirations have near-zero time value left and
    // produce noisy/degenerate implied-volatility reads (observed: a same-
    // day expiration showing "3.8% IV" next to a month-out expiration's
    // genuine ~28%) — not a real term-structure signal, just 0-DTE noise.
    // Skip to the first expiration at least a day out for a meaningful read.
    const now = Date.now();
    const nearIdx = initial.expirationDates.findIndex((d) => d.getTime() - now > 24 * 60 * 60 * 1000);
    const effectiveNearIdx = nearIdx === -1 ? 0 : nearIdx;

    const nearChain =
      effectiveNearIdx === 0
        ? initial.options[0]
        : (
            (await yahooFinance.options(symbol, { date: initial.expirationDates[effectiveNearIdx] })) as unknown as RawOptionsResult
          ).options[0];
    if (!nearChain) return null;

    const chains: OptionsExpirationChain[] = [mapExpiration(nearChain)];

    // Pick a farther expiration ~25+ days past the (effective) near one, if listed.
    const farIndex = initial.expirationDates.findIndex(
      (d, i) => i > effectiveNearIdx && d.getTime() - initial.expirationDates[effectiveNearIdx].getTime() > 25 * 24 * 60 * 60 * 1000,
    );
    if (farIndex > 0) {
      try {
        const far = (await yahooFinance.options(symbol, { date: initial.expirationDates[farIndex] })) as unknown as RawOptionsResult;
        if (far.options?.length) chains.push(mapExpiration(far.options[0]));
      } catch {
        /* far expiration is best-effort — near-term chain still stands alone */
      }
    }

    return {
      underlyingSymbol: initial.underlyingSymbol,
      underlyingPrice: initial.quote.regularMarketPrice ?? 0,
      expirationDates,
      chains,
    };
  } catch {
    // No listed options (illiquid name, non-US listing, etc.) — not an error, just unavailable.
    return null;
  }
}

/** Batch-fetch quotes for the screener. Missing symbols are simply omitted. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const result = await getDataset<Quote[]>(
    "quotes.batch",
    { symbols: [...symbols].map((s) => s.toUpperCase()).sort().join(",") },
    async () => {
      try {
        const raw = await yahooFinance.quote(
          symbols,
          {} as unknown as Parameters<typeof yahooFinance.quote>[1],
          { validateResult: false } as unknown as Parameters<typeof yahooFinance.quote>[2],
        );
        const list = Array.isArray(raw) ? raw : [raw];
        return list
          .map((r) => mapQuote(r as unknown as RawQuote))
          .filter((q) => q.symbol && q.price > 0);
      } catch {
        throw new Error("Failed to fetch quotes from Yahoo Finance");
      }
    },
  );
  return result.data;
}

/** Spread (10yr - 3mo) as of ~N trading days ago, from history. Best-effort: null if either series is too short. */
async function spreadNDaysAgo(daysBack = 20): Promise<number | null> {
  const [tenYearHist, threeMonthHist] = await Promise.all([
    getHistory(YIELD_CURVE_SYMBOLS.tenYear, 90),
    getHistory(YIELD_CURVE_SYMBOLS.threeMonth, 90),
  ]);
  const tenYear = tenYearHist.at(-Math.min(daysBack, tenYearHist.length));
  const threeMonth = threeMonthHist.at(-Math.min(daysBack, threeMonthHist.length));
  if (!tenYear || !threeMonth) return null;
  return tenYear.close - threeMonth.close;
}

/**
 * The full 4-tenor Treasury yield curve + shape/trend — shared by
 * /api/macro, the chat route's macro branch, and the verdict route's macro
 * branch, so the fetch logic lives here once rather than being copy-pasted
 * into three route files (unlike fund/crypto/commodity/forex, whose per-
 * route fetches are simple enough that a shared function wasn't worth it).
 */
export async function getMacroSummary(): Promise<MacroSummary> {
  const result = await getDataset<MacroSummary>("macro", {}, async () => {
    // The yield-curve quotes and the prior-spread history are independent —
    // fetched together rather than one after the other.
    const [quotes, priorSpread] = await Promise.all([
      getQuotes([
        YIELD_CURVE_SYMBOLS.threeMonth,
        YIELD_CURVE_SYMBOLS.fiveYear,
        YIELD_CURVE_SYMBOLS.tenYear,
        YIELD_CURVE_SYMBOLS.thirtyYear,
      ]),
      spreadNDaysAgo().catch(() => null),
    ]);
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q.price]));
    const levels: YieldLevels = {
      threeMonth: bySymbol.get(YIELD_CURVE_SYMBOLS.threeMonth) ?? null,
      fiveYear: bySymbol.get(YIELD_CURVE_SYMBOLS.fiveYear) ?? null,
      tenYear: bySymbol.get(YIELD_CURVE_SYMBOLS.tenYear) ?? null,
      thirtyYear: bySymbol.get(YIELD_CURVE_SYMBOLS.thirtyYear) ?? null,
    };
    return computeMacroSummary(levels, priorSpread);
  });
  return result.data;
}
