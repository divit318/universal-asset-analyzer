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
 *
 * ── Analytics audit (2026-07-16) ─────────────────────────────────────────────
 *
 * Abstention was the first correctness pass; it was not sufficient. A full audit
 * of every dimension found scores that executed cleanly but were economically
 * indefensible. Each is now fixed at the point of calculation, and every fix is
 * documented inline where it lives. In summary:
 *
 *  1. PARTIAL COVERAGE IS NOT FULL CONFIDENCE. Abstention was all-or-nothing: a
 *     dimension either scored at full weight or vanished. But a correlation figure
 *     computed on 2 of 19 holdings, or a drawdown computed on the 60% of the book
 *     that has a price series, is not a full-confidence measurement — it is a
 *     partial one, and presenting it at full weight overstates what we know.
 *     Dimensions now carry a `coverage` in [0,1]; effective weight is
 *     weight × coverage, renormalized. Abstention is just coverage = 0. This
 *     generalizes the engine's own honesty rule from binary to continuous.
 *
 *  2. NO FLOOR COLLISIONS. The old Inflation Protection mapping (50 + s·25) put a
 *     plain equity portfolio, a plain bond portfolio AND a classic 60/40 all at
 *     EXACTLY 0/100 — three different, common portfolios pinned to the same floor,
 *     indistinguishable from catastrophe, while any real-asset tilt pinned at 100.
 *     The dimension had no resolution and produced an alarmist "0/100" headline on
 *     healthy portfolios. Remapped to realistic economic endpoints so conventional
 *     portfolios land in a graded band, not on the floor.
 *
 *  3. NO GAMED PERFECT SCORES / NO DILUTION. Geographic Diversification returned a
 *     literal 100/100 whenever the single largest region was under 45% — ignoring
 *     the rest of the distribution — and measured that largest region as a share of
 *     the WHOLE portfolio, so unclassified holdings silently diluted it and made a
 *     concentrated book look diverse. Now a proper Simpson diversity index over the
 *     CLASSIFIED portion, which cannot reach 100 and cannot be diluted.
 *
 *  4. NO DOUBLE COUNTING / NO EDGE-CASE GAMING. Diversification counted asset-class
 *     HHI (already the job of Asset Allocation and Concentration) and rewarded raw
 *     holding COUNT — so fourteen $1 tokens maxed it. Now an effective-holdings
 *     measure (robust to token positions) plus a sector-diversity term that only
 *     engages for the sector-classified share (a Treasury ladder is no longer
 *     penalized for "having no sectors").
 *
 *  5. NO DISCONTINUITIES. Cash Management was a step function — 14.9% cash scored
 *     95, 15.1% scored 65, a 30-point cliff at an arbitrary boundary. Now a
 *     continuous piecewise-linear curve: two nearly identical portfolios get nearly
 *     identical scores.
 *
 *  6. NO YIELD-CHASING. Income scaled linearly to 5% → 100, encoding "a healthy
 *     portfolio yields 5%", which rewarded a junk-bond book maximally and punished
 *     a deliberate total-return mandate. Now a concave (saturating) curve:
 *     diminishing marginal reward, so income quantity is credited without pretending
 *     more is always better.
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
  /**
   * The same score before integer rounding. `score` is what a human reads; this
   * is what a comparison between two near-identical portfolios must use.
   * Rounding to an integer quantizes away every change smaller than half a
   * point, and a single position in a large book is almost always smaller than
   * that — which silently reduced simulated buy/sell deltas to exactly zero.
   */
  scoreExact: number | null;
  /** Nominal weight. Redistributed among non-abstaining dimensions. */
  weight: number;
  /**
   * Fraction of this dimension's evidence that was actually available, in [0,1].
   * 1 = the score rests on the whole portfolio; 0.5 = it rests on half the value
   * (the rest could not be measured for this dimension). Effective weight is
   * scaled by this before redistribution, so a thinly-evidenced dimension counts
   * for less rather than being presented with the same authority as a complete one.
   * Abstention (score === null) is the coverage = 0 limit.
   */
  coverage: number;
  /** Weight actually applied after coverage-scaling and redistribution. */
  effectiveWeight: number;
  trend: ScoreTrend | null;
  explanation: string;
}

