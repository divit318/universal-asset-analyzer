import { describe, expect, it } from "vitest";
import { revalueCase, type ReportedFacts } from "@/lib/valuation/revaluation";
import {
  calibrateAssumptions,
  calibrationEntriesFor,
  type CalibrationEntry,
} from "@/lib/valuation/calibration";
import {
  applyUserEdits,
  computeCaseResult,
  seedAssumptions,
  type ValuationCase,
} from "@/lib/valuation/case";
import type { DeliveredGrowth } from "@/lib/valuation/prefill";

const SEED = {
  baseFcf: 100e9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
  price: 232,
  discountRate: 9,
  terminalGrowth: 2.5,
  deliveredGrowth: 8.1,
  now: "2026-01-15T00:00:00.000Z",
};

function delivered(value: number | null, isProxy = false): DeliveredGrowth {
  return {
    value,
    basis: value == null ? "none" : isProxy ? "ttm_revenue" : "fcf_cagr",
    window: value == null ? null : "FY2021→FY2025",
    label: value == null ? "No growth history" : isProxy ? "TTM revenue growth (proxy)" : "FCF CAGR FY2021→FY2025",
    isProxy,
  };
}

function makeCase(assumptions = seedAssumptions(SEED)): ValuationCase {
  return {
    symbol: "AAPL",
    currency: "USD",
    method: "dcf_fcf",
    version: 2,
    author: "user",
    assumptions,
    result: computeCaseResult(assumptions, SEED.price),
    priceAt: SEED.price,
    createdAt: SEED.now,
    updatedAt: SEED.now,
    lastUserEventAt: SEED.now,
  };
}

function facts(over: Partial<ReportedFacts> = {}): ReportedFacts {
  return {
    baseFcf: 100e9,
    sharesOutstanding: 15e9,
    netDebt: -50e9,
    price: 232,
    delivered: delivered(8.1),
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Revaluation                                                                 */
/* -------------------------------------------------------------------------- */

describe("revalueCase", () => {
  it("reports no change when the reported figures match the case", () => {
    const outcome = revalueCase(makeCase(), facts());
    expect(outcome.changed).toBe(false);
    expect(outcome.factChanges).toEqual([]);
    expect(outcome.severity).toBe("intact");
    expect(outcome.headline).toContain("still holds");
  });

  it("refreshes unclaimed facts and revalues on them", () => {
    const outcome = revalueCase(makeCase(), facts({ baseFcf: 60e9 }));
    expect(outcome.changed).toBe(true);
    expect(outcome.assumptions.baseFcf.value).toBe(60e9);
    expect(outcome.assumptions.baseFcf.rationale).toContain("Refreshed from the latest reported");
    expect(outcome.after.fairValue!).toBeLessThan(outcome.before.fairValue!);
    expect(outcome.fairValueChange!).toBeLessThan(-0.2);
    expect(outcome.severity).toBe("broken");
  });

  it("never overwrites a fact the user set themselves", () => {
    // The same rule AI obeys. A new filing may disagree with the user's own
    // normalised FCF, but it does not get to replace it.
    const owned = applyUserEdits(seedAssumptions(SEED), [
      { key: "baseFcf", value: 90e9, rationale: "Normalised for the litigation charge." },
    ]);
    const outcome = revalueCase(makeCase(owned), facts({ baseFcf: 60e9 }));

    expect(outcome.assumptions.baseFcf.value).toBe(90e9);
    expect(outcome.assumptions.baseFcf.source).toBe("user");
    expect(outcome.contradictedByReport).toEqual(["baseFcf"]);
    expect(outcome.changed).toBe(false);
    expect(outcome.headline).toContain("left untouched");
  });

  it("flags a margin of safety that has gone negative", () => {
    // Seeded at a cash flow high enough that the case starts *above* the price,
    // which is what makes a flip observable.
    const rich = seedAssumptions({ ...SEED, baseFcf: 220e9 });
    const base = { ...makeCase(rich), result: computeCaseResult(rich, SEED.price) };
    expect(base.result.marginOfSafety!).toBeGreaterThan(0);

    const outcome = revalueCase(base, facts({ baseFcf: 110e9 }));
    expect(outcome.marginFlipped).toBe(true);
    expect(outcome.severity).toBe("broken");
    expect(outcome.headline).toContain("margin of safety is now negative");
  });

  it("treats a modest deterioration as a warning, not a break", () => {
    const outcome = revalueCase(makeCase(), facts({ baseFcf: 88e9 }));
    expect(outcome.severity).toBe("watch");
    expect(outcome.headline).toContain("weakened");
  });

  it("warns when the case assumes materially more growth than delivered", () => {
    // Same facts, but the record now shows the business growing far slower than
    // the case assumes — the assumption is the problem, not the cash flow.
    const outcome = revalueCase(makeCase(), facts({ delivered: delivered(4.1) }));
    expect(outcome.growthGap).toBeCloseTo(8.1 - 4.1, 6);
    expect(outcome.severity).toBe("watch");
    expect(outcome.headline).toContain("4.1%");
  });

  it("compares before and after at the same price, isolating the figures", () => {
    // Otherwise a market move would be indistinguishable from a change in the
    // business, which is the whole thing this is trying to tell apart.
    const outcome = revalueCase(makeCase(), facts({ baseFcf: 80e9, price: 500 }));
    const expectedBefore = computeCaseResult(makeCase().assumptions, 500);
    expect(outcome.before.fairValue).toBeCloseTo(expectedBefore.fairValue!, 6);
  });

  it("ignores a nonsensical share count instead of breaking the case on it", () => {
    // A zero or negative share count is a feed glitch, not news. Writing it would
    // make the case unvaluable on the strength of bad data.
    for (const bad of [0, -1]) {
      const outcome = revalueCase(makeCase(), facts({ sharesOutstanding: bad }));
      expect(outcome.assumptions.sharesOutstanding.value).toBe(15e9);
      expect(outcome.changed).toBe(false);
      expect(outcome.after.invalidReason).toBeNull();
    }
  });

  it("does accept a negative free cash flow, which is real news", () => {
    const outcome = revalueCase(makeCase(), facts({ baseFcf: -5e9 }));
    expect(outcome.assumptions.baseFcf.value).toBe(-5e9);
    expect(outcome.changed).toBe(true);
    expect(outcome.severity).toBe("broken");
  });

  it("leaves the original case untouched", () => {
    const original = makeCase();
    const snapshot = original.assumptions.baseFcf.value;
    revalueCase(original, facts({ baseFcf: 1e9 }));
    expect(original.assumptions.baseFcf.value).toBe(snapshot);
  });
});

/* -------------------------------------------------------------------------- */
/* Calibration                                                                 */
/* -------------------------------------------------------------------------- */

describe("calibrationEntriesFor", () => {
  it("grades only assumptions the user owns", () => {
    // A seeded or AI-authored number says nothing about the user's judgment.
    expect(calibrationEntriesFor(makeCase(), delivered(6))).toEqual([]);

    const owned = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 10 }]);
    const entries = calibrationEntriesFor(makeCase(owned), delivered(6));
    expect(entries).toHaveLength(1);
    expect(entries[0].biasPp).toBeCloseTo(4, 6);
  });

  it("needs something to compare against", () => {
    const owned = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 10 }]);
    expect(calibrationEntriesFor(makeCase(owned), delivered(null))).toEqual([]);
  });
});

