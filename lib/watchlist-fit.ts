/**
 * Watchlist fit enrichment — produces the *full* research inputs the IOS fit
 * scorer needs for every watchlist symbol, so scores are accurate and
 * differentiated instead of collapsing to a data-poor neutral.
 *
 * For each symbol we assemble the same StockMetrics the screener builds
 * (cached fundamentals + live price layer), run composite scoring, and attach
 * sector / dividend yield / beta / geography. Newly-added tickers that were
 * never screened (e.g. foreign ADRs like SHG, EQNR, PBR) are fetched on demand
 * and cached, so a stock is fully researched the moment it enters the list.
 */

import { computeScores, momentumScore, type ScorableMetrics } from "./composite";
import { getFreshFundamentals, putFundamentals } from "./db";
import { enrichSymbol } from "./enrich";
import { detectMarket } from "./market";
import { getQuotes, getRichQuotes } from "./yahoo";
import { getScreenerInCompany, getRatio, type ScreenerInCompany } from "./screener-in";
import { computeIndiaSnapshot } from "./india-snapshot";
import type { CompositeScores, StockFundamentals } from "./types";

/** Everything the client needs to pass into `getPortfolioFit`. */
export interface FitEnrichment {
  symbol: string;
  sector: string | null;
  marketCap: number | null;
  compositeScores: CompositeScores;
  dividendYield: number | null; // %
  beta: number | null;
  geography: "US" | "IN" | "JP" | "HK" | "AU" | "EU" | "CRYPTO" | null;
  /**
   * Analyst consensus target, dispersion and coverage — the street's view, as
   * opposed to the user's own `watchlist.target_price`.
   *
   * Ships on this payload because the fundamentals fetch behind it already
   * receives these fields from Yahoo's `financialData` module (see
   * `lib/enrich.ts`), so the watchlist gets consensus for all 57 names without a
   * single extra request. The values are cached with the rest of the
   * fundamentals row, hence the 7-day TTL below applies to them too.
   */
  analystTargetMean: number | null;
  analystTargetHigh: number | null;
  analystTargetLow: number | null;
  analystOpinions: number | null;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // fundamentals change slowly
const CONCURRENCY = 6;

async function mapPool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/**
 * Enrich a set of watchlist symbols with full fit inputs. Uses the shared
 * fundamentals cache; only genuinely-missing symbols hit the network, and
 * whatever is fetched is persisted so subsequent loads are instant.
 */
export async function enrichForFit(
  items: Array<{ symbol: string; name: string }>,
): Promise<FitEnrichment[]> {
  if (items.length === 0) return [];

  const symbols = items.map((i) => i.symbol.toUpperCase());

  // 1. Hydrate from cache.
  const { rows } = getFreshFundamentals(CACHE_TTL_MS);
  const fundamentals = new Map<string, StockFundamentals>(
    rows.filter((r) => symbols.includes(r.symbol)).map((r) => [r.symbol, r]),
  );

  /* 2. Fetch fundamentals for anything not cached — or cached by a build that
        predates the analyst-consensus fields, which is a schema gap rather than
        a TTL one and would otherwise leave consensus blank for a full week.
        `analystOpinions` is the sentinel: the mapper always writes the key (as
        null when there is no coverage), so an ABSENT key means "this row was
        written before the field existed", which is exactly the distinction a
        `?? null` read would erase. */
  const missing = items.filter((i) => {
    const cached = fundamentals.get(i.symbol.toUpperCase());
    return !cached || !("analystOpinions" in cached);
  });
  const fetched: StockFundamentals[] = [];
  await mapPool(missing, async (item) => {
    try {
      const data = await enrichSymbol(item.symbol.toUpperCase(), item.name);
      fundamentals.set(data.symbol, data);
      fetched.push(data);
    } catch {
      /* leave uncached; handled as a graceful gap below */
    }
  });
  if (fetched.length) {
    try { putFundamentals(fetched); } catch { /* cache write is best-effort */ }
  }

  // 3. Live price + identity layer (batched). Rich quotes carry momentum
  //    inputs; plain quotes carry currency/exchange for geography detection.
  const [rich, quotes] = await Promise.all([
    getRichQuotes(symbols).catch(() => []),
    getQuotes(symbols).catch(() => []),
  ]);
  const richBy = new Map(rich.map((q) => [q.symbol.toUpperCase(), q]));
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  // 3b. Indian (NSE/BSE) names are scored from screener.in via the same
  // computeIndiaSnapshot() Research Hub uses, never the Yahoo composite —
  // Yahoo's NSE/BSE fundamentals coverage is frequently incomplete or stale
  // (see lib/india-snapshot.ts), which is exactly why the same stock could
  // otherwise show two disagreeing scores depending on which page you're on.
  const indiaCompanyBy = new Map<string, ScreenerInCompany>();
  await mapPool(symbols, async (sym) => {
    const q = quoteBy.get(sym);
    if (!q) return;
    const geo = detectMarket({ symbol: sym, currency: q.currency, exchange: q.exchange, assetType: q.assetType });
    if (geo !== "IN") return;
    try {
      const company = await getScreenerInCompany(sym);
      if (company) indiaCompanyBy.set(sym, company);
    } catch {
      /* leave unmapped — falls back to the Yahoo composite below */
    }
  });

  // 4. Assemble metrics + score.
  return items.map((item) => {
    const sym = item.symbol.toUpperCase();
    const f = fundamentals.get(sym);
    const rq = richBy.get(sym);
    const q = quoteBy.get(sym);
    const marketCap = rq?.marketCap ?? q?.marketCap ?? null;

    const geography = q
      ? detectMarket({ symbol: sym, currency: q.currency, exchange: q.exchange, assetType: q.assetType })
      : null;

    const indiaCompany = geography === "IN" ? indiaCompanyBy.get(sym) : undefined;
    if (indiaCompany) {
      const snapshot = computeIndiaSnapshot(indiaCompany, {
        debtToEquity: getRatio(indiaCompany, "Debt to Equity"),
        interestCoverage: getRatio(indiaCompany, "Interest Coverage"),
        evToEbitda: getRatio(indiaCompany, "EV / EBITDA"),
        priceToBook: getRatio(indiaCompany, "Price to Book"),
      });
      // momentumScore only reads oneYearReturn/distanceFrom52WkHigh — both
      // come from the rich quote (live price data), not the Yahoo
      // fundamentals snapshot this branch deliberately avoids for India.
      const momentum = momentumScore({
        oneYearReturn: rq?.oneYearReturn ?? null,
        distanceFrom52WkHigh: rq?.distanceFrom52WkHigh ?? null,
      } as ScorableMetrics);
      return {
        symbol: sym,
        sector: f?.sector ?? null,
        marketCap,
        compositeScores: {
          value: snapshot.valuation,
          growth: snapshot.growth,
          quality: snapshot.quality,
          // Nearest available match — India's model has no separate
          // financial-health dimension; capital allocation discipline is
          // the closest proxy this scorer has for it.
          financialHealth: snapshot.capitalAllocation,
          momentum,
          overall: snapshot.composite,
        },
        dividendYield: f?.dividendYield ?? null,
        beta: f?.beta ?? null,
        geography,
        // Consensus rides on the Yahoo fundamentals row, which this branch
        // deliberately does not use for SCORING an Indian name — but if the row
        // exists its consensus is still the street's view of that symbol, and a
        // missing row is honestly null rather than absent.
        analystTargetMean: f?.analystTargetMean ?? null,
        analystTargetHigh: f?.analystTargetHigh ?? null,
        analystTargetLow: f?.analystTargetLow ?? null,
        analystOpinions: f?.analystOpinions ?? null,
      } satisfies FitEnrichment;
    }

    if (!f) {
      // Fundamentals genuinely unavailable — return a minimal record. Sector may
      // still be known from the quote; scores are empty and the fit scorer will
      // reflect that honestly rather than inventing a number.
      return {
        symbol: sym,
        sector: null,
        marketCap,
        compositeScores: { value: null, growth: null, quality: null, financialHealth: null, momentum: null, overall: null },
        dividendYield: null,
        beta: null,
        geography,
        analystTargetMean: null,
        analystTargetHigh: null,
        analystTargetLow: null,
        analystOpinions: null,
      } satisfies FitEnrichment;
    }

    const rawFcfYield =
      f.freeCashflow != null && marketCap && marketCap !== 0
        ? (f.freeCashflow / marketCap) * 100
        : null;
    const fcfYield = rawFcfYield != null && Math.abs(rawFcfYield) <= 40 ? rawFcfYield : null;

    const base = {
      symbol: f.symbol,
      name: f.name,
      sector: f.sector,
      industry: f.industry,
      price: rq?.price ?? q?.price ?? null,
      marketCap,
      forwardPE: f.forwardPE,
      evToEbitda: f.evToEbitda,
      fcfYield,
      revenueGrowthYoY: f.revenueGrowthYoY,
      revenueCagr3y: f.revenueCagr3y,
      epsGrowthYoY: f.epsGrowthYoY,
      epsCagr3y: f.epsCagr3y,
      roic: f.roic,
      roe: f.roe,
      grossMargin: f.grossMargin,
      operatingMargin: f.operatingMargin,
      debtToEquity: f.debtToEquity,
      netDebtToEbitda: f.netDebtToEbitda,
      netDebt: f.netDebt,
      currentRatio: f.currentRatio,
      fcfMargin: f.fcfMargin,
      fcfGrowthYoY: f.fcfGrowthYoY,
      dividendYield: f.dividendYield,
      buybackYield: f.buybackYield,
      oneYearReturn: rq?.oneYearReturn ?? null,
      distanceFrom52WkHigh: rq?.distanceFrom52WkHigh ?? null,
      institutionalOwnership: f.institutionalOwnership,
      earningsSurprisePct: f.earningsSurprisePct,
    };

    return {
      symbol: sym,
      sector: f.sector,
      marketCap,
      compositeScores: computeScores(base),
      dividendYield: f.dividendYield,
      beta: f.beta,
      geography,
      // `?? null` rather than a bare read: rows cached before these fields
      // existed deserialize without them, and `undefined` would not survive the
      // JSON round-trip to the client as an explicit "unknown".
      analystTargetMean: f.analystTargetMean ?? null,
      analystTargetHigh: f.analystTargetHigh ?? null,
      analystTargetLow: f.analystTargetLow ?? null,
      analystOpinions: f.analystOpinions ?? null,
    } satisfies FitEnrichment;
  });
}
