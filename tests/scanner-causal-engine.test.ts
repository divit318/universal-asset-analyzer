import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

const { buildCausalChains } = await import("@/lib/scanner/causal-engine");

function event(id: string, category: MarketEvent["category"] = "macro"): MarketEvent {
  return {
    id,
    category,
    headline: `Headline ${id}`,
    summary: `Summary ${id}`,
    publishedAt: new Date().toISOString(),
    sources: [],
    affectedTickers: [],
    affectedSectors: [],
    affectedThemes: [],
    causalChain: [],
  };
}

function effectsJson(n: number) {
  return JSON.stringify({
    effects: [{ order: 1, description: `effect for ${n}`, direction: "bullish", affectedSectors: [], affectedTickers: [] }],
  });
}

describe("buildCausalChains", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("attaches each event's own causal chain, not a neighbor's, across more than one batch's worth of events", async () => {
    // 6 macro events — more than the old MAX_CONCURRENT=4 batch size, so this
    // spans what used to be two separate batches under the old code.
    const events = Array.from({ length: 6 }, (_, i) => event(`m${i}`));

    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      const match = /Headline (m\d)/.exec(prompt);
      return effectsJson(Number(match![1].slice(1)));
    });

    const result = await buildCausalChains(events);

    expect(result).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(result[i].id).toBe(`m${i}`);
      expect(result[i].causalChain[0].description).toBe(`effect for ${i}`);
    }
  });

  it("falls back to an empty causal chain for a failed event without corrupting its neighbors, across batch boundaries", async () => {
    const events = Array.from({ length: 6 }, (_, i) => event(`m${i}`));

    runPromptMock.mockImplementation(async (_task: string, prompt: string) => {
      const match = /Headline (m\d)/.exec(prompt);
      const idx = Number(match![1].slice(1));
      // Fail the 5th event (index 4) — this is what used to compute an
      // out-of-bounds index under the old i + enriched.length formula.
      if (idx === 4) throw new Error("Ollama request timed out");
      return effectsJson(idx);
    });

    const result = await buildCausalChains(events);

    expect(result).toHaveLength(6);
    // The failed event keeps its own identity and an empty chain — not a
    // neighbor's data and not undefined.
    expect(result[4].id).toBe("m4");
    expect(result[4].causalChain).toEqual([]);
    // Its neighbors are unaffected.
    expect(result[3].id).toBe("m3");
    expect(result[3].causalChain[0].description).toBe("effect for 3");
    expect(result[5].id).toBe("m5");
    expect(result[5].causalChain[0].description).toBe("effect for 5");
  });

  it("leaves non-macro events untouched and preserves overall order", async () => {
    const events = [event("c1", "company"), event("m1", "macro"), event("c2", "company")];
    runPromptMock.mockResolvedValue(effectsJson(1));

    const result = await buildCausalChains(events);

    expect(result.map((e) => e.id)).toEqual(["c1", "m1", "c2"]);
    expect(result[0].causalChain).toEqual([]); // company event untouched
    expect(result[2].causalChain).toEqual([]);
  });

  it("returns events unchanged when there are no macro/policy/geopolitics events", async () => {
    const events = [event("c1", "company")];
    const result = await buildCausalChains(events);
    expect(result).toEqual(events);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("defaults omitted fields on a valid-but-incomplete effect instead of crashing", async () => {
    const events = [event("m1")];
    runPromptMock.mockResolvedValue(JSON.stringify({
      effects: [{ order: 1, description: "rates fall" }], // missing direction/affectedSectors/affectedTickers
    }));

    const result = await buildCausalChains(events);

    expect(result[0].causalChain).toHaveLength(1);
    expect(result[0].causalChain[0].direction).toBe("neutral");
    expect(result[0].causalChain[0].affectedSectors).toEqual([]);
    expect(result[0].causalChain[0].affectedTickers).toEqual([]);
  });

  it("normalizes an invented direction variant instead of propagating it as-is", async () => {
    const events = [event("m1")];
    runPromptMock.mockResolvedValue(JSON.stringify({
      effects: [{ order: 1, description: "d", direction: "Very Bullish" }],
    }));

    const result = await buildCausalChains(events);
    expect(result[0].causalChain[0].direction).toBe("neutral");
  });

  it("falls back to an empty causal chain when the AI returns unparseable garbage", async () => {
    const events = [event("m1")];
    runPromptMock.mockResolvedValue("not json at all");

    const result = await buildCausalChains(events);
    expect(result[0].causalChain).toEqual([]);
  });
});
