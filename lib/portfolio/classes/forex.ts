import { registerClass } from "../model/adapter";
import { marketValuation, realizedVol } from "./market-base";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
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

  factors() {
    // A long non-USD pair is short the dollar, by construction.
    return mergeFactors(CLASS_FACTORS.forex);
  },

  metrics(raw, ctx) {
    return { volatility: realizedVol(raw.symbol, ctx) };
  },

  attributes(raw) {
    return {
      sector: "Currency",
      geography: "Global",
      currency: raw.currency,
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
