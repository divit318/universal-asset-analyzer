/**
 * Scoring consistency contract.
 *
 * UAA intentionally runs two purpose-built scorers — `lib/composite.ts` (batch
 * screen) and `lib/scoring.ts` (single-name decision engine). They read
 * different data and produce different numbers by design. What they must NOT do
 * is interpret the *same* score differently: a 72 has to mean "Buy" whether it
 * is shown on the Screener or the research Score Card. This suite locks the
 * shared decision/label layer that guarantees that, and the shared math
 * primitive both engines normalize with.
 */

import { describe, it, expect } from "vitest";
import { lerp, norm } from "@/lib/score-math";
import { computeScore } from "@/lib/scoring";
import {
  TIER_EDGES,
  scoreToRecommendation,
  scoreLabel,
  scoreTone,
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
} from "@/lib/recommendation";
import type { AnalystConsensus, FundamentalsSnapshot, Recommendation } from "@/lib/types";

const snap = (o: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot =>
  ({ sector: null, ...o }) as unknown as FundamentalsSnapshot;

const analyst = (o: Partial<AnalystConsensus> = {}): AnalystConsensus =>
  ({
    strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0,
    upsidePercent: null, recommendationKey: null,
    epsRevisionsUp30d: null, epsRevisionsDown30d: null,
    ...o,
  }) as unknown as AnalystConsensus;

describe("score-math primitive", () => {
  it("norm equals lerp(_, _, _, 100) for present values", () => {
    for (const [v, w, b] of [
      [15, 40, 8],
      [0.25, 0.05, 0.3],
      [-10, -25, 40],
    ] as const) {
      expect(norm(v, w, b)).toBe(lerp(v, w, b, 100));
    }
  });

  it("clamps to the [0, max] range and honors inverted (lower-is-better) scales", () => {
    expect(lerp(100, 40, 8, 100)).toBe(0); // worse than 'worst' → 0
    expect(lerp(8, 40, 8, 100)).toBe(100); // at 'best' → max
    expect(norm(null, 0, 1)).toBeNull();
    expect(norm(Number.NaN, 0, 1)).toBeNull();
  });
});

describe("canonical recommendation bands", () => {
  it("is monotonic non-increasing in tier as the score falls", () => {
    const order: Recommendation[] = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];
    let prev = 0;
    for (let s = 100; s >= 0; s--) {
      const idx = order.indexOf(scoreToRecommendation(s));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("places the tier boundaries exactly", () => {
    expect(scoreToRecommendation(78)).toBe("STRONG_BUY");
    expect(scoreToRecommendation(77)).toBe("BUY");
    expect(scoreToRecommendation(60)).toBe("BUY");
    expect(scoreToRecommendation(59)).toBe("HOLD");
    expect(scoreToRecommendation(42)).toBe("HOLD");
    expect(scoreToRecommendation(41)).toBe("SELL");
    expect(scoreToRecommendation(25)).toBe("SELL");
    expect(scoreToRecommendation(24)).toBe("STRONG_SELL");
  });

  it("covers the whole 0–100 range with a label and a tone", () => {
    for (let s = 0; s <= 100; s++) {
      expect(scoreLabel(s)).toBeTruthy();
      expect(scoreTone(s)).toBeTruthy();
    }
  });

  it("TIER_EDGES match the band function's breakpoints", () => {
    for (const edge of TIER_EDGES) {
      // At an edge the tier must differ from just below it.
      expect(scoreToRecommendation(edge)).not.toBe(scoreToRecommendation(edge - 1));
    }
  });

  it("label and tone maps are total over Recommendation", () => {
    const recs: Recommendation[] = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];
    for (const r of recs) {
      expect(RECOMMENDATION_LABEL[r]).toBeTruthy();
      expect(RECOMMENDATION_TONE[r]).toBeTruthy();
    }
  });
});

describe("engines route through the canonical bands", () => {
  it("scoring.ts's decision recommendation is always scoreToRecommendation(composite)", () => {
    // Drive the real decision engine across bullish → bearish inputs and assert
    // its recommendation is exactly the canonical mapping of its composite — so a
    // reintroduced private band table in scoring.ts fails CI.
    const cases: [Partial<FundamentalsSnapshot>, Partial<AnalystConsensus>][] = [
      [{}, {}], // sparse → mid
      [{}, { strongBuy: 20, buy: 5, upsidePercent: 45, recommendationKey: "strong_buy" }], // bullish
      [{}, { sell: 8, strongSell: 6, upsidePercent: -30, recommendationKey: "strong_sell" }], // bearish
    ];
    for (const [s, a] of cases) {
      const r = computeScore(snap(s), null, analyst(a));
      expect(r.recommendation).toBe(scoreToRecommendation(r.composite));
    }
  });
});
