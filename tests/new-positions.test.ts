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

/**
 * Shaped as `UniversalPortfolioReport` (lib/portfolio/report.ts).
 *
 * This fixture used to use the pre-Universal-Portfolio field names
 * (`positions`, `positionCount`, `sectorAllocation`, `gaps`), which no longer
 * exist. `holdingCount` being absent meant the route's `=== 0` guard passed and
 * it then crashed reading `report.holdings`, so all four cases failed for the
 * same reason: the fixture, not the route.
 */
function baseReport() {
  return {
    holdingCount: 1,
    holdings: [
      { symbol: "AAPL", weight: 100, attributes: { sector: "Technology" } },
    ],
    allocation: { bySector: { slices: [{ label: "Technology", weight: 100 }] } },
    concentration: [],
    health: { total: 70, dimensions: [] },
    totalValue: 10_000,
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
