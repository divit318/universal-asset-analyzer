import { describe, expect, it } from "vitest";
import { computePortfolioFit, rankByFit } from "@/lib/ios/fit-scorer";
import { EMPTY_PROFILE } from "@/lib/ios/types";
import type { FitAssetData, InvestmentProfile } from "@/lib/ios/types";
import type { CompositeScores } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function profile(o: Partial<InvestmentProfile> = {}): InvestmentProfile {
  return {
    ...EMPTY_PROFILE,
    hasPortfolio: true,
    positionCount: 8,
    totalValue: 100_000,
    holdingSymbols: [],
    sectorWeights: [],
    missingSectors: [],
    underweightSectors: [],
    overweightSectors: [],
    styleWeights: { growth: 50, value: 50, momentum: 50, quality: 50, income: 50 },
    hhi: 1500,
    builtAt: Date.now(),
    ...o,
  };
}

function comp(o: Partial<CompositeScores> = {}): CompositeScores {
  return { value: 50, growth: 50, quality: 50, financialHealth: 50, momentum: 50, overall: 50, ...o };
}

function asset(o: Partial<FitAssetData> = {}): FitAssetData {
  return { symbol: "TST", sector: null, marketCap: 50e9, ...o };
}

/* ------------------------------------------------------------------ */
/* 1. Differentiation — the core failure of the old system            */
/* ------------------------------------------------------------------ */

