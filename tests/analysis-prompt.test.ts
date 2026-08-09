import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt } from "@/lib/analysis-prompt";
import type { Filing, Quote } from "@/lib/types";

const quote: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 200,
  previousClose: 190,
  change: 10,
  changePercent: 5.26,
  currency: "USD",
  marketCap: 3e12,
  peRatio: 30,
  dayHigh: 201,
  dayLow: 195,
  fiftyTwoWeekHigh: 220,
  fiftyTwoWeekLow: 150,
  volume: 1_000_000,
  exchange: "NasdaqGS",
};

const filings: Filing[] = [
  {
    form: "10-K",
    filedAt: "2024-11-01",
    description: "Annual report",
    accessionNumber: "0000320193-24-000123",
    documentUrl: "https://example.com/doc.htm",
  },
];

describe("buildAnalysisPrompt", () => {
  it("includes the symbol, price and filings", () => {
    const prompt = buildAnalysisPrompt({ quote, filings });
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("Apple Inc.");
    expect(prompt).toContain("+5.26%");
    expect(prompt).toContain("10-K filed 2024-11-01");
  });

  it("notes when no filings are present", () => {
    const prompt = buildAnalysisPrompt({ quote, filings: [] });
    expect(prompt).toContain("No recent SEC filings available.");
  });

  it("caps filings at five entries", () => {
    const many: Filing[] = Array.from({ length: 8 }, (_, i) => ({
      ...filings[0],
      form: `F${i}`,
      accessionNumber: `acc-${i}`,
    }));
    const prompt = buildAnalysisPrompt({ quote, filings: many });
    expect(prompt).toContain("F0 filed");
    expect(prompt).toContain("F4 filed");
    expect(prompt).not.toContain("F5 filed");
  });
});
