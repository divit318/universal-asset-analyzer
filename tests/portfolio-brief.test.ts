import { describe, it, expect, vi, beforeEach } from "vitest";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));
vi.mock("@/lib/db", () => ({
  listPortfolio: vi.fn().mockReturnValue([{ symbol: "AAPL", name: "Apple", shares: 10, avgCost: 150 }]),
}));
vi.mock("@/lib/yahoo", () => ({ getQuotes: vi.fn().mockResolvedValue([{ symbol: "AAPL", price: 180, changePercent: 1.2 }]) }));
vi.mock("@/lib/ai-portfolio-manager", () => ({
  gatherPortfolioManagerEvidence: vi.fn().mockResolvedValue({}),
  buildBriefEvidenceSuffix: vi.fn().mockReturnValue(""),
}));

const { GET } = await import("@/app/api/ai/portfolio-brief/route");

function makeRequest(): Request {
  return new Request("http://localhost/api/ai/portfolio-brief");
}

describe("GET /api/ai/portfolio-brief", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("defaults omitted fields on a valid-but-incomplete AI response instead of crashing", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ headline: "Portfolio up 2% today" }));

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.headline).toBe("Portfolio up 2% today");
    expect(json.actionItems).toEqual([]);
    expect(json.narrative).toBe("");
  });

  it("falls back to [] when actionItems arrives as the wrong kind", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ headline: "h", actionItems: "not an array" }));

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(Array.isArray(json.actionItems)).toBe(true);
    expect(json.actionItems).toEqual([]);
  });

  it("shows the provider-offline fallback when runPrompt throws", async () => {
    runPromptMock.mockRejectedValue(new Error("no AI provider available"));

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.headline).toBe("Portfolio summary — connect an AI provider for intelligence");
    expect(json.actionItems).toEqual([]);
  });
});
