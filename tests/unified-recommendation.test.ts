/**
 * The unified recommendation hierarchy — Research Score → Portfolio Context →
 * Portfolio Fit → Unified Action → Allocation — must be provably consistent.
 *
 * These tests pin the structural guarantees of the 2026-08 unification:
 *
 *   1. INHERITANCE — the fit score is a bounded function of the Research Score:
 *      it can never exceed research + maxDiversificationUplift, and can never
 *      fall below research − maxPortfolioDrag without a named hard constraint.
 *      "Research 95 / fit 12" and "research 32 / fit 96" are impossible
 *      without a capReason.
 *   2. ONE ACTION — the action is derived from BOTH scores: SELL-band research
 *      is a veto regardless of diversification; excellent research is never
 *      "avoid" without a hard gate; HOLD-band research never earns more than a
 *      starter, however good the fit.
 *   3. ALLOCATION CONSISTENCY — a wait/avoid/exit action always carries a zero
 *      allocation; a buy-family action always carries a positive one.
 *   4. ISOLATION — changing the portfolio changes the fit score but NEVER the
 *      research score.
 *   5. EXPLAINABILITY — the bridge narrates research → effects → fit, and any
 *      hard gate is cited by name.
 */

import { describe, expect, it } from "vitest";
import { computePortfolioFit, DEFAULT_FIT_CONFIG } from "@/lib/ios/fit-scorer";
import { deriveUnifiedAction, fitTier, FIT_TIER_EDGES } from "@/lib/ios/unified-action";
import { computePositionAction } from "@/lib/position-action";
import { scoreToRecommendation } from "@/lib/recommendation";
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
    totalValue: 1_000_000,
    holdingSymbols: [],
    sectorWeights: [],
    missingSectors: [],
    underweightSectors: [],
    overweightSectors: [],
    hhi: 1500,
    builtAt: Date.now(),
    ...o,
  };
}

function comp(overall: number, o: Partial<CompositeScores> = {}): CompositeScores {
  return { value: overall, growth: overall, quality: overall, financialHealth: overall, momentum: overall, overall, ...o };
}

function asset(o: Partial<FitAssetData> & { symbol: string }): FitAssetData {
  return { sector: "Technology", marketCap: 50e9, ...o };
}

const BUY_FAMILY = new Set(["initiate", "add", "starter"]);
const NO_BUY = new Set(["wait", "avoid", "exit", "hold", "trim"]);

/* ------------------------------------------------------------------ */
/* 1. Inheritance guardrails — contradiction is structurally impossible */
/* ------------------------------------------------------------------ */

