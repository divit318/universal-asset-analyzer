import YahooFinance from "yahoo-finance2";
import type { HistoryPoint, Quote } from "./types";

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
  };
}

interface RawChartQuote {
  date?: Date | string | null;
  close?: number | null;
}

/** Map raw chart rows into clean history points, dropping gaps. Pure. */
export function mapHistory(rows: RawChartQuote[]): HistoryPoint[] {
  return rows
    .filter((r): r is { date: Date | string; close: number } =>
      r.close != null && r.date != null,
    )
    .map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      close: r.close,
    }));
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