describe("calibrateAssumptions", () => {
  const entry = (symbol: string, assumed: number, deliveredPct: number): CalibrationEntry => ({
    symbol, key: "growthRate1", assumed, delivered: deliveredPct,
    deliveredLabel: "FCF CAGR", biasPp: assumed - deliveredPct, assumedAt: SEED.now,
  });

  it("refuses to draw a conclusion from too small a sample", () => {
    const report = calibrateAssumptions([entry("A", 12, 6), entry("B", 11, 5)]);
    expect(report.verdict).toBe("insufficient");
    expect(report.summary).toContain("minimum before a pattern");
  });

  it("says nothing at all when there is nothing to grade", () => {
    const report = calibrateAssumptions([]);
    expect(report.verdict).toBe("insufficient");
    expect(report.meanBiasPp).toBeNull();
    expect(report.summary).toContain("No calibration yet");
  });

  it("calls out a consistent optimistic lean", () => {
    const report = calibrateAssumptions([
      entry("A", 12, 6), entry("B", 11, 5), entry("C", 10, 6), entry("D", 9, 5),
    ]);
    expect(report.verdict).toBe("optimistic");
    expect(report.meanBiasPp!).toBeCloseTo(5, 6);
    expect(report.optimisticCount).toBe(4);
    expect(report.summary).toContain("above what those businesses delivered");
  });

  it("recognises a consistently conservative user", () => {
    const report = calibrateAssumptions([
      entry("A", 4, 9), entry("B", 5, 10), entry("C", 3, 8), entry("D", 6, 11),
    ]);
    expect(report.verdict).toBe("pessimistic");
    expect(report.summary).toContain("conservative");
  });

  it("accepts a small average gap as well calibrated", () => {
    const report = calibrateAssumptions([
      entry("A", 8, 8), entry("B", 9, 8), entry("C", 7, 8), entry("D", 8, 9),
    ]);
    expect(report.verdict).toBe("well_calibrated");
    expect(report.summary).toContain("effectively unbiased");
  });

  it("does not mistake a few large misses for a habit", () => {
    // Mean is badly positive, but most entries lean the other way — that is
    // volatility, not optimism, and calling it a bias would be wrong.
    const report = calibrateAssumptions([
      entry("A", 40, 5), entry("B", 38, 4), entry("C", 6, 8), entry("D", 5, 9),
      entry("E", 6, 9), entry("F", 7, 10),
    ]);
    expect(report.meanBiasPp!).toBeGreaterThan(1.5);
    expect(report.verdict).toBe("inconsistent");
    expect(report.summary).toContain("inconsistent");
  });

  it("reports median and absolute bias alongside the mean", () => {
    const report = calibrateAssumptions([entry("A", 12, 6), entry("B", 4, 8), entry("C", 10, 6)]);
    expect(report.medianBiasPp).toBeCloseTo(4, 6);
    expect(report.meanAbsBiasPp!).toBeCloseTo((6 + 4 + 4) / 3, 6);
  });
});
