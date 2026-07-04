import { describe, expect, it } from "vitest";
import { extractCitations } from "@/lib/ai/memory";
import { getAction, suggestFollowUps } from "@/lib/ai/actions";
import type { CompanyContext } from "@/lib/ai/types";

const ctx = {
  symbol: "AAPL",
  filings: [
    { form: "10-K", filedAt: "2025-11-01", description: "Annual report", documentUrl: "https://sec.gov/aapl-10k" },
    { form: "8-K", filedAt: "2026-05-01", description: "Current report", documentUrl: "https://sec.gov/aapl-8k" },
  ],
  news: [
    { headline: "Apple ships new chip", source: "Reuters", url: "https://news/1", publishedAt: null },
    { headline: "Services revenue jumps", source: "WSJ", url: "https://news/2", publishedAt: null },
  ],
} as unknown as CompanyContext;

describe("extractCitations", () => {
  it("resolves yahoo/platform tags to labels without URLs", () => {
    const cites = extractCitations("Valuation looks rich [yahoo:valuation]; score is high [platform:score].", ctx);
    const val = cites.find((c) => c.tag === "yahoo:valuation");
    expect(val?.label).toBe("Valuation metrics");
    expect(val?.url).toBeNull();
  });

  it("links EDGAR filing tags to the matching filing URL", () => {
    const cites = extractCitations("Per the latest annual report [edgar:10-k].", ctx);
    expect(cites[0].url).toBe("https://sec.gov/aapl-10k");
  });

  it("links a numbered news tag to the right article", () => {
    const cites = extractCitations("Strong services [news:2].", ctx);
    expect(cites[0].url).toBe("https://news/2");
  });

  it("de-duplicates repeated tags in first-seen order", () => {
    const cites = extractCitations("[yahoo:price] then [yahoo:price] again", ctx);
    expect(cites).toHaveLength(1);
  });
});

describe("suggestFollowUps", () => {
  it("returns an action's curated follow-ups", () => {
    const action = getAction("bull");
    expect(suggestFollowUps([], action)).toEqual(action?.followUps);
  });
  it("derives follow-ups from intent when no action", () => {
    expect(suggestFollowUps(["valuation"], null)).toContain("What is the intrinsic value?");
  });
  it("always returns something for general intent", () => {
    expect(suggestFollowUps(["general"], null).length).toBeGreaterThan(0);
  });
});
