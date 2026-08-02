import { describe, it, expect } from "vitest";
import {
  buildFadePath,
  computeWaccFromComponents,
  validateDcfInputs,
  runDcf,
  reconcileDcf,
  runScenarios,
  reverseDcf,
  computeSensitivity,
  runRelativeMethod,
  blendValues,
  BANDS,
  type DcfInputs,
} from "@/lib/ic/valuation-engine";

const baseInputs = (over: Partial<DcfInputs> = {}): DcfInputs => ({
  baseFcf: 46_335_873_024,
  netDebt: -40_357_998_592, // NVDA-style net cash
  sharesOutstanding: 24_221_000_000,
  growthPath: buildFadePath(0.25, 0.025, 10),
  terminalGrowth: 0.025,
  wacc: 0.12,
  ...over,
});

describe("buildFadePath", () => {
  it("fades linearly and monotonically toward terminal", () => {
    const path = buildFadePath(0.30, 0.025, 10);
    expect(path).toHaveLength(10);
    expect(path[0]).toBeCloseTo(0.30, 10);
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i] - 0.025)).toBeLessThanOrEqual(Math.abs(path[i - 1] - 0.025) + 1e-12);
    }
    expect(path[path.length - 1]).toBeGreaterThan(0.025);
  });

  it("also fades upward when start is below terminal", () => {
    const path = buildFadePath(-0.10, 0.02, 8);
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThanOrEqual(path[i - 1]);
  });
});

describe("computeWaccFromComponents", () => {
  it("reproduces the CAPM build by hand", () => {
    const { wacc, costOfEquity } = computeWaccFromComponents({
      riskFree: 0.044, equityRiskPremium: 0.055, beta: 1.2,
      costOfDebt: 0.06, taxRate: 0.21, debtWeight: 0.3,
    });
    expect(costOfEquity).toBeCloseTo(0.044 + 1.2 * 0.055, 10);
    expect(wacc).toBeCloseTo(costOfEquity * 0.7 + 0.06 * 0.79 * 0.3, 10);
  });
});

describe("invariants (Phase 2.2) — tested directly", () => {
  it("terminal growth >= WACC blocks", () => {
    const v = validateDcfInputs(baseInputs({ terminalGrowth: 0.12 }), 200);
    expect(v.some((x) => x.invariant.includes("terminal growth < WACC") && x.severity === "blocking")).toBe(true);
  });

  it("terminal growth above absolute ceiling blocks", () => {
    const v = validateDcfInputs(baseInputs({ terminalGrowth: 0.06 }), 200);
    expect(v.some((x) => x.invariant === "terminal growth ceiling")).toBe(true);
  });

  it("WACC outside the defensible band blocks", () => {
    expect(validateDcfInputs(baseInputs({ wacc: 0.03 }), 200).some((x) => x.invariant === "WACC band")).toBe(true);
    expect(validateDcfInputs(baseInputs({ wacc: 0.30 }), 200).some((x) => x.invariant === "WACC band")).toBe(true);
  });

  it("extreme growth without justification blocks; with justification passes", () => {
    const hot = baseInputs({ growthPath: buildFadePath(0.35, 0.025, 10) });
    expect(validateDcfInputs(hot, 200).some((x) => x.invariant.includes("justification"))).toBe(true);
    const justified = { ...hot, justifications: { growth: "delivered 68% CAGR over 4 years; hyperscaler capex visibility" } };
    expect(validateDcfInputs(justified, 200).some((x) => x.invariant.includes("justification"))).toBe(false);
  });

  it("growth outside the hard band blocks even with justification", () => {
    const v = validateDcfInputs(baseInputs({ growthPath: buildFadePath(0.68, 0.025, 10), justifications: { growth: "x" } }), 200);
    expect(v.some((x) => x.invariant === "explicit growth band")).toBe(true);
  });

  it("non-monotonic fade blocks", () => {
    const path = buildFadePath(0.2, 0.025, 10);
    path[5] = 0.3; // bulge away from terminal
    const v = validateDcfInputs(baseInputs({ growthPath: path }), 200);
    expect(v.some((x) => x.invariant === "monotonic fade")).toBe(true);
  });

  it("negative base FCF blocks the growth-and-fade DCF", () => {
    const v = validateDcfInputs(baseInputs({ baseFcf: -1e9 }), 200);
    expect(v.some((x) => x.invariant === "positive base cash flow")).toBe(true);
  });
});

