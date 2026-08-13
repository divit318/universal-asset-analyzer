import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent } from "@/lib/types";

const runPromptMock = vi.fn();
// Migrated to the analysis seam (tranche 8). Same reseat convention as the
// earlier tranches: runPromptMock keeps its (taskType, prompt) recording
// surface and JSON-string returns; the wrapper parses them into the seam's
// envelope, and scannerPrompt re-serializes — so stage parsing and every
// assertion on runPromptMock.mock.calls runs unchanged.
vi.mock("@/lib/ai/analysis", () => ({
  runAnalysis: async (req: { taskType: string; prompt: string }) => {
    const raw = await runPromptMock(req.taskType, req.prompt);
    return {
      data: JSON.parse(String(raw)) as unknown,
      provider: "ollama" as const,
      meta: { durationMs: 1 },
    };
  },
}));
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

const { runScannerPipeline, sanitizeTheme, sanitizeRiskAlert } = await import("@/lib/scanner/index");

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

describe("sanitizeTheme", () => {
  it("defaults momentum and topTickers when a valid item omits them", () => {
    const theme = sanitizeTheme({ name: "AI Infra", description: "d" });
    expect(theme).toEqual({ name: "AI Infra", description: "d", momentum: 0, topTickers: [] });
  });

  it("drops items missing the required name/description fields", () => {
    expect(sanitizeTheme({ momentum: 80 })).toBeNull();
  });

  it("filters out non-string entries from topTickers instead of crashing", () => {
    const theme = sanitizeTheme({ name: "n", description: "d", topTickers: ["AAPL", 123, null] });
    expect(theme?.topTickers).toEqual(["AAPL"]);
  });
});

describe("sanitizeRiskAlert", () => {
  it("defaults severity and array fields when a valid item omits them", () => {
    const alert = sanitizeRiskAlert({ headline: "Rate shock", rationale: "r" });
    expect(alert).toEqual({ headline: "Rate shock", severity: "medium", affectedSectors: [], affectedTickers: [], rationale: "r" });
  });

  it("drops items missing the required headline/rationale fields", () => {
    expect(sanitizeRiskAlert({ severity: "high" })).toBeNull();
  });

  it("normalizes an invented severity variant to a valid enum value", () => {
    const alert = sanitizeRiskAlert({ headline: "h", rationale: "r", severity: "CRITICAL" });
    expect(alert?.severity).toBe("medium");
  });
});
