/**
 * Universal Risk Engine.
 *
 * Reuses the pure math that already exists in lib/portfolio-analytics.ts (mean,
 * stddev, pearson, maxDrawdown, computeRiskAdjustedRatios). Those functions carry
 * no equity assumption — correlation and volatility math doesn't care what the
 * series is — and lib/crypto-scoring.ts already reuses them, so importing rather
 * than reimplementing is the established pattern.
 *
 * What's new is everything above the math:
 *
 *  1. RISK COVERAGE. The old engine computed portfolio volatility from the
 *     holdings that happened to have price history, then reported it as THE
 *     portfolio's volatility — while the illiquid holdings with no history still
 *     counted in the weights. A portfolio that is 40% private equity got a
 *     volatility figure computed on the other 60% and presented with no caveat.
 *     That systematically UNDERSTATES risk, and understating risk is not a
 *     presentation gap — it is the failure mode that gets people hurt. We now
 *     report coverage explicitly and fill the gap with declared proxy volatility.
 *
 *  2. RISK BEYOND PRICE VOLATILITY. Duration, credit, FX, liquidity and inflation
 *     risk are real and are invisible to a returns-based model. They come from the
 *     factor exposures.
 */

import { inflationSensitivity } from "./scenario";
import {
  computeRiskAdjustedRatios,
  maxDrawdown,
  mean,
  pearson,
  stddev,
} from "../../portfolio-analytics";
import { computeHHI } from "./allocation";
import { alignPair, alignReturns, datedReturns, type DatedReturns } from "./series";
import { isIlliquid } from "../model/types";
import type { Holding, Liquidity, MarketContext, PortfolioAssetClass } from "../model/types";
import type { PortfolioAllocation } from "./allocation";

/* -------------------------------------------------------------------------- */
/* Proxy volatility for assets with no price series                            */
/* -------------------------------------------------------------------------- */

/**
 * Annualized volatility (%) assumed for asset classes that have no observable
 * price series.
 *
 * This is the honest answer to a genuinely hard problem. A private company's
 * carrying value only moves at funding rounds, so its OBSERVED volatility is near
 * zero — but its TRUE volatility is higher than public equity, not lower. A
 * returns-based model looking at that flat line concludes the position is riskless.
 * It is the single most dangerous artifact in illiquid-asset reporting, and it has
 * a name: volatility smoothing.
 *
 * So we do not measure these — we DECLARE them, and we label them as declared.
 * A declared 30% is far closer to the truth than an observed 2%.
 */
const PROXY_VOLATILITY: Partial<Record<PortfolioAssetClass, number>> = {
  real_estate: 18,      // levered property; unlevered indices understate this badly
  private_market: 35,   // levered equity with a lag
  alternative: 22,      // thin, sentiment-driven markets
  structured_product: 12,
  cash: 0.2,            // not zero: FX and reinvestment risk are real, if small
};

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface RiskCoverage {
  /** % of portfolio value with a real, observable return series. */
  observedPct: number;
  /** % of value using a declared proxy volatility instead. */
  proxiedPct: number;
  /**
   * % of value that is NEITHER observed NOR proxied — a market-priced holding
   * whose return series didn't arrive (fresh listing, delisted ticker, provider
   * error, a line the provider has no history for).
   *
   * This sleeve contributes to the weights but to none of the return-based
   * statistics, so it is the one bucket that can silently understate risk. It
   * used to be uncounted entirely, which meant the Risk Lab's coverage warning —
   * gated on `proxiedPct > 0` — never fired for it.
   */
  unmodelledPct: number;
  holdingsObserved: number;
  holdingsProxied: number;
  holdingsUnmodelled: number;
}

export interface UniversalRisk {
  /* Return-based (market-priced holdings + proxies) */
  annualizedVolatility: number | null;
  beta: number | null;
  /** What `beta` was regressed against ("S&P 500", "NIFTY 50") — market-aware. */
  benchmarkLabel: string | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  /** 1-day VaR at 95%, as a % of portfolio value. */
  var95Pct: number | null;
  var95Dollar: number | null;
  /** Conditional VaR (expected shortfall) — the average loss GIVEN you're in the worst 5%. */
  cvar95Pct: number | null;
  cvar95Dollar: number | null;

