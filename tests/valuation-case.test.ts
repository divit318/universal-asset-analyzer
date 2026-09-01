import { describe, expect, it } from "vitest";
import { runDcf } from "@/lib/valuation/dcf";
import {
  assumptionsAtGrowth,
  impliedGrowthGap,
  solveImpliedGrowth,
  STAGE_TWO_FADE,
  type ReverseDcfInput,
} from "@/lib/valuation/reverse";
import {
  applyAiProposals,
  applyUserEdits,
  assumptionsToDcf,
  caseFreshness,
  coerceAssumptionSet,
  computeCaseResult,
  diffAssumptions,
  isAssumptionKey,
  seedAssumptions,
  SEED_GROWTH_BAND_PCT,
  userAuthoredKeys,
  VALUATION_TTL_HOURS,
  type AssumptionSet,
} from "@/lib/valuation/case";

/** Apple-shaped: 100bn FCF, 15bn shares, 50bn net cash, priced at 232. */
const REVERSE: ReverseDcfInput = {
  baseFcf: 100e9,
  terminalGrowth: 2.5,
  discountRate: 9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
  price: 232,
};

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

/* -------------------------------------------------------------------------- */
/* Reverse DCF                                                                 */
/* -------------------------------------------------------------------------- */

describe("solveImpliedGrowth", () => {
  it("round-trips: feeding the solved growth back reproduces the price", () => {
    // The defining property. If this holds, the solver and the forward model
    // agree, which is the only thing that makes "the market is paying for X%"
    // a statement about this app's own model rather than a coincidence.
    const result = solveImpliedGrowth(REVERSE);
    expect(result.invalidReason).toBeNull();
    expect(result.bounded).toBe("none");

    const back = runDcf(assumptionsAtGrowth(REVERSE, result.impliedGrowth!));
    expect(back.fairValuePerShare).toBeCloseTo(REVERSE.price, 6);
  });

  it("fades stage two to half the solved stage-one rate", () => {
    const result = solveImpliedGrowth(REVERSE);
    expect(result.impliedGrowthStage2).toBeCloseTo(result.impliedGrowth! * STAGE_TWO_FADE, 10);
  });

  it("implies more growth at a higher price", () => {
    const cheap = solveImpliedGrowth({ ...REVERSE, price: 150 });
    const dear = solveImpliedGrowth({ ...REVERSE, price: 400 });
    expect(dear.impliedGrowth!).toBeGreaterThan(cheap.impliedGrowth!);
  });

  it("converges quickly", () => {
    expect(solveImpliedGrowth(REVERSE).iterations).toBeLessThan(80);
  });

  it("reports when the price sits outside the search band", () => {
    // Priced so low that even a collapsing business is worth more.
    const below = solveImpliedGrowth({ ...REVERSE, price: 0.01 });
    expect(below.bounded).toBe("below");
    expect(below.impliedGrowth).toBe(-50);

    // Priced beyond even hypergrowth.
    const above = solveImpliedGrowth({ ...REVERSE, price: 5_000_000 });
    expect(above.bounded).toBe("above");
    expect(above.impliedGrowth).toBe(100);
  });

  it("refuses to solve where implied growth has no single meaning", () => {
    // With negative FCF, value *falls* as growth rises and bisection is invalid.
    expect(solveImpliedGrowth({ ...REVERSE, baseFcf: -5e9 }).invalidReason).toBe("non_positive_fcf");
    expect(solveImpliedGrowth({ ...REVERSE, baseFcf: 0 }).invalidReason).toBe("non_positive_fcf");
    expect(solveImpliedGrowth({ ...REVERSE, price: 0 }).invalidReason).toBe("non_positive_price");
    // WACC at or below terminal growth breaks the forward model itself.
    expect(solveImpliedGrowth({ ...REVERSE, discountRate: 2 }).invalidReason)
      .toBe("assumptions_not_valuable");
  });
});

