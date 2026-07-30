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
import type { Holding, MarketContext, PortfolioAssetClass } from "../model/types";
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
  holdingsObserved: number;
  holdingsProxied: number;
}

export interface UniversalRisk {
  /* Return-based (market-priced holdings + proxies) */
  annualizedVolatility: number | null;
  beta: number | null;
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
  /** Net inflation sensitivity: % change per 1pp inflation surprise. Negative = hurt by inflation. */
  inflationSensitivity: number | null;

  /* Concentration */
  hhi: number;
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

function returnsFrom(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) out.push((closes[i] - prev) / prev);
  }
  return out;
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

export function computeCorrelation(holdings: Holding[], ctx: MarketContext): CorrelationMatrix | null {
  const withHistory: { label: string; returns: number[] }[] = [];
  const excluded: string[] = [];

  for (const h of holdings) {
    const closes = h.symbol ? ctx.history.get(h.symbol.toUpperCase()) : undefined;
    if (closes && closes.length >= 30) {
      withHistory.push({ label: h.symbol ?? h.name, returns: returnsFrom(closes) });
    } else {
      excluded.push(h.symbol ?? h.name);
    }
  }

  if (withHistory.length < 2) return null;

  const symbols = withHistory.map((x) => x.label);
  const n = symbols.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  let sum = 0;
  let pairs = 0;
  const highPairs: { a: string; b: string; r: number }[] = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(withHistory[i].returns, withHistory[j].returns);
      matrix[i][j] = r;
      matrix[j][i] = r;
      sum += r;
      pairs++;
      if (r > 0.75) highPairs.push({ a: symbols[i], b: symbols[j], r });
    }
  }

  highPairs.sort((a, b) => b.r - a.r);

  return {
    symbols,
    matrix,
    highPairs: highPairs.slice(0, 8),
    avgCorrelation: pairs > 0 ? sum / pairs : 0,
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

  const observed: { weight: number; returns: number[] }[] = [];
  const proxied: { weight: number; vol: number }[] = [];
  let observedValue = 0;
  let proxiedValue = 0;

  for (const h of holdings) {
    const closes = h.symbol ? ctx.history.get(h.symbol.toUpperCase()) : undefined;
    const rets = closes && closes.length >= 30 ? returnsFrom(closes) : null;

    if (rets && rets.length >= 25) {
      observed.push({ weight: h.weight, returns: rets });
      observedValue += h.valuation.valueBase;
    } else {
      const vol = PROXY_VOLATILITY[h.assetClass];
      if (vol != null) {
        proxied.push({ weight: h.weight, vol });
        proxiedValue += h.valuation.valueBase;
      }
    }
  }

  const coverage: RiskCoverage = {
    observedPct: totalValue > 0 ? Math.round((observedValue / totalValue) * 100) : 0,
    proxiedPct: totalValue > 0 ? Math.round((proxiedValue / totalValue) * 100) : 0,
    holdingsObserved: observed.length,
    holdingsProxied: proxied.length,
  };

  let annualizedVolatility: number | null = null;
  let beta: number | null = null;
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;
  let dd: number | null = null;
  let var95Pct: number | null = null;
  let cvar95Pct: number | null = null;

  if (observed.length > 0) {
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
    const observedWeightSum = observed.reduce((s, o) => s + o.weight, 0);
    const proxiedWeightSum = proxied.reduce((s, p) => s + p.weight, 0);
    const scaleFactor = observedWeightSum > 0
      ? Math.min(3, Math.max(0, 100 - proxiedWeightSum) / observedWeightSum)
      : 1;

    const minLen = Math.min(...observed.map((o) => o.returns.length));
    const portReturns: number[] = new Array(minLen).fill(0);
    for (const { weight, returns } of observed) {
      const w = (weight * scaleFactor) / 100;
      const tail = returns.slice(-minLen);
      for (let i = 0; i < minLen; i++) portReturns[i] += w * tail[i];
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

    const ratios = computeRiskAdjustedRatios(portReturns);
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

    // Beta vs the benchmark.
    const bench = ctx.benchmarkReturns;
    if (bench.length >= 25) {
      const n = Math.min(portReturns.length, bench.length);
      const a = portReturns.slice(-n);
      const b = bench.slice(-n);
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

  const illiquidPct = allocation.byLiquidity.slices
    .filter((s) => s.key === "illiquid" || s.key === "t2")
    .reduce((sum, s) => sum + s.weight, 0);

  const concentrationRisk: "low" | "medium" | "high" =
    hhi > 2500 || topHoldingWeight > 25 || topAssetClassWeight > 85 ? "high"
    : hhi > 1500 || topHoldingWeight > 15 || topAssetClassWeight > 70 ? "medium"
    : "low";

  return {
    annualizedVolatility,
    beta,
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
    inflationSensitivity: inflationSens,
    hhi: Math.round(hhi),
    topHoldingWeight: Math.round(topHoldingWeight * 10) / 10,
    topAssetClassWeight: Math.round(topAssetClassWeight * 10) / 10,
    topSectorWeight: Math.round(topSectorWeight * 10) / 10,
    concentrationRisk,
    coverage,
    correlation: computeCorrelation(holdings, ctx),
  };
}
