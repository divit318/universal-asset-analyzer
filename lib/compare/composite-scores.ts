/**
 * Composite scores for the non-equity Compare frameworks (ETF, REIT, Crypto,
 * Commodity, Bond, Forex) — the "Composite Scores" section every asset class
 * needs to reach equity's depth, per the approved comparison-framework spec.
 *
 * Deliberately NOT percentile-based. Equity's own composite scores, and the
 * Screener's ranking engine (lib/screener/ranking.ts), score a candidate
 * against the full universe. That upgrade is scoped for a later phase — see
 * the Comparison Engine Redesign doc — and is explicitly out of scope here.
 * These are simple, fixed-bound 0-100 normalizations (the same "lerp-range"
 * approach lib/scoring.ts already uses for equity's single-name score),
 * scoped only to the 2-5 instruments a user is actively comparing.
 *
 * Every metric a class doesn't have data for is excluded from its average
 * rather than penalized — the same "missing is not zero" rule the rest of
 * the platform follows.
 */

/** Clamp `value` into [min, max], map onto 0-100, and flip if lower is better. */
function boundedScore(
  value: number | null,
  min: number,
  max: number,
  higherBetter: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  return higherBetter ? pct : 100 - pct;
}

/** Log-scale variant for metrics that span orders of magnitude (AUM, volume). */
function boundedLogScore(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return boundedScore(Math.log10(value), Math.log10(min), Math.log10(max), true);
}

