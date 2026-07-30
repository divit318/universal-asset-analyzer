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

/* -------------------------------------------------------------------------- */
/* Cross-surface identity                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The invariant that failed in production.
 *
 * /research and /compare both call `computeScore`, but `sectorRotation` is an
 * OPT-IN fifth argument ("omit entirely to leave existing callers' output
 * unchanged"). /compare omitted it, so NVDA scored 86 there and 80 on Research —
 * same engine, same company, different inputs, and nothing on either screen to
 * explain the gap.
 *
 * These tests pin the two things that make that impossible to reintroduce
 * silently: that the argument genuinely changes the number (so omitting it is a
 * real divergence, not a no-op), and that identical inputs give identical output.
 */
describe("cross-surface score identity", () => {
  const laggingSector = {
    sector: "Technology",
    etf: "XLK",
    rank: 11,
    totalSectors: 11,
    trend: "lagging",
    relativeStrength: -10.4,
    momentumScore: -10.2,
    oneMonthReturn: -8.9,
  } as unknown as Parameters<typeof computeScore>[4];

  const bullishAnalyst = { strongBuy: 20, buy: 5, upsidePercent: 45, recommendationKey: "strong_buy" };

  it("passing sectorRotation CHANGES the composite — so omitting it is a real divergence", () => {
    const without = computeScore(snap(), null, analyst(bullishAnalyst));
    const withRotation = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector);

    // A lagging sector must drag the score down. If these were ever equal, the
    // argument would be decorative and this whole class of bug impossible — but
    // it is not, which is exactly why every surface must pass it.
    expect(withRotation.composite).not.toBe(without.composite);
    expect(withRotation.composite).toBeLessThan(without.composite);
  });

  it("adds a Sector Rotation bucket only when the argument is supplied", () => {
    const without = computeScore(snap(), null, analyst(bullishAnalyst));
    const withRotation = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector);

    expect(without.buckets.some((b) => b.name === "Sector Rotation")).toBe(false);
    expect(withRotation.buckets.some((b) => b.name === "Sector Rotation")).toBe(true);
  });

  it("treats an explicit null differently from an omitted argument", () => {
    // `null` means "checked, this sector has no rotation entry" and still adds the
    // bucket; `undefined` means "this caller has no rotation data at all". Callers
    // must be able to express the first, which is why /compare passes null rather
    // than defaulting the parameter away.
    const omitted = computeScore(snap(), null, analyst(bullishAnalyst));
    const explicitNull = computeScore(snap(), null, analyst(bullishAnalyst), null, null);

    expect(omitted.buckets.some((b) => b.name === "Sector Rotation")).toBe(false);
    expect(explicitNull.buckets.some((b) => b.name === "Sector Rotation")).toBe(true);
  });

  it("is deterministic: identical inputs produce an identical score everywhere", () => {
    const a = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector, "US");
    const b = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector, "US");

    expect(a.composite).toBe(b.composite);
    expect(a.recommendation).toBe(b.recommendation);
    expect(a.buckets.map((x) => [x.name, x.points])).toEqual(b.buckets.map((x) => [x.name, x.points]));
  });

  it("market weighting changes the blend, so every surface must pass the same market", () => {
    const us = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector, "US");
    const india = computeScore(snap(), null, analyst(bullishAnalyst), null, laggingSector, "IN");

    // India leans harder on fundamentals and much less on analysts, so a
    // strongly-bullish analyst set moves the US score more than the Indian one.
    expect(us.composite).not.toBe(india.composite);
  });
});

/* -------------------------------------------------------------------------- */
/* Score kinds                                                                */
/* -------------------------------------------------------------------------- */

describe("score-kind registry", () => {
  it("gives every kind a distinct, non-generic label", async () => {
    const { SCORE_KINDS } = await import("@/lib/score-kinds");
    const labels = Object.values(SCORE_KINDS).map((k) => k.label);

    expect(new Set(labels).size).toBe(labels.length);
    // "Score" and "Overall" are exactly the wordless labels that made two
    // different engines' outputs look like a contradiction.
    for (const label of labels) {
      expect(label).not.toBe("Score");
      expect(label).not.toBe("Overall");
    }
  });

  it("states a question and an engine for every kind", async () => {
    const { SCORE_KINDS } = await import("@/lib/score-kinds");
    for (const kind of Object.values(SCORE_KINDS)) {
      expect(kind.question.endsWith("?")).toBe(true);
      expect(kind.engine.length).toBeGreaterThan(0);
      expect(kind.inputs.length).toBeGreaterThan(20);
    }
  });

  it("bands only the kinds that are actually directional calls", async () => {
    const { SCORE_KINDS } = await import("@/lib/score-kinds");

    // These answer "should I own this?" — a Buy/Hold/Sell label is meaningful.
    expect(SCORE_KINDS.conviction.banded).toBe(true);
    expect(SCORE_KINDS.screen.banded).toBe(true);
    expect(SCORE_KINDS.quant.banded).toBe(true);

    // These do not. Colouring a portfolio fit of 45 as "Sell" would assert
    // something the number never measured.
    expect(SCORE_KINDS.fit.banded).toBe(false);
    expect(SCORE_KINDS.quality.banded).toBe(false);
    expect(SCORE_KINDS.health.banded).toBe(false);
  });

  it("distinguishes two kinds without claiming either is wrong", async () => {
    const { distinguish } = await import("@/lib/score-kinds");
    const text = distinguish("conviction", "quality");

    expect(text).toContain("Conviction");
    expect(text).toContain("Quality");
    expect(text).toContain("can disagree");
  });
});
