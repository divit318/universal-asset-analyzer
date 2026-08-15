/**
 * Universal Allocation Engine.
 *
 * Allocation is the thing the Portfolio is actually ABOUT, and the current engine
 * has exactly one view of it: GICS sector. That view cannot express "I am 70%
 * equities", "I am 100% USD", or "I can't sell 40% of this portfolio for a year" —
 * the three facts that dominate almost every real portfolio decision.
 *
 * Every breakdown here is the same fold over the same normalized field, which is
 * why adding a new one (by tax treatment, by issuer, by vintage) is a three-line
 * change rather than a new subsystem.
 */

import { LIQUIDITY_ORDER, PORTFOLIO_CLASS_LABEL } from "../model/types";
import type {
  Factor,
  Holding,
  Liquidity,
  PortfolioAssetClass,
} from "../model/types";
import { FACTORS, FACTOR_LABEL } from "../model/types";
import { CONCENTRATION_HYSTERESIS_PCT } from "../policy";
import { effectiveCapPct, type InvestorPolicy } from "../alignment/policy";

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  weight: number;
  count: number;
  /** Confidence-weighted mean score of the slice's holdings; null if none are scored. */
  avgScore: number | null;
  /**
   * The holdings this slice aggregates, by Holding.id, ordered by value
   * descending. This is what makes every allocation row a drill-down rather
   * than a dead number — "Technology 39.9%" must be able to answer "which
   * holdings?" without leaving the dashboard. IDs rather than embedded
   * objects: the report already ships `holdings`, so the UI joins against the
   * one copy instead of the payload carrying every holding five more times.
   *
   * Optional so hand-built test fixtures need not fabricate it; every view
   * produced by `computeAllocation` populates it.
   */
  holdingIds?: string[];
}

export interface AllocationView {
  /** What this breakdown is keyed on — "assetClass", "sector", … */
  dimension: string;
  slices: AllocationSlice[];
  /**
   * Herfindahl-Hirschman Index over this dimension's weights, 0-10000.
   * <1500 = diversified, >2500 = concentrated.
   */
  hhi: number;
  /**
   * Share of portfolio value that could NOT be classified on this dimension.
   * Surfaced rather than silently lumped into "Unknown" — a sector breakdown that
   * is 60% unclassified is not a sector breakdown, and the UI must be able to say so.
   */
  unclassifiedPct: number;
  /**
   * WHICH holdings the unclassified share is made of, ordered by value
   * descending. An unexplained "46.2% unclassified" row is the single most
   * distrust-inducing thing an allocation view can show; with the IDs the UI
   * can open it and show each holding with its per-holding reason
   * (`attributes.geographyBasis` etc). Optional for fixtures, always populated
   * by `computeAllocation`.
   */
  unclassifiedIds?: string[];
}

export interface PortfolioAllocation {
  byAssetClass: AllocationView;
  bySector: AllocationView;
  byGeography: AllocationView;
  byCurrency: AllocationView;
  byLiquidity: AllocationView;
  /** Dollar-weighted net exposure to each macro factor. */
  byFactor: { factor: Factor; label: string; exposure: number }[];
}

/* -------------------------------------------------------------------------- */

export function computeHHI(weights: number[]): number {
  return weights.reduce((s, w) => s + (w / 100) ** 2, 0) * 10000;
}

/**
 * Confidence-weighted mean of holding scores.
 *
 * A plain average would let a 90-score-at-15%-confidence holding drag a slice's
 * quality up as hard as a 90-at-95%. Weighting by (value × confidence) means
 * thinly-evidenced scores contribute in proportion to how much we actually know —
 * and a slice where nothing is scored returns null, not 50.
 */
function confidenceWeightedScore(holdings: Holding[]): number | null {
  let num = 0;
  let den = 0;
  for (const h of holdings) {
    if (!h.score) continue;
    const w = h.valuation.valueBase * (h.score.confidence / 100);
    num += h.score.score * w;
    den += w;
  }
  return den > 0 ? Math.round(num / den) : null;
}

