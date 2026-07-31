import { describe, it, expect, vi } from "vitest";
import type { StockFundamentals } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));
vi.mock("@/lib/ai/router", () => ({ pickModel: vi.fn().mockResolvedValue("test-model") }));
// A realistic row: the universe shortlist matches on the Yahoo industry string,
// so the fixture has to look like one for the company-mapping stage to run.
vi.mock("@/lib/db", () => ({
  getFreshFundamentals: () => ({
    rows: [
      { symbol: "ACME", name: "Acme Semiconductor", sector: "Technology", industry: "Semiconductors", roic: 20, grossMargin: 55, operatingMargin: 30, fcfMargin: 20, roe: 25, debtToEquity: 0.4, currentRatio: 2.2 } as unknown as StockFundamentals,
      { symbol: "ZZBANK", name: "Zed Regional Bank", sector: "Financial Services", industry: "Banks - Regional" } as unknown as StockFundamentals,
    ],
  }),
}));
vi.mock("@/lib/yahoo", () => ({
  getQuotes: vi.fn().mockResolvedValue([]),
  getHistory: vi.fn().mockResolvedValue([]),
}));
const fetchMarketNewsMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/news", () => ({ fetchMarketNews: (...args: unknown[]) => fetchMarketNewsMock(...args) }));
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
  shortlistUniverse,
  normalizeTheme,
  themeCacheKey,
  MAX_THEME_LENGTH,
} = await import("@/lib/thematic-engine");

const fund = (symbol: string, industry: string, sector = "Industrials") =>
  ({ symbol, name: `${symbol} Inc`, sector, industry } as unknown as StockFundamentals);

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
  // Order matters: the company-mapping prompt also mentions "dependency chain",
  // so its own marker has to be tested first.
  if (prompt.includes("belong to which tier")) return companyMappingJson();
  if (prompt.includes("inevitability")) return futureStateJson();
  if (prompt.includes("map the full dependency chain") || prompt.includes("DEPENDENCY CHAIN HAS")) return chainJson();
  if (prompt.includes("Map the full dependency chain")) return chainJson();
  if (prompt.includes("bottleneck in the")) return bottleneckJson();
  if (prompt.includes("supply-demand balance")) return supplyDemandJson();
  if (prompt.includes("commodity intensity")) return commodityJson();
  if (prompt.includes("government policy support")) return policyJson();
  if (prompt.includes("structural advantages across")) return structuralJson();
  throw new Error(`unrecognised prompt in test: ${prompt.slice(0, 60)}`);
}

