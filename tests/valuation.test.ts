import { describe, expect, it } from "vitest";
import {
  type DcfAssumptions,
  buildScenarios,
  buildSensitivity,
  buildWaccRange,
  dcfInvalidReason,
  describeScenario,
  formatAmountShorthand,
  growthForYear,
  impliedUpside,
  isValidPercentInput,
  marginOfSafety,
  parseAmount,
  parseAssumptionPercent,
  projectFcf,
  runDcf,
  scenarioGrowthDelta,
} from "@/lib/valuation/dcf";
import {
  computeWacc,
  debtToEquityFromYahoo,
  debtWeightFromRatio,
  waccRegionFor,
} from "@/lib/valuation/wacc";

/** A flat-FCF perpetuity: 100 of FCF, no growth anywhere, discounted at 10%. */
const FLAT: DcfAssumptions = {
  baseFcf: 100,
  growthRate1: 0,
  growthRate2: 0,
  terminalGrowth: 0,
  discountRate: 10,
  sharesOutstanding: 1,
  netDebt: 0,
};

const APPLE_LIKE: DcfAssumptions = {
  baseFcf: 100e9,
  growthRate1: 15,
  growthRate2: 8,
  terminalGrowth: 3,
  discountRate: 9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
};

/* -------------------------------------------------------------------------- */
/* Core DCF                                                                    */
/* -------------------------------------------------------------------------- */

describe("runDcf", () => {
  it("matches the closed-form value of a zero-growth perpetuity", () => {
    // 100 of FCF held flat forever, discounted at 10%, is worth exactly 1000:
    // the 10 explicit years plus the discounted Gordon terminal value must sum
    // to FCF/WACC. Any drift in the projection or terminal-value wiring breaks
    // this identity.
    const result = runDcf(FLAT);
    expect(result.invalidReason).toBeNull();
    expect(result.fairValuePerShare).toBeCloseTo(1000, 6);
    expect(result.enterpriseValue).toBeCloseTo(1000, 6);
    expect(result.pvExplicit).toBeCloseTo(614.4567106, 6);
    expect(result.pvTerminalValue).toBeCloseTo(385.5432894, 6);
  });

  it("expresses zero growth rather than silently substituting a default", () => {
    // The whole point of the FLAT fixture: every rate is 0 and the model still
    // values it. The previous `parseFloat(x) || fallback` parsing made this
    // assumption set unreachable from the UI.
    expect(runDcf({ ...FLAT, growthRate1: 0, growthRate2: 0 }).fairValuePerShare)
      .toBeCloseTo(1000, 6);
  });

  it("subtracts net debt and adds net cash", () => {
    const withDebt = runDcf({ ...FLAT, netDebt: 200 });
    const withCash = runDcf({ ...FLAT, netDebt: -200 });
    expect(withDebt.fairValuePerShare).toBeCloseTo(800, 6);
    expect(withCash.fairValuePerShare).toBeCloseTo(1200, 6);
  });

  it("returns a negative fair value instead of clamping it to zero", () => {
    const result = runDcf({ ...FLAT, netDebt: 5000 });
    expect(result.fairValuePerShare).toBeCloseTo(-4000, 6);
  });

  it("reports terminal value as a share of enterprise value", () => {
    expect(runDcf(FLAT).terminalValueShare).toBeCloseTo(0.3855432894, 6);
    // A growth name leans harder on the perpetuity.
    expect(runDcf(APPLE_LIKE).terminalValueShare).toBeGreaterThan(0.5);
  });

  it("refuses to value assumptions the model cannot support", () => {
    const tooLowWacc = { ...FLAT, discountRate: 3, terminalGrowth: 3 };
    expect(dcfInvalidReason(tooLowWacc)).toBe("wacc_below_terminal_growth");
    expect(runDcf(tooLowWacc).fairValuePerShare).toBeNull();

    expect(dcfInvalidReason({ ...FLAT, sharesOutstanding: 0 })).toBe("no_shares");
    expect(dcfInvalidReason({ ...FLAT, baseFcf: NaN })).toBe("non_finite_inputs");
    expect(runDcf({ ...FLAT, baseFcf: NaN }).projection).toEqual([]);
  });
});

