/**
 * The bond universe: fixed income funds, screened per Morningstar category.
 *
 * The `categoryname` operand on Yahoo's ETF screener is the key that makes this
 * class possible — verified live: `eq(categoryname, "Intermediate Core Bond")`
 * returns 59 funds (BND, AGG, BIV, …). So the universe is built by querying
 * each of the bond categories in lib/assets/bond.ts and unioning the results,
 * which yields precisely the fixed income funds and nothing else.
 *
 * Enrichment then gives the data that makes this a real bond screener rather
 * than a yield table: `bondHoldings.duration`, `bondHoldings.maturity` and the
 * full `bondRatings` breakdown. Verified against AGG (duration 3.83, 48.9% US
 * government), TLT (Long Government) and HYG (57.9% BB, 31.9% B). Every bond
 * fund gets enriched — there are only a few hundred, not thousands.
 *
 * Spread is computed against the live Treasury curve at the fund's own average
 * maturity, which is the comparison that actually means something: a 5% yield
 * on a 2-year fund and a 5% yield on a 20-year fund are entirely different
 * propositions, and only the spread tells you which one is being paid for
 * credit risk.
 */

import { getHistory } from "../../yahoo";
import { pageRawScreener, q, type RawQuoteRow } from "../../yahoo-screener";
import { getYieldCurve } from "../treasury";
import { mapPool, trailingReturn, withRetry } from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import { getFundDetails, type FundDetail } from "./fund-shared";
import { BOND_CATEGORIES } from "../../assets/bond";

const TTL_MS = 12 * 60 * 60 * 1000;
const PER_CATEGORY = 60;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/* -------------------------------------------------------------------------- */
/* Credit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo's bondRatings buckets.
 *
 * Critically, `us_government` OVERLAPS the letter buckets rather than being a
 * peer of them — US Treasuries are counted both there *and* under their letter
 * rating. Verified against the live payloads: AGG reports us_government 48.88
 * alongside aa 74.05, and its letter buckets alone sum to exactly 100.0
 * (2.27 + 74.05 + 11.99 + 11.69); HYG's likewise sum to 100.0. So the letter
 * buckets are the complete partition, and adding us_government into the
 * investment-grade total would double-count every Treasury — which is what
 * produced an "investment grade: 149%" reading before this was caught.
 *
 * `us_government` is therefore reported on its own (as `govtPct`) and excluded
 * from both aggregates and from the average-rating weighting.
 */
const IG_BUCKETS = ["aaa", "aa", "a", "bbb"];
const HY_BUCKETS = ["bb", "b", "below_b"];

/** Numeric score per letter bucket, for weight-averaging back into a rating band. */
const RATING_SCORE: Record<string, number> = {
  aaa: 1,
  aa: 2,
  a: 3,
  bbb: 4,
  bb: 5,
  b: 6,
  below_b: 7,
};
const SCORE_TO_RATING = ["AAA", "AAA", "AA", "A", "BBB", "BB", "B", "Below B"];

export function creditProfile(ratings: Record<string, number> | null) {
  if (!ratings) {
    return { investmentGradePct: null, highYieldPct: null, govtPct: null, avgRating: null };
  }

  const sum = (keys: string[]) =>
    keys.reduce((s, k) => s + (ratings[k] ?? 0), 0);

  const ig = sum(IG_BUCKETS);
  const hy = sum(HY_BUCKETS);
  const total = ig + hy;

  // A fund reporting no rating weights at all (every bucket zero) tells us
  // nothing — that's null, not "0% investment grade".
  if (total <= 0) {
    return { investmentGradePct: null, highYieldPct: null, govtPct: null, avgRating: null };
  }

  let weighted = 0;
  for (const [bucket, score] of Object.entries(RATING_SCORE)) {
    weighted += (ratings[bucket] ?? 0) * score;
  }
  const avgScore = Math.round(weighted / total);

  // Yahoo's bucket weights are rounded independently and can sum to a hair over
  // 100 (a real response gave 100.07% investment grade). Clamp, rather than
  // publish a percentage above 100.
  const clamp = (v: number) => Math.min(Math.max(v, 0), 100);

  return {
    investmentGradePct: clamp(ig),
    highYieldPct: clamp(hy),
    govtPct: ratings.us_government == null ? null : clamp(ratings.us_government),
    avgRating: SCORE_TO_RATING[Math.min(Math.max(avgScore, 0), 7)] ?? null,
  };
}

/** Issuer type, from the fund's Morningstar category. */
export function issuerType(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("muni")) return "Municipal";
  if (c.includes("high yield")) return "High Yield";
  if (c.includes("bank loan")) return "Bank Loan";
  if (c.includes("inflation")) return "Inflation-Protected";
  if (c.includes("emerging")) return "Emerging Markets";
  if (c.includes("government")) return "Government";
  if (c.includes("corporate")) return "Corporate";
  if (c.includes("multisector") || c.includes("nontraditional")) return "Multisector";
  if (c.includes("global") || c.includes("world")) return "Global";
  // Core/core-plus/short-term/long-term aggregates are corporate+government blends.
  return "Corporate";
}

/**
 * Risk level from the two independent ways a bond fund loses money: rates move
 * against its duration, or its credits default. Either alone is enough to make
 * a fund risky — a 12-year Treasury fund carries no credit risk whatsoever and
 * still fell by a third when rates rose, and a 2-year junk fund has almost no
 * duration and still defaults in a recession. So the two scores add.
 */
