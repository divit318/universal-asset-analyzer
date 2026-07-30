/**
 * Stress-test bounds — the 2026-07-29 Risk Lab audit.
 *
 * THE BUG: the scenario engine summed each factor's `sensitivity × shock` as a
 * SIMPLE return and floored the total at −100%. On the real book TSM carries a
 * measured equity beta of 2.14, and "2008 Financial Crisis" shocks equities −50%,
 * so the sum was −105.2%: a long-only, unlevered position projected to lose more
 * than its entire value. The floor then published that as "−100.0%" / −$564,535,
 * i.e. a total wipeout of a large-cap that actually fell ~55% in 2008, and the UI
 * papered over it with a "≤" prefix.
 *
 * The fix is in the composition, not in the display: sensitivities are log-price
 * derivatives, so they add in LOG space and convert back through exp — which is
 * bounded below by −100% for any finite exposure. These tests assert that bound
 * across the FULL holdings × scenarios matrix, plus the two properties a bound
 * must not buy at the cost of understating risk: a beta of 1.0 still loses exactly
 * the market's move, and small shocks still agree with the linear model.
 */
import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  applyShocks,
  runScenario,
  runCustomScenario,
  type FactorShocks,
} from "@/lib/portfolio/engines/scenario";
import {
  CLASS_FACTORS,
  COMMODITY_FACTORS,
  SECTOR_FACTORS,
  mergeFactors,
} from "@/lib/portfolio/classes/reference/factor-sensitivities";
import { FACTORS } from "@/lib/portfolio/model/types";
import type { FactorSensitivities, Holding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* The matrix                                                                  */
/* -------------------------------------------------------------------------- */

function holding(name: string, factors: FactorSensitivities, valueBase = 500_000): Holding {
  return {
    id: name,
    assetClass: "equity",
    symbol: name,
    name,
    currency: "USD",
    quantity: 1,
    unit: "shares",
    costBasis: valueBase,
    costBasisBase: valueBase,
    acquiredAt: "2024-01-01",
    valuation: {
      mode: "market",
      value: valueBase,
      valueBase,
      fxRate: 1,
      source: "yahoo",
      asOf: "2026-07-29T00:00:00.000Z",
      stale: false,
    },
    weight: 0,
    unrealizedPL: null,
    unrealizedPct: null,
    liquidity: "t0",
    income: null,
    factors,
    metrics: {},
    attributes: {},
    score: null,
    meta: {},
  };
}

/**
 * Every holding shape the app can actually produce, and then some.
 *
 * Built from the SHIPPED reference tables (CLASS_FACTORS, SECTOR_FACTORS,
 * COMMODITY_FACTORS) rather than from hand-copied numbers, so a future edit to a
 * coefficient — or a new asset class — is covered by these bounds automatically.
 * Betas run past anything real (8.0) because the bound must hold structurally,
 * not because the inputs happen to be modest.
 */
function everyHolding(): Holding[] {
  const out: Holding[] = [];

  for (const [cls, factors] of Object.entries(CLASS_FACTORS)) {
    out.push(holding(`class:${cls}`, factors));
    // Equity-like classes get a MEASURED beta that overrides the class default —
    // which is exactly where the bug came from.
    for (const beta of [0.25, 1, 1.52, 2.14, 3.5, 8]) {
      out.push(holding(`class:${cls}:beta${beta}`, mergeFactors(factors, { equityBeta: beta })));
    }
  }

  for (const [sector, factors] of Object.entries(SECTOR_FACTORS)) {
    for (const beta of [1, 2.14, 3.5, 8]) {
      out.push(holding(
        `${sector}:beta${beta}`,
        mergeFactors(CLASS_FACTORS.equity, factors, { equityBeta: beta }),
      ));
    }
  }

  for (const [bucket, factors] of Object.entries(COMMODITY_FACTORS)) {
    out.push(holding(`commodity:${bucket}`, factors));
  }

  // Extremes that no provider would return, to prove the bound is structural:
  // a 30-year zero's duration, a junk credit beta, a heavily levered property.
  out.push(holding("duration30", { rates: -30, creditSpread: -1 }));
  out.push(holding("junk", { creditSpread: -7, equityBeta: 0.6 }));
  out.push(holding("levered_property", { realEstateCap: -25, rates: -4, equityBeta: 0.8 }));
  out.push(holding("everything", Object.fromEntries(FACTORS.map((f) => [f, -5])) as FactorSensitivities));

  return out;
}

/* -------------------------------------------------------------------------- */

describe("stress-test impacts are bounded by the position's value", () => {
  const holdings = everyHolding();

  it("no holding loses more than 100% of itself, in any scenario", () => {
    for (const s of SCENARIOS) {
      for (const h of holdings) {
        const impact = applyShocks(h, s.shocks);
        expect(
          impact.impactPct,
          `${h.name} in ${s.id} → ${impact.impactPct}% (${JSON.stringify(h.factors)})`,
        ).toBeGreaterThan(-100);
      }
    }
  });

  it("no holding's dollar impact exceeds its own value, in any scenario", () => {
    for (const s of SCENARIOS) {
      for (const h of holdings) {
        const impact = applyShocks(h, s.shocks);
        expect(impact.impactValue, `${h.name} in ${s.id}`)
          .toBeGreaterThan(-h.valuation.valueBase);
      }
    }
  });

  it("every impact is a finite number", () => {
    for (const s of SCENARIOS) {
      for (const h of holdings) {
        const impact = applyShocks(h, s.shocks);
        expect(Number.isFinite(impact.impactPct), `${h.name} in ${s.id}`).toBe(true);
        expect(Number.isFinite(impact.impactValue), `${h.name} in ${s.id}`).toBe(true);
        for (const d of impact.drivers) {
          expect(Number.isFinite(d.contribution), `${h.name} in ${s.id} driver ${d.factor}`).toBe(true);
        }
      }
    }
  });

  it("the portfolio total cannot fall below −100% either", () => {
    const total = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
    for (const s of SCENARIOS) {
      const res = runScenario(s, holdings, total);
      expect(res.portfolioImpactPct, s.id).toBeGreaterThan(-100);
      expect(res.portfolioImpactValue, s.id).toBeGreaterThan(-total);
    }
  });

  it("holds for a custom scenario too, including a total wipeout of a factor", () => {
    // The API accepts any finite shock (app/api/portfolio/scenario/route.ts), so
    // "equities go to zero" is reachable input. It must still be a number.
    const wipeouts: FactorShocks[] = [
      { equityBeta: -100 },
      { equityBeta: -100, cryptoBeta: -100, oil: -100, gold: -100, usd: -100 },
      { equityBeta: -400 },
      { rates: 50 },
      { rates: 50, creditSpread: 40, realEstateCap: 30, liquidityStress: 1 },
    ];
    const total = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);

    for (const shocks of wipeouts) {
      for (const h of holdings) {
        const impact = applyShocks(h, shocks);
        expect(Number.isFinite(impact.impactPct), `${h.name} ${JSON.stringify(shocks)}`).toBe(true);
        expect(impact.impactPct, `${h.name} ${JSON.stringify(shocks)}`).toBeGreaterThanOrEqual(-100);
      }
      const res = runCustomScenario(shocks, holdings, total);
      expect(res.portfolioImpactPct).toBeGreaterThanOrEqual(-100);
    }
  });
});

