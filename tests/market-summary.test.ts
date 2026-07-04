import { describe, expect, it } from "vitest";
import { buildMarketSummaryPrompt } from "@/lib/market-summary";
import type { MarketRegime, MacroSignal, SectorRotationSnapshot } from "@/lib/types";

const regime: MarketRegime = {
  trend: "risk-on",
  breadthPct: 72,
  dominantSectors: ["Technology", "Industrials"],
  dominantThemes: ["AI Compute"],
  summary: "Market is in risk-on mode.",
};

const macroSignals: MacroSignal[] = [
  { ticker: "^TNX", name: "10Y Treasury Yield", price: 4.2, changePercent: -1.5, trend: "falling" },
  { ticker: "^VIX", name: "VIX", price: 14, changePercent: -3.2, trend: "falling" },
];

const sectorRotation: SectorRotationSnapshot = {
  asOf: "2026-07-03",
  primaryWindow: "1m",
  sectors: [],
  leaders: ["Technology", "Industrials"],
  laggards: ["Utilities"],
  leadershipChanges: [{ sector: "Industrials", fromRank: 4, toRank: 2 }],
};

describe("buildMarketSummaryPrompt", () => {
  it("includes regime, macro, and sector rotation facts without inventing data", () => {
    const prompt = buildMarketSummaryPrompt(regime, macroSignals, sectorRotation);
    expect(prompt).toContain("risk-on");
    expect(prompt).toContain("72% of sectors advancing");
    expect(prompt).toContain("Technology");
    expect(prompt).toContain("10Y Treasury Yield");
    expect(prompt).toContain("Sector leaders: Technology, Industrials");
    expect(prompt).toContain("Sector laggards: Utilities");
    expect(prompt).toContain("Industrials #4→#2");
  });

  it("degrades gracefully with no sector rotation snapshot", () => {
    const prompt = buildMarketSummaryPrompt(regime, macroSignals, null);
    expect(prompt).toContain("No sector rotation snapshot available.");
  });

  it("degrades gracefully with no macro signals", () => {
    const prompt = buildMarketSummaryPrompt(regime, [], sectorRotation);
    expect(prompt).toContain("No macro signal data available.");
  });
});