describe("fit inherits the research score within bounded guardrails", () => {
  const scenarios: Array<{ name: string; p: InvestmentProfile; a: (r: number) => FitAssetData }> = [
    {
      name: "missing sector (best-case diversifier)",
      p: profile({ missingSectors: ["Technology"], sectorWeights: [{ sector: "Financials", weight: 30 }] }),
      a: (r) => asset({ symbol: "TST", compositeScores: comp(r) }),
    },
    {
      name: "crowded sector (worst-case overlap, not gated)",
      p: profile({ sectorWeights: [{ sector: "Technology", weight: 35 }] }),
      a: (r) => asset({ symbol: "TST", compositeScores: comp(r) }),
    },
    {
      name: "already held",
      p: profile({ holdingSymbols: ["TST"], sectorWeights: [{ sector: "Technology", weight: 20 }] }),
      a: (r) => asset({ symbol: "TST", compositeScores: comp(r) }),
    },
    {
      name: "high-beta name",
      p: profile({ sectorWeights: [{ sector: "Technology", weight: 10 }] }),
      a: (r) => asset({ symbol: "TST", beta: 2.2, compositeScores: comp(r) }),
    },
  ];

  it("fit stays within [research − drag, research + uplift] for every research level unless gated", () => {
    for (const { name, p, a } of scenarios) {
      for (let r = 5; r <= 95; r += 10) {
        const fit = computePortfolioFit(a(r), p);
        if (fit.capReason != null) continue; // hard gates may cut deeper, with a named reason
        expect(fit.fitScore, `${name} @ research ${r}`).toBeLessThanOrEqual(r + DEFAULT_FIT_CONFIG.maxDiversificationUplift);
        expect(fit.fitScore, `${name} @ research ${r}`).toBeGreaterThanOrEqual(r - DEFAULT_FIT_CONFIG.maxPortfolioDrag);
      }
    }
  });

  it("research 95 / fit 12 is impossible without a hard constraint", () => {
    const worst = profile({ sectorWeights: [{ sector: "Technology", weight: 39 }], holdingSymbols: ["TST"] });
    const fit = computePortfolioFit(asset({ symbol: "TST", compositeScores: comp(95) }), worst);
    expect(fit.capReason).toBeNull();
    expect(fit.fitScore).toBeGreaterThanOrEqual(95 - DEFAULT_FIT_CONFIG.maxPortfolioDrag);
  });

  it("research 32 / fit 96 is impossible — diversification cannot rescue a weak asset", () => {
    const best = profile({ missingSectors: ["Utilities"], sectorWeights: [] });
    const fit = computePortfolioFit(asset({ symbol: "TST", sector: "Utilities", compositeScores: comp(32) }), best);
    expect(fit.fitScore).toBeLessThanOrEqual(32 + DEFAULT_FIT_CONFIG.maxDiversificationUplift);
    expect(BUY_FAMILY.has(fit.action.kind)).toBe(false);
  });

  it("a hard gate below the drag floor always names its constraint", () => {
    const p = profile({ constraints: { ...EMPTY_PROFILE.constraints, excludedSymbols: ["TST"] } });
    const fit = computePortfolioFit(asset({ symbol: "TST", compositeScores: comp(95) }), p);
    expect(fit.fitScore).toBeLessThanOrEqual(15);
    expect(fit.capReason).toMatch(/excluded/i);
    expect(fit.action.kind).toBe("avoid");
    expect(fit.action.reason).toMatch(/excluded/i);
    expect(fit.bridge.some((s) => s.label === "Constraint gate")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The action matrix is driven by BOTH scores                       */
/* ------------------------------------------------------------------ */

describe("deriveUnifiedAction matrix", () => {
  it("SELL-band research is a veto for every fit level", () => {
    for (let f = 0; f <= 100; f += 5) {
      for (const r of [10, 24, 30, 41]) {
        const notHeld = deriveUnifiedAction({ researchScore: r, fitScore: f, isInPortfolio: false, capReason: null });
        const held = deriveUnifiedAction({ researchScore: r, fitScore: f, isInPortfolio: true, capReason: null });
        expect(notHeld.kind, `r=${r} f=${f}`).toBe("avoid");
        expect(held.kind, `r=${r} f=${f}`).toBe("exit");
        expect(notHeld.sizeFactor).toBe(0);
      }
    }
  });

  it("STRONG_BUY research + good fit → full-size buy; poor fit → starter, never avoid", () => {
    const full = deriveUnifiedAction({ researchScore: 85, fitScore: 70, isInPortfolio: false, capReason: null });
    expect(full.kind).toBe("initiate");
    expect(full.sizeFactor).toBe(1);

    const starter = deriveUnifiedAction({ researchScore: 85, fitScore: 40, isInPortfolio: false, capReason: null });
    expect(starter.kind).toBe("starter");
    expect(starter.sizeFactor).toBeLessThan(1);
    expect(starter.sizeFactor).toBeGreaterThan(0);
    expect(starter.reason).toContain("85");
    expect(starter.reason).toContain("40");
  });

  it("BUY research + poor fit → wait (not held) / hold (held)", () => {
    const w = deriveUnifiedAction({ researchScore: 65, fitScore: 40, isInPortfolio: false, capReason: null });
    expect(w.kind).toBe("wait");
    expect(w.sizeFactor).toBe(0);
    const h = deriveUnifiedAction({ researchScore: 65, fitScore: 40, isInPortfolio: true, capReason: null });
    expect(h.kind).toBe("hold");
  });

  it("HOLD-band research never earns more than a starter, even at excellent fit", () => {
    for (let f = FIT_TIER_EDGES.excellent; f <= 100; f += 5) {
      const a = deriveUnifiedAction({ researchScore: 50, fitScore: f, isInPortfolio: false, capReason: null });
      expect(a.kind).toBe("starter");
      expect(a.sizeFactor).toBeLessThanOrEqual(0.5);
    }
  });

  it("every reachable combination yields an action consistent with the research band", () => {
    for (let r = 0; r <= 100; r += 4) {
      for (let f = 0; f <= 100; f += 4) {
        const a = deriveUnifiedAction({ researchScore: r, fitScore: f, isInPortfolio: false, capReason: null });
        const band = scoreToRecommendation(r);
        if (band === "SELL" || band === "STRONG_SELL") {
          expect(NO_BUY.has(a.kind), `r=${r} f=${f} → ${a.kind}`).toBe(true);
        }
        if (band === "STRONG_BUY" && fitTier(f) !== "avoid") {
          // Never a flat rejection of excellent research without a gate.
          expect(a.kind, `r=${r} f=${f}`).not.toBe("avoid");
          expect(a.kind, `r=${r} f=${f}`).not.toBe("wait");
        }
        // Buy-family actions always size > 0; non-buys never do.
        if (BUY_FAMILY.has(a.kind)) expect(a.sizeFactor).toBeGreaterThan(0);
        else expect(a.sizeFactor === 0 || a.kind === "hold").toBe(true);
        // Every action explains itself with the actual numbers.
        expect(a.reason.length).toBeGreaterThan(10);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Allocation consistency                                           */
/* ------------------------------------------------------------------ */

describe("allocation is consistent with the unified action", () => {
  const p = profile({ missingSectors: ["Technology"] });

  it("wait/avoid carries a zero suggested allocation", () => {
    const weak = computePortfolioFit(asset({ symbol: "BAD", compositeScores: comp(30) }), p);
    expect(NO_BUY.has(weak.action.kind)).toBe(true);
    expect(weak.suggestedAllocationPct).toBe(0);
    expect(weak.suggestedAmount).toBe(0);
  });

  it("a buy-family action carries a positive, cap-respecting allocation", () => {
    const strong = computePortfolioFit(asset({ symbol: "GOOD", compositeScores: comp(85) }), p);
    expect(BUY_FAMILY.has(strong.action.kind)).toBe(true);
    expect(strong.suggestedAllocationPct).toBeGreaterThan(0);
    expect(strong.suggestedAllocationPct).toBeLessThanOrEqual(p.constraints.maxPositionPct);
  });

  it("a starter allocation is smaller than a full-conviction one, all else equal", () => {
    const full = computePortfolioFit(asset({ symbol: "A", compositeScores: comp(85) }), p);
    const starter = computePortfolioFit(asset({ symbol: "B", compositeScores: comp(50) }), p);
    if (BUY_FAMILY.has(starter.action.kind)) {
      expect(starter.suggestedAllocationPct).toBeLessThan(full.suggestedAllocationPct);
    }
  });

  it("higher beta shrinks the suggested allocation for the same scores", () => {
    const calm = computePortfolioFit(asset({ symbol: "A", beta: 0.9, compositeScores: comp(85) }), p);
    const wild = computePortfolioFit(asset({ symbol: "B", beta: 2.4, compositeScores: comp(85) }), p);
    expect(wild.suggestedAllocationPct).toBeLessThanOrEqual(calm.suggestedAllocationPct);
  });

  it("the position action card can never say Buy for SELL-band research", () => {
    const weak = computePortfolioFit(asset({ symbol: "BAD", compositeScores: comp(30) }), p);
    const order = computePositionAction({
      symbol: "BAD",
      price: 100,
      portfolioValue: 1_000_000,
      currentShares: 0,
      targetPct: weak.suggestedAllocationPct,
      fitTier: weak.fitTier,
      isInPortfolio: weak.isInPortfolio,
      concentrationWarning: weak.concentrationWarning,
      unifiedKind: weak.action.kind,
      unifiedReason: weak.action.reason,
    });
    expect(order.kind).toBe("avoid");
    expect(order.headline).not.toMatch(/^Buy/);
  });

  it("an exit decision reaches the card as exit even when share math would trim", () => {
    const p2 = profile({ holdingSymbols: ["BAD"] });
    const weak = computePortfolioFit(asset({ symbol: "BAD", compositeScores: comp(30) }), p2);
    expect(weak.action.kind).toBe("exit");
    const order = computePositionAction({
      symbol: "BAD",
      price: 100,
      portfolioValue: 1_000_000,
      currentShares: 500,
      targetPct: weak.suggestedAllocationPct,
      fitTier: weak.fitTier,
      isInPortfolio: true,
      concentrationWarning: false,
      unifiedKind: weak.action.kind,
      unifiedReason: weak.action.reason,
    });
    expect(order.kind).toBe("exit");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Isolation — portfolio changes move fit, never research           */
/* ------------------------------------------------------------------ */

describe("portfolio changes affect fit but never the research score", () => {
  it("the same asset in three different portfolios keeps one research score and moves its fit", () => {
    const a = asset({ symbol: "TST", compositeScores: comp(78) });
    const empty = profile({ missingSectors: ["Technology"] });
    const crowded = profile({ sectorWeights: [{ sector: "Technology", weight: 38 }] });
    const held = profile({ holdingSymbols: ["TST"], sectorWeights: [{ sector: "Technology", weight: 25 }] });

    const fits = [empty, crowded, held].map((p) => computePortfolioFit(a, p));
    for (const f of fits) expect(f.researchScore).toBe(78);
    // Fit must actually respond to the portfolio.
    expect(new Set(fits.map((f) => f.fitScore)).size).toBeGreaterThan(1);
    expect(fits[0].fitScore).toBeGreaterThan(fits[1].fitScore);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Explainability — the bridge narrates the whole derivation        */
/* ------------------------------------------------------------------ */

describe("bridge explainability", () => {
  it("narrates research → portfolio effects → fit → allocation in order", () => {
    const p = profile({ sectorWeights: [{ sector: "Technology", weight: 30 }] });
    const fit = computePortfolioFit(asset({ symbol: "TST", compositeScores: comp(88) }), p);
    const labels = fit.bridge.map((s) => s.label);
    expect(labels[0]).toBe("Research quality");
    expect(labels).toContain("Portfolio effects");
    expect(labels).toContain("Portfolio fit");
    expect(labels.at(-1)).toBe("Suggested allocation");
    expect(labels.indexOf("Research quality")).toBeLessThan(labels.indexOf("Portfolio fit"));
    // The research step quotes the exact inherited number.
    expect(fit.bridge[0].value).toBe(88);
  });

  it("cites the guardrail when it binds", () => {
    // Weak research + perfect diversification → the uplift cap binds.
    const p = profile({ missingSectors: ["Utilities"] });
    const fit = computePortfolioFit(
      asset({ symbol: "DIV", sector: "Utilities", dividendYield: 3, compositeScores: comp(30) }),
      p,
    );
    if (fit.fitScore === 30 + DEFAULT_FIT_CONFIG.maxDiversificationUplift) {
      expect(fit.bridge.some((s) => s.label === "Quality guardrail")).toBe(true);
    }
  });

  it("carries both scores on the analysis for every asset", () => {
    const p = profile({});
    const fit = computePortfolioFit(asset({ symbol: "TST", compositeScores: comp(70) }), p);
    expect(fit.researchScore).toBe(70);
    expect(fit.portfolioEffectsScore).not.toBeNull();
    expect(fit.action.reason).toBeTruthy();
  });
});
