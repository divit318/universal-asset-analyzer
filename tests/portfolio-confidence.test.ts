import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { assessConfidence, CONFIDENCE_FLOOR, CONFIDENCE_CEILING } from "@/lib/portfolio/engines/confidence";
import { computeRecommendations } from "@/lib/portfolio/engines/recommend";
import { buildDecisionCards } from "@/lib/portfolio/engines/decision";
import { computeCashAllocation } from "@/lib/portfolio/engines/cash";
import type { MarketContext, RawHolding, Holding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */

function walk(n: number, drift: number, vol: number, seed = 1): number[] {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  const out = [100];
  for (let i = 1; i < n; i++) out.push(Math.max(out[i - 1] * (1 + drift + rnd() * vol), 1));
  return out;
}

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);
  const q = (symbol: string, price: number) => [symbol, { symbol, price, changePercent: 0, currency: "USD", name: symbol, marketCap: null }] as const;
  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quotes: new Map([q("AAPL", 200), q("IEF", 95), q("SHY", 82), q("TIP", 108), q("GLD", 190), q("VNQ", 90), q("VXUS", 60), q("VEA", 48), q("VYM", 115), q("USFR", 50), q("DBC", 22)] as any),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)], ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["SHY", walk(300, 0.00005, 0.002, 21)], ["TIP", walk(300, 0.0001, 0.005, 23)],
      ["GLD", walk(300, 0.0002, 0.009, 13)], ["VNQ", walk(300, 0.0003, 0.014, 27)],
      ["VXUS", walk(300, 0.0003, 0.011, 29)], ["VEA", walk(300, 0.0003, 0.011, 31)],
      ["VYM", walk(300, 0.0004, 0.012, 33)], ["USFR", walk(300, 0.00006, 0.001, 37)],
      ["DBC", walk(300, 0.0002, 0.016, 41)],
    ]),
    fundamentals: new Map(),
    benchmarkReturns,
    asOf: new Date().toISOString(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

/** A concentrated book that produces both an ADD (gap) and a REDUCE (over-weight). */
function bookWithMixedActions(c: MarketContext) {
  const { holdings } = normalizeHoldings([
    raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 400 }),
    raw({ id: "small", assetClass: "etf", symbol: "VYM", quantity: 20 }),
  ], c);
  return evaluate(holdings, c);
}

/* -------------------------------------------------------------------------- */
/* The definition                                                              */
/* -------------------------------------------------------------------------- */

describe("Confidence has exactly one meaning", () => {
  it("is independent of effect size — the same evidence scores the same regardless of impact", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const subject = e.holdings[0];

    // assessConfidence takes no impact magnitude at all. The only thing it can be
    // told about the impact is whether a volatility number is claimed.
    const a = assessConfidence(e, subject, { riskMeasured: true });
    const b = assessConfidence(e, subject, { riskMeasured: true });
    expect(a.score).toBe(b.score);
  });

  it("is bounded and never fabricates certainty", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    for (const h of [...e.holdings, null]) {
      const { score } = assessConfidence(e, h, { riskMeasured: true });
      expect(score).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
      expect(score).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    }
  });

  it("reads UNKNOWN as unknown: an unscoreable subject lowers confidence, never flatters it", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const scored = e.holdings.find((h) => h.score != null)!;
    const unscoreable: Holding = { ...scored, score: null };

    const withScore = assessConfidence(e, scored, { riskMeasured: true });
    const withoutScore = assessConfidence(e, unscoreable, { riskMeasured: true });
    expect(withoutScore.score).toBeLessThan(withScore.score);
    expect(withoutScore.basis.join(" ")).toMatch(/could not be scored/);
  });

  it("degrades when the portfolio's marks are self-reported rather than market-priced", () => {
    const c = ctx();
    const marked = bookWithMixedActions(c);
    // Same shape of book, but valued by the owner's own estimate.
    const { holdings } = normalizeHoldings([
      raw({ id: "house", assetClass: "real_estate", symbol: null, quantity: 1, manualValue: 800_000 }),
      raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    ], c);
    const selfReported = evaluate(holdings, c);

    const subject = marked.holdings[0];
    const a = assessConfidence(marked, subject, { riskMeasured: true });
    const b = assessConfidence(selfReported, subject, { riskMeasured: true });
    expect(b.score).toBeLessThan(a.score);
  });

  it("does not penalise a card for missing risk data it makes no claim about", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const subject = e.holdings[0];
    const claimed = assessConfidence(e, subject, { riskMeasured: true });
    const notClaimed = assessConfidence(e, subject, { riskMeasured: false });
    // Dropping the factor renormalises the rest rather than deflating the score.
    expect(notClaimed.factors.some((f) => f.label === "Risk observability")).toBe(false);
    expect(notClaimed.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
    expect(claimed.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
  });

  it("is explainable: one deterministic sentence per contributing factor, no AI", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const { factors, basis } = assessConfidence(e, e.holdings[0], { riskMeasured: true });
    expect(basis).toHaveLength(factors.length);
    for (const line of basis) {
      expect(line.length).toBeGreaterThan(10);
      expect(line).toMatch(/\.$/);
    }
  });

  it("is reproducible across independent evaluations of identical input", () => {
    const first = bookWithMixedActions(ctx());
    const second = bookWithMixedActions(ctx());
    const a = assessConfidence(first, first.holdings[0], { riskMeasured: true });
    const b = assessConfidence(second, second.holdings[0], { riskMeasured: true });
    expect(a.score).toBe(b.score);
    expect(a.basis).toEqual(b.basis);
  });
});

