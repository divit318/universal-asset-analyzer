import { describe, expect, it } from "vitest";
import {
  activeFilters,
  applyFilters,
  bindingConstraint,
  diagnose,
  isActive,
  MARGINAL_SLACK,
  matches,
  parseFilters,
  parsePreferences,
} from "@/lib/screener/filter-engine";
import { framedPercentile, getUniverseStats } from "@/lib/screener/universe-stats";
import { percentileRank, rankAll, sortCandidates } from "@/lib/screener/ranking";
import { explain } from "@/lib/screener/explain";
import { formatMetricValue } from "@/lib/screener/format";
import { getMetric } from "@/lib/assets/registry";
import type { FilterValues } from "@/lib/assets/types";
import type { ScreenerCandidate } from "@/lib/screener/types";

function candidate(
  symbol: string,
  metrics: Record<string, number | null>,
  attributes: Record<string, string | null> = {},
): ScreenerCandidate {
  return {
    symbol,
    name: `${symbol} Inc.`,
    assetClass: "equity",
    price: 100,
    changePercent: 0,
    metrics,
    attributes,
  };
}

/* -------------------------------------------------------------------------- */
/* Filter engine                                                               */
/* -------------------------------------------------------------------------- */

describe("filter engine", () => {
  const rows = [
    candidate("AAA", { roic: 20, forwardPE: 15, marketCap: 5e9 }, { sector: "Technology" }),
    candidate("BBB", { roic: 5, forwardPE: 30, marketCap: 1e9 }, { sector: "Energy" }),
    candidate("CCC", { roic: null, forwardPE: 10, marketCap: 20e9 }, { sector: "Technology" }),
  ];

  it("returns everything when no filter is active", () => {
    expect(applyFilters(rows, "equity", {})).toHaveLength(3);
  });

  it("applies a min bound", () => {
    const out = applyFilters(rows, "equity", { roic: { kind: "range", min: 10, max: null } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  it("applies a max bound", () => {
    const out = applyFilters(rows, "equity", { forwardPE: { kind: "range", min: null, max: 20 } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("applies both bounds", () => {
    const out = applyFilters(rows, "equity", { forwardPE: { kind: "range", min: 12, max: 20 } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  /**
   * The load-bearing rule, inherited from the original fundamental screener:
   * you cannot confirm that an unknown value clears a threshold, so an active
   * filter excludes rows whose value is missing.
   */
  it("excludes a candidate whose value is unknown when the filter is active", () => {
    const out = applyFilters(rows, "equity", { roic: { kind: "range", min: 0, max: null } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(out.find((r) => r.symbol === "CCC")).toBeUndefined();
  });

  it("does not exclude unknowns when the filter is inactive", () => {
    const out = applyFilters(rows, "equity", { roic: { kind: "range", min: null, max: null } });
    expect(out).toHaveLength(3);
  });

  it("preserves input order", () => {
    const out = applyFilters(rows, "equity", { marketCap: { kind: "range", min: 0, max: null } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("matches a categorical filter case-insensitively", () => {
    const out = applyFilters(rows, "equity", { sector: { kind: "select", value: "technology" } });
    expect(out.map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("matches any of a multiselect", () => {
    const out = applyFilters(rows, "equity", {
      sector: { kind: "multiselect", values: ["Energy", "Technology"] },
    });
    expect(out).toHaveLength(3);
  });

  it("combines filters with AND", () => {
    const out = applyFilters(rows, "equity", {
      sector: { kind: "select", value: "Technology" },
      forwardPE: { kind: "range", min: null, max: 12 },
    });
    expect(out.map((r) => r.symbol)).toEqual(["CCC"]);
  });

  /**
   * The safety property the whole availability model exists for: a filter on a
   * metric with no data provider must never reach the engine, because it would
   * silently match nothing and read as "no results" rather than "no data".
   */
  it("ignores a filter on an unavailable metric rather than emptying the table", () => {
    const filters = {
      insiderBuying: { kind: "range", min: 1, max: null },
    } as unknown as FilterValues;

    expect(activeFilters("equity", filters)).toEqual({});
    expect(applyFilters(rows, "equity", filters)).toHaveLength(3);
    expect(matches(rows[0], "equity", filters)).toBe(true);
  });

  it("knows which filter values actually constrain something", () => {
    expect(isActive({ kind: "range", min: null, max: null })).toBe(false);
    expect(isActive({ kind: "range", min: 1, max: null })).toBe(true);
    expect(isActive({ kind: "multiselect", values: [] })).toBe(false);
    expect(isActive({ kind: "multiselect", values: ["Energy"] })).toBe(true);
    expect(isActive({ kind: "select", value: null })).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Parsing untrusted input                                                     */
/* -------------------------------------------------------------------------- */

describe("parseFilters", () => {
  it("coerces numeric strings and drops empties", () => {
    expect(parseFilters("equity", { roic: { min: "12", max: "" } })).toEqual({
      roic: { kind: "range", min: 12, max: null },
    });
  });

  it("rejects non-numeric values", () => {
    expect(parseFilters("equity", { roic: { min: "abc" } })).toEqual({});
  });

  it("drops metrics that don't exist on the class", () => {
    expect(parseFilters("equity", { duration: { min: 5 } })).toEqual({});
    // ...but the same key IS valid on bonds.
    expect(parseFilters("bond", { duration: { min: 5 } })).toEqual({
      duration: { kind: "range", min: 5, max: null },
    });
  });

  it("refuses to build a filter for an unavailable metric", () => {
    expect(parseFilters("crypto", { tvl: { min: 1e9 } })).toEqual({});
    expect(parseFilters("equity", { insiderBuying: { min: 1 } })).toEqual({});
    expect(parseFilters("reit", { capRate: { min: 5 } })).toEqual({});
  });

  it("validates categorical values against the metric's options", () => {
    expect(parseFilters("crypto", { sector: { value: "Layer 1" } })).toEqual({
      sector: { kind: "select", value: "Layer 1" },
    });
    // "Layer 9" is not a declared option.
    expect(parseFilters("crypto", { sector: { value: "Layer 9" } })).toEqual({});
  });

  it("filters a multiselect down to the allowed options", () => {
    expect(
      parseFilters("crypto", { sector: { values: ["DeFi", "Nonsense", "AI"] } }),
    ).toEqual({ sector: { kind: "multiselect", values: ["DeFi", "AI"] } });
  });

  it("survives garbage input", () => {
    expect(parseFilters("equity", null)).toEqual({});
    expect(parseFilters("equity", "nope")).toEqual({});
    expect(parseFilters("equity", { roic: "not-an-object" })).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

describe("percentileRank", () => {
  const rows = [
    candidate("LOW", { roic: 5 }),
    candidate("MID", { roic: 10 }),
    candidate("HIGH", { roic: 20 }),
    candidate("NONE", { roic: null }),
  ];

  it("ranks higher-is-better metrics with the best at 100", () => {
    const pct = percentileRank(rows, "equity", "roic");
    expect(pct.get("HIGH")).toBe(100);
    expect(pct.get("LOW")).toBe(0);
    expect(pct.get("MID")).toBe(50);
  });

  it("inverts lower-is-better metrics, so cheap ranks best", () => {
    const cheap = [
      candidate("CHEAP", { forwardPE: 8 }),
      candidate("MID", { forwardPE: 16 }),
      candidate("RICH", { forwardPE: 40 }),
    ];
    const pct = percentileRank(cheap, "equity", "forwardPE");
    expect(pct.get("CHEAP")).toBe(100);
    expect(pct.get("RICH")).toBe(0);
  });

  it("gives no percentile at all to a candidate with no value", () => {
    const pct = percentileRank(rows, "equity", "roic");
    // Crucially: not 0. A missing ROIC is not a bad ROIC.
    expect(pct.has("NONE")).toBe(false);
  });

  it("gives tied values the same percentile", () => {
    const tied = [
      candidate("A", { roic: 10 }),
      candidate("B", { roic: 10 }),
      candidate("C", { roic: 30 }),
    ];
    const pct = percentileRank(tied, "equity", "roic");
    expect(pct.get("A")).toBe(pct.get("B"));
    expect(pct.get("C")).toBe(100);
  });

  it("honours an explicit direction override", () => {
    const pct = percentileRank(rows, "equity", "roic", "lower");
    expect(pct.get("LOW")).toBe(100);
    expect(pct.get("HIGH")).toBe(0);
  });

  it("handles a single-candidate universe without dividing by zero", () => {
    const pct = percentileRank([candidate("ONLY", { roic: 10 })], "equity", "roic");
    expect(pct.get("ONLY")).toBe(50);
  });
});

describe("rankAll", () => {
  const universe = [
    candidate("BEST", { qualityScore: 90, valueScore: 90, overallScore: 90 }),
    candidate("MID", { qualityScore: 50, valueScore: 50, overallScore: 50 }),
    candidate("WORST", { qualityScore: 10, valueScore: 10, overallScore: 10 }),
  ];

  it("scores the best candidate at the top with full confidence", () => {
    const scores = rankAll(universe, "equity", [
      { metric: "overallScore", weight: 3 },
      { metric: "qualityScore", weight: 1 },
    ]);
    expect(scores.get("BEST")!.rankScore).toBe(100);
    expect(scores.get("WORST")!.rankScore).toBe(0);
    expect(scores.get("BEST")!.confidence).toBe(100);
  });

  /**
   * Missing data must not be scored as *bad* data — the weight is redistributed
   * across the factors that do have values, and the gap is reported as reduced
   * confidence. This is the fix for the "everything scores 73" class of bug.
   */
  it("redistributes weight away from missing factors rather than scoring them zero", () => {
    const partial = [
      ...universe,
      // Strictly the best quality in the universe, but no value/overall data.
      candidate("PARTIAL", { qualityScore: 95, valueScore: null, overallScore: null }),
    ];
    const scores = rankAll(partial, "equity", [
      { metric: "overallScore", weight: 2 },
      { metric: "valueScore", weight: 1 },
      { metric: "qualityScore", weight: 1 },
    ]);

    const p = scores.get("PARTIAL")!;
    // Only 1 of 4 weight units had data, so confidence is 25%.
    expect(p.confidence).toBe(25);
    // It tops the one factor it has (raw percentile 100), but the score is
    // shrunk toward neutral by its coverage: 50 + (100 − 50) × 0.25 = 63.
    // Crucially it is NOT scored as if the missing factors were zeros (which
    // would have put it near the bottom) and NOT given a full 100 (which would
    // have let it outrank names we can actually see).
    expect(p.rankScore).toBe(63);
  });

  /**
   * Regression: live verification found a bond fund with no yield and no
   * duration data ranking #1 at 20% confidence, purely because the single
   * metric it *did* have led the universe. A sparsely-measured candidate must
   * not outrank a fully-measured one on the strength of what we couldn't see.
   */
  it("shrinks a sparsely-covered score toward neutral so it cannot beat a fully-covered one", () => {
    const rows = [
      // Tops the one factor it has data for, but nothing else.
      candidate("SPARSE", { overallScore: 99, valueScore: null, qualityScore: null }),
      // Strong across the board.
      candidate("COMPLETE", { overallScore: 80, valueScore: 80, qualityScore: 80 }),
      candidate("FILLER", { overallScore: 10, valueScore: 10, qualityScore: 10 }),
    ];
    const scores = rankAll(rows, "equity", [
      { metric: "overallScore", weight: 1 },
      { metric: "valueScore", weight: 1 },
      { metric: "qualityScore", weight: 1 },
    ]);

    const sparse = scores.get("SPARSE")!;
    const complete = scores.get("COMPLETE")!;

    expect(sparse.confidence).toBe(33);
    expect(complete.confidence).toBe(100);
    // The fully-measured name wins, despite the sparse one topping its one factor.
    expect(complete.rankScore).toBeGreaterThan(sparse.rankScore);
  });

  it("leaves a fully-covered score untouched by shrinkage", () => {
    const rows = [
      candidate("TOP", { overallScore: 90 }),
      candidate("BOTTOM", { overallScore: 10 }),
    ];
    const scores = rankAll(rows, "equity", [{ metric: "overallScore", weight: 1 }]);
    // Confidence 100 → no shrinkage → the extremes stay at the extremes. This is
    // why equity ranking (near-total coverage) is unchanged by the shrinkage fix.
    expect(scores.get("TOP")!.rankScore).toBe(100);
    expect(scores.get("BOTTOM")!.rankScore).toBe(0);
  });

  it("gives tied candidates the tie midpoint rather than an arbitrary winner", () => {
    const tied = [
      candidate("TIE_A", { overallScore: 90 }),
      candidate("TIE_B", { overallScore: 90 }),
      candidate("MID", { overallScore: 50 }),
      candidate("LOW", { overallScore: 10 }),
    ];
    const scores = rankAll(tied, "equity", [{ metric: "overallScore", weight: 1 }]);
    // Both occupy ranks 2 and 3 of 4 → midpoint 2.5/3 = 83.
    expect(scores.get("TIE_A")!.rankScore).toBe(83);
    expect(scores.get("TIE_B")!.rankScore).toBe(83);
  });

  it("reports zero confidence when no factor has data", () => {
    const blind = [candidate("BLIND", { overallScore: null })];
    const scores = rankAll(blind, "equity", [{ metric: "overallScore", weight: 1 }]);
    expect(scores.get("BLIND")).toEqual({ rankScore: 0, confidence: 0, percentiles: {} });
  });

  /**
   * Stability: percentiles are computed against the whole universe, so a
   * candidate's score does not move when unrelated filters change the matched
   * set. This is what makes a score mean the same thing across two screens.
   */
  it("produces a score independent of which candidates are later filtered out", () => {
    const factors = [{ metric: "overallScore", weight: 1 }];
    const full = rankAll(universe, "equity", factors);
    // The pipeline always ranks the full universe, then filters — so BEST's
    // score is the same whether or not WORST survives the filters.
    expect(full.get("BEST")!.rankScore).toBe(100);
    expect(full.get("MID")!.rankScore).toBe(50);
  });
});

describe("sortCandidates", () => {
  const rows = [
    { ...candidate("A", { roic: 5 }), rankScore: 30 },
    { ...candidate("B", { roic: null }), rankScore: 90 },
    { ...candidate("C", { roic: 20 }), rankScore: 60 },
  ];

  it("sorts descending by default", () => {
    expect(sortCandidates(rows, "rankScore", "desc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });

  it("sorts ascending", () => {
    expect(sortCandidates(rows, "rankScore", "asc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });

  it("sinks nulls to the bottom in BOTH directions", () => {
    // A missing value is not a small value.
    expect(sortCandidates(rows, "roic", "desc").map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(sortCandidates(rows, "roic", "asc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });

  it("sorts by symbol", () => {
    expect(sortCandidates(rows, "symbol", "asc").map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Explanations                                                                */
/* -------------------------------------------------------------------------- */

describe("explain", () => {
  const c = candidate(
    "AAA",
    { roic: 22, forwardPE: 11, netDebtToEbitda: 6, revenueGrowthYoY: -5, marketCap: 5e9 },
    { sector: "Technology" },
  );

  it("restates each active filter with the candidate's actual value", () => {
    const result = explain(
      c,
      "equity",
      { roic: { kind: "range", min: 12, max: null } },
      {},
    );
    expect(result.passed).toEqual([{ label: "ROIC ≥ 12.0%", detail: "22.0%" }]);
  });

  it("reports both bounds of a two-sided filter", () => {
    const result = explain(
      c,
      "equity",
      { forwardPE: { kind: "range", min: 5, max: 15 } },
      {},
    );
    expect(result.passed[0].label).toBe("Forward P/E between 5.00x and 15.00x");
  });

  it("says nothing passed when no filter is active", () => {
    expect(explain(c, "equity", {}, {}).passed).toEqual([]);
  });

  it("surfaces top-quartile percentiles as strengths, best first", () => {
    const result = explain(c, "equity", {}, { roic: 96, forwardPE: 80, marketCap: 20 });
    expect(result.strengths).toHaveLength(2);
    expect(result.strengths[0].label).toBe("ROIC");
    expect(result.strengths[0].detail).toContain("top 5%");
    expect(result.strengths[1].label).toBe("Forward P/E");
  });

  it("fires the registry's risk flags", () => {
    const result = explain(c, "equity", {}, {});
    expect(result.warnings).toContain("High leverage");
    expect(result.warnings).toContain("Revenue shrinking");
  });

  it("fires an attribute-based flag", () => {
    const office = {
      ...candidate("OFC", { dividendYield: 4 }, { propertyType: "Office" }),
      assetClass: "reit" as const,
    };
    expect(explain(office, "reit", {}, {}).warnings).toContain(
      "Office exposure — structural demand risk",
    );
  });

  it("formats a categorical filter's value from attributes, not metrics", () => {
    const result = explain(
      c,
      "equity",
      { sector: { kind: "select", value: "Technology" } },
      {},
    );
    expect(result.passed[0]).toEqual({
      label: "Sector is Technology",
      detail: "Technology",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

describe("formatMetricValue", () => {
  it("formats by the registry's declared unit", () => {
    expect(formatMetricValue(getMetric("equity", "marketCap")!, 3.2e12)).toBe("$3.20T");
    expect(formatMetricValue(getMetric("equity", "marketCap")!, 5e9)).toBe("$5.00B");
    expect(formatMetricValue(getMetric("equity", "roic")!, 22.4)).toBe("22.4%");
    expect(formatMetricValue(getMetric("equity", "forwardPE")!, 15.5)).toBe("15.50x");
    expect(formatMetricValue(getMetric("bond", "duration")!, 6.68)).toBe("6.7 yrs");
    expect(formatMetricValue(getMetric("equity", "overallScore")!, 73.4)).toBe("73");
  });

  it("renders a missing value as an em dash, never as zero", () => {
    expect(formatMetricValue(getMetric("equity", "roic")!, null)).toBe("—");
    expect(formatMetricValue(getMetric("equity", "roic")!, NaN)).toBe("—");
  });

  /**
   * Regression: one decimal place collapsed a quarter of the ETF universe into
   * "0.0%" / "0.1%" — VEA (0.03%) and IJR (0.06%) were indistinguishable in the
   * Expense column that the whole class is ranked on. The same function formats
   * filter *bounds* in the match explanation, so a max of 0.15% was also
   * restated to the user as "≤ 0.2%": a tighter constraint than the one applied.
   */
  it("keeps two decimals below 1%, where expense ratios live", () => {
    const expense = getMetric("etf", "expenseRatio")!;
    expect(formatMetricValue(expense, 0.03)).toBe("0.03%");
    expect(formatMetricValue(expense, 0.06)).toBe("0.06%");
    expect(formatMetricValue(expense, 0.15)).toBe("0.15%");
    expect(formatMetricValue(expense, 0.9)).toBe("0.90%");
    expect(formatMetricValue(expense, -0.04)).toBe("-0.04%");
    // A genuine zero fee is unambiguous at one decimal, and reads better.
    expect(formatMetricValue(expense, 0)).toBe("0.0%");
    // …and nothing above 1% changes.
    expect(formatMetricValue(getMetric("equity", "roic")!, 22.4)).toBe("22.4%");
    expect(formatMetricValue(getMetric("equity", "oneYearReturn")!, 143.6)).toBe("144%");
  });
});

/* -------------------------------------------------------------------------- */
/* Relative frames, soft preferences, and diagnostics                          */
/* -------------------------------------------------------------------------- */

/**
 * The three additions that change what a screen can express, tested against the
 * property that matters for each: a frame compares like with like, a preference
 * reorders without excluding, and a diagnosis is either actionable or silent —
 * never a false promise.
 */
describe("relative frames", () => {
  // Two sectors with deliberately non-overlapping valuation levels: every
  // "expensive" software name is dearer than every "cheap" bank. An absolute
  // P/E filter can only ever return banks; a peer-framed one must return the
  // cheapest of *each* sector.
  const rows = [
    candidate("SOFT_CHEAP", { forwardPE: 30 }, { sector: "Technology" }),
    candidate("SOFT_MID", { forwardPE: 40 }, { sector: "Technology" }),
    candidate("SOFT_DEAR", { forwardPE: 50 }, { sector: "Technology" }),
    candidate("BANK_CHEAP", { forwardPE: 6 }, { sector: "Financial Services" }),
    candidate("BANK_MID", { forwardPE: 8 }, { sector: "Financial Services" }),
    candidate("BANK_DEAR", { forwardPE: 10 }, { sector: "Financial Services" }),
  ];
  const stats = getUniverseStats("equity", rows, "2026-01-01T00:00:00.000Z");

  it("orients percentiles so 100 is always best, whichever way the metric runs", () => {
    // forwardPE is better-lower, so the cheapest name in the class scores 100.
    expect(framedPercentile(stats, "class", "forwardPE", "BANK_CHEAP")).toBe(100);
    expect(framedPercentile(stats, "class", "forwardPE", "SOFT_DEAR")).toBe(0);
  });

  it("compares a company against its own sector, not the whole market", () => {
    // Within Technology, the 30x name is the cheapest → best percentile.
    expect(framedPercentile(stats, "peer", "forwardPE", "SOFT_CHEAP")).toBe(100);
    expect(framedPercentile(stats, "peer", "forwardPE", "BANK_CHEAP")).toBe(100);
    // …and the dearest of each sector is bottom of its own group.
    expect(framedPercentile(stats, "peer", "forwardPE", "SOFT_DEAR")).toBe(0);
    expect(framedPercentile(stats, "peer", "forwardPE", "BANK_DEAR")).toBe(0);
  });

  /**
   * The whole point of the feature: an absolute cheapness filter is a disguised
   * sector filter. Peer framing is what lets "cheap" mean the same thing to a
   * bank and a software company.
   */
  it("returns the cheapest of every sector, where an absolute filter returns one sector", () => {
    const peer: FilterValues = { forwardPE: { kind: "range", min: 99, max: null, frame: "peer" } };
    const peerHits = applyFilters(rows, "equity", peer, stats).map((c) => c.symbol);
    expect(peerHits.sort()).toEqual(["BANK_CHEAP", "SOFT_CHEAP"]);

    const absolute: FilterValues = { forwardPE: { kind: "range", min: null, max: 12 } };
    const absoluteHits = applyFilters(rows, "equity", absolute, stats).map((c) => c.symbol);
    expect(absoluteHits.every((s) => s.startsWith("BANK"))).toBe(true);
  });

  it("treats a framed filter as unknown when no stats are supplied, rather than comparing a percentile to a raw P/E", () => {
    const framed: FilterValues = { forwardPE: { kind: "range", min: 90, max: null, frame: "peer" } };
    // Default missing policy excludes; without stats nothing can be confirmed.
    expect(applyFilters(rows, "equity", framed, null)).toHaveLength(0);
  });

  it("refuses to invent a percentile for a peer group of one", () => {
    const lonely = [...rows, candidate("ONLY_REIT", { forwardPE: 12 }, { sector: "Real Estate" })];
    const s = getUniverseStats("equity", lonely, "2026-01-02T00:00:00.000Z");
    // A percentile against itself is meaningless, so it is absent, not 50.
    expect(framedPercentile(s, "peer", "forwardPE", "ONLY_REIT")).toBeNull();
    expect(framedPercentile(s, "class", "forwardPE", "ONLY_REIT")).not.toBeNull();
  });
});

describe("per-filter missing-data policy", () => {
  const rows = [
    candidate("HAS", { roic: 20 }),
    candidate("LACKS", { roic: null }),
  ];

  it("excludes unknowns by default, preserving the engine's original rule", () => {
    const f: FilterValues = { roic: { kind: "range", min: 10, max: null } };
    expect(applyFilters(rows, "equity", f).map((c) => c.symbol)).toEqual(["HAS"]);
  });

  it("can be told not to hold a data gap against a name", () => {
    const f: FilterValues = { roic: { kind: "range", min: 10, max: null, missing: "include" } };
    expect(applyFilters(rows, "equity", f).map((c) => c.symbol).sort()).toEqual(["HAS", "LACKS"]);
  });
});

describe("soft preferences", () => {
  const rows = [
    candidate("YIELDY", { overallScore: 50, dividendYield: 8 }),
    candidate("QUALITY", { overallScore: 90, dividendYield: 1 }),
  ];
  const stats = getUniverseStats("equity", rows, "2026-01-03T00:00:00.000Z");

  it("reorders without excluding anything", () => {
    const base = rankAll(rows, "equity", [{ metric: "overallScore", weight: 3 }], stats.classPercentiles);
    expect(base.get("QUALITY")!.rankScore).toBeGreaterThan(base.get("YIELDY")!.rankScore);

    // A strong enough preference for yield flips the ordering — but both names
    // are still present, which a hard filter could never promise.
    const tilted = rankAll(
      rows,
      "equity",
      [{ metric: "overallScore", weight: 3 }, { metric: "dividendYield", weight: 9 }],
      stats.classPercentiles,
    );
    expect(tilted.get("YIELDY")!.rankScore).toBeGreaterThan(tilted.get("QUALITY")!.rankScore);
    expect(tilted.size).toBe(2);
  });

  it("drops preferences that cannot mean anything", () => {
    // Unknown metric, an unavailable one, a directionless one, and junk weights.
    expect(parsePreferences("equity", { nope: 2, marketCap: 3, roic: 0, other: -1 })).toEqual({});
    expect(parsePreferences("equity", { roic: 2 })).toEqual({ roic: 2 });
    // Clamped, so a saved screen can't flatten every other factor into noise.
    expect(parsePreferences("equity", { roic: 1e9 })).toEqual({ roic: 5 });
  });
});

describe("infeasibility diagnosis", () => {
  const rows = [
    candidate("A", { roic: 20, forwardPE: 15 }, { sector: "Technology" }),
    candidate("B", { roic: 18, forwardPE: 40 }, { sector: "Technology" }),
    candidate("C", { roic: 4, forwardPE: 9 }, { sector: "Energy" }),
  ];

  it("names the single binding filter and the threshold that would admit a name", () => {
    // Tech names exist, but none with ROIC ≥ 50.
    const f: FilterValues = {
      sector: { kind: "multiselect", values: ["Technology"] },
      roic: { kind: "range", min: 50, max: null },
    };
    expect(applyFilters(rows, "equity", f)).toHaveLength(0);

    const [worst] = diagnose(rows, "equity", f);
    expect(worst.key).toBe("roic");
    expect(worst.blocks).toBe(2); // A and B clear the sector filter but fail ROIC
    expect(worst.relaxTo).toBe(20); // the best ROIC among them
    expect(worst.bound).toBe("min");
    expect(worst.relaxToIsUniverseWide).toBe(false);
  });

  /**
   * The case a leave-one-out analysis alone gets wrong. Every filter blocks
   * zero, because dropping any one of them still leaves the others excluding
   * everything — so the solo counts have to carry the explanation, and no
   * `relaxTo` may be offered, because relaxing one bound would not help.
   */
  it("makes no false promise when the screen is over-constrained in several places", () => {
    /*
     * Every name is strong on exactly one dimension, so any *pair* of these
     * filters already excludes the whole universe. That is what makes a
     * leave-one-out analysis mute: drop any single filter and the remaining two
     * still return nothing, so every filter truthfully reports blocking zero.
     * The solo counts are the only thing left that can explain it.
     */
    const only = [
      candidate("R1", { roic: 100, grossMargin: 0, dividendYield: 0 }),
      candidate("G1", { roic: 0, grossMargin: 100, dividendYield: 0 }),
      candidate("G2", { roic: 0, grossMargin: 100, dividendYield: 0 }),
      candidate("D1", { roic: 0, grossMargin: 0, dividendYield: 100 }),
      candidate("D2", { roic: 0, grossMargin: 0, dividendYield: 100 }),
      candidate("D3", { roic: 0, grossMargin: 0, dividendYield: 100 }),
    ];
    const f: FilterValues = {
      roic: { kind: "range", min: 50, max: null },
      grossMargin: { kind: "range", min: 50, max: null },
      dividendYield: { kind: "range", min: 50, max: null },
    };
    expect(applyFilters(only, "equity", f)).toHaveLength(0);

    const diags = diagnose(only, "equity", f);
    expect(diags.every((d) => d.blocks === 0)).toBe(true);
    expect(diags.every((d) => d.relaxTo == null)).toBe(true);
    expect(diags.every((d) => d.relaxToIsUniverseWide)).toBe(true);
    // The filter admitting fewest on its own leads, so the user is pointed at
    // the tightest constraint rather than an arbitrary one.
    expect(diags.map((d) => d.key)).toEqual(["roic", "grossMargin", "dividendYield"]);
    expect(diags.map((d) => d.soloSurvivors)).toEqual([1, 2, 3]);
  });
});

describe("binding constraint", () => {
  const rows = [
    candidate("TIGHT", { roic: 12.4, forwardPE: 8 }),
    candidate("COMFORTABLE", { roic: 60, forwardPE: 8 }),
    // Spread the distribution so p90-p10 is meaningful for both metrics.
    candidate("LOW", { roic: 2, forwardPE: 5 }),
    candidate("HIGH", { roic: 80, forwardPE: 60 }),
  ];
  const stats = getUniverseStats("equity", rows, "2026-01-04T00:00:00.000Z");
  const filters: FilterValues = {
    roic: { kind: "range", min: 12, max: null },
    forwardPE: { kind: "range", min: null, max: 25 },
  };

  it("identifies which threshold a row nearly missed", () => {
    const tight = bindingConstraint(rows[0], "equity", filters, stats)!;
    expect(tight.key).toBe("roic");
    expect(tight.slack).toBeLessThan(MARGINAL_SLACK);
  });

  /**
   * Regression: normalising slack by the *threshold* rather than by the metric's
   * spread inverted this answer, reporting a name's most comfortable margin as
   * the one it nearly missed.
   */
  it("does not mistake a wide margin for a narrow one", () => {
    const comfy = bindingConstraint(rows[1], "equity", filters, stats)!;
    expect(comfy.slack).toBeGreaterThan(MARGINAL_SLACK);
  });

  it("is absent when no range filter is active", () => {
    expect(bindingConstraint(rows[0], "equity", {}, stats)).toBeNull();
  });
});
