/**
 * The ETF universe. Pages Yahoo's ETF screener by net assets (largest first),
 * then enriches the top slice with holdings data.
 *
 * The screener row itself carries netExpenseRatio, netAssets, dividendYield,
 * ytdReturn, volume and the 52-week range — verified against a live response —
 * so cost, size, income and liquidity are all available for the whole universe
 * with zero extra calls. Only concentration, sector exposure and style need the
 * per-fund enrichment pass, and only the largest ETFs get it.
 *
 * Volatility and drawdown need daily history, which is another call per fund.
 * They're computed for the enriched slice only, for the same reason.
 */

import { pageRawScreener, q, type RawQuoteRow } from "../../yahoo-screener";
import { getHistory } from "../../yahoo";
import { annualizedVolatility, drawdown, mapPool, trailingReturn, withRetry } from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import { getFundDetails, type FundDetail } from "./fund-shared";
import { BOND_CATEGORIES } from "../../assets/bond";

/** How many funds to pull from the screener. */
const UNIVERSE_LIMIT = Number(process.env.SCREENER_ETF_LIMIT) || 600;
/**
 * How many of those (largest by AUM) get the holdings + history enrichment
 * pass. Used to default to half of UNIVERSE_LIMIT (300), which nulled 1-year
 * return, volatility, region and focus for the smaller half of the universe
 * by construction — not a data-availability gap, just a cap nobody raised
 * once the pipeline moved to a background-built, 12h-cached universe (this
 * build never blocks a page load; raising it only costs background time).
 * Defaults to the full universe; still overridable for local/dev runs.
 */
const ENRICH_LIMIT = Number(process.env.SCREENER_ETF_ENRICH) || UNIVERSE_LIMIT;
const TTL_MS = 12 * 60 * 60 * 1000;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/* -------------------------------------------------------------------------- */
/* Category → region / focus / style                                          */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo's Morningstar-style `categoryName` is the only geography/style signal
 * available (there is no country-weight breakdown in any free endpoint), but it
 * is a real one: "China Region", "Japan Stock", "Large Growth", "Technology"
 * all say exactly what the fund is. These three mappers read it.
 */
export function categoryRegion(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("china")) return "China";
  if (c.includes("japan")) return "Japan";
  if (c.includes("india")) return "India";
  if (c.includes("latin america")) return "Latin America";
  if (c.includes("europe")) return "Europe";
  if (c.includes("emerging")) return "Emerging Markets";
  if (c.includes("foreign") || c.includes("international")) return "Developed ex-US";
  if (c.includes("global") || c.includes("world")) return "Global";
  if (c.includes("diversified pacific") || c.includes("pacific")) return "Developed ex-US";
  // Everything else in the US screener with no geographic qualifier is US.
  return "US";
}

export function categoryFocus(category: string | null, topSector: string | null): string | null {
  const c = (category ?? "").toLowerCase();
  if (c.includes("technology")) return "Technology";
  if (c.includes("health")) return "Healthcare";
  if (c.includes("financial")) return "Financials";
  if (c.includes("energy")) return "Energy";
  if (c.includes("real estate")) return "Real Estate";
  if (c.includes("utilities")) return "Utilities";
  if (c.includes("industrial")) return "Industrials";
  if (c.includes("consumer")) return "Consumer";
  if (c.includes("natural resources") || c.includes("materials")) return "Materials";
  if (c.includes("communication")) return "Communication";
  if (c.includes("commodit") || c.includes("precious metals")) return "Commodities";
  if (c.includes("blend") || c.includes("growth") || c.includes("value") || c.includes("total")) {
    return "Broad Market";
  }

  // No sector in the category name — fall back to what the fund actually holds.
  const known = [
    "Technology", "Healthcare", "Energy", "Real Estate", "Utilities",
    "Industrials", "Materials", "Communication",
  ];
  if (topSector && known.includes(topSector)) return topSector;
  if (topSector === "Financial Services") return "Financials";
  if (topSector?.startsWith("Consumer")) return "Consumer";
  if (topSector === "Basic Materials") return "Materials";
  return category ? "Other" : null;
}

