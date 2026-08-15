/**
 * Decisions × Investor Policy — the guard for "recommendations are derived from
 * the investor's stated priorities, not from an invisible definition of a good
 * portfolio".
 *
 * The properties pinned here, mapped to the product contract:
 *
 *  1. ACCEPTED CONCENTRATION IS NOT SECOND-GUESSED — a position inside the
 *     investor's own cap never generates a trim.
 *  2. EXPLICIT LIMITS OVERRIDE GENERIC DEFAULTS — a 10% cap generates a trim at
 *     15% (the retired universal 21.5% trigger never would have), targeting the
 *     INVESTOR'S cap, not a universal 20%.
 *  3. OFF THEMES GENERATE NOTHING — income/inflation/geography gaps cannot even
 *     be asserted for an investor who turned those themes off.
 *  4. PRIORITY WEIGHT MOVES RANKING — the same gap matters more under High than
 *     under Low, because the measured alignmentDelta scales with the theme's
 *     share of the score.
 *  5. POLICY CHANGE ⇒ DECISIONS CHANGE — same book, same market, different
 *     policy, different recommendation set.
 *  6. UNKNOWN ≠ MISMATCH — unclassifiable geography produces no international
 *     recommendation even when the exposure theme is on.
 *  7. TRADEOFFS RECONCILE — per-theme deltas × the investor's own shares sum to
 *     the aggregate alignmentDelta, and opposing movements are named.
 *  8. ONE SOURCE OF TRUTH — trim triggers/targets, gap thresholds and hard trade
 *     constraints all read the SAME persisted policy object the alignment score
 *     uses (constraintsFromPolicy, evaluation.policy).
 */

import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate, simulate } from "@/lib/portfolio/engines/simulate";
import {
  computeRecommendations,
  getRelevantCandidateSymbols,
  type Recommendation,
} from "@/lib/portfolio/engines/recommend";
import { buildDecisionCards } from "@/lib/portfolio/engines/decision";
import { constraintsFromPolicy, DEFAULT_CONSTRAINTS } from "@/lib/portfolio/engines/optimize";
import { DEFAULT_POLICY, derivePolicy, type InvestorPolicy, type PolicyAnswers } from "@/lib/portfolio/alignment/policy";
import type { ContextFundamentals, MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures (same deterministic walk as the alignment suite)                   */
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

function fund(o: Partial<ContextFundamentals>): ContextFundamentals {
  return {
    sector: null, industry: null, country: null, currency: "USD",
    dividendYield: null, duration: null, maturity: null, creditQuality: null,
    expenseRatio: null, marketCap: null, peRatio: null, priceToBook: null,
    returnOnEquity: null, revenueGrowth: null, operatingMargins: null,
    debtToEquity: null, operatingCashflow: null, beta: null, ...o,
  };
}

function ctx(): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);
  const q = (symbol: string, price: number) =>
    [symbol, { symbol, price, changePercent: 0.5, currency: "USD", name: symbol, marketCap: 1e11 }] as const;
  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes: new Map([
      q("AAPL", 200), q("MSFT", 400), q("JNJ", 150), q("GLD", 190),
      // Priced but deliberately WITHOUT fundamentals — an equity whose
      // geography cannot be classified (the unknown-≠-mismatch probe).
      q("ZZT", 100),
      // The candidate universe the gap-fill loop may simulate.
      q("IEF", 95), q("SHY", 82), q("TIP", 108), q("VNQ", 85), q("VXUS", 60),
      q("VEA", 50), q("VYM", 120), q("USFR", 50), q("DBC", 22),
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["MSFT", walk(300, 0.0005, 0.016, 5)],
      ["JNJ", walk(300, 0.0003, 0.01, 21)],
      ["GLD", walk(300, 0.0002, 0.009, 13)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
      ["SHY", walk(300, 0.00005, 0.002, 12)],
      ["TIP", walk(300, 0.0001, 0.005, 15)],
      ["VNQ", walk(300, 0.0003, 0.013, 31)],
      ["VXUS", walk(300, 0.0003, 0.014, 33)],
      ["VEA", walk(300, 0.0003, 0.013, 35)],
      ["VYM", walk(300, 0.0003, 0.011, 37)],
      ["USFR", walk(300, 0.00004, 0.001, 39)],
      ["DBC", walk(300, 0.0001, 0.012, 41)],
    ]),
    fundamentals: new Map<string, ContextFundamentals>([
      ["AAPL", fund({ sector: "Technology", country: "United States", dividendYield: 0.005, marketCap: 3e12, beta: 1.25 })],
      ["MSFT", fund({ sector: "Technology", country: "United States", dividendYield: 0.007, marketCap: 3e12, beta: 0.9 })],
      ["JNJ", fund({ sector: "Healthcare", country: "United States", dividendYield: 0.03, marketCap: 4e11, beta: 0.6 })],
      ["IEF", fund({ country: "United States", dividendYield: 0.035, duration: 7.4, creditQuality: "us_government" })],
      ["VYM", fund({ sector: "Financials", country: "United States", dividendYield: 0.031, marketCap: 5e10, beta: 0.85 })],
      ["USFR", fund({ country: "United States", dividendYield: 0.05, duration: 0.1, creditQuality: "us_government" })],
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

const answers = (over: Partial<PolicyAnswers>): PolicyAnswers => ({
  goal: "balanced", horizon: "medium", drawdown: "moderate", concentration: "focused",
  liquidity: "buffer", income: "no", inflation: "no", exposure: "home", ...over,
});

function recsFor(rs: RawHolding[], policy: InvestorPolicy, c = ctx()): Recommendation[] {
  const { holdings } = normalizeHoldings(rs, c);
  return computeRecommendations(evaluate(holdings, c, policy), c);
}

function evalFor(rs: RawHolding[], policy: InvestorPolicy, c = ctx()) {
  const { holdings } = normalizeHoldings(rs, c);
  return evaluate(holdings, c, policy);
}

/* AAPL ≈ 26% of a ~$100k book; nothing else above ~15%. Hand-summed:
   26,000 + 14,400 + 14,400 + 14,250 + 11,400 + 19,450 = 99,900. */
const CONCENTRATED = () => [
  raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 130 }),
  raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 36 }),
  raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 96 }),
  raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 150 }),
  raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }),
  raw({ id: "cash", assetClass: "cash", quantity: 19_450, unit: "currency" }),
];

