import { registerClass, manualValuation, fxRate, lerpScore } from "../model/adapter";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
import { toManualAsset, MANUAL_STALENESS_DAYS } from "./manual-base";
import { computeStructuredProductMetrics } from "../../manual-asset-analysis";
import type { PortfolioClassAdapter } from "../model/adapter";
import type { StructuredProductDetails } from "../../types";
import type { MarketContext, RawHolding } from "../model/types";

/** Live prices for the product's underlyings, pulled from the shared market context. */
function underlyingPrices(raw: RawHolding, ctx: MarketContext): Record<string, number | null> {
  const d = raw.meta.details as StructuredProductDetails | undefined;
  const out: Record<string, number | null> = {};
  for (const sym of d?.underlyingSymbols ?? []) {
    out[sym] = ctx.quotes.get(sym.toUpperCase())?.price ?? null;
  }
  return out;
}

/**
 * Structured products — the one `derived` valuation class.
 *
 * Its value isn't a quote and isn't a user guess: it's a FUNCTION of live
 * underlying prices plus the product's payoff terms. That is why ValuationMode has
 * a "derived" member at all, and it's the case that proves the model needs more
 * than market-vs-manual.
 *
 * The existing engine (computeStructuredProductMetrics) already computes barrier
 * distance and payoff curves — and is honest that autocallables are NOT modeled
 * (path-dependent multi-date observation logic it doesn't implement). We preserve
 * that honesty rather than papering over it.
 */
export const structuredProductAdapter: PortfolioClassAdapter = {
  id: "structured_product",
  valuationMode: "derived",
  defaultLiquidity: "t2",
  unit: "units",
  registryClass: null,
  manualStalenessDays: MANUAL_STALENESS_DAYS.structured_product,

  value(raw, ctx) {
    const d = raw.meta.details as StructuredProductDetails | undefined;
    const rate = fxRate(raw.currency, ctx);

    // A principal-protected note is worth at least its protected principal. That's
    // a hard floor derived from the terms, not an estimate — use it when the user
    // hasn't marked the position.
    if (raw.manualValue == null && d?.principalProtectionPercent != null) {
      const floor = raw.costBasis * (d.principalProtectionPercent / 100);
      return {
        mode: "derived",
        value: floor,
        valueBase: floor * rate,
        fxRate: rate,
        source: "model",
        asOf: ctx.asOf,
        stale: false,
      };
    }

    return manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.structured_product, "derived");
  },

  income(raw, valuation) {
    const d = raw.meta.details as StructuredProductDetails | undefined;
    const coupon = d?.couponRatePercent ?? null;
    if (coupon == null || coupon <= 0) return null;
    return {
      // Coupon accrues on notional (cost basis), not on current mark.
      annual: (coupon / 100) * raw.costBasis * valuation.fxRate,
      yieldPct: coupon,
      kind: "coupon",
    };
  },

  factors(raw, ctx) {
    const d = raw.meta.details as StructuredProductDetails | undefined;
    if (!d) return mergeFactors(CLASS_FACTORS.structured_product);

    const asset = toManualAsset(raw, "structured_product");
    const m = computeStructuredProductMetrics(asset, underlyingPrices(raw, ctx));

    // Equity sensitivity is CONDITIONAL on the barrier — that's the whole point of
    // the structure. Above the barrier the note behaves like a bond (you clip the
    // coupon and the equity move barely matters). Below it, the note converts into
    // the underlying and you take the full equity hit.
    //
    // Modelling this as a flat 0.5 beta — which any non-payoff-aware model must —
    // would understate the downside of a near-barrier note and overstate the
    // downside of a comfortably-cushioned one. Both errors matter.
    const dist = m.distanceToBarrierPercent;
    let equityBeta: number;
    if (dist == null) {
      equityBeta = CLASS_FACTORS.structured_product.equityBeta!;
    } else if (dist <= 0) {
      equityBeta = 1.0;               // barrier breached — it IS the underlying now
    } else if (dist < 10) {
      equityBeta = 0.85;              // knife's edge
    } else if (dist < 25) {
      equityBeta = 0.5;
    } else {
      equityBeta = 0.15;              // deep cushion — behaves like a credit-risky bond
    }

    const protectedNote = d.principalProtectionPercent != null;
    return mergeFactors(CLASS_FACTORS.structured_product, {
      equityBeta: protectedNote ? Math.min(equityBeta, 0.3) : equityBeta,
      // The issuer is a bank. You hold their credit risk, always.
      creditSpread: -1.5,
    });
  },

  metrics(raw, ctx) {
    const asset = toManualAsset(raw, "structured_product");
    const m = computeStructuredProductMetrics(asset, underlyingPrices(raw, ctx));
    const d = raw.meta.details as StructuredProductDetails | undefined;
    return {
      distanceToBarrier: m.distanceToBarrierPercent,
      worstOfLevel: m.worstOfLevelPercent,
      yearsToMaturity: m.yearsToMaturity,
      couponRate: d?.couponRatePercent ?? null,
      barrier: d?.barrierPercent ?? null,
    };
  },

  attributes(raw) {
    const d = raw.meta.details as StructuredProductDetails | undefined;
    return {
      sector: "Structured Products",
      productType: d?.productType ?? null,
      geography: null,
      currency: raw.currency,
    };
  },

  score(raw, ctx) {
    const asset = toManualAsset(raw, "structured_product");
    const m = computeStructuredProductMetrics(asset, underlyingPrices(raw, ctx));

    // The only thing worth scoring here is how much cushion is left before
    // principal is at risk. Everything else is terms, not quality.
    if (m.distanceToBarrierPercent == null) return null;

    const why: string[] = [];
    const d = m.distanceToBarrierPercent;
    if (d <= 0) why.push("BARRIER BREACHED — principal is at risk");
    else if (d < 10) why.push(`Only ${d.toFixed(1)}% above the barrier`);
    else if (d > 30) why.push(`Comfortable ${d.toFixed(0)}% cushion to the barrier`);

    if (m.payoffScenarios == null) {
      why.push("Payoff not modeled for this product type");
    }

    return {
      score: Math.round(lerpScore(d, -10, 45)),
      confidence: 75,
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["distanceToBarrier", "couponRate", "yearsToMaturity"],
    secondary: ["worstOfLevel", "barrier"],
  },
};

registerClass(structuredProductAdapter);
