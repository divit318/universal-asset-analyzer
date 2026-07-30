import { describe, it, expect } from "vitest";
import { bestIndex, flatFromStreamedFields, parseCompareResponse } from "@/lib/ai-compare";

/**
 * Unit tests for the N-way metric table winner logic in ai-compare — the
 * same `bestIndex` the real buildMetricTable() uses, exercised directly
 * (pure, no network) so this stays a real regression test rather than a
 * disconnected duplicate of the comparison rules.
 */

describe("bestIndex — higher is better (e.g. ROE, composite score)", () => {
  it("picks the single best value among many", () => {
    expect(bestIndex([25, 15, 40, 10], true)).toBe(2);
  });

  it("returns 'tie' when the top values are within 5% of each other", () => {
    expect(bestIndex([100, 103, 50], true)).toBe("tie");
  });

  it("skips nulls and still finds the best among the rest", () => {
    expect(bestIndex([null, 30, null, 20], true)).toBe(1);
  });

  it("returns null when every value is null", () => {
    expect(bestIndex([null, null, null], true)).toBeNull();
  });

  it("handles exactly two values, same as the old pairwise comparison", () => {
    expect(bestIndex([25, 15], true)).toBe(0);
    expect(bestIndex([15, 25], true)).toBe(1);
  });
});

describe("bestIndex — lower is better (e.g. P/E, D/E)", () => {
  it("picks the single lowest value among many", () => {
    expect(bestIndex([15, 39, 70, 21], false)).toBe(0);
  });

  it("returns 'tie' when the lowest values are within 5% of each other", () => {
    expect(bestIndex([10, 10.4, 50], false)).toBe("tie");
  });

  it("a lone non-null value wins outright, regardless of magnitude", () => {
    expect(bestIndex([null, 9.6, null], false)).toBe(1);
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
