import { describe, it, expect } from "vitest";
import { reconcileWithCase, reconcileWithPrior, runValuationStage } from "@/lib/ic-valuation";
import { buildCanonicalFacts } from "@/lib/ic/canonical";
import type { ValuationSuiteResult } from "@/lib/ic/valuation-suite";
import type { ValuationCase } from "@/lib/valuation/case";
import type { Quote, FundamentalsSnapshot } from "@/lib/types";

function suiteWithHeadline(perShare: number | null): ValuationSuiteResult {
  return {
    currency: "USD",
    spot: 100,
    asOf: "2026-08-02T00:00:00.000Z",
    promptVersion: "vi-test",
    modelProposedInputs: false,
    proposal: {} as ValuationSuiteResult["proposal"],
    wacc: { value: 0.1, components: "test" },
    dcf: { ran: false, skippedReason: null, inputs: null, base: null, scenarios: null },
    reverse: null,
    sensitivity: null,
    methods: [],
    blend: null,
    headline: perShare != null ? { perShare, vsSpot: perShare / 100 - 1 } : null,
    blockingViolations: [],
    warnings: [],
  };
}

function vcase(fairValue: number | null): ValuationCase {
  return {
    symbol: "TEST",
    currency: "USD",
    method: "dcf_fcf",
    version: 3,
    author: "user",
    assumptions: {} as ValuationCase["assumptions"],
    result: { fairValue, fairValueBear: null, fairValueBull: null, marginOfSafety: null, impliedUpside: null, impliedGrowth: null, terminalValueShare: 0.5, invalidReason: null } as unknown as ValuationCase["result"],
    priceAt: 100,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastUserEventAt: null,
  } as ValuationCase;
}

describe("reconcileWithCase", () => {
  it("returns null without a case or a finite fair value", () => {
    expect(reconcileWithCase(suiteWithHeadline(110), null)).toBeNull();
    expect(reconcileWithCase(suiteWithHeadline(110), vcase(null))).toBeNull();
    expect(reconcileWithCase(suiteWithHeadline(110), vcase(Number.NaN))).toBeNull();
  });

  it("computes the spread deterministically and flags divergence above 30%", () => {
    const agree = reconcileWithCase(suiteWithHeadline(110), vcase(120))!;
    expect(agree.divergent).toBe(false);
    expect(agree.spread).toBeCloseTo(10 / 110, 10);
    expect(agree.explanation).toContain("within the 30% agreement band");

    const diverge = reconcileWithCase(suiteWithHeadline(100), vcase(500))!;
    expect(diverge.divergent).toBe(true);
    expect(diverge.spread).toBeCloseTo(4, 10);
    expect(diverge.explanation).toContain("disagree");
  });

  it("still reports the case when the engine produced no headline", () => {
    const r = reconcileWithCase(suiteWithHeadline(null), vcase(120))!;
    expect(r.engineHeadline).toBeNull();
    expect(r.spread).toBeNull();
    expect(r.explanation).toContain("no headline");
  });

  it("attributes the case honestly: 'your' only when an assumption is user-authored", () => {
    // The reconciliation prose reaches the report and its exports. Calling an
    // untouched machine seed "your valuation case" manufactures a judgment the
    // user never made — the exact failure that put "Your Case" over a seeded
    // number in the workspace.
    const seed = reconcileWithCase(suiteWithHeadline(110), vcase(120))!;
    expect(seed.explanation).not.toContain("Your valuation case");
    expect(seed.explanation).toContain("machine seed");

    const owned = vcase(120);
    owned.assumptions = {
      growthRate1: { locked: true },
    } as unknown as ValuationCase["assumptions"];
    const yours = reconcileWithCase(suiteWithHeadline(110), owned)!;
    expect(yours.explanation).toContain("Your valuation case");
    expect(yours.explanation).not.toContain("machine seed");
  });
});

describe("reconcileWithPrior", () => {
  it("returns null without a usable prior", () => {
    expect(reconcileWithPrior(suiteWithHeadline(110), null)).toBeNull();
    expect(reconcileWithPrior(suiteWithHeadline(110), 0)).toBeNull();
  });

  it("compares the engine headline to the Monte Carlo median", () => {
    const r = reconcileWithPrior(suiteWithHeadline(110), 100)!;
    expect(r.divergent).toBe(false);
    expect(r.spread).toBeCloseTo(0.1, 10);
  });
});

describe("runValuationStage end-to-end (deterministic)", () => {
  const quote: Quote = {
    symbol: "TEST", name: "Test Corp", price: 200, previousClose: 199, change: 1, changePercent: 0.5,
    currency: "USD", marketCap: 4.8e12, peRatio: 40, dayHigh: null, dayLow: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, volume: null, exchange: "NMS",
  };
  const snapshot: FundamentalsSnapshot = {
    symbol: "TEST", price: 200, trailingPE: 40, forwardPE: 30, pegRatio: 1.2, priceToBook: 40,
    dividendYield: 0.0003, returnOnEquity: 0.9, returnOnAssets: 0.5, grossMargins: 0.7,
    operatingMargins: 0.6, profitMargins: 0.5, ebitdaMargins: 0.65, revenueGrowth: 0.65,
    earningsGrowth: 0.6, debtToEquity: 0.12, currentRatio: 4, quickRatio: 3.5,
    freeCashflow: 46e9, operatingCashflow: 60e9, totalCash: 53e9, totalDebt: 12.8e9,
    ebitda: 165e9, enterpriseToEbitda: 29, priceToSalesTrailing12Months: 22,
  };

  it("produces a suite whose headline, methods and reconciliation are mutually consistent", async () => {
    const facts = buildCanonicalFacts({
      symbol: "TEST", quote, snapshot, analyst: null, insider: null, statements: null, screenerIn: null,
    });
    const r = await runValuationStage({
      facts,
      wacc: { value: 0.11, components: "test" },
      vcase: vcase(67266), // the NVDA-baseline absurd case value
      enginePriorP50: null,
      skipModelProposal: true,
    });
    expect(r.suite.headline).not.toBeNull();
    // The absurd case is flagged as divergent instead of silently adopted.
    expect(r.caseReconciliation!.divergent).toBe(true);
    // Headline arithmetic ties to spot.
    expect(r.suite.headline!.vsSpot).toBeCloseTo(r.suite.headline!.perShare / 200 - 1, 8);
  });
});
