/**
 * Portfolio Alignment engine — economic-defensibility suite.
 *
 * This replaces tests/portfolio-health.test.ts, and guards a different claim:
 * not "is this portfolio healthy by universal standards" (a claim UAA no longer
 * makes) but "how far does this book sit from ITS OWNER'S stated policy".
 *
 * The properties an investment committee would demand of that claim:
 *
 *  1. PREFERENCES BIND. The same book scores differently under different
 *     policies, in the direction the policy states — and identically where the
 *     policies agree.
 *  2. DELIBERATE CHOICES ARE NOT PENALIZED. Concentration inside the stated
 *     cap, zero yield under a total-return policy, and home bias under a
 *     home-bias policy are all ALIGNED, not deficiencies.
 *  3. ONE RISK, CHARGED ONCE. Co-movement is priced inside the concentration
 *     theme (clusters count as one bet); there is no separate correlation /
 *     diversification / geography stack re-penalizing the same fact.
 *  4. HONEST GAPS. Unmeasurable themes are excluded BY NAME; when most of the
 *     stated priorities cannot be measured the verdict is "insufficient",
 *     never a precise-looking number.
 *  5. SOUND ARITHMETIC. Bounds, determinism, share normalization, and a total
 *     that reconciles to Σ(theme × share) exactly.
 */

import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation } from "@/lib/portfolio/engines/allocation";
import { computeRisk, HIGH_CORRELATION_R } from "@/lib/portfolio/engines/risk";
import {
  alignmentLabelOf,
  computeAlignment,
  detectPolicyConflicts,
  toleranceScore,
  type AlignmentReport,
} from "@/lib/portfolio/alignment/engine";
import { correlationClusters } from "@/lib/portfolio/alignment/cluster";
import { DEFAULT_POLICY, derivePolicy, type InvestorPolicy, type PolicyAnswers } from "@/lib/portfolio/alignment/policy";
import { evaluate, estimateImpact, simulate } from "@/lib/portfolio/engines/simulate";
import type { ContextFundamentals, MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures (carried over from the retired health suite)                       */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random walk, so vol/beta/correlation are stable. */
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

/** A second series that tracks the first with tiny noise → pairwise r ≈ 1. */
function echo(base: number[], seed = 5, noise = 0.001): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  return base.map((v) => Math.max(v * (1 + rnd() * noise), 1));
}

