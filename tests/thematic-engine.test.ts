import { describe, it, expect, vi } from "vitest";
import type { StockFundamentals } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));
vi.mock("@/lib/ai/router", () => ({ pickModel: vi.fn().mockResolvedValue("test-model") }));
vi.mock("@/lib/db", () => ({
  getFreshFundamentals: () => ({
    rows: [{ symbol: "ACME", name: "Acme Corp", sector: "Tech", industry: "Software" } as unknown as StockFundamentals],
  }),
}));
vi.mock("@/lib/news", () => ({ fetchMarketNews: vi.fn().mockResolvedValue([]) }));
vi.mock("yahoo-finance2", () => ({
  default: class {
    async quote() { throw new Error("no network in tests"); }
    async chart() { throw new Error("no network in tests"); }
  },
}));

const {
  pickCommodityProxies,
  pctChange,
  computeOpportunityScore,
  runThematicEngine,
} = await import("@/lib/thematic-engine");

function futureStateJson() {
  return JSON.stringify({ inevitabilityScore: 8, timeHorizon: "5-10 years", drivingForces: ["a", "b"], rationale: "r" });
}
function chainJson() {
  return JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({
      tier: i + 1, tierLabel: `Tier ${i + 1}`, description: "d", exampleCompanies: [], isBottleneck: i === 2,
    })),
  );
}
function bottleneckJson() {
  return JSON.stringify({ score: 7, bottleneckTier: 3, bottleneckDescription: "d", scarceFactors: [], substituteRisk: "low", substituteRationale: "r", expansionDifficulty: "e" });
}
function supplyDemandJson() {
  return JSON.stringify({ score: 6, demandTrajectory: "accelerating", supplyTrajectory: "constrained", capitalCyclePhase: "early", demandDrivers: [], supplyConstraints: [], investmentSignal: "strong" });
}
function commodityJson() {
  return JSON.stringify({ score: 6, primaryCommodities: [], demandCatalysts: [], supplyRisks: [], substitutionRisk: "low", recyclingEconomics: "r", reserveConcentration: "r" });
}
function policyJson() {
  return JSON.stringify({ score: 7, relevantPolicies: [], capitalFlowDirection: "d", geopoliticalFactors: [], indiaSpecificPolicies: [] });
}
function structuralJson() {
  return JSON.stringify({ score: 6, currentLeader: "US", fastestImproving: "India", regions: [], longTermImplications: "l" });
}
function companyMappingJson() {
  return JSON.stringify([{ symbol: "ACME", tier: 1, strategicImportance: "high", moatType: "scale", relevanceRationale: "r" }]);
}

/** Route a mocked runPrompt call to the right canned response based on distinguishing prompt text. */
function routeByPrompt(prompt: string): string {
  if (prompt.includes("inevitability")) return futureStateJson();
  if (prompt.includes("dependency chain")) return chainJson();
  if (prompt.includes("bottleneck in the")) return bottleneckJson();
  if (prompt.includes("supply-demand balance")) return supplyDemandJson();
  if (prompt.includes("commodity intensity")) return commodityJson();
  if (prompt.includes("government policy support")) return policyJson();
  if (prompt.includes("structural advantages across")) return structuralJson();
  if (prompt.includes("belong to which tier")) return companyMappingJson();
  throw new Error(`unrecognised prompt in test: ${prompt.slice(0, 60)}`);
}

describe("pickCommodityProxies", () => {
  it("matches theme keywords and caps at 4", () => {
    const result = pickCommodityProxies("AI Compute Semiconductor Energy");
    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.some((p) => p.ticker === "SMH")).toBe(true);
  });

  it("falls back to default commodities when no keyword matches", () => {
    const result = pickCommodityProxies("Something Totally Unrelated To Any Keyword");
    expect(result).toEqual([
      { ticker: "GLD", name: "Gold (GLD ETF)" },
      { ticker: "USO", name: "Crude Oil (USO ETF)" },
    ]);
  });

  it("deduplicates tickers shared across matched keywords", () => {
    const result = pickCommodityProxies("battery lithium");
    const tickers = result.map((p) => p.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });
});

describe("pctChange", () => {
  it("returns null when history is shorter than the lookback window", () => {
    expect(pctChange([100, 105], 22)).toBeNull();
  });

  it("returns null instead of dividing by zero on a zero base price", () => {
    expect(pctChange([0, 10], 1)).toBeNull();
  });

  it("computes the correct percentage change", () => {
    const history = [100, 110];
    expect(pctChange(history, 1)).toBeCloseTo(10);
  });
});