export interface HealthScore {
  total: number;
  /**
   * `total` before rounding. Every engine that compares two portfolios
   * (position sizing, cash allocation, trade recommendations) must difference
   * this, not `total` — see the note on HealthDimension.scoreExact.
   */
  totalExact: number;
  grade: HealthGrade;
  dimensions: HealthDimension[];
  summary: string;
  /** How much of the nominal weight was actually scoreable, coverage-adjusted. */
  coveragePct: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * Simpson diversity index (1 − Σpᵢ²) over a set of weights, returned in [0,1).
 *
 * This is the single, consistent diversity measure used for holdings, sectors and
 * regions. It answers "how spread out is this, really?" in a way raw counts cannot:
 * one dominant slice plus a long tail of tiny ones scores near 0, and it saturates
 * toward 1 as weight spreads evenly — so it can never award a literal, gameable 100.
 * `weightsPct` are percentages that should sum to ~100 within their group; the
 * function normalizes defensively so a partial group (e.g. only the classified
 * regions) is measured on its own internal spread.
 */
function simpson(weightsPct: number[]): number {
  const total = weightsPct.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let sumSq = 0;
  for (const w of weightsPct) {
    const p = Math.max(0, w) / total;
    sumSq += p * p;
  }
  return clamp(1 - sumSq, 0, 1);
}

/** Effective number of positions, 1 / Σpᵢ² — robust to token holdings. */
function effectiveCount(weightsPct: number[]): number {
  const total = weightsPct.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let sumSq = 0;
  for (const w of weightsPct) {
    const p = Math.max(0, w) / total;
    sumSq += p * p;
  }
  return sumSq > 0 ? 1 / sumSq : 0;
}

/** Linear interpolation across a monotone table of (x → y) anchor points. */
function lerpTable(x: number, table: [number, number][]): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

function trendOf(score: number): ScoreTrend {
  if (score >= 78) return "strong";
  if (score >= 62) return "good";
  if (score >= 45) return "neutral";
  if (score >= 28) return "weak";
  return "poor";
}

/**
 * The score → letter mapping, exported because portfolio health is displayed as
 * "75 B" everywhere in the app and a before/after row has to grade a SIMULATED
 * total that no HealthScore object exists for. One definition, so a projected
 * grade can never disagree with a measured one.
 */
export function healthGradeOf(score: number): HealthGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** A dimension that has something to say. `coverage` defaults to full confidence. */
function dim(
  name: string,
  score: number,
  weight: number,
  explanation: string,
  coverage = 1,
): HealthDimension {
  const exact = clamp(score);
  const s = Math.round(exact);
  return {
    name,
    score: s,
    scoreExact: exact,
    weight,
    coverage: clamp(coverage, 0, 1),
    effectiveWeight: 0,
    trend: trendOf(s),
    explanation,
  };
}

/** A dimension that does not apply to this portfolio. Its weight goes to the others. */
function abstain(name: string, weight: number, explanation: string): HealthDimension {
  return { name, score: null, scoreExact: null, weight, coverage: 0, effectiveWeight: 0, trend: null, explanation };
}

/* -------------------------------------------------------------------------- */
/* Dimension weights — the single source of truth, summing to exactly 1.0.     */
/* -------------------------------------------------------------------------- */

const W = {
  assetAllocation: 0.16,
  diversification: 0.1,
  concentration: 0.09,
  liquidity: 0.09,
  income: 0.08,
  inflation: 0.08,
  currency: 0.05,
  geographic: 0.06,
  correlation: 0.06,
  drawdown: 0.07,
  cash: 0.06,
  quality: 0.1,
} as const;
// Σ = 0.16+0.10+0.09+0.09+0.08+0.08+0.05+0.06+0.06+0.07+0.06+0.10 = 1.00 exactly.

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
  if (slices.length === 0) return abstain("Asset Allocation", W.assetAllocation, "No holdings.");

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

  return dim("Asset Allocation", score, W.assetAllocation, explanation);
}

/**
 * Diversification — holding-level spread, deliberately DECOUPLED from asset-class
 * concentration (which Asset Allocation and Concentration already own; counting it
 * a third time here was triple-weighting the same fact).
 *
 * Two honest fixes over the previous version:
 *   • Effective holdings, not raw count. `n × 7` rewarded a portfolio of one giant
 *     position plus fourteen $1 tokens as maximally diversified. The effective-
 *     holdings count (1/Σw²) is ~1 for that book — you cannot buy a diversification
 *     score with dust.
 *   • Sector spread only where sectors exist. The old `sectors × 12` term scored a
 *     Treasury ladder or an all-cash book 0 for "having no sectors" — a
 *     missing-data-as-zero penalty, the exact failure the abstention rule exists to
 *     prevent. The sector term now engages only for the sector-classified share of
 *     the portfolio, and blends in proportionally.
 */