/* AAPL ≈ 16.6% and THE LARGEST position — above a 10% cap, far below the
   retired universal 21.5% trigger. Every other position sits near 10%, so the
   cap check binds on AAPL alone. Hand-summed: 15,000 + 9,600 + 9,450 + 9,405 +
   9,396 + 9,500 + 9,360 + 9,435 + 9,400 = 90,546. */
const MODESTLY_CONCENTRATED = () => [
  raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 75 }), // $15,000 ≈ 16.6%
  raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 24 }), // $9,600
  raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 63 }), // $9,450
  raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 99 }), // $9,405
  raw({ id: "tip", assetClass: "bond", symbol: "TIP", quantity: 87 }), // $9,396
  raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 50 }), // $9,500
  raw({ id: "vym", assetClass: "etf", symbol: "VYM", quantity: 78 }), // $9,360
  raw({ id: "vnq", assetClass: "reit", symbol: "VNQ", quantity: 111 }), // $9,435
  raw({ id: "cash", assetClass: "cash", quantity: 9_400, unit: "currency" }),
];

/* -------------------------------------------------------------------------- */
/* 1 + 2. The concentration cap is the investor's, in both directions          */
/* -------------------------------------------------------------------------- */

describe("decisions — the investor's cap decides trims", () => {
  it("a 26% position inside a 35% cap generates NO trim (accepted concentration is not second-guessed)", () => {
    const recs = recsFor(CONCENTRATED(), derivePolicy(answers({ concentration: "conviction" }))); // cap 35
    expect(recs.filter((r) => r.id.startsWith("trim:"))).toEqual([]);
  });

  it("a 15% position above a 10% cap DOES generate a trim, targeting the investor's cap", () => {
    // The retired universal trigger (21.5%) would never have fired here — the
    // Alignment panel showed a breach Decisions could not act on.
    const recs = recsFor(MODESTLY_CONCENTRATED(), derivePolicy(answers({ concentration: "diversified" }))); // cap 10
    const trim = recs.find((r) => r.id === "trim:aapl");
    expect(trim).toBeDefined();
    expect(trim!.title).toContain("to 10%"); // the INVESTOR'S cap, not universal 20
    expect(trim!.theme).toBe("concentration");
    expect(trim!.policyBasis).toContain("at most 10% in a single position");
    // And the rationale quotes their own limit, not a generic standard.
    expect(trim!.rationale).toContain("10% cap you set");
  });

  it("with the concentration theme Off, no trim is generated even far above the default cap", () => {
    const noConcentration: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { ...DEFAULT_POLICY.priorities, concentration: 0 },
    };
    const recs = recsFor(CONCENTRATED(), noConcentration);
    expect(recs.filter((r) => r.id.startsWith("trim:"))).toEqual([]);
  });

  it("a cap of 100 means 'no limit' and never generates a trim", () => {
    const unlimited: InvestorPolicy = {
      ...DEFAULT_POLICY,
      tolerances: { ...DEFAULT_POLICY.tolerances, maxPositionPct: 100 },
    };
    const recs = recsFor(CONCENTRATED(), unlimited);
    expect(recs.filter((r) => r.id.startsWith("trim:"))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Off themes generate nothing                                              */
/* -------------------------------------------------------------------------- */

describe("decisions — Off themes cannot generate recommendations", () => {
  // A yield-less, all-US, nominal-asset book: under the OLD universal detector
  // this raised no_income, no_inflation_hedge AND no_international every load.
  const usGrowthBook = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 100 }),
    raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 50 }),
    raw({ id: "cash", assetClass: "cash", quantity: 2_000, unit: "currency" }),
  ];

  it("income/inflation/exposure gaps are never asserted when those themes are Off (defaults)", () => {
    // getRelevantCandidateSymbols exposes gap detection directly: no gap, no
    // candidate symbols to fetch — the respect for the policy happens before
    // any simulation, not as a late filter. The probes are candidates that
    // ONLY the gated gap can request (VXUS also serves the structure gap, so
    // it is not a valid probe for the exposure gate).
    const e = evalFor(usGrowthBook(), DEFAULT_POLICY);
    const symbols = getRelevantCandidateSymbols(e);
    expect(symbols).not.toContain("VYM"); // no_income-only candidate
    expect(symbols).not.toContain("VEA"); // no_international-only candidate
    expect(symbols).not.toContain("DBC"); // no_inflation_hedge candidate

    const recs = computeRecommendations(e, ctx());
    for (const r of recs) {
      expect(["gap:no_income", "gap:no_inflation_hedge", "gap:no_international"]).not.toContain(r.id);
    }
  });

  it("turning the income theme ON makes the same book's income gap assertable", () => {
    const wantsIncome = derivePolicy(answers({ income: "living" })); // requires 4.5%
    const symbols = getRelevantCandidateSymbols(evalFor(usGrowthBook(), wantsIncome));
    expect(symbols).toContain("VYM");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Priority weight moves the measured delta (and therefore the ranking)     */
/* -------------------------------------------------------------------------- */

describe("decisions — High vs Low priority changes how much a gap matters", () => {
  // The same cap breach (AAPL 16.6% vs a 10% cap) under two policies that
  // differ ONLY in the concentration theme's priority. A trim mostly moves the
  // concentration theme, so the measured delta scales with the share the
  // investor gave that theme: 3/9 of the score under High, 1/7 under Low.
  const withConcentration = (level: 1 | 3): InvestorPolicy => ({
    ...DEFAULT_POLICY,
    priorities: { ...DEFAULT_POLICY.priorities, concentration: level },
    tolerances: { ...DEFAULT_POLICY.tolerances, maxPositionPct: 10 },
  });

  it("the same trim measures a larger alignment gain under High concentration priority than under Low", () => {
    const c = ctx();
    const high = recsFor(MODESTLY_CONCENTRATED(), withConcentration(3), c).find((r) => r.id === "trim:aapl");
    const low = recsFor(MODESTLY_CONCENTRATED(), withConcentration(1), c).find((r) => r.id === "trim:aapl");
    expect(high).toBeDefined();
    expect(low).toBeDefined();
    // Same breach, same trade, same book — the only difference is the weight
    // the investor put on the theme, and the measured delta scales with it.
    expect(high!.impact.alignmentDelta!).toBeGreaterThan(low!.impact.alignmentDelta!);
    expect(high!.priority).toBeGreaterThan(low!.priority);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Numeric limits are the triggers; changing policy changes decisions       */
/* -------------------------------------------------------------------------- */

describe("decisions — explicit numeric limits override generic defaults", () => {
  const lowCashBook = () => [
    raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 120 }),
    raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 300 }),
    raw({ id: "cash", assetClass: "cash", quantity: 1_800, unit: "currency" }), // ≈3.3%
  ];

  it("a stated 5% cash floor raises a cash gap at 3% cash; the default 1% floor does not", () => {
    const wantsBuffer: InvestorPolicy = {
      ...DEFAULT_POLICY,
      tolerances: { ...DEFAULT_POLICY.tolerances, cashRangePct: [5, 30] },
    };
    expect(getRelevantCandidateSymbols(evalFor(lowCashBook(), wantsBuffer))).toContain("USFR");
    // Default band floor is 1% — 3.3% cash is inside the investor's stated band.
    expect(getRelevantCandidateSymbols(evalFor(lowCashBook(), DEFAULT_POLICY))).not.toContain("USFR");
  });

  it("a 'locked away' policy (floor 0) never nags about cash at all", () => {
    const locked: InvestorPolicy = {
      ...DEFAULT_POLICY,
      tolerances: { ...DEFAULT_POLICY.tolerances, cashRangePct: [0, 40] },
    };
    const zeroCash = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 120 }),
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 300 }),
    ];
    expect(getRelevantCandidateSymbols(evalFor(zeroCash, locked))).not.toContain("USFR");
  });

  it("the same book under two policies yields different recommendation sets", () => {
    const c = ctx();
    const a = recsFor(MODESTLY_CONCENTRATED(), derivePolicy(answers({ concentration: "diversified" })), c).map((r) => r.id);
    const b = recsFor(MODESTLY_CONCENTRATED(), derivePolicy(answers({ concentration: "conviction" })), c).map((r) => r.id);
    expect(a).not.toEqual(b);
    expect(a).toContain("trim:aapl");
    expect(b).not.toContain("trim:aapl");
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Unknown ≠ mismatch                                                       */
/* -------------------------------------------------------------------------- */

describe("decisions — missing data is a gap in evidence, not a finding", () => {
  it("unclassifiable geography produces no international recommendation even with exposure ON", () => {
    // ZZT is priced but has no fundamentals, so its geography is unknown, and
    // cash has none by nature — the book's geography is entirely unclassified.
    // The investor asking for global spread does not license inventing a
    // concentration finding out of missing data.
    const unknownGeo = [
      raw({ id: "zzt", assetClass: "equity", symbol: "ZZT", quantity: 400 }),
      raw({ id: "cash", assetClass: "cash", quantity: 20_000, unit: "currency" }),
    ];
    const wantsGlobal = derivePolicy(answers({ exposure: "global" }));
    // VEA serves ONLY the international gap, so its absence proves the gate.
    expect(getRelevantCandidateSymbols(evalFor(unknownGeo, wantsGlobal))).not.toContain("VEA");
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Tradeoffs reconcile and are named                                        */
/* -------------------------------------------------------------------------- */

describe("decisions — theme tradeoffs", () => {
  it("per-theme deltas × the investor's shares reconcile to the aggregate alignmentDelta", () => {
    const c = ctx();
    const before = evalFor(MODESTLY_CONCENTRATED(), derivePolicy(answers({ concentration: "diversified" })), c);
    const aapl = before.holdings.find((h) => h.symbol === "AAPL")!;
    const { impact } = simulate(before, [{ kind: "sell", holdingId: aapl.id, amount: aapl.valuation.valueBase * 0.34 }], c);

    expect(impact.alignmentDelta).not.toBeNull();
    expect(impact.themeDeltas.length).toBeGreaterThan(0);
    // Same rated set on both sides here, so the decomposition is exact:
    // Σ (theme delta × that theme's share) = the aggregate delta.
    const reconstructed = impact.themeDeltas.reduce((s, t) => s + t.delta * t.weightShare, 0);
    expect(reconstructed).toBeCloseTo(impact.alignmentDelta!, 6);
  });

  it("a decision that moves themes in opposite directions names the tension; one-directional moves do not manufacture one", () => {
    const c = ctx();
    const policy = derivePolicy(answers({ concentration: "diversified" }));
    const e = evalFor(MODESTLY_CONCENTRATED(), policy, c);
    const recs = computeRecommendations(e, c);
    const cards = buildDecisionCards(recs, e);
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const material = card.recommendation.impact.themeDeltas.filter((t) => Math.abs(t.delta) >= 0.75);
      const hasOpposition = material.some((t) => t.delta > 0) && material.some((t) => t.delta < 0);
      if (hasOpposition) {
        expect(card.themeTradeoff).toBeTruthy();
        expect(card.themeTradeoff!).toContain("Improves");
        expect(card.themeTradeoff!).toContain("giving up");
      } else {
        expect(card.themeTradeoff).toBeNull();
      }
      // Every card states whose rule it serves.
      expect(card.policyNote.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 8. One source of truth                                                      */
/* -------------------------------------------------------------------------- */

describe("decisions — one policy object end to end", () => {
  it("constraintsFromPolicy maps the SAME numbers the alignment themes score against", () => {
    const policy = derivePolicy(answers({ concentration: "conviction", liquidity: "quarter" })); // cap 35, floor 25, band [3,40]
    const c = constraintsFromPolicy(policy);
    expect(c.maxHoldingPct).toBe(policy.tolerances.maxPositionPct); // 35 — not the universal 20
    expect(c.minCashPct).toBe(policy.tolerances.cashRangePct[0]); // 3 — not the universal 2
    expect(c.maxIlliquidPct).toBe(100 - policy.tolerances.liquidityFloorPct); // 75 — not the universal 30
    // Fields the policy has no opinion on keep the base defaults.
    expect(c.maxAssetClassPct).toBe(DEFAULT_CONSTRAINTS.maxAssetClassPct);
    expect(c.maxSectorPct).toBe(DEFAULT_CONSTRAINTS.maxSectorPct);
  });

  it("recommendations are computed against evaluation.policy — the exact object alignment scored", () => {
    const policy = derivePolicy(answers({ concentration: "diversified" }));
    const e = evalFor(MODESTLY_CONCENTRATED(), policy);
    expect(e.policy).toBe(policy);
    const recs = computeRecommendations(e, ctx());
    const trim = recs.find((r) => r.id === "trim:aapl");
    expect(trim).toBeDefined();
    // The trim quotes the policy's own cap — no second concentration limit exists.
    expect(trim!.policyBasis).toContain(`${policy.tolerances.maxPositionPct}%`);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Intentional exceptions in Decisions                                      */
/* -------------------------------------------------------------------------- */

describe("decisions — intentional exceptions", () => {
  it("a blessed position inside its exception is NEVER trimmed; breaching its own exception trims to the EXCEPTION cap", () => {
    const c = ctx();
    // Inside the exception: AAPL 26% ≤ 30% blessed → no trim at all.
    const blessed: InvestorPolicy = {
      ...DEFAULT_POLICY,
      exceptions: [{ symbol: "AAPL", maxPositionPct: 30, note: "conviction" }],
    };
    const recsBlessed = recsFor(CONCENTRATED(), blessed, c);
    expect(recsBlessed.filter((r) => r.id === "trim:aapl")).toEqual([]);

    // Above the exception: AAPL 26% > 22% blessed → trim TO 22, citing the exception.
    const tighter: InvestorPolicy = {
      ...DEFAULT_POLICY,
      exceptions: [{ symbol: "AAPL", maxPositionPct: 22, note: "conviction" }],
    };
    const trim = recsFor(CONCENTRATED(), tighter, c).find((r) => r.id === "trim:aapl");
    expect(trim).toBeDefined();
    expect(trim!.title).toContain("to 22%");
    expect(trim!.policyBasis).toContain("22% exception for AAPL");
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Sizing scales with the mismatch, not with a universal label             */
/* -------------------------------------------------------------------------- */

describe("decisions — mismatch-scaled sizing", () => {
  it("the proposed size is the size that MEASURED best, and a deep downside mismatch earns more than the old universal base", () => {
    // All-equity book against a shallow tolerance: the ballast gap is deep, so
    // doubling the trade keeps measuring better (monotone toward the 15% cap).
    const equityBook = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 120 }),
      raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 55 }),
      raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 100 }),
      raw({ id: "cash", assetClass: "cash", quantity: 4_000, unit: "currency" }),
    ];
    const timid: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { ...DEFAULT_POLICY.priorities, resilience: 3 },
      tolerances: { ...DEFAULT_POLICY.tolerances, maxDrawdownPct: 15 },
    };
    const e = evalFor(equityBook, timid, ctx());
    const rec = computeRecommendations(e, ctx()).find((r) => r.id === "gap:no_bonds");
    expect(rec).toBeDefined();
    // The old universal size for a "high" gap was 10% of the book flat. The
    // size search may confirm 10% — but for THIS depth of mismatch the larger
    // simulated size measures better, and the engine must follow its own
    // measurement (15% cap = 2× the high-severity base, hand-derived from
    // candidateSizes: high → {5%, 10%, 15%}).
    const pctOfBook = (rec!.amount / e.totalValue) * 100;
    expect(pctOfBook).toBeGreaterThan(10.5);
    expect(pctOfBook).toBeLessThanOrEqual(15.5);
  });
});

/* -------------------------------------------------------------------------- */
/* 11. ACCEPTANCE: same book, three investors, three different answer sets     */
/* -------------------------------------------------------------------------- */

describe("decisions — the same portfolio answers differently for different investors", () => {
  // One fixed book: concentrated in AAPL (26%), 84%-ish growth engine, low
  // yield, modest cash. What SHOULD be done about it depends entirely on who
  // owns it — that dependence is the product.
  const book = CONCENTRATED;

  const conservative = derivePolicy(answers({
    goal: "preservation", horizon: "short", drawdown: "shallow",
    concentration: "diversified", liquidity: "quarter",
  })); // cap 10, tolerance 15, liquidity floor 25

  const conviction: InvestorPolicy = {
    ...derivePolicy(answers({ goal: "growth", horizon: "long", drawdown: "severe", concentration: "conviction" })),
    exceptions: [{ symbol: "AAPL", maxPositionPct: 35, note: "core conviction holding" }],
  }; // cap 35 + AAPL blessed — concentration is a CHOICE here

  const incomeSeeker = derivePolicy(answers({
    goal: "income", income: "living", drawdown: "moderate",
  })); // income theme ON at 4.5%/yr required

  it("conservative: trims the concentration and adds ballast; conviction: neither; income: chases the yield gap", () => {
    const c = ctx();
    const byId = (p: InvestorPolicy) => new Set(recsFor(book(), p, c).map((r) => r.id));

    const cons = byId(conservative);
    const conv = byId(conviction);
    const inc = byId(incomeSeeker);

    // Conservative: the 26% AAPL breaches the 10% cap → trim exists.
    expect(cons.has("trim:aapl")).toBe(true);
    // Conviction: the same position is blessed — no trim, and no ballast nag
    // against a 60% tolerance.
    expect(conv.has("trim:aapl")).toBe(false);
    expect(conv.has("gap:no_bonds")).toBe(false);
    // Income-seeker: the yield gap generates; the conviction investor's book
    // never even asserts an income gap.
    expect(inc.has("gap:no_income")).toBe(true);
    expect(conv.has("gap:no_income")).toBe(false);

    // And the three sets are pairwise different — the acceptance criterion.
    const asSorted = (s: Set<string>) => [...s].sort().join("|");
    expect(asSorted(cons)).not.toBe(asSorted(conv));
    expect(asSorted(cons)).not.toBe(asSorted(inc));
    expect(asSorted(conv)).not.toBe(asSorted(inc));
  });

  it("rankings follow the investor's priorities: the conservative's top decision serves downside/concentration, the income-seeker's serves income", () => {
    const c = ctx();
    const consTop = recsFor(book(), conservative, c)[0];
    const incTop = recsFor(book(), incomeSeeker, c)[0];
    expect(consTop).toBeDefined();
    expect(incTop).toBeDefined();
    expect(["resilience", "concentration", "liquidity", "structure"]).toContain(consTop.theme);
    expect(incTop.theme).toBe("income");
  });
});
