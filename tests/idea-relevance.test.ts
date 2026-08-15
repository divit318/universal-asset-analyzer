/**
 * The Idea Decision Engine (lib/portfolio/engines/idea-relevance.ts).
 *
 * What is pinned here is the set of properties that make the Watchlist a
 * decision surface rather than a list: the ordering is by impact and not by
 * score, an unassessable idea never outranks an evidenced one, the trade
 * engine wins any overlap, every card answers all five questions, and
 * identical inputs produce byte-identical output.
 *
 * Rows are built through the REAL derivation chain (deriveWorkflow →
 * toIdeaRow), so these tests also pin that a verdict can never contradict the
 * evidence — the old board's "hasn't been researched" bug class.
 */
import { describe, expect, it } from "vitest";
import {
  buildIdeaAssessments,
  impactOf,
  movablePct,
  EMPTY_IDEA_CONTEXT,
  type IdeaPortfolioContext,
  type LinkedTrade,
} from "../lib/portfolio/engines/idea-relevance";
import { deriveWorkflow, EMPTY_EVIDENCE, type IdeaEvidence } from "../lib/ideas/evidence";
import { toIdeaRow } from "../lib/ideas/rows";
import { describeOrigin } from "../lib/idea-source";
import type { PortfolioFitAnalysis, FitTier } from "../lib/ios/types";
import type { WatchlistItem } from "../lib/types";

const NOW = Date.parse("2026-07-29T00:00:00Z");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const dim = (
  label: string,
  score: number,
  weight: number,
  impact: "positive" | "neutral" | "negative",
  message: string,
  confidence = 1,
) => ({ label, score, weight, impact, message, confidence });

function fit(over: Partial<PortfolioFitAnalysis> & { symbol: string }): PortfolioFitAnalysis {
  const score = over.fitScore ?? 70;
  const tier: FitTier =
    over.fitTier ?? (score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 45 ? "neutral" : "poor");
  return {
    symbol: over.symbol,
    fitScore: score,
    fitTier: tier,
    researchScore: over.researchScore ?? null,
    portfolioEffectsScore: over.portfolioEffectsScore ?? score,
    action: over.action ?? { kind: "initiate", sizeFactor: 1, reason: "fixture" },
    bridge: over.bridge ?? [],
    confidence: over.confidence ?? 80,
    capReason: over.capReason ?? null,
    dimensions: over.dimensions ?? {
      sector: dim("Sector gap", 82, 0.22, "positive", "Portfolio holds no Healthcare exposure"),
      correlation: dim("Overlap", 60, 0.18, "neutral", "Moderate overlap with existing names"),
      objective: dim("Objective", 74, 0.24, "positive", "Matches a maximize-Sharpe objective"),
      style: dim("Style", 50, 0.1, "neutral", "No style gap filled"),
      geographic: dim("Geography", 40, 0.08, "negative", "Adds to an already US-heavy book"),
      sizing: dim("Sizing", 70, 0.18, "positive", "3.0% allocation fits comfortably within your limits"),
    },
    reasons: over.reasons ?? ["Fills a sector the portfolio has no exposure to", "Aligns with the stated objective"],
    tradeoffs: over.tradeoffs ?? ["Increases US concentration"],
    suggestedAllocationPct: over.suggestedAllocationPct ?? 3,
    suggestedAmount: over.suggestedAmount ?? 30_000,
    projectedHHI: over.projectedHHI ?? 3_300,
    concentrationWarning: over.concentrationWarning ?? false,
    isInPortfolio: over.isInPortfolio ?? false,
    isOnWatchlist: over.isOnWatchlist ?? true,
    isGeneric: over.isGeneric ?? false,
  };
}

interface IdeaFixture {
  item: WatchlistItem;
  held?: boolean;
  evidence?: Partial<IdeaEvidence>;
}

const idea = (over: Partial<WatchlistItem> & { symbol: string }): WatchlistItem => ({
  name: over.symbol,
  addedAt: "2026-07-01T00:00:00Z",
  targetPrice: null,
  targetDirection: null,
  alertPctDrop: null,
  notes: null,
  buyTrigger: null,
  sellTrigger: null,
  conviction: null,
  horizon: null,
  lastReviewedAt: null,
  lastResearchedAt: null,
  stage: "surfaced",
  stageChangedAt: null,
  source: null,
  sourceDetail: null,
  ...over,
});

