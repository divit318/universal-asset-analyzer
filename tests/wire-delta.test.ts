import { describe, it, expect } from "vitest";
import {
  fingerprintScan,
  diffScans,
  isScanFingerprint,
  THEME_MOMENTUM_DELTA_MIN,
  MAX_DELTAS,
  type ScanFingerprint,
} from "@/lib/wire/delta";
import type { ScannerResult } from "@/lib/types";

function makeResult(overrides: Partial<ScannerResult> = {}): ScannerResult {
  return {
    scannedAt: "2026-08-12T12:00:00Z",
    pipelineVersion: 2,
    marketRegime: {
      trend: "neutral",
      breadthPct: 55,
      dominantSectors: [],
      dominantThemes: [],
      summary: "",
    },
    macroSignals: [],
    sectorImpacts: [],
    emergingThemes: [],
    events: [],
    opportunities: [],
    highConviction: [],
    developing: [],
    riskAlerts: [],
    newsItems: [],
    aiSummary: "",
    ...overrides,
  };
}

function fp(overrides: Partial<ScanFingerprint> = {}): ScanFingerprint {
  return {
    scannedAt: "2026-08-12T11:00:00Z",
    regime: "neutral",
    themes: [],
    sectors: [],
    highConviction: [],
    riskHeadlines: [],
    ...overrides,
  };
}

describe("fingerprintScan", () => {
  it("captures regime, themes, canonical sector directions, ideas, risks", () => {
    const result = makeResult({
      marketRegime: { trend: "risk-on", breadthPct: 70, dominantSectors: [], dominantThemes: [], summary: "" },
      emergingThemes: [
        { name: "AI Power Build-Out", description: "", momentum: 82, drivingEvents: [], topTickers: [], thematicResearchUrl: "" },
      ],
      sectorImpacts: [
        { sector: "Banking", etfTicker: null, direction: "bullish", strength: 60, rationale: "", keyBeneficiaries: [], keyLosers: [], drivingEvents: [] },
        { sector: "Financials", etfTicker: null, direction: "bearish", strength: 40, rationale: "", keyBeneficiaries: [], keyLosers: [], drivingEvents: [] },
      ],
      highConviction: [
        { id: "1", ticker: "TSM.NS", name: "", isIndian: true, direction: "bullish", theme: "", category: "macro", rationale: "", timeframe: "medium", quote: null, compositeScores: null, opportunityScore: { catalystStrength: 0, fundamentalQuality: 0, valuation: 0, momentum: 0, composite: 80, verdict: "strong" }, thesis: null, sourceEventIds: [], dividendYieldPct: null, profile: null },
      ],
      riskAlerts: [
        { id: "r1", headline: "AI financing scrutiny", severity: "high", affectedSectors: [], affectedTickers: [], rationale: "" },
      ],
    });
    const f = fingerprintScan(result);
    expect(f.regime).toBe("risk-on");
    expect(f.themes).toEqual([{ name: "AI Power Build-Out", momentum: 82 }]);
    // "Banking" canonicalizes to Financials; first mapping wins, no dupes.
    expect(f.sectors).toEqual([{ sector: "Financials", direction: "bullish" }]);
    expect(f.highConviction).toEqual(["TSM"]);
    expect(f.riskHeadlines).toEqual(["AI financing scrutiny"]);
    expect(isScanFingerprint(f)).toBe(true);
    expect(isScanFingerprint(JSON.parse(JSON.stringify(f)))).toBe(true);
  });
});

describe("diffScans", () => {
  it("returns [] with no baseline or the same scan", () => {
    const curr = fp({ scannedAt: "2026-08-12T12:00:00Z" });
    expect(diffScans(null, curr)).toEqual([]);
    expect(diffScans({ ...curr }, curr)).toEqual([]);
  });

  it("reports regime flips, sector flips, theme moves, new risks and ideas — in priority order", () => {
    const prev = fp({
      regime: "risk-off",
      themes: [
        { name: "AI Infrastructure", momentum: 60 },
        { name: "Defense Spending", momentum: 50 },
      ],
      sectors: [{ sector: "Real Estate", direction: "neutral" }],
      highConviction: ["MSFT"],
      riskHeadlines: ["Old risk"],
    });
    const curr = fp({
      scannedAt: "2026-08-12T12:00:00Z",
      regime: "risk-on",
      themes: [
        { name: "AI Infrastructure", momentum: 60 + THEME_MOMENTUM_DELTA_MIN },
        { name: "Defense Spending", momentum: 50 + THEME_MOMENTUM_DELTA_MIN - 1 }, // below threshold
        { name: "Copper Squeeze", momentum: 70 },
      ],
      sectors: [{ sector: "Real Estate", direction: "bullish" }],
      highConviction: ["MSFT", "TSM"],
      riskHeadlines: ["Old risk", "New risk headline"],
    });
    const deltas = diffScans(prev, curr);
    expect(deltas.map((d) => d.kind)).toEqual([
      "regime",
      "risk-new",
      "sector-flip",
      "theme-new",
      "theme-momentum",
      "idea-new",
    ]);
    expect(deltas[0].label).toContain("risk-off → risk-on");
    expect(deltas[2].label).toContain("Real Estate news signal neutral → bullish");
    expect(deltas.find((d) => d.kind === "theme-momentum")!.label).toContain("AI Infrastructure");
    expect(deltas.find((d) => d.kind === "idea-new")!.label).toContain("TSM");
  });

  it("never fabricates: sectors/themes absent from the baseline are not flips or moves", () => {
    const prev = fp({ sectors: [], themes: [] });
    const curr = fp({
      scannedAt: "2026-08-12T12:00:00Z",
      sectors: [{ sector: "Utilities", direction: "bullish" }],
      themes: [{ name: "Grid Build-Out", momentum: 88 }],
    });
    const kinds = diffScans(prev, curr).map((d) => d.kind);
    expect(kinds).not.toContain("sector-flip");
    expect(kinds).not.toContain("theme-momentum");
    expect(kinds).toContain("theme-new"); // genuinely new is reported as new
  });

  it("caps output at MAX_DELTAS", () => {
    const prev = fp({ riskHeadlines: [] });
    const curr = fp({
      scannedAt: "2026-08-12T12:00:00Z",
      riskHeadlines: Array.from({ length: 10 }, (_, i) => `Risk ${i}`),
    });
    expect(diffScans(prev, curr).length).toBeLessThanOrEqual(MAX_DELTAS);
  });
});
