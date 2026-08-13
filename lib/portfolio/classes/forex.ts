import { registerClass } from "../model/adapter";
import { marketValuation, realizedVol, riskModelFor } from "./market-base";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * Forex positions held as an investment (as distinct from the FX *exposure* every
 * foreign-currency holding carries implicitly — that is computed by the allocation
 * engine from Holding.currency, and is a different thing).
 *
 * Per lib/assets/forex.ts, carry / rate differentials come from a hand-maintained
 * policy-rate table that goes stale when central banks move. We do not score on it
 * here rather than present a stale carry number with false precision.
 */
export const forexAdapter: PortfolioClassAdapter = {
  id: "forex",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "units",
  registryClass: "forex",
  manualStalenessDays: null,

  value: marketValuation,
  income: () => null,

  /**
   * The pair's DIRECTION decides the sign, which a flat `usd: -1.0` could not.
   *
   * `EURUSD=X` is long EUR against the dollar: usd −1.0, as before. `USDCHF=X` is
   * long the DOLLAR against the franc — the same holding the old model said would
   * lose 12% in a dollar rally, when it gains. A cross with no dollar leg
   * (`EURJPY=X`) asserts no dollar loading at all rather than a fabricated one.
   */
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw, ctx) {
    return { volatility: realizedVol(raw.symbol, ctx) };
  },

  attributes(raw, ctx) {
    return {
      sector: "Currency",
      geography: "Global",
      geographyBasis: "A currency pair is an exposure between two economies — no single geography",
      currency: raw.currency,
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  // No honest basis to score a currency pair as "attractive" with the data we
  // have. Returning null is the correct answer; the old engine would have said 50.
  score: () => null,

  row: {
    primary: ["volatility"],
    secondary: [],
  },
};

registerClass(forexAdapter);
