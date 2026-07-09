import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));
vi.mock("@/lib/news", () => ({ fetchMarketNews: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/scanner/signals", () => ({
  fetchMacroSignals: vi.fn().mockResolvedValue([]),
  fetchSectorPerformance: vi.fn().mockResolvedValue([]),
  computeMarketBreadth: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/scanner/dedup", () => ({ deduplicateIntoEvents: vi.fn().mockResolvedValue([baseEvent()]) }));
vi.mock("@/lib/scanner/classifier", () => ({ classifyEvents: vi.fn().mockImplementation(async (events) => events) }));

const causalEngineMock = vi.fn();
vi.mock("@/lib/scanner/causal-engine", () => ({ buildCausalChains: (...args: unknown[]) => causalEngineMock(...args) }));

const sectorImpactMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/scanner/sector-impact", () => ({ analyzeSectorImpacts: (...args: unknown[]) => sectorImpactMock(...args) }));

vi.mock("@/lib/scanner/company-impact", () => ({ buildCompanyOpportunities: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/scanner/fundamental-gate", () => ({ applyFundamentalGate: vi.fn().mockImplementation(async (o) => o) }));
vi.mock("@/lib/scanner/opportunity-scorer", () => ({
  scoreOpportunities: vi.fn().mockImplementation((o) => o),
  segmentOpportunities: vi.fn().mockReturnValue({ all: [], highConviction: [], developing: [] }),
  refreshProfileWithThesis: vi.fn().mockImplementation((o) => o),
}));
vi.mock("@/lib/scanner/thesis-builder", () => ({ buildTheses: vi.fn().mockResolvedValue([]) }));

function baseEvent(): MarketEvent {
  return { id: "e1", category: "macro", headline: "h", summary: "s", publishedAt: new Date().toISOString(), sources: [], affectedTickers: [], affectedSectors: [], affectedThemes: [], causalChain: [] };
}

function enrichedEvent(): MarketEvent {
  return { ...baseEvent(), causalChain: [{ order: 1, description: "real causal effect", direction: "bullish", affectedSectors: [], affectedTickers: [] }] };
}

const { runScannerPipeline } = await import("@/lib/scanner/index");

describe("runScannerPipeline — stage wiring", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
    runPromptMock.mockResolvedValue(JSON.stringify({ themes: [] })); // detectEmergingThemes / extractRiskAlerts
    causalEngineMock.mockReset();
    sectorImpactMock.mockClear();
  });

  it("passes buildCausalChains' output (not the pre-enrichment events) into analyzeSectorImpacts", async () => {
    const enriched = [enrichedEvent()];
    causalEngineMock.mockResolvedValue(enriched);

    await runScannerPipeline({});

    expect(sectorImpactMock).toHaveBeenCalledTimes(1);
    const eventsArgPassed = sectorImpactMock.mock.calls[0][0];
    // Must be the causal-chain-enriched events, matching sector-impact's own
    // prompt which reads e.causalChain — not the pre-enrichment classified
    // events (which is what the old Promise.all-based wiring passed).
    expect(eventsArgPassed).toBe(enriched);
    expect(eventsArgPassed[0].causalChain).toHaveLength(1);
  });

  it("runs causal reasoning before sector impact (sequential, not concurrent)", async () => {
    const callOrder: string[] = [];
    causalEngineMock.mockImplementation(async () => {
      callOrder.push("causal");
      return [enrichedEvent()];
    });
    sectorImpactMock.mockImplementation(async () => {
      callOrder.push("sector");
      return [];
    });

    await runScannerPipeline({});

    expect(callOrder).toEqual(["causal", "sector"]);
  });
});