/** Rows through the real chain: evidence → workflow → engine row. */
function rowsFor(fixtures: IdeaFixture[]) {
  return fixtures.map(({ item, held = false, evidence }) => {
    const ev = { ...EMPTY_EVIDENCE, ...evidence };
    return toIdeaRow(item, {
      workflow: deriveWorkflow({ held, stage: item.stage, item, evidence: ev }),
      evidence: ev,
      held,
      now: NOW,
    });
  });
}

const context = (over: Partial<IdeaPortfolioContext> = {}): IdeaPortfolioContext => ({
  ...EMPTY_IDEA_CONTEXT,
  hasPortfolio: true,
  totalValue: 1_000_000,
  positionHhi: 3_440,
  alignmentScore: 75,
  weights: new Map(),
  sectors: new Map(),
  trades: new Map(),
  ...over,
});

/* ------------------------------------------------------------------ */
/* Impact                                                             */
/* ------------------------------------------------------------------ */

describe("impact", () => {
  it("is the suggested allocation for a name you don't hold", () => {
    expect(movablePct(fit({ symbol: "X", suggestedAllocationPct: 4 }), null)).toBe(4);
  });

  it("is the DISTANCE to the suggestion for a name you do hold", () => {
    // An oversized position is a live decision; its suggestion alone understates it.
    expect(movablePct(fit({ symbol: "X", suggestedAllocationPct: 3 }), 8)).toBe(5);
    expect(movablePct(fit({ symbol: "X", suggestedAllocationPct: 3 }), 1)).toBe(2);
  });

  it("discounts by fit and by evidence, multiplicatively", () => {
    const f = fit({ symbol: "X", suggestedAllocationPct: 10, fitScore: 50, confidence: 50 });
    // 10 × 0.5 × 0.5
    expect(impactOf(f, null)).toBe(2.5);
  });

  it("ranks a smaller, better-fitting idea BELOW a larger, worse-fitting one", () => {
    const small = fit({ symbol: "SMALL", suggestedAllocationPct: 0.5, fitScore: 92, confidence: 100 });
    const large = fit({ symbol: "LARGE", suggestedAllocationPct: 5, fitScore: 71, confidence: 100 });
    expect(impactOf(large, null)).toBeGreaterThan(impactOf(small, null));
  });
});

/* ------------------------------------------------------------------ */
/* Ordering                                                           */
/* ------------------------------------------------------------------ */

