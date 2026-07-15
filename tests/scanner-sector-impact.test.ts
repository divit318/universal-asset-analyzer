import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

const { analyzeSectorImpacts } = await import("@/lib/scanner/sector-impact");

function event(id: string): MarketEvent {
  return { id, category: "macro", headline: `H ${id}`, summary: "s", publishedAt: new Date().toISOString(), sources: [], affectedTickers: [], affectedSectors: ["Banking"], affectedThemes: [], causalChain: [] };
}

describe("analyzeSectorImpacts", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("returns [] for empty input without calling the AI", async () => {
    const result = await analyzeSectorImpacts([], []);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("attaches driving event ids from affectedSectors cross-reference", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      sectorImpacts: [{ sector: "Banking", direction: "bearish", strength: 65, rationale: "r", keyBeneficiaries: [], keyLosers: [] }],
    }));

    const result = await analyzeSectorImpacts([event("e1")], []);
    expect(result[0].drivingEvents).toEqual(["e1"]);
  });

  it("defaults omitted array fields on a valid-but-incomplete impact instead of crashing", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      sectorImpacts: [{ sector: "Banking", direction: "bearish", rationale: "r" }], // missing strength, keyBeneficiaries, keyLosers
    }));

    const result = await analyzeSectorImpacts([event("e1")], []);
    expect(result[0].strength).toBe(0);
    expect(result[0].keyBeneficiaries).toEqual([]);
    expect(result[0].keyLosers).toEqual([]);
  });

  it("normalizes an invented direction variant instead of propagating it as-is", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      sectorImpacts: [{ sector: "Banking", direction: "Very Bearish", rationale: "r" }],
    }));

    const result = await analyzeSectorImpacts([event("e1")], []);
    expect(result[0].direction).toBe("neutral");
  });

  it("returns [] when the AI response is unparseable garbage", async () => {
    runPromptMock.mockResolvedValue("not json at all");
    const result = await analyzeSectorImpacts([event("e1")], []);
    expect(result).toEqual([]);
  });
});