function diversification(holdings: Holding[], alloc: PortfolioAllocation): HealthDimension {
  const n = holdings.length;
  if (n === 0) return abstain("Diversification", W.diversification, "No holdings.");

  // Holding-level spread. A single holding → 0; evenly-spread names → toward 1.
  const holdingSpread = simpson(holdings.map((h) => h.weight)) * 100;
  const effHoldings = effectiveCount(holdings.map((h) => h.weight));

  // Sector spread, measured only across the portion that actually has sectors, and
  // weighted by how much of the book that is.
  const sectorClassifiedPct = clamp(100 - alloc.bySector.unclassifiedPct, 0, 100);
  let score = holdingSpread;
  if (sectorClassifiedPct > 15 && alloc.bySector.slices.length > 0) {
    const sectorSpread =
      simpson(alloc.bySector.slices.map((s) => (s.weight / sectorClassifiedPct) * 100)) * 100;
    // Sector diversity contributes at most 40%, and only in proportion to how much
    // of the portfolio is sector-classified.
    const alpha = 0.4 * (sectorClassifiedPct / 100);
    score = holdingSpread * (1 - alpha) + sectorSpread * alpha;
  }

  return dim(
    "Diversification",
    score,
    W.diversification,
    `${n} holdings (effective ${effHoldings.toFixed(1)}) across ${alloc.bySector.slices.length} sectors and ${alloc.byAssetClass.slices.length} asset classes.`,
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
    W.concentration,
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
    W.liquidity,
    risk.illiquidPct > 5
      ? `${risk.illiquidPct.toFixed(0)}% cannot be sold quickly. Rebalancing and emergencies can only draw on the liquid ${(100 - risk.illiquidPct).toFixed(0)}%.`
      : "Portfolio is highly liquid.",
  );
}

/**
 * Income — now counts coupons, rent, staking and interest, not just dividends.
 * The old dimension read `dividendYield` alone, scoring a Treasury ladder, a rental
 * property and a money-market position at exactly zero.
 *
 * Scored on a concave curve rather than the old linear "5% → 100". A linear scale
 * encodes the claim that a healthy portfolio yields 5%, which (a) rewards a junk-
 * bond book maximally for yield it may not sustain and (b) treats a deliberate
 * total-return mandate as failing. The curve credits income with diminishing
 * marginal value: a 2% yield is already "meaningful income", and stretching for
 * 10% buys little additional score. NOTE: this measures income QUANTITY, not
 * quality — we do not model coupon/dividend sustainability, so a high score here is
 * not a statement that the income is safe. See "assumptions" in the audit notes.
 */
function income(holdings: Holding[], totalValue: number): HealthDimension {
  if (totalValue <= 0) return abstain("Income", W.income, "No holdings.");

  const annual = holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const yieldPct = Math.max(0, (annual / totalValue) * 100);
  const kinds = [...new Set(holdings.filter((h) => h.income).map((h) => h.income!.kind))];

  // Concave: 0%→0, ~2%→60, ~5%→90, saturating toward 100. Half-life ≈ 2.2%.
  const score = clamp(100 * (1 - Math.exp(-yieldPct / 2.2)));
  return dim(
    "Income",
    score,
    W.income,
    annual > 0
      ? `${yieldPct.toFixed(2)}% portfolio yield (${kinds.join(", ")}). Sustainability not assessed.`
      : "No income generated. Portfolio is entirely growth/appreciation dependent.",
  );
}

/**
 * Inflation protection — the dimension that makes cash's true cost visible.
 *
 * Measures the portfolio's SHORT-TERM sensitivity to a +1pp inflation surprise
 * (the calibrated INFLATION_1PP probe, incl. the policy-rate response). Negative =
 * loses value.
 *
 * Remapped to realistic economic endpoints. The old 50 + s·25 put a plain equity
 * book (s ≈ −5.6), a plain bond book (s ≈ −5.5) and a classic 60/40 (s ≈ −5.6) all
 * at exactly 0 — the floor — while any real-asset tilt pinned at 100. Three common,
 * distinct portfolios collapsed to one indistinguishable "catastrophe" score, and
 * the headline read "Inflation Protection 0/100" on healthy portfolios.
 *
 * Endpoints are now the realistic extremes: s = −7 (a long-nominal-bond + cash book,
 * badly hurt) → 0, and s = +6 (a real-asset-heavy book, well hedged) → 100, linear
 * between. Conventional portfolios land in a graded band (cash ≈ 46, 60/40 ≈ 11,
 * inflation-neutral ≈ 54, gold-heavy ≈ 92) instead of on the floor. This is honest
 * about a real, well-known vulnerability (2022 proved stocks and nominal bonds fall
 * together in an inflation shock) WITHOUT pretending every conventional portfolio is
 * equally doomed. Limitation: a 1pp instantaneous shock does not capture equities'
 * long-run partial inflation pass-through.
 */
