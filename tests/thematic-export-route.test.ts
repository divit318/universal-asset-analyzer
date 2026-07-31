import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/export/thematic/route";

/** The smallest report shape isRenderableReport accepts. */
function validReport() {
  return {
    theme: "Uranium",
    generatedAt: new Date().toISOString(),
    model: "test-model",
    futureState: { inevitabilityScore: 7, timeHorizon: "5y", drivingForces: [], rationale: "" },
    dependencyChain: [],
    bottleneck: { score: 6, bottleneckTier: 4, bottleneckDescription: "", scarceFactors: [], substituteRisk: "low", substituteRationale: "", expansionDifficulty: "" },
    supplyDemand: { score: 6, demandTrajectory: "growing", supplyTrajectory: "tight", capitalCyclePhase: "early", commodityProxies: [], demandDrivers: [], supplyConstraints: [], investmentSignal: "moderate" },
    commodityFramework: { score: 5, primaryCommodities: [], demandCatalysts: [], supplyRisks: [], substitutionRisk: "medium", recyclingEconomics: "", reserveConcentration: "" },
    policy: { score: 5, relevantPolicies: [], capitalFlowDirection: "", geopoliticalFactors: [], indiaSpecificPolicies: [] },
    structuralAdvantage: { score: 5, currentLeader: "US", fastestImproving: "India", regions: [], longTermImplications: "" },
    tierCompanies: [
      {
        tier: 4, tierLabel: "Raw materials", symbol: "CCJ", name: "Cameco", sector: "Energy", industry: "Uranium",
        roic: 8, grossMargin: 30, revenueGrowthYoY: 12, debtToEquity: 0.3, forwardPE: 40.2, evToEbitda: 20.1,
        distanceFrom52WkHigh: -12.5, isIndia: false, relevanceRationale: "Largest western producer",
        qualityScore: 61, strategicImportance: "critical", moatType: "scale",
      },
    ],
    opportunity: {
      themeScore: 62, verdict: "strong", verdictRationale: "r", verdictCaveat: null,
      themeBreakdown: { inevitability: 70, bottleneck: 60, capitalCycle: 60, commodityIntensity: 50, policy: 50, substitutionResistance: 70, structuralAdvantage: 50 },
      factors: [], topCompanies: [], riskFlags: [], analystChecklist: [],
    },
    newsItems: [],
    stageFailures: [],
    integrity: { evidenceScore: 100, stagesEvidenced: 8, stagesTotal: 8, missingStages: [], universeShortlisted: 6, universeTotal: 2000, caveats: [] },
    universePreview: {
      matched: 6, shortlisted: 6, shownToModel: 6, cutTotal: 0,
      candidates: [{ symbol: "CCJ", name: "Cameco", industry: "Uranium", score: 10, matched: ["uranium"], status: "prompt" }],
    },
    proxyPerformance: null,
  };
}

describe("POST /api/export/thematic", () => {
  it("returns an XLSX attachment for a current-shape report", async () => {
    const res = await POST(
      new Request("http://localhost/api/export/thematic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: validReport() }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toContain("thematic-uranium-");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000); // a real workbook, not an empty shell
  });

  it("rejects an old-shape or missing report with a 400, never a crash", async () => {
    const res = await POST(
      new Request("http://localhost/api/export/thematic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: { theme: "Uranium" } }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
