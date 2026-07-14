import { describe, expect, it } from "vitest";
import {
  classifyTimelineCategory,
  scoreImportance,
  scoreConfidence,
  deriveImpact,
  deriveCatalystStatus,
  buildEventId,
  computeThesisEvolution,
  parseTimelineDetail,
  parseWhatChanged,
} from "@/lib/timeline";
import type { TimelineEvent } from "@/lib/types";

describe("classifyTimelineCategory", () => {
  it("classifies earnings headlines", () => {
    expect(classifyTimelineCategory("Apple beats earnings estimates for Q3")).toBe("earnings");
  });

  it("classifies CEO change headlines", () => {
    expect(classifyTimelineCategory("Company names new CEO after founder steps down")).toBe("ceo_change");
  });

  it("classifies acquisition headlines", () => {
    expect(classifyTimelineCategory("Acme Corp to acquire rival for $2B")).toBe("acquisition");
  });

  it("classifies analyst upgrade/downgrade headlines distinctly", () => {
    expect(classifyTimelineCategory("Morgan Stanley upgrades stock to Overweight")).toBe("analyst_upgrade");
    expect(classifyTimelineCategory("Goldman downgrades stock, cuts price target")).toBe("analyst_downgrade");
  });

  it("classifies lawsuit and regulatory headlines distinctly", () => {
    expect(classifyTimelineCategory("Shareholders file class action lawsuit")).toBe("lawsuit");
    expect(classifyTimelineCategory("Company under FTC antitrust investigation")).toBe("regulatory_action");
  });

  it("falls back to the caller-supplied default when nothing matches", () => {
    expect(classifyTimelineCategory("A perfectly ordinary sentence about nothing in particular")).toBe("industry_event");
    expect(classifyTimelineCategory("Totally unrelated text", "earnings")).toBe("earnings");
  });
});

