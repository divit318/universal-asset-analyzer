/**
 * Universal Portfolio Health Score.
 *
 * ── The bug this replaces ─────────────────────────────────────────────────────
 *
 * The old health score had 8 dimensions, and 5 of them (Quality, Growth, Valuation,
 * Financial Health, and partly Momentum) read `ScoreResult.buckets` — an
 * equity-only structure. For any non-equity holding those functions hit their
 * `if (scored.length === 0) return { score: 50, ... }` branch.
 *
 * So a 100%-bond portfolio scored 50 on Quality, 50 on Growth, 50 on Valuation and
 * 50 on Financial Health — not because it was mediocre, but because the engine had
 * nothing to say and said "average" anyway. Those fabricated 50s were then
 * weighted into a total presented to the user as a measurement.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *
 * Dimensions ABSTAIN. An abstaining dimension contributes nothing and its weight is
 * REDISTRIBUTED across the dimensions that can actually speak — so a bond portfolio
 * is graded on allocation, liquidity, duration, income and diversification, which is
 * what it should be graded on, and is not silently dragged to the midpoint by four
 * questions that don't apply to it.
 *
 * This is the same rule the screener's ranking already uses ("missing factors
 * redistribute weight, never score 0") and the same lesson as the fit-scorer's
 * "everything scores 73" bug. It is now applied to the portfolio.
 */

import type { Holding } from "../model/types";
import type { PortfolioAllocation } from "./allocation";
import type { UniversalRisk } from "./risk";

export type HealthGrade = "A" | "B" | "C" | "D" | "F";
export type ScoreTrend = "strong" | "good" | "neutral" | "weak" | "poor";

export interface HealthDimension {
  name: string;
  /** null = abstained: this dimension has no honest basis to score this portfolio. */
  score: number | null;
  /** Nominal weight. Redistributed among non-abstaining dimensions. */
  weight: number;
  /** Weight actually applied after redistribution. */
  effectiveWeight: number;
  trend: ScoreTrend | null;
  explanation: string;
}