  /* Cross-asset risks the old engine could not see at all */
  /** Portfolio-weighted effective duration, in years. Rate risk in one number. */
  duration: number | null;
  /** Net credit-spread sensitivity: % loss per 1pp of spread widening. */
  creditSensitivity: number | null;
  /** % of value in currencies other than base. */
  foreignCurrencyPct: number;
  /** % of value that cannot be liquidated within days. */
  illiquidPct: number;
  /**
   * How MANY holdings cannot be liquidated within days.
   *
   * Weight alone is misleading in exactly the case a real book produces: three
   * genuinely illiquid positions (a watch, an angel stake, a land parcel) worth
   * $1,750 out of $9.2M render as "Illiquid: 0%", and 0% invites the reading
   * "nothing here is illiquid" — which is false, and is contradicted by the
   * ILLIQUID badges on the Holdings tab. The count is the context that makes the
   * weight legible, the same pairing the concentration card already uses ("HHI
   * 688 · 14.5 effective holdings"). Both come from isIlliquid(), so the two
   * surfaces cannot drift.
   */
  illiquidHoldings: number;
  /** Net inflation sensitivity: % change per 1pp inflation surprise. Negative = hurt by inflation. */
  inflationSensitivity: number | null;

  /* Concentration */
  /**
   * Herfindahl-Hirschman Index over INDIVIDUAL HOLDING weights, 0-10000.
   *
   * Named for its denominator, not called a bare `hhi`, because this app computes
   * an HHI over several different denominators and they are not interchangeable:
   * `allocation.byAssetClass.hhi` (and bySector, byCurrency, …) measure a
   * different quantity on a different scale. On the real book this one reads 688
   * over 25 holdings while the asset-class one reads 3431 over 10 classes.
   *
   * The rename is load-bearing. As `hhi`, this field was added to
   * `ImpactEstimate.diversificationDelta` — an ASSET-CLASS HHI delta — to render
   * the Decision Center's "after" concentration, producing 688 − 160 = 528: a
   * figure that was neither the post-trade position HHI (664) nor the post-trade
   * asset-class HHI (3271), and which overstated the improvement 6.7x. Nothing in
   * the types objected, because both sides were spelled "hhi". Now `positionHhi +
   * assetClassHhiDelta` is visibly wrong at the call site.
   */
  positionHhi: number;
  topHoldingWeight: number;
  topAssetClassWeight: number;
  topSectorWeight: number;
  concentrationRisk: "low" | "medium" | "high";

  coverage: RiskCoverage;
  correlation: CorrelationMatrix | null;
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
  highPairs: { a: string; b: string; r: number }[];
  avgCorrelation: number;
  /**
   * Holdings excluded because they have no honest return series.
   *
   * We EXCLUDE them and say so rather than assigning them a correlation of 0.
   * A fabricated zero would render an illiquid holding as a perfect diversifier —
   * the most dangerous single lie a portfolio tool can tell, and precisely the one
   * that made "uncorrelated alternatives" a selling point through 2008.
   */
  excluded: string[];
}

/* -------------------------------------------------------------------------- */

/**
 * The holding's return series WITH its dates, so every cross-holding statistic
 * below can join on the calendar rather than on the array index. See
 * engines/series.ts for why index alignment was materially wrong here.
 */
function seriesFor(h: Holding, ctx: MarketContext): DatedReturns | null {
  if (!h.symbol) return null;
  const key = h.symbol.toUpperCase();
  const closes = ctx.history.get(key);
  if (!closes || closes.length < 30) return null;
  const s = datedReturns(closes, ctx.historyDates?.get(key));
  return s.returns.length >= 25 ? s : null;
}

function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/* -------------------------------------------------------------------------- */
/* Correlation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one definition of "highly correlated" — used by highPairs below AND by
 * the alignment engine's cluster detection (lib/portfolio/alignment/cluster.ts),
 * so "these names move as one trade" means the same r everywhere it is said.
 */
export const HIGH_CORRELATION_R = 0.75;

