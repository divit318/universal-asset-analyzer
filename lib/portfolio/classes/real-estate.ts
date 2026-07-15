import { registerClass, manualValuation, lerpScore, coverage, shrinkToConfidence } from "../model/adapter";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
import { toManualAsset, MANUAL_STALENESS_DAYS } from "./manual-base";
import { computeRealEstateMetrics } from "../../manual-asset-analysis";
import type { PortfolioClassAdapter } from "../model/adapter";
import type { RealEstateDetails } from "../../types";

/**
 * Real estate — a manually-valued, illiquid, LEVERED asset.
 *
 * The leverage is the part a market-priced model cannot express and the part that
 * matters most: a $600k house with a $450k mortgage is a $150k net position with
 * ~4x exposure to property prices. Valuing it at $600k (gross) would overstate
 * both the portfolio and the user's actual equity by 4x.
 */
export const realEstateAdapter: PortfolioClassAdapter = {
  id: "real_estate",
  valuationMode: "manual",
  defaultLiquidity: "illiquid",
  unit: "units",
  registryClass: null,
  manualStalenessDays: MANUAL_STALENESS_DAYS.real_estate,

  value(raw, ctx) {
    const val = manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.real_estate);
    const d = raw.meta.details as RealEstateDetails | undefined;
    const mortgage = d?.outstandingMortgage ?? null;

    // Net equity, not gross property value. This is the user's actual position.
    if (mortgage != null && mortgage > 0) {
      const net = Math.max(val.value - mortgage, 0);
      return { ...val, value: net, valueBase: net * val.fxRate };
    }
    return val;
  },

  /**
   * "Cash invested", the same convention computeRealEstateMetrics() already uses
   * for cash-on-cash return: acquisitionCost minus the mortgage. value() above
   * returns NET equity, so the P&L comparison in model/holding.ts must be against
   * this net figure too — comparing net equity against the GROSS purchase price
   * produced a fabricated -50% P&L on a property that had genuinely appreciated
   * (a $520k property bought for $420k with a $310k mortgage nets to $210k equity;
   * $210k against a $420k gross cost basis reads as "lost half your money" when the
   * true story is a leveraged gain on the $110k actually invested).
   */
  costBasis(raw) {
    const d = raw.meta.details as RealEstateDetails | undefined;
    const mortgage = d?.outstandingMortgage ?? null;
    if (mortgage != null && mortgage > 0) {
      return Math.max(raw.costBasis - mortgage, 1);
    }
    return raw.costBasis;
  },

  income(raw, valuation) {
    const asset = toManualAsset(raw, "real_estate");
    const m = computeRealEstateMetrics(asset);
    // NOI net of debt service is the cash the property actually puts in your pocket.
    if (m.noi == null) return null;
    const net = m.noi - (m.approxAnnualDebtService ?? 0);
    if (net <= 0) return null;
    return {
      annual: net * valuation.fxRate,
      yieldPct: valuation.valueBase > 0 ? (net * valuation.fxRate / valuation.valueBase) * 100 : 0,
      kind: "rent",
    };
  },

  factors(raw) {
    const d = raw.meta.details as RealEstateDetails | undefined;
    const base = CLASS_FACTORS.real_estate;

    // Leverage amplifies every factor loading. A 75%-LTV property has ~4x the
    // sensitivity to cap rates that an unlevered one does — ignoring this is how a
    // stress test tells someone their house is safe.
    const value = raw.manualValue ?? raw.costBasis;
    const mortgage = d?.outstandingMortgage ?? 0;
    const equity = Math.max(value - mortgage, 1);
    const leverage = Math.min(value / equity, 6); // cap at 6x to keep shocks sane

    const levered: Record<string, number> = {};
    for (const [k, v] of Object.entries(base)) {
      levered[k] = v * leverage;
    }
    // The mortgage itself is a short bond position: rising rates on a FIXED
    // mortgage actually help the owner (the liability's market value falls).
    // We do not model that here — it requires the loan term we never collect —
    // so rate sensitivity stays the (conservative) levered property sensitivity.
    return mergeFactors(levered);
  },

  metrics(raw) {
    const asset = toManualAsset(raw, "real_estate");
    const m = computeRealEstateMetrics(asset);
    return {
      capRate: m.capRatePercent,
      rentalYield: m.rentalYieldPercent,
      cashOnCash: m.cashOnCashReturnPercent,
      noi: m.noi,
      appreciation: m.totalAppreciationPercent,
      debtService: m.approxAnnualDebtService,
    };
  },

  attributes(raw) {
    const d = raw.meta.details as RealEstateDetails | undefined;
    return {
      sector: "Real Estate",
      propertyType: d?.propertyType ?? null,
      geography: d?.address ? "Direct property" : null,
      currency: raw.currency,
    };
  },

  score(raw, ctx) {
    const asset = toManualAsset(raw, "real_estate");
    const m = computeRealEstateMetrics(asset);

    const inputs = [m.capRatePercent, m.cashOnCashReturnPercent];
    const conf = coverage(inputs);
    if (conf === 0) return null;

    const why: string[] = [];
    let weighted = 0;
    let used = 0;

    if (m.capRatePercent != null) {
      weighted += lerpScore(m.capRatePercent, 2, 9) * 0.5;
      used += 0.5;
      if (m.capRatePercent >= 6) why.push(`Healthy ${m.capRatePercent.toFixed(1)}% cap rate`);
      if (m.capRatePercent < 3) why.push(`Thin ${m.capRatePercent.toFixed(1)}% cap rate`);
    }
    if (m.cashOnCashReturnPercent != null) {
      weighted += lerpScore(m.cashOnCashReturnPercent, -5, 12) * 0.5;
      used += 0.5;
      if (m.cashOnCashReturnPercent < 0) why.push("Negative cash-on-cash — the property costs you money to hold");
    }

    if (used === 0) return null;

    // A self-reported valuation is weaker evidence than a market quote, and a
    // STALE self-reported valuation is weaker still. Discount accordingly rather
    // than presenting it with the confidence of a live price.
    const val = manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.real_estate);
    const discounted = val.stale ? conf * 0.6 : conf * 0.85;
    if (val.stale) why.push("Valuation is over a year old — refresh it");

    return {
      score: Math.round(shrinkToConfidence(weighted / used, discounted)),
      confidence: Math.round(discounted),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["capRate", "cashOnCash", "rentalYield"],
    secondary: ["noi", "appreciation", "debtService"],
  },
};

registerClass(realEstateAdapter);