describe("computeOpportunityScore", () => {
  const futureState = { inevitabilityScore: 10, timeHorizon: "x", drivingForces: [], rationale: "" };
  const bottleneck = { score: 10, bottleneckTier: 1, bottleneckDescription: "", scarceFactors: [], substituteRisk: "low" as const, substituteRationale: "", expansionDifficulty: "" };
  const supplyDemand = { score: 10, demandTrajectory: "accelerating" as const, supplyTrajectory: "constrained" as const, capitalCyclePhase: "early" as const, commodityProxies: [], demandDrivers: [], supplyConstraints: [], investmentSignal: "strong" as const };
  const commodity = { score: 10, primaryCommodities: [], demandCatalysts: [], supplyRisks: [], substitutionRisk: "low" as const, recyclingEconomics: "", reserveConcentration: "" };
  const policy = { score: 10, relevantPolicies: [], capitalFlowDirection: "", geopoliticalFactors: [], indiaSpecificPolicies: [] };
  const structural = { score: 10, currentLeader: "US", fastestImproving: "India", regions: [], longTermImplications: "" };

  it("scores a maximal theme as exceptional (near 100)", () => {
    const result = computeOpportunityScore(futureState, bottleneck, supplyDemand, commodity, policy, structural, []);
    expect(result.themeScore).toBe(100);
    expect(result.verdict).toBe("exceptional");
  });

  it("scores a minimal theme as avoid (near 0)", () => {
    const zero = { ...futureState, inevitabilityScore: 0 };
    const zeroBottleneck = { ...bottleneck, score: 0, substituteRisk: "high" as const };
    const result = computeOpportunityScore(
      zero, zeroBottleneck,
      { ...supplyDemand, score: 0 }, { ...commodity, score: 0 }, { ...policy, score: 0 },
      { ...structural, score: 0 }, [],
    );
    expect(result.themeScore).toBe(30 * 0.1); // only substitutionResistance floor (high risk = 30) contributes
    expect(result.verdict).toBe("avoid");
  });

  it("ranks top companies by strategic importance and quality, not input order", () => {
    const companies = [
      { tier: 1 as const, tierLabel: "T1", symbol: "LOW", name: "Low Priority", sector: null, industry: null, roic: 5, grossMargin: null, revenueGrowthYoY: null, debtToEquity: 1, isIndia: false, relevanceRationale: "", qualityScore: null, strategicImportance: "low" as const, moatType: "none" as const },
      { tier: 1 as const, tierLabel: "T1", symbol: "CRIT", name: "Critical Co", sector: null, industry: null, roic: 20, grossMargin: null, revenueGrowthYoY: null, debtToEquity: 0.5, isIndia: false, relevanceRationale: "", qualityScore: null, strategicImportance: "critical" as const, moatType: "scale" as const },
    ];
    const result = computeOpportunityScore(futureState, bottleneck, supplyDemand, commodity, policy, structural, companies);
    expect(result.topCompanies[0].symbol).toBe("CRIT");
  });
});

describe("runThematicEngine — failure tracking", () => {
  it("records zero failures and calls the AI exactly 8 times when everything succeeds", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => routeByPrompt(prompt));

    const report = await runThematicEngine({ theme: "AI Compute" });

    expect(report.stageFailures).toEqual([]);
    expect(runPromptMock).toHaveBeenCalledTimes(8); // was 9 before removing the wasted duplicate supply/demand call
  });

  it("records a named failure and falls back to a neutral default without crashing the pipeline", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("bottleneck in the")) throw new Error("Ollama request timed out");
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute" });

    expect(report.stageFailures).toEqual([{ stage: "Bottleneck", error: "Ollama request timed out" }]);
    expect(report.bottleneck.score).toBe(5); // neutral default, not a crash
    expect(report.futureState.inevitabilityScore).toBe(8); // other stages still populated from real data
  });

  it("does not silently mask a total pipeline failure as success", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockRejectedValue(new Error("model unavailable"));

    const report = await runThematicEngine({ theme: "AI Compute" });

    expect(report.stageFailures.length).toBeGreaterThan(0);
    expect(report.stageFailures.every((f) => f.error === "model unavailable")).toBe(true);
  });
});