describe("ordering", () => {
  const rows = rowsFor([{ item: idea({ symbol: "AAA" }) }, { item: idea({ symbol: "BBB" }) }, { item: idea({ symbol: "CCC" }) }]);

  it("ranks by impact, not by fit score", () => {
    const fits = new Map([
      ["AAA", fit({ symbol: "AAA", fitScore: 95, suggestedAllocationPct: 0.5, confidence: 100 })],
      ["BBB", fit({ symbol: "BBB", fitScore: 62, suggestedAllocationPct: 6, confidence: 100 })],
      ["CCC", fit({ symbol: "CCC", fitScore: 80, suggestedAllocationPct: 2, confidence: 100 })],
    ]);
    const out = buildIdeaAssessments({ rows, fits, context: context() });
    const order = [...out].sort((a, b) => a.priority - b.priority).map((a) => a.symbol);
    expect(order).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("sinks an unassessable idea rather than ranking it low — a missing value is not a small one", () => {
    const fits = new Map([["AAA", fit({ symbol: "AAA", fitScore: 30, suggestedAllocationPct: 1, confidence: 40 })]]);
    const out = buildIdeaAssessments({ rows, fits, context: context() });
    const byPriority = [...out].sort((a, b) => a.priority - b.priority);
    expect(byPriority[0].symbol).toBe("AAA");
    expect(byPriority.slice(1).every((a) => a.impactPct == null)).toBe(true);
  });

  it("gives every idea a distinct rank out of the same total", () => {
    const fits = new Map<string, PortfolioFitAnalysis>(rows.map((r) => [r.symbol, fit({ symbol: r.symbol })]));
    const out = buildIdeaAssessments({ rows, fits, context: context() });
    expect(new Set(out.map((a) => a.priority)).size).toBe(rows.length);
    for (const a of out) expect(a.rationale.whyThisOne).toContain(`of ${rows.length} tracked ideas`);
  });
});

/* ------------------------------------------------------------------ */
/* Verdicts — one authority per claim                                 */
/* ------------------------------------------------------------------ */

describe("verdicts", () => {
  const trade: LinkedTrade = {
    action: "trim",
    title: "Trim AAPL by $40,000",
    rationale: "AAPL is 31% of the book, above your 25% position limit.",
    amount: 40_000,
    alignmentDelta: 2.4,
    confidence: 78,
    alternativesEvaluated: 14,
  };

  it("defers to the trade engine whenever it has simulated a trade", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAPL", stage: "owned" }), held: true }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["AAPL", fit({ symbol: "AAPL", fitScore: 90 })]]),
      context: context({ weights: new Map([["AAPL", 31]]), trades: new Map([["AAPL", trade]]) }),
    });
    expect(out[0].verdict).toBe("trade-proposed");
    // Quoted, never paraphrased — and never a competing recommendation.
    expect(out[0].headline).toBe(trade.title);
    expect(out[0].linkedTrade).toEqual(trade);
  });

  it("calls an oversized holding a sizing question, never a sell", () => {
    const rows = rowsFor([{ item: idea({ symbol: "VOO", stage: "owned" }), held: true }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["VOO", fit({ symbol: "VOO", suggestedAllocationPct: 3 })]]),
      context: context({ weights: new Map([["VOO", 9]]) }),
    });
    expect(out[0].verdict).toBe("review-sizing");
    expect(out[0].headline).toContain("9.0%");
    expect(out[0].headline).toContain("3.0%");
    expect(out[0].rationale.whatProblem).toContain("surplus");
  });

  it("leaves a correctly-sized holding alone", () => {
    const rows = rowsFor([{ item: idea({ symbol: "O", stage: "owned" }), held: true }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["O", fit({ symbol: "O", suggestedAllocationPct: 3 })]]),
      context: context({ weights: new Map([["O", 3.4]]) }),
    });
    expect(out[0].verdict).toBe("hold");
  });

  it("deprioritizes a poor fit — and keeps it", () => {
    const rows = rowsFor([{ item: idea({ symbol: "USDT-USD" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["USDT-USD", fit({ symbol: "USDT-USD", fitScore: 22, fitTier: "avoid" })]]),
      context: context(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe("deprioritize");
    expect(out[0].rationale.ifIgnored).toContain("Nothing is lost");
  });

  it("never says 'hold' about something you don't hold", () => {
    // A stablecoin the portfolio has never held was labelled HOLD on the rendered
    // board, which reads as advice to keep something the user doesn't have.
    const rows = rowsFor([{ item: idea({ symbol: "USDT-USD" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["USDT-USD", fit({ symbol: "USDT-USD", fitScore: 57, fitTier: "neutral", confidence: 35 })]]),
      context: context(),
    });
    expect(out[0].verdict).toBe("no-case");
    expect(out[0].headline).toContain("35% of the fit score is evidenced");
  });

  it("routes a written-up idea to a decision, not to more research", () => {
    // A thesis EXISTS (the written view is the artifact); the derived workflow
    // is `ready`, and the honest ask is a decision.
    const rows = rowsFor([{ item: idea({ symbol: "BAC", notes: "Banks re-rate as deposit costs fall." }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["BAC", fit({ symbol: "BAC" })]]), context: context() });
    expect(out[0].verdict).toBe("decide");
  });

  it("asks for a THESIS — never more research — once research evidence exists", () => {
    // The old board's bug class: a researched name whose stage nobody touched
    // was told "hasn't been researched". The verdict must now follow evidence.
    const rows = rowsFor([
      { item: idea({ symbol: "SOFI" }), evidence: { lastResearchedAt: "2026-07-26T00:00:00Z" } },
    ]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["SOFI", fit({ symbol: "SOFI" })]]), context: context() });
    expect(out[0].verdict).toBe("thesis");
    expect(out[0].headline).not.toContain("hasn't been researched");
    expect(out[0].headline).toContain("research exists");
  });
});

/* ------------------------------------------------------------------ */
/* Rationale — five questions, always                                 */
/* ------------------------------------------------------------------ */

