/**
 * Policy Fit — the layer where the investor's OWN priorities and the book's
 * MEASURED health enter Portfolio Fit (lib/ios/policy-fit.ts + its integration
 * in lib/ios/fit-scorer.ts).
 *
 * The product contract under test:
 *   1. HONESTY GATES. Nothing fires without a CONFIRMED policy, a strained
 *      theme the user actually weights, and real asset-side evidence. A theme
 *      the user opted out of (priority 0) never fires. No policy context ⇒
 *      the fit behaves exactly as before.
 *   2. NO DOUBLE COUNTING. Only themes the six fit dimensions cannot see may
 *      move the score (structure, resilience, liquidity-cash, income), and
 *      each is suppressed when the IOS objective already prices the same
 *      asset trait. Concentration/exposure/inflation ground the sentence only.
 *   3. BOTH DIRECTIONS + TRADEOFFS. Helping a stated priority raises fit,
 *      conflicting lowers it, and a real conflict between two stated
 *      priorities is surfaced in one sentence, not resolved silently.
 *   4. BOUNDED. |adjustment| ≤ POLICY_FIT_MAX_ADJUSTMENT, and the research
 *      guardrails still bind after it — portfolio need cannot manufacture
 *      conviction (Hold-grade research says so explicitly in the insight).
 */

import { describe, expect, it } from "vitest";
import { assessPolicyFit, POLICY_FIT_MAX_ADJUSTMENT } from "@/lib/ios/policy-fit";
import { computePortfolioFit } from "@/lib/ios/fit-scorer";
import { EMPTY_PROFILE } from "@/lib/ios/types";
import type {
  FitAssetData,
  InvestmentProfile,
  PolicyFitContext,
  PolicyThemeSnapshot,
} from "@/lib/ios/types";
import type { AlignmentThemeId } from "@/lib/portfolio/alignment/policy";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const LABELS: Record<AlignmentThemeId, string> = {
  structure: "Structure",
  resilience: "Downside",
  concentration: "Concentration",
  liquidity: "Liquidity",
  income: "Income",
  inflation: "Inflation",
  exposure: "Geography & currency",
};

function snap(id: AlignmentThemeId, over: Partial<PolicyThemeSnapshot> = {}): PolicyThemeSnapshot {
  return {
    id,
    label: LABELS[id],
    priority: 2,
    score: 60,
    status: "aligned",
    metrics: null,
    mismatch: null,
    ...over,
  };
}

function ctx(themes: PolicyThemeSnapshot[], over: Partial<PolicyFitContext> = {}): PolicyFitContext {
  return { confirmed: true, goal: "balanced", themes, ...over };
}

function profile(o: Partial<InvestmentProfile> = {}): InvestmentProfile {
  return {
    ...EMPTY_PROFILE,
    hasPortfolio: true,
    positionCount: 8,
    totalValue: 100_000,
    holdingSymbols: [],
    sectorWeights: [],
    hhi: 1500,
    builtAt: Date.now(),
    ...o,
  };
}

function asset(o: Partial<FitAssetData> = {}): FitAssetData {
  return { symbol: "TST", sector: null, marketCap: 50e9, ...o };
}

/** An income theme in mismatch: book pays 0.8% against a 3% requirement. */
const incomeShort = () =>
  snap("income", { status: "mismatch", score: 30, metrics: { yieldPct: 0.8, requiredPct: 3 } });

/* ------------------------------------------------------------------ */
/* 1. Honesty gates — when nothing may fire                            */
/* ------------------------------------------------------------------ */

