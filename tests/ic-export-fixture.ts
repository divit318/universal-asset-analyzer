/**
 * Shared fixture for the IC export tests: a minimal-but-complete ICReport
 * (schemaVersion 2), type-checked against the real pipeline types so a schema
 * drift breaks these tests at compile time.
 */

import type { ICReport } from "@/lib/ic-report";
import type { CanonicalFacts, Datum } from "@/lib/ic/canonical";
import type { SignalCheck, DetectedSignal } from "@/lib/ic-signals";
import type { ValuationSuiteResult, MethodEntry } from "@/lib/ic/valuation-suite";
import type {
  DcfInputs,
  DcfResult,
  ScenarioSetResult,
  SensitivityResult,
} from "@/lib/ic/valuation-engine";
import type { ResolvedProposal } from "@/lib/ic/valuation-inputs";
import type { HistoryStats } from "@/lib/ic/history-stats";

const AS_OF = "2026-08-01T10:00:00.000Z";
const GENERATED_AT = "2026-08-01T23:30:00.000Z"; // UTC date 2026-08-01

function datum(value: number, unit: Datum["unit"], currency: string, periodLabel = "TTM"): Datum {
  return {
    value,
    unit,
    currency: unit === "currency" || unit === "perShare" ? currency : undefined,
    periodLabel,
    source: { provider: "yahoo-quoteSummary", field: `fixture.${unit}` },
    asOf: AS_OF,
  };
}

function buildFacts(currency: string): CanonicalFacts {
  return {
    symbol: "TESTCO",
    companyName: "Test Company Inc",
    market: currency === "INR" ? "IN" : "US",
    exchange: currency === "INR" ? "NSI" : "NMS",
    sector: "Technology",
    industry: "Software",
    currency,
    asOf: AS_OF,
    spot: datum(100, "perShare", currency, "spot"),
    marketCap: datum(5e10, "currency", currency, "spot"),
    sharesOutstanding: datum(5e8, "shares", currency, "spot"),
    totalDebt: datum(3e9, "currency", currency),
    totalCash: datum(2e9, "currency", currency),
    netDebt: datum(1e9, "currency", currency),
    enterpriseValue: datum(5.1e10, "currency", currency, "spot"),
    freeCashFlowTtm: datum(2e9, "currency", currency),
    freeCashFlowFy: datum(1.8e9, "currency", currency, "FY2025"),
    ebitdaTtm: datum(3e9, "currency", currency),
    trailingPE: datum(25, "ratio", currency),
    forwardPE: datum(22, "ratio", currency),
    pegRatio: null,
    priceToBook: datum(6, "ratio", currency),
    evToEbitda: datum(17, "ratio", currency),
    priceToSales: datum(5, "ratio", currency),
    dividendYield: datum(0.012, "fraction", currency),
    returnOnEquity: datum(0.24, "fraction", currency),
    returnOnAssets: null,
    grossMargin: datum(0.62, "fraction", currency),
    operatingMargin: datum(0.28, "fraction", currency),
    netMargin: datum(0.2, "fraction", currency),
    revenueGrowthYoY: datum(0.11, "fraction", currency),
    earningsGrowthYoY: null,
    debtToEquity: datum(0.8, "ratio", currency),
    currentRatio: datum(1.6, "ratio", currency),
    statements: {
      provider: "sec-edgar",
      currency: "USD",
      fiscalYears: [2024, 2025],
      revenue: [
        { fy: 2024, end: "2024-12-31", value: 9e9 },
        { fy: 2025, end: "2025-12-31", value: 1e10 },
      ],
      netIncome: [
        { fy: 2024, end: "2024-12-31", value: 1.8e9 },
        { fy: 2025, end: "2025-12-31", value: 2e9 },
      ],
      freeCashFlow: [
        { fy: 2024, end: "2024-12-31", value: 1.6e9 },
        { fy: 2025, end: "2025-12-31", value: 1.8e9 },
      ],
      operatingMargin: [
        { fy: 2024, end: "2024-12-31", value: 0.27 },
        { fy: 2025, end: "2025-12-31", value: 0.28 },
      ],
      grossMargin: [
        { fy: 2024, end: "2024-12-31", value: 0.61 },
        { fy: 2025, end: "2025-12-31", value: 0.62 },
      ],
      revenueCagr: 0.11,
      revenueCagrYears: 1,
      fcfCagr: 0.125,
      fcfCagrYears: 1,
    },
    analyst: null,
    insider: null,
    screenerIn: null,
    gaps: [
      { concept: "analyst coverage", reason: "no analyst estimates reported for this name" },
    ],
    validationIssues: [
      "Enterprise value computed without full debt detail; treat EV-based multiples as approximate.",
    ],
  };
}

