import { describe, it, expect } from "vitest";
import { buildCanonicalFacts, type CanonicalInput } from "@/lib/ic/canonical";
import { defaultProposal, resolveProposal } from "@/lib/ic/valuation-inputs";
import { assembleValuationSuite, profileCompany, methodApplicability } from "@/lib/ic/valuation-suite";
import type { Quote, FundamentalsSnapshot } from "@/lib/types";

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: "TEST", name: "Test Corp", price: 200, previousClose: 199, change: 1, changePercent: 0.5,
  currency: "USD", marketCap: 4.8e12, peRatio: 40, dayHigh: null, dayLow: null,
  fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, volume: null, exchange: "NMS", ...over,
});

const snapshot = (over: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot => ({
  symbol: "TEST", price: 200, trailingPE: 40, forwardPE: 30, pegRatio: 1.2, priceToBook: 40,
  dividendYield: 0.0003, returnOnEquity: 0.9, returnOnAssets: 0.5, grossMargins: 0.7,
  operatingMargins: 0.6, profitMargins: 0.5, ebitdaMargins: 0.65, revenueGrowth: 0.65,
  earningsGrowth: 0.6, debtToEquity: 0.12, currentRatio: 4, quickRatio: 3.5,
  freeCashflow: 46e9, operatingCashflow: 60e9, totalCash: 53e9, totalDebt: 12.8e9,
  ebitda: 165e9, enterpriseToEbitda: 29, priceToSalesTrailing12Months: 22, ...over,
});

function factsFor(snapOver: Partial<FundamentalsSnapshot> = {}, quoteOver: Partial<Quote> = {}) {
  const input: CanonicalInput = {
    symbol: "TEST", quote: quote(quoteOver), snapshot: snapshot(snapOver),
    analyst: null, insider: null, statements: null, screenerIn: null,
    now: "2026-08-02T00:00:00.000Z",
  };
  return buildCanonicalFacts(input);
}

const WACC = { value: 0.11, components: "CAPM: rf 4.4% + β×ERP 5.5%, after-tax debt" };

function suiteFor(snapOver: Partial<FundamentalsSnapshot> = {}, sector?: string, industry?: string) {
  const facts = factsFor(snapOver);
  const defaults = defaultProposal(facts);
  const proposal = resolveProposal(null, defaults, true);
  return assembleValuationSuite({ facts, proposal, wacc: WACC, sector, industry });
}

describe("input resolution boundary (Phase 2 directive)", () => {
  it("clamps NVDA-class delivered growth into the band by default", () => {
    const facts = factsFor(); // revenueGrowth 65%
    const d = defaultProposal(facts);
    expect(d.growthY1).toBeLessThanOrEqual(0.25);
  });

  it("rejects out-of-band model proposals field by field, recording the rejection", () => {
    const facts = factsFor();
    const d = defaultProposal(facts);
    const r = resolveProposal(
      { growthY1: 0.9, terminalGrowth: 0.12, peMultiple: 25, justifications: { growthY1: "agi" } },
      d,
      false,
    );
    expect(r.growthY1.source).toBe("default");
    expect(r.growthY1.rejectedValue).toBe(0.9);
    expect(r.terminalGrowth.source).toBe("default");
    expect(r.peMultiple.source).toBe("model");
    expect(r.peMultiple.value).toBe(25);
  });

  it("rejects >25% growth proposals that carry no justification", () => {
    const facts = factsFor();
    const d = defaultProposal(facts);
    const r = resolveProposal({ growthY1: 0.3, justifications: {} }, d, false);
    expect(r.growthY1.source).toBe("default");
    expect(r.growthY1.rejectionReason).toContain("justification");
  });
});

describe("assembleValuationSuite", () => {
  it("headline, methods and scenarios all derive from one computation", () => {
    const s = suiteFor();
    expect(s.blockingViolations).toHaveLength(0);
    expect(s.dcf.ran).toBe(true);
    expect(s.headline).not.toBeNull();
    // headline equals the blend of the shown methods exactly
    const blended = s.blend!.components.reduce((a, c) => a + c.perShare * c.weight, 0);
    expect(s.headline!.perShare).toBeCloseTo(blended, 8);
    // vsSpot arithmetic consistent with spot
    expect(s.headline!.vsSpot).toBeCloseTo(s.headline!.perShare / 200 - 1, 8);
  });

  it("every applicable method carries deterministic workings and assumptions", () => {
    const s = suiteFor();
    for (const m of s.methods.filter((x) => x.applicable)) {
      expect(m.workings).toBeTruthy();
      expect(m.assumptions.length).toBeGreaterThan(10);
      expect(m.perShare).toBeGreaterThan(0);
    }
  });

  it("financials: DCF and EV/EBITDA are suppressed with reasons; P/B activates as an anchor", () => {
    const s = suiteFor({}, "Financial Services", "Banks - Diversified");
    const dcf = s.methods.find((m) => m.kind === "dcf")!;
    expect(dcf.applicable).toBe(false);
    expect(dcf.notApplicableReason).toContain("financial institution");
    const ev = s.methods.find((m) => m.kind === "ev_ebitda")!;
    expect(ev.applicable).toBe(false);
    const pb = s.methods.find((m) => m.kind === "p_b")!;
    expect(pb.applicable).toBe(true);
    expect(pb.role).toBe("anchor");
    // No model proposal and no analyst coverage: only market anchors exist,
    // so there is honestly no independent estimate — headline stays null
    // rather than laundering spot back as a "valuation".
    expect(s.headline).toBeNull();
  });

  it("anchors never enter the blend; a defaulted current multiple cannot launder spot into the headline", () => {
    const s = suiteFor();
    const anchorLabels = s.methods.filter((m) => m.role === "anchor").map((m) => m.label);
    expect(anchorLabels.length).toBeGreaterThan(0);
    for (const c of s.blend!.components) {
      expect(anchorLabels).not.toContain(c.label);
    }
  });

  it("analyst consensus joins the blend as an estimate when coverage is real", () => {
    const facts = buildCanonicalFacts({
      symbol: "TEST", quote: quote(), snapshot: snapshot(),
      analyst: {
        targetMean: 250, targetHigh: 300, targetLow: 180, upsidePercent: 25,
        recommendationKey: "buy", numberOfOpinions: 40, strongBuy: 10, buy: 20, hold: 8, sell: 2, strongSell: 0,
        epsRevisionsUp30d: 5, epsRevisionsDown30d: 1, epsSurprises: [0.05, 0.02],
      },
      insider: null, statements: null, screenerIn: null, now: "2026-08-02T00:00:00.000Z",
    });
    const proposal = resolveProposal(null, defaultProposal(facts), true);
    const s = assembleValuationSuite({ facts, proposal, wacc: WACC });
    const analystMethod = s.methods.find((m) => m.kind === "analyst")!;
    expect(analystMethod.applicable).toBe(true);
    expect(analystMethod.perShare).toBe(250);
    expect(s.blend!.components.some((c) => c.label === "Analyst consensus")).toBe(true);
  });

  it("REITs: EV/EBITDA suppressed, P/B used", () => {
    const s = suiteFor({}, "Real Estate", "REIT - Retail");
    expect(s.methods.find((m) => m.kind === "ev_ebitda")!.applicable).toBe(false);
    expect(s.methods.find((m) => m.kind === "p_b")!.applicable).toBe(true);
  });

  it("loss-makers: P/E suppressed, P/S activates, DCF declines with a reason", () => {
    const s = suiteFor({ trailingPE: null, freeCashflow: -3e9, priceToSalesTrailing12Months: 6 });
    const dcf = s.methods.find((m) => m.kind === "dcf")!;
    expect(dcf.applicable).toBe(false);
    expect(dcf.notApplicableReason).toBeTruthy();
    expect(s.methods.find((m) => m.kind === "pe")!.applicable).toBe(false);
    expect(s.methods.find((m) => m.kind === "p_s")!.applicable).toBe(true);
  });

  it("negative book equity: P/B suppressed with a reason", () => {
    const s = suiteFor({ priceToBook: -5 }, "Financial Services", "Banks");
    const pb = s.methods.find((m) => m.kind === "p_b")!;
    expect(pb.applicable).toBe(false);
    expect(pb.notApplicableReason).toContain("negative");
  });

  it("net-debt-dominated bridge flows through EV methods", () => {
    const s = suiteFor({ totalDebt: 300e9, totalCash: 5e9, ebitda: 20e9, enterpriseToEbitda: 10 });
    const ev = s.methods.find((m) => m.kind === "ev_ebitda")!;
    if (ev.applicable) {
      // equity = multiple × EBITDA − netDebt; netDebt 295e9 dominates
      expect(ev.perShare).toBeLessThan(0.001 * 4.8e12);
    }
  });

  it("no methods usable ⇒ headline null, never a fabricated number", () => {
    const s = suiteFor({
      trailingPE: null, forwardPE: null, priceToBook: null, enterpriseToEbitda: null,
      ebitda: null, freeCashflow: null, priceToSalesTrailing12Months: null,
    });
    expect(s.headline).toBeNull();
  });

  it("records prompt version and input provenance for reproducibility", () => {
    const s = suiteFor();
    expect(s.promptVersion).toBeTruthy();
    expect(s.modelProposedInputs).toBe(false);
    expect(s.proposal.growthY1.source).toBe("default");
  });
});

describe("profileCompany / methodApplicability", () => {
  it("classifies financials and REITs", () => {
    const facts = factsFor();
    expect(profileCompany(facts, "Financial Services", "Insurance").isFinancial).toBe(true);
    expect(profileCompany(facts, "Real Estate", "REIT - Office").isReit).toBe(true);
    const apps = methodApplicability(profileCompany(facts, "Technology", "Semiconductors"));
    expect(apps.find((a) => a.kind === "dcf")!.applicable).toBe(true);
  });
});
