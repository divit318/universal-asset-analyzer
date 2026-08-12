import { registerClass, fxRate, lerpScore } from "../model/adapter";
import { riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * Cash & cash equivalents.
 *
 * The current system cannot represent cash AT ALL — yet DEFAULT_CONSTRAINTS
 * carries a `minCashPct: 2` constraint on it, and the "invest new cash" flow asks
 * the user for a cash amount that is nowhere in the portfolio. Cash was a hole in
 * the middle of the data model that several features pretended to reason about.
 *
 * Two deliberate modelling decisions:
 *
 * 1. CASH IS NOT RISKLESS. Its nominal value is stable; its *purchasing power* is
 *    not. A +1pp inflation surprise is a ~1% real loss, so cash carries a -1.0
 *    inflation sensitivity. A 40%-cash portfolio must score WORSE on inflation
 *    protection, not neutral. Modelling cash as all-zeros is exactly how a tool
 *    ends up recommending cash as a free lunch.
 *
 * 2. CASH IS AN ASSET, NOT A RESIDUAL. It has a yield (T-bills, HYSA, MMF), it is
 *    the portfolio's liquidity buffer, and it is genuinely the right answer
 *    sometimes. It is scored on its yield, not treated as a failure to invest.
 */
export const cashAdapter: PortfolioClassAdapter = {
  id: "cash",
  valuationMode: "cash",
  defaultLiquidity: "t0",
  unit: "currency",
  // No screening domain — you cannot screen a universe of cash.
  registryClass: null,
  manualStalenessDays: null,

  value(raw, ctx) {
    const rate = fxRate(raw.currency, ctx);
    // Quantity IS the amount. There is no price.
    const value = raw.quantity;
    return {
      mode: "cash",
      value,
      valueBase: value * rate,
      fxRate: rate,
      source: "user",
      asOf: ctx.asOf,
      stale: false,
    };
  },

  income(raw, valuation) {
    // The user states the yield on their cash (HYSA / MMF / T-bill ladder). We do
    // not assume 0% — a 4.3% money-market yield on a large cash balance is real
    // income and belongs in the portfolio's income figure.
    const apy = typeof raw.meta.yieldPct === "number" ? raw.meta.yieldPct : null;
    if (apy == null || apy <= 0) return null;
    return {
      annual: (apy / 100) * valuation.valueBase,
      yieldPct: apy,
      kind: "interest",
    };
  },

  /**
   * Still inflation-exposed and still a liquidity ASSET — plus, now, the currency
   * exposure a foreign deposit obviously has. A CHF balance in a USD book used to
   * carry no `usd` loading at all, i.e. it was modelled as immune to the exchange
   * rate that entirely determines its dollar value.
   */
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw) {
    const apy = typeof raw.meta.yieldPct === "number" ? raw.meta.yieldPct : null;
    return { yield: apy };
  },

  attributes(raw, ctx) {
    return {
      sector: "Cash",
      geography: null,
      // Not a data gap: cash holds no assets with a home market. Its real
      // exposure is the issuing currency, which the By-currency view carries.
      geographyBasis: "Cash has no geography — its exposure is the currency, shown under By currency",
      currency: raw.currency,
      vehicle: typeof raw.meta.vehicle === "string" ? raw.meta.vehicle : null,
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  score(raw) {
    const apy = typeof raw.meta.yieldPct === "number" ? raw.meta.yieldPct : null;
    // Idle cash earning nothing is a real, scoreable weakness — not "no data".
    if (apy == null) {
      return {
        score: 35,
        confidence: 60,
        why: ["No yield recorded — cash may be sitting idle in a low-rate account"],
      };
    }
    return {
      score: Math.round(lerpScore(apy, 0, 5)),
      confidence: 90,
      why: apy >= 4
        ? [`Earning ${apy.toFixed(2)}% — competitive with T-bills`]
        : [`Earning ${apy.toFixed(2)}% — below prevailing short-term rates`],
    };
  },

  row: {
    primary: ["yield"],
    secondary: [],
  },
};

registerClass(cashAdapter);