describe("growthForYear", () => {
  it("holds stage-one growth flat then fades to the stage-two rate by year 10", () => {
    expect(growthForYear(1, 10, 0)).toBe(10);
    expect(growthForYear(5, 10, 0)).toBe(10);
    expect(growthForYear(6, 10, 0)).toBeCloseTo(8, 10);
    expect(growthForYear(8, 10, 0)).toBeCloseTo(4, 10);
    expect(growthForYear(10, 10, 0)).toBeCloseTo(0, 10);
  });

  it("fades upward when stage two is faster than stage one", () => {
    expect(growthForYear(10, 5, 15)).toBeCloseTo(15, 10);
    expect(growthForYear(6, 5, 15)).toBeCloseTo(7, 10);
  });
});

describe("projectFcf", () => {
  it("compounds ten years and accumulates present value monotonically", () => {
    const rows = projectFcf(APPLE_LIKE);
    expect(rows).toHaveLength(10);
    expect(rows[0].fcf).toBeCloseTo(115e9, 0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].cumulativePv).toBeGreaterThan(rows[i - 1].cumulativePv);
    }
    expect(rows[9].cumulativePv).toBeCloseTo(
      rows.reduce((sum, r) => sum + r.pv, 0),
      2,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Scenarios — regression cover for the inverted bull/bear bug                 */
/* -------------------------------------------------------------------------- */

describe("buildScenarios", () => {
  it("orders bear < base < bull for a shrinking business", () => {
    // Regression: the old ×1.5 / ×0.5 growth multipliers inverted the scenarios
    // whenever base growth was negative. A business declining 10% got a "bull"
    // case of −15% growth and a "bear" case of −5%, so the bull case was worth
    // less than the bear case.
    const declining: DcfAssumptions = {
      ...FLAT, baseFcf: 1e9, growthRate1: -10, growthRate2: -5,
      terminalGrowth: 2, sharesOutstanding: 1e8,
    };
    const s = buildScenarios(declining);

    expect(s.bullAssumptions.growthRate1).toBeCloseTo(-5, 10);
    expect(s.bearAssumptions.growthRate1).toBeCloseTo(-15, 10);
    expect(s.bull.fairValuePerShare!).toBeGreaterThan(s.base.fairValuePerShare!);
    expect(s.base.fairValuePerShare!).toBeGreaterThan(s.bear.fairValuePerShare!);
  });

  it("orders bear < base < bull for a growing business", () => {
    const s = buildScenarios(APPLE_LIKE);
    expect(s.bull.fairValuePerShare!).toBeGreaterThan(s.base.fairValuePerShare!);
    expect(s.base.fairValuePerShare!).toBeGreaterThan(s.bear.fairValuePerShare!);
  });

  it("keeps three distinct cases when base growth is exactly zero", () => {
    // Regression: multiplying zero by 1.5 and 0.5 produced three identical
    // scenarios, so the range bar collapsed to a single point.
    const s = buildScenarios(FLAT);
    expect(s.bullAssumptions.growthRate1).toBeCloseTo(2, 10);
    expect(s.bearAssumptions.growthRate1).toBeCloseTo(-2, 10);
    expect(s.bull.fairValuePerShare!).toBeGreaterThan(s.base.fairValuePerShare!);
    expect(s.base.fairValuePerShare!).toBeGreaterThan(s.bear.fairValuePerShare!);
  });

  it("reproduces the historical spread for ordinary positive growth", () => {
    // 15% growth previously became 22.5% / 7.5% via ×1.5 / ×0.5. The additive
    // rule is a strict generalisation: identical here, correct below zero.
    const s = buildScenarios({ ...FLAT, growthRate1: 15, growthRate2: 8 });
    expect(s.bullAssumptions.growthRate1).toBeCloseTo(22.5, 10);
    expect(s.bearAssumptions.growthRate1).toBeCloseTo(7.5, 10);
    expect(s.bullAssumptions.growthRate2).toBeCloseTo(12, 10);
    expect(s.bearAssumptions.growthRate2).toBeCloseTo(4, 10);
  });

  it("never lets the bull case discount below the terminal growth rate", () => {
    const thin: DcfAssumptions = { ...FLAT, discountRate: 2.5, terminalGrowth: 2 };
    const s = buildScenarios(thin);
    expect(s.bullAssumptions.discountRate).toBeGreaterThan(thin.terminalGrowth);
    expect(s.bull.fairValuePerShare).not.toBeNull();
  });

  it("caps the growth spread for hypergrowth names", () => {
    expect(scenarioGrowthDelta(80)).toBe(15);
    expect(scenarioGrowthDelta(0)).toBe(2);
    expect(scenarioGrowthDelta(-30)).toBe(15);
    expect(scenarioGrowthDelta(20)).toBe(10);
  });

  it("describes a scenario as a signed delta from the base case", () => {
    const s = buildScenarios(APPLE_LIKE);
    expect(describeScenario(APPLE_LIKE, s.bearAssumptions)).toContain("WACC +2.0pp");
    expect(describeScenario(APPLE_LIKE, s.bullAssumptions)).toContain("WACC -1.0pp");
    expect(describeScenario(APPLE_LIKE, s.bullAssumptions)).toContain("Growth +7.5pp");
  });
});

/* -------------------------------------------------------------------------- */
/* Sensitivity                                                                 */
/* -------------------------------------------------------------------------- */

describe("buildSensitivity", () => {
  it("returns a 7×7 grid centred on the base WACC", () => {
    const { table, waccRange } = buildSensitivity(APPLE_LIKE);
    expect(waccRange).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(table).toHaveLength(7);
    table.forEach((row) => expect(row).toHaveLength(7));
    expect(table[3][4]).toBeCloseTo(runDcf(APPLE_LIKE).fairValuePerShare!, 6);
  });

  it("marks cells the model cannot value as null rather than zero", () => {
    // A zero here would read as "worthless", not "not computable".
    const { table } = buildSensitivity({ ...APPLE_LIKE, discountRate: 5 });
    expect(table.flat()).toContain(null);
  });

  it("values rise as terminal growth rises and fall as WACC rises", () => {
    const { table } = buildSensitivity(APPLE_LIKE);
    expect(table[0][6]!).toBeGreaterThan(table[0][0]!);
    expect(table[6][0]!).toBeLessThan(table[0][0]!);
  });

  it("clamps the WACC range to a sane band", () => {
    expect(buildWaccRange(1)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(buildWaccRange(40)).toEqual([22, 23, 24, 25, 26, 27, 28]);
  });
});

/* -------------------------------------------------------------------------- */
/* Derived measures                                                            */
/* -------------------------------------------------------------------------- */

describe("marginOfSafety / impliedUpside", () => {
  it("measures discount to fair value and return from price respectively", () => {
    expect(marginOfSafety(100, 80)).toBeCloseTo(20, 10);
    expect(impliedUpside(100, 80)).toBeCloseTo(25, 10);
  });

  it("returns null rather than a misleading number for degenerate inputs", () => {
    expect(marginOfSafety(null, 80)).toBeNull();
    expect(marginOfSafety(-10, 80)).toBeNull();
    expect(marginOfSafety(100, 0)).toBeNull();
    expect(impliedUpside(100, null)).toBeNull();
    expect(impliedUpside(null, 80)).toBeNull();
  });

  it("reports a negative margin of safety when price exceeds fair value", () => {
    expect(marginOfSafety(100, 150)).toBeCloseTo(-50, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Input parsing                                                               */
/* -------------------------------------------------------------------------- */

describe("parseAssumptionPercent", () => {
  it("keeps a typed zero instead of falling back to the default", () => {
    // Regression: `parseFloat("0") || 3` evaluates to 3, so zero terminal growth
    // and zero FCF growth were impossible to enter.
    expect(parseAssumptionPercent("0", 3)).toBe(0);
    expect(parseAssumptionPercent("0.0", 3)).toBe(0);
  });

  it("falls back only for empty or non-numeric input", () => {
    expect(parseAssumptionPercent("", 10)).toBe(10);
    expect(parseAssumptionPercent("   ", 10)).toBe(10);
    expect(parseAssumptionPercent("abc", 10)).toBe(10);
    expect(parseAssumptionPercent("7abc", 10)).toBe(10);
    expect(parseAssumptionPercent(" -2.5 ", 10)).toBe(-2.5);
  });

  it("agrees with the field validator", () => {
    expect(isValidPercentInput("0")).toBe(true);
    expect(isValidPercentInput("")).toBe(true);
    expect(isValidPercentInput("7abc")).toBe(false);
  });
});

describe("parseAmount / formatAmountShorthand", () => {
  it("reads magnitude suffixes and thousands separators", () => {
    expect(parseAmount("93.7B")).toBeCloseTo(93.7e9, 0);
    expect(parseAmount("15.2m")).toBeCloseTo(15.2e6, 0);
    expect(parseAmount("500K")).toBe(500e3);
    expect(parseAmount("1.5T")).toBeCloseTo(1.5e12, 0);
    expect(parseAmount("-60B")).toBeCloseTo(-60e9, 0);
    expect(parseAmount("1,500")).toBe(1500);
    expect(parseAmount("")).toBeNaN();
  });

  it("round-trips through the shorthand formatter", () => {
    expect(parseAmount(formatAmountShorthand(93.7e9))).toBeCloseTo(93.7e9, 0);
    expect(formatAmountShorthand(-60e9)).toBe("-60.00B");
  });
});

/* -------------------------------------------------------------------------- */
/* WACC — parity with the Python quant engine                                  */
/* -------------------------------------------------------------------------- */

describe("computeWacc", () => {
  /**
   * Expected values produced by running engine/models/monte_carlo.py:compute_wacc
   * directly, with debt_weight derived the same way build_mc_valuation_from_fundamentals
   * derives it. If either implementation moves, this test fails — which is the
   * point: the deterministic DCF and the Monte Carlo must discount alike.
   */
  const parity: Array<[beta: number, debtToEquity: number, region: "US" | "IN", wacc: number]> = [
    [1.0, 0.3, "US", 0.085269230769],
    [1.4, 1.45, "US", 0.072765306122],
    [0.65, 0.0, "US", 0.07975],
    [1.1, 0.55, "IN", 0.098532258065],
    [2.5, 3.0, "US", 0.0963],
    [0.2, 0.1, "IN", 0.073590909091],
  ];

  it.each(parity)(
    "matches the engine for beta=%s, D/E=%s, region=%s",
    (beta, debtToEquity, region, expected) => {
      expect(computeWacc({ beta, debtToEquity, region }).wacc).toBeCloseTo(expected, 10);
    },
  );

  it("prices equity risk, the debt tax shield and leverage", () => {
    const unlevered = computeWacc({ beta: 1.2, debtToEquity: 0, region: "US" });
    const levered = computeWacc({ beta: 1.2, debtToEquity: 1.0, region: "US" });
    // After-tax debt is cheaper than equity, so leverage pulls WACC down.
    expect(levered.wacc).toBeLessThan(unlevered.wacc);
    expect(unlevered.costOfEquity).toBeCloseTo(0.044 + 1.2 * 0.055, 10);
    expect(unlevered.debtWeight).toBe(0);
  });

  it("charges India a higher risk-free rate and equity risk premium", () => {
    const us = computeWacc({ beta: 1, debtToEquity: 0.3, region: "US" });
    const india = computeWacc({ beta: 1, debtToEquity: 0.3, region: "IN" });
    expect(india.wacc).toBeGreaterThan(us.wacc);
    expect(india.riskFree).toBeCloseTo(0.065, 10);
  });

  it("defaults sensibly when beta or leverage is unknown", () => {
    const fallback = computeWacc({ beta: null, debtToEquity: null });
    expect(fallback.beta).toBe(1);
    expect(fallback.debtWeight).toBeCloseTo(0.230769230769, 10);
    expect(fallback.wacc).toBeCloseTo(0.085269230769, 10);
  });

  it("holds the result inside the engine's guard rails", () => {
    const extreme = computeWacc({ beta: 99, debtToEquity: 0 });
    expect(extreme.wacc).toBeCloseTo(0.20, 10);
    expect(extreme.clamped).toBe(true);
    expect(extreme.beta).toBe(4);
    expect(computeWacc({ beta: 1, debtToEquity: 0.3 }).clamped).toBe(false);
  });

  it("caps the debt weight at 60% of the capital structure", () => {
    expect(debtWeightFromRatio(10)).toBe(0.6);
    expect(debtWeightFromRatio(0)).toBe(0);
    expect(debtWeightFromRatio(1)).toBeCloseTo(0.5, 10);
    // Negative book equity must not produce a negative debt weight.
    expect(debtWeightFromRatio(-1.5)).toBeGreaterThan(0);
  });

  it("reports WACC in percent for the assumption fields", () => {
    expect(computeWacc({ beta: 1, debtToEquity: 0.3 }).waccPercent).toBe(8.5);
  });
});

describe("waccRegionFor / debtToEquityFromYahoo", () => {
  it("routes Indian listings to the India parameters", () => {
    expect(waccRegionFor("RELIANCE.NS")).toBe("IN");
    expect(waccRegionFor("500325.BO")).toBe("IN");
    expect(waccRegionFor("INFY", "INR")).toBe("IN");
    expect(waccRegionFor("AAPL", "USD")).toBe("US");
  });

  it("converts Yahoo's percentage debt/equity to a ratio", () => {
    expect(debtToEquityFromYahoo(145)).toBeCloseTo(1.45, 10);
    expect(debtToEquityFromYahoo(0)).toBe(0);
    expect(debtToEquityFromYahoo(null)).toBeNull();
  });
});