describe("pickCommodityProxies", () => {
  it("matches theme keywords and caps at 4", () => {
    const result = pickCommodityProxies("AI Compute Semiconductor Energy");
    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.some((p) => p.ticker === "SMH")).toBe(true);
  });

  it("returns nothing rather than an irrelevant default when no keyword matches", () => {
    // The old default handed back Gold + Crude Oil for ANY unmatched theme and
    // fed those series to the supply/demand model as evidence.
    expect(pickCommodityProxies("Something Totally Unrelated To Any Keyword")).toEqual([]);
  });

  it("matches keywords on word boundaries, not substrings", () => {
    // "Supply Chain" contains the letters "ai" (ch-AI-n), which used to pull in
    // the AI theme's semiconductor proxies.
    const tickers = pickCommodityProxies("Global Supply Chain Resilience").map((p) => p.ticker);
    expect(tickers).not.toContain("SMH");
    expect(tickers).not.toContain("NVDA");
    // ...while a genuine AI theme still resolves.
    expect(pickCommodityProxies("AI Compute").map((p) => p.ticker)).toContain("SMH");
  });

  it("resolves aliases to the same proxies as the canonical keyword", () => {
    expect(pickCommodityProxies("Small Modular Reactor rollout").map((p) => p.ticker)).toContain("URA");
    expect(pickCommodityProxies("Electric Vehicles").map((p) => p.ticker)).toContain("CPER");
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

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });

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

  it("defaults an omitted array field on a valid-but-incomplete stage response, without recording a stage failure", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("bottleneck in the")) {
        // scarceFactors omitted despite a valid, parseable response
        return JSON.stringify({ score: 7, bottleneckTier: 3, bottleneckDescription: "d", substituteRisk: "low", substituteRationale: "r", expansionDifficulty: "e" });
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });

    expect(report.stageFailures).toEqual([]); // valid parse, not a tracked failure
    expect(report.bottleneck.score).toBe(7); // real data preserved
    expect(report.bottleneck.scarceFactors).toEqual([]); // missing field defaulted, no crash
  });

  it("treats a policy capital figure of the literal string 'null' as absent, not as text", async () => {
    // Observed live (Uranium, qwen3:14b): the prompt's quoted example taught
    // the model to answer "null" as a string, which rendered verbatim in the
    // policy table's Capital column.
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("government policy support")) {
        return JSON.stringify({
          score: 6,
          relevantPolicies: [
            { country: "Canada", policy: "Tax incentives", impact: "positive", estimatedCapitalUSD: "null" },
            { country: "US", policy: "IRA funding", impact: "positive", estimatedCapitalUSD: "N/A" },
            { country: "China", policy: "State-backed supply", impact: "positive", estimatedCapitalUSD: "$370B" },
          ],
          capitalFlowDirection: "d", geopoliticalFactors: [], indiaSpecificPolicies: [],
        });
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute" });
    expect(report.policy.relevantPolicies.map((p) => p.estimatedCapitalUSD)).toEqual([null, null, "$370B"]);
  });

  it("normalizes an invented substituteRisk variant on a valid stage response", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("bottleneck in the")) {
        return JSON.stringify({ score: 7, bottleneckTier: 3, bottleneckDescription: "d", scarceFactors: [], substituteRisk: "Very High Indeed", substituteRationale: "r", expansionDifficulty: "e" });
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute" });
    expect(report.bottleneck.substituteRisk).toBe("medium"); // invalid enum falls back to the neutral default
  });

  it("still tracks a stage failure when that stage's response is truly unparseable garbage", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("bottleneck in the")) return "the model refused to answer";
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute" });

    expect(report.stageFailures).toHaveLength(1);
    expect(report.stageFailures[0].stage).toBe("Bottleneck");
    expect(report.bottleneck.score).toBe(5); // neutral default
  });
});

describe("theme news filtering", () => {
  const news = (headline: string) => ({
    headline, source: "Test", url: `https://example.com/${headline.replaceAll(" ", "-")}`,
    publishedAt: "2026-08-01T00:00:00Z", tickers: [], summary: null,
  });

  it("keeps headlines matching a short uppercase theme token on a word boundary", async () => {
    // "AI Compute" used to filter on {"compute"} alone: the >=4 length gate
    // dropped "AI", so every AI headline was discarded and the tab claimed
    // no news coverage existed.
    fetchMarketNewsMock.mockResolvedValueOnce([
      news("AI capex hits new record"),          // matches short token "AI"
      news("Compute demand outpaces supply"),    // matches long word "compute"
      news("Senator said tariffs may rise"),     // "said" must NOT match "AI"
      news("Retail sales climb in June"),        // matches nothing
    ]);
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => routeByPrompt(prompt));

    const report = await runThematicEngine({ theme: "AI Compute" });
    expect(report.newsItems.map((n) => n.headline)).toEqual([
      "AI capex hits new record",
      "Compute demand outpaces supply",
    ]);
  });
});

describe("isRenderableReport", () => {
  it("accepts a report the engine just produced", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => routeByPrompt(prompt));
    const { isRenderableReport } = await import("@/lib/thematic-theme");
    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(isRenderableReport(report)).toBe(true);
  });

  it("rejects the old shapes both storage tiers can still hold", async () => {
    const { isRenderableReport } = await import("@/lib/thematic-theme");
    expect(isRenderableReport(null)).toBe(false);
    expect(isRenderableReport("{}")).toBe(false);
    // Pre-integrity era (the shape that crashed the page once already).
    expect(isRenderableReport({ theme: "Uranium", opportunity: { themeScore: 56 } })).toBe(false);
    // Pre-newsItems era: everything else present, one iterated array missing.
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => routeByPrompt(prompt));
    const report = await runThematicEngine({ theme: "AI Compute" });
    const older: Record<string, unknown> = { ...report };
    delete older.newsItems;
    expect(isRenderableReport(older)).toBe(false);
  });
});

