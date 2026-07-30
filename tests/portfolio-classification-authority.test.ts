/**
 * ONE CLASSIFICATION AUTHORITY — the invariant this file exists to make permanent.
 *
 * THE BUG. Two modules answered "what is this instrument?". The risk models
 * classified from what a fund HOLDS (VCLT: a long corporate bond fund). Allocation,
 * Health and the optimizer classified from the `asset_class` column, which stores
 * Yahoo's quoteType (VCLT: `etf`). The optimizer therefore produced, in one plan:
 *
 *     SELL VCLT   — "Above ETFs target"
 *     BUY  SHY    — "Below Bonds target"
 *     BUY  TIP    — "Below Bonds target"
 *     BUY  IEF    — "Below Bonds target"
 *
 * i.e. it sold a bond fund to buy bond funds, because the two engines disagreed
 * about the one holding. The fix is not a reconciliation step: `Holding.assetClass`
 * is now RESOLVED by the same authority that produces the factor loadings
 * (`resolveAssetClass`), and no engine derives a class of its own.
 *
 * These tests pin the three things that must stay true:
 *   1. the catalogue declares a class for every model, exhaustively;
 *   2. the resolved class is what the engines see, for real instruments;
 *   3. the specific contradiction cannot recur — checked by running the REAL
 *      optimizer over a portfolio containing a bond ETF booked as `etf`.
 */
