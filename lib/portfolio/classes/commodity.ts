import { registerClass, coverage, lerpScore, shrinkToConfidence } from "../model/adapter";
import { marketValuation, realizedVol, measuredBeta } from "./market-base";
import { COMMODITY_FACTORS, commodityBucket, mergeFactors } from "./reference/factor-sensitivities";
import type { PortfolioClassAdapter } from "../model/adapter";

/**
 * Commodities.
 *
 * The critical modelling point: commodities are NOT one asset class behaviourally.
 * Gold rises in a crisis; crude oil collapses in one. Any model that buckets them
 * together — as a GICS-sector-keyed shock table must, since neither has a sector —
 * destroys the entire reason to hold either. So the factor loadings are resolved
 * per commodity complex (see commodityBucket).
 *
 * Per lib/assets/commodity.ts: inventories and supply/demand balances are
 * `unavailable` (they need EIA/USDA). Not fabricated here.
 */
export const commodityAdapter: PortfolioClassAdapter = {
  id: "commodity",
  valuationMode: "market",
  defaultLiquidity: "t0",
  unit: "units",
  registryClass: "commodity",
  manualStalenessDays: null,

  value: marketValuation,
  // Physical commodities and their futures produce no income. This is a real
  // property of the asset (and a genuine cost of holding it), not missing data.
  income: () => null,

  factors(raw, ctx) {
    const bucket = commodityBucket(raw.symbol, raw.name);
    const beta = measuredBeta(raw.symbol, ctx);
    return mergeFactors(
      COMMODITY_FACTORS[bucket],
      // Only override the reference beta when we actually measured one.
      beta != null ? { equityBeta: beta } : undefined,
    );
  },

  metrics(raw, ctx) {
    return {
      volatility: realizedVol(raw.symbol, ctx),
      equityBeta: measuredBeta(raw.symbol, ctx),
    };
  },

  attributes(raw) {
    const bucket = commodityBucket(raw.symbol, raw.name);
    return {
      sector: "Commodities",
      complex: bucket,
      geography: "Global",
      currency: raw.currency,
    };
  },

  /**
   * Commodities have no cash flows, so there is nothing to value them on. Rather
   * than invent a score, we score only what a commodity contributes to a
   * PORTFOLIO: its inflation hedge and its diversification (low equity beta).
   * Confidence stays modest to reflect that.
   */
  score(raw, ctx) {
    const bucket = commodityBucket(raw.symbol, raw.name);
    const f = COMMODITY_FACTORS[bucket];
    const vol = realizedVol(raw.symbol, ctx);
    const beta = measuredBeta(raw.symbol, ctx) ?? f.equityBeta ?? null;

    const conf = coverage([vol, beta]);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    const inflationHedge = f.inflation ?? 0;
    if (inflationHedge > 0) {
      weighted += lerpScore(inflationHedge, 0, 2) * 0.4;
      used += 0.4;
      if (inflationHedge >= 1.5) why.push("Strong inflation hedge");
    }
    if (beta != null) {
      // Low equity beta is the point of owning this.
      weighted += lerpScore(Math.abs(beta), 1.0, 0) * 0.35;
      used += 0.35;
      if (Math.abs(beta) <= 0.2) why.push("Genuinely uncorrelated to equities");
    }
    if (vol != null) {
      weighted += lerpScore(vol, 60, 12) * 0.25;
      used += 0.25;
    }

    if (used === 0) return null;
    const cappedConf = Math.min(conf, 60);
    return {
      score: Math.round(shrinkToConfidence(weighted / used, cappedConf)),
      confidence: Math.round(cappedConf),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["volatility", "equityBeta"],
    secondary: [],
  },
};

registerClass(commodityAdapter);
