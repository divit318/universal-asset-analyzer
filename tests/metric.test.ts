import { describe, it, expect } from "vitest";
import { metric, maybeMetric, metricSessionState } from "@/lib/metric";

const NOW = Date.parse("2026-08-05T12:00:00"); // local-time Wednesday

describe("metric constructors", () => {
  it("builds a stamped metric", () => {
    const m = metric(-8.7, "day", 123, "yahoo", "2026-07-31");
    expect(m).toEqual({ value: -8.7, basis: "day", asOf: 123, source: "yahoo", sessionDate: "2026-07-31" });
  });

  it("refuses non-finite values", () => {
    expect(() => metric(NaN, "day", 1, "yahoo")).toThrow();
    expect(() => metric(Infinity, "level", 1, "yahoo")).toThrow();
  });

  it("maybeMetric passes null through and rejects NaN", () => {
    expect(maybeMetric(null, "day", 1, "yahoo")).toBeNull();
    expect(maybeMetric(NaN, "day", 1, "yahoo")).toBeNull();
    expect(maybeMetric(5, "day", 1, "yahoo")?.value).toBe(5);
  });
});

describe("metricSessionState — the staleness policy", () => {
  const day = (sessionDate: string | null) =>
    metricSessionState({ basis: "day", sessionDate, asOf: 0 }, NOW);

  it("today's session is current", () => {
    expect(day("2026-08-05")).toBe("current");
  });

  it("yesterday and a Friday-across-the-weekend are 'previous'", () => {
    expect(day("2026-08-04")).toBe("previous");
    // Monday viewer, Friday session: gap 3 days — still previous.
    expect(metricSessionState({ basis: "day", sessionDate: "2026-07-31", asOf: 0 }, Date.parse("2026-08-03T10:00:00"))).toBe("previous");
  });

  it("older than a weekend gap is stale — the F-22 case", () => {
    // Wednesday Aug 5 viewer, Friday Jul 31 session (the -8.7% print): stale.
    expect(day("2026-07-31")).toBe("stale");
  });

  it("an undated session figure is stale by policy", () => {
    expect(day(null)).toBe("stale");
  });

  it("since-cost and levels have no session state (no freshness dot)", () => {
    expect(metricSessionState({ basis: "sinceCost", sessionDate: null, asOf: 0 }, NOW)).toBeNull();
    expect(metricSessionState({ basis: "level", sessionDate: null, asOf: 0 }, NOW)).toBeNull();
  });
});
