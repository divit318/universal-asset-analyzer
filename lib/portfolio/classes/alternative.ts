import { registerClass, manualValuation, lerpScore, coverage, shrinkToConfidence } from "../model/adapter";
import { CLASS_FACTORS, mergeFactors } from "./reference/factor-sensitivities";
import { toManualAsset, MANUAL_STALENESS_DAYS } from "./manual-base";
import { computeAlternativeMetrics } from "../../manual-asset-analysis";
import type { PortfolioClassAdapter } from "../model/adapter";
import type { AlternativeDetails } from "../../types";

/**
 * Alternatives — art, wine, watches, collectibles.
 *
 * These produce no income, have no market price, and their "value" is whatever the
 * owner last believed. The honest analytics are appreciation and CAGR against a
 * self-reported mark, and the honest confidence is low. This adapter's job is
 * mostly to make sure they COUNT toward the portfolio's total, its illiquidity, and
 * its concentration — which today they don't, because Portfolio can't see them at all.
 */
export const alternativeAdapter: PortfolioClassAdapter = {
  id: "alternative",
  valuationMode: "manual",
  defaultLiquidity: "illiquid",
  unit: "units",
  registryClass: null,
  manualStalenessDays: MANUAL_STALENESS_DAYS.alternative,

  value: (raw, ctx) => manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.alternative),

  income: () => null,

  factors() {
    return mergeFactors(CLASS_FACTORS.alternative);
  },

  metrics(raw) {
    const asset = toManualAsset(raw, "alternative");
    const m = computeAlternativeMetrics(asset);
    return {
      appreciation: m.appreciationPercent,
      cagr: m.cagrPercent,
    };
  },

  attributes(raw) {
    const d = raw.meta.details as AlternativeDetails | undefined;
    return {
      sector: "Alternatives",
      subcategory: d?.subcategory ?? null,
      geography: null,
      currency: raw.currency,
    };
  },

  score(raw, ctx) {
    const asset = toManualAsset(raw, "alternative");
    const m = computeAlternativeMetrics(asset);

    const inputs = [m.cagrPercent, m.appreciationPercent];
    const conf = coverage(inputs);
    if (conf === 0) return null;

    let weighted = 0;
    let used = 0;
    const why: string[] = [];

    if (m.cagrPercent != null) {
      weighted += lerpScore(m.cagrPercent, -10, 20) * 0.6;
      used += 0.6;
      if (m.cagrPercent >= 10) why.push(`Compounding at ${m.cagrPercent.toFixed(1)}%/yr`);
    }
    if (m.appreciationPercent != null) {
      weighted += lerpScore(m.appreciationPercent, -30, 150) * 0.4;
      used += 0.4;
    }

    if (used === 0) return null;

    const val = manualValuation(raw, ctx, MANUAL_STALENESS_DAYS.alternative);
    // No market to verify against, ever. Confidence is structurally capped low —
    // this is a property of the asset class, not a data gap we might one day fill.
    const discounted = Math.min(conf * (val.stale ? 0.4 : 0.6), 50);
    why.push("Self-reported valuation — no market price to verify against");

    return {
      score: Math.round(shrinkToConfidence(weighted / used, discounted)),
      confidence: Math.round(discounted),
      why: why.slice(0, 3),
    };
  },

  row: {
    primary: ["appreciation", "cagr"],
    secondary: [],
  },
};

registerClass(alternativeAdapter);