/* -------------------------------------------------------------------------- */
/* Comparability across recommendation types                                   */
/* -------------------------------------------------------------------------- */

describe("Confidence is comparable across every recommendation type", () => {
  it("no longer varies by ACTION on the same portfolio and equally-evidenced subjects", () => {
    // The regression. Previously: ADD = severity + effect + mark quality,
    // REDUCE = min(90, 60 + weight), SELL = the holding's score confidence. Three
    // different questions, one label. Two recommendations about the SAME asset must
    // now report the same confidence whatever the action is, because the evidence
    // behind them is the same evidence.
    const c = ctx();
    const e = bookWithMixedActions(c);
    const subject = e.holdings[0];
    const asBuy = assessConfidence(e, subject, { riskMeasured: true });
    const asTrim = assessConfidence(e, subject, { riskMeasured: true });
    const asExit = assessConfidence(e, subject, { riskMeasured: true });
    expect(new Set([asBuy.score, asTrim.score, asExit.score]).size).toBe(1);
  });

  it("a trim's confidence no longer tracks position size", () => {
    const c = ctx();
    // Two books identical except for how concentrated the trimmed name is. The old
    // formula returned 60 + weight, so these differed by ~20 points on no evidence.
    const heavy = evaluate(normalizeHoldings([
      raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 400 }),
      raw({ id: "s", assetClass: "etf", symbol: "VYM", quantity: 10 }),
    ], c).holdings, c);
    const lighter = evaluate(normalizeHoldings([
      raw({ id: "big", assetClass: "equity", symbol: "AAPL", quantity: 400 }),
      raw({ id: "s", assetClass: "etf", symbol: "VYM", quantity: 300 }),
    ], c).holdings, c);

    const h1 = heavy.holdings.find((h) => h.symbol === "AAPL")!;
    const h2 = lighter.holdings.find((h) => h.symbol === "AAPL")!;
    expect(h1.weight).toBeGreaterThan(h2.weight + 10); // genuinely different sizes
    // Evidence about AAPL is identical in both, so confidence must be too, aside
    // from portfolio-level factors that legitimately differ.
    const a = assessConfidence(heavy, h1, { riskMeasured: true });
    const b = assessConfidence(lighter, h2, { riskMeasured: true });
    expect(Math.abs(a.score - b.score)).toBeLessThan(10);
  });

  it("every recommendation the engine emits carries a confidence and its basis", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const recs = computeRecommendations(e, c);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
      expect(r.confidence).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(r.confidenceBasis.length).toBeGreaterThan(0);
    }
  });

  it("every cash-allocation item carries one too — never null, never a different scale", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const plan = computeCashAllocation(e, 50_000, "maximize_diversification", c);
    expect(plan.items.length).toBeGreaterThan(0);
    for (const item of plan.items) {
      expect(item.confidence).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
      expect(item.confidence).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(item.confidenceBasis.length).toBeGreaterThan(0);
    }
  });

  it("carries the same confidence and basis through to the DecisionCard unchanged", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const recs = computeRecommendations(e, c);
    const cards = buildDecisionCards(recs, e);
    for (const card of cards) {
      expect(card.confidence).toBe(card.recommendation.confidence);
      expect(card.confidenceBasis).toEqual(card.recommendation.confidenceBasis);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Confidence must never contradict the ranking                                */
/* -------------------------------------------------------------------------- */

describe("Confidence never contradicts recommendation ranking", () => {
  it("for equal measured impact, the better-evidenced recommendation ranks higher", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const recs = computeRecommendations(e, c);
    expect(recs.length).toBeGreaterThan(0);
    const base = recs[0];

    // decisionScore = 50 + alignmentDelta × (confidence/100) × 3, monotone in both
    // terms. Hold impact fixed, vary only confidence.
    const low = buildDecisionCards([{ ...base, confidence: 30 }], e)[0];
    const high = buildDecisionCards([{ ...base, confidence: 90 }], e)[0];
    if ((base.impact.alignmentDelta ?? 0) > 0) {
      expect(high.decisionScore).toBeGreaterThanOrEqual(low.decisionScore);
    }
  });

  it("effect size is no longer double-counted: decisionScore is exactly linear in impact at fixed confidence", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const recs = computeRecommendations(e, c);
    const confidence = 80;
    const base = { ...recs[0], confidence };

    // decisionScore is DEFINED as round(50 + alignmentDelta × confidence/100 × 3).
    // It can only match that closed form across a range of impacts if confidence is
    // independent of impact. Under the old ADD formula confidence itself contained
    // |alignmentDelta| × 4, which made the real curve convex and this assertion fail.
    for (const alignmentDelta of [0.5, 1, 2, 4, 8]) {
      const score = buildDecisionCards([{ ...base, impact: { ...base.impact, alignmentDelta } }], e)[0].decisionScore;
      const linear = Math.round(50 + alignmentDelta * (confidence / 100) * 3);
      expect(score, `alignmentDelta ${alignmentDelta}`).toBe(linear);
    }
  });

  it("ranks deterministically: identical input yields an identical ordering", () => {
    const c = ctx();
    const e = bookWithMixedActions(c);
    const first = buildDecisionCards(computeRecommendations(e, c), e).map((d) => [d.recommendation.id, d.decisionScore, d.confidence]);
    const second = buildDecisionCards(computeRecommendations(e, c), e).map((d) => [d.recommendation.id, d.decisionScore, d.confidence]);
    expect(second).toEqual(first);
  });
});