export function riskLevel(duration: number | null, highYieldPct: number | null): string | null {
  if (duration == null && highYieldPct == null) return null;
  const d = duration ?? 0;
  const hy = highYieldPct ?? 0;

  const rateRisk = d >= 10 ? 4 : d >= 7 ? 3 : d >= 3 ? 1 : 0;
  const creditRisk = hy >= 60 ? 4 : hy >= 30 ? 2 : hy >= 10 ? 1 : 0;
  const score = rateRisk + creditRisk;

  if (score >= 7) return "Very High";
  if (score >= 4) return "High";
  if (score >= 2) return "Moderate";
  if (score >= 1) return "Low";
  return "Very Low";
}

/* -------------------------------------------------------------------------- */

export function toCandidate(
  row: RawQuoteRow,
  detail: FundDetail | undefined,
  treasuryYield: (maturityYears: number) => number | null,
  oneYearReturn: number | null,
): ScreenerCandidate {
  const symbol = row.symbol as string;
  const yieldPct = num(row.dividendYield);
  const duration = detail?.duration ?? null;
  const maturity = detail?.maturity ?? null;
  const credit = creditProfile(detail?.ratings ?? null);

  // Spread over a Treasury of comparable maturity. Without a maturity we have
  // no idea which Treasury to compare against, so the spread is null rather
  // than a number compared against an arbitrary point on the curve.
  const benchmark = maturity != null ? treasuryYield(maturity) : null;
  const spread = yieldPct != null && benchmark != null ? yieldPct - benchmark : null;

  return {
    symbol,
    name: str(row.longName) ?? str(row.shortName) ?? symbol,
    assetClass: "bond",
    price: num(row.regularMarketPrice),
    changePercent: num(row.regularMarketChangePercent),
    metrics: {
      yield: yieldPct,
      spread,
      duration,
      maturity,
      rateSensitivity: duration != null ? -duration : null,
      investmentGradePct: credit.investmentGradePct,
      highYieldPct: credit.highYieldPct,
      govtPct: credit.govtPct,
      expenseRatio: num(row.netExpenseRatio) ?? detail?.expenseRatio ?? null,
      aum: num(row.netAssets),
      oneYearReturn,

      /*
       * Carry per unit of rate risk — the number a fixed-income investor actually
       * ranks on, and one no consumer screener exposes.
       *
       * A 5% yield from a 2-year fund and a 5% yield from a 20-year fund are
       * completely different propositions: the second is being paid for taking
       * ten times the duration. Yield alone therefore sorts a bond list by how
       * much rate risk each fund happens to carry, which is not a ranking of
       * value. Dividing by duration puts them on comparable footing, and it is
       * pure arithmetic over two metrics already computed above — no new data.
       */
      yieldPerDuration: yieldPct != null && duration != null && duration > 0 ? yieldPct / duration : null,
      /*
       * Spread per unit of duration: the same idea applied to the *credit* leg.
       * Isolates funds being paid for credit risk from funds being paid for
       * sitting on the long end of the curve.
       */
      spreadPerDuration: spread != null && duration != null && duration > 0 ? spread / duration : null,
      /** Net of fees, because a 12bp expense ratio is a real haircut on a 4% carry. */
      netYield: yieldPct != null ? yieldPct - (num(row.netExpenseRatio) ?? detail?.expenseRatio ?? 0) : null,
      cashWeight: detail?.cashWeight ?? null,
      fundAge:
        num(row.firstTradeDateMilliseconds) != null
          ? (Date.now() - (num(row.firstTradeDateMilliseconds) as number)) / (365.25 * 24 * 3600 * 1000)
          : null,
    },
    attributes: {
      issuerType: issuerType(detail?.category ?? null),
      avgRating: credit.avgRating,
      riskLevel: riskLevel(duration, credit.highYieldPct),
    },
  };
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  // One query per bond category. Yahoo's `categoryname` operand only accepts a
  // single value per `eq`, and an `or` of 21 of them is rejected as too large,
  // so this pages them one at a time. ~21 requests, once every 12 hours.
  const rows = new Map<string, RawQuoteRow>();
  for (const category of BOND_CATEGORIES) {
    const page = await withRetry(() =>
      pageRawScreener(
        {
          quoteType: "ETF",
          query: q.and(q.eq("region", "us"), q.eq("categoryname", category)),
          sortField: "fundnetassets",
          sortDir: "desc",
        },
        PER_CATEGORY,
      ),
    );
    for (const r of page ?? []) {
      const sym = r.symbol as string;
      if (!rows.has(sym)) rows.set(sym, r);
    }
    report(0, rows.size);
  }

  const symbols = [...rows.keys()];
  const [details, curve] = await Promise.all([getFundDetails(symbols), getYieldCurve()]);

  const returns = new Map<string, number | null>();
  let done = 0;
  await mapPool(symbols, 4, async (symbol) => {
    const h = await withRetry(() => getHistory(symbol, 400));
    returns.set(symbol, h && h.length > 20 ? trailingReturn(h, 252) : null);
    report(++done, symbols.length);
  });

  return symbols.map((s) =>
    toCandidate(rows.get(s)!, details.get(s), curve, returns.get(s) ?? null),
  );
}

export const bondUniverse: UniverseProvider = createUniverseCache({
  assetClass: "bond",
  ttlMs: TTL_MS,
  build,
});
