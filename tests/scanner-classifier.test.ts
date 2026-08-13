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

const { classifyEvents } = await import("@/lib/scanner/classifier");

function event(id: string): MarketEvent {
  return { id, category: "company", headline: `H ${id}`, summary: "s", publishedAt: new Date().toISOString(), sources: [], affectedTickers: [], affectedSectors: [], affectedThemes: [], causalChain: [] };
}

describe("classifyEvents", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("returns events unmodified for empty input without calling the AI", async () => {
    const result = await classifyEvents([]);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("applies classification when the AI response is well-formed", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      classifications: [{ id: "e1", category: "macro", affectedSectors: ["Banking"], affectedThemes: ["Rate Cycle"], affectedTickers: ["HDFCBANK"] }],
    }));

    const result = await classifyEvents([event("e1")]);
    expect(result[0].category).toBe("macro");
    expect(result[0].affectedSectors).toEqual(["Banking"]);
  });

  it("defaults omitted array fields on a valid-but-incomplete classification instead of crashing", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      classifications: [{ id: "e1", category: "macro" }], // missing affectedSectors/Themes/Tickers
    }));

    const result = await classifyEvents([event("e1")]);
    expect(result[0].affectedSectors).toEqual([]);
    expect(result[0].affectedThemes).toEqual([]);
  });

  it("normalizes an invented category variant instead of propagating it as-is", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      classifications: [{ id: "e1", category: "MACRO-ish" }],
    }));

    const result = await classifyEvents([event("e1")]);
    expect(result[0].category).toBe("company");
  });

  it("returns events unmodified when the AI response is unparseable garbage", async () => {
    runPromptMock.mockResolvedValue("not json at all");

    const result = await classifyEvents([event("e1")]);
    expect(result[0].category).toBe("company"); // original, untouched
  });

  it("returns events unmodified when the AI call throws", async () => {
    runPromptMock.mockRejectedValue(new Error("AI request timed out"));

    const result = await classifyEvents([event("e1")]);
    expect(result[0].category).toBe("company");
  });
});
