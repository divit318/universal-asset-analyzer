import { registerClass, manualValuation, lerpScore, coverage, shrinkToConfidence } from "../model/adapter";
import { riskModelFor } from "./market-base";
import { toManualAsset, MANUAL_STALENESS_DAYS } from "./manual-base";
import { computePrivateMarketMetrics } from "../../manual-asset-analysis";
import type { PortfolioClassAdapter } from "../model/adapter";
import type { PrivateMarketDetails } from "../../types";

/**
 * Private markets (angel / VC / secondaries).
 *
 * Two things this class exists to stop the portfolio from believing:
 *
 * 1. THAT IT IS UNCORRELATED. A private company is levered equity with a lagged,
 *    smoothed mark. Its true beta is >1, not 0. Because its carrying value only
 *    moves at funding rounds, a naive returns-based risk model sees a flat line
 *    and concludes "no volatility" — which is why `equityBeta: 1.3` is DECLARED
 *    here rather than estimated from the (non-existent) price series.
 *
 * 2. THAT THE MARK IS CURRENT. A valuation from the last round is a fact about the
 *    past. It goes stale, and stale marks are flagged, not silently trusted.
 */
export const privateMarketAdapter: PortfolioClassAdapter = {
  id: "private_market",
  valuationMode: "derived",
  defaultLiquidity: "illiquid",
  unit: "stake",
  registryClass: null,
  manualStalenessDays: MANUAL_STALENESS_DAYS.private_market,

  value(raw, ctx) {
    const val = manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.private_market, "derived");

    // If the user gave ownership% and a round valuation but no explicit current
    // value, derive it — that's strictly better evidence than falling back to cost.
    if (raw.manualValue == null) {
      const d = raw.meta.details as PrivateMarketDetails | undefined;
      if (d?.ownershipPercent != null && d.lastRoundValuation != null) {
        const derived = (d.ownershipPercent / 100) * d.lastRoundValuation;
        return { ...val, value: derived, valueBase: derived * val.fxRate, source: "model" };
      }
    }
    return val;
  },

  // Private positions distribute nothing until an exit.
  income: () => null,

  // Same loadings as before — levered equity with no bid in a liquidity event —
  // resolved through the shared catalogue so every class is auditable in one place.
  factors(raw, ctx) {
    return riskModelFor(raw, ctx).factors;
  },

  metrics(raw) {
    const asset = toManualAsset(raw, "private_market");
    const m = computePrivateMarketMetrics(asset);
    const d = raw.meta.details as PrivateMarketDetails | undefined;
    return {
      moic: m.moic,
      annualizedReturn: m.annualizedReturnPercent,
      impliedOwnershipValue: m.impliedOwnershipValue,
      ownershipPercent: d?.ownershipPercent ?? null,
    };
  },

  attributes(raw, ctx) {
    const d = raw.meta.details as PrivateMarketDetails | undefined;
    return {
      sector: "Private Markets",
      round: d?.round ?? null,
      geography: null,
      geographyBasis: "No geography recorded in this asset's details",
      currency: raw.currency,
      riskModel: riskModelFor(raw, ctx).label,
    };
  },

  score(raw, ctx) {
    const asset = toManualAsset(raw, "private_market");
    const m = computePrivateMarketMetrics(asset);

    const inputs = [m.moic, m.annualizedReturnPercent];
    const conf = coverage(inputs);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    if (m.moic != null) {
      weighted += lerpScore(m.moic, 0.3, 5) * 0.5;
      used += 0.5;
      if (m.moic >= 3) why.push(`${m.moic.toFixed(1)}x on invested capital`);
      if (m.moic < 1) why.push(`Marked below cost (${m.moic.toFixed(2)}x)`);
    }
    if (m.annualizedReturnPercent != null) {
      weighted += lerpScore(m.annualizedReturnPercent, -20, 40) * 0.5;
      used += 0.5;
    }

    if (used === 0) return null;

    const val = manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.private_market, "derived");
    // Private marks are the weakest evidence in the portfolio. Even a fresh one is
    // a self-report with no independent verification, so confidence is capped hard.
    const discounted = Math.min(conf * (val.stale ? 0.45 : 0.65), 60);
    if (val.stale) why.push("Mark is over 18 months old — likely stale");

    // A cross-check the existing engine already knows how to do: if the user's
    // stated value and the ownership-implied value disagree materially, say so.
    if (m.impliedOwnershipValue != null && raw.manualValue != null && raw.manualValue > 0) {
      const gap = Math.abs(m.impliedOwnershipValue - raw.manualValue) / raw.manualValue;
      if (gap > 0.25) why.push("Stated value diverges >25% from ownership-implied value");
    }

    return {
      score: Math.round(shrinkToConfidence(weighted / used, discounted)),
      confidence: Math.round(discounted),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["moic", "annualizedReturn", "ownershipPercent"],
    secondary: ["impliedOwnershipValue"],
  },
};

registerClass(privateMarketAdapter);
