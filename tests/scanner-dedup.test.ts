import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewsItem } from "@/lib/types";

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

const { deduplicateIntoEvents } = await import("@/lib/scanner/dedup");

function newsItem(headline: string, source = "Yahoo"): NewsItem {
  return { headline, summary: headline, source, url: `https://example.com/${headline}`, publishedAt: new Date().toISOString(), tickers: [] };
}

describe("deduplicateIntoEvents", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("returns [] for empty input without calling the AI", async () => {
    const result = await deduplicateIntoEvents([]);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("clusters headlines per the AI response when it succeeds", async () => {
    // Same story from two outlets = two distinct articles (different URLs).
    const items = [
      newsItem("Fed cuts rates"),
      { ...newsItem("Fed cuts rates", "Reuters"), url: "https://reuters.com/fed-cuts-rates" },
      newsItem("NVIDIA earnings beat"),
    ];
    runPromptMock.mockResolvedValue(JSON.stringify({
      clusters: [
        { index: 0, clusterId: "fed-cut", category: "macro", masterHeadline: "Fed cuts rates by 25bps", summary: "s" },
        { index: 1, clusterId: "fed-cut", category: "macro", masterHeadline: "Fed cuts rates by 25bps", summary: "s" },
        { index: 2, clusterId: "nvda-earnings", category: "company", masterHeadline: "NVIDIA beats on earnings", summary: "s" },
      ],
    }));

    const result = await deduplicateIntoEvents(items);

    expect(result).toHaveLength(2); // two stories, not three raw headlines
    const fedEvent = result.find((e) => e.headline.includes("Fed"));
    expect(fedEvent?.sources).toHaveLength(2); // both sources preserved under one event
    // Evidence linking: every member article's storyId rides on the event —
    // derived from url when the feed item predates minted ids.
    expect(fedEvent?.sourceStoryIds).toHaveLength(2);
    expect(fedEvent?.sources.every((s) => typeof s.storyId === "string" && s.storyId.length > 0)).toBe(true);
    expect(new Set(fedEvent?.sourceStoryIds).size).toBe(2);
  });

  it("falls back to naive per-headline dedup when the AI call fails — doesn't throw or drop all news", async () => {
    const items = [newsItem("Story A"), newsItem("Story A"), newsItem("Story B")];
    runPromptMock.mockRejectedValue(new Error("Ollama request timed out"));

    const result = await deduplicateIntoEvents(items);

    expect(result).toHaveLength(2); // dedup by headline prefix still works
    expect(result.some((e) => e.headline === "Story A")).toBe(true);
    expect(result.some((e) => e.headline === "Story B")).toBe(true);
    // The fallback path carries evidence ids too.
    expect(result.every((e) => (e.sourceStoryIds?.length ?? 0) === 1)).toBe(true);
  });

  it("falls back gracefully when the AI returns unparseable garbage", async () => {
    const items = [newsItem("Story A")];
    runPromptMock.mockResolvedValue("not json at all");

    const result = await deduplicateIntoEvents(items);
    expect(result).toHaveLength(1);
    expect(result[0].headline).toBe("Story A");
  });

  it("drops a cluster assignment missing clusterId/masterHeadline instead of crashing", async () => {
    const items = [newsItem("Story A"), newsItem("Story B")];
    runPromptMock.mockResolvedValue(JSON.stringify({
      clusters: [
        { index: 0, category: "macro" }, // missing clusterId + masterHeadline
        { index: 1, clusterId: "story-b", category: "macro", masterHeadline: "Story B happened", summary: "s" },
      ],
    }));

    const result = await deduplicateIntoEvents(items);
    expect(result).toHaveLength(1);
    expect(result[0].headline).toBe("Story B happened");
  });

  it("normalizes an invented category variant instead of propagating it as-is", async () => {
    const items = [newsItem("Story A")];
    runPromptMock.mockResolvedValue(JSON.stringify({
      clusters: [{ index: 0, clusterId: "a", category: "SUPER-MACRO", masterHeadline: "Story A happened", summary: "s" }],
    }));

    const result = await deduplicateIntoEvents(items);
    expect(result[0].category).toBe("company");
  });
});