describe("normalizeTheme", () => {
  it("collapses whitespace, strips control characters, and bounds length", () => {
    expect(normalizeTheme("  AI   Compute \n ")).toBe("AI Compute");
    expect(normalizeTheme("AI\u0000\u001fCompute")).toBe("AI Compute");
    expect(normalizeTheme("x".repeat(500))).toHaveLength(MAX_THEME_LENGTH);
  });

  it("gives casing and spacing variants one cache identity", () => {
    expect(themeCacheKey("  Nuclear   ENERGY ")).toBe(themeCacheKey("nuclear energy"));
  });
});

describe("shortlistUniverse", () => {
  const universe = [
    fund("CCJ", "Uranium", "Energy"),
    fund("NUE", "Steel", "Basic Materials"),
    fund("JPM", "Banks - Diversified", "Financial Services"),
    fund("NVDA", "Semiconductors", "Technology"),
    fund("AMAT", "Semiconductor Equipment & Materials", "Technology"),
  ];

  it("reaches the theme's companies wherever they sit in the row order", () => {
    // The old slice(0, 300) took an arbitrary, unordered window of ~1,960 rows,
    // so a Uranium run could return zero companies with CCJ sitting in the DB.
    const symbols = shortlistUniverse("Uranium", universe).companies.map((c) => c.symbol);
    expect(symbols[0]).toBe("CCJ");
  });

  it("keeps a hint's whole industry family, not just an exact string match", () => {
    const symbols = shortlistUniverse("Semiconductors", universe).companies.map((c) => c.symbol);
    expect(symbols).toContain("NVDA");
    expect(symbols).toContain("AMAT");
  });

  it("excludes companies with no plausible link rather than padding the list", () => {
    expect(shortlistUniverse("Uranium", universe).companies.map((c) => c.symbol)).not.toContain("JPM");
  });

  it("is stable across runs for the same theme", () => {
    const once = shortlistUniverse("Nuclear Energy", universe).companies.map((c) => c.symbol);
    const twice = shortlistUniverse("Nuclear Energy", [...universe].reverse()).companies.map((c) => c.symbol);
    expect(once).toEqual(twice);
  });

  it("flags a free-text theme that matches no lexicon industry", () => {
    expect(shortlistUniverse("Shrinkflation", universe).usedTextFallback).toBe(true);
    expect(shortlistUniverse("Uranium", universe).usedTextFallback).toBe(false);
  });

  it("cuts an over-cap universe by quality, not by alphabet", () => {
    // 200 same-industry rows: the first 150 alphabetically (AA00..) carry weak
    // fundamentals, the last 50 (ZZ00..) carry strong ones. The old symbol-only
    // tie-break kept the alphabet's first 140 and cut every ZZ name — observed
    // live as TSM being excluded from "AI Compute" while Corsair survived.
    const weak = Array.from({ length: 150 }, (_, i) => ({
      symbol: `AA${String(i).padStart(3, "0")}`,
      name: `Weak ${i}`,
      sector: "Technology",
      industry: "Semiconductors",
      roic: 2, roe: 3, grossMargin: 20, operatingMargin: 4, fcfMargin: 1,
      revenueGrowthYoY: -5, debtToEquity: 3,
    })) as unknown as StockFundamentals[];
    const strong = Array.from({ length: 50 }, (_, i) => ({
      symbol: `ZZ${String(i).padStart(3, "0")}`,
      name: `Strong ${i}`,
      sector: "Technology",
      industry: "Semiconductors",
      roic: 28, roe: 30, grossMargin: 60, operatingMargin: 32, fcfMargin: 25,
      revenueGrowthYoY: 25, debtToEquity: 0.2,
    })) as unknown as StockFundamentals[];

    const symbols = shortlistUniverse("Semiconductors", [...weak, ...strong]).companies.map((c) => c.symbol);
    expect(symbols.length).toBe(140);
    // Every strong name survives the cap; the cut lands on the weakest names.
    expect(symbols.filter((s) => s.startsWith("ZZ"))).toHaveLength(50);
  });

  it("ranks a first-listed industry above a later-listed one for the same theme", () => {
    // The "ai" entry lists "semiconductor" before "information technology
    // services": a semis row must outrank an IT-services row on relevance.
    const rows = [
      fund("ITSV", "Information Technology Services", "Technology"),
      fund("SEMI", "Semiconductors", "Technology"),
    ];
    const symbols = shortlistUniverse("AI", rows).companies.map((c) => c.symbol);
    expect(symbols[0]).toBe("SEMI");
  });
});