const firedSignal: DetectedSignal = {
  id: "sig-margin-1",
  category: "MARGIN_COMPRESSION",
  severity: "high",
  description: "Operating margin fell 3.2pp (31.2% to 28.0%)",
  dataPoints: ["FY2024: 31.2%", "FY2025: 28.0%"],
};

function buildSignalChecks(): SignalCheck[] {
  return [
    {
      category: "MARGIN_COMPRESSION",
      label: "Margin compression",
      market: "ANY",
      evidence: "annual operating margin series, last 3 fiscal years",
      threshold: "fires when operating margin falls more than 2pp peak to latest",
      evaluated: true,
      unavailableReason: null,
      fired: true,
      signal: firedSignal,
    },
    {
      category: "DEBT_INCREASE",
      label: "Debt increase",
      market: "ANY",
      evidence: "total debt vs total cash, TTM",
      threshold: "fires when net debt grows more than 40% year over year",
      evaluated: true,
      unavailableReason: null,
      fired: false,
      signal: null,
    },
    {
      category: "INSIDER_SELLING",
      label: "Insider selling",
      market: "US",
      evidence: "insider transactions, trailing 6 months",
      threshold: "fires when net insider sales exceed 1% of float",
      evaluated: false,
      unavailableReason: "no insider transaction data reported for this name",
      fired: false,
      signal: null,
    },
  ];
}

function buildProposal(): ResolvedProposal {
  return {
    growthY1: { value: 0.12, source: "model", justification: "delivered revenue CAGR sustained by backlog" },
    fadeYears: { value: 10, source: "default" },
    terminalGrowth: { value: 0.025, source: "default" },
    waccAdjustmentBp: { value: 0, source: "default" },
    exitMultiple: { value: 20, source: "model" },
    peMultiple: { value: 24, source: "model", justification: "peer median forward P/E" },
    evEbitdaMultiple: { value: null, source: "default", rejectedValue: 55, rejectionReason: "EV/EBITDA outside 2-50x" },
    fcfRequiredYield: { value: 0.04, source: "default" },
    bearGrowthDelta: { value: 0.05, source: "default" },
    bullGrowthDelta: { value: 0.04, source: "default" },
    modelUnavailable: false,
    promptVersion: "vi-2",
  };
}

function dcfInputs(growth: number, wacc: number): DcfInputs {
  return {
    baseFcf: 2e9,
    netDebt: 1e9,
    sharesOutstanding: 5e8,
    growthPath: [growth, growth - 0.02, growth - 0.04],
    terminalGrowth: 0.025,
    wacc,
    exitMultiple: 20,
    justifications: { growth: "fixture" },
  };
}

function dcfResult(perShare: number, spot: number): DcfResult {
  const rows = [1, 2, 3].map((year) => ({
    year,
    growth: 0.12 - (year - 1) * 0.02,
    fcf: 2e9 * Math.pow(1.1, year),
    discountFactor: 1 / Math.pow(1.09, year),
    pv: (2e9 * Math.pow(1.1, year)) / Math.pow(1.09, year),
  }));
  const pvExplicit = rows.reduce((a, r) => a + r.pv, 0);
  const equityValue = perShare * 5e8;
  const enterpriseValue = equityValue + 1e9;
  return {
    rows,
    pvExplicit,
    terminalValuePerp: enterpriseValue - pvExplicit,
    pvTerminalPerp: enterpriseValue - pvExplicit,
    terminalValueExit: 4.4e10,
    pvTerminalExit: 3.4e10,
    enterpriseValue,
    netDebt: 1e9,
    equityValue,
    perShare,
    perShareExit: perShare * 0.95,
    terminalShare: (enterpriseValue - pvExplicit) / enterpriseValue,
    vsSpot: perShare / spot - 1,
  };
}

