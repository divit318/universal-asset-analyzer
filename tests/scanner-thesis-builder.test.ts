import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent, ScannerOpportunity, SectorImpact } from "@/lib/types";

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

const { buildTheses } = await import("@/lib/scanner/thesis-builder");

function opportunity(ticker: string): ScannerOpportunity {
  return {
    id: ticker,
    ticker,
    name: ticker,
    isIndian: false,
    direction: "bullish",
    theme: "Test Theme",
    category: "company",
    rationale: "r",
    timeframe: "medium",
    quote: null,
    compositeScores: null,
    opportunityScore: { catalystStrength: 80, fundamentalQuality: 80, valuation: 80, momentum: 80, composite: 80, verdict: "exceptional" },
    thesis: null,
    sourceEventIds: [],
    dividendYieldPct: null,
    profile: null,
  };
}

function thesisJson(headline: string) {
  return JSON.stringify({
    headline, summary: "s", bullCase: ["b1"], bearCase: ["b2"], keyCatalysts: [], keyRisks: [],
    timeHorizon: "months", confidence: 70, potentialWinners: [], potentialLosers: [],
  });
}

const events: MarketEvent[] = [];
const sectorImpacts: SectorImpact[] = [];

describe("buildTheses", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("returns [] for no opportunities without calling the AI", async () => {
    const result = await buildTheses([], events, sectorImpacts);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("attaches each opportunity's own thesis across more than one old batch-size worth of items", async () => {
    // 6 opportunities — more than the old MAX_CONCURRENT=4, spanning what
    // used to be two separate batches.
    const opps = Array.from({ length: 6 }, (_, i) => opportunity(`T${i}`));
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      const match = /COMPANY: (T\d) \(T\d\)/.exec(prompt);
      return thesisJson(`Headline for ${match![1]}`);
    });

    const result = await buildTheses(opps, events, sectorImpacts);

    expect(result).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(result[i].ticker).toBe(`T${i}`);
      expect(result[i].thesis?.headline).toBe(`Headline for T${i}`);
    }
  });

  it("leaves thesis null for a failed opportunity without corrupting its neighbors", async () => {
    const opps = Array.from({ length: 6 }, (_, i) => opportunity(`T${i}`));
    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      const match = /COMPANY: (T\d) \(T\d\)/.exec(prompt);
      const idx = Number(match![1].slice(1));
      if (idx === 4) throw new Error("AI request timed out");
      return thesisJson(`Headline for T${idx}`);
    });

    const result = await buildTheses(opps, events, sectorImpacts);

    expect(result).toHaveLength(6);
    expect(result[4].ticker).toBe("T4"); // correct identity preserved
    expect(result[4].thesis).toBeNull(); // best-effort degrade, not a crash
    expect(result[3].thesis?.headline).toBe("Headline for T3"); // neighbor unaffected
    expect(result[5].thesis?.headline).toBe("Headline for T5");
  });

  it("defaults omitted array/enum fields on a valid-but-incomplete parse", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ headline: "h", summary: "s" }));

    const result = await buildTheses([opportunity("T0")], events, sectorImpacts);

    expect(result[0].thesis?.bullCase).toEqual([]);
    expect(result[0].thesis?.keyRisks).toEqual([]);
    expect(result[0].thesis?.timeHorizon).toBe("months");
  });

  it("normalizes an invented timeHorizon variant to a valid enum value", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ headline: "h", timeHorizon: "next-decade" }));

    const result = await buildTheses([opportunity("T0")], events, sectorImpacts);
    expect(result[0].thesis?.timeHorizon).toBe("months");
  });
});