import { describe, expect, it } from "vitest";
import {
  RISK_MODELS,
  assetClassFromQuoteType,
  resolveAssetClass,
  type RiskModelId,
} from "@/lib/portfolio/classes/reference/risk-models";
import { listClassAdapters, getClassAdapter } from "@/lib/portfolio/model/adapter";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation } from "@/lib/portfolio/engines/allocation";
import { optimize, DEFAULT_CONSTRAINTS } from "@/lib/portfolio/engines/optimize";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { PORTFOLIO_ASSET_CLASSES } from "@/lib/portfolio/model/types";
import type { MarketContext, PortfolioAssetClass, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures: a book that contains the exact shape that produced the bug        */
/* -------------------------------------------------------------------------- */

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

const quote = (symbol: string, price: number, assetType: string) => ({
  symbol, price, changePercent: 0, currency: "USD", name: symbol, marketCap: null, assetType,
});

/** Every fund here is booked the way the buy flow books it: quoteType ETF → `etf`. */
function ctx(): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  const fundamentals = new Map<string, Partial<Record<string, unknown>>>([
    ["VCLT", { fundCategory: "Long-Term Bond", bondWeight: 99.43 }],
    ["SHY", { fundCategory: "Short Government", bondWeight: 99.34 }],
    ["IEF", { fundCategory: "Long Government", bondWeight: 99.66 }],
    ["GLD", { fundCategory: "Commodities Focused", otherWeight: 100, bondWeight: 0, equityWeight: 0 }],
    ["VNQ", { fundCategory: "Real Estate", equityWeight: 98.8, topSector: "Real Estate", topSectorWeight: 99.5 }],
    ["BIL", { fundCategory: "Ultrashort Bond", cashWeight: 100, bondWeight: 0 }],
    ["VOO", { fundCategory: "Large Blend", equityWeight: 99.6 }],
    ["AAPL", { sector: "Technology", industry: "Consumer Electronics", country: "United States" }],
  ]);

  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes: new Map([
      ["VCLT", quote("VCLT", 73, "ETF")],
      ["SHY", quote("SHY", 82, "ETF")],
      ["IEF", quote("IEF", 93, "ETF")],
      ["GLD", quote("GLD", 380, "ETF")],
      ["VNQ", quote("VNQ", 100, "ETF")],
      ["BIL", quote("BIL", 91, "ETF")],
      ["VOO", quote("VOO", 690, "ETF")],
      ["AAPL", quote("AAPL", 200, "EQUITY")],
      ["SPAXX", quote("SPAXX", 1, "MONEYMARKET")],
    ]),
    history: new Map([
      ["VCLT", walk(300, 0.0001, 0.005, 3)],
      ["SHY", walk(300, 0.0001, 0.002, 5)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["VNQ", walk(300, 0.0002, 0.012, 17)],
      ["VOO", walk(300, 0.0004, 0.012, 7)],
      ["AAPL", walk(300, 0.0006, 0.018, 19)],
    ]),
    // Cast: the fixture states only the fields the classifier reads; every other
    // ContextFundamentals field is optional or unread on this path.
    fundamentals: fundamentals as unknown as MarketContext["fundamentals"],
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

/** The book: a bond ETF, a gold trust, a REIT fund and a T-bill fund, all booked `etf`. */
const BOOK: RawHolding[] = [
  raw({ id: "vclt", assetClass: "etf", symbol: "VCLT", name: "Vanguard Long-Term Corporate Bond ETF", quantity: 10_000, costBasis: 730_000 }),
  raw({ id: "shy", assetClass: "etf", symbol: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", quantity: 1_000, costBasis: 82_000 }),
  raw({ id: "ief", assetClass: "etf", symbol: "IEF", name: "iShares 7-10 Year Treasury Bond ETF", quantity: 1_000, costBasis: 93_000 }),
  raw({ id: "gld", assetClass: "etf", symbol: "GLD", name: "SPDR Gold Shares", quantity: 500, costBasis: 190_000 }),
  raw({ id: "vnq", assetClass: "etf", symbol: "VNQ", name: "Vanguard Real Estate ETF", quantity: 1_000, costBasis: 100_000 }),
  raw({ id: "bil", assetClass: "etf", symbol: "BIL", name: "SPDR Bloomberg 1-3 Month T-Bill ETF", quantity: 1_000, costBasis: 91_000 }),
  raw({ id: "voo", assetClass: "etf", symbol: "VOO", name: "Vanguard S&P 500 ETF", quantity: 1_000, costBasis: 690_000 }),
  raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", name: "Apple Inc.", quantity: 2_000, costBasis: 400_000 }),
  raw({ id: "cash", assetClass: "cash", symbol: null, name: "USD Cash", quantity: 500_000, unit: "currency", costBasis: 500_000 }),
];

/* -------------------------------------------------------------------------- */
/* 1. The catalogue is the authority, and it is exhaustive                     */
/* -------------------------------------------------------------------------- */

describe("the classification authority", () => {
  it("declares an asset class for every risk model", () => {
    for (const [id, def] of Object.entries(RISK_MODELS)) {
      expect(PORTFOLIO_ASSET_CLASSES, `${id} declares an unknown class`).toContain(def.assetClass);
    }
    // Every model in the union is present in the table — no model can exist without
    // a declared class, which is what makes the mapping exhaustive at compile time.
    const ids = Object.keys(RISK_MODELS) as RiskModelId[];
    expect(ids.length).toBeGreaterThan(40);
  });

  it("only ever maps a model to a class whose adapter values holdings the same way", () => {
    // The class chosen here also picks the VALUATION adapter. A model that mapped a
    // manually-valued holding into a market-priced class would silently reprice it.
    const modeOf = (c: PortfolioAssetClass) => getClassAdapter(c).valuationMode;
    for (const def of Object.values(RISK_MODELS)) {
      const mode = modeOf(def.assetClass);
      if (def.kind === "manual") expect(["manual", "derived"], def.id).toContain(mode);
      else if (def.kind === "cash") expect(mode, def.id).toBe("cash");
      else expect(mode, def.id).toBe("market");
    }
  });

  it("registers an adapter for every class the authority can return", () => {
    const registered = new Set(listClassAdapters().map((a) => a.id));
    for (const def of Object.values(RISK_MODELS)) {
      expect(registered.has(def.assetClass), `no adapter for ${def.assetClass}`).toBe(true);
    }
  });

  it("classifies from a quoteType alone at booking time, through the same authority", () => {
    expect(assetClassFromQuoteType("AAPL", "Apple Inc.", "EQUITY")).toBe("equity");
    expect(assetClassFromQuoteType("VOO", "Vanguard S&P 500 ETF", "ETF")).toBe("etf");
    expect(assetClassFromQuoteType("SPAXX", "Fidelity Money Market", "MONEYMARKET")).toBe("bond");
    expect(assetClassFromQuoteType("BTC-USD", "Bitcoin", "CRYPTOCURRENCY")).toBe("crypto");
    expect(assetClassFromQuoteType("EURUSD=X", "EUR/USD", "CURRENCY")).toBe("forex");
    // A currency instrument whose pair symbol cannot be parsed is still forex — the
    // cash class would hand it to an adapter whose contract is "quantity IS the amount".
    expect(assetClassFromQuoteType(null, "", "CURRENCY")).toBe("forex");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The engines see the resolved class                                       */
/* -------------------------------------------------------------------------- */

describe("every engine reads the resolved class", () => {
  const { holdings, totalValue } = normalizeHoldings(BOOK, ctx());
  const classOf = (id: string) => holdings.find((h) => h.id === id)!.assetClass;

  it("re-buckets a fund by what it holds, not by its wrapper", () => {
    expect(classOf("vclt")).toBe("bond");   // was `etf` — the bug
    expect(classOf("shy")).toBe("bond");
    expect(classOf("ief")).toBe("bond");
    expect(classOf("bil")).toBe("bond");    // T-bill fund: cash-LIKE, but a fund
    expect(classOf("gld")).toBe("commodity");
    expect(classOf("vnq")).toBe("reit");
    expect(classOf("voo")).toBe("etf");     // genuinely an equity fund
    expect(classOf("aapl")).toBe("equity");
    expect(classOf("cash")).toBe("cash");
  });

  it("keeps the booked class when the resolved one would change how the holding is VALUED", () => {
    // A gold bar recorded as an alternative resolves to the gold risk model, but the
    // commodity adapter would price it off a ticker it does not have.
    const bar = raw({
      id: "bar", assetClass: "alternative", name: "1kg gold bar",
      manualValue: 80_000, manualValueAsOf: new Date().toISOString(),
      meta: { details: { subcategory: "Precious Metals" } },
    });
    const { holdings: h2 } = normalizeHoldings([bar], ctx());
    expect(h2[0].assetClass).toBe("alternative");
    expect(h2[0].valuation.valueBase).toBe(80_000);
    // …while still being stress-tested as gold.
    expect(h2[0].factors.gold).toBeGreaterThan(0);
  });

  it("allocation buckets the portfolio by the resolved class", () => {
    const alloc = computeAllocation(holdings, totalValue);
    const weightOf = (key: string) => alloc.byAssetClass.slices.find((s) => s.key === key)?.weight ?? 0;
    // The four bond funds are one sleeve, and VCLT is in it.
    expect(weightOf("bond")).toBeGreaterThan(weightOf("etf"));
    expect(weightOf("commodity")).toBeGreaterThan(0);
    expect(weightOf("reit")).toBeGreaterThan(0);
    // Slices still partition the portfolio exactly.
    const sum = alloc.byAssetClass.slices.reduce((s, x) => s + x.weight, 0) + alloc.byAssetClass.unclassifiedPct;
    expect(sum).toBeCloseTo(100, 6);
  });

  it("the risk model and the asset class agree for every holding", () => {
    for (const h of holdings) {
      const resolved = resolveAssetClass({
        symbol: h.symbol, name: h.name, assetClass: h.assetClass, baseCurrency: "USD",
        quoteAssetType: ctx().quotes.get((h.symbol ?? "").toUpperCase())?.assetType ?? null,
        fundCategory: (ctx().fundamentals.get((h.symbol ?? "").toUpperCase()) as { fundCategory?: string } | undefined)?.fundCategory ?? null,
      });
      // Resolution is idempotent: feeding the resolved class back in returns it.
      expect(resolved, `${h.symbol ?? h.name} is not a fixed point`).toBe(h.assetClass);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. ONE analytics engine                                                     */
/* -------------------------------------------------------------------------- */

describe("one Portfolio analytics engine", () => {
  it("lib/portfolio-analytics.ts exports return statistics and nothing that builds a report", async () => {
    // It used to export `computePortfolioReport` — a second, equity-only portfolio
    // engine with its own health score, risk analytics, recommendations, alerts and
    // benchmark window. Retired in favour of lib/portfolio/report.ts. This test is
    // the guard that stops a report builder growing back here: the module is now a
    // leaf of pure statistics, and its export surface says so.
    const mod = await import("@/lib/portfolio-analytics");
    expect(Object.keys(mod).sort()).toEqual([
      "computeRiskAdjustedRatios",
      "dailyReturns",
      "downsideDeviation",
      "maxDrawdown",
      "mean",
      "pearson",
      "stddev",
    ]);
  });

  it("the universal report is the only module that assembles portfolio analytics", async () => {
    const report = await import("@/lib/portfolio/report");
    expect(typeof report.buildPortfolioReport).toBe("function");
    // …and it is what the IOS server hands to every personalisation surface.
    const ios = await import("@/lib/ios/server");
    expect(typeof ios.getPortfolioForIOS).toBe("function");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The contradiction itself cannot recur                                    */
/* -------------------------------------------------------------------------- */

describe("the ETF-overweight / bond-underweight contradiction", () => {
  const { holdings, totalValue } = normalizeHoldings(BOOK, ctx());
  const evaluation = evaluate(holdings, ctx());

  it("never both trims and adds a class in the same plan for CLASS-target reasons", () => {
    for (const objective of ["maximize_sharpe", "minimize_volatility", "maximize_income", "preserve_capital", "balanced", "growth", "maximize_return", "maximize_diversification"] as const) {
      const plan = optimize(evaluation, objective, DEFAULT_CONSTRAINTS, undefined, ctx());

      // Group the trades by the class each one is attributed to, but ONLY those whose
      // stated reason is the class target. A plan may legitimately trim one holding
      // and add another inside one class; what it may never do is claim the class is
      // simultaneously over and under its target.
      const byClass = new Map<string, Set<"BUY" | "SELL">>();
      for (const t of plan.trades) {
        const claimsClassTarget = / (Bonds|ETFs|Equities|REITs|Commodities|Crypto|Forex|Cash & Equivalents) target for the /.test(t.reason);
        if (!claimsClassTarget) continue;
        const holding = holdings.find((h) => h.id === t.holdingId)!;
        const set = byClass.get(holding.assetClass) ?? new Set();
        set.add(t.action as "BUY" | "SELL");
        byClass.set(holding.assetClass, set);
      }
      for (const [cls, actions] of byClass) {
        expect(
          actions.size,
          `${objective}: ${cls} is claimed BOTH over and under its target in one plan`,
        ).toBe(1);
      }
    }
  });

  it("cannot sell a bond fund for being an overweight ETF", () => {
    const plan = optimize(evaluation, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, ctx());
    const vclt = plan.trades.find((t) => t.symbol === "VCLT");
    if (vclt) {
      // Whatever the plan does with VCLT, it must not attribute it to the ETF sleeve.
      expect(vclt.reason).not.toMatch(/ETFs target/);
      expect(vclt.assetClass).toBe("bond");
    }
    // And the bond sleeve's own target must be measured WITH VCLT in it.
    const bonds = plan.classTargets.find((c) => c.assetClass === "bond");
    const bondValue = holdings.filter((h) => h.assetClass === "bond").reduce((s, h) => s + h.valuation.valueBase, 0);
    expect(bonds!.currentWeight).toBeCloseTo(Math.round((bondValue / totalValue) * 1000) / 10, 1);
  });

  it("states the real driver when a trade is intra-class rather than class-level", () => {
    const plan = optimize(evaluation, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, ctx());
    for (const t of plan.trades) {
      const holding = holdings.find((h) => h.id === t.holdingId)!;
      const label = { bond: "Bonds", etf: "ETFs", equity: "Equities", reit: "REITs", commodity: "Commodities" }[holding.assetClass as string];
      if (!label) continue;
      const classTarget = plan.classTargets.find((c) => c.assetClass === holding.assetClass)!;
      const sameDirection = (t.action === "BUY" && classTarget.delta > 0) || (t.action === "SELL" && classTarget.delta < 0);
      if (!sameDirection) {
        // The class is not moving this way, so the reason must not claim it is.
        expect(t.reason, `${t.symbol}: reason blames the class target the wrong way`).toMatch(/within/);
      }
    }
  });
});