export function computeCorrelation(holdings: Holding[], ctx: MarketContext): CorrelationMatrix | null {
  const withHistory: { label: string; series: DatedReturns }[] = [];
  const excluded: string[] = [];

  for (const h of holdings) {
    const series = seriesFor(h, ctx);
    if (series) withHistory.push({ label: h.symbol ?? h.name, series });
    else excluded.push(h.symbol ?? h.name);
  }

  if (withHistory.length < 2) return null;

  const symbols = withHistory.map((x) => x.label);
  const n = symbols.length;
  // NaN, not 0, for the off-diagonal default: a pair with too little overlap to
  // measure has an UNKNOWN correlation, and seeding it with 0 would render it as
  // a perfect diversifier — the same fabricated-zero mistake the `excluded` list
  // exists to avoid for holdings with no series at all.
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));

  let sum = 0;
  let pairs = 0;
  const highPairs: { a: string; b: string; r: number }[] = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      // Pairwise DATE alignment. This used to hand two unequal-length arrays to
      // pearson(), which truncates to the shorter and reads from index 0 — so a
      // 400-observation crypto series was correlated against an equity's 275 by
      // comparing each one's OLDEST 275 observations, i.e. two different
      // calendar periods. See engines/series.ts.
      const aligned = alignPair(withHistory[i].series, withHistory[j].series);
      if (!aligned) continue;
      const r = pearson(aligned[0], aligned[1]);
      matrix[i][j] = r;
      matrix[j][i] = r;
      sum += r;
      pairs++;
      if (r > HIGH_CORRELATION_R) highPairs.push({ a: symbols[i], b: symbols[j], r });
    }
  }

  if (pairs === 0) return null;

  highPairs.sort((a, b) => b.r - a.r);

  return {
    symbols,
    matrix,
    highPairs: highPairs.slice(0, 8),
    avgCorrelation: sum / pairs,
    excluded,
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

export function computeRisk(
  holdings: Holding[],
  totalValue: number,
  allocation: PortfolioAllocation,
  ctx: MarketContext,
): UniversalRisk {
  const weights = holdings.map((h) => h.weight);
  const hhi = computeHHI(weights);
  const topHoldingWeight = weights.length ? Math.max(...weights) : 0;
  const topAssetClassWeight = allocation.byAssetClass.slices[0]?.weight ?? 0;
  const topSectorWeight = allocation.bySector.slices[0]?.weight ?? 0;

  /* ---- Build the portfolio return series ---- */

  const observed: { weight: number; series: DatedReturns }[] = [];
  const proxied: { weight: number; vol: number }[] = [];
  let observedValue = 0;
  let proxiedValue = 0;
  let unmodelledValue = 0;
  let unmodelledCount = 0;

  for (const h of holdings) {
    const series = seriesFor(h, ctx);

    if (series) {
      observed.push({ weight: h.weight, series });
      observedValue += h.valuation.valueBase;
      continue;
    }

    const vol = PROXY_VOLATILITY[h.assetClass];
    if (vol != null) {
      proxied.push({ weight: h.weight, vol });
      proxiedValue += h.valuation.valueBase;
      continue;
    }

    // NEITHER observed NOR proxied — and this bucket is why the disclosure was
    // broken. PROXY_VOLATILITY covers only the manually-valued classes and cash,
    // so a MARKET-priced holding whose history simply didn't arrive (a fresh
    // listing, a delisted ticker, a provider error, a line Yahoo has no series
    // for) fell out of both sleeves silently: `proxiedPct` stayed 0, and the Risk
    // Lab gated its whole coverage warning on `proxiedPct > 0`. A portfolio
    // measured on 60% of its value therefore reported volatility, beta, VaR and
    // drawdown with no caveat at all. Understating risk without saying so is the
    // exact failure this engine's docblock claims to prevent, and it was live.
    unmodelledValue += h.valuation.valueBase;
    unmodelledCount++;
  }

  const pctOf = (v: number) => (totalValue > 0 ? Math.round((v / totalValue) * 100) : 0);
  const coverage: RiskCoverage = {
    observedPct: pctOf(observedValue),
    proxiedPct: pctOf(proxiedValue),
    unmodelledPct: pctOf(unmodelledValue),
    holdingsObserved: observed.length,
    holdingsProxied: proxied.length,
    holdingsUnmodelled: unmodelledCount,
  };

  let annualizedVolatility: number | null = null;
  let beta: number | null = null;
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;
  let dd: number | null = null;
  let var95Pct: number | null = null;
  let cvar95Pct: number | null = null;

  // DATE-aligned across every observed holding, so index i is the same session in
  // all of them. Tail-index alignment mixed calendars silently: a 400-observation
  // crypto series and a 275-observation equity series were zipped position by
  // position, which is 125 sessions of drift on the single most interesting
  // cross-asset pair a multi-asset book contains.
  const aligned = alignReturns(observed.map((o) => o.series));

  if (aligned.series.length === observed.length && (aligned.series[0]?.length ?? 0) >= 2) {
    // Renormalization for the coverage gap (observed + proxied < 100%).
    //
    // Without this, `w = weight / 100` below uses each observed holding's RAW
    // portfolio weight, so any gap (a market-priced holding with too little
    // history for `observed`, and no class in PROXY_VOLATILITY to fall into
    // `proxied` either) simply never appears in the sum — which is
    // mathematically identical to asserting the gap returns exactly 0% every
    // day, i.e. treating unmeasured risk as riskless. That is the understatement
    // this file's own header warns about, just for a case beyond the illiquid
    // classes it already handles.
    //
    // The fix extrapolates from what IS measured rather than fabricating a new
    // number: observed weights are scaled up to fill exactly the gap (proxied
    // keeps its own real weight, added separately below, so this never double-
    // counts it). When there is no gap, observedWeightSum + proxiedWeightSum ≈
    // 100, the scale factor is 1, and this is byte-identical to before.
    //
    // Bounded at 3x so a tiny observed sample (e.g. one small measured holding
    // sitting next to a large gap) doesn't get extrapolated into a wild,
    // overconfident number — the same caution this codebase already applies to
    // measuredBeta()'s R² gate. Above that bound the gap is real and stays
    // visible via `coverage`, which the UI must surface rather than this engine
    // papering over it with an extrapolation nobody could stand behind.
    //
    // Scaling is a per-holding WEIGHT operation and is therefore independent of
    // the date alignment above: it rescales each series' contribution, never its
    // observations. Both corrections are live here — the weights are renormalized
    // over the date-aligned series, not over the raw tails.
    const observedWeightSum = observed.reduce((s, o) => s + o.weight, 0);
    const proxiedWeightSum = proxied.reduce((s, p) => s + p.weight, 0);
    const scaleFactor = observedWeightSum > 0
      ? Math.min(3, Math.max(0, 100 - proxiedWeightSum) / observedWeightSum)
      : 1;

    const len = aligned.series[0].length;
    const portReturns: number[] = new Array(len).fill(0);
    for (let k = 0; k < observed.length; k++) {
      const w = (observed[k].weight * scaleFactor) / 100;
      const rets = aligned.series[k];
      for (let i = 0; i < len; i++) portReturns[i] += w * rets[i];
    }

    const observedVol = stddev(portReturns) * Math.sqrt(252) * 100;

    // Add the proxied sleeve's variance. Assumed independent of the observed
    // sleeve — a deliberately CONSERVATIVE choice in the honest direction: real
    // illiquid assets are positively correlated with public markets, so true
    // portfolio vol is at least this, never less.
    let totalVar = (observedVol / 100) ** 2;
    for (const p of proxied) {
      totalVar += ((p.weight / 100) * (p.vol / 100)) ** 2;
    }
    annualizedVolatility = Math.round(Math.sqrt(totalVar) * 100 * 10) / 10;

    const ratios = computeRiskAdjustedRatios(portReturns, ctx.riskFreeAnnual ?? 0.0425);
    sharpeRatio = ratios.sharpe != null ? Math.round(ratios.sharpe * 100) / 100 : null;
    sortinoRatio = ratios.sortino != null ? Math.round(ratios.sortino * 100) / 100 : null;
    dd = Math.round(maxDrawdown(portReturns) * 10) / 10;

    const v = Math.abs(quantile(portReturns, 0.05)) * 100;
    var95Pct = Math.round(v * 100) / 100;

    // CVaR / expected shortfall — the average loss in the worst 5% of days, i.e.
    // "when it's bad, HOW bad?". VaR alone says nothing about the tail beyond it.
    const threshold = quantile(portReturns, 0.05);
    const tail = portReturns.filter((r) => r <= threshold);
    if (tail.length > 0) {
      cvar95Pct = Math.round(Math.abs(mean(tail)) * 100 * 100) / 100;
    }

    // Beta vs the benchmark — cov(p,b)/var(b) over the SAME sessions.
    //
    // The portfolio series and the benchmark series are both dated, so they are
    // joined on the calendar. Previously both were tail-sliced to a common
    // LENGTH, which only coincides with a common calendar when the portfolio's
    // observed sleeve trades on exactly SPY's sessions — false the moment the
    // book holds crypto (365 sessions a year) or a foreign listing (different
    // holidays), and false in a way that quietly biases beta toward zero, since
    // mismatched pairs decorrelate.
    const paired = alignPair(
      { dates: aligned.dates, returns: portReturns },
      { dates: ctx.benchmarkDates ?? [], returns: ctx.benchmarkReturns },
    );
    if (paired && paired[0].length >= 25) {
      const [a, b] = paired;
      const covPS = pearson(a, b) * stddev(a) * stddev(b);
      const varB = stddev(b) ** 2;
      if (varB > 0) beta = Math.round((covPS / varB) * 100) / 100;
    }
  }

  /* ---- Cross-asset risks, straight from the factor exposures ---- */

  const factorMap = new Map(allocation.byFactor.map((f) => [f.factor, f.exposure]));

  // Net rate sensitivity is -duration by construction, so duration = -exposure.
  const ratesExposure = factorMap.get("rates") ?? null;
  const duration = ratesExposure != null ? Math.round(-ratesExposure * 10) / 10 : null;

  const creditSensitivity = factorMap.get("creditSpread") ?? null;

  // MEASURED, not read off the raw `inflation` loading. Assets priced by a complex
  // (gold, oil) carry no `inflation` loading — their inflation response lives in
  // their own factor — so reading the raw exposure would report a gold-heavy
  // portfolio as having zero inflation protection. See INFLATION_1PP.
  const inflationSens = inflationSensitivity(holdings, totalValue);

  const base = ctx.baseCurrency.toUpperCase();
  const foreignCurrencyPct = allocation.byCurrency.slices
    .filter((s) => s.key !== base)
    .reduce((sum, s) => sum + s.weight, 0);

  // Weight AND count, from the one shared definition of illiquid — so the Risk
  // Lab's figure and the Holdings tab's ILLIQUID badge always describe the same
  // set of holdings.
  const illiquidPct = allocation.byLiquidity.slices
    .filter((s) => isIlliquid(s.key as Liquidity))
    .reduce((sum, s) => sum + s.weight, 0);
  const illiquidHoldings = holdings.filter((h) => isIlliquid(h.liquidity)).length;

  const concentrationRisk: "low" | "medium" | "high" =
    hhi > 2500 || topHoldingWeight > 25 || topAssetClassWeight > 85 ? "high"
    : hhi > 1500 || topHoldingWeight > 15 || topAssetClassWeight > 70 ? "medium"
    : "low";

  return {
    annualizedVolatility,
    beta,
    benchmarkLabel: ctx.benchmarkLabel ?? null,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: dd,
    var95Pct,
    var95Dollar: var95Pct != null && totalValue > 0 ? Math.round((var95Pct / 100) * totalValue) : null,
    cvar95Pct,
    cvar95Dollar: cvar95Pct != null && totalValue > 0 ? Math.round((cvar95Pct / 100) * totalValue) : null,
    duration,
    creditSensitivity,
    foreignCurrencyPct: Math.round(foreignCurrencyPct * 10) / 10,
    illiquidPct: Math.round(illiquidPct * 10) / 10,
    illiquidHoldings,
    inflationSensitivity: inflationSens,
    positionHhi: Math.round(hhi),
    topHoldingWeight: Math.round(topHoldingWeight * 10) / 10,
    topAssetClassWeight: Math.round(topAssetClassWeight * 10) / 10,
    topSectorWeight: Math.round(topSectorWeight * 10) / 10,
    concentrationRisk,
    coverage,
    correlation: computeCorrelation(holdings, ctx),
  };
}