describe("runDcf", () => {
  it("hand-recomputes a tiny case to the cent", () => {
    // 1 year explicit at 10% growth, terminal 2%, wacc 10%, fcf 100, shares 10, netDebt 50
    const inputs: DcfInputs = {
      baseFcf: 100, netDebt: 50, sharesOutstanding: 10,
      growthPath: [0.10], terminalGrowth: 0.02, wacc: 0.10,
    };
    const r = runDcf(inputs, null);
    const fcf1 = 110;
    const pv1 = fcf1 / 1.1;
    const tv = (fcf1 * 1.02) / (0.10 - 0.02);
    const pvTv = tv / 1.1;
    expect(r.pvExplicit).toBeCloseTo(pv1, 10);
    expect(r.pvTerminalPerp).toBeCloseTo(pvTv, 10);
    expect(r.enterpriseValue).toBeCloseTo(pv1 + pvTv, 10);
    expect(r.equityValue).toBeCloseTo(pv1 + pvTv - 50, 10);
    expect(r.perShare).toBeCloseTo((pv1 + pvTv - 50) / 10, 10);
  });

  it("sum of the parts reconciles (tested, not trusted)", () => {
    const r = runDcf(baseInputs(), 200);
    expect(reconcileDcf(r)).toHaveLength(0);
  });

  it("exit-multiple terminal produces its own per-share cross-check", () => {
    const r = runDcf(baseInputs({ exitMultiple: 20 }), 200);
    expect(r.perShareExit).not.toBeNull();
    const last = r.rows[r.rows.length - 1];
    expect(r.terminalValueExit).toBeCloseTo(last.fcf * 20, 6);
  });

  it("every intermediate is inspectable", () => {
    const r = runDcf(baseInputs(), 200);
    expect(r.rows).toHaveLength(10);
    for (const row of r.rows) {
      expect(row.fcf).toBeGreaterThan(0);
      expect(row.discountFactor).toBeLessThanOrEqual(1);
      expect(row.pv).toBeCloseTo(row.fcf * row.discountFactor, 6);
    }
  });
});

describe("runScenarios", () => {
  it("bear < base < bull strictly", () => {
    const s = runScenarios(baseInputs({ growthPath: buildFadePath(0.15, 0.025, 10) }), 200, {
      bearGrowthDelta: 0.06, bullGrowthDelta: 0.06,
    });
    expect(s.bear.result.perShare).toBeLessThan(s.base.result.perShare);
    expect(s.base.result.perShare).toBeLessThan(s.bull.result.perShare);
    expect(s.violations.filter((v) => v.invariant === "bear < base < bull")).toHaveLength(0);
  });

  it("flags scenarios outside the sane multiple of spot as validation failures, not results", () => {
    // absurd: tiny spot vs huge value
    const s = runScenarios(baseInputs({ growthPath: buildFadePath(0.2, 0.025, 10) }), 1, {
      bearGrowthDelta: 0.05, bullGrowthDelta: 0.05,
    });
    expect(s.violations.some((v) => v.invariant === "scenario within sane multiple of spot" && v.severity === "blocking")).toBe(true);
  });

  it("flags terminal share above threshold", () => {
    // wacc 5.5% vs terminal 4.5%: TV multiple ≈ 105x final FCF — terminal dominates
    const s = runScenarios(baseInputs({ growthPath: buildFadePath(0.05, 0.045, 10), terminalGrowth: 0.045, wacc: 0.055 }), 3000, {
      bearGrowthDelta: 0.02, bullGrowthDelta: 0.02,
    });
    expect(s.violations.some((v) => v.invariant === "terminal value share")).toBe(true);
  });
});

describe("reverseDcf (Phase 2.8)", () => {
  it("solves the growth that reproduces spot, verified by forward run", () => {
    const inputs = baseInputs();
    const spot = 200.75;
    const r = reverseDcf(inputs, spot);
    expect(r.converged).toBe(true);
    expect(r.impliedGrowth).not.toBeNull();
    const forward = runDcf(
      { ...inputs, growthPath: buildFadePath(r.impliedGrowth!, inputs.terminalGrowth, inputs.growthPath.length) },
      spot,
    );
    expect(forward.perShare).toBeCloseTo(spot, 2);
  });

  it("handles negative-FCF names by declining", () => {
    const r = reverseDcf(baseInputs({ baseFcf: -5e9 }), 100);
    expect(r.converged).toBe(false);
    expect(r.impliedGrowth).toBeNull();
  });
});

