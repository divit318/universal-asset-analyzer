import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Portfolio Thesis banner had no test coverage at all. It is the first thing on
 * the page and the only AI-generated element on it, so the two behaviours that
 * matter are pinned here:
 *
 *   1. A model that returns nothing usable must degrade to something USEFUL, not to
 *      an apology — the health engine already knows the book's strongest and weakest
 *      dimensions and has written a sentence about each.
 *   2. An empty `bearCase` must survive. The prompt explicitly permits it ("if you
 *      have no substantive bear case, return an empty string"), and back-filling a
 *      generic one would defeat the instruction and put a manufactured criticism in
 *      front of the user.
 */

// The thesis now runs through the analysis seam (tranche 4). The mock records
// (taskType, prompt) exactly as the old runPrompt mock did, so the prompt-
// grounding assertions below keep reading calls[0][1]; the resolved value is
// the seam's AnalysisResult envelope around the same loose JSON bag.
const runPromptMock = vi.fn();
const runAnalysisMock = vi.fn(async (req: { taskType: string; prompt: string }) => {
  const raw = await runPromptMock(req.taskType, req.prompt);
  return {
    data: JSON.parse(String(raw)) as Record<string, unknown>,
    provider: "ollama" as const,
    meta: { durationMs: 1 },
  };
});
// Typed with its key so the cache-version test can assert that the key read is
// the key written — an untyped `vi.fn()` records calls as an empty tuple.
const cacheGet = vi.fn((_key: string) => null as string | null);
const cachePut = vi.fn();

vi.mock("@/lib/ai/analysis", () => ({
  runAnalysis: (req: { taskType: string; prompt: string }) => runAnalysisMock(req),
}));
vi.mock("@/lib/db", () => ({
  getScannerCache: (key: string) => cacheGet(key),
  putScannerCache: (...a: unknown[]) => cachePut(...(a as [])),
}));

const { buildPortfolioThesis } = await import("@/lib/portfolio/thesis");
import type { PortfolioEvaluation } from "@/lib/portfolio/engines/simulate";
import type { HealthDimension } from "@/lib/portfolio/engines/health";

function dim(name: string, score: number, explanation: string): HealthDimension {
  return {
    name,
    score,
    scoreExact: score,
    weight: 0.1,
    coverage: 1,
    effectiveWeight: 0.1,
    trend: score >= 62 ? "good" : "weak",
    explanation,
  };
}

/** Minimal but structurally real evaluation — enough for the prompt and fallbacks. */
function evaluation(): PortfolioEvaluation {
  return {
    holdings: [
      {
        id: "AAPL",
        assetClass: "equity",
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        quantity: 10,
        unit: "shares",
        costBasis: 1000,
        costBasisBase: 1000,
        acquiredAt: "2025-01-01",
        valuation: { mode: "market", value: 1200, valueBase: 1200, fxRate: 1, source: "yahoo", asOf: "2025-06-01", stale: false },
        weight: 100,
        unrealizedPL: 200,
        unrealizedPct: 20,
        liquidity: "t0",
        income: null,
        factors: { equityBeta: 1.2 },
        metrics: {},
        attributes: { sector: "Technology" },
        score: null,
        meta: {},
      },
    ],
    totalValue: 1200,
    allocation: {
      byAssetClass: { dimension: "assetClass", slices: [{ key: "equity", label: "Equities", value: 1200, weight: 100, count: 1, avgScore: null }], hhi: 10000, unclassifiedPct: 0 },
      bySector: { dimension: "sector", slices: [], hhi: 0, unclassifiedPct: 0 },
      byGeography: { dimension: "geography", slices: [], hhi: 0, unclassifiedPct: 0 },
      byCurrency: { dimension: "currency", slices: [], hhi: 0, unclassifiedPct: 0 },
      byLiquidity: { dimension: "liquidity", slices: [], hhi: 0, unclassifiedPct: 0 },
      byFactor: [{ factor: "equityBeta", label: "Equity market", exposure: 1.2 }],
    },
    risk: {
      annualizedVolatility: 18,
      beta: 1.2,
      sharpeRatio: 0.9,
      sortinoRatio: 1.3,
      maxDrawdown: -12,
      var95Pct: 2.1,
      var95Dollar: 25,
      cvar95Pct: 3.0,
      cvar95Dollar: 36,
      duration: null,
      creditSensitivity: null,
      foreignCurrencyPct: 0,
      illiquidPct: 0,
      illiquidHoldings: 0,
      inflationSensitivity: -1.2,
      positionHhi: 10000,
      topHoldingWeight: 100,
      topAssetClassWeight: 100,
      topSectorWeight: 100,
      concentrationRisk: "high",
      coverage: { observedPct: 100, proxiedPct: 0, unmodelledPct: 0, holdingsObserved: 1, holdingsProxied: 0, holdingsUnmodelled: 0 },
      correlation: null,
    },
    health: {
      total: 55,
      totalExact: 55,
      grade: "C",
      dimensions: [
        dim("Liquidity", 100, "Portfolio is highly liquid."),
        dim("Asset Allocation", 20, "100% in Equities. This is a single-asset-class portfolio."),
        dim("Income", 35, "No income generated."),
      ],
      summary: "Weak portfolio.",
      coveragePct: 90,
    },
  };
}

beforeEach(() => {
  runPromptMock.mockReset();
  cacheGet.mockReset().mockReturnValue(null);
  cachePut.mockReset();
});

describe("buildPortfolioThesis — AI path", () => {
  it("returns the model's judgement fields", async () => {
    runPromptMock.mockResolvedValue(
      JSON.stringify({
        thesis: "A single-stock equity book.",
        identity: ["Concentrated", "US-Centric"],
        strengths: ["Fully liquid at 100% same-day"],
        risks: ["AAPL is 100% of the book"],
        bearCase: "This is one position wearing the language of a portfolio.",
        mustBeTrue: "Apple must keep compounding.",
      }),
    );

    const t = await buildPortfolioThesis(evaluation());
    expect(t.source).toBe("ai");
    expect(t.identity).toEqual(["Concentrated", "US-Centric"]);
    expect(t.strengths).toHaveLength(1);
    expect(t.bearCase).toContain("one position");
    expect(t.mustBeTrue).toContain("Apple");
  });

  it("preserves an EMPTY bear case rather than manufacturing one", async () => {
    runPromptMock.mockResolvedValue(
      JSON.stringify({
        thesis: "A sound, diversified book.",
        identity: ["Balanced"],
        strengths: ["Broad"],
        risks: ["Minor"],
        // The prompt explicitly permits this.
        bearCase: "",
        mustBeTrue: "Markets stay open.",
      }),
    );
    const t = await buildPortfolioThesis(evaluation());
    expect(t.bearCase).toBe("");
  });

  it("falls back PER FIELD when the model drops one, keeping the good thesis", async () => {
    runPromptMock.mockResolvedValue(
      JSON.stringify({ thesis: "A single-stock equity book.", identity: ["Concentrated"] }),
    );
    const t = await buildPortfolioThesis(evaluation());
    expect(t.source).toBe("ai");
    expect(t.thesis).toContain("single-stock");
    // Strengths/risks come from the health engine rather than being lost.
    expect(t.strengths.length).toBeGreaterThan(0);
    expect(t.risks.length).toBeGreaterThan(0);
    expect(t.strengths[0]).toContain("Liquidity");
  });

  it("discards junk that is not JSON and does not throw", async () => {
    runPromptMock.mockResolvedValue("I'm sorry, I can't help with that.");
    const t = await buildPortfolioThesis(evaluation());
    expect(t.source).toBe("fallback");
    expect(t.thesis.length).toBeGreaterThan(0);
  });
});

describe("buildPortfolioThesis — fallback path", () => {
  it("degrades to the health engine's own strongest and weakest dimensions", async () => {
    runPromptMock.mockRejectedValue(new Error("AI offline"));
    const t = await buildPortfolioThesis(evaluation());

    expect(t.source).toBe("fallback");
    // Useful, not an apology: the best dimension as a strength...
    expect(t.strengths.some((s) => s.includes("Liquidity") && s.includes("100"))).toBe(true);
    // ...and the worst as a risk, weakest first.
    expect(t.risks[0]).toContain("Asset Allocation");
    expect(t.risks[0]).toContain("20");
  });

  it("never caches a fallback, so the AI coming back is not pinned out for the TTL", async () => {
    runPromptMock.mockRejectedValue(new Error("AI offline"));
    await buildPortfolioThesis(evaluation());
    expect(cachePut).not.toHaveBeenCalled();
  });

  // The prefix is bumped whenever what a cached entry MEANS changes, not just its
  // shape: v2 was the five-field rewrite, v3 the one-figure-one-direction rule.
  // Since the rest of the key is a content hash of the holdings, an unchanged
  // portfolio would otherwise keep serving a card generated under the old rules.
  it("caches a real AI result under a v3 key, so pre-rule entries cannot be replayed", async () => {
    runPromptMock.mockResolvedValue(
      JSON.stringify({ thesis: "ok", identity: ["X"], strengths: ["a"], risks: ["b"], bearCase: "c", mustBeTrue: "d" }),
    );
    await buildPortfolioThesis(evaluation());
    expect(cachePut).toHaveBeenCalledTimes(1);
    expect(String(cachePut.mock.calls[0][0])).toMatch(/^v3:/);
    // Read and write must agree, or every load is a cache miss.
    expect(String(cacheGet.mock.calls[0][0])).toBe(String(cachePut.mock.calls[0][0]));
  });

  it("handles an empty portfolio without calling the model", async () => {
    const e = evaluation();
    e.holdings = [];
    const t = await buildPortfolioThesis(e);
    expect(runPromptMock).not.toHaveBeenCalled();
    expect(t.source).toBe("fallback");
    expect(t.strengths).toEqual([]);
  });
});

describe("buildPortfolioThesis — prompt grounding", () => {
  it("gives the model the weakest health dimensions and their explanations", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation());

    const prompt = String(runPromptMock.mock.calls[0][1]);
    // The old prompt saw only the health TOTAL, so it could never discuss why.
    expect(prompt).toContain("WEAKEST HEALTH DIMENSIONS");
    expect(prompt).toContain("Asset Allocation: 20/100");
    expect(prompt).toContain("single-asset-class portfolio");
  });

  it("passes attribution and the last change through when supplied", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation(), {
      attribution: {
        totalReturnPct: 20,
        totalPnl: 200,
        contributors: [],
        carrying: [{ id: "AAPL", symbol: "AAPL", name: "Apple", assetClass: "equity", weight: 100, pnl: 200, ownReturnPct: 20, contributionPct: 20, shareOfMovementPct: 100 }],
        dragging: [],
        byAssetClass: [],
        bySector: [],
        top3SharePct: 100,
        effectiveDrivers: 1,
        winners: 1,
        losers: 0,
        grossMovement: 200,
        excluded: [],
      },
      lastChange: {
        at: "2025-06-01T00:00:00Z",
        objective: "maximize_sharpe",
        healthBefore: 78,
        healthAfter: 75,
        healthDelta: -3,
        concentrationBefore: 44,
        concentrationAfter: 50.7,
        concentrationDelta: 6.7,
        regressed: true,
      },
    });

    const prompt = String(runPromptMock.mock.calls[0][1]);
    expect(prompt).toContain("RETURN ATTRIBUTION");
    expect(prompt).toContain("effective drivers");
    expect(prompt).toContain("78 -> 75");
    expect(prompt).toContain("44.0% -> 50.7%");

    // The contributor lists name their own direction. Under the neutral headings
    // "Carrying:"/"Dragging:", the model put the largest POSITIVE contributor into
    // its risks list as a position that "dragged on returns", with a made-up figure.
    expect(prompt).toMatch(/POSITIONS THAT ADDED TO RETURN — these HELPED, never describe them as detractors: AAPL \+20\.00pp/);
    expect(prompt).toMatch(/POSITIONS THAT SUBTRACTED FROM RETURN — these HURT: none/);
    expect(prompt).toMatch(/Do not cite a contribution figure for any position not listed/);
  });

  /**
   * These pin the ESTABLISHED CONCLUSIONS block, which exists because a 7B local
   * model, given the numbers and asked for judgement, asserted that "USD Cash is
   * fully hedged against inflation" and that 11.3 effective drivers meant "a small
   * number of holdings" — both flatly contradicting the panels rendered beside it.
   * Directional verdicts are therefore computed in code and handed over as settled
   * facts rather than left to the model to derive.
   */
  it("hands the model the inflation verdict rather than letting it infer one", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation()); // inflationSensitivity: -1.2

    const prompt = String(runPromptMock.mock.calls[0][1]);
    expect(prompt).toContain("ESTABLISHED CONCLUSIONS");
    expect(prompt).toMatch(/POORLY protected against inflation/);
    // The specific inversion that was observed, pre-empted explicitly.
    expect(prompt).toMatch(/Cash and nominal bonds are the CAUSE of this, never the cure/);
    expect(prompt).toMatch(/does NOT protect against inflation/);
  });

  it("states which direction 'effective drivers' runs, so it cannot be inverted", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation(), {
      attribution: {
        totalReturnPct: 5,
        totalPnl: 100,
        contributors: [],
        carrying: [],
        dragging: [],
        byAssetClass: [],
        bySector: [],
        // Broad: 11.3 drivers, 40% top-3 share — the exact shape the model called
        // "a small number of holdings".
        top3SharePct: 40,
        effectiveDrivers: 11.3,
        winners: 14,
        losers: 9,
        grossMovement: 5_000,
        excluded: [],
      },
    });

    const prompt = String(runPromptMock.mock.calls[0][1]);
    expect(prompt).toMatch(/BROADLY sourced/);
    expect(prompt).toMatch(/HIGH means broad, so this is a strength, not a concentration risk/);
  });

  it("calls a genuinely narrow return narrow", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation(), {
      attribution: {
        totalReturnPct: 5, totalPnl: 100, contributors: [], carrying: [], dragging: [],
        byAssetClass: [], bySector: [], top3SharePct: 88, effectiveDrivers: 1.4,
        winners: 3, losers: 1, grossMovement: 5_000, excluded: [],
      },
    });
    const prompt = String(runPromptMock.mock.calls[0][1]);
    expect(prompt).toMatch(/NARROWLY sourced/);
    expect(prompt).toMatch(/LOW means narrow/);
  });

  it("distinguishes holding-level from asset-class concentration in the ground truth", async () => {
    const e = evaluation();
    e.risk.concentrationRisk = "low";
    e.risk.topHoldingWeight = 13.5;
    e.risk.topAssetClassWeight = 50.7;
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(e);

    const prompt = String(runPromptMock.mock.calls[0][1]);
    // The two HHIs that read 689 and 3440 on the real book are the same trap.
    expect(prompt).toMatch(/LOW at the individual-holding level/);
    expect(prompt).toMatch(/these are different things/);
  });

  it("forbids re-characterising a metric or mislabelling an asset class", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation());
    const prompt = String(runPromptMock.mock.calls[0][1]);

    expect(prompt).toMatch(/Never restate what a metric MEANS/);
    // VCLT, a corporate bond fund, was described as a large-cap equity ETF.
    expect(prompt).toMatch(/a bond fund is a bond fund even if its ticker looks like an equity ETF/);
    expect(prompt).toMatch(/Combine facts; do not reinterpret them/);
  });

  it("asks for judgement, and forbids inventing forecasts", async () => {
    runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
    await buildPortfolioThesis(evaluation());
    const prompt = String(runPromptMock.mock.calls[0][1]);

    expect(prompt).toContain("bearCase");
    expect(prompt).toContain("mustBeTrue");
    expect(prompt).toMatch(/never invent a price target/i);
    // The anti-summary instruction is the whole point of the rewrite.
    expect(prompt).toMatch(/not summarising the data back to them/i);
  });

  /**
   * ── One figure, one direction ──────────────────────────────────────────────
   *
   * The observed failure, verbatim from the card:
   *
   *   Working: "The 3 biggest movers accounted for 49% of all movement …
   *             suggesting diversification across multiple positions."
   *   Watch:   "Despite a moderately broad return distribution, the top 3 movers
   *             accounted for nearly half of the total movement, suggesting that
   *             the portfolio's performance is still heavily influenced by a small
   *             number of positions."
   *
   * One measured figure — 49% top-3 share — sold as reassuring in the left column
   * and alarming in the right, in the same card. Note that the two sentences share
   * no number at all ("49%" vs "nearly half"), which is why the guard matches on
   * subject rather than on digits.
   */
  describe("one figure, one direction", () => {
    /** 49% top-3 share: the middle band, and the exact figure that was spun both ways. */
    const moderateBreadth = {
      attribution: {
        totalReturnPct: 5, totalPnl: 100, contributors: [], carrying: [], dragging: [],
        byAssetClass: [], bySector: [], top3SharePct: 49, effectiveDrivers: 6.2,
        winners: 10, losers: 8, grossMovement: 5_000, excluded: [],
      },
    };

    const WORKING = "The 3 biggest movers accounted for 49% of all movement, suggesting diversification across multiple positions.";
    const WATCH = "Despite a moderately broad return distribution, the top 3 movers accounted for nearly half of the total movement, suggesting that the portfolio's performance is still heavily influenced by a small number of positions.";

    it("tags each established conclusion with the one section it may support", async () => {
      runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok" }));
      await buildPortfolioThesis(evaluation(), moderateBreadth);
      const prompt = String(runPromptMock.mock.calls[0][1]);

      expect(prompt).toMatch(/ONE FIGURE, ONE DIRECTION/);
      // A middle-band breadth reading is a non-finding, and the model has to be
      // told that rather than left to decide which way to lean.
      expect(prompt).toMatch(/\[NEUTRAL[^\]]*\] The return is MODERATELY BROAD/);
      expect(prompt).toMatch(/NOT evidence of good diversification and NOT evidence of dependence on a few positions/);
      // inflationSensitivity -1.2 and concentrationRisk "high" are both risks.
      expect(prompt).toMatch(/\[RISK[^\]]*\] POORLY protected against inflation/);
      expect(prompt).toMatch(/\[RISK[^\]]*\] Position concentration is HIGH/);
      // illiquidPct 0 — a real strength, and it must not turn up as a risk.
      expect(prompt).toMatch(/\[STRENGTH[^\]]*\] Liquidity is not a constraint/);
    });

    it("drops the flattering half when Working and Watch spin one neutral figure both ways", async () => {
      runPromptMock.mockResolvedValue(
        JSON.stringify({ thesis: "ok", strengths: [WORKING], risks: [WATCH] }),
      );
      const result = await buildPortfolioThesis(evaluation(), moderateBreadth);

      // The cautionary reading survives; the reassuring one does not. Both were
      // about a figure the engine calls unremarkable, so the card must not present
      // it as a win.
      expect(result.risks).toContain(WATCH);
      expect(result.strengths).not.toContain(WORKING);
      // And the surviving strengths must not be an empty column — the per-field
      // fallback supplies the health engine's own strongest dimensions.
      expect(result.strengths.length).toBeGreaterThan(0);
      expect(result.strengths.join(" ")).not.toMatch(/49%/);
    });

    it("drops the risk instead when the engine calls the figure a strength", async () => {
      runPromptMock.mockResolvedValue(
        JSON.stringify({
          thesis: "ok",
          strengths: ["Only 0% of the book is illiquid, so the whole position can be repositioned within days."],
          risks: ["Liquidity could become a constraint if markets seize up."],
        }),
      );
      // illiquidPct is 0 in the fixture — the engine calls liquidity a strength, so
      // it is the RISK bullet that is wrong here, not the strength.
      const result = await buildPortfolioThesis(evaluation());

      expect(result.strengths.join(" ")).toMatch(/illiquid/);
      expect(result.risks.join(" ")).not.toMatch(/Liquidity could become a constraint/);
    });

    it("leaves a subject alone when only one column mentions it", async () => {
      const strengths = ["Position concentration is offset by 0% illiquid holdings."];
      const risks = ["A +1pp inflation surprise costs about 1.2% of value."];
      runPromptMock.mockResolvedValue(JSON.stringify({ thesis: "ok", strengths, risks }));

      // Different subjects in each column is the normal, correct case: the guard
      // polices contradiction, not vocabulary, and must not prune a healthy card.
      const result = await buildPortfolioThesis(evaluation());
      expect(result.strengths).toEqual(strengths);
      expect(result.risks).toEqual(risks);
    });
  });
});