const INFLATION_WORST_S = -7; // → 0
const INFLATION_BEST_S = 6; // → 100
function inflationProtection(risk: UniversalRisk): HealthDimension {
  if (risk.inflationSensitivity == null) {
    return abstain("Inflation Protection", W.inflation, "No inflation-sensitive exposures to assess.");
  }
  const s = risk.inflationSensitivity;
  const score = clamp(
    ((s - INFLATION_WORST_S) / (INFLATION_BEST_S - INFLATION_WORST_S)) * 100,
  );
  return dim(
    "Inflation Protection",
    score,
    W.inflation,
    s < -0.5
      ? `A +1pp inflation surprise costs roughly ${Math.abs(s).toFixed(1)}% of portfolio value (short-term). Limited real-asset protection.`
      : s > 0.5
        ? `Positively exposed to inflation (+${s.toFixed(1)}% per 1pp) via real assets.`
        : "Roughly inflation-neutral in the short term.",
  );
}

/**
 * Currency diversification. Some foreign exposure is prudent, but a home-currency
 * base is not itself a failure — an investor with home-currency liabilities is
 * rationally home-biased. The floor is therefore "adequate, consider diversifying"
 * (≈55) rather than the old near-fail 35: we flag the absence of currency
 * diversification without asserting it is unhealthy.
 */
function currencyDiversification(risk: UniversalRisk, alloc: PortfolioAllocation): HealthDimension {
  const count = alloc.byCurrency.slices.length;
  if (count === 0) return abstain("Currency Diversification", W.currency, "No holdings.");

  const score = clamp(55 + risk.foreignCurrencyPct * 1.8);
  return dim(
    "Currency Diversification",
    score,
    W.currency,
    count === 1
      ? `Entirely ${alloc.byCurrency.slices[0].label}-denominated. No currency diversification — reasonable if your spending is in this currency.`
      : `${risk.foreignCurrencyPct.toFixed(0)}% in non-base currencies across ${count} currencies.`,
  );
}

/**
 * Geographic diversification — a proper Simpson diversity index over the CLASSIFIED
 * portion, coverage-discounted by how much of the book we could actually classify.
 *
 * The old version had two bugs. It returned a literal 100/100 whenever the single
 * largest region was under 45% — ignoring how the rest was split, so a 44%/44%/12%
 * two-region book scored a perfect 100. And it measured the largest region as a
 * share of the WHOLE portfolio, so unclassified holdings diluted it: a book that is
 * 50% unknown and 50% United States showed "US 50%" and scored well, when its
 * classified geography is 100% one country. Both are now impossible — the index is
 * computed on classified weights and saturates below 100, and `coverage` reflects
 * the unclassified share honestly instead of hiding it.
 */
function geographic(alloc: PortfolioAllocation): HealthDimension {
  const view = alloc.byGeography;
  const classifiedPct = clamp(100 - view.unclassifiedPct, 0, 100);
  // Below ~40% classified there is not enough to say anything honest.
  if (classifiedPct < 40 || view.slices.length === 0) {
    return abstain(
      "Geographic Diversification",
      W.geographic,
      `Geography unknown for ${view.unclassifiedPct.toFixed(0)}% of the portfolio — not enough to assess.`,
    );
  }
  // Normalize region weights to the classified portion, then measure their spread.
  const normalized = view.slices.map((s) => (s.weight / classifiedPct) * 100);
  const score = simpson(normalized) * 100;
  const top = view.slices[0];
  const topOfClassified = (top.weight / classifiedPct) * 100;
  return dim(
    "Geographic Diversification",
    score,
    W.geographic,
    `${view.slices.length} region(s). Largest: ${top.label} at ${topOfClassified.toFixed(0)}% of classified exposure${
      view.unclassifiedPct > 5 ? ` (${view.unclassifiedPct.toFixed(0)}% unclassified)` : ""
    }.`,
    classifiedPct / 100,
  );
}

