/**
 * "Add to Portfolio" across every asset class.
 *
 * The modal's Recommended Allocation path is only trustworthy if the sizing
 * engine answers *something coherent* for every class the app can hold — a
 * BUY with a real amount, or a HOLD with a stated reason. The bug this suite
 * guards against is the third outcome: a plan that is neither, which the old
 * modal rendered as an empty panel and no button, making the feature look
 * broken when the engine had in fact declined for a good reason.
 *
 * Both entry paths are covered per class:
 *   - computePositionSizing()          → Recommended Allocation
 *   - computePositionSizingAtAmount()  → Manual Allocation
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computePositionSizing, computePositionSizingAtAmount } from "@/lib/portfolio/engines/position-size";
import { buildAiExplanation, buildSummary, buildPositionSizingWhy } from "@/lib/portfolio/engines/position-size-explain";
import { PORTFOLIO_ASSET_CLASSES, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/** Deterministic pseudo-random walk, so vol/beta are stable across runs. */
function walk(n: number, drift: number, vol: number, seed = 1): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const out = [100];
  for (let i = 1; i < n; i++) out.push(Math.max(out[i - 1] * (1 + drift + rnd() * vol), 1));
  return out;
}

/** One representative, market-priced candidate per class — the thing the user is trying to buy. */
const CANDIDATE: Record<PortfolioAssetClass, { symbol: string; name: string; price: number }> = {
  equity:             { symbol: "AAPL",    name: "Apple",              price: 200 },
  etf:                { symbol: "VTI",     name: "Total Market ETF",   price: 250 },
  reit:               { symbol: "O",       name: "Realty Income",      price: 55 },
  bond:               { symbol: "IEF",     name: "7-10y Treasury",     price: 95 },
  crypto:             { symbol: "BTC-USD", name: "Bitcoin",            price: 60000 },
  commodity:          { symbol: "GLD",     name: "SPDR Gold",          price: 190 },
  forex:              { symbol: "EURUSD=X", name: "EUR/USD",           price: 1.08 },
  cash:               { symbol: "USD-CASH", name: "USD Cash",          price: 1 },
  real_estate:        { symbol: "RE-1",    name: "Rental Property",    price: 100 },
  private_market:     { symbol: "PM-1",    name: "Private Fund",       price: 100 },
  alternative:        { symbol: "ALT-1",   name: "Art Portfolio",      price: 100 },
  structured_product: { symbol: "SP-1",    name: "Autocallable Note",  price: 100 },
};

function ctx(): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  const quotes = new Map<string, NonNullable<ReturnType<MarketContext["quotes"]["get"]>>>();
  const history = new Map<string, number[]>();
  let seed = 3;
  for (const cls of PORTFOLIO_ASSET_CLASSES) {
    const c = CANDIDATE[cls];
    quotes.set(c.symbol, { symbol: c.symbol, price: c.price, changePercent: 0.5, currency: "USD", name: c.name, marketCap: null });
    history.set(c.symbol, walk(300, 0.0004, 0.015, (seed += 7)));
  }
  // The existing portfolio's own holdings.
  quotes.set("MSFT", { symbol: "MSFT", price: 400, changePercent: 0.4, currency: "USD", name: "Microsoft", marketCap: 3e12 });
  history.set("MSFT", walk(300, 0.0005, 0.017, 101));

  return {
    baseCurrency: "USD",
    fx: { USD: 1, EUR: 1.08 },
    quotes,
    history,
    fundamentals: new Map([
      ["MSFT", {
        sector: "Technology", industry: "Software", country: "United States", currency: "USD",
        dividendYield: 0.008, duration: null, maturity: null, creditQuality: null, expenseRatio: null,
        marketCap: 3e12, peRatio: 32, priceToBook: 12, returnOnEquity: 0.42, revenueGrowth: 0.12,
        operatingMargins: 0.44, debtToEquity: 40, operatingCashflow: 9e10, beta: 1.1,
      }],
    ]),
    benchmarkReturns,
    asOf: new Date().toISOString(),
  };
}

function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

/** A realistic, diversified starting portfolio with plenty of cash to fund a buy. */
function basePortfolio(c: MarketContext) {
  const holdings = normalizeHoldings(
    [
      raw({ id: "h-msft", assetClass: "equity", symbol: "MSFT", quantity: 100, costBasis: 30000 }),
      raw({ id: "h-ief", assetClass: "bond", symbol: "IEF", quantity: 20000, unit: "face", costBasis: 20000 }),
      raw({ id: "h-cash", assetClass: "cash", symbol: null, quantity: 50000, unit: "units", manualValue: 50000, costBasis: 50000 }),
    ],
    c,
  ).holdings;
  return evaluate(holdings, c);
}

