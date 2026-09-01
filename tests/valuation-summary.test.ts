import { describe, expect, it } from "vitest";
import { deriveDeliveredGrowth } from "@/lib/valuation/prefill";
import type { FinancialStatements } from "@/lib/types";
import {
  CASE_FLAG_LABEL,
  caseFlags,
  compareForRegister,
  summarizeForDisplay,
  type ValuationSummary,
} from "@/lib/valuation/summary";
import {
  applyUserEdits,
  computeCaseResult,
  seedAssumptions,
  type ValuationCase,
} from "@/lib/valuation/case";

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

function makeCase(over: Partial<ValuationCase> = {}, priceAt = SEED.price): ValuationCase {
  const assumptions = over.assumptions ?? seedAssumptions(SEED);
  return {
    symbol: "AAPL",
    currency: "USD",
    method: "dcf_fcf",
    version: 1,
    author: "reverse",
    assumptions,
    result: computeCaseResult(assumptions, priceAt),
    priceAt,
    createdAt: SEED.now,
    updatedAt: new Date().toISOString(),
    lastUserEventAt: null,
    ...over,
  };
}

function statements(fcf: { fy: number; value: number }[], fcfCagr: number | null): FinancialStatements {
  return {
    symbol: "AAPL",
    fiscalYears: fcf.map((p) => p.fy),
    revenue: [], grossProfit: [], operatingIncome: [], netIncome: [],
    freeCashFlow: fcf,
    grossMargin: [], operatingMargin: [], netMargin: [],
    revenueCagr: null,
    fcfCagr,
  };
}

/* -------------------------------------------------------------------------- */
/* Delivered growth: real FCF CAGR, honest fallback                            */
/* -------------------------------------------------------------------------- */

describe("deriveDeliveredGrowth", () => {
  it("prefers measured free cash flow growth and names its window", () => {
    const result = deriveDeliveredGrowth(
      statements([{ fy: 2021, value: 80e9 }, { fy: 2025, value: 110e9 }], 0.0817),
      0.05,
    );
    expect(result.basis).toBe("fcf_cagr");
    expect(result.value).toBeCloseTo(8.17, 6);
    expect(result.window).toBe("FY2021→FY2025");
    expect(result.label).toBe("FCF CAGR FY2021→FY2025");
    expect(result.isProxy).toBe(false);
  });

  it("falls back to revenue growth and flags itself as a proxy", () => {
    // Negative FCF at an endpoint makes a CAGR meaningless, so lib/statements.ts
    // returns null rather than inventing one — and the seed must not pretend it
    // measured cash-flow growth.
    const result = deriveDeliveredGrowth(
      statements([{ fy: 2021, value: -5e9 }, { fy: 2025, value: 20e9 }], null),
      0.123,
    );
    expect(result.basis).toBe("ttm_revenue");
    expect(result.value).toBeCloseTo(12.3, 6);
    expect(result.isProxy).toBe(true);
    expect(result.label).toContain("proxy");
  });

  it("reports no history rather than guessing", () => {
    const result = deriveDeliveredGrowth(null, null);
    expect(result.basis).toBe("none");
    expect(result.value).toBeNull();
    expect(result.isProxy).toBe(false);
  });

  it("ignores a CAGR with too few points to span a window", () => {
    const result = deriveDeliveredGrowth(statements([{ fy: 2025, value: 110e9 }], 0.08), 0.04);
    expect(result.basis).toBe("ttm_revenue");
  });
});

/* -------------------------------------------------------------------------- */
/* Display summary                                                             */
/* -------------------------------------------------------------------------- */

describe("summarizeForDisplay", () => {
  it("reprices against a live quote instead of trusting the stored margin", () => {
    // A case written at 232 must not still claim its old margin of safety after
    // the stock has run — the market moving is not the user changing their mind.
    const vcase = makeCase({}, 232);
    const atWrite = summarizeForDisplay(vcase);
    const live = summarizeForDisplay(vcase, 400);

    expect(atWrite.priceIsLive).toBe(false);
    expect(live.priceIsLive).toBe(true);
    expect(live.price).toBe(400);
    expect(live.result.marginOfSafety!).toBeLessThan(atWrite.result.marginOfSafety!);
    // Repricing must not touch the assumptions themselves.
    expect(live.result.fairValue).toBeCloseTo(atWrite.result.fairValue!, 8);
  });

  it("reports how much of the case is the user's own judgment", () => {
    const untouched = summarizeForDisplay(makeCase());
    expect(untouched.ownedKeys).toEqual([]);
    expect(untouched.untouched).toBe(true);

    const owned = seedAssumptions(SEED);
    const edited = applyUserEdits(owned, [{ key: "growthRate1", value: 7 }]);
    const summary = summarizeForDisplay(makeCase({
      assumptions: edited,
      lastUserEventAt: new Date().toISOString(),
    }));
    expect(summary.ownedKeys).toEqual(["growthRate1"]);
    expect(summary.untouched).toBe(false);
  });

  it("names the methodology so equity-only is never implicit", () => {
    expect(summarizeForDisplay(makeCase()).methodLabel).toBe("Discounted free cash flow");
  });
});

