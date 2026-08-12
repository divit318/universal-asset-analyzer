/**
 * Shared plumbing for the two fund-shaped universes: ETFs and bond funds.
 *
 * Both page Yahoo's ETF screener (which returns expense ratio, net assets,
 * yield and YTD return inline) and then enrich the top names with the
 * `topHoldings` / `fundProfile` quoteSummary modules, which is where the
 * genuinely valuable data lives — holdings concentration and sector weights for
 * equity ETFs, and duration / maturity / credit ratings for bond funds.
 *
 * Enrichment is one HTTP round-trip per fund, so it is capped and cached. The
 * cap is not a cop-out: the ETF universe has a long tail of thousands of tiny,
 * illiquid funds that nobody should be buying anyway, and enriching the largest
 * few hundred by AUM covers essentially everything investable. Funds beyond the
 * cap still appear in results — they simply carry nulls for the holdings-level
 * metrics, which the filter engine correctly treats as "cannot confirm this
 * passes" rather than silently including them.
 *
 * No private cache here: getQuoteSummary is already routed through the
 * Platform Data Layer (`quoteSummary` dataset — 4h TTL / 12h SWR, persisted).
 * This module used to keep its own 24h-TTL Map on top, which double-cached
 * every successful fetch AND pinned transient failures (a `withRetry` timeout,
 * a rate-limited request) as a permanent "no holdings data" for a full day,
 * independent of and outliving the platform's own cache. Reading straight
 * through getQuoteSummary gets caching, dedup and SWR for free without that
 * failure mode.
 */

import { getQuoteSummary, zeroAsMissing } from "../../yahoo";
import type { FundHolding, FundSectorWeight } from "../../types";
import { mapPool, withRetry } from "../metrics-util";

/** Yahoo's raw topHoldings/fundProfile payload, narrowed to what we read. */
interface RawFundDetail {
  fundProfile?: {
    categoryName?: string | null;
    family?: string | null;
    feesExpensesInvestment?: { annualReportExpenseRatio?: number };
  };
  topHoldings?: {
    holdings?: { symbol?: string; holdingName?: string; holdingPercent?: number }[];
    sectorWeightings?: Record<string, number>[];
    stockPosition?: number;
    bondPosition?: number;
    cashPosition?: number;
    /**
     * Futures collateral and physical bullion land here: GLD/IAU/SLV report
     * otherPosition 1.0 and nothing else, so this is the only field that says
     * "this fund holds neither stocks nor bonds".
     */
    otherPosition?: number;
    /** Present for bond funds. Verified against AGG/TLT/HYG. */
    bondHoldings?: { maturity?: number; duration?: number };
    /** Rating buckets, each 0-1. Verified against AGG/TLT/HYG. */
    bondRatings?: Record<string, number>[];
  };
}