export function categoryStyle(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("value")) return "Value";
  if (c.includes("growth")) return "Growth";
  if (c.includes("blend")) return "Blend";
  if (c.includes("dividend") || c.includes("income") || c.includes("preferred")) return "Income";
  // A sector/regional/commodity fund with no value/growth/blend qualifier is a
  // targeted bet — Morningstar calls these "miscellaneous sector"/thematic.
  if (
    c.includes("miscellaneous") ||
    c.includes("trading") ||
    c.includes("leveraged") ||
    c.includes("digital") ||
    c.includes("infrastructure")
  ) {
    return "Thematic";
  }
  const sectorish = [
    "technology", "health", "financial", "energy", "real estate", "utilities",
    "industrial", "consumer", "natural resources", "communication", "equity precious metals",
  ];
  if (sectorish.some((s) => c.includes(s))) return "Sector";
  return "Other";
}

/* -------------------------------------------------------------------------- */

/** Bond categories are screened as the `bond` asset class, not as generic ETFs. */
const BOND_CATEGORY_SET = new Set<string>(BOND_CATEGORIES.map((c) => c.toLowerCase()));

export function toCandidate(
  row: RawQuoteRow,
  detail: FundDetail | undefined,
  history: { volatility: number | null; maxDrawdown: number | null; oneYearReturn: number | null } | undefined,
): ScreenerCandidate {
  const symbol = row.symbol as string;
  // The screener row's netExpenseRatio is already a percentage; fundProfile's
  // annualReportExpenseRatio is a fraction (0.0003) and fund-shared scales it.
  // Prefer the screener's, fall back to the enriched one.
  const expenseRatio = num(row.netExpenseRatio) ?? detail?.expenseRatio ?? null;

  return {
    symbol,
    name: str(row.longName) ?? str(row.shortName) ?? symbol,
    assetClass: "etf",
    price: num(row.regularMarketPrice),
    changePercent: num(row.regularMarketChangePercent),
    metrics: {
      expenseRatio,
      aum: num(row.netAssets),
      avgVolume: num(row.averageDailyVolume3Month),
      dividendYield: num(row.dividendYield),
      ytdReturn: num(row.ytdReturn),
      oneYearReturn: history?.oneYearReturn ?? null,
      volatility: history?.volatility ?? null,
      maxDrawdown: history?.maxDrawdown ?? null,
      top10Concentration: detail?.top10Concentration ?? null,
      topSectorWeight: detail?.topSectorWeight ?? null,
      equityWeight: detail?.equityWeight ?? null,
    },
    attributes: {
      region: categoryRegion(detail?.category ?? null),
      focus: categoryFocus(detail?.category ?? null, detail?.topSector ?? null),
      style: categoryStyle(detail?.category ?? null),
    },
    topHoldings: detail?.topHoldings ?? null,
  };
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  const rows = await pageRawScreener(
    {
      quoteType: "ETF",
      query: q.and(q.eq("region", "us")),
      sortField: "fundnetassets",
      sortDir: "desc",
    },
    UNIVERSE_LIMIT,
  );

  report(0, rows.length);

  const toEnrich = rows.slice(0, ENRICH_LIMIT).map((r) => r.symbol as string);
  const details = await getFundDetails(toEnrich);

  // History for the enriched slice, for volatility / drawdown / 1-year return.
  const histories = new Map<string, { volatility: number | null; maxDrawdown: number | null; oneYearReturn: number | null }>();
  let done = 0;
  await mapPool(toEnrich, 4, async (symbol) => {
    const h = await withRetry(() => getHistory(symbol, 400));
    if (h && h.length > 20) {
      histories.set(symbol, {
        volatility: annualizedVolatility(h, 252),
        maxDrawdown: drawdown(h),
        oneYearReturn: trailingReturn(h, 252),
      });
    }
    report(++done, rows.length);
  });

  // Bond funds belong to the `bond` asset class, where duration and credit
  // quality are first-class; judging them on top-10 concentration and sector
  // weight would be meaningless. The ETF *screener row* carries no category
  // field (verified — it has netExpenseRatio and netAssets but no
  // categoryName), so the only reliable signal is what enrichment tells us the
  // fund actually holds: a portfolio that is ≥70% bonds is a bond fund,
  // whatever it calls itself. Funds past the enrichment cap can't be
  // classified this way and are left in — they're small, and the alternative
  // is dropping legitimate equity ETFs we simply didn't look at.
  return rows
    .filter((r) => {
      const d = details.get(r.symbol as string);
      if (!d) return true;
      if (d.bondWeight != null && d.bondWeight >= 70) return false;
      return !(d.category && BOND_CATEGORY_SET.has(d.category.toLowerCase()));
    })
    .map((r) =>
      toCandidate(r, details.get(r.symbol as string), histories.get(r.symbol as string)),
    );
}

export const etfUniverse: UniverseProvider = createUniverseCache({
  assetClass: "etf",
  ttlMs: TTL_MS,
  build,
});
