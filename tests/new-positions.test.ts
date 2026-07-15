import { describe, it, expect, vi, beforeEach } from "vitest";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));
vi.mock("@/lib/db", () => ({ listWatchlist: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/ai-watchlist", () => ({ gatherWatchlistAlerts: vi.fn().mockResolvedValue([]) }));

const { POST } = await import("@/app/api/portfolio/new-positions/route");

function makeRequest(body: unknown = {}): Request {
  return new Request("http://localhost/api/portfolio/new-positions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubReportFetch(report: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200 })));
}

function baseReport() {
  return {
    positions: [{ symbol: "AAPL", sector: "Technology", weight: 100 }],
    sectorAllocation: [{ sector: "Technology", weight: 100 }],
    gaps: { missing: [], overweight: [] },
    health: { total: 70, dimensions: [] },
    totalValue: 10_000,
    positionCount: 1,
  };
}

describe("POST /api/portfolio/new-positions", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
  });

  it("defaults omitted breakdown/expectedImpact fields on a valid-but-incomplete AI response", async () => {
    stubReportFetch(baseReport());
    runPromptMock.mockResolvedValue(JSON.stringify([
      { symbol: "MSFT", name: "Microsoft", sector: "Technology", reason: "diversifies cloud exposure" },
    ]));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.recommendations[0].symbol).toBe("MSFT");
    expect(json.recommendations[0].supportingFactors).toEqual([]);
    expect(json.recommendations[0].expectedImpact.diversification).toBe("neutral");
    expect(json.recommendations[0].breakdown.portfolioFitScore).toBe(65);
  });

  it("drops a recommendation missing symbol/name/reason instead of crashing", async () => {
    stubReportFetch(baseReport());
    runPromptMock.mockResolvedValue(JSON.stringify([
      { sector: "Technology" }, // missing symbol/name/reason
      { symbol: "MSFT", name: "Microsoft", sector: "Technology", reason: "r" },
    ]));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(json.recommendations).toHaveLength(1);
    expect(json.recommendations[0].symbol).toBe("MSFT");
  });

  it("normalizes an invented expectedImpact variant to a valid enum value", async () => {
    stubReportFetch(baseReport());
    runPromptMock.mockResolvedValue(JSON.stringify([
      { symbol: "MSFT", name: "Microsoft", sector: "Technology", reason: "r", expectedImpact: { diversification: "greatly improves" } },
    ]));

    const res = await POST(makeRequest());
    const json = await res.json();
    expect(json.recommendations[0].expectedImpact.diversification).toBe("neutral");
  });

  it("returns a 502 when the AI response is unparseable garbage", async () => {
    stubReportFetch(baseReport());
    runPromptMock.mockResolvedValue("the model refused to answer");

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
  });
});