/* -------------------------------------------------------------------------- */
/* Register flags and ordering                                                 */
/* -------------------------------------------------------------------------- */

describe("caseFlags", () => {
  it("flags a case that can no longer be valued", () => {
    const broken = applyUserEdits(seedAssumptions(SEED), [{ key: "discountRate", value: 1 }]);
    const flags = caseFlags(summarizeForDisplay(makeCase({ assumptions: broken })));
    expect(flags).toContain("unvaluable");
  });

  it("flags a price above the case's own value — but only once the case is someone's", () => {
    // "Priced above your case" is a claim about the user's judgment. An
    // untouched machine seed carries none, so however far the price runs past
    // it, the only honest flag is "untouched" — otherwise every seeded growth
    // name lands in the Register pre-flagged red for disagreeing with
    // assumptions nobody holds.
    const seedFlags = caseFlags(summarizeForDisplay(makeCase(), 100_000));
    expect(seedFlags).not.toContain("negative_margin");
    expect(seedFlags).toContain("untouched");

    const edited = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const ownedFlags = caseFlags(summarizeForDisplay(
      makeCase({ assumptions: edited, lastUserEventAt: new Date().toISOString() }),
      100_000,
    ));
    expect(ownedFlags).toContain("negative_margin");
  });

  it("flags a case the user has never touched", () => {
    expect(caseFlags(summarizeForDisplay(makeCase()))).toContain("untouched");
  });

  it("flags a case nobody has revisited in months", () => {
    const old = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString();
    expect(caseFlags(summarizeForDisplay(makeCase({ updatedAt: old })))).toContain("stale");
  });

  it("says nothing about a current, user-owned, fairly-priced case", () => {
    const edited = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const vcase = makeCase({
      assumptions: edited,
      lastUserEventAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const fair = summarizeForDisplay(vcase, vcase.result.fairValue! * 0.75);
    expect(caseFlags(fair)).toEqual([]);
  });

  it("has a label for every flag it can raise", () => {
    const broken = applyUserEdits(seedAssumptions(SEED), [{ key: "discountRate", value: 1 }]);
    for (const flag of caseFlags(summarizeForDisplay(makeCase({ assumptions: broken })))) {
      expect(CASE_FLAG_LABEL[flag]).toBeTruthy();
    }
  });
});

describe("compareForRegister", () => {
  it("puts cases needing attention above healthy ones", () => {
    const healthyAssumptions = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const healthyCase = makeCase({
      assumptions: healthyAssumptions,
      lastUserEventAt: new Date().toISOString(),
    });
    const healthy = summarizeForDisplay(healthyCase, healthyCase.result.fairValue! * 0.75);
    const broken = summarizeForDisplay(
      makeCase({ assumptions: applyUserEdits(seedAssumptions(SEED), [{ key: "discountRate", value: 1 }]) }),
    );

    expect([healthy, broken].sort(compareForRegister)[0].result.invalidReason).not.toBeNull();
  });

  it("orders equally-flagged cases by thinnest margin of safety first", () => {
    // Not by biggest upside: the Register surfaces what has gone wrong, it does
    // not rank ideas — that is the Screener's job.
    const thin = summarizeForDisplay(makeCase(), 230);
    const wide = summarizeForDisplay(makeCase(), 120);
    const [first] = [wide, thin].sort(compareForRegister);
    expect(first.result.marginOfSafety!).toBeLessThan(wide.result.marginOfSafety!);
  });

  it("sorts cases with no computable margin last", () => {
    const valued = summarizeForDisplay(makeCase(), 200);
    const unvalued: ValuationSummary = {
      ...valued,
      symbol: "ZZZ",
      result: { ...valued.result, marginOfSafety: null },
    };
    expect([unvalued, valued].sort(compareForRegister)[0].symbol).toBe("AAPL");
  });
});
