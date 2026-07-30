/**
 * The REIT universe: every listed US REIT above a $200M market cap, enriched
 * through the same equity fundamentals path and re-projected through REIT
 * metrics (FFO, payout coverage, property type) instead of equity ones.
 *
 * This used to be the Real Estate *slice of the equity dataset* — which sounded
 * efficient and was quietly broken. The equity universe is the top 1,000 names
 * by market cap, and that list bottoms out at $9.7B; REITs are overwhelmingly
 * mid-caps, so only 55 of the 364 listed US REITs ever made it in. Four out of
 * five REITs were invisible to the REIT screener, and nothing said so.
 *
 * It now has its own universe (lib/universe.ts#getReitUniverse). The extra cost
 * is much smaller than it looks: the SQLite fundamentals cache is keyed by
 * symbol and shared across datasets, so the ~55 REITs that also sit in the
 * equity universe are enriched once and read by both.
 */

import { reitDataset } from "../../dataset";
import type { StockMetrics } from "../../types";
import type { ScreenerCandidate } from "../types";
import type { UniverseProvider } from "../universe-cache";
import { PROPERTY_TYPES } from "../../assets/reit";
import { toStatus } from "./equity";

/**
 * Yahoo's `industry` for a REIT reads "REIT - Retail", "REIT - Residential",
 * and so on. Strip the prefix and match it against our declared property types;
 * anything unrecognized (or a non-REIT real-estate operator like a broker)
 * falls through to null rather than being forced into a bucket.
 */
function propertyType(industry: string | null): string | null {
  if (!industry) return null;
  const cleaned = industry.replace(/^REIT\s*[-–]\s*/i, "").trim();

  const hit = PROPERTY_TYPES.find((t) => t.toLowerCase() === cleaned.toLowerCase());
  if (hit) return hit;

  // A few Yahoo industries don't match our labels exactly.
  const lower = cleaned.toLowerCase();
  if (lower.includes("hotel") || lower.includes("motel") || lower.includes("resort")) return "Hotel & Motel";
  if (lower.includes("healthcare") || lower.includes("medical")) return "Healthcare Facilities";
  if (lower.includes("mortgage")) return "Mortgage";
  if (lower.includes("industrial") || lower.includes("logistic")) return "Industrial";
  if (lower.includes("office")) return "Office";
  if (lower.includes("retail") || lower.includes("mall")) return "Retail";
  if (lower.includes("residential") || lower.includes("apartment") || lower.includes("housing")) return "Residential";
  if (lower.includes("diversified")) return "Diversified";
  if (lower.includes("specialty") || lower.includes("data center") || lower.includes("tower")) return "Specialty";
  if (lower.includes("service") || lower.includes("development") || lower.includes("brokerage")) return "Real Estate Services";
  return null;
}

/** Is this a REIT (or at least a real-estate name we can screen as one)? */
export function isReit(m: StockMetrics): boolean {
  return m.sector === "Real Estate";
}

/**
 * The operating-cash-flow-as-FFO proxy only holds for **equity** REITs — the
 * ones that own buildings and collect rent.
 *
 * It falls apart for two of Yahoo's Real Estate industries:
 *
 *  - **Mortgage REITs** don't own property, they own loans and MBS. Principal
 *    and interest flows run through operating cash flow, so OCF is enormous
 *    relative to market cap and P/FFO comes out at 1-2x. That isn't a REIT
 *    trading at two times cash earnings; it's the wrong denominator.
 *  - **Real Estate Services** (brokers, developers, managers) are operating
 *    companies, not landlords. FFO is not a concept that applies to them.
 *
 * Widening the REIT universe from the 55 large-caps that fitted inside the
 * top-1,000 equity list to all 237 listed REITs is what surfaced this: the old
 * slice was almost entirely large equity REITs, so the proxy always happened to
 * work. It now returns null for these two industries rather than a number that
 * is arithmetically valid and financially meaningless — and because an active
 * filter excludes unknown values, a payout-coverage screen correctly drops them
 * instead of ranking them top.
 */
const FFO_NOT_MEANINGFUL = new Set(["Mortgage", "Real Estate Services"]);

/**
 * Even within equity REITs, a P/FFO outside this band means the denominator is
 * broken rather than the REIT being extraordinarily cheap or dear. Mirrors the
 * ±40% plausibility guard lib/dataset.ts already applies to FCF yield.
 */
const PLAUSIBLE_P_FFO = { min: 3, max: 100 };

export function toCandidate(m: StockMetrics): ScreenerCandidate {
  const ocf = m.operatingCashflow ?? null;
  const mcap = m.marketCap;
  const type = propertyType(m.industry);

  // P/FFO and its inverse. Null when OCF is missing or non-positive (a REIT
  // burning cash has no meaningful P/FFO, and a negative multiple would sort as
  // "cheap", which is exactly backwards), when the industry is one the proxy
  // doesn't hold for, or when the result lands outside a plausible band.
  const ffoApplies = type == null || !FFO_NOT_MEANINGFUL.has(type);
  const rawPFfo = ffoApplies && mcap != null && ocf != null && ocf > 0 ? mcap / ocf : null;
  const pFfo =
    rawPFfo != null && rawPFfo >= PLAUSIBLE_P_FFO.min && rawPFfo <= PLAUSIBLE_P_FFO.max
      ? rawPFfo
      : null;

  const ffoYield = pFfo != null ? (1 / pFfo) * 100 : null;

  // Payout ratio: the dividend as a share of the FFO proxy. Above 100% means
  // the distribution is not being funded by operations.
  const payoutRatio =
    m.dividendYield != null && ffoYield != null && ffoYield > 0
      ? (m.dividendYield / ffoYield) * 100
      : null;

  return {
    symbol: m.symbol,
    name: m.name,
    assetClass: "reit",
    price: m.price,
    changePercent: null,
    metrics: {
      marketCap: mcap,
      dividendYield: m.dividendYield,
      payoutRatio,
      pFfo,
      ffoYield,
      evToEbitda: m.evToEbitda,
      revenueGrowthYoY: m.revenueGrowthYoY,
      // Growth in the FFO proxy, gated by the same rule as the proxy itself —
      // "FFO growth" is not a meaningful number for a mortgage REIT.
      ffoGrowthYoY: ffoApplies ? (m.ocfGrowthYoY ?? null) : null,
      debtToEquity: m.debtToEquity,
      netDebtToEbitda: m.netDebtToEbitda,
      netDebt: m.netDebt,
      oneYearReturn: m.oneYearReturn,
      distanceFrom52WkHigh: m.distanceFrom52WkHigh,
    },
    attributes: {
      propertyType: type,
    },
  };
}

export const reitUniverse: UniverseProvider = {
  assetClass: "reit",

  async load() {
    const { status, metrics } = await reitDataset.getData();
    // The universe query already scopes to sector = Real Estate, but Yahoo's
    // sector tagging is occasionally wrong on a name; `isReit` is the belt to
    // that braces, so a mis-tagged industrial can't turn up in a REIT screen
    // with a null property type and a meaningless P/FFO.
    const reits = metrics.filter(isReit);
    return { status: toStatus(status), candidates: reits.map(toCandidate) };
  },

  refresh() {
    return toStatus(reitDataset.refresh());
  },

  peekStatus() {
    return toStatus(reitDataset.getStatus());
  },
};