/**
 * Correlation — average pairwise return correlation, coverage-discounted by how much
 * of the portfolio actually entered the calculation.
 *
 * The illiquid holdings that were correctly EXCLUDED (rather than assumed
 * uncorrelated) mean this figure can rest on a small slice of the book — 2 of 19
 * names. Presenting that at full weight overstates it. Coverage = included ÷
 * (included + excluded), so a correlation computed on a thin sliver counts for
 * little, without ever pretending the excluded holdings are diversifiers.
 */
function correlationDim(risk: UniversalRisk): HealthDimension {
  const c = risk.correlation;
  if (!c) return abstain("Correlation", W.correlation, "Not enough price history to compute correlations.");

  const included = c.symbols.length;
  const coverage = included / Math.max(1, included + c.excluded.length);

  // avg r of 0 → 100; 0.9 → ~10. Negative average correlation clamps at 100.
  const score = clamp(100 - c.avgCorrelation * 100);
  const note =
    c.excluded.length > 0
      ? ` ${c.excluded.length} illiquid holding(s) excluded — they have no return series and are NOT assumed uncorrelated.`
      : "";

  return dim(
    "Correlation",
    score,
    W.correlation,
    `Average pairwise correlation ${c.avgCorrelation.toFixed(2)} across ${included} holding(s) with history.${
      c.highPairs.length ? ` ${c.highPairs.length} highly-correlated pair(s).` : ""
    }${note}`,
    coverage,
  );
}

/**
 * Expected drawdown — worst observed drawdown of the return series, coverage-
 * discounted by the share of the portfolio that HAS a return series.
 *
 * The drawdown is computed on the observed sleeve; the illiquid/proxied sleeve
 * contributes flat (no series), which understates the true figure. Rather than
 * present a drawdown computed on 60% of the book as though it were the whole book's,
 * coverage = observed share, so the dimension speaks in proportion to what it can
 * actually see.
 */
function drawdownDim(risk: UniversalRisk): HealthDimension {
  if (risk.maxDrawdown == null) {
    return abstain("Expected Drawdown", W.drawdown, "Not enough price history.");
  }
  const dd = Math.abs(risk.maxDrawdown);
  const score = clamp(100 - dd * 2.2);
  const coverage = clamp(risk.coverage.observedPct / 100, 0, 1);
  return dim(
    "Expected Drawdown",
    score,
    W.drawdown,
    `Worst observed drawdown ${dd.toFixed(1)}%${
      risk.cvar95Pct != null ? `; expected loss on a bad day (CVaR 95) ${risk.cvar95Pct.toFixed(2)}%` : ""
    }${risk.coverage.observedPct < 100 ? `. Based on the ${risk.coverage.observedPct}% of value with a price series.` : "."}`,
    // Never let coverage hit exactly 0 when a drawdown WAS computed — some observed
    // sleeve must exist for maxDrawdown to be non-null.
    Math.max(coverage, 0.05),
  );
}

/**
 * Cash management. Both directions are failures: no cash means no buffer and forced
 * selling; too much cash is a slow, guaranteed loss to inflation. The old engine
 * could express neither, because it could not represent cash.
 *
 * Now a CONTINUOUS curve rather than the old five-step function, which had a
 * 30-point cliff at 15% (14.9% cash → 95, 15.1% → 65) — two near-identical
 * portfolios receiving wildly different scores at an arbitrary boundary. The curve
 * peaks in the healthy 5-12% band and declines smoothly on both sides.
 */
const CASH_CURVE: [number, number][] = [
  [0, 25],
  [1, 45],
  [3, 80],
  [5, 95],
  [10, 100],
  [15, 90],
  [25, 62],
  [40, 40],
  [60, 28],
  [100, 18],
];
function cashManagement(alloc: PortfolioAllocation): HealthDimension {
  const cash = alloc.byAssetClass.slices.find((s) => s.key === "cash");
  const pct = clamp(cash?.weight ?? 0, 0, 100);
  const score = lerpTable(pct, CASH_CURVE);

  let explanation: string;
  if (pct < 1) {
    explanation = "Effectively no cash buffer. Any unexpected need forces a sale at whatever price the market offers.";
  } else if (pct < 3) {
    explanation = `${pct.toFixed(1)}% cash — a thin buffer.`;
  } else if (pct <= 15) {
    explanation = `${pct.toFixed(1)}% cash — a healthy buffer without excessive drag.`;
  } else if (pct <= 30) {
    explanation = `${pct.toFixed(0)}% cash. Substantial dry powder, but it is losing purchasing power to inflation.`;
  } else {
    explanation = `${pct.toFixed(0)}% cash. This is a large, deliberate-looking bet on holding cash — it guarantees a real loss if inflation persists.`;
  }

  return dim("Cash Management", score, W.cash, explanation);
}