export interface HealthScore {
  total: number;
  grade: HealthGrade;
  dimensions: HealthDimension[];
  summary: string;
  /** How much of the nominal weight was actually scoreable. */
  coveragePct: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function trendOf(score: number): ScoreTrend {
  if (score >= 78) return "strong";
  if (score >= 62) return "good";
  if (score >= 45) return "neutral";
  if (score >= 28) return "weak";
  return "poor";
}

function gradeOf(score: number): HealthGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** A dimension that has something to say. */
function dim(name: string, score: number, weight: number, explanation: string): HealthDimension {
  const s = Math.round(clamp(score));
  return { name, score: s, weight, effectiveWeight: 0, trend: trendOf(s), explanation };
}

/** A dimension that does not apply to this portfolio. Its weight goes to the others. */
function abstain(name: string, weight: number, explanation: string): HealthDimension {
  return { name, score: null, weight, effectiveWeight: 0, trend: null, explanation };
}

/* -------------------------------------------------------------------------- */
/* Dimensions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Asset allocation — the dimension the old score didn't have at all, and the one
 * that matters most. A portfolio holding one asset class is making a single bet,
 * however many names are inside it.
 */
function assetAllocation(alloc: PortfolioAllocation): HealthDimension {
  const slices = alloc.byAssetClass.slices;
  if (slices.length === 0) return abstain("Asset Allocation", 0.16, "No holdings.");

  const top = slices[0];
  const count = slices.length;

  // 1 class = 20, 2 = 45, 3 = 65, 4 = 80, 5+ = 90+
  const breadth = clamp([0, 20, 45, 65, 80, 90, 95][Math.min(count, 6)] ?? 95);
  // Penalize a dominant class.
  const balance = clamp(100 - Math.max(0, top.weight - 40) * 1.6);

  const score = breadth * 0.5 + balance * 0.5;
  const explanation =
    count === 1
      ? `100% in ${top.label}. This is a single-asset-class portfolio — diversification within it does not change that.`
      : `${count} asset classes. Largest: ${top.label} at ${top.weight.toFixed(0)}%.`;

  return dim("Asset Allocation", score, 0.16, explanation);
}

function diversification(holdings: Holding[], alloc: PortfolioAllocation): HealthDimension {
  const n = holdings.length;
  if (n === 0) return abstain("Diversification", 0.10, "No holdings.");

  const posScore = clamp(n * 7);
  const sectorScore = clamp(alloc.bySector.slices.length * 12);
  const hhiScore = clamp(100 - (alloc.byAssetClass.hhi - 1500) / 50);

  const score = posScore * 0.3 + sectorScore * 0.3 + hhiScore * 0.4;
  return dim(
    "Diversification",
    score,
    0.10,
    `${n} holdings across ${alloc.bySector.slices.length} sectors and ${alloc.byAssetClass.slices.length} asset classes.`,
  );
}

function concentration(risk: UniversalRisk): HealthDimension {
  const posScore = clamp(100 - (risk.topHoldingWeight - 8) * 3);
  const classScore = clamp(100 - (risk.topAssetClassWeight - 40) * 1.6);
  const score = posScore * 0.5 + classScore * 0.5;

  const issues: string[] = [];
  if (risk.topHoldingWeight > 20) issues.push(`${risk.topHoldingWeight.toFixed(0)}% in one holding`);
  if (risk.topAssetClassWeight > 75) issues.push(`${risk.topAssetClassWeight.toFixed(0)}% in one asset class`);

  return dim(
    "Concentration",
    score,
    0.09,
    issues.length ? `Concentrated: ${issues.join("; ")}.` : "Position and class sizes are reasonable.",
  );
}

/**
 * Liquidity — invisible to the old model, which had no liquidity concept.
 * The question it answers: in a drawdown, how much of this portfolio can you
 * actually act on?
 */
function liquidity(risk: UniversalRisk): HealthDimension {
  const score = clamp(100 - risk.illiquidPct * 1.4);
  return dim(
    "Liquidity",
    score,
    0.09,
    risk.illiquidPct > 5
      ? `${risk.illiquidPct.toFixed(0)}% cannot be sold quickly. Rebalancing and emergencies can only draw on the liquid ${(100 - risk.illiquidPct).toFixed(0)}%.`
      : "Portfolio is highly liquid.",
  );
}

/**
 * Income — now counts coupons, rent, staking and interest, not just dividends.
 * The old dimension read `dividendYield` alone, scoring a Treasury ladder, a rental
 * property and a money-market position at exactly zero.
 */
function income(holdings: Holding[], totalValue: number): HealthDimension {
  if (totalValue <= 0) return abstain("Income", 0.08, "No holdings.");

  const annual = holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const yieldPct = (annual / totalValue) * 100;
  const kinds = [...new Set(holdings.filter((h) => h.income).map((h) => h.income!.kind))];

  const score = clamp(yieldPct * 20);  // 5% → 100
  return dim(
    "Income",
    score,
    0.08,
    annual > 0
      ? `${yieldPct.toFixed(2)}% portfolio yield (${kinds.join(", ")}).`
      : "No income generated. Portfolio is entirely growth/appreciation dependent.",
  );
}

/**
 * Inflation protection — the dimension that makes cash's true cost visible.
 * A 40%-cash, 60%-long-bond portfolio has strongly NEGATIVE inflation sensitivity
 * and should be told so.
 */
function inflationProtection(risk: UniversalRisk): HealthDimension {
  if (risk.inflationSensitivity == null) {
    return abstain("Inflation Protection", 0.08, "No inflation-sensitive exposures to assess.");
  }
  const s = risk.inflationSensitivity;
  // -2 (badly hurt) → 0; +2 (well hedged) → 100.
  const score = clamp(50 + s * 25);
  return dim(
    "Inflation Protection",
    score,
    0.08,
    s < -0.5
      ? `A +1pp inflation surprise costs roughly ${Math.abs(s).toFixed(1)}% of portfolio value. Little real-asset protection.`
      : s > 0.5
        ? `Positively exposed to inflation (+${s.toFixed(1)}% per 1pp) via real assets.`
        : "Roughly inflation-neutral.",
  );
}

function currencyDiversification(risk: UniversalRisk, alloc: PortfolioAllocation): HealthDimension {
  const count = alloc.byCurrency.slices.length;
  if (count === 0) return abstain("Currency Diversification", 0.05, "No holdings.");

  // Some foreign exposure is healthy; being 100% single-currency is a real,
  // unhedged bet on that currency's purchasing power.
  const score = clamp(35 + risk.foreignCurrencyPct * 2.2);
  return dim(
    "Currency Diversification",
    score,
    0.05,
    count === 1
      ? `Entirely ${alloc.byCurrency.slices[0].label}-denominated. No currency diversification.`
      : `${risk.foreignCurrencyPct.toFixed(0)}% in non-base currencies across ${count} currencies.`,
  );
}

function geographic(alloc: PortfolioAllocation): HealthDimension {
  const view = alloc.byGeography;
  // If we can't classify most of the portfolio geographically, say so rather than
  // grading it on a 30%-complete picture.
  if (view.unclassifiedPct > 60 || view.slices.length === 0) {
    return abstain(
      "Geographic Diversification",
      0.06,
      `Geography unknown for ${view.unclassifiedPct.toFixed(0)}% of the portfolio — not enough to assess.`,
    );
  }
  const top = view.slices[0];
  const score = clamp(100 - Math.max(0, top.weight - 45) * 1.5);
  return dim(
    "Geographic Diversification",
    score,
    0.06,
    `${view.slices.length} regions. Largest: ${top.label} at ${top.weight.toFixed(0)}%.`,
  );
}

function correlationDim(risk: UniversalRisk): HealthDimension {
  const c = risk.correlation;
  if (!c) return abstain("Correlation", 0.06, "Not enough price history to compute correlations.");

  // avg r of 0 → 100; 0.9 → ~10.
  const score = clamp(100 - c.avgCorrelation * 100);
  const note = c.excluded.length > 0
    ? ` ${c.excluded.length} illiquid holding(s) excluded — they have no return series and are NOT assumed uncorrelated.`
    : "";

  return dim(
    "Correlation",
    score,
    0.06,
    `Average pairwise correlation ${c.avgCorrelation.toFixed(2)}.${c.highPairs.length ? ` ${c.highPairs.length} highly-correlated pair(s).` : ""}${note}`,
  );
}

function drawdownDim(risk: UniversalRisk): HealthDimension {
  if (risk.maxDrawdown == null) {
    return abstain("Expected Drawdown", 0.07, "Not enough price history.");
  }
  const dd = Math.abs(risk.maxDrawdown);
  const score = clamp(100 - dd * 2.2);
  return dim(
    "Expected Drawdown",
    score,
    0.07,
    `Worst observed drawdown ${dd.toFixed(1)}%${risk.cvar95Pct != null ? `; expected loss on a bad day (CVaR 95) ${risk.cvar95Pct.toFixed(2)}%` : ""}.`,
  );
}

/**
 * Cash management. Both directions are failures: no cash means no buffer and forced
 * selling; too much cash is a slow, guaranteed loss to inflation. The old engine
 * could express neither, because it could not represent cash.
 */
function cashManagement(alloc: PortfolioAllocation): HealthDimension {
  const cash = alloc.byAssetClass.slices.find((s) => s.key === "cash");
  const pct = cash?.weight ?? 0;

  // Target band ~3-15%.
  let score: number;
  let explanation: string;
  if (pct < 1) {
    score = 30;
    explanation = "Effectively no cash buffer. Any unexpected need forces a sale at whatever price the market offers.";
  } else if (pct < 3) {
    score = 60;
    explanation = `${pct.toFixed(1)}% cash — a thin buffer.`;
  } else if (pct <= 15) {
    score = 95;
    explanation = `${pct.toFixed(1)}% cash — a healthy buffer without excessive drag.`;
  } else if (pct <= 30) {
    score = 65;
    explanation = `${pct.toFixed(0)}% cash. Substantial dry powder, but it is losing purchasing power to inflation.`;
  } else {
    score = 35;
    explanation = `${pct.toFixed(0)}% cash. This is a large, deliberate-looking bet on holding cash — it guarantees a real loss if inflation persists.`;
  }

  return dim("Cash Management", score, 0.06, explanation);
}

/**
 * Holding quality — the confidence-weighted mean of what each class's OWN scorer
 * said. A bond is judged as a bond, a REIT as a REIT.
 *
 * Abstains when nothing in the portfolio could be scored, instead of returning 50.
 */
function quality(holdings: Holding[]): HealthDimension {
  const scored = holdings.filter((h) => h.score != null);
  if (scored.length === 0) {
    return abstain("Holding Quality", 0.09, "No holdings could be scored with the available data.");
  }

  let num = 0;
  let den = 0;
  for (const h of scored) {
    const w = h.valuation.valueBase * (h.score!.confidence / 100);
    num += h.score!.score * w;
    den += w;
  }
  if (den === 0) {
    return abstain("Holding Quality", 0.09, "Scores available but all at zero confidence.");
  }

  const score = num / den;
  const coveredPct = (scored.reduce((s, h) => s + h.valuation.valueBase, 0)
    / Math.max(holdings.reduce((s, h) => s + h.valuation.valueBase, 0), 1)) * 100;

  return dim(
    "Holding Quality",
    score,
    0.09,
    `Confidence-weighted across ${scored.length} of ${holdings.length} holdings (${coveredPct.toFixed(0)}% of value). Each asset class scored on its own metrics.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Compose                                                                     */
/* -------------------------------------------------------------------------- */

export function computeHealth(
  holdings: Holding[],
  totalValue: number,
  alloc: PortfolioAllocation,
  risk: UniversalRisk,
): HealthScore {
  if (holdings.length === 0) {
    return { total: 0, grade: "F", dimensions: [], summary: "No holdings.", coveragePct: 0 };
  }

  const dimensions: HealthDimension[] = [
    assetAllocation(alloc),
    diversification(holdings, alloc),
    concentration(risk),
    liquidity(risk),
    income(holdings, totalValue),
    inflationProtection(risk),
    currencyDiversification(risk, alloc),
    geographic(alloc),
    correlationDim(risk),
    drawdownDim(risk),
    cashManagement(alloc),
    quality(holdings),
  ];

  // Redistribute abstained weight proportionally across the dimensions that scored.
  const scoreable = dimensions.filter((d) => d.score != null);
  const scoreableWeight = scoreable.reduce((s, d) => s + d.weight, 0);
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);

  if (scoreableWeight === 0) {
    return {
      total: 0,
      grade: "F",
      dimensions,
      summary: "Not enough data to score this portfolio.",
      coveragePct: 0,
    };
  }

  for (const d of dimensions) {
    d.effectiveWeight = d.score != null ? d.weight / scoreableWeight : 0;
  }

  const total = Math.round(
    dimensions.reduce((s, d) => s + (d.score ?? 0) * d.effectiveWeight, 0),
  );
  const g = gradeOf(total);

  const best = scoreable.reduce((a, b) => (a.score! > b.score! ? a : b));
  const worst = scoreable.reduce((a, b) => (a.score! < b.score! ? a : b));
  const abstained = dimensions.filter((d) => d.score == null);

  const summary =
    `${g === "A" || g === "B" ? "Strong" : g === "C" ? "Solid" : "Weak"} portfolio. ` +
    `Best: ${best.name} (${best.score}/100). Needs work: ${worst.name} (${worst.score}/100).` +
    (abstained.length > 0
      ? ` ${abstained.length} dimension(s) not applicable and excluded rather than scored neutral.`
      : "");

  return {
    total,
    grade: g,
    dimensions,
    summary,
    coveragePct: Math.round((scoreableWeight / totalWeight) * 100),
  };
}