export interface FundDetail {
  /**
   * False when Yahoo told us nothing at all for this fund — either the request
   * failed after retries, or the response carried neither `fundProfile` nor
   * `topHoldings`.
   *
   * This distinction is load-bearing for asset-class purity. Every field below
   * degrades to `null` in both cases, so "we asked and the fund holds no bonds"
   * and "we never found out" used to be indistinguishable — and the ETF
   * universe's bond-fund exclusion read the second as the first, silently
   * admitting bond funds (NXUS, an aggregate bond ETF) into the equity ETF
   * class whenever a single enrichment call happened to time out.
   */
  available: boolean;
  category: string | null;
  /** Issuer / fund family ("Vanguard", "iShares"). Verified present on fundProfile. */
  family: string | null;
  expenseRatio: number | null; // %
  /** Combined weight of the ten largest holdings, %. */
  top10Concentration: number | null;
  /** The ten largest holdings by name — the same holdings.holdings list
   * top10Concentration is summed from, kept as a list instead of collapsed
   * into just the aggregate. Null when Yahoo returned no holdings data. */
  topHoldings: FundHolding[] | null;
  /** Largest single sector weight, %. */
  topSectorWeight: number | null;
  topSector: string | null;
  /**
   * The FULL sector weighting list (largest first, %), not just the top one —
   * `topSector`/`topSectorWeight` are its head, kept for existing callers. The
   * Portfolio Intelligence look-through needs the whole distribution: a fund
   * that is 34% technology and 20% financials contributes to two accidental
   * bets, and the head alone can only see the first. Same caveat as topSector:
   * only meaningful when the fund is majority equity.
   */
  sectorWeights: FundSectorWeight[] | null;
  /** Inverse-Herfindahl count of sectors: "11 sectors" vs "effectively 2.3". */
  effectiveSectors: number | null;
  equityWeight: number | null; // %
  bondWeight: number | null; // %
  /**
   * Cash and "other" (futures collateral, physical metal), in %.
   *
   * Needed because the position mix does NOT partition the way it looks like it
   * should: a T-bill ETF (BIL) reports cash 100% / bonds 0%, and a bullion trust
   * (GLD) reports other 100%. Classifying on `bondWeight` alone calls both of them
   * equity funds. See lib/portfolio/classes/reference/risk-models.ts.
   */
  cashWeight: number | null; // %
  otherWeight: number | null; // %
  // Bond-fund fields (null for equity ETFs).
  duration: number | null; // years
  maturity: number | null; // years
  /** Rating bucket → weight (0-100). Keys: aaa, aa, a, bbb, bb, b, below_b, us_government, other. */
  ratings: Record<string, number> | null;
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

const pct = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : v * 100;

function parseDetail(raw: RawFundDetail): FundDetail {
  const profile = raw.fundProfile ?? {};
  const holdings = raw.topHoldings ?? {};

  const namedHoldings: FundHolding[] = (holdings.holdings ?? [])
    .filter(
      (h): h is { symbol: string; holdingName: string; holdingPercent: number } =>
        typeof h.symbol === "string" && typeof h.holdingName === "string" && typeof h.holdingPercent === "number",
    )
    .slice(0, 10)
    .map((h) => ({ symbol: h.symbol, name: h.holdingName, weightPercent: h.holdingPercent * 100 }));

  const top10 = (holdings.holdings ?? [])
    .map((h) => h.holdingPercent)
    .filter((p): p is number => typeof p === "number")
    .slice(0, 10)
    .reduce((s, p) => s + p, 0);

  const sectors = (holdings.sectorWeightings ?? [])
    .flatMap((row) => Object.entries(row))
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  const top = sectors[0];
  const sectorWeights: FundSectorWeight[] = sectors.map(([k, v]) => ({
    sector: SECTOR_LABEL[k] ?? k,
    weightPercent: (v as number) * 100,
  }));

  /*
   * Effective number of sectors: the inverse Herfindahl of the sector weights.
   *
   * A fund holding 11 sectors at 9% each and a fund holding 11 sectors where one
   * is 80% both report "11 sectors", and only one of them is diversified. The
   * inverse HHI answers the question a top-sector weight can't: how many sectors
   * is this fund *effectively* spread across. Free — the weights are already
   * parsed above for topSectorWeight.
   */
  const weights = sectors.map(([, v]) => v as number);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const effectiveSectors =
    weightSum > 0
      ? 1 / weights.reduce((acc, w) => acc + (w / weightSum) ** 2, 0)
      : null;

  // bondRatings comes back as an array of single-key objects: [{bb: 0}, {aa: 0.74}, …]
  const ratingEntries = (holdings.bondRatings ?? []).flatMap((row) => Object.entries(row));
  const ratings = ratingEntries.length
    ? Object.fromEntries(
        ratingEntries
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => [k, (v as number) * 100]),
      )
    : null;

  return {
    available: raw.fundProfile != null || raw.topHoldings != null,
    category: profile.categoryName ?? null,
    family: profile.family ?? null,
    expenseRatio: pct(zeroAsMissing(profile.feesExpensesInvestment?.annualReportExpenseRatio)),
    // Zero holdings reported means "Yahoo didn't tell us", not "the fund holds
    // nothing" — null so a concentration filter excludes it instead of ranking
    // it as perfectly diversified.
    top10Concentration: top10 > 0 ? top10 * 100 : null,
    topHoldings: namedHoldings.length > 0 ? namedHoldings : null,
    topSectorWeight: top ? pct(top[1] as number) : null,
    topSector: top ? (SECTOR_LABEL[top[0]] ?? top[0]) : null,
    sectorWeights: sectorWeights.length > 0 ? sectorWeights : null,
    effectiveSectors,
    equityWeight: pct(holdings.stockPosition),
    bondWeight: pct(holdings.bondPosition),
    cashWeight: pct(holdings.cashPosition),
    otherWeight: pct(holdings.otherPosition),
    duration: holdings.bondHoldings?.duration ?? null,
    maturity: holdings.bondHoldings?.maturity ?? null,
    ratings,
  };
}

export async function getFundDetails(symbols: string[]): Promise<Map<string, FundDetail>> {
  const out = new Map<string, FundDetail>();

  await mapPool(symbols, 4, async (symbol) => {
    const raw = await withRetry(
      () => getQuoteSummary(symbol, ["fundProfile", "topHoldings"]) as Promise<RawFundDetail>,
    );
    // A fund Yahoo has no holdings data for is a real outcome, not an error —
    // parseDetail({}) degrades to nulls rather than dropping the symbol. A
    // withRetry failure (raw == null, exhausted retries) gets the same
    // treatment for this build pass; the next universe rebuild retries it
    // fresh rather than a stale local cache pinning the failure for a day.
    out.set(symbol, parseDetail(raw ?? {}));
  });

  return out;
}