describe("Add to Portfolio — every asset class", () => {
  const c = ctx();
  const evaluation = basePortfolio(c);

  for (const cls of PORTFOLIO_ASSET_CLASSES) {
    const target = { symbol: CANDIDATE[cls].symbol, name: CANDIDATE[cls].name, assetClass: cls };

    describe(cls, () => {
      it("returns a coherent recommendation — a sized BUY or an explained HOLD, never silence", () => {
        const plan = computePositionSizing(evaluation, target, "maximize_sharpe", c);

        expect(plan.symbol).toBe(target.symbol.toUpperCase());
        expect(plan.assetClass).toBe(cls);
        expect(["BUY", "HOLD"]).toContain(plan.action);

        if (plan.action === "BUY") {
          // A BUY must be actionable: a real amount, a real resulting weight.
          expect(plan.recommendedAmount).toBeGreaterThan(0);
          expect(Number.isFinite(plan.recommendedAmount)).toBe(true);
          expect(plan.recommendedAllocationPct).toBeGreaterThan(0);
          expect(Number.isFinite(plan.recommendedAllocationPct)).toBe(true);
          expect(plan.holdReason).toBeNull();
        } else {
          // A HOLD must say why — this is exactly what the modal now renders
          // instead of an empty panel.
          expect(plan.holdReason, `${cls} returned HOLD with no reason`).toBeTruthy();
          expect(plan.holdReason!.length).toBeGreaterThan(10);
          expect(plan.recommendedAmount).toBe(0);
        }
      });

      it("narrates its recommendation in non-empty English", () => {
        const plan = computePositionSizing(evaluation, target, "maximize_sharpe", c);

        expect(buildSummary(plan).trim().length).toBeGreaterThan(0);
        expect(buildAiExplanation(plan).trim().length).toBeGreaterThan(0);

        const why = buildPositionSizingWhy(plan);
        expect(why).toBeTruthy();
      });

      it("sizes a manual amount without NaN or negative weights", () => {
        const plan = computePositionSizingAtAmount(evaluation, target, 5000, "maximize_sharpe", c);

        expect(["BUY", "HOLD"]).toContain(plan.action);
        if (plan.action === "BUY") {
          expect(plan.recommendedAmount).toBe(5000);
          expect(Number.isFinite(plan.recommendedAllocationPct)).toBe(true);
          expect(plan.recommendedAllocationPct).toBeGreaterThan(0);
          // The before/after simulation must stay internally consistent.
          expect(Number.isFinite(plan.after.totalValue)).toBe(true);
          expect(plan.after.totalValue).toBeGreaterThan(0);
          for (const h of plan.after.holdings) {
            expect(Number.isFinite(h.weight), `${cls}: NaN weight on ${h.id}`).toBe(true);
            expect(h.weight).toBeGreaterThanOrEqual(0);
          }
        } else {
          expect(plan.holdReason).toBeTruthy();
        }
      });

      it("computes shares consistently with the quoted price", () => {
        const plan = computePositionSizingAtAmount(evaluation, target, 5000, "maximize_sharpe", c);
        if (plan.action !== "BUY" || plan.price == null || plan.recommendedShares == null) return;

        // shares × price must reconstruct the amount (within the engine's own
        // 3-decimal share rounding).
        const reconstructed = plan.recommendedShares * plan.price;
        expect(Math.abs(reconstructed - plan.recommendedAmount)).toBeLessThan(Math.max(1, plan.price));
      });
    });
  }

  // The objective's target allocation decides which classes are eligible at all.
  // maximize_sharpe targets equity/etf/bond/reit/commodity/cash and allocates
  // nothing to crypto, forex or the manual classes — so those must decline, and
  // must say that is why. Guards both directions: a refactor that made
  // everything HOLD would fail the first assertion, and one that let the
  // diversification dimensions talk the engine into a zero-target class (it
  // once recommended 13% in bitcoin under this very objective) fails the second.
  it("recommends only into classes the objective actually targets", () => {
    const TARGETED: PortfolioAssetClass[] = ["equity", "etf", "bond", "reit", "commodity", "cash"];

    const buys: PortfolioAssetClass[] = [];
    for (const cls of PORTFOLIO_ASSET_CLASSES) {
      const plan = computePositionSizing(evaluation, { ...CANDIDATE[cls], assetClass: cls }, "maximize_sharpe", c);
      if (plan.action === "BUY") buys.push(cls);

      if (!TARGETED.includes(cls)) {
        expect(plan.action, `${cls} has no target under maximize_sharpe but was recommended`).toBe("HOLD");
        expect(plan.holdReason).toMatch(/allocates nothing|target/i);
      }
    }

    // At least some targeted class must still be recommendable, or the engine
    // is simply refusing everything again.
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((c) => TARGETED.includes(c))).toBe(true);
  });

  it("sizes any manual amount for every class, targeted or not", () => {
    // Manual Allocation is the user's override of the objective — it must work
    // even for classes the optimizer would never pick on its own.
    for (const cls of PORTFOLIO_ASSET_CLASSES) {
      const plan = computePositionSizingAtAmount(evaluation, { ...CANDIDATE[cls], assetClass: cls }, 5000, "maximize_sharpe", c);
      expect(plan.action, `manual sizing failed for ${cls}: ${plan.holdReason}`).toBe("BUY");
      expect(plan.recommendedAmount).toBe(5000);
    }
  });

  it("handles an asset with no live price by declining with a reason, not a crash", () => {
    const plan = computePositionSizing(
      evaluation,
      { symbol: "NOPRICE", name: "Unpriced Thing", assetClass: "equity" },
      "maximize_sharpe",
      c,
    );
    expect(plan.action).toBe("HOLD");
    expect(plan.holdReason).toBeTruthy();
    expect(plan.recommendedAmount).toBe(0);
  });

  it("adds to an already-held position rather than reporting a fresh one", () => {
    // MSFT is already held — the resulting weight must exceed its current one.
    const before = evaluation.holdings.find((h) => h.symbol === "MSFT")!;
    const plan = computePositionSizingAtAmount(
      evaluation,
      { symbol: "MSFT", name: "Microsoft", assetClass: "equity" },
      5000,
      "maximize_sharpe",
      c,
    );
    if (plan.action !== "BUY") return;
    expect(plan.recommendedAllocationPct).toBeGreaterThan(before.weight);
  });
});