describe("the bound does not understate risk", () => {
  it("a beta of 1.0 loses exactly the equity shock", () => {
    const h = holding("beta1", { equityBeta: 1 });
    for (const shock of [-5, -12, -18, -25, -34, -35, -50]) {
      expect(applyShocks(h, { equityBeta: shock }).impactPct).toBe(shock);
    }
  });

  it("a beta above 1 still loses more than the market, monotonically", () => {
    const impacts = [1, 1.5, 2.14, 3.5].map(
      (beta) => applyShocks(holding(`b${beta}`, { equityBeta: beta }), { equityBeta: -50 }).impactPct,
    );
    expect(impacts[0]).toBe(-50);
    for (let i = 1; i < impacts.length; i++) {
      expect(impacts[i], `beta index ${i}`).toBeLessThan(impacts[i - 1]);
    }
  });

  it("agrees with the linear model at ordinary shock sizes", () => {
    // The correction is a tail correction. At the shock sizes most scenarios use,
    // log and linear composition must not visibly disagree — otherwise the fix
    // would have quietly repriced every routine stress test.
    const cases: { factors: FactorSensitivities; shocks: FactorShocks }[] = [
      { factors: { equityBeta: 1.1, rates: -1.8 }, shocks: { equityBeta: -12, rates: 1 } },
      { factors: { rates: -7.4, creditSpread: 1.2 }, shocks: { rates: 0.5, creditSpread: 1 } },
      { factors: { gold: 1, liquidityStress: 0.3 }, shocks: { gold: 5, liquidityStress: 0.3 } },
      { factors: { inflation: -1, liquidityStress: 0.1 }, shocks: { inflation: 1, liquidityStress: 1 } },
    ];

    for (const c of cases) {
      const linear = (Object.entries(c.shocks) as [keyof FactorSensitivities, number][])
        .reduce((sum, [f, shock]) => sum + (c.factors[f] ?? 0) * shock, 0);
      const actual = applyShocks(holding("x", c.factors), c.shocks).impactPct;
      expect(Math.abs(actual - linear), `${JSON.stringify(c)} → ${actual} vs ${linear}`)
        .toBeLessThan(0.6);
    }
  });

  it("a crisis loss on a high-beta name is still a crisis loss", () => {
    // The exact holding that produced the bug: TSM, measured beta 2.14, Technology
    // sector modifiers, under "2008 Financial Crisis". −105.2% before; a severe but
    // survivable loss now — and TSM's actual 2008 drawdown was around −55%.
    const tsm = holding("TSM", mergeFactors(SECTOR_FACTORS.Technology, { equityBeta: 2.14 }), 560_507);
    const gfc = SCENARIOS.find((s) => s.id === "gfc_2008")!;
    const impact = applyShocks(tsm, gfc.shocks);

    expect(impact.impactPct).toBeGreaterThan(-100);
    expect(impact.impactPct).toBeLessThan(-60);
    expect(impact.impactValue).toBeGreaterThan(-560_507);
  });
});