/**
 * Holding quality — the confidence-weighted mean of what each class's OWN scorer
 * said. A bond is judged as a bond, a REIT as a REIT.
 *
 * Abstains when nothing in the portfolio could be scored, instead of returning 50.
 * When only part of the book is scoreable, the dimension carries that share as its
 * `coverage` so a quality score resting on 20% of value counts for less.
 */
function quality(holdings: Holding[]): HealthDimension {
  const scored = holdings.filter((h) => h.score != null);
  if (scored.length === 0) {
    return abstain("Holding Quality", W.quality, "No holdings could be scored with the available data.");
  }

  let num = 0;
  let den = 0;
  for (const h of scored) {
    const w = h.valuation.valueBase * (h.score!.confidence / 100);
    num += h.score!.score * w;
    den += w;
  }
  if (den === 0) {
    return abstain("Holding Quality", W.quality, "Scores available but all at zero confidence.");
  }

  const score = num / den;
  const totalValue = Math.max(holdings.reduce((s, h) => s + h.valuation.valueBase, 0), 1);
  const coveredValue = scored.reduce((s, h) => s + h.valuation.valueBase, 0);
  const coveredPct = (coveredValue / totalValue) * 100;

  return dim(
    "Holding Quality",
    score,
    W.quality,
    `Confidence-weighted across ${scored.length} of ${holdings.length} holdings (${coveredPct.toFixed(0)}% of value). Each asset class scored on its own metrics.`,
    clamp(coveredValue / totalValue, 0, 1),
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
    return { total: 0, totalExact: 0, grade: "F", dimensions: [], summary: "No holdings.", coveragePct: 0 };
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

  // Redistribute weight across dimensions that scored, IN PROPORTION TO THEIR
  // COVERAGE. A dimension that abstains (score null, coverage 0) contributes
  // nothing; one that partially covers the book contributes at weight × coverage.
  const scoreable = dimensions.filter((d) => d.score != null);
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const scoreableWeighted = scoreable.reduce((s, d) => s + d.weight * d.coverage, 0);

  if (scoreableWeighted === 0) {
    return {
      total: 0,
      totalExact: 0,
      grade: "F",
      dimensions,
      summary: "Not enough data to score this portfolio.",
      coveragePct: 0,
    };
  }

  for (const d of dimensions) {
    d.effectiveWeight = d.score != null ? (d.weight * d.coverage) / scoreableWeighted : 0;
  }

  // Weight the UNROUNDED dimension scores — rounding each dimension first and
  // then rounding the total again quantized the whole score twice over.
  const totalExact = dimensions.reduce((s, d) => s + (d.scoreExact ?? 0) * d.effectiveWeight, 0);
  const total = Math.round(totalExact);
  const g = healthGradeOf(total);

  const best = scoreable.reduce((a, b) => (a.score! > b.score! ? a : b));
  const worst = scoreable.reduce((a, b) => (a.score! < b.score! ? a : b));
  const abstained = dimensions.filter((d) => d.score == null);

  // "Needs work" only when the weakest dimension is genuinely low — a portfolio
  // whose worst area is a 60 is not "in need of work", and saying so would be the
  // same alarmism the inflation floor-collision produced.
  const weakestClause =
    worst.score! < 45
      ? ` Needs work: ${worst.name} (${worst.score}/100).`
      : ` Weakest area: ${worst.name} (${worst.score}/100).`;

  const summary =
    `${g === "A" || g === "B" ? "Strong" : g === "C" ? "Solid" : "Weak"} portfolio. ` +
    `Best: ${best.name} (${best.score}/100).` +
    weakestClause +
    (abstained.length > 0
      ? ` ${abstained.length} dimension(s) not applicable and excluded rather than scored neutral.`
      : "");

  return {
    total,
    totalExact,
    grade: g,
    dimensions,
    summary,
    coveragePct: Math.round((scoreableWeighted / totalWeight) * 100),
  };
}