function fund(o: Partial<ContextFundamentals>): ContextFundamentals {
  return {
    sector: null, industry: null, country: null, currency: "USD",
    dividendYield: null, duration: null, maturity: null, creditQuality: null,
    expenseRatio: null, marketCap: null, peRatio: null, priceToBook: null,
    returnOnEquity: null, revenueGrowth: null, operatingMargins: null,
    debtToEquity: null, operatingCashflow: null, beta: null, ...o,
  };
}

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  const q = (symbol: string, price: number, currency = "USD", changePercent: number | null = 0.5) =>
    [symbol, { symbol, price, changePercent, currency, name: symbol, marketCap: 1e11 }] as const;

  const aapl = walk(300, 0.0006, 0.018, 3);

  return {
    baseCurrency: "USD",
    fx: { USD: 1, EUR: 1.08 },
    quotes: new Map([
      q("AAPL", 200), q("MSFT", 400), q("JNJ", 150),
      q("SAP.DE", 100, "EUR"),
      q("IEF", 95), q("GLD", 190), q("BTC-USD", 60000),
      // Two near-clones of AAPL for the cluster tests: same walk, tiny noise.
      q("QQQM", 210), q("VOO", 480),
    ]),
    history: new Map([
      ["AAPL", aapl],
      ["MSFT", walk(300, 0.0005, 0.016, 5)],
      ["JNJ", walk(300, 0.0003, 0.01, 21)],
      ["SAP.DE", walk(300, 0.0004, 0.017, 29)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["BTC-USD", walk(300, 0.001, 0.045, 17)],
      ["QQQM", echo(aapl, 41)],
      ["VOO", echo(aapl, 43)],
    ]),
    fundamentals: new Map<string, ContextFundamentals>([
      ["AAPL", fund({ sector: "Technology", country: "United States", dividendYield: 0.005, marketCap: 3e12, peRatio: 30, returnOnEquity: 0.55, revenueGrowth: 0.08, operatingMargins: 0.3, debtToEquity: 150, beta: 1.25, priceToBook: 45, operatingCashflow: 1.1e11 })],
      ["MSFT", fund({ sector: "Technology", country: "United States", dividendYield: 0.007, marketCap: 3e12, peRatio: 32, returnOnEquity: 0.4, revenueGrowth: 0.12, operatingMargins: 0.42, debtToEquity: 60, beta: 0.9, priceToBook: 14, operatingCashflow: 1e11 })],
      ["JNJ", fund({ sector: "Healthcare", country: "United States", dividendYield: 0.03, marketCap: 4e11, peRatio: 15, returnOnEquity: 0.25, revenueGrowth: 0.04, operatingMargins: 0.25, debtToEquity: 45, beta: 0.6, priceToBook: 5, operatingCashflow: 2.5e10 })],
      ["SAP.DE", fund({ sector: "Technology", country: "Germany", currency: "EUR", dividendYield: 0.015, marketCap: 2e11, peRatio: 25, returnOnEquity: 0.18, revenueGrowth: 0.09, operatingMargins: 0.28, debtToEquity: 40, beta: 1.0, priceToBook: 4, operatingCashflow: 8e9 })],
      ["IEF", fund({ sector: null, country: "United States", dividendYield: 0.035, duration: 7.4, maturity: 8.5, creditQuality: "us_government", expenseRatio: 0.15 })],
      ["QQQM", fund({ sector: "Technology", country: "United States", dividendYield: 0.006, marketCap: 2e11, beta: 1.15 })],
      ["VOO", fund({ sector: "Technology", country: "United States", dividendYield: 0.013, marketCap: 3e11, beta: 1.0 })],
    ]),
    benchmarkReturns,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

function alignmentOf(rs: RawHolding[], policy: InvestorPolicy = DEFAULT_POLICY, c: MarketContext = ctx()): AlignmentReport {
  const { holdings, totalValue } = normalizeHoldings(rs, c);
  const alloc = computeAllocation(holdings, totalValue);
  const risk = computeRisk(holdings, totalValue, alloc, c);
  return computeAlignment(holdings, totalValue, alloc, risk, policy);
}

const theme = (r: AlignmentReport, id: string) => r.themes.find((t) => t.id === id)!;

const answers = (over: Partial<PolicyAnswers>): PolicyAnswers => ({
  goal: "balanced", horizon: "medium", drawdown: "moderate", concentration: "focused",
  liquidity: "buffer", income: "no", inflation: "no", exposure: "home", ...over,
});

/* Canonical books */
const P = {
  balanced: () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 40 }),
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 60 }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 300 }),
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }),
    raw({ id: "cash", assetClass: "cash", quantity: 15_000, unit: "currency" }),
  ],
  // AAPL ≈ 26% of a ~$100k book — the prompt's motivating shape. Values
  // hand-summed: 26,000 + 19,200 + 18,000 + 24,700 + 12,000 = 99,900, so
  // AAPL = 26,000 / 99,900 ≈ 26.0% and is the LARGEST position by design.
  concentrated: () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 130 }), // 130 × $200 = $26,000
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 48 }), // 48 × $400 = $19,200
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 120 }), // 120 × $150 = $18,000
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 260 }), // 260 × $95 = $24,700
    raw({ id: "cash", assetClass: "cash", quantity: 12_000, unit: "currency" }),
  ],
  allBond: () => [raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 500 })],
  allCash: () => [raw({ id: "c", assetClass: "cash", quantity: 100_000, unit: "currency" })],
};

/* -------------------------------------------------------------------------- */
/* 0. The shared ruler                                                         */
/* -------------------------------------------------------------------------- */

