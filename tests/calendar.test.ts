import { describe, it, expect, vi, beforeEach } from "vitest";

const listWatchlistMock = vi.fn();
const listPortfolioMock = vi.fn();
vi.mock("@/lib/db", () => ({
  listWatchlist: () => listWatchlistMock(),
  listPortfolio: () => listPortfolioMock(),
}));

const getQuoteSummaryMock = vi.fn();
vi.mock("@/lib/yahoo", () => ({ getQuoteSummary: (...args: unknown[]) => getQuoteSummaryMock(...args) }));

const { GET } = await import("@/app/api/calendar/route");

describe("GET /api/calendar", () => {
  beforeEach(() => {
    listWatchlistMock.mockReset().mockReturnValue([]);
    listPortfolioMock.mockReset().mockReturnValue([]);
    getQuoteSummaryMock.mockReset();
  });

  it("never returns a fabricated forecast or previous value on any macro event", async () => {
    const res = await GET();
    const json = await res.json();
    const macroEvents = json.events.filter((e: { type: string }) => e.type === "macro");

    expect(macroEvents.length).toBeGreaterThan(0); // sanity: the schedule isn't empty
    for (const e of macroEvents) {
      expect(e.forecast).toBeUndefined();
      expect(e.previous).toBeUndefined();
    }
  });

  it("only includes macro events within the display window (7 days back, 180 days forward)", async () => {
    const res = await GET();
    const json = await res.json();
    const macroEvents = json.events.filter((e: { type: string }) => e.type === "macro");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const future = new Date();
    future.setDate(future.getDate() + 180);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const futureStr = future.toISOString().slice(0, 10);

    for (const e of macroEvents) {
      expect(e.date >= cutoffStr).toBe(true);
      expect(e.date <= futureStr).toBe(true);
    }
  });

  it("returns empty events plus symbol lists when watchlist/portfolio are empty, without calling Yahoo", async () => {
    const res = await GET();
    const json = await res.json();

    expect(json.portfolioSymbols).toEqual([]);
    expect(json.watchlistSymbols).toEqual([]);
    expect(json.unavailableSymbols).toEqual([]);
    expect(getQuoteSummaryMock).not.toHaveBeenCalled();
  });

  it("builds an earnings event from real Yahoo calendar data for a watchlist symbol", async () => {
    listWatchlistMock.mockReturnValue([{ symbol: "AAPL", name: "Apple Inc." }]);
    const earningsDate = new Date();
    earningsDate.setDate(earningsDate.getDate() + 10);
    getQuoteSummaryMock.mockResolvedValue({
      price: { longName: "Apple Inc." },
      calendarEvents: { earnings: { earningsDate: [earningsDate], isEarningsDateEstimate: true } },
      earningsTrend: { trend: [{ period: "0q", endDate: earningsDate, earningsEstimate: { avg: 1.5 }, revenueEstimate: { avg: 9e10 } }] },
      summaryDetail: {},
    });

    const res = await GET();
    const json = await res.json();

    const earningsEvent = json.events.find((e: { type: string }) => e.type === "earnings");
    expect(earningsEvent).toBeDefined();
    expect(earningsEvent.symbol).toBe("AAPL");
    expect(earningsEvent.epsEstimate).toBe(1.5);
  });

  it("degrades one symbol's failure to a tracked, logged unavailable entry — doesn't drop the whole response", async () => {
    listWatchlistMock.mockReturnValue([
      { symbol: "GOOD", name: "Good Corp" },
      { symbol: "BAD", name: "Bad Corp" },
    ]);
    getQuoteSummaryMock.mockImplementation(async (sym: string) => {
      if (sym === "BAD") throw new Error("Yahoo request failed");
      return { price: { longName: "Good Corp" }, calendarEvents: {}, earningsTrend: {}, summaryDetail: {} };
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();

    expect(json.unavailableSymbols).toEqual(["BAD"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("BAD"), expect.anything());
    consoleErrorSpy.mockRestore();
  });

  it("prefers watchlist name/source over portfolio when a symbol is in both", async () => {
    listWatchlistMock.mockReturnValue([{ symbol: "DUP", name: "Watchlist Name" }]);
    listPortfolioMock.mockReturnValue([{ symbol: "DUP", name: "Portfolio Name", shares: 10, avgCost: 100 }]);
    getQuoteSummaryMock.mockResolvedValue({ price: {}, calendarEvents: {}, earningsTrend: {}, summaryDetail: {} });

    const res = await GET();
    const json = await res.json();

    expect(json.watchlistSymbols).toEqual(["DUP"]);
    expect(json.portfolioSymbols).toEqual(["DUP"]);
  });
});
