import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

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