describe("toleranceScore — one documented curve for every check", () => {
  it("reads 100 comfortably inside, 75 at the limit, 20 at double the limit (hand-computed)", () => {
    // Hand-computed from the definition: inside headroom ≥10% → 100;
    // at the limit breach = 0 → 75; breach = 1.0 → 75 − 55 = 20.
    expect(toleranceScore(10, 20)).toBe(100);
    expect(toleranceScore(20, 20)).toBe(75);
    expect(toleranceScore(40, 20)).toBe(20);
  });

  it("is continuous through the limit (no cliff between 19.99% and 20.01%)", () => {
    const below = toleranceScore(19.99, 20);
    const above = toleranceScore(20.01, 20);
    expect(Math.abs(below - above)).toBeLessThan(0.5);
  });

  it("inverts cleanly for floors ('at least X')", () => {
    expect(toleranceScore(20, 10, true)).toBe(100); // double the floor
    expect(toleranceScore(10, 10, true)).toBe(75); // at the floor
    expect(toleranceScore(0, 10, true)).toBe(20); // nothing vs the floor
  });

  it("is monotone in the value", () => {
    let prev = Infinity;
    for (let v = 0; v <= 60; v += 1) {
      const s = toleranceScore(v, 20);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 1. Preferences bind — the core product claim                                */
/* -------------------------------------------------------------------------- */

describe("alignment — the investor's policy decides the verdict", () => {
  it("the SAME concentrated book is a mismatch under a 10% cap and aligned under a 35% cap", () => {
    const strict = alignmentOf(P.concentrated(), derivePolicy(answers({ concentration: "diversified" }))); // cap 10
    const conviction = alignmentOf(P.concentrated(), derivePolicy(answers({ concentration: "conviction" }))); // cap 35

    expect(theme(strict, "concentration").status).toBe("mismatch");
    expect(theme(conviction, "concentration").status).toBe("aligned");
    // And the mismatch names the offender with the gap in pp.
    const m = strict.mismatches.find((x) => x.themeId === "concentration")!;
    expect(m.stated).toContain("10%");
    expect(m.excess).toMatch(/^\+\d+(\.\d+)?pp$/);
    expect(m.holdings).toContain("AAPL");
  });

  it("zero yield is a fact under a total-return policy and a mismatch under an income policy", () => {
    const growthBook = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 50 }),
    ];
    const totalReturn = alignmentOf(growthBook, derivePolicy(answers({ income: "no" })));
    const needsIncome = alignmentOf(growthBook, derivePolicy(answers({ income: "living" })));

    const trTheme = theme(totalReturn, "income");
    expect(trTheme.score).toBeNull();
    expect(trTheme.unratedReason).toBe("opted_out");
    expect(trTheme.weightShare).toBe(0);

    const incTheme = theme(needsIncome, "income");
    expect(incTheme.status).toBe("mismatch"); // ~0.6% yield vs 4.5% required
    expect(needsIncome.score!).toBeLessThan(totalReturn.score!);
  });

  it("meeting the income requirement scores 100 with NO extra credit for surplus yield (no yield-chasing)", () => {
    // A high-yield book: IEF 47,500 @3.5% + JNJ 15,000 @3% = 2,112.50/yr on
    // 72,500 ≈ 2.9% yield (hand-computed) — roughly DOUBLE the 1.5% "some"
    // requirement. If surplus earned extra credit this would need >100 to
    // express; the cap at exactly 100 is the no-yield-chasing property.
    const incomeBook = [
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 500 }),
      raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
      raw({ id: "cash", assetClass: "cash", quantity: 10_000, unit: "currency" }),
    ];
    const modest = alignmentOf(incomeBook, derivePolicy(answers({ income: "some" }))); // requires 1.5
    const t = theme(modest, "income");
    expect(t.score).toBe(100);
    expect(t.status).toBe("aligned");
  });

  it("home bias is a fact by default and a mismatch only when the investor asks for spread", () => {
    const usBook = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
    ];
    const homeOk = alignmentOf(usBook, DEFAULT_POLICY);
    expect(theme(homeOk, "exposure").unratedReason).toBe("opted_out");

    const wantsGlobal = alignmentOf(usBook, derivePolicy(answers({ exposure: "global" })));
    const t = theme(wantsGlobal, "exposure");
    expect(t.status).toBe("mismatch"); // 100% one region vs ≤72% ceiling
    expect(t.mismatch!.actual).toContain("100");
  });

  it("a growth mandate flags an all-bond book on structure; a preservation mandate does not", () => {
    const growth = alignmentOf(P.allBond(), derivePolicy(answers({ goal: "growth", drawdown: "deep" })));
    const preserve = alignmentOf(P.allBond(), derivePolicy(answers({ goal: "preservation" })));
    expect(theme(growth, "structure").status).toBe("mismatch");
    expect(["aligned", "tension"]).toContain(theme(preserve, "structure").status);
  });

  it("downside tolerance binds: a crypto-heavy book fails a 15% tolerance and passes a 60% one on the same facts", () => {
    const cryptoBook = [
      raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 1, unit: "coins" }),
      raw({ id: "cash", assetClass: "cash", quantity: 15_000, unit: "currency" }),
    ];
    const timid = alignmentOf(cryptoBook, derivePolicy(answers({ drawdown: "shallow" })));
    const hardened = alignmentOf(cryptoBook, derivePolicy(answers({ drawdown: "severe" })));
    const timidTheme = theme(timid, "resilience");
    const hardenedTheme = theme(hardened, "resilience");
    expect(timidTheme.scoreExact!).toBeLessThan(hardenedTheme.scoreExact!);
    expect(timidTheme.status).toBe("mismatch");
  });

  it("liquidity floor binds: an illiquid-heavy book fails a 50% floor and passes a 0% floor", () => {
    const now = new Date().toISOString();
    const illiquidBook = [
      raw({ id: "house", assetClass: "real_estate", name: "Home", costBasis: 300_000, manualValue: 400_000, manualValueAsOf: now, meta: { details: { propertyType: "SFH", address: "x", annualRentalIncome: null, annualExpenses: null, outstandingMortgage: 0, mortgageRatePercent: 0 } } }),
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
      raw({ id: "cash", assetClass: "cash", quantity: 10_000, unit: "currency" }),
    ];
    const needsAccess = alignmentOf(illiquidBook, derivePolicy(answers({ liquidity: "half" })));
    const locked = alignmentOf(illiquidBook, derivePolicy(answers({ liquidity: "locked" })));
    expect(theme(needsAccess, "liquidity").status).toBe("mismatch");
    expect(theme(needsAccess, "liquidity").scoreExact!).toBeLessThan(theme(locked, "liquidity").scoreExact!);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. One risk, charged once                                                   */
/* -------------------------------------------------------------------------- */

describe("alignment — co-movement is priced once, inside concentration", () => {
  // Both books total $43,550 with an identical largest position (22.0%), so
  // the single-name cap check reads the SAME on both sides — the only fact
  // that differs is whether the three risk names move as one trade.
  const clusterBook = () => [
    // Three tickers on (near-)identical return series: one bet, three names.
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 45 }), // $9,000
    raw({ id: "qqqm", assetClass: "etf", symbol: "QQQM", quantity: 45 }), // $9,450
    raw({ id: "voo", assetClass: "etf", symbol: "VOO", quantity: 20 }), // $9,600
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 100 }), // $9,500
    raw({ id: "cash", assetClass: "cash", quantity: 6_000, unit: "currency" }),
  ];
  const independentBook = () => [
    // Same shape and sizes, but the three risk names move independently.
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 45 }), // $9,000
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 24 }), // $9,600
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 63 }), // $9,450
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 100 }), // $9,500
    raw({ id: "cash", assetClass: "cash", quantity: 6_000, unit: "currency" }),
  ];

  it("detects the cluster and treats it as one bet against the cap allowance", () => {
    const r = alignmentOf(clusterBook());
    const t = theme(r, "concentration");
    const clusterFact = t.facts.find((f) => f.label === "Largest correlated cluster");
    expect(clusterFact).toBeDefined();
    // All three co-moving names belong to the one cluster.
    for (const s of ["AAPL", "QQQM", "VOO"]) expect(clusterFact!.holdings).toContain(s);
  });

  it("scores the clustered book below the independent one on concentration — and charges it nowhere else", () => {
    const clustered = alignmentOf(clusterBook());
    const independent = alignmentOf(independentBook());

    expect(theme(clustered, "concentration").scoreExact!).toBeLessThan(
      theme(independent, "concentration").scoreExact!,
    );
    // The liquidity and income themes see identical facts — co-movement must
    // not leak into them (the old engine charged it to three dimensions).
    expect(theme(clustered, "liquidity").score).toBe(theme(independent, "liquidity").score);
    expect(theme(clustered, "income").unratedReason).toBe(theme(independent, "income").unratedReason);
  });

  it("correlationClusters: hand-built matrix → union-find components with summed weights", () => {
    // A-B r=0.9 (edge), B-C r=0.9 (edge), D isolated. One cluster {A,B,C}.
    const matrix = [
      [1, 0.9, 0.2, 0.1],
      [0.9, 1, 0.9, 0.1],
      [0.2, 0.9, 1, 0.1],
      [0.1, 0.1, 0.1, 1],
    ];
    const holdings = [
      { symbol: "A", weight: 30 }, { symbol: "B", weight: 20 },
      { symbol: "C", weight: 10 }, { symbol: "D", weight: 40 },
    ] as never[];
    const clusters = correlationClusters(
      { symbols: ["A", "B", "C", "D"], matrix, highPairs: [], avgCorrelation: 0.4, excluded: [] },
      holdings,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].symbols.sort()).toEqual(["A", "B", "C"]);
    expect(clusters[0].weight).toBeCloseTo(60, 9); // 30 + 20 + 10, hand-summed
    expect(clusters[0].avgR).toBeGreaterThan(HIGH_CORRELATION_R - 0.2);
  });

  it("correlationClusters: null matrix or no super-threshold pair → no clusters", () => {
    expect(correlationClusters(null, [])).toEqual([]);
    const weak = correlationClusters(
      { symbols: ["A", "B"], matrix: [[1, 0.3], [0.3, 1]], highPairs: [], avgCorrelation: 0.3, excluded: [] },
      [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }] as never[],
    );
    expect(weak).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Honest gaps                                                              */
/* -------------------------------------------------------------------------- */

describe("alignment — missing evidence is named, never blended", () => {
  it("an enabled exposure theme on an unclassifiable book is excluded BY NAME", () => {
    // Cash has no geography; the investor asked for global spread anyway.
    const r = alignmentOf(P.allCash(), derivePolicy(answers({ exposure: "global" })));
    const t = theme(r, "exposure");
    expect(t.score).toBeNull();
    expect(t.unratedReason).toBe("insufficient_data");
    expect(r.dataGaps).toContain("Geography & currency");
  });

  it("when most stated priorities are unmeasurable the verdict is 'insufficient', not a number", () => {
    // A policy that cares ONLY about geographic spread, on an all-cash book.
    const exposureOnly: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { structure: 0, resilience: 0, concentration: 0, liquidity: 0, income: 0, inflation: 0, exposure: 3 },
    };
    const r = alignmentOf(P.allCash(), exposureOnly);
    expect(r.status).toBe("insufficient");
    expect(r.score).toBeNull();
    expect(r.label).toBeNull();
  });

  it("an all-priorities-off policy is unscorable and says so", () => {
    const nothing: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { structure: 0, resilience: 0, concentration: 0, liquidity: 0, income: 0, inflation: 0, exposure: 0 },
    };
    const r = alignmentOf(P.balanced(), nothing);
    expect(r.status).toBe("insufficient");
    expect(r.summary).toContain("No priorities");
  });

  it("an empty book reports 'empty', not zeros", () => {
    const r = alignmentOf([]);
    expect(r.status).toBe("empty");
    expect(r.score).toBeNull();
    expect(r.themes).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Arithmetic invariants                                                    */
/* -------------------------------------------------------------------------- */

describe("alignment — arithmetic invariants", () => {
  const shapes: [string, () => RawHolding[]][] = [
    ["balanced", P.balanced],
    ["concentrated", P.concentrated],
    ["all bond", P.allBond],
    ["all cash", P.allCash],
  ];
  const policies: [string, InvestorPolicy][] = [
    ["defaults", DEFAULT_POLICY],
    ["everything on", derivePolicy(answers({ income: "steady", inflation: "hedged", exposure: "global" }))],
    ["growth conviction", derivePolicy(answers({ goal: "growth", concentration: "conviction", drawdown: "severe" }))],
  ];

  it.each(shapes)("bounds, shares and reconciliation hold for every policy: %s", (_label, build) => {
    for (const [, policy] of policies) {
      const r = alignmentOf(build(), policy);
      if (r.status !== "scored") continue;

      expect(r.score!).toBeGreaterThanOrEqual(0);
      expect(r.score!).toBeLessThanOrEqual(100);
      expect(r.score).toBe(Math.round(r.scoreExact!));
      expect(r.label).toBe(alignmentLabelOf(r.score!));

      const rated = r.themes.filter((t) => t.scoreExact != null && t.weightShare > 0);
      const shareSum = rated.reduce((s, t) => s + t.weightShare, 0);
      expect(shareSum).toBeCloseTo(1, 6);

      // The total is EXACTLY Σ(theme × share) — the decomposition the UI
      // renders genuinely adds up to the headline.
      const reconstructed = rated.reduce((s, t) => s + t.scoreExact! * t.weightShare, 0);
      expect(reconstructed).toBeCloseTo(r.scoreExact!, 6);

      for (const t of r.themes) {
        if (t.score != null) {
          expect(t.score).toBeGreaterThanOrEqual(0);
          expect(t.score).toBeLessThanOrEqual(100);
          expect(Number.isFinite(t.scoreExact!)).toBe(true);
          expect(t.status).not.toBeNull();
        } else {
          expect(t.weightShare).toBe(0);
          expect(t.unratedReason).not.toBeNull();
        }
        expect(t.finding.length).toBeGreaterThan(0);
        expect(t.basis.length).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic — identical inputs produce byte-identical output", () => {
    const a = alignmentOf(P.balanced());
    const b = alignmentOf(P.balanced());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("mismatches are ordered by severity, most severe first", () => {
    const r = alignmentOf(
      P.concentrated(),
      derivePolicy(answers({ concentration: "spread", income: "living", exposure: "global" })),
    );
    for (let i = 1; i < r.mismatches.length; i++) {
      expect(r.mismatches[i - 1].severity).toBeGreaterThanOrEqual(r.mismatches[i].severity);
    }
  });

  it("an unconfirmed policy is flagged on the report and in the summary", () => {
    const r = alignmentOf(P.balanced(), DEFAULT_POLICY);
    expect(r.confirmed).toBe(false);
    expect(r.summary).toContain("assumed defaults");
    const confirmed = alignmentOf(P.balanced(), derivePolicy(answers({})));
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.summary).not.toContain("assumed defaults");
  });
});

/* -------------------------------------------------------------------------- */
/* 5. The delta machinery (sizing / decisions / optimizer substrate)           */
/* -------------------------------------------------------------------------- */

describe("alignment — simulate() deltas", () => {
  // AAPL 26,000 is the ONLY name above the 20% cap; every other position sits
  // near 14% (hand-summed total 99,900), so a trim of AAPL moves the binding
  // check instead of merely promoting the next breacher.
  const singleBreacher = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 130 }), // $26,000 ≈ 26%
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 36 }), // $14,400
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 96 }), // $14,400
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 150 }), // $14,250
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }), // $11,400
    raw({ id: "cash", assetClass: "cash", quantity: 19_450, unit: "currency" }),
  ];

  it("estimateImpact differences scoreExact under ONE policy carried on the evaluation", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings(singleBreacher(), c);
    const policy = derivePolicy(answers({ concentration: "focused" })); // cap 20 — AAPL breaches at ~26%
    const before = evaluate(holdings, c, policy);
    expect(before.policy).toBe(policy);
    expect(theme(before.alignment, "concentration").status).not.toBe("aligned");

    // Trimming the breaching position back under the cap must IMPROVE alignment.
    const aapl = before.holdings.find((h) => h.symbol === "AAPL")!;
    const { after, impact } = simulate(before, [{ kind: "sell", holdingId: aapl.id, amount: aapl.valuation.valueBase * 0.4 }], c);
    expect(after.policy).toBe(policy);
    expect(impact.alignmentDelta).not.toBeNull();
    expect(impact.alignmentDelta!).toBeGreaterThan(0);
  });

  it("returns a null delta when either side is unscorable — unknown is not zero", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings(P.allCash(), c);
    const nothing: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { structure: 0, resilience: 0, concentration: 0, liquidity: 0, income: 0, inflation: 0, exposure: 3 },
    };
    const before = evaluate(holdings, c, nothing);
    const after = evaluate(holdings, c, nothing);
    expect(estimateImpact(before, after).alignmentDelta).toBeNull();
  });

  it("small changes survive rounding: the exact score moves even when the displayed integer does not", () => {
    const c = ctx();
    const { holdings } = normalizeHoldings(singleBreacher(), c);
    const policy = derivePolicy(answers({ concentration: "focused" }));
    const before = evaluate(holdings, c, policy);
    const aapl = before.holdings.find((h) => h.symbol === "AAPL")!;
    // A 1% trim of the breaching name: far too small to move the integer, but
    // the exact delta must register (this is what the sizing tranche loop needs).
    const { impact } = simulate(before, [{ kind: "sell", holdingId: aapl.id, amount: aapl.valuation.valueBase * 0.01 }], c);
    expect(impact.alignmentDelta).not.toBeNull();
    expect(impact.alignmentDelta!).toBeGreaterThan(0);
  });

  it("a fully-aligned book is a plateau: small trades inside every stated limit measure ≈ 0", () => {
    // DELIBERATE: inside the investor's own limits there is no gradient to
    // climb — the score does not micro-optimize beyond stated preferences,
    // which is exactly the "no universal perfect portfolio" principle. The
    // engines that propose trades read this as "nothing to fix" (equilibrium),
    // and their class-target distance term still guides constructive buys.
    const c = ctx();
    const { holdings } = normalizeHoldings(P.balanced(), c);
    const before = evaluate(holdings, c, derivePolicy(answers({ concentration: "conviction", drawdown: "severe" })));
    const msft = before.holdings.find((h) => h.symbol === "MSFT")!;
    const { impact } = simulate(before, [{ kind: "sell", holdingId: msft.id, amount: msft.valuation.valueBase * 0.02 }], c);
    expect(Math.abs(impact.alignmentDelta ?? 0)).toBeLessThan(0.75);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Policy v2 — intentional exceptions, explicit ranges, coherence, verdicts */
/* -------------------------------------------------------------------------- */

describe("alignment — intentional exceptions (deliberate ≠ accidental)", () => {
  // AAPL 26% with everything else ≤ 15% — the conviction-position shape.
  const convictionBook = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 130 }), // $26,000 ≈ 26%
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 36 }), // $14,400
    raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 96 }), // $14,400
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 150 }), // $14,250
    raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }), // $11,400
    raw({ id: "cash", assetClass: "cash", quantity: 19_450, unit: "currency" }),
  ];
  const withException = (cap: number): InvestorPolicy => ({
    ...DEFAULT_POLICY,
    exceptions: [{ symbol: "AAPL", maxPositionPct: cap, note: "high-conviction core" }],
  });

  it("a named exception makes the blessed position ALIGNED without weakening the cap for others", () => {
    const without = alignmentOf(convictionBook(), DEFAULT_POLICY);
    const withEx = alignmentOf(convictionBook(), withException(30));

    // Without the exception: AAPL 26% vs the 20% cap is a mismatch.
    expect(theme(without, "concentration").status).toBe("mismatch");
    // With it: aligned, named as deliberate, and the general cap is untouched.
    const t = theme(withEx, "concentration");
    expect(t.status).not.toBe("mismatch");
    expect(t.finding).toContain("within your stated");
    expect(t.facts.some((f) => f.label === "Within your stated exception")).toBe(true);
    expect(withEx.mismatches.some((m) => m.themeId === "concentration")).toBe(false);
    // And the acceptance is not concealment: the objective note keeps the
    // magnitude on the record.
    expect(withEx.objectiveNotes.some((n) => n.includes("AAPL") && n.includes("single name"))).toBe(true);
  });

  it("breaching the exception's OWN cap still registers, citing the exception", () => {
    const r = alignmentOf(convictionBook(), withException(22)); // AAPL 26% > 22% exception
    const t = theme(r, "concentration");
    expect(t.status).toBe("mismatch");
    expect(t.mismatch!.stated).toContain("22%");
    expect(t.mismatch!.stated).toContain("exception");
  });

  it("the binding position is the worst against ITS OWN cap, not simply the largest", () => {
    // AAPL excepted to 30 (aligned at 26%); MSFT 14.4% vs a 10% general cap
    // becomes the breach even though it is far from the largest position.
    const strict: InvestorPolicy = {
      ...DEFAULT_POLICY,
      tolerances: { ...DEFAULT_POLICY.tolerances, maxPositionPct: 10 },
      exceptions: [{ symbol: "AAPL", maxPositionPct: 30, note: null }],
    };
    const r = alignmentOf(convictionBook(), strict);
    const m = r.mismatches.find((x) => x.themeId === "concentration")!;
    expect(m).toBeDefined();
    expect(m.holdings.join(",")).not.toContain("AAPL");
  });

  it("exceptions do NOT extend the correlated-cluster allowance (blessing a size ≠ blessing co-movement)", () => {
    // Three near-clones totalling ~65% with the largest excepted: the single-
    // name check passes for it, the cluster check still binds on the stack.
    const clusterBook = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 45 }), // $9,000
      raw({ id: "qqqm", assetClass: "etf", symbol: "QQQM", quantity: 45 }), // $9,450
      raw({ id: "voo", assetClass: "etf", symbol: "VOO", quantity: 20 }), // $9,600
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 100 }), // $9,500
      raw({ id: "cash", assetClass: "cash", quantity: 6_000, unit: "currency" }),
    ];
    const blessed: InvestorPolicy = {
      ...DEFAULT_POLICY,
      exceptions: [{ symbol: "VOO", maxPositionPct: 40, note: null }],
    };
    const r = alignmentOf(clusterBook, blessed);
    const t = theme(r, "concentration");
    const clusterFact = t.facts.find((f) => f.label === "Largest correlated cluster");
    expect(clusterFact).toBeDefined();
    // The cluster (~65%) far exceeds the 35% allowance derived from the
    // GENERAL cap — the exception must not have moved that allowance.
    expect(t.status).toBe("mismatch");
    expect(t.mismatch!.stated).toContain("per correlated bet");
  });
});

