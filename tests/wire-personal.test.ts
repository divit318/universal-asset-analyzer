import { describe, it, expect } from "vitest";
import { buildPersonalImpact } from "@/lib/wire/personal";
import { modelReadTier, corroborationLabel, isUncorroborated } from "@/lib/wire/labels";
import type { ScannerOpportunity, SignalDirection } from "@/lib/types";

function opp(
  ticker: string,
  direction: SignalDirection,
  composite: number,
  theme = "General",
): ScannerOpportunity {
  return {
    id: `id-${ticker}`,
    ticker,
    name: `${ticker} Inc`,
    isIndian: ticker.endsWith(".NS"),
    direction,
    theme,
    category: "macro",
    rationale: `${ticker} rationale`,
    timeframe: "medium",
    quote: null,
    compositeScores: null,
    opportunityScore: {
      catalystStrength: 50,
      fundamentalQuality: 50,
      valuation: 50,
      momentum: 50,
      composite,
      verdict: composite >= 70 ? "strong" : "moderate",
    },
    thesis: null,
    sourceEventIds: [],
    dividendYieldPct: null,
    profile: null,
  };
}

describe("buildPersonalImpact", () => {
  it("joins suffix-insensitively, portfolio wins overlaps, bearish sorts first", () => {
    const opportunities = [
      opp("TSM.NS", "bullish", 80),
      opp("NVDA", "bearish", 75),
      opp("AMD", "bullish", 70),
      opp("XOM", "neutral", 50),
    ];
    const impact = buildPersonalImpact(
      opportunities,
      ["TSM", "NVDA"],          // holdings
      ["NVDA", "AMD", "MSFT"],  // watchlist (NVDA overlaps → portfolio wins)
    );
    expect(impact.portfolio.affected.map((n) => n.ticker)).toEqual(["NVDA", "TSM.NS"]); // bearish first
    expect(impact.watchlist.affected.map((n) => n.ticker)).toEqual(["AMD"]);
    expect(impact.watchlist.tracked).toBe(2); // MSFT + AMD, NVDA deduped away
  });

  it("composes the readout from settled facts only", () => {
    const impact = buildPersonalImpact(
      [opp("NVDA", "bearish", 75), opp("TSM", "bullish", 80), opp("AMD", "bullish", 70)],
      ["NVDA", "TSM"],
      ["AMD"],
    );
    expect(impact.readout).toBe(
      "1 holding carries bearish signals (NVDA); 1 holding carries bullish signals (TSM); 1 watchlist name flagged (AMD).",
    );
  });

  it("surfaces a common thread when ≥2 affected names share a theme", () => {
    const impact = buildPersonalImpact(
      [
        opp("TSM", "bullish", 80, "AI Infrastructure"),
        opp("AVGO", "bullish", 76, "AI Infrastructure"),
        opp("XOM", "bullish", 60, "Energy"),
      ],
      ["TSM", "AVGO", "XOM"],
      [],
    );
    expect(impact.commonThread).toEqual({
      theme: "AI Infrastructure",
      tickers: ["TSM", "AVGO"],
    });
  });

  it("readout is null when the scan touches nothing tracked", () => {
    const impact = buildPersonalImpact([opp("XOM", "bullish", 60)], ["AAPL"], ["MSFT"]);
    expect(impact.readout).toBeNull();
    expect(impact.portfolio.affected).toEqual([]);
    expect(impact.commonThread).toBeNull();
  });
});

describe("honest-precision labels", () => {
  it("tiers model confidence coarsely and tolerates absence", () => {
    expect(modelReadTier(85)).toBe("high");
    expect(modelReadTier(75)).toBe("high");
    expect(modelReadTier(60)).toBe("moderate");
    expect(modelReadTier(54)).toBe("low");
    expect(modelReadTier(null)).toBeNull();
    expect(modelReadTier(undefined)).toBeNull();
    expect(modelReadTier(Number.NaN)).toBeNull();
  });

  it("labels corroboration and flags single sources", () => {
    expect(corroborationLabel(1)).toBe("single source");
    expect(corroborationLabel(4)).toBe("4 sources");
    expect(isUncorroborated(1)).toBe(true);
    expect(isUncorroborated(3)).toBe(false);
  });
});