describe("score clamping", () => {
  it("rescales a 0-100 answer to the 0-10 scale it asked for", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("inevitability")) {
        // A 3B model answering on the wrong scale used to render "85/10", draw
        // an 850%-wide bar, and push the weighted score past 100.
        return JSON.stringify({ inevitabilityScore: 85, timeHorizon: "5y", drivingForces: [], rationale: "" });
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(report.futureState.inevitabilityScore).toBe(8.5);
    expect(report.opportunity.themeScore).toBeLessThanOrEqual(100);
  });

  it("hard-clamps a nonsense score and an out-of-range tier", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("bottleneck in the")) {
        return JSON.stringify({ score: 9999, bottleneckTier: 42, bottleneckDescription: "d", scarceFactors: [], substituteRisk: "low", substituteRationale: "", expansionDifficulty: "" });
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(report.bottleneck.score).toBe(10);
    expect(report.bottleneck.bottleneckTier).toBe(4); // the neutral default tier
  });
});

describe("stage retry", () => {
  it("retries an empty dependency chain once with the terse prompt and uses the result", async () => {
    runPromptMock.mockReset();
    let chainCalls = 0;
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("belong to which tier")) return companyMappingJson();
      if (prompt.includes("dependency chain") || prompt.includes("6-tier dependency chain")) {
        chainCalls += 1;
        return chainCalls === 1 ? "[]" : chainJson(); // first attempt empty, retry succeeds
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(chainCalls).toBe(2);
    expect(report.dependencyChain).toHaveLength(6);
    expect(report.stageFailures.map((f) => f.stage)).not.toContain("Dependency Chain");
    // The timing entry says the stage needed the second chance.
    expect(report.stageTimings.find((t) => t.stage === "Dependency Chain")?.retried).toBe(true);
  });

  it("records the failure when the retry also returns nothing", async () => {
    runPromptMock.mockReset();
    let chainCalls = 0;
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("belong to which tier")) return companyMappingJson();
      if (prompt.includes("dependency chain") || prompt.includes("6-tier dependency chain")) {
        chainCalls += 1;
        return "[]";
      }
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(chainCalls).toBe(2); // exactly one retry, never more
    expect(report.dependencyChain).toEqual([]);
    expect(report.stageFailures.map((f) => f.stage)).toContain("Dependency Chain");
  });
});