describe("differentiation across a diverse basket", () => {
  it("produces a spread of scores and >=3 distinct tiers, not everything at 73", () => {
    const p = profile({
      objective: "ai_optimized",
      sectorWeights: [
        { sector: "Financials", weight: 45 },
        { sector: "Energy", weight: 30 },
      ],
      overweightSectors: ["Financials"], // 45 > 40 cap
      missingSectors: ["Technology", "Healthcare", "Utilities"],
      holdingSymbols: ["JPM"],
      hhi: 3200,
    });

    // `overall` is each asset's standalone Research Score, which the fit now
    // INHERITS (fit = research + portfolio effects) — so the fixtures carry an
    // overall consistent with their sub-scores, as composite.ts would produce.
    const basket: FitAssetData[] = [
      // strong, diversifying, high quality
      asset({ symbol: "NVDA", sector: "Technology", compositeScores: comp({ growth: 92, quality: 85, momentum: 80, financialHealth: 80, overall: 86 }) }),
      // decent healthcare filler
      asset({ symbol: "JNJ", sector: "Healthcare", compositeScores: comp({ quality: 70, financialHealth: 75, growth: 45, overall: 64 }) }),
      // piling into an overweight, capped sector, weak fundamentals
      asset({ symbol: "WFC", sector: "Financials", compositeScores: comp({ growth: 30, quality: 35, momentum: 25, financialHealth: 40, overall: 33 }) }),
      // energy, heavy overlap
      asset({ symbol: "XOM", sector: "Energy", compositeScores: comp({ growth: 40, quality: 55, momentum: 45, overall: 47 }) }),
      // already held
      asset({ symbol: "JPM", sector: "Financials", compositeScores: comp({ quality: 60, overall: 55 }) }),
    ];

    const scores = basket.map((a) => computePortfolioFit(a, p));
    const values = scores.map((s) => s.fitScore);
    const uniqueTiers = new Set(scores.map((s) => s.fitTier));

    // Spread: best and worst differ by a wide margin (old system: ~2 points)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(25);
    expect(uniqueTiers.size).toBeGreaterThanOrEqual(3);

    // The strong diversifier beats the weak same-sector pile-on decisively
    const nvda = scores.find((s) => s.symbol === "NVDA")!;
    const wfc = scores.find((s) => s.symbol === "WFC")!;
    expect(nvda.fitScore).toBeGreaterThan(wfc.fitScore + 20);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Missing data is neutral + low confidence, never spuriously good */
/* ------------------------------------------------------------------ */

describe("missing-data handling", () => {
  const p = profile({ sectorWeights: [{ sector: "Financials", weight: 45 }] });

  it("a no-sector, no-fundamentals asset lands Neutral with low confidence", () => {
    const fit = computePortfolioFit(asset({ symbol: "MYSTERY" }), p);
    expect(fit.confidence).toBeLessThan(40);
    expect(fit.fitScore).toBeGreaterThanOrEqual(45);
    expect(fit.fitScore).toBeLessThan(62); // NOT in the "good" band
    expect(fit.fitTier).toBe("neutral");
  });

  it("data-rich asset reports much higher confidence than a data-poor one", () => {
    const rich = computePortfolioFit(
      asset({ symbol: "AAPL", sector: "Technology", geography: "US",
        dividendYield: 0.5, beta: 1.1, compositeScores: comp({ quality: 80 }) }),
      p,
    );
    const poor = computePortfolioFit(asset({ symbol: "MYSTERY" }), p);
    expect(rich.confidence).toBeGreaterThan(poor.confidence + 40);
  });

  it("never cites a dimension it has no evidence for", () => {
    const fit = computePortfolioFit(asset({ symbol: "MYSTERY" }), p);
    const all = [...fit.reasons, ...fit.tradeoffs].join(" ").toLowerCase();
    expect(all).not.toContain("low overlap");
    expect(all).not.toContain("different return stream");
  });
});

/* ------------------------------------------------------------------ */
/* 3. No inversion — known-good data never scores below unknown data  */
/* ------------------------------------------------------------------ */

describe("no data-inversion", () => {
  const p = profile({
    sectorWeights: [{ sector: "Financials", weight: 30 }],
    missingSectors: ["Technology"],
  });

  it("a known missing sector does not score worse than an unknown sector", () => {
    const known = computePortfolioFit(asset({ symbol: "A", sector: "Technology", compositeScores: comp({ quality: 60 }) }), p);
    const unknown = computePortfolioFit(asset({ symbol: "B", sector: null }), p);
    // Known good diversifier should be >= the unknown (old bug: unknown won at 73)
    expect(known.fitScore).toBeGreaterThanOrEqual(unknown.fitScore);
    expect(known.dimensions.sector.confidence).toBe(1);
    expect(unknown.dimensions.sector.confidence).toBe(0);
  });

  it("adding real fundamentals raises confidence and does not mechanically lower the score", () => {
    const bare = computePortfolioFit(asset({ symbol: "A", sector: "Technology" }), p);
    const enriched = computePortfolioFit(
      // overall (the inherited Research Score) consistent with the strong
      // sub-scores — a STRONG asset gaining data must not lose fit points.
      asset({ symbol: "A", sector: "Technology", compositeScores: comp({ growth: 85, quality: 80, momentum: 75, overall: 80 }) }),
      p,
    );
    expect(enriched.confidence).toBeGreaterThan(bare.confidence);
    expect(enriched.fitScore).toBeGreaterThanOrEqual(bare.fitScore);
  });

  it("a mediocre research score legitimately lowers the fit of a great diversifier (inheritance, not inversion)", () => {
    const bare = computePortfolioFit(asset({ symbol: "A", sector: "Technology" }), p);
    const mediocre = computePortfolioFit(
      asset({ symbol: "A", sector: "Technology", compositeScores: comp({ overall: 50 }) }),
      p,
    );
    // Not a data-inversion: the score drops because the RESEARCH verdict is
    // average, and the bridge says so explicitly.
    expect(mediocre.fitScore).toBeLessThanOrEqual(bare.fitScore);
    expect(mediocre.researchScore).toBe(50);
    expect(mediocre.bridge.some((s) => s.label === "Research quality" && s.value === 50)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Sector concentration is monotonic & continuous                  */
/* ------------------------------------------------------------------ */

describe("sector concentration monotonicity", () => {
  it("sector score falls monotonically as existing exposure rises", () => {
    const weights = [0, 10, 20, 35, 50];
    const sectorScores = weights.map((w) => {
      const p = profile({
        sectorWeights: [{ sector: "Energy", weight: w }],
        overweightSectors: w > 40 ? ["Energy"] : [],
      });
      return computePortfolioFit(asset({ symbol: "XOM", sector: "Energy", compositeScores: comp() }), p)
        .dimensions.sector.score;
    });
    for (let i = 1; i < sectorScores.length; i++) {
      expect(sectorScores[i]).toBeLessThanOrEqual(sectorScores[i - 1]);
    }
  });

  it("correlation score falls as same-sector overlap rises (no top-3 cliff)", () => {
    const s5 = computePortfolioFit(asset({ symbol: "A", sector: "Energy", compositeScores: comp() }),
      profile({ sectorWeights: [{ sector: "Energy", weight: 5 }] })).dimensions.correlation.score;
    const s30 = computePortfolioFit(asset({ symbol: "A", sector: "Energy", compositeScores: comp() }),
      profile({ sectorWeights: [{ sector: "Energy", weight: 30 }] })).dimensions.correlation.score;
    expect(s5).toBeGreaterThan(s30);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Hard gates                                                      */
/* ------------------------------------------------------------------ */

describe("hard constraint gates", () => {
  it("excluded symbol is forced into the avoid band regardless of fundamentals", () => {
    const p = profile({
      constraints: { ...EMPTY_PROFILE.constraints, excludedSymbols: ["MO"] },
      missingSectors: ["Consumer Staples"],
    });
    const fit = computePortfolioFit(
      asset({ symbol: "MO", sector: "Consumer Staples", compositeScores: comp({ quality: 90, growth: 80 }) }),
      p,
    );
    expect(fit.fitTier).toBe("avoid");
    expect(fit.fitScore).toBeLessThanOrEqual(15);
    expect(fit.capReason).toMatch(/excluded/i);
  });

  it("requireDividend gates a KNOWN-zero dividend but NOT an unknown one", () => {
    const p = profile({ constraints: { ...EMPTY_PROFILE.constraints, requireDividend: true } });
    const knownZero = computePortfolioFit(asset({ symbol: "A", sector: "Technology", dividendYield: 0, compositeScores: comp({ quality: 80 }) }), p);
    const unknown = computePortfolioFit(asset({ symbol: "B", sector: "Technology", compositeScores: comp({ quality: 80 }) }), p);
    expect(knownZero.fitScore).toBeLessThanOrEqual(40);
    expect(knownZero.capReason).toMatch(/dividend/i);
    expect(unknown.capReason).toBeNull(); // unknown data must not trigger a penalty
  });

  it("an overweight sector caps the score into the poor band", () => {
    const p = profile({
      sectorWeights: [{ sector: "Financials", weight: 55 }],
      overweightSectors: ["Financials"],
    });
    // Even with strong standalone fundamentals, piling into an over-cap sector
    // must land in the poor/avoid band (via the concentration dims and, if those
    // don't already, the hard gate as a backstop).
    const fit = computePortfolioFit(asset({ symbol: "BAC", sector: "Financials", compositeScores: comp({ quality: 90, growth: 85, momentum: 80, financialHealth: 85 }) }), p);
    expect(fit.fitScore).toBeLessThanOrEqual(45);
    expect(["poor", "avoid"]).toContain(fit.fitTier);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Objective alignment behaves sensibly                            */
/* ------------------------------------------------------------------ */

describe("objective alignment", () => {
  it("income objective rewards a real dividend and flags a zero-yield name", () => {
    const p = profile({ objective: "increase_income", sectorWeights: [{ sector: "Utilities", weight: 10 }] });
    const payer = computePortfolioFit(asset({ symbol: "DUK", sector: "Utilities", dividendYield: 4, compositeScores: comp() }), p);
    const noYield = computePortfolioFit(asset({ symbol: "GOOG", sector: "Technology", dividendYield: 0, compositeScores: comp() }), p);
    expect(payer.dimensions.objective.score).toBeGreaterThan(noYield.dimensions.objective.score + 30);
  });

  it("reduce_risk rewards a low-beta defensive name over a high-beta one", () => {
    const p = profile({ objective: "reduce_risk", sectorWeights: [{ sector: "Consumer Staples", weight: 10 }] });
    const defensive = computePortfolioFit(asset({ symbol: "KO", sector: "Consumer Staples", beta: 0.5, compositeScores: comp({ financialHealth: 80, quality: 80 }) }), p);
    const risky = computePortfolioFit(asset({ symbol: "COIN", sector: "Financials", beta: 2.5, compositeScores: comp({ financialHealth: 45, quality: 40 }) }), p);
    expect(defensive.dimensions.objective.score).toBeGreaterThan(risky.dimensions.objective.score);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Already-held penalty + generic mode                             */
/* ------------------------------------------------------------------ */

describe("holdings & generic mode", () => {
  it("adding to an existing holding is penalized on correlation", () => {
    const p = profile({ holdingSymbols: ["AAPL"], positionCount: 5, sectorWeights: [{ sector: "Technology", weight: 20 }] });
    const held = computePortfolioFit(asset({ symbol: "AAPL", sector: "Technology", compositeScores: comp() }), p);
    const fresh = computePortfolioFit(asset({ symbol: "MSFT", sector: "Technology", compositeScores: comp() }), p);
    expect(held.dimensions.correlation.score).toBeLessThan(fresh.dimensions.correlation.score);
    expect(held.isInPortfolio).toBe(true);
  });

  it("with no portfolio, returns generic mode and does not fabricate personalized reasons", () => {
    const fit = computePortfolioFit(asset({ symbol: "AAPL", sector: "Technology", compositeScores: comp({ quality: 80 }) }), { ...EMPTY_PROFILE, builtAt: Date.now() });
    expect(fit.isGeneric).toBe(true);
    expect(fit.tradeoffs).toHaveLength(0);
    expect(fit.reasons[0]).toMatch(/build your portfolio/i);
  });
});

/* ------------------------------------------------------------------ */
/* 8. rankByFit combines absolute + fit and sorts                     */
/* ------------------------------------------------------------------ */

describe("rankByFit", () => {
  it("ranks a diversifying high-quality name above a redundant weak one", () => {
    const p = profile({
      sectorWeights: [{ sector: "Financials", weight: 45 }],
      overweightSectors: ["Financials"],
      missingSectors: ["Technology"],
    });
    const ranked = rankByFit([
      { ...asset({ symbol: "GOOD", sector: "Technology", compositeScores: comp({ quality: 85, growth: 80 }) }), absoluteScore: 80 },
      { ...asset({ symbol: "BAD", sector: "Financials", compositeScores: comp({ quality: 35 }) }), absoluteScore: 78 },
    ], p);
    expect(ranked[0].symbol).toBe("GOOD");
    expect(ranked[0].combinedScore).toBeGreaterThan(ranked[1].combinedScore);
  });

  it("emits row-specific summaries — no reason string repeats verbatim across a batch", () => {
    const p = profile({
      sectorWeights: [{ sector: "Financials", weight: 45 }],
      overweightSectors: ["Financials"],
      missingSectors: ["Technology"],
    });
    // Five near-identical candidates: the old picker gave all of them
    // reasons[0], i.e. the same sizing/objective clause on every row.
    const ranked = rankByFit(
      ["AAA", "BBB", "CCC", "DDD", "EEE"].map((symbol) => ({
        ...asset({ symbol, sector: "Technology", compositeScores: comp({ quality: 70, growth: 65, overall: 68 }) }),
        absoluteScore: 68,
      })),
      p,
    );
    const summaries = ranked.map((r) => r.fitSummary);
    expect(new Set(summaries).size).toBe(summaries.length);
  });

  it("carries a fitDetail distinct from the summary when a second driver exists", () => {
    const p = profile({
      sectorWeights: [{ sector: "Financials", weight: 45 }],
      overweightSectors: ["Financials"],
      missingSectors: ["Technology"],
    });
    const ranked = rankByFit(
      [{ ...asset({ symbol: "GOOD", sector: "Technology", compositeScores: comp({ quality: 85, growth: 80, overall: 82 }) }), absoluteScore: 80 }],
      p,
    );
    const r = ranked[0];
    if (r.fitDetail != null) expect(r.fitDetail).not.toBe(r.fitSummary);
  });
});