describe("impliedGrowthGap", () => {
  it("is positive when the market asks the business to accelerate", () => {
    expect(impliedGrowthGap(11.4, 8.1)).toBeCloseTo(3.3, 10);
    expect(impliedGrowthGap(5, 8.1)).toBeCloseTo(-3.1, 10);
    expect(impliedGrowthGap(null, 8.1)).toBeNull();
    expect(impliedGrowthGap(11.4, null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

describe("seedAssumptions", () => {
  it("seeds growth from what the business delivered, not from the market", () => {
    // Seeding at the market's own number would make fair value equal price and
    // margin of safety zero by construction, making every untouched case noise.
    const set = seedAssumptions(SEED);
    expect(set.growthRate1.value).toBeCloseTo(8.1, 10);
    // "history", not "yahoo": the figure is a derived growth rate over reported
    // fiscal years, not a field lifted straight off a quote.
    expect(set.growthRate1.source).toBe("history");
    expect(set.growthRate2.value).toBeCloseTo(8.1 * STAGE_TWO_FADE, 10);

    const result = computeCaseResult(set, SEED.price);
    expect(result.marginOfSafety).not.toBeNull();
    expect(Math.abs(result.marginOfSafety!)).toBeGreaterThan(0.01);
  });

  it("keeps the market's number beside it as an anchor", () => {
    const set = seedAssumptions(SEED);
    expect(set.growthRate1.anchors.hist5y).toBeCloseTo(8.1, 10);
    expect(set.growthRate1.anchors.impliedByMarket).toBeGreaterThan(0);
    // Both halves of the headline sentence are present on one assumption.
    const gap = impliedGrowthGap(set.growthRate1.anchors.impliedByMarket!, set.growthRate1.anchors.hist5y!);
    expect(gap).not.toBeNull();
  });

  it("falls back to the market's rate when there is no history, and says so", () => {
    const set = seedAssumptions({ ...SEED, deliveredGrowth: null });
    expect(set.growthRate1.source).toBe("reverse_dcf");
    expect(set.growthRate1.rationale).toContain("price would justify");
    // With no independent view, margin of safety is ~zero — which is honest.
    const result = computeCaseResult(set, SEED.price);
    expect(Math.abs(result.marginOfSafety!)).toBeLessThan(0.001);
  });

  it("records which basis the growth seed was built on", () => {
    const withBasis = seedAssumptions({ ...SEED, deliveredGrowthLabel: "FCF CAGR FY2021→FY2025" });
    expect(withBasis.growthRate1.rationale).toContain("FCF CAGR FY2021→FY2025");
  });

  it("clamps a history seed into the defensible band and says so", () => {
    // 68% delivered CAGR compounding for a decade is how a report once printed
    // 300x-spot values; −19% prices a going concern for liquidation. Band
    // edges from SEED_GROWTH_BAND_PCT, stated in percent (the IC report's old
    // private clamp confused fraction with percent and seeded 18.9% growth as
    // 0.25%).
    const hot = seedAssumptions({ ...SEED, deliveredGrowth: 68 });
    expect(hot.growthRate1.value).toBe(SEED_GROWTH_BAND_PCT.max);
    expect(hot.growthRate2.value).toBeCloseTo(SEED_GROWTH_BAND_PCT.max * STAGE_TWO_FADE, 10);
    expect(hot.growthRate1.rationale).toContain("68.0%");
    expect(hot.growthRate1.rationale).toContain("defensible band");

    const cold = seedAssumptions({ ...SEED, deliveredGrowth: -19 });
    expect(cold.growthRate1.value).toBe(SEED_GROWTH_BAND_PCT.min);

    // The TRUE delivered figure survives as the history anchor — the clamp
    // shapes the starting assumption, never the record of what happened.
    expect(hot.growthRate1.anchors.hist5y).toBe(68);
    expect(cold.growthRate1.anchors.hist5y).toBe(-19);
  });

  it("does not clamp in-band history seeds or the implied-rate fallback", () => {
    // In-band: seeded exactly at delivered, rationale free of clamp language.
    const inBand = seedAssumptions(SEED);
    expect(inBand.growthRate1.value).toBeCloseTo(8.1, 10);
    expect(inBand.growthRate1.rationale).not.toContain("defensible band");

    // No history → seeded at the implied rate even when it sits above the
    // band: clamping it would break the fair-value≈price property that makes
    // the fallback honest.
    const dear = seedAssumptions({ ...SEED, deliveredGrowth: null, price: 2_000 });
    expect(dear.growthRate1.source).toBe("reverse_dcf");
    expect(dear.growthRate1.value).toBeGreaterThan(SEED_GROWTH_BAND_PCT.max);
    const result = computeCaseResult(dear, 2_000);
    expect(Math.abs(result.marginOfSafety!)).toBeLessThan(0.001);
  });

  it("treats the facts as assumptions, each carrying its provenance", () => {
    const set = seedAssumptions(SEED);
    expect(set.baseFcf.source).toBe("yahoo");
    expect(set.sharesOutstanding.source).toBe("yahoo");
    expect(set.netDebt.source).toBe("yahoo");
    expect(set.discountRate.source).toBe("platform");
    expect(set.terminalGrowth.source).toBe("default");
    // Nothing is user-owned yet.
    expect(userAuthoredKeys(set)).toEqual([]);
  });

  it("round-trips through assumptionsToDcf", () => {
    const set = seedAssumptions(SEED);
    expect(assumptionsToDcf(set)).toEqual({
      baseFcf: 100e9,
      growthRate1: 8.1,
      growthRate2: 8.1 * STAGE_TWO_FADE,
      terminalGrowth: 2.5,
      discountRate: 9,
      sharesOutstanding: 15e9,
      netDebt: -50e9,
    });
  });
});

describe("computeCaseResult", () => {
  it("prices the case and reports the market's implied growth alongside", () => {
    const result = computeCaseResult(seedAssumptions(SEED), SEED.price);
    expect(result.fairValue).toBeGreaterThan(0);
    expect(result.fairValueBear!).toBeLessThan(result.fairValue!);
    expect(result.fairValueBull!).toBeGreaterThan(result.fairValue!);
    expect(result.impliedGrowth).toBeGreaterThan(0);
    expect(result.terminalValueShare).toBeGreaterThan(0);
    expect(result.invalidReason).toBeNull();
  });

  it("survives an unvaluable assumption set without throwing", () => {
    const set = applyUserEdits(seedAssumptions(SEED), [{ key: "discountRate", value: 1 }]);
    const result = computeCaseResult(set, SEED.price);
    expect(result.invalidReason).toBe("wacc_below_terminal_growth");
    expect(result.fairValue).toBeNull();
    expect(result.marginOfSafety).toBeNull();
  });

  it("handles a missing price", () => {
    const result = computeCaseResult(seedAssumptions(SEED), null);
    expect(result.fairValue).toBeGreaterThan(0);
    expect(result.marginOfSafety).toBeNull();
    expect(result.impliedGrowth).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Edits and the locked rule                                                   */
/* -------------------------------------------------------------------------- */

describe("applyUserEdits", () => {
  it("locks what the user authors and records why", () => {
    const set = applyUserEdits(
      seedAssumptions(SEED),
      [{ key: "growthRate1", value: 7, rationale: "Services decelerating." }],
      "2026-02-01T00:00:00.000Z",
    );
    expect(set.growthRate1.value).toBe(7);
    expect(set.growthRate1.source).toBe("user");
    expect(set.growthRate1.locked).toBe(true);
    expect(set.growthRate1.rationale).toBe("Services decelerating.");
    expect(set.growthRate1.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(userAuthoredKeys(set)).toEqual(["growthRate1"]);
  });

  it("leaves untouched assumptions exactly as they were", () => {
    const before = seedAssumptions(SEED);
    const after = applyUserEdits(before, [{ key: "growthRate1", value: 7 }]);
    expect(after.terminalGrowth).toEqual(before.terminalGrowth);
    expect(after.baseFcf).toEqual(before.baseFcf);
  });

  it("preserves the prior rationale when none is supplied", () => {
    const before = seedAssumptions(SEED);
    const after = applyUserEdits(before, [{ key: "baseFcf", value: 95e9 }]);
    expect(after.baseFcf.rationale).toBe(before.baseFcf.rationale);
  });

  it("ignores non-finite values rather than corrupting the case", () => {
    const before = seedAssumptions(SEED);
    const after = applyUserEdits(before, [{ key: "growthRate1", value: Number.NaN }]);
    expect(after.growthRate1.value).toBe(before.growthRate1.value);
    expect(after.growthRate1.locked).toBe(false);
  });
});

describe("applyAiProposals", () => {
  it("never overwrites an assumption the user owns", () => {
    // The load-bearing rule of the whole design: an AI that keeps proposing
    // numbers trains the user to stop thinking, so it may only object.
    const owned = applyUserEdits(seedAssumptions(SEED), [
      { key: "growthRate1", value: 7, rationale: "Services decelerating." },
    ]);

    const { assumptions, respected } = applyAiProposals(owned, [
      { key: "growthRate1", value: 9.2, rationale: "Peers at 7.4%, history 8.1%.", critique: "7% looks harsh versus a 5-year 8.1%." },
    ]);

    expect(assumptions.growthRate1.value).toBe(7);
    expect(assumptions.growthRate1.source).toBe("user");
    expect(assumptions.growthRate1.rationale).toBe("Services decelerating.");
    expect(assumptions.growthRate1.critique).toBe("7% looks harsh versus a 5-year 8.1%.");
    expect(respected).toEqual(["growthRate1"]);
  });

  it("falls back to the proposal's rationale as the objection", () => {
    const owned = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const { assumptions } = applyAiProposals(owned, [
      { key: "growthRate1", value: 9.2, rationale: "History says 8.1%." },
    ]);
    expect(assumptions.growthRate1.critique).toBe("History says 8.1%.");
  });

  it("does update assumptions the user has not claimed", () => {
    const { assumptions, respected } = applyAiProposals(seedAssumptions(SEED), [
      { key: "growthRate1", value: 9.2, rationale: "Segment mix." },
    ], "2026-03-01T00:00:00.000Z");
    expect(assumptions.growthRate1.value).toBe(9.2);
    expect(assumptions.growthRate1.source).toBe("ai");
    expect(assumptions.growthRate1.rationale).toBe("Segment mix.");
    expect(assumptions.growthRate1.locked).toBe(false);
    expect(respected).toEqual([]);
  });

  it("drops a stale objection when the user edits again", () => {
    const owned = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const critiqued = applyAiProposals(owned, [
      { key: "growthRate1", value: 9.2, rationale: "Too low." },
    ]).assumptions;
    expect(critiqued.growthRate1.critique).not.toBeNull();

    const reEdited = applyUserEdits(critiqued, [{ key: "growthRate1", value: 8 }]);
    // The objection was to 7%, a number that no longer exists.
    expect(reEdited.growthRate1.critique).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Diffing, freshness, validation                                              */
/* -------------------------------------------------------------------------- */

describe("diffAssumptions", () => {
  it("reports only what moved, with labels and rate flags", () => {
    const before = seedAssumptions(SEED);
    const after = applyUserEdits(before, [
      { key: "growthRate1", value: 4.1 },
      { key: "baseFcf", value: 95e9 },
    ]);

    const changes = diffAssumptions(before, after);
    expect(changes).toHaveLength(2);

    const growth = changes.find((c) => c.key === "growthRate1")!;
    expect(growth.from).toBeCloseTo(8.1, 10);
    expect(growth.to).toBe(4.1);
    expect(growth.delta).toBeCloseTo(-4, 10);
    expect(growth.isRate).toBe(true);
    expect(growth.label).toBe("FCF growth Y1–5");

    expect(changes.find((c) => c.key === "baseFcf")!.isRate).toBe(false);
  });

  it("is empty for identical sets", () => {
    const set = seedAssumptions(SEED);
    expect(diffAssumptions(set, set)).toEqual([]);
  });
});

describe("caseFreshness", () => {
  it("treats a case as current for a quarter and stale well after", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const hour = 3_600_000;
    expect(caseFreshness(new Date(now - 10 * 24 * hour).toISOString(), now).level).toBe("fresh");
    expect(caseFreshness(new Date(now - 120 * 24 * hour).toISOString(), now).level).toBe("aging");
    expect(caseFreshness(new Date(now - 400 * 24 * hour).toISOString(), now).level).toBe("stale");
    expect(caseFreshness(null, now).level).toBe("stale");
    expect(VALUATION_TTL_HOURS).toBe(24 * 90);
  });
});

describe("coerceAssumptionSet", () => {
  it("round-trips a real set through JSON", () => {
    const set = seedAssumptions(SEED);
    const parsed = coerceAssumptionSet(JSON.parse(JSON.stringify(set)) as unknown);
    expect(parsed).toEqual(set);
  });

  it("rejects anything it cannot fully rebuild", () => {
    // A half-built model would produce a confident wrong fair value, which is
    // worse than refusing and re-seeding.
    const set = seedAssumptions(SEED) as unknown as Record<string, unknown>;
    const missingKey = { ...set };
    delete missingKey.terminalGrowth;
    expect(coerceAssumptionSet(missingKey)).toBeNull();

    const badValue = JSON.parse(JSON.stringify(set)) as Record<string, { value: unknown }>;
    badValue.growthRate1.value = "eight";
    expect(coerceAssumptionSet(badValue)).toBeNull();

    expect(coerceAssumptionSet(null)).toBeNull();
    expect(coerceAssumptionSet("nope")).toBeNull();
    expect(coerceAssumptionSet({})).toBeNull();
  });

  it("defaults an unrecognised source rather than failing the whole case", () => {
    const set = JSON.parse(JSON.stringify(seedAssumptions(SEED))) as Record<string, { source: string }>;
    set.growthRate1.source = "astrology";
    const parsed = coerceAssumptionSet(set) as AssumptionSet;
    expect(parsed).not.toBeNull();
    expect(parsed.growthRate1.source).toBe("default");
  });
});

describe("isAssumptionKey", () => {
  it("gates API input to known assumptions", () => {
    expect(isAssumptionKey("growthRate1")).toBe(true);
    expect(isAssumptionKey("discountRate")).toBe(true);
    expect(isAssumptionKey("magic")).toBe(false);
    expect(isAssumptionKey(7)).toBe(false);
  });
});