/** Generic fold. Every allocation view in the app comes from this one function. */
function groupBy(
  holdings: Holding[],
  totalValue: number,
  dimension: string,
  keyOf: (h: Holding) => string | null,
  labelOf: (key: string) => string = (k) => k,
): AllocationView {
  const groups = new Map<string, Holding[]>();
  let unclassified = 0;
  const unclassifiedHoldings: Holding[] = [];

  for (const h of holdings) {
    const key = keyOf(h);
    if (key == null || key === "") {
      unclassified += h.valuation.valueBase;
      unclassifiedHoldings.push(h);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }

  const byValueDesc = (a: Holding, b: Holding) => b.valuation.valueBase - a.valuation.valueBase;

  const slices: AllocationSlice[] = [...groups.entries()]
    .map(([key, hs]) => {
      const value = hs.reduce((s, h) => s + h.valuation.valueBase, 0);
      return {
        key,
        label: labelOf(key),
        value,
        weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
        count: hs.length,
        avgScore: confidenceWeightedScore(hs),
        holdingIds: hs.slice().sort(byValueDesc).map((h) => h.id),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  return {
    dimension,
    slices,
    hhi: Math.round(computeHHI(slices.map((s) => s.weight))),
    unclassifiedPct: totalValue > 0 ? (unclassified / totalValue) * 100 : 0,
    unclassifiedIds: unclassifiedHoldings.sort(byValueDesc).map((h) => h.id),
  };
}

/* -------------------------------------------------------------------------- */

export function computeAllocation(holdings: Holding[], totalValue: number): PortfolioAllocation {
  const byAssetClass = groupBy(
    holdings,
    totalValue,
    "assetClass",
    (h) => h.assetClass,
    (k) => PORTFOLIO_CLASS_LABEL[k as PortfolioAssetClass] ?? k,
  );

  const bySector = groupBy(holdings, totalValue, "sector", (h) => h.attributes.sector ?? null);

  const byGeography = groupBy(holdings, totalValue, "geography", (h) => h.attributes.geography ?? null);

  // Currency comes off the holding itself, not an attribute — it is always known,
  // so this view is never unclassified. FX risk is not an optional extra.
  const byCurrency = groupBy(holdings, totalValue, "currency", (h) => h.currency.toUpperCase());

  const byLiquidity = groupBy(
    holdings,
    totalValue,
    "liquidity",
    (h) => h.liquidity,
    (k) => ({ t0: "Same day", t1: "Days", t2: "Weeks", illiquid: "Illiquid" })[k as Liquidity] ?? k,
  );
  // Keep liquidity in its natural order (most→least liquid) rather than by weight —
  // a liquidity ladder read out of order is useless.
  byLiquidity.slices.sort(
    (a, b) => LIQUIDITY_ORDER.indexOf(a.key as Liquidity) - LIQUIDITY_ORDER.indexOf(b.key as Liquidity),
  );

  const byFactor = computeFactorExposure(holdings, totalValue);

  return { byAssetClass, bySector, byGeography, byCurrency, byLiquidity, byFactor };
}

/**
 * Dollar-weighted net exposure to each macro factor.
 *
 * This is the replacement for the old SECTOR_FACTOR_MAP, which keyed off GICS
 * sector and therefore assigned *zero* factor exposure to every bond, every
 * commodity and every crypto holding — they silently contributed nothing to the
 * portfolio's factor picture. A portfolio that was 50% long-duration Treasuries
 * showed no interest-rate exposure at all.
 */
export function computeFactorExposure(
  holdings: Holding[],
  totalValue: number,
): { factor: Factor; label: string; exposure: number }[] {
  if (totalValue <= 0) return [];

  return FACTORS.map((factor) => {
    let exposure = 0;
    for (const h of holdings) {
      const sensitivity = h.factors[factor];
      if (sensitivity == null) continue;
      exposure += sensitivity * (h.valuation.valueBase / totalValue);
    }
    return {
      factor,
      label: FACTOR_LABEL[factor],
      exposure: Math.round(exposure * 100) / 100,
    };
  }).filter((f) => Math.abs(f.exposure) > 0.001);
}

/**
 * The per-holding decomposition of ONE factor's net exposure — the same
 * `sensitivity × weight` terms `computeFactorExposure` sums, returned
 * individually so a UI can answer "which holdings make this −0.80?". Kept here,
 * beside the aggregate, so the two can never use different arithmetic.
 */
export function factorContributors(
  holdings: Holding[],
  factor: Factor,
  limit = 3,
): { name: string; symbol: string | null; contribution: number }[] {
  return holdings
    .map((h) => ({
      name: h.name,
      symbol: h.symbol ?? null,
      contribution: (h.factors[factor] ?? 0) * (h.weight / 100),
    }))
    .filter((c) => Math.abs(c.contribution) >= 0.005)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, limit)
    .map((c) => ({ ...c, contribution: Math.round(c.contribution * 100) / 100 }));
}

/* -------------------------------------------------------------------------- */
/* Concentration                                                               */
/* -------------------------------------------------------------------------- */

export interface ConcentrationFinding {
  type: "holding" | "assetClass" | "sector" | "geography" | "currency" | "liquidity";
  label: string;
  pct: number;
  severity: "high" | "medium";
  message: string;
}

/**
 * Concentration is now checked on FIVE dimensions, not two.
 *
 * The old engine warned on single-position and single-sector weight only. It would
 * pass a portfolio that is 100% USD, 100% equities, and 45% illiquid without a word
 * — three of the most common ways a real portfolio actually gets hurt.
 *
 * HOLDING-level flags are policy-relative when a policy is provided: a position
 * flags at the investor's own effective cap (their general cap, or their named
 * exception for that symbol), not at a universal 15/25%. The page header saying
 * "3 concentration flags" while the Alignment panel below it says "inside your
 * caps" was the two-rulers bug in miniature. Class/sector/currency/liquidity
 * flags keep structural fact-thresholds — the policy has no numbers for those,
 * and inventing policy semantics the editor never showed is the old bug.
 */
export function computeConcentration(
  holdings: Holding[],
  allocation: PortfolioAllocation,
  policy?: InvestorPolicy,
): ConcentrationFinding[] {
  const out: ConcentrationFinding[] = [];

  for (const h of holdings) {
    // With a policy: flag only above the holding's OWN cap (medium inside the
    // hysteresis band, high beyond it). Without one: the historical 15/25
    // fact-thresholds, unchanged for callers that have no policy in scope.
    const cap = policy ? effectiveCapPct(policy, h.symbol) : null;
    const mediumAt = cap ?? 15;
    const highAt = cap != null ? cap + CONCENTRATION_HYSTERESIS_PCT : 25;
    if (h.weight <= mediumAt) continue;
    const capText = cap != null ? ` against your ${cap}% ${policy!.exceptions.some((e) => h.symbol && e.symbol === h.symbol.toUpperCase()) ? `exception for ${h.symbol}` : "cap"}` : "";
    if (h.weight > highAt) {
      out.push({
        type: "holding",
        label: h.symbol ?? h.name,
        pct: h.weight,
        severity: "high",
        message: `${h.symbol ?? h.name} is ${h.weight.toFixed(1)}% of the portfolio${capText} — single-asset concentration risk.`,
      });
    } else {
      out.push({
        type: "holding",
        label: h.symbol ?? h.name,
        pct: h.weight,
        severity: "medium",
        message: `${h.symbol ?? h.name} is ${h.weight.toFixed(1)}% of the portfolio${capText}.`,
      });
    }
  }

  // (`slices.length > 0` used to be ANDed in here — vacuously true, since we are
  // iterating those very slices.)
  for (const s of allocation.byAssetClass.slices) {
    if (s.weight >= 80) {
      out.push({
        type: "assetClass",
        label: s.label,
        pct: s.weight,
        severity: "high",
        message: `${s.weight.toFixed(0)}% of the portfolio is in ${s.label}. This is a single-asset-class bet, whatever the diversification within it.`,
      });
    }
  }

  for (const s of allocation.bySector.slices) {
    if (s.weight >= 40) {
      out.push({
        type: "sector",
        label: s.label,
        pct: s.weight,
        severity: s.weight >= 50 ? "high" : "medium",
        message: `${s.label} is ${s.weight.toFixed(1)}% of the portfolio — sector concentration risk.`,
      });
    }
  }

  // Home-currency bias: invisible to the old model, which had no currency concept.
  //
  // The `slices.length === 1` guard used to make this fire at EXACTLY 100% only —
  // currency is never unclassified, so a single slice always weighs 100. A book
  // that was 96% USD and 4% EUR therefore got no warning at all, despite having
  // essentially the same single-currency exposure as one at 100%. The threshold
  // is the number that matters; the slice count is not.
  for (const s of allocation.byCurrency.slices) {
    if (s.weight >= 90) {
      const rest = 100 - s.weight;
      // Phrasing follows the ROUNDED figures, so the sentence can never read
      // "100% X exposure. The remaining 0% is too small…" — which is what a
      // 99.9%/0.1% split produced when the two numbers were rounded
      // independently. If the remainder does not survive rounding, there is
      // effectively no second currency and we say only that.
      const restRounded = Number(rest.toFixed(1));
      out.push({
        type: "currency",
        label: s.label,
        pct: s.weight,
        severity: "medium",
        message:
          restRounded < 0.1
            ? `Effectively 100% ${s.label} exposure. The portfolio has no currency diversification — a sustained ${s.label} decline hits everything at once.`
            : `${s.weight.toFixed(1)}% ${s.label} exposure. The remaining ${restRounded.toFixed(1)}% is too small to diversify currency risk — a sustained ${s.label} decline hits nearly everything at once.`,
      });
    }
  }

  const illiquid = allocation.byLiquidity.slices
    .filter((s) => s.key === "illiquid" || s.key === "t2")
    .reduce((sum, s) => sum + s.weight, 0);
  if (illiquid >= 30) {
    out.push({
      type: "liquidity",
      label: "Illiquid holdings",
      pct: illiquid,
      severity: illiquid >= 50 ? "high" : "medium",
      message: `${illiquid.toFixed(0)}% of the portfolio cannot be sold quickly. In a drawdown you can only rebalance with the other ${(100 - illiquid).toFixed(0)}%.`,
    });
  }

  const order = { high: 0, medium: 1 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || b.pct - a.pct);
}