describe("honesty gates", () => {
  const payer = asset({ dividendYield: 3.5 });

  it("no policy context → zero adjustment, no insight", () => {
    const r = assessPolicyFit(payer, profile({ policyContext: null }), 5);
    expect(r).toEqual({ adjustment: 0, notes: [], insight: null });
  });

  it("an UNCONFIRMED policy (assumed defaults) never personalizes", () => {
    const r = assessPolicyFit(
      payer,
      profile({ policyContext: ctx([incomeShort()], { confirmed: false }) }),
      5,
    );
    expect(r.adjustment).toBe(0);
    expect(r.insight).toBeNull();
  });

  it("a theme the investor opted out of (priority 0) never fires", () => {
    const r = assessPolicyFit(
      payer,
      profile({ policyContext: ctx([incomeShort()].map((t) => ({ ...t, priority: 0 as const }))) }),
      5,
    );
    expect(r.adjustment).toBe(0);
    expect(r.insight).toBeNull();
  });

  it("an aligned book fires nothing — existing fit behavior is preserved", () => {
    const aligned = ctx([
      snap("structure", { metrics: { growthEnginePct: 60, bandLo: 35, bandHi: 80 } }),
      snap("income", { metrics: { yieldPct: 3.2, requiredPct: 3 } }),
      snap("liquidity", { metrics: { liquidPct: 80, floorPct: 10, cashPct: 5, cashMin: 1, cashMax: 25 } }),
    ]);
    const r = assessPolicyFit(payer, profile({ policyContext: aligned }), 5);
    expect(r.adjustment).toBe(0);
    expect(r.insight).toBeNull();
  });

  it("no asset evidence → abstain (structure/resilience need beta, income needs yield)", () => {
    const strained = ctx([
      snap("structure", { status: "mismatch", metrics: { growthEnginePct: 20, bandLo: 35, bandHi: 80 } }),
      snap("resilience", { status: "mismatch", metrics: { stressPct: 40, tolerancePct: 30 } }),
      incomeShort(),
    ]);
    const blind = assessPolicyFit(asset(), profile({ policyContext: strained }), 5);
    expect(blind.adjustment).toBe(0);
  });

  it("identical asset, theme flips aligned → mismatch: the assessment responds", () => {
    const p = (status: "aligned" | "mismatch") =>
      profile({
        policyContext: ctx([
          snap("income", {
            status,
            metrics: { yieldPct: status === "aligned" ? 3.2 : 0.8, requiredPct: 3 },
          }),
        ]),
      });
    expect(assessPolicyFit(payer, p("aligned"), 5).adjustment).toBe(0);
    expect(assessPolicyFit(payer, p("mismatch"), 5).adjustment).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Scored nudges — direction, magnitude, suppression                */
/* ------------------------------------------------------------------ */

describe("income: stated requirement unmet", () => {
  const short = profile({ policyContext: ctx([incomeShort()]) });

  it("a payer above the requirement helps; the note carries the real numbers", () => {
    const r = assessPolicyFit(asset({ dividendYield: 3.5 }), short, 5);
    expect(r.adjustment).toBeGreaterThan(0);
    expect(r.notes[0].text).toContain("3.5%");
    expect(r.notes[0].text).toContain("0.80%");
    expect(r.insight).toContain("you need 3.0% income");
  });

  it("a non-payer dilutes an already-short book — small negative", () => {
    const r = assessPolicyFit(asset({ dividendYield: 0 }), short, 5);
    expect(r.adjustment).toBeLessThan(0);
    expect(r.adjustment).toBeGreaterThanOrEqual(-1.5);
  });

  it("suppressed when the IOS objective already prices income (no double count)", () => {
    const r = assessPolicyFit(
      asset({ dividendYield: 3.5 }),
      profile({ objective: "increase_income", policyContext: ctx([incomeShort()]) }),
      5,
    );
    expect(r.adjustment).toBe(0);
  });
});

describe("structure: growth-band breach × beta", () => {
  const below = ctx([
    snap("structure", { status: "mismatch", priority: 3, metrics: { growthEnginePct: 22, bandLo: 35, bandHi: 80 } }),
  ]);
  const above = ctx([
    snap("structure", { status: "mismatch", priority: 3, metrics: { growthEnginePct: 92, bandLo: 35, bandHi: 80 } }),
  ]);

  it("below the floor, a growth-like asset helps and a defensive one does not", () => {
    const growth = assessPolicyFit(asset({ beta: 1.2 }), profile({ policyContext: below }), 5);
    const defensive = assessPolicyFit(asset({ beta: 0.5 }), profile({ policyContext: below }), 5);
    expect(growth.adjustment).toBeGreaterThan(0);
    expect(defensive.adjustment).toBeLessThan(0);
    expect(growth.insight).toContain("growth band");
  });

  it("above the ceiling the directions invert", () => {
    const growth = assessPolicyFit(asset({ beta: 1.2 }), profile({ policyContext: above }), 5);
    const defensive = assessPolicyFit(asset({ beta: 0.5 }), profile({ policyContext: above }), 5);
    expect(growth.adjustment).toBeLessThan(0);
    expect(defensive.adjustment).toBeGreaterThan(0);
  });
});

describe("resilience: drawdown breach × beta", () => {
  const stressed = ctx([
    snap("resilience", { status: "mismatch", priority: 3, metrics: { stressPct: 42, tolerancePct: 30 } }),
  ]);

  it("high beta deepens a breach; low beta damps it", () => {
    const hot = assessPolicyFit(asset({ beta: 1.4 }), profile({ policyContext: stressed }), 5);
    const cool = assessPolicyFit(asset({ beta: 0.55 }), profile({ policyContext: stressed }), 5);
    expect(hot.adjustment).toBeLessThan(0);
    expect(cool.adjustment).toBeGreaterThan(0);
    expect(hot.insight).toContain("42");
    expect(hot.insight).toContain("30");
  });

  it("suppressed when the objective already prices defensiveness (no double count)", () => {
    const r = assessPolicyFit(
      asset({ beta: 1.4 }),
      profile({ objective: "reduce_risk", policyContext: stressed }),
      5,
    );
    expect(r.adjustment).toBe(0);
  });
});

describe("liquidity: cash below the investor's own band", () => {
  const dry = ctx([
    snap("liquidity", {
      status: "tension",
      priority: 3,
      metrics: { liquidPct: 60, floorPct: 10, cashPct: 0.4, cashMin: 3, cashMax: 40 },
    }),
  ]);

  it("a cash-funded buy presses on the shortfall — negative, scaled by size, never positive", () => {
    const small = assessPolicyFit(asset({ beta: 1.0 }), profile({ policyContext: dry }), 2);
    const large = assessPolicyFit(asset({ beta: 1.0 }), profile({ policyContext: dry }), 8);
    expect(small.adjustment).toBeLessThan(0);
    expect(large.adjustment).toBeLessThan(small.adjustment);
    expect(large.adjustment).toBeGreaterThanOrEqual(-3);
    expect(small.insight).toContain("0.4%");
  });

  it("cash inside the band → nothing, even when the floor is the strain", () => {
    const floorOnly = ctx([
      snap("liquidity", {
        status: "mismatch",
        metrics: { liquidPct: 5, floorPct: 10, cashPct: 5, cashMin: 1, cashMax: 25 },
      }),
    ]);
    // Buying a liquid security with cash does not worsen the liquid-share
    // floor — claiming it would is exactly the dishonesty this layer forbids.
    const r = assessPolicyFit(asset({ beta: 1.0 }), profile({ policyContext: floorOnly }), 5);
    expect(r.adjustment).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Insight-only themes and the single-sentence contract             */
/* ------------------------------------------------------------------ */

describe("concentration grounds the sentence, never the score", () => {
  const concentrated = (over: Partial<PolicyThemeSnapshot> = {}) =>
    ctx([
      snap("concentration", {
        status: "mismatch",
        priority: 3,
        metrics: { topWeightPct: 26, capPct: 20 },
        mismatch: { stated: "≤ 20% per position", actual: "26.0%", holdings: ["NVDA"] },
        ...over,
      }),
    ]);

  it("the flagged position itself: a direct, negative personal statement — score untouched", () => {
    const r = assessPolicyFit(
      asset({ symbol: "NVDA", sector: "Technology" }),
      profile({ holdingSymbols: ["NVDA"], sectorWeights: [{ sector: "Technology", weight: 40 }], policyContext: concentrated() }),
      5,
    );
    expect(r.adjustment).toBe(0); // sector/correlation dims own the mechanics
    expect(r.insight).toContain("NVDA is that position");
    expect(r.insight).toContain("26.0%");
  });

  it("a small-sector outsider: positive personal statement citing the user's own limit", () => {
    const r = assessPolicyFit(
      asset({ symbol: "JPM", sector: "Financial Services" }),
      profile({ sectorWeights: [{ sector: "Financial Services", weight: 3 }], policyContext: concentrated() }),
      5,
    );
    expect(r.adjustment).toBe(0);
    expect(r.insight).toContain("Financial Services at 3.0%");
    expect(r.insight).toContain("outside that bet");
  });

  it("no honest connection → no insight at all", () => {
    const r = assessPolicyFit(
      asset({ symbol: "MMM", sector: "Industrials" }),
      profile({ sectorWeights: [{ sector: "Industrials", weight: 12 }], policyContext: concentrated() }),
      5,
    );
    expect(r.insight).toBeNull();
  });
});

describe("one sentence, tradeoffs stated, conviction never oversold", () => {
  it("two stated priorities in conflict compose into a single 'but' sentence", () => {
    // Income priority satisfied by the asset (+) while liquidity is strained (−).
    const p = profile({
      policyContext: ctx([
        { ...incomeShort(), priority: 3 },
        snap("liquidity", {
          status: "mismatch",
          priority: 3,
          metrics: { liquidPct: 60, floorPct: 10, cashPct: 0.5, cashMin: 3, cashMax: 40 },
        }),
      ]),
    });
    const r = assessPolicyFit(asset({ dividendYield: 4, beta: 1.0 }), p, 5);
    expect(r.insight).toContain("— but");
    expect(r.insight).toMatch(/income/i);
    expect(r.insight).toMatch(/cash/i);
  });

  it("a positive portfolio case on Hold-grade research names research as the constraint", () => {
    const r = assessPolicyFit(
      asset({ dividendYield: 3.5, researchScore: 50 }),
      profile({ policyContext: ctx([incomeShort()]) }),
      5,
    );
    expect(r.insight).toContain("research score (50/100");
    expect(r.insight).toContain("constraint");
  });

  it("a negative insight never gets the research caveat", () => {
    const r = assessPolicyFit(
      asset({ dividendYield: 0, researchScore: 50 }),
      profile({ policyContext: ctx([incomeShort()]) }),
      5,
    );
    expect(r.insight ?? "").not.toContain("constraint");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Bounds and integration through computePortfolioFit               */
/* ------------------------------------------------------------------ */

describe("bounds and fit-scorer integration", () => {
  it("the summed adjustment is clamped to ±POLICY_FIT_MAX_ADJUSTMENT", () => {
    // Every negative signal at once.
    const p = profile({
      objective: "ai_optimized",
      policyContext: ctx([
        snap("structure", { status: "mismatch", metrics: { growthEnginePct: 95, bandLo: 35, bandHi: 80 } }),
        snap("resilience", { status: "mismatch", metrics: { stressPct: 50, tolerancePct: 30 } }),
        snap("liquidity", { status: "mismatch", metrics: { liquidPct: 40, floorPct: 50, cashPct: 0.2, cashMin: 5, cashMax: 40 } }),
        incomeShort(),
      ]),
    });
    const r = assessPolicyFit(asset({ beta: 1.5, dividendYield: 0 }), p, 8);
    expect(Math.abs(r.adjustment)).toBeLessThanOrEqual(POLICY_FIT_MAX_ADJUSTMENT);
    expect(r.notes.length).toBeGreaterThanOrEqual(3);
  });

  it("computePortfolioFit: the adjustment moves the fit conclusion boundedly, and the bridge discloses it", () => {
    const base = profile({
      sectorWeights: [{ sector: "Healthcare", weight: 10 }],
      policyContext: null,
    });
    const withPolicy = {
      ...base,
      policyContext: ctx([{ ...incomeShort(), priority: 3 }]),
    };
    const a = asset({
      symbol: "JNJ",
      sector: "Healthcare",
      dividendYield: 3.2,
      beta: 0.9,
      researchScore: 70,
    });

    const before = computePortfolioFit(a, base);
    const after = computePortfolioFit(a, withPolicy);

    expect(after.fitScore).toBeGreaterThan(before.fitScore);
    // The effects composite carries (1 − researchWeight); the fit move is bounded.
    expect(after.fitScore - before.fitScore).toBeLessThanOrEqual(POLICY_FIT_MAX_ADJUSTMENT);
    expect(after.policyAdjustment).toBeGreaterThan(0);
    expect(after.policyInsight).toContain("income");
    expect(after.bridge.some((s) => s.label === "Your policy & portfolio health")).toBe(true);
    expect(before.policyAdjustment).toBe(0);
    expect(before.policyInsight).toBeNull();
    expect(before.bridge.some((s) => s.label === "Your policy & portfolio health")).toBe(false);
  });

  it("research guardrail still binds: policy uplift cannot push fit past research + 15", () => {
    const p = profile({
      sectorWeights: [],
      missingSectors: ["Healthcare"],
      policyContext: ctx([
        { ...incomeShort(), priority: 3 },
        snap("resilience", { status: "mismatch", priority: 3, metrics: { stressPct: 45, tolerancePct: 30 } }),
      ]),
    });
    // Weak research, everything else glowing.
    const fit = computePortfolioFit(
      asset({ symbol: "T", sector: "Healthcare", dividendYield: 5, beta: 0.5, researchScore: 40 }),
      p,
    );
    expect(fit.fitScore).toBeLessThanOrEqual(40 + 15);
  });

  it("policy notes surface in reasons/tradeoffs without displacing the cap reason", () => {
    const p = profile({
      policyContext: ctx([
        snap("liquidity", {
          status: "mismatch",
          priority: 3,
          metrics: { liquidPct: 60, floorPct: 10, cashPct: 0.5, cashMin: 3, cashMax: 40 },
        }),
      ]),
    });
    const fit = computePortfolioFit(asset({ symbol: "NVDA", sector: "Technology", beta: 1.1, researchScore: 75 }), p);
    expect(fit.tradeoffs.some((t) => t.includes("cash already at 0.5%"))).toBe(true);
  });
});