function buildValuation(currency: string): ValuationSuiteResult {
  const spot = 100;
  const scenarios: ScenarioSetResult = {
    bear: { label: "bear", inputs: dcfInputs(0.07, 0.1), result: dcfResult(78.4, spot), violations: [] },
    base: { label: "base", inputs: dcfInputs(0.12, 0.09), result: dcfResult(112.5, spot), violations: [] },
    bull: { label: "bull", inputs: dcfInputs(0.16, 0.085), result: dcfResult(139.2, spot), violations: [] },
    violations: [],
  };
  const sensitivity: SensitivityResult = {
    grid: {
      waccValues: [0.07, 0.08, 0.09, 0.1, 0.11],
      terminalGrowthValues: [0.015, 0.02, 0.025, 0.03, 0.035],
      perShare: [
        [141.1, 148.2, 156.3, 165.4, 175.5],
        [128.8, 134.5, 140.9, 148.1, 156.2],
        [111.11, 122.9, 128.0, 133.7, 140.1],
        [109.4, 113.2, 117.4, 122.0, 127.1],
        [null, 104.8, 108.2, 111.9, 115.9],
      ],
    },
    breakevenGrowth: 0.104,
    drivers: { growthPlus1pp: 6.2, waccPlus1pp: -14.8, terminalPlus50bp: 4.1 },
  };
  const methods: MethodEntry[] = [
    {
      kind: "dcf",
      label: "DCF (fade to terminal)",
      applicable: true,
      notApplicableReason: null,
      perShare: 112.5,
      vsSpot: 0.125,
      assumptions: "Stage-1 FCF growth 12.0% (model-proposed), fading linearly to terminal 2.5% over 3 years. WACC 9.0%.",
      workings: "PV(explicit) + PV(terminal) less net debt over share count",
      confidence: "medium",
      inputSource: "model",
      role: "estimate",
    },
    {
      kind: "pe",
      label: "Relative P/E",
      applicable: true,
      notApplicableReason: null,
      perShare: 96,
      vsSpot: -0.04,
      assumptions: "24.0x applied to EPS (TTM) of 4.00. Basis: peer median forward P/E",
      workings: "24.0x times 4.00 = 96.00",
      confidence: "medium",
      inputSource: "model",
      role: "estimate",
    },
    {
      kind: "p_b",
      label: "Price/Book",
      applicable: true,
      notApplicableReason: null,
      perShare: 100,
      vsSpot: 0,
      assumptions: "6.0x applied to book value per share. Anchor: this reproduces the market's own current multiple, so it is shown for context and excluded from the blend.",
      workings: "6.0x times 16.67 = 100.00",
      confidence: "low",
      inputSource: "default",
      role: "anchor",
    },
    {
      kind: "analyst",
      label: "Analyst consensus",
      applicable: false,
      notApplicableReason: "no analyst coverage reported for this name",
      perShare: null,
      vsSpot: null,
      assumptions: "not applicable",
      workings: null,
      confidence: "low",
      inputSource: "default",
      role: null,
    },
  ];
  return {
    currency,
    spot,
    asOf: AS_OF,
    promptVersion: "vi-2",
    modelProposedInputs: true,
    proposal: buildProposal(),
    wacc: { value: 0.09, components: "risk-free 4.2%, ERP 5.0%, beta 1.1" },
    dcf: {
      ran: true,
      skippedReason: null,
      inputs: dcfInputs(0.12, 0.09),
      base: dcfResult(112.5, spot),
      scenarios,
    },
    reverse: { impliedGrowth: 0.104, impliedYearsAtBaseGrowth: 6, converged: true },
    sensitivity,
    methods,
    blend: {
      perShare: 106.2,
      components: [
        { label: "DCF (fade to terminal)", perShare: 112.5, weight: 0.62, rationale: "primary method: full cash-flow model with inspected assumptions" },
        { label: "Relative P/E", perShare: 96, weight: 0.38, rationale: "cross-check: peer median forward P/E" },
      ],
    },
    headline: { perShare: 106.2, vsSpot: 0.062 },
    blockingViolations: [],
    warnings: [
      {
        invariant: "terminal value share",
        detail: "base: terminal value carries 86% of EV; the answer is mostly assumption",
        severity: "warning",
      },
    ],
  };
}

function buildHistoryStats(): HistoryStats {
  return {
    windows: [
      { years: 1, available: true, cagr: 0.34, medianCagr: 0.15, percentile: 88, observations: 120, signal: "run_hot" },
      { years: 3, available: true, cagr: 0.18, medianCagr: 0.14, percentile: 65, observations: 90, signal: "neutral" },
      { years: 5, available: false, cagr: null, medianCagr: null, percentile: null, observations: 0, signal: null },
    ],
    verdict: { windowYears: 3, cagr: 0.18, medianCagr: 0.14, percentile: 65, signal: "neutral", observations: 90 },
    sinceListing: { totalReturn: 2.4, years: 7.5 },
  };
}

