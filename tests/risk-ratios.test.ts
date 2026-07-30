import { describe, it, expect } from "vitest";
import { computeRiskAdjustedRatios, downsideDeviation } from "@/lib/portfolio-analytics";

/** Deterministic pseudo-random daily returns around a drift. */
function syntheticReturns(days: number, dailyDrift: number, amplitude: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    // deterministic oscillation, mean ≈ dailyDrift
    out.push(dailyDrift + amplitude * Math.sin(i * 1.7));
  }
  return out;
}

describe("computeRiskAdjustedRatios", () => {
  it("produces a positive Sharpe for a portfolio beating the risk-free rate", () => {
    // ~12.6% annual drift (0.05% daily) with modest volatility.
    const returns = syntheticReturns(252, 0.0005, 0.008);
    const { sharpe } = computeRiskAdjustedRatios(returns);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeGreaterThan(0);
    // Regression: the old percent/decimal unit mix produced Sharpe ≈ -47 here.
    expect(sharpe!).toBeLessThan(10);
  });

  it("produces a negative Sharpe for a portfolio losing money", () => {
    const returns = syntheticReturns(252, -0.001, 0.008);
    const { sharpe } = computeRiskAdjustedRatios(returns);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeLessThan(0);
  });

  it("Sharpe ≈ 0 when returns exactly match the risk-free rate", () => {
    const dailyRf = 0.0425 / 252;
    const returns = syntheticReturns(252, dailyRf, 0.008);
    const { sharpe } = computeRiskAdjustedRatios(returns);
    expect(Math.abs(sharpe!)).toBeLessThan(0.15);
  });

  it("Sortino uses only sub-risk-free days as downside", () => {
    // Strong uptrend: most days above daily risk-free → downside set is small,
    // Sortino should comfortably exceed Sharpe.
    const returns = syntheticReturns(252, 0.001, 0.004);
    const { sharpe, sortino } = computeRiskAdjustedRatios(returns);
    expect(sortino).not.toBeNull();
    expect(sortino!).toBeGreaterThan(sharpe!);
  });

  it("returns nulls for a flat (zero-variance) series", () => {
    const { sharpe, sortino } = computeRiskAdjustedRatios(new Array(100).fill(0));
    expect(sharpe).toBeNull();
    expect(sortino).toBeNull();
  });

  it("returns nulls for an empty series", () => {
    const { sharpe, sortino } = computeRiskAdjustedRatios([]);
    expect(sharpe).toBeNull();
    expect(sortino).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Sortino regressions — the 2026-07-28 portfolio audit.

   The old denominator was `stddev(losing days)`: the dispersion of the losses
   about their OWN mean, divided by the LOSS COUNT, with a silent fallback to
   the full-series stddev whenever fewer than two losing days existed. All three
   of those are wrong, and all three fail in the flattering direction.
   ──────────────────────────────────────────────────────────────────────────── */

describe("downsideDeviation", () => {
  it("is zero when no return falls below the MAR", () => {
    expect(downsideDeviation([0.01, 0.02, 0.03], 0)).toBe(0);
  });

  it("measures shortfall from the MAR, not dispersion among the losses", () => {
    // Three identical −1% days against a MAR of 0. Their dispersion about their
    // own mean is exactly zero; their shortfall from the MAR is not.
    // sqrt((3·0.01²)/3)·√252 = 0.01·√252.
    expect(downsideDeviation([-0.01, -0.01, -0.01], 0)).toBeCloseTo(0.01 * Math.sqrt(252), 10);
  });

  it("divides by ALL periods, not just the losing ones", () => {
    // One −2% day in four. sqrt(0.02²/4)·√252 = 0.01·√252.
    expect(downsideDeviation([0.01, 0.01, 0.01, -0.02], 0)).toBeCloseTo(0.01 * Math.sqrt(252), 10);
    // Halving the frequency of the same loss must halve the deviation.
    const sparse = downsideDeviation([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, -0.02], 0);
    expect(sparse).toBeCloseTo(0.02 * Math.sqrt(252 / 8), 10);
  });

  it("ignores upside entirely — a bigger gain cannot change it", () => {
    const a = downsideDeviation([0.01, -0.01], 0);
    const b = downsideDeviation([0.99, -0.01], 0);
    expect(a).toBeCloseTo(b, 12);
  });
});

describe("Sortino ratio — audit regressions", () => {
  it("does not explode when losses are consistent in size", () => {
    // Alternating +0.25% / −0.20%. Every losing day is the same size, so the old
    // `stddev(losses)` denominator collapsed to ~5e-17 and Sortino came back as
    // 4.25e14 — an unbounded, meaningless number on a real portfolio shape.
    const returns: number[] = [];
    for (let i = 0; i < 252; i++) returns.push(i % 2 === 0 ? 0.0025 : -0.002);

    const { sortino } = computeRiskAdjustedRatios(returns);
    expect(sortino).not.toBeNull();
    expect(Number.isFinite(sortino!)).toBe(true);
    // Textbook value for this series is ~0.84, and in every case it must stay
    // inside the range any real risk-adjusted ratio occupies.
    expect(Math.abs(sortino!)).toBeLessThan(20);
    expect(sortino!).toBeCloseTo(0.84, 1);
  });

  it("is null — not a copy of Sharpe — when the series has no downside at all", () => {
    // Every day beats the daily risk-free rate, so downside deviation is 0 and
    // the ratio is genuinely undefined. The old code fell back to the full-series
    // stddev and returned the Sharpe ratio wearing Sortino's label.
    const returns = new Array(251).fill(0.001);
    returns.push(0.002); // real dispersion, so Sharpe stays defined
    const { sharpe, sortino } = computeRiskAdjustedRatios(returns);
    expect(sortino).toBeNull();
    expect(sharpe).not.toBeNull();
  });

  it("does not divide by floating-point residue on a constant series", () => {
    // 252 copies of 0.001 do not sum to exactly 252×0.001, so `stddev` returns
    // ~1e-19 instead of 0. A `> 0` guard let that through and reported a Sharpe
    // of 2.0e16. A variance must be zero-checked against an epsilon.
    const { sharpe, sortino } = computeRiskAdjustedRatios(new Array(252).fill(0.001));
    expect(sharpe).toBeNull();
    expect(sortino).toBeNull();
  });

  it("returns a finite ratio from ONE losing day rather than silently reusing Sharpe", () => {
    const returns = new Array(252).fill(0.0008);
    returns[10] = -0.05;
    const { sharpe, sortino } = computeRiskAdjustedRatios(returns);
    expect(sortino).not.toBeNull();
    // Previously these were bit-identical (2.1361323346699040 vs ...37) because
    // the <2-downside-days fallback used the full-series stddev.
    expect(sortino!).not.toBeCloseTo(sharpe!, 6);
  });

  it("shares Sharpe's numerator, so the two agree in sign", () => {
    for (const drift of [0.0015, -0.0015]) {
      const returns = syntheticReturns(252, drift, 0.008);
      const { sharpe, sortino } = computeRiskAdjustedRatios(returns);
      expect(Math.sign(sharpe!)).toBe(Math.sign(sortino!));
    }
  });

  it("exceeds Sharpe when downside is milder than total volatility", () => {
    const returns = syntheticReturns(252, 0.001, 0.004);
    const { sharpe, sortino } = computeRiskAdjustedRatios(returns);
    expect(sortino!).toBeGreaterThan(sharpe!);
    // ...but by a believable margin, not the ~64% inflation the loss-count
    // denominator produced.
    expect(sortino!).toBeLessThan(sharpe! * 3);
  });

  it("matches a hand-computed textbook value", () => {
    // Four periods, MAR = 0: [+2%, −1%, +3%, −2%].
    // excess (rf=0) = mean·252 = (0.02−0.01+0.03−0.02)/4·252 = 0.005·252 = 1.26
    // σ_D = sqrt((0.01² + 0.02²)/4)·√252 = sqrt(0.000125)·√252
    const returns = [0.02, -0.01, 0.03, -0.02];
    const { sortino } = computeRiskAdjustedRatios(returns, 0);
    const expected = (0.005 * 252) / (Math.sqrt(0.000125) * Math.sqrt(252));
    expect(sortino!).toBeCloseTo(expected, 10);
  });
});