describe("alignment — explicit growth band (a range the investor owns)", () => {
  it("an explicit band overrides the goal derivation and says so", () => {
    // All-bond book: growth share ≈ 0. Under a growth goal that is a deep
    // mismatch; under an explicit 0–40% band it is aligned.
    const growthGoal = derivePolicy(answers({ goal: "growth" }));
    const explicit: InvestorPolicy = {
      ...growthGoal,
      tolerances: { ...growthGoal.tolerances, growthBandPct: [0, 40] },
    };
    const defaultBand = alignmentOf(P.allBond(), growthGoal);
    const overridden = alignmentOf(P.allBond(), explicit);

    expect(theme(defaultBand, "structure").status).toBe("mismatch");
    expect(theme(overridden, "structure").status).toBe("aligned");
    expect(theme(overridden, "structure").basis).toContain("You set an explicit");
  });
});

describe("alignment — policy coherence (contradictions said out loud, never scored)", () => {
  it("a growth band whose FLOOR already stresses beyond the tolerance is flagged", () => {
    // Hand-check: growth goal + medium horizon → band [60,100];
    // minPlausibleStress = 60×0.55 + 40×0.05 = 33 + 2 = 35 > 15 + 2 → conflict.
    const infeasible = derivePolicy(answers({ goal: "growth", drawdown: "shallow" }));
    const conflicts = detectPolicyConflicts(infeasible);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]).toContain("No portfolio can satisfy both");
  });

  it("a satisfiable policy raises no conflict, and conflicts never change the score", () => {
    // severe tolerance (60%) comfortably above the band floor's 35% stress.
    const feasible = derivePolicy(answers({ goal: "growth", drawdown: "severe" }));
    expect(detectPolicyConflicts(feasible)).toEqual([]);

    // Same book, same priorities — one policy conflicted, one not. The scores
    // must differ ONLY through the tolerance's effect on the resilience theme,
    // never through some hidden conflict penalty; here we just assert the
    // conflicted report still scores (no refusal, no override).
    const conflicted = alignmentOf(P.balanced(), derivePolicy(answers({ goal: "growth", drawdown: "shallow" })));
    expect(conflicted.status).toBe("scored");
    expect(conflicted.policyConflicts.length).toBeGreaterThan(0);
  });

  it("an income requirement no book inside the growth band can pay is flagged", () => {
    const p = derivePolicy(answers({ goal: "growth", income: "living" })); // requires 4.5%/yr, band [60,100]
    // Hand-check: max plausible yield at the 60% floor = (60×1.5 + 40×4.5)/100 = 2.7% < 4.5 − conflict.
    const conflicts = detectPolicyConflicts(p);
    expect(conflicts.some((c) => c.includes("income requirement"))).toBe(true);
  });
});

describe("alignment — verdict-led output", () => {
  it("a wide tolerance absorbing a deep stress is aligned AND objectively noted", () => {
    const cryptoBook = [
      raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 1, unit: "coins" }),
      raw({ id: "cash", assetClass: "cash", quantity: 15_000, unit: "currency" }),
    ];
    const hardened = alignmentOf(cryptoBook, derivePolicy(answers({ goal: "growth", drawdown: "severe" })));
    const res = theme(hardened, "resilience");
    expect(res.status).not.toBe("mismatch"); // accepting risk costs nothing…
    expect(hardened.objectiveNotes.some((n) => n.includes("objectively volatile"))).toBe(true); // …and hides nothing
  });

  it("the label always accompanies a scored report — the number never stands alone", () => {
    const r = alignmentOf(P.balanced());
    expect(r.status).toBe("scored");
    expect(r.label).not.toBeNull();
    expect(r.label).toBe(alignmentLabelOf(r.score!));
  });
});
