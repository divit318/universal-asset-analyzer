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

import { describe, it, expect, expectTypeOf } from "vitest";
import { lerp, norm } from "@/lib/score-math";
import { computeScore } from "@/lib/scoring";
import {
  TIER_EDGES,
  scoreToRecommendation,
  scoreLabel,
  scoreTone,
  scoreGrade,
  scoreStep,
  scoreMeterTone,
  scoreArgb,
  scoreToOpportunityVerdict,
  scoreDirection,
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
  RECOMMENDATION_ARGB,
  SCORE_GRADE_LABEL,
  OPPORTUNITY_VERDICT,
  OPPORTUNITY_VERDICT_ORDER,
  SCORING_METHODOLOGY_VERSION,
} from "@/lib/recommendation";
import type {
  AnalystConsensus,
  FundamentalsSnapshot,
  Recommendation,
  StockFundamentals,
  StockMetrics,
} from "@/lib/types";

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
/* Derived vocabularies — one band table, many words                          */
/* -------------------------------------------------------------------------- */

describe("derived vocabularies stay glued to the canonical bands", () => {
  it("grade words are total, distinct, and flip exactly at the tier edges", () => {
    const recs: Recommendation[] = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"];
    expect(new Set(recs.map((r) => SCORE_GRADE_LABEL[r])).size).toBe(recs.length);
    for (let s = 0; s <= 100; s++) {
      expect(scoreGrade(s)).toBe(SCORE_GRADE_LABEL[scoreToRecommendation(s)]);
    }
    for (const edge of TIER_EDGES) {
      expect(scoreGrade(edge)).not.toBe(scoreGrade(edge - 1));
    }
  });

  it("opportunity verdicts are total, ordered worst→best, and flip exactly at the tier edges", () => {
    // The Scanner previously banded at 75/60/45 and Thematic at 80/65/50/35 —
    // the same word over two different score ranges. Both engines now call
    // scoreToOpportunityVerdict, so this is the only mapping that can exist.
    const recs: Recommendation[] = ["STRONG_SELL", "SELL", "HOLD", "BUY", "STRONG_BUY"];
    expect(recs.map((r) => OPPORTUNITY_VERDICT[r])).toEqual(OPPORTUNITY_VERDICT_ORDER);
    for (let s = 0; s <= 100; s++) {
      expect(scoreToOpportunityVerdict(s)).toBe(OPPORTUNITY_VERDICT[scoreToRecommendation(s)]);
    }
    expect(scoreToOpportunityVerdict(78)).toBe("exceptional");
    expect(scoreToOpportunityVerdict(77)).toBe("strong");
    expect(scoreToOpportunityVerdict(60)).toBe("strong");
    expect(scoreToOpportunityVerdict(59)).toBe("moderate");
    expect(scoreToOpportunityVerdict(42)).toBe("moderate");
    expect(scoreToOpportunityVerdict(41)).toBe("weak");
    expect(scoreToOpportunityVerdict(25)).toBe("weak");
    expect(scoreToOpportunityVerdict(24)).toBe("avoid");
  });

  it("the 3-step meter grammar agrees with the bands and with scoreDirection", () => {
    for (let s = 0; s <= 100; s++) {
      const step = scoreStep(s);
      const dir = scoreDirection(s);
      // A bar can never be green while the badge is Hold/Sell, and vice versa.
      expect(step === "high").toBe(dir === "bullish");
      expect(step === "mid").toBe(dir === "neutral");
      expect(step === "low").toBe(dir === "bearish");
      // The tone classes are the step, expressed as classes.
      const tone = scoreMeterTone(s);
      expect(tone.text).toBe(step === "high" ? "text-positive" : step === "mid" ? "text-warning" : "text-negative");
      expect(tone.bar).toBe(step === "high" ? "bg-positive" : step === "mid" ? "bg-warning" : "bg-negative");
    }
  });

  it("export ARGB colors follow the same steps, and tiers map to the same palette", () => {
    for (let s = 0; s <= 100; s++) {
      expect(scoreArgb(s)).toEqual(RECOMMENDATION_ARGB[scoreToRecommendation(s)]);
    }
    // Missing data is visually distinct from every scored step.
    const missing = scoreArgb(null);
    for (let s = 0; s <= 100; s++) expect(scoreArgb(s)).not.toEqual(missing);
  });

  it("names a methodology version for artifacts that outlive the UI", () => {
    expect(SCORING_METHODOLOGY_VERSION).toMatch(/^\d{4}-\d{2}\.\d+$/);
  });
});

/* -------------------------------------------------------------------------- */
/* fundamentals_cache stores inputs, never scores                             */
/* -------------------------------------------------------------------------- */

/**
 * The decision NOT to methodology-version fundamentals_cache (2026-08-17
 * follow-up, ruling 1) rests on exactly one invariant: the cached shape,
 * StockFundamentals, carries RAW INPUTS only — scores are recomputed after
 * the live-price merge on every read (lib/dataset.ts assembleMetrics). These
 * are compile-time assertions: if anyone re-adds a score-shaped field to the
 * cached type, `tsc --noEmit` fails and the versioning decision must be
 * revisited.
 */
describe("fundamentals cache shape (type-level)", () => {
  it("StockFundamentals carries no score-shaped field", () => {
    expectTypeOf<StockFundamentals>().not.toHaveProperty("scores");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("score");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("composite");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("overall");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("recommendation");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("verdict");
    expectTypeOf<StockFundamentals>().not.toHaveProperty("rankScore");
  });

  it("the Omit is doing real work — the un-cached StockMetrics DOES carry scores", () => {
    // If StockMetrics ever loses `scores`, the Omit in StockFundamentals
    // becomes vacuous and this whole invariant silently stops meaning anything.
    expectTypeOf<StockMetrics>().toHaveProperty("scores");
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
    expect(SCORE_KINDS.alignment.banded).toBe(false);
  });

  it("distinguishes two kinds without claiming either is wrong", async () => {
    const { distinguish } = await import("@/lib/score-kinds");
    const text = distinguish("conviction", "quality");

    expect(text).toContain("Conviction");
    expect(text).toContain("Quality");
    expect(text).toContain("can disagree");
  });
});