describe("scoreConfidence", () => {
  it("ranks filings above news", () => {
    expect(scoreConfidence("filing", true)).toBeGreaterThan(scoreConfidence("news", true));
  });

  it("penalizes missing detail", () => {
    expect(scoreConfidence("news", false)).toBeLessThan(scoreConfidence("news", true));
  });

  it("stays within 0-100 bounds", () => {
    const score = scoreConfidence("filing", true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("scoreImportance", () => {
  it("weights acquisitions higher than dividends", () => {
    expect(scoreImportance("acquisition", 70)).toBeGreaterThan(scoreImportance("dividend", 70));
  });

  it("applies a severity boost", () => {
    const base = scoreImportance("portfolio_impact", 70);
    const boosted = scoreImportance("portfolio_impact", 70, 15);
    expect(boosted).toBeGreaterThan(base);
  });

  it("clamps to [0, 100]", () => {
    expect(scoreImportance("earnings", 100, 100)).toBeLessThanOrEqual(100);
    expect(scoreImportance("dividend", 0, -100)).toBeGreaterThanOrEqual(0);
  });
});

describe("deriveImpact", () => {
  it("detects bullish keywords", () => {
    expect(deriveImpact("earnings", "Company beats estimates and raises guidance")).toBe("bullish");
  });

  it("detects bearish keywords", () => {
    expect(deriveImpact("earnings", "Company misses estimates and lowers outlook")).toBe("bearish");
  });

  it("falls back to category default when text is neutral", () => {
    expect(deriveImpact("analyst_upgrade", "Analyst note published")).toBe("bullish");
    expect(deriveImpact("analyst_downgrade", "Analyst note published")).toBe("bearish");
  });

  it("defaults to neutral with no keywords or category default", () => {
    expect(deriveImpact("dividend", "Quarterly dividend declared")).toBe("neutral");
  });
});

describe("deriveCatalystStatus", () => {
  it("flags future-dated events as pending", () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect(deriveCatalystStatus("earnings", future, 80)).toBe("pending");
  });

  it("flags important past forward-looking events as realized", () => {
    const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(deriveCatalystStatus("earnings", past, 80)).toBe("realized");
  });

  it("flags low-importance past events as not_catalyst", () => {
    const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(deriveCatalystStatus("dividend", past, 20)).toBe("not_catalyst");
  });
});

describe("buildEventId", () => {
  it("is deterministic for the same natural key", () => {
    const a = buildEventId("AAPL", "news", "https://example.com/a");
    const b = buildEventId("AAPL", "news", "https://example.com/a");
    expect(a).toBe(b);
  });

  it("differs for different natural keys", () => {
    const a = buildEventId("AAPL", "news", "https://example.com/a");
    const b = buildEventId("AAPL", "news", "https://example.com/b");
    expect(a).not.toBe(b);
  });
});

describe("computeThesisEvolution", () => {
  function mkEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
    return {
      id: overrides.id ?? "id",
      symbol: "AAPL",
      timestamp: overrides.timestamp ?? "2026-01-01T00:00:00.000Z",
      title: overrides.title ?? "Event",
      category: overrides.category ?? "earnings",
      importanceScore: overrides.importanceScore ?? 80,
      confidenceScore: overrides.confidenceScore ?? 70,
      impact: overrides.impact ?? "bullish",
      affectedSegment: null,
      relatedMetrics: [],
      source: { kind: "news", url: null, description: "" },
      thesisImpact: null,
      catalystStatus: "not_catalyst",
    };
  }

  it("ignores events below the importance threshold", () => {
    const evolution = computeThesisEvolution("AAPL", [mkEvent({ id: "1", importanceScore: 30 })]);
    expect(evolution.points).toHaveLength(0);
    expect(evolution.currentConfidence).toBe(50);
  });

  it("strengthens confidence on bullish important events", () => {
    const evolution = computeThesisEvolution("AAPL", [mkEvent({ id: "1", impact: "bullish" })]);
    expect(evolution.points).toHaveLength(1);
    expect(evolution.points[0].direction).toBe("strengthened");
    expect(evolution.currentConfidence).toBeGreaterThan(50);
  });

  it("weakens confidence on bearish important events", () => {
    const evolution = computeThesisEvolution("AAPL", [mkEvent({ id: "1", impact: "bearish" })]);
    expect(evolution.points[0].direction).toBe("weakened");
    expect(evolution.currentConfidence).toBeLessThan(50);
  });

  it("processes events in chronological order regardless of input order", () => {
    const early = mkEvent({ id: "early", timestamp: "2026-01-01T00:00:00.000Z", impact: "bullish" });
    const late = mkEvent({ id: "late", timestamp: "2026-06-01T00:00:00.000Z", impact: "bearish" });
    const evolution = computeThesisEvolution("AAPL", [late, early]); // reversed input
    expect(evolution.points.map((p) => p.eventId)).toEqual(["early", "late"]);
  });

  it("clamps confidence within [0, 100]", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      mkEvent({ id: `e${i}`, timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, impact: "bearish", importanceScore: 100 }),
    );
    const evolution = computeThesisEvolution("AAPL", events);
    expect(evolution.currentConfidence).toBeGreaterThanOrEqual(0);
  });
});

describe("parseTimelineDetail", () => {
  it("fills omitted array fields with [] on a valid-but-incomplete parse", () => {
    const raw = '{"executiveSummary":"Earnings beat expectations."}';
    const detail = parseTimelineDetail(raw);
    expect(detail.executiveSummary).toBe("Earnings beat expectations.");
    expect(detail.supportingEvidence).toEqual([]);
    expect(detail.bullCase).toEqual([]);
  });

  it("falls back to [] when bullCase arrives as the wrong kind", () => {
    const raw = '{"executiveSummary":"ok","bullCase":"not an array"}';
    const detail = parseTimelineDetail(raw);
    expect(Array.isArray(detail.bullCase)).toBe(true);
  });

  it("clamps a numeric-string confidence into [0, 100] instead of propagating NaN", () => {
    const raw = '{"executiveSummary":"ok","confidence":"150"}';
    const detail = parseTimelineDetail(raw);
    expect(detail.confidence).toBe(100);
  });

  it("returns the unavailable-message default on total garbage instead of throwing", () => {
    const detail = parseTimelineDetail("the model refused to answer");
    expect(detail.executiveSummary).toBe("Unable to generate an explanation — AI unavailable.");
    expect(detail.supportingEvidence).toEqual([]);
  });
});

describe("parseWhatChanged", () => {
  it("fills omitted array fields with [] on a valid-but-incomplete parse", () => {
    const raw = '{"managementExecution":"Delivered on guidance."}';
    const result = parseWhatChanged(raw);
    expect(result.managementExecution).toBe("Delivered on guidance.");
    expect(result.assumptionsValidated).toEqual([]);
    expect(result.assumptionsFailed).toEqual([]);
  });

  it("falls back to [] when assumptionsFailed arrives as the wrong kind", () => {
    const raw = '{"assumptionsFailed":"not an array"}';
    const result = parseWhatChanged(raw);
    expect(result.assumptionsFailed).toEqual([]);
  });

  it("returns the unavailable-message default on total garbage instead of throwing", () => {
    const result = parseWhatChanged("the model refused to answer");
    expect(result.managementExecution).toBe("Unable to generate — AI unavailable.");
  });
});