describe("rationale", () => {
  it("answers all five questions for every idea, assessed or not", () => {
    const rows = rowsFor([
      { item: idea({ symbol: "AAA", source: "screener", sourceDetail: "Equity screen · rank #4" }) },
      { item: idea({ symbol: "ZZZ" }) },
    ]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["AAA", fit({ symbol: "AAA" })]]),
      context: context(),
    });
    for (const a of out) {
      for (const answer of Object.values(a.rationale)) {
        expect(answer.length).toBeGreaterThan(10);
      }
    }
  });

  it("grounds 'why am I seeing this' in the recorded origin", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA", source: "screener", sourceDetail: "Crypto screen · rank #7" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map(), context: context() });
    expect(out[0].rationale.whySeeing).toContain("Surfaced by a screen");
    expect(out[0].rationale.whySeeing).toContain("Crypto screen · rank #7");
  });

  it("says so when the origin was never recorded, rather than inventing one", () => {
    const rows = rowsFor([{ item: idea({ symbol: "LEGACY" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map(), context: context() });
    expect(out[0].rationale.whySeeing).toContain("Origin not recorded");
  });

  it("never claims a market-timing signal it doesn't have", () => {
    const rows = rowsFor([
      { item: idea({ symbol: "AAA", addedAt: new Date(NOW - 40 * 86_400_000).toISOString() }) },
    ]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["AAA", fit({ symbol: "AAA" })]]), context: context() });
    expect(out[0].rationale.whyNow).toContain("No timing signal");
    expect(out[0].rationale.whyNow).toContain("40d");
  });

  it("reports a real price-target distance when one exists", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA", targetPrice: 100, targetDirection: "below" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["AAA", fit({ symbol: "AAA" })]]),
      prices: new Map([["AAA", 101]]),
      context: context(),
    });
    expect(out[0].rationale.whyNow).toContain("buy level");
    expect(out[0].rationale.whyNow).toContain("$100");
  });

  it("compares against real tracked alternatives, never fabricated ones", () => {
    const rows = rowsFor([
      { item: idea({ symbol: "KGC" }) },
      { item: idea({ symbol: "AU" }) },
      { item: idea({ symbol: "NEM" }) },
    ]);
    const sectors = new Map([
      ["KGC", "Materials"],
      ["AU", "Materials"],
      ["NEM", "Materials"],
    ]);
    const fits = new Map([
      ["KGC", fit({ symbol: "KGC", fitScore: 80, suggestedAllocationPct: 4 })],
      ["AU", fit({ symbol: "AU", fitScore: 60, suggestedAllocationPct: 3 })],
      ["NEM", fit({ symbol: "NEM", fitScore: 50, suggestedAllocationPct: 2 })],
    ]);
    const out = buildIdeaAssessments({ rows, fits, context: context({ sectors }) });
    const kgc = out.find((a) => a.symbol === "KGC")!;
    expect(kgc.peers.map((p) => p.symbol).sort()).toEqual(["AU", "NEM"]);
    expect(kgc.peers.every((p) => p.sharedWith.includes("Materials"))).toBe(true);
    expect(kgc.rationale.whyThisOne).toContain("AU");
  });

  it("names the most INFORMATIVE dimension, not the heaviest one", () => {
    // Found on the rendered board: a 22%-weight Sector dimension scoring 100
    // ("adds missing Utilities exposure") lost to a 24%-weight Objective
    // dimension scoring 87, so a specific gap-filling idea was explained as
    // "well-rounded fundamentals".
    const rows = rowsFor([{ item: idea({ symbol: "SBS" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([
        [
          "SBS",
          fit({
            symbol: "SBS",
            dimensions: {
              sector: dim("Sector", 100, 0.22, "positive", "Adds missing Utilities exposure"),
              correlation: dim("Correlation", 92, 0.18, "positive", "Low overlap with your book"),
              objective: dim("Objective", 87, 0.24, "positive", "Well-rounded fundamentals"),
              style: dim("Style", 50, 0.1, "neutral", "Neutral style impact"),
              geographic: dim("Geography", 50, 0.08, "neutral", "Geographic impact depends on your mix"),
              sizing: dim("Sizing", 80, 0.18, "positive", "6.0% allocation fits comfortably"),
            },
          }),
        ],
      ]),
      context: context(),
    });
    expect(out[0].rationale.whatProblem).toBe("Sector: Adds missing Utilities exposure.");
  });

  it("names the gap it fills, rather than the dimension's label", () => {
    const rows = rowsFor([{ item: idea({ symbol: "SBS" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["SBS", fit({ symbol: "SBS" })]]), context: context() });
    // "Sector stays unfilled" said nothing; the message names the exposure.
    expect(out[0].expected?.fills).toBe("Portfolio holds no Healthcare exposure");
    expect(out[0].rationale.ifIgnored).toContain("Portfolio holds no Healthcare exposure");
  });

  it("uses workflow LABELS in prose, never the stored identifiers", () => {
    const rows = rowsFor([
      { item: idea({ symbol: "AAA" }), evidence: { lastResearchedAt: "2026-07-20T00:00:00Z" } },
    ]);
    const out = buildIdeaAssessments({ rows, fits: new Map(), context: context() });
    expect(out[0].rationale.whySeeing).toContain("In work");
    expect(out[0].rationale.whySeeing).not.toContain("working");
  });

  it("orders identically to the ranks it displays, even when impact ties", () => {
    // The board sorts by `priority`; if two ideas tie on impact the engine
    // separates them by fit, and any second ordering would show #27 above #26.
    const rows = rowsFor([{ item: idea({ symbol: "VCLT" }) }, { item: idea({ symbol: "VOO" }) }]);
    const fits = new Map([
      ["VCLT", fit({ symbol: "VCLT", fitScore: 57, confidence: 51, suggestedAllocationPct: 4 })],
      ["VOO", fit({ symbol: "VOO", fitScore: 58, confidence: 51, suggestedAllocationPct: 4 })],
    ]);
    const out = buildIdeaAssessments({ rows, fits, context: context() });
    const voo = out.find((a) => a.symbol === "VOO")!;
    const vclt = out.find((a) => a.symbol === "VCLT")!;
    expect(voo.priority).toBeLessThan(vclt.priority);
    // Sorting by priority reproduces exactly the displayed rank order.
    const sorted = [...out].sort((a, b) => a.priority - b.priority).map((a) => a.symbol);
    expect(sorted).toEqual(["VOO", "VCLT"]);
  });

  it("states the counterfactual in measured terms", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["AAA", fit({ symbol: "AAA", projectedHHI: 3_300 })]]),
      context: context({ positionHhi: 3_440 }),
    });
    expect(out[0].rationale.ifIgnored).toContain("3,440");
    expect(out[0].expected?.positionHhiBefore).toBe(3_440);
    expect(out[0].expected?.positionHhiAfter).toBe(3_300);
  });
});

