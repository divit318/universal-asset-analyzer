import { describe, it, expect } from "vitest";
import { computePositionAction, type PositionActionInput } from "@/lib/position-action";

const base: PositionActionInput = {
  symbol: "AAPL",
  price: 100,
  portfolioValue: 10000,
  currentShares: 0,
  targetPct: 4,
  fitTier: "good",
  isInPortfolio: false,
  concentrationWarning: false,
};

describe("computePositionAction", () => {
  it("initiates a new position sized to the target weight", () => {
    const a = computePositionAction(base);
    expect(a.kind).toBe("initiate");
    // 4% of $10k = $400 → 4 shares at $100
    expect(a.deltaShares).toBeCloseTo(4, 6);
    expect(a.deltaAmount).toBeCloseTo(400, 6);
    expect(a.headline).toContain("Buy 4 shares");
    expect(a.targetPct).toBe(4);
  });

  it("adds to an underweight existing position", () => {
    const a = computePositionAction({ ...base, isInPortfolio: true, currentShares: 1, targetPct: 5 });
    // target 5% = $500 = 5 shares; hold 1 → buy 4
    expect(a.kind).toBe("add");
    expect(a.deltaShares).toBeCloseTo(4, 6);
    expect(a.currentPct).toBeCloseTo(1, 6); // 1 share * $100 / $10k = 1%
  });

  it("trims an overweight existing position", () => {
    const a = computePositionAction({ ...base, isInPortfolio: true, currentShares: 10, targetPct: 4 });
    // hold 10 ($1000 = 10%), target 4% = 4 shares → sell 6
    expect(a.kind).toBe("trim");
    expect(a.deltaShares).toBeCloseTo(-6, 6);
    expect(a.headline).toContain("Sell 6");
  });

  it("holds when already within the no-trade band", () => {
    const a = computePositionAction({ ...base, isInPortfolio: true, currentShares: 4, targetPct: 4 });
    expect(a.kind).toBe("hold");
    expect(Math.abs(a.deltaAmount)).toBeLessThan(50);
  });

  it("recommends exit for an avoid-tier holding", () => {
    const a = computePositionAction({ ...base, isInPortfolio: true, currentShares: 5, fitTier: "avoid", targetPct: 0 });
    expect(a.kind).toBe("exit");
    expect(a.headline).toContain("Exit");
  });

  it("skips an avoid-tier non-holding", () => {
    const a = computePositionAction({ ...base, fitTier: "avoid", targetPct: 0 });
    expect(a.kind).toBe("avoid");
    expect(a.headline).toContain("Skip");
  });

  it("only carries a concentration warning on buys", () => {
    const buy = computePositionAction({ ...base, concentrationWarning: true });
    expect(buy.concentrationWarning).toBe(true);
    const hold = computePositionAction({ ...base, isInPortfolio: true, currentShares: 4, concentrationWarning: true });
    expect(hold.kind).toBe("hold");
    expect(hold.concentrationWarning).toBe(false);
  });

  it("handles fractional shares on a small portfolio", () => {
    const a = computePositionAction({ ...base, price: 850, portfolioValue: 500, targetPct: 20 });
    // 20% of $500 = $100 / $850 ≈ 0.1176 shares
    expect(a.deltaShares).toBeCloseTo(100 / 850, 4);
    expect(a.kind).toBe("initiate");
  });
});
