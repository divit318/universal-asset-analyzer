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

  it("trims a badly overweight position on a small portfolio even though the dollar delta is under the $50 floor", () => {
    // Reproduces a reported bug: 0.098910296 shares @ $210.96 = ~$20.87 of a
    // ~$99.85 book = 20.9% actual vs. a 9.0% target. The dollar gap (~$11.87)
    // is under the flat $50 no-trade floor, but an 11.9-percentage-point gap
    // (more than double the target) must never be reported as "near target".
    const a = computePositionAction({
      ...base,
      isInPortfolio: true,
      price: 210.96,
      currentShares: 0.098910296,
      portfolioValue: 99.85,
      targetPct: 9,
    });
    expect(a.currentPct).toBeCloseTo(20.9, 1);
    expect(a.kind).toBe("trim");
    expect(a.headline).not.toContain("Hold");
  });

  it("initiates a well-fitting new position on a small portfolio even though the dollar delta is under the $50 floor", () => {
    // Reproduces the mirror-image of the trim bug on the initiate path: 11%
    // of a ~$100 book is only ~$11 (under the flat $50 floor), but a "good"
    // fit with a meaningful double-digit target must not be reported as
    // "doesn't fit the portfolio" — that conflates a sizing-floor artifact
    // with an actual fit-model rejection.
    const a = computePositionAction({
      ...base,
      isInPortfolio: false,
      fitTier: "good",
      price: 245.34,
      currentShares: 0,
      portfolioValue: 99.85,
      targetPct: 11,
    });
    expect(a.kind).toBe("initiate");
    expect(a.headline).not.toContain("Skip");
  });

  it("still holds a small portfolio position that is genuinely close to target", () => {
    // Same tiny-portfolio scale, but only ~0.5pp off target — should hold.
    const a = computePositionAction({
      ...base,
      isInPortfolio: true,
      price: 210.96,
      currentShares: 0.045,
      portfolioValue: 99.85,
      targetPct: 9.0,
    });
    expect(Math.abs(a.currentPct - a.targetPct)).toBeLessThan(1.5);
    expect(a.kind).toBe("hold");
  });
});