export function makeReport(overrides: Partial<ICReport> = {}): ICReport {
  const currency = overrides.currency ?? "USD";
  const base: ICReport = {
    schemaVersion: 2,
    symbol: "TESTCO",
    companyName: "Test Company Inc",
    market: currency === "INR" ? "IN" : "US",
    currency,
    generatedAt: GENERATED_AT,
    model: "test-model-7b",
    promptVersions: { agents: "agents-2", thesis: "thesis-2", synthesis: "synth-1", valuationInputs: "vi-2" },
    facts: buildFacts(currency),
    signalChecks: buildSignalChecks(),
    signals: [firedSignal],
    questions: [
      {
        id: "sig-margin-1-q1",
        question: "Is the margin compression structural or temporary cost inflation?",
        assignedAgents: ["business", "competition"],
        sourceSignals: ["sig-margin-1"],
        kind: "signal",
        priority: "high",
      },
      {
        id: "baseline-1",
        question: "What is the durable competitive advantage and is it widening or narrowing?",
        assignedAgents: ["business"],
        sourceSignals: [],
        kind: "baseline",
        priority: "medium",
      },
    ],
    agentFindings: [
      {
        agent: "business",
        agentLabel: "Business Model Analyst",
        questionsAnswered: 2,
        questionsAssigned: 3,
        findings: "The company earns recurring subscription revenue with high switching costs. Margin compression appears driven by a one-time infrastructure build-out rather than pricing pressure.",
        keyInsights: ["Recurring revenue is 82% of the mix", "Margin pressure traces to capex-driven cost ramp"],
        confidence: "medium",
        confidenceDowngraded: "one cited figure could not be traced to the provided data slice",
        dataLimitations: "No segment-level disclosure was available.",
        promptVersion: "agents-2",
      },
    ],
    agentFailures: [
      { agent: "governance", agentLabel: "Governance Analyst", error: "model timeout after 120s", retryable: true },
    ],
    synthesis: {
      dedupedInsights: [
        { insight: "Recurring revenue is 82% of the mix", agent: "Business Model Analyst", alsoStatedBy: ["Industry Analyst"] },
      ],
      duplicatesRemoved: 1,
      disagreements: [
        {
          topic: "Durability of margin pressure",
          positions: [
            { agent: "Business Model Analyst", position: "temporary cost ramp" },
            { agent: "Competition Analyst", position: "structural pricing pressure" },
          ],
        },
      ],
      crossAgentSummary: "Agents agree on revenue quality and disagree on the durability of margin pressure.",
      dataGapAgents: [{ agent: "Business Model Analyst", limitation: "No segment-level disclosure was available." }],
      promptVersion: "synth-1",
      modelUnavailable: false,
    },
    thesis: {
      bull: "Margins recover as the infrastructure build-out completes and pricing holds.",
      bear: "Pricing pressure proves structural and the terminal margin resets lower.",
      base: "Steady 12% growth fading to GDP-plus with margins stabilising near current levels.",
      variantPerception: "The market reads the cost ramp as structural; the evidence says it is temporary.",
      marketExpectations: "Spot implies roughly 10.4% stage-1 FCF growth.",
      keyCatalysts: ["Infrastructure build-out completion", "Next earnings print", "Pricing announcement"],
      keyRisks: ["Structural pricing pressure", "Key customer concentration", "Execution slippage"],
      keyDrivers: ["Subscription mix", "Unit cost curve"],
      promptVersion: "thesis-2",
    },
    valuation: buildValuation(currency),
    caseReconciliation: {
      caseFairValue: 118,
      caseVersion: 3,
      engineHeadline: 106.2,
      spread: 0.111,
      divergent: false,
      explanation: "Your valuation case (v3) is 11.1% above this report's blended estimate; within the 30% agreement band.",
    },
    priorReconciliation: {
      mcP50: 98,
      engineHeadline: 106.2,
      spread: 0.084,
      divergent: false,
      explanation: "This report's blended estimate is 8.4% above the quant engine's Monte Carlo median; within the 30% agreement band.",
    },
    historyStats: buildHistoryStats(),
    monitorables: [
      { label: "Subscription mix", kind: "driver", trigger: null, source: "thesis key driver" },
      { label: "Operating margin fell 3.2pp (31.2% to 28.0%)", kind: "signal", trigger: "re-check margin compression next quarter", source: "signal MARGIN_COMPRESSION" },
    ],
    timings: [
      { stage: "signals", ms: 12 },
      { stage: "valuation", ms: 840 },
      { stage: "agents", ms: 61000 },
    ],
  };
  return { ...base, ...overrides };
}

/** A report whose valuation is blocked: headline null, blocking violations present. */
export function makeBlockedReport(): ICReport {
  const report = makeReport();
  const valuation: ValuationSuiteResult = {
    ...report.valuation,
    dcf: { ran: false, skippedReason: "blocked by input validation; see violations", inputs: null, base: null, scenarios: null },
    reverse: null,
    sensitivity: null,
    blend: null,
    headline: null,
    blockingViolations: [
      {
        invariant: "terminal growth < WACC",
        detail: "terminal growth 9.5% is not at least 0.5pp below WACC 9.0%; the perpetuity value explodes",
        severity: "blocking",
      },
    ],
  };
  return { ...report, valuation };
}
