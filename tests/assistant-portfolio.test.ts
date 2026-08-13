import { describe, expect, it } from "vitest";
import { renderPortfolioBlock, snapshotFromReport, type AssistantPortfolioSnapshot } from "@/lib/assistant-portfolio";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";

const SNAP: AssistantPortfolioSnapshot = {
  holdingCount: 3,
  totalValue: 12500,
  totalReturnDollar: 850,
  totalReturnPct: 7.3,
  todayChangePct: -0.4,
  baseCurrency: "USD",
  topPositions: [
    { symbol: "MSFT", name: "Microsoft", weightPct: 42.1, valueBase: 5262 },
    { symbol: "QQQM", name: "Invesco NASDAQ 100", weightPct: 31.9, valueBase: 3988 },
  ],
  sectors: [
    { label: "Technology", weightPct: 61.5 },
    { label: "Consumer Cyclical", weightPct: 12.0 },
  ],
  assetClasses: [{ label: "Equity", weightPct: 68.1 }],
  concentration: ["Technology 62%"],
};

describe("renderPortfolioBlock", () => {
  it("declares an empty portfolio as empty", () => {
    expect(renderPortfolioBlock([], null)).toContain("empty");
  });

  it("precomputes the watchlist/portfolio overlap so the model never does set arithmetic", () => {
    const block = renderPortfolioBlock(["MSFT", "QQQM"], null, ["MSFT", "PLTR", "LLY"]);
    expect(block).toContain("USER WATCHLIST (read-only): 3 names — MSFT, PLTR, LLY");
    expect(block).toContain("1 also held (MSFT)");
    expect(block).toContain("2 watch-only (PLTR, LLY)");
  });

  it("always carries the holdings line; live figures only when warm", () => {
    const cold = renderPortfolioBlock(["MSFT", "QQQM"], null);
    expect(cold).toContain("MSFT, QQQM");
    // A cold snapshot must be declared, never guessed at.
    expect(cold).toContain("not loaded");
    expect(cold).not.toContain("Total value");

    const warm = renderPortfolioBlock(["MSFT", "QQQM"], SNAP);
    expect(warm).toContain("Total value $12,500");
    expect(warm).toContain("+7.3%");
    expect(warm).toContain("today -0.4%");
    expect(warm).toContain("MSFT 42.1%");
    expect(warm).toContain("Technology 61.5%");
    expect(warm).toContain("Concentration flags: Technology 62%");
  });
});

describe("snapshotFromReport", () => {
  it("ranks positions by value and shapes allocations", () => {
    const report = {
      holdingCount: 2,
      totalValue: 1000,
      totalReturn: 10,
      totalReturnDollar: 100,
      todayChangePct: 1.2,
      baseCurrency: "USD",
      holdings: [
        { symbol: "A", name: "A Corp", valuation: { valueBase: 300 } },
        { symbol: "B", name: "B Corp", valuation: { valueBase: 700 } },
        { symbol: null, name: "Cash", valuation: { valueBase: 0 } },
      ],
      allocation: {
        bySector: { slices: [{ label: "Tech", weight: 70 }, { label: "Dust", weight: 0.2 }] },
        byAssetClass: { slices: [{ label: "Equity", weight: 100 }] },
      },
      concentration: [{ label: "Tech", pct: 70.4 }],
    } as unknown as UniversalPortfolioReport;

    const snap = snapshotFromReport(report);
    expect(snap.topPositions.map((p) => p.symbol)).toEqual(["B", "A"]);
    expect(snap.topPositions[0].weightPct).toBeCloseTo(70);
    expect(snap.sectors).toEqual([{ label: "Tech", weightPct: 70 }]); // dust filtered
    expect(snap.concentration).toEqual(["Tech 70%"]);
  });
});
