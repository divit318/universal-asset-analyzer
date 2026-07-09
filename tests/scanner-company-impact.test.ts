import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketEvent, SectorImpact, StockFundamentals } from "@/lib/types";

const runPromptMock = vi.fn();
vi.mock("@/lib/ai", () => ({ runPrompt: (...args: unknown[]) => runPromptMock(...args) }));

let dbRows: Partial<StockFundamentals>[] = [];
vi.mock("@/lib/db", () => ({ getFreshFundamentals: () => ({ rows: dbRows }) }));

const { buildCompanyOpportunities } = await import("@/lib/scanner/company-impact");

function sectorImpact(sector: string, strength: number, drivingEvents: string[]): SectorImpact {
  return { sector, etfTicker: null, direction: "bullish", strength, rationale: "r", keyBeneficiaries: [], keyLosers: [], drivingEvents };
}

function marketEvent(id: string, affectedSectors: string[] = []): MarketEvent {
  return { id, category: "macro", headline: `H ${id}`, summary: "s", publishedAt: new Date().toISOString(), sources: [], affectedTickers: [], affectedSectors, affectedThemes: [], causalChain: [] };
}

describe("buildCompanyOpportunities", () => {
  beforeEach(() => {
    runPromptMock.mockReset();
    dbRows = [
      { symbol: "AAA", name: "Alpha Corp", sector: "Technology", industry: "Software" } as Partial<StockFundamentals>,
      { symbol: "BBB", name: "Beta Corp", sector: "Technology", industry: "Software" } as Partial<StockFundamentals>,
    ];
  });

  it("returns [] when the screener DB is empty", async () => {
    dbRows = [];
    const result = await buildCompanyOpportunities([marketEvent("e1")], [sectorImpact("Technology", 60, ["e1"])]);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("returns [] when no sector clears the strength threshold", async () => {
    const result = await buildCompanyOpportunities([marketEvent("e1")], [sectorImpact("Technology", 20, ["e1"])]);
    expect(result).toEqual([]);
    expect(runPromptMock).not.toHaveBeenCalled();
  });

  it("builds an opportunity per matched company and deduplicates by ticker across sectors", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({
      matches: [{ symbol: "AAA", direction: "bullish", rationale: "r", timeframe: "medium", confidence: 80 }],
    }));

    const result = await buildCompanyOpportunities(
      [marketEvent("e1", ["Technology"])],
      [sectorImpact("Technology", 60, ["e1"])],
    );

    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe("AAA");
    expect(result[0].name).toBe("Alpha Corp");
  });

  it("degrades one sector's failure to an empty contribution without crashing the whole batch", async () => {
    dbRows = [
      { symbol: "AAA", name: "Alpha Corp", sector: "Technology", industry: "Software" } as Partial<StockFundamentals>,
      { symbol: "BBB", name: "Beta Bank", sector: "Financial Services", industry: "Banking" } as Partial<StockFundamentals>,
    ];
    let call = 0;
    runPromptMock.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("Ollama request timed out");
      return JSON.stringify({ matches: [{ symbol: "BBB", direction: "bullish", rationale: "r", timeframe: "medium", confidence: 80 }] });
    });

    const result = await buildCompanyOpportunities(
      [marketEvent("e1", ["Technology"]), marketEvent("e2", ["Financials"])],
      [
        sectorImpact("Technology", 60, ["e1"]),
        sectorImpact("Financials", 60, ["e2"]),
      ],
    );

    // Technology sector's call failed and contributed nothing; Financials
    // still comes through — no user-facing crash from one bad sector.
    expect(result.map((o) => o.ticker)).toEqual(["BBB"]);
  });
});