/* ------------------------------------------------------------------ */
/* Explainability + determinism                                       */
/* ------------------------------------------------------------------ */

describe("explainability", () => {
  it("publishes the impact formula and every factor behind it", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["AAA", fit({ symbol: "AAA" })]]), context: context() });
    const ex = out[0].explanation!;
    expect(ex.method).toContain("movable share");
    expect(ex.method).toContain("confidence");
    // Three headline factors plus all six fit dimensions — nothing hidden.
    expect(ex.factors).toHaveLength(9);
    expect(ex.confidence?.label).toContain("evidenced");
    expect(ex.caveats.join(" ")).toContain("not a projected return");
  });

  it("declares that fit is not the trade engine", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map([["AAA", fit({ symbol: "AAA" })]]), context: context() });
    expect(out[0].explanation!.caveats.join(" ")).toContain("Decisions tab");
  });

  it("offers no explanation at all rather than an empty one when there is no fit", () => {
    const rows = rowsFor([{ item: idea({ symbol: "HE=F" }) }]);
    const out = buildIdeaAssessments({ rows, fits: new Map(), context: context() });
    expect(out[0].explanation).toBeNull();
    expect(out[0].impactPct).toBeNull();
    expect(out[0].primaryReason).toContain("No fit evidence");
  });

  it("is deterministic — identical inputs produce identical output", () => {
    const rows = rowsFor([
      { item: idea({ symbol: "AAA" }) },
      { item: idea({ symbol: "BBB", notes: "a written view" }) },
    ]);
    const fits = new Map([
      ["AAA", fit({ symbol: "AAA" })],
      ["BBB", fit({ symbol: "BBB", fitScore: 55 })],
    ]);
    const a = buildIdeaAssessments({ rows, fits, context: context() });
    const b = buildIdeaAssessments({ rows, fits, context: context() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("degrades honestly with no portfolio at all", () => {
    const rows = rowsFor([{ item: idea({ symbol: "AAA" }) }]);
    const out = buildIdeaAssessments({
      rows,
      fits: new Map([["AAA", fit({ symbol: "AAA", isGeneric: true })]]),
      context: EMPTY_IDEA_CONTEXT,
    });
    expect(out[0].rationale.whatProblem).toContain("No portfolio");
    expect(out[0].expected?.movableAmount).toBeNull();
  });
});

describe("describeOrigin", () => {
  it("names the surface, the detail and the age", () => {
    expect(
      describeOrigin({ source: "screener", detail: "Equity screen · rank #3", at: "2026-07-27T00:00:00Z" }, NOW),
    ).toBe("Surfaced by a screen · Equity screen · rank #3 · 2d ago");
  });

  it("distinguishes an unrecorded origin from every recorded one", () => {
    expect(describeOrigin({ source: null, detail: null, at: "2026-07-01T00:00:00Z" }, NOW)).toBe(
      "Origin not recorded — tracked for 28d, from before provenance was captured",
    );
  });

  it("reports a ledger-born idea as exactly that", () => {
    expect(describeOrigin({ source: "ledger", detail: "etf position opened", at: "2026-07-28T00:00:00Z" }, NOW)).toBe(
      "Entered by being bought · etf position opened · yesterday",
    );
  });
});
