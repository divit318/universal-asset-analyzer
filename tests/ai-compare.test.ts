import { describe, it, expect } from "vitest";
import { bestIndex, flatFromStreamedFields, parseCompareResponse } from "@/lib/ai-compare";

/**
 * Unit tests for the N-way metric table winner logic in ai-compare — the
 * same `bestIndex` the real buildMetricTable() uses, exercised directly
 * (pure, no network). Since the resolver rewrite, bestIndex is a wrapper
 * over lib/compare/metrics.ts's resolveRowHighlights, so these assert the
 * AI table's winners match the rendered table's rules exactly: ties at
 * display precision mark EVERY tied index, and a row with no contest
 * (fewer than two values, or all identical on screen) has no winner.
 */

const x1 = (v: number) => `${v.toFixed(1)}x`;

describe("bestIndex — higher is better (e.g. ROE, composite score)", () => {
  it("picks the single best value among many", () => {
    expect(bestIndex([25, 15, 40, 10], true)).toEqual([2]);
  });

  it("marks EVERY value tied at the top (display precision), not none of them", () => {
    expect(bestIndex([10.44, 10.4, 50], false, x1)).toEqual([0, 1]);
  });

  it("close-but-distinct top values are a real win, not a tie (103 beats 100)", () => {
    expect(bestIndex([100, 103, 50], true)).toEqual([1]);
  });

  it("skips nulls and still finds the best among the rest", () => {
    expect(bestIndex([null, 30, null, 20], true)).toEqual([1]);
  });

  it("returns null when every value is null", () => {
    expect(bestIndex([null, null, null], true)).toBeNull();
  });

  it("handles exactly two values, same as the old pairwise comparison", () => {
    expect(bestIndex([25, 15], true)).toEqual([0]);
    expect(bestIndex([15, 25], true)).toEqual([1]);
  });
});

describe("bestIndex — lower is better (e.g. P/E, D/E)", () => {
  it("picks the single lowest value among many", () => {
    expect(bestIndex([15, 39, 70, 21], false)).toEqual([0]);
  });

  it("all-identical values have no winner, matching a row with no highlight", () => {
    expect(bestIndex([10, 10, 10], false)).toBeNull();
  });

  it("a lone non-null value has no contest, matching the table's no-highlight rule", () => {
    expect(bestIndex([null, 9.6, null], false)).toBeNull();
  });
});

describe("parseCompareResponse", () => {
  it("fills omitted fields with '' on a valid-but-incomplete parse", () => {
    const raw = '{"overview":"AAPL leads on growth.","tradeoffSummary":"AAPL is ahead on growth."}';
    const flat = parseCompareResponse(raw);
    expect(flat.overview).toBe("AAPL leads on growth.");
    expect(flat.valuation).toBe("");
    expect(flat.tradeoffSummary).toBe("AAPL is ahead on growth.");
  });

  it("keeps a well-formed rankings array", () => {
    const raw = '{"rankings":[{"rank":1,"symbol":"AAPL","thesis":"cheap growth","strengths":["low P/E"],"weaknesses":["slowing margins"],"bestFor":"value investors"}]}';
    const flat = parseCompareResponse(raw);
    expect(flat.rankings).toHaveLength(1);
  });

  it("falls back to an empty rankings array when the model omits it", () => {
    const flat = parseCompareResponse('{"overview":"ok"}');
    expect(flat.rankings).toEqual([]);
  });

  it("drops a non-object 'sections' field instead of letting it leak through", () => {
    const raw = '{"overview":"ok","sections":"not an object"}';
    const flat = parseCompareResponse(raw);
    expect(flat.sections).toBeUndefined();
  });

  it("returns all-empty defaults on total garbage instead of throwing", () => {
    const flat = parseCompareResponse("the model refused to answer");
    expect(flat.overview).toBe("");
    expect(flat.rankings).toEqual([]);
    expect(flat.noClearWinner).toBe(false);
  });
});

/**
 * `flatFromStreamedFields` is the streaming path's counterpart to
 * `parseCompareResponse` — same defaults, same "sections" guard — so
 * `finalizeComparison` (shared by both `compareStocks` and
 * `streamComparisonFields`) never has to special-case which path produced
 * its `FlatAI`. These mirror the `parseCompareResponse` tests above with
 * pre-parsed fields (what a `JsonFieldStreamer` actually hands back) instead
 * of a raw JSON string.
 */
describe("flatFromStreamedFields", () => {
  it("fills omitted fields with the same defaults parseCompareResponse uses", () => {
    const flat = flatFromStreamedFields({ overview: "AAPL leads on growth.", tradeoffSummary: "AAPL is ahead on growth." });
    expect(flat.overview).toBe("AAPL leads on growth.");
    expect(flat.valuation).toBe("");
    expect(flat.tradeoffSummary).toBe("AAPL is ahead on growth.");
    expect(flat.rankings).toEqual([]);
    expect(flat.noClearWinner).toBe(false);
  });

  it("keeps a well-formed rankings array", () => {
    const flat = flatFromStreamedFields({
      rankings: [{ rank: 1, symbol: "AAPL", thesis: "cheap growth", strengths: ["low P/E"], weaknesses: ["slowing margins"], bestFor: "value investors" }],
    });
    expect(flat.rankings).toHaveLength(1);
  });

  it("drops a non-object 'sections' field instead of letting it leak through", () => {
    const flat = flatFromStreamedFields({ overview: "ok", sections: "not an object" });
    expect(flat.sections).toBeUndefined();
  });

  it("returns all-empty defaults when nothing has streamed yet", () => {
    const flat = flatFromStreamedFields({});
    expect(flat.overview).toBe("");
    expect(flat.rankings).toEqual([]);
    expect(flat.noClearWinner).toBe(false);
  });

  it("agrees with parseCompareResponse on an equivalent complete payload", () => {
    const payload = {
      overview: "ok", valuation: "cheap", quality: "high", growth: "fast",
      financialHealth: "solid", momentum: "strong", verdict: "buy",
      capitalAllocation: "disciplined", competitivePositioning: "leader",
      riskComparison: "low", rankings: [], noClearWinner: false,
      tradeoffSummary: "none", executiveSummary: "summary",
      conditionsForChange: "nothing", confidenceScore: 80,
    };
    const fromRaw = parseCompareResponse(JSON.stringify(payload));
    const fromStreamed = flatFromStreamedFields(payload);
    expect(fromStreamed).toEqual(fromRaw);
  });
});