describe("computeSensitivity (Phase 2.9)", () => {
  it("produces a WACC × terminal grid with nulls where terminal ≥ wacc", () => {
    const s = computeSensitivity(baseInputs({ wacc: 0.055, terminalGrowth: 0.045 }), 200);
    expect(s.grid.waccValues).toHaveLength(5);
    expect(s.grid.terminalGrowthValues).toHaveLength(5);
    // wacc 3.5% row vs terminal 5.5% col must be null
    expect(s.grid.perShare[0][4]).toBeNull();
  });

  it("grid center equals the base run; drivers have sane signs", () => {
    const inputs = baseInputs();
    const s = computeSensitivity(inputs, 200);
    expect(s.grid.perShare[2][2]).toBeCloseTo(runDcf(inputs, 200).perShare, 6);
    expect(s.drivers.growthPlus1pp).toBeGreaterThan(0);
    expect(s.drivers.waccPlus1pp).toBeLessThan(0);
    expect(s.drivers.terminalPlus50bp).toBeGreaterThan(0);
    expect(s.breakevenGrowth).not.toBeNull();
  });
});

describe("relative methods tie to their own stated inputs (Phase 2.4)", () => {
  it("P/E: recomputing by hand reproduces the target to the cent", () => {
    const r = runRelativeMethod({ kind: "pe", multiple: 23, metricValue: 6.42, metricLabel: "EPS", sharesOutstanding: 1e9, rationale: "peers" });
    expect(r.perShare).toBeCloseTo(23 * 6.42, 10);
    expect(r.workings).toContain("23.0x");
  });

  it("EV/EBITDA: bridges EV to equity through net debt", () => {
    const r = runRelativeMethod({ kind: "ev_ebitda", multiple: 12, metricValue: 10e9, metricLabel: "EBITDA", netDebt: 20e9, sharesOutstanding: 1e9, rationale: "peers" });
    expect(r.perShare).toBeCloseTo((12 * 10e9 - 20e9) / 1e9, 10);
  });

  it("FCF yield: value = FCF ÷ required yield ÷ shares", () => {
    const r = runRelativeMethod({ kind: "fcf_yield", multiple: 0.04, metricValue: 46e9, metricLabel: "FCF", sharesOutstanding: 24e9, rationale: "long bond + spread" });
    expect(r.perShare).toBeCloseTo(46e9 / 0.04 / 24e9, 10);
  });

  it("P/S: equity = multiple × revenue", () => {
    const r = runRelativeMethod({ kind: "p_s", multiple: 5, metricValue: 100e9, metricLabel: "revenue", sharesOutstanding: 10e9, rationale: "sector" });
    expect(r.perShare).toBeCloseTo(50, 10);
  });
});

describe("blendValues (Phase 2.10)", () => {
  it("normalises weights and exposes them", () => {
    const b = blendValues([
      { label: "DCF", perShare: 100, weight: 0.4, rationale: "anchor" },
      { label: "P/E", perShare: 120, weight: 0.2, rationale: "cross-check" },
    ]);
    expect(b).not.toBeNull();
    expect(b!.components.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
    expect(b!.perShare).toBeCloseTo(100 * (0.4 / 0.6) + 120 * (0.2 / 0.6), 10);
  });

  it("drops non-finite and non-positive components; returns null when nothing usable", () => {
    expect(blendValues([{ label: "x", perShare: NaN, weight: 1, rationale: "" }])).toBeNull();
    expect(blendValues([])).toBeNull();
  });
});

describe("NVDA-class absurdity is now a validation failure, not a result", () => {
  it("68% delivered growth cannot pass the band unclamped", () => {
    const inputs = baseInputs({ growthPath: buildFadePath(0.68, 0.025, 10), justifications: { growth: "delivered" } });
    const v = validateDcfInputs(inputs, 200.75);
    expect(v.some((x) => x.severity === "blocking")).toBe(true);
  });

  it(`spot sanity band is ${BANDS.spotSanityMultiple}x`, () => {
    // even a passing DCF whose output lands 300x spot must be blocked at scenario level
    const s = runScenarios(baseInputs({ growthPath: buildFadePath(0.25, 0.025, 10), justifications: { growth: "j" } }), 1.0, {
      bearGrowthDelta: 0.05, bullGrowthDelta: 0.05,
    });
    expect(s.violations.some((v) => v.invariant === "scenario within sane multiple of spot")).toBe(true);
  });
});