describe("silent-failure tracking", () => {
  it("does not claim a score impact when only a weightless stage failed", async () => {
    // Observed live: a chain-only failure shipped evidenceScore 100 beside a
    // risk flag saying "the headline score partly reflects an assumption".
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("belong to which tier")) return companyMappingJson();
      if (prompt.includes("dependency chain")) return "[]";
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    const flag = report.opportunity.riskFlags.find((f) => f.label.includes("unevidenced"));
    expect(flag).toBeDefined();
    expect(flag!.detail).toContain("headline score is unaffected");
    expect(flag!.detail).not.toContain("assumption");
    expect(report.integrity.evidenceScore).toBe(100);
  });

  it("still names the score impact when a weighted stage failed", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("inevitability")) throw new Error("timeout");
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    const flag = report.opportunity.riskFlags.find((f) => f.label.includes("unevidenced"));
    expect(flag!.detail).toContain("partly reflects an assumption");
  });

  it("records an empty dependency chain as a failure instead of shipping a blank tab as success", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("belong to which tier")) return companyMappingJson();
      // Valid, parseable JSON that contains no usable tiers — exactly what a
      // small local model produces, and previously recorded as a success.
      if (prompt.includes("dependency chain")) return "[]";
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(report.dependencyChain).toEqual([]);
    expect(report.stageFailures.map((f) => f.stage)).toContain("Dependency Chain");
    expect(report.integrity.caveats.length).toBeGreaterThan(0);
  });

  it("records a company mapping that matched nothing, and still labels tiers", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("belong to which tier")) return "[]";
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    expect(report.tierCompanies).toEqual([]);
    expect(report.stageFailures.map((f) => f.stage)).toContain("Company Mapping");
    // A stage carrying no score weight must still lower the headline stage count —
    // otherwise the badge read "100% evidenced" above two empty tabs.
    expect(report.integrity.stagesEvidenced).toBeLessThan(report.integrity.stagesTotal);
  });

  it("reports evidence coverage as the score weight that came from a real answer", async () => {
    runPromptMock.mockReset();
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      if (prompt.includes("inevitability")) throw new Error("timeout");
      return routeByPrompt(prompt);
    });

    const report = await runThematicEngine({ theme: "AI Compute Semiconductors" });
    // Inevitability carries 20% of the weight.
    expect(report.integrity.evidenceScore).toBe(80);
    expect(report.integrity.stagesEvidenced).toBe(7);
    expect(report.integrity.stagesTotal).toBe(8);
    expect(report.opportunity.factors.find((f) => f.key === "inevitability")?.evidenced).toBe(false);
  });
});

describe("verdict reconciliation", () => {
  const base = {
    futureState: { inevitabilityScore: 10, timeHorizon: "x", drivingForces: [], rationale: "" },
    bottleneck: { score: 10, bottleneckTier: 1 as const, bottleneckDescription: "", scarceFactors: [], substituteRisk: "low" as const, substituteRationale: "", expansionDifficulty: "" },
    commodity: { score: 10, primaryCommodities: [], demandCatalysts: [], supplyRisks: [], substitutionRisk: "low" as const, recyclingEconomics: "", reserveConcentration: "" },
    policy: { score: 10, relevantPolicies: [], capitalFlowDirection: "", geopoliticalFactors: [], indiaSpecificPolicies: [] },
    structural: { score: 10, currentLeader: "US", fastestImproving: "India", regions: [], longTermImplications: "" },
  };

  it("caps the verdict one notch when the capital cycle says avoid", () => {
    // Shipping "EXCEPTIONAL" next to "Entry signal: avoid" is the contradiction
    // that costs a research tool its credibility.
    const supplyDemand = { score: 10, demandTrajectory: "accelerating" as const, supplyTrajectory: "constrained" as const, capitalCyclePhase: "late" as const, commodityProxies: [], demandDrivers: [], supplyConstraints: [], investmentSignal: "avoid" as const };
    const result = computeOpportunityScore(base.futureState, base.bottleneck, supplyDemand, base.commodity, base.policy, base.structural, []);
    expect(result.themeScore).toBe(100);
    expect(result.verdict).toBe("strong");
    expect(result.verdictCaveat).toContain("timing");
  });

  it("leaves the verdict alone when the cycle agrees", () => {
    const supplyDemand = { score: 10, demandTrajectory: "accelerating" as const, supplyTrajectory: "constrained" as const, capitalCyclePhase: "early" as const, commodityProxies: [], demandDrivers: [], supplyConstraints: [], investmentSignal: "strong" as const };
    const result = computeOpportunityScore(base.futureState, base.bottleneck, supplyDemand, base.commodity, base.policy, base.structural, []);
    expect(result.verdict).toBe("exceptional");
    expect(result.verdictCaveat).toBeNull();
  });

  it("names the risks that qualify a high score", () => {
    const supplyDemand = { score: 8, demandTrajectory: "stable" as const, supplyTrajectory: "oversupplied" as const, capitalCyclePhase: "downturn" as const, commodityProxies: [], demandDrivers: [], supplyConstraints: [], investmentSignal: "weak" as const };
    const flags = computeOpportunityScore(base.futureState, base.bottleneck, supplyDemand, base.commodity, base.policy, base.structural, []).riskFlags;
    expect(flags.map((f) => f.label)).toContain("Late capital cycle");
    expect(flags[0].severity).toBe("high"); // highest severity sorts first
  });
});
