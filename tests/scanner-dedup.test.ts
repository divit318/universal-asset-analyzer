import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewsItem } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

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
    const items = [newsItem("Fed cuts rates"), newsItem("Fed cuts rates", "Reuters"), newsItem("NVIDIA earnings beat")];
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
  });

  it("falls back to naive per-headline dedup when the AI call fails — doesn't throw or drop all news", async () => {
    const items = [newsItem("Story A"), newsItem("Story A"), newsItem("Story B")];
    runPromptMock.mockRejectedValue(new Error("Ollama request timed out"));

    const result = await deduplicateIntoEvents(items);

    expect(result).toHaveLength(2); // dedup by headline prefix still works
    expect(result.some((e) => e.headline === "Story A")).toBe(true);
    expect(result.some((e) => e.headline === "Story B")).toBe(true);
  });

  it("falls back gracefully when the AI returns unparseable garbage", async () => {
    const items = [newsItem("Story A")];
    runPromptMock.mockResolvedValue("not json at all");

    const result = await deduplicateIntoEvents(items);
    expect(result).toHaveLength(1);
    expect(result[0].headline).toBe("Story A");
  });
});
