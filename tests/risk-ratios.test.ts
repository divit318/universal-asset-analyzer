import { describe, it, expect } from "vitest";
import { computeRiskAdjustedRatios } from "@/lib/portfolio-analytics";

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