/** Mean of whatever's present; null only when every input is null. */
function meanOf(scores: (number | null)[]): number | null {
  const present = scores.filter((s): s is number => s != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

const round = (v: number | null): number | null => (v == null ? null : Math.round(v));

export interface CompositeScoreAxis {
  key: string;
  label: string;
  value: number | null;
}

export interface CompositeScoreResult {
  axes: CompositeScoreAxis[];
  overall: number | null;
}

type Metrics = Record<string, number | null>;

export function computeEtfScores(m: Metrics): CompositeScoreResult {
  const cost = boundedScore(m.expenseRatio, 0.03, 1.0, false);
  const liquidity = meanOf([
    boundedLogScore(m.aum, 1e7, 5e10),
    boundedLogScore(m.avgVolume, 1e4, 2e7),
  ]);
  const diversification = meanOf([
    boundedScore(m.top10Concentration, 15, 90, false),
    boundedScore(m.topSectorWeight, 15, 70, false),
  ]);
  const returnScore = boundedScore(m.oneYearReturn ?? m.ytdReturn, -25, 35, true);
  // Risk: volatility and drawdown depth — the two numbers a holder actually
  // feels day to day, distinct from "diversification" (concentration, a
  // structural property of the portfolio rather than realized price behavior).
  const risk = meanOf([
    boundedScore(m.volatility, 8, 35, false),
    boundedScore(m.maxDrawdown, -45, -5, true),
  ]);
  // Income: trailing distribution yield. Kept separate from `return` (pure
  // price return) since a fund can be a strong income vehicle while flat or
  // negative on price — collapsing the two would hide that distinction.
  const income = boundedScore(m.dividendYield, 0, 5, true);

  const axes: CompositeScoreAxis[] = [
    { key: "cost", label: "Cost", value: round(cost) },
    { key: "liquidity", label: "Liquidity", value: round(liquidity) },
    { key: "diversification", label: "Diversification", value: round(diversification) },
    { key: "return", label: "Return", value: round(returnScore) },
    { key: "risk", label: "Risk", value: round(risk) },
    { key: "income", label: "Income", value: round(income) },
  ];
  return { axes, overall: round(meanOf([cost, liquidity, diversification, returnScore, risk, income])) };
}

export function computeReitScores(m: Metrics): CompositeScoreResult {
  const valuation = meanOf([
    boundedScore(m.pFfo, 6, 25, false),
    boundedScore(m.ffoYield, 3, 11, true),
  ]);
  const growth = meanOf([
    boundedScore(m.revenueGrowthYoY, -8, 20, true),
    boundedScore(m.ffoGrowthYoY, -15, 20, true),
  ]);
  const income = meanOf([
    boundedScore(m.dividendYield, 1, 9, true),
    boundedScore(m.payoutRatio, 50, 120, false),
  ]);
  const balanceSheet = meanOf([
    boundedScore(m.netDebtToEbitda, 3, 9, false),
    boundedScore(m.debtToEquity, 0.3, 2.5, false),
  ]);
  // Momentum: REIT total return is dominated by rate-sensitivity swings that
  // valuation/growth/balance-sheet metrics (all fundamentals-based, slow-moving)
  // don't capture — investors do watch entry timing here, not just quality.
  const momentum = meanOf([
    boundedScore(m.oneYearReturn, -25, 35, true),
    boundedScore(m.distanceFrom52WkHigh, -35, 0, true),
  ]);

  const axes: CompositeScoreAxis[] = [
    { key: "valuation", label: "Valuation", value: round(valuation) },
    { key: "growth", label: "Growth", value: round(growth) },
    { key: "income", label: "Income", value: round(income) },
    { key: "balanceSheet", label: "Balance Sheet", value: round(balanceSheet) },
    { key: "momentum", label: "Momentum", value: round(momentum) },
  ];
  return { axes, overall: round(meanOf([valuation, growth, income, balanceSheet, momentum])) };
}

export function computeCryptoScores(m: Metrics): CompositeScoreResult {
  const liquidity = boundedScore(m.volumeToMcap, 0.005, 0.25, true);
  const dilution = boundedScore(m.mcapToFdv, 0.15, 1.0, true);
  const momentum = meanOf([
    boundedScore(m.return90d, -40, 80, true),
    boundedScore(m.oneYearReturn, -60, 200, true),
  ]);
  const risk = boundedScore(m.volatility, 25, 140, false);
  // Size: market-cap tier. Distinct from `risk` (realized volatility) — a
  // token can look calm over a short window while still being a micro-cap
  // that's one large holder away from a 50% move; size is the structural
  // maturity signal investors weigh alongside, not instead of, volatility.
  const size = boundedLogScore(m.marketCap, 5e7, 1e12);

  const axes: CompositeScoreAxis[] = [
    { key: "liquidity", label: "Liquidity", value: round(liquidity) },
    { key: "dilution", label: "Dilution", value: round(dilution) },
    { key: "momentum", label: "Momentum", value: round(momentum) },
    { key: "risk", label: "Risk", value: round(risk) },
    { key: "size", label: "Size", value: round(size) },
  ];
  return { axes, overall: round(meanOf([liquidity, dilution, momentum, risk, size])) };
}

export function computeCommodityScores(m: Metrics): CompositeScoreResult {
  const trend = boundedScore(m.trendScore, 0, 100, true);
  const carry = boundedScore(m.rollYield, -12, 12, true);
  const seasonal = boundedScore(m.seasonalityScore, 0, 100, true);
  const risk = boundedScore(m.volatility, 8, 55, false);
  // Return: realized 1-year performance. `trend` is a technical read (is the
  // move intact right now); this is the number an investor actually banked —
  // a commodity can have a fading trend score while still up big on the year.
  const returnScore = boundedScore(m.return1y, -30, 60, true);

  const axes: CompositeScoreAxis[] = [
    { key: "trend", label: "Trend", value: round(trend) },
    { key: "carry", label: "Carry", value: round(carry) },
    { key: "seasonal", label: "Seasonal", value: round(seasonal) },
    { key: "risk", label: "Risk", value: round(risk) },
    { key: "return", label: "Return", value: round(returnScore) },
  ];
  return { axes, overall: round(meanOf([trend, carry, seasonal, risk, returnScore])) };
}

export function computeBondScores(m: Metrics): CompositeScoreResult {
  const yieldScore = boundedScore(m.yield, 1, 7, true);
  const credit = boundedScore(m.investmentGradePct, 20, 100, true);
  const cost = boundedScore(m.expenseRatio, 0.03, 0.85, false);
  const liquiditySize = boundedLogScore(m.aum, 2e7, 3e10);
  // Rate Risk: modeled loss if rates rise 1% — duration itself has no
  // universal "better" direction (it's rate exposure, not quality), but its
  // consequence — how much a +1% shock actually costs the holder — does, and
  // is exactly what a bond-fund investor weighs against the yield on offer.
  const rateRisk = boundedScore(m.rateSensitivity, -15, 0, true);

  const axes: CompositeScoreAxis[] = [
    { key: "yield", label: "Yield", value: round(yieldScore) },
    { key: "credit", label: "Credit Quality", value: round(credit) },
    { key: "cost", label: "Cost", value: round(cost) },
    { key: "liquiditySize", label: "Liquidity / Size", value: round(liquiditySize) },
    { key: "rateRisk", label: "Rate Risk", value: round(rateRisk) },
  ];
  // Duration itself is deliberately excluded — the registry declares it
  // `better: null`, so it's shown informationally, never scored.
  return { axes, overall: round(meanOf([yieldScore, credit, cost, liquiditySize, rateRisk])) };
}

export function computeForexScores(m: Metrics): CompositeScoreResult {
  const carry = boundedScore(m.carryToVol, -0.5, 1.5, true);
  const trend = boundedScore(m.trendScore, 0, 100, true);
  const stability = boundedScore(m.volatility, 5, 25, false);
  const liquidity = m.liquidityTier == null ? null : boundedScore(m.liquidityTier, 1, 3, false);
  // Policy: central-bank divergence — a directional monetary-policy tailwind
  // distinct from `carry` (the yield differential already banked) and `trend`
  // (price action) — it's the forward-looking "is policy still pushing this
  // pair the same direction" read a macro-driven FX investor cares about.
  const policy = boundedScore(m.policyDivergence, -3, 3, true);

  const axes: CompositeScoreAxis[] = [
    { key: "carry", label: "Carry", value: round(carry) },
    { key: "trend", label: "Trend", value: round(trend) },
    { key: "stability", label: "Stability", value: round(stability) },
    { key: "liquidity", label: "Liquidity", value: round(liquidity) },
    { key: "policy", label: "Policy", value: round(policy) },
  ];
  return { axes, overall: round(meanOf([carry, trend, stability, liquidity, policy])) };
}
