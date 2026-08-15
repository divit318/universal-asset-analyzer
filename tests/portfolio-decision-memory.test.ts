/**
 * Decision Memory + Investment Discovery — the guard against recommendation
 * fatigue.
 *
 * The product contract under test:
 *   1. IDENTITY IS THE THESIS. Two cards that mean "reduce QQQM" are the same
 *      recommendation whatever their ids, sizes or wording — one dismissal
 *      covers both, and a re-generated card cannot dodge it with a fresh id.
 *   2. DISMISSED STAYS DISMISSED, UNTIL SOMETHING MATERIAL CHANGES: a policy
 *      change, the position growing ≥5pp past its dismissed size, or the
 *      owning theme falling ≥12pts. Nothing else revives it — no TTL.
 *   3. DISMISSAL PRODUCES ALTERNATIVES, NOT SILENCE: the next-best DIFFERENT
 *      thesis leads, and when corrective work runs thin the discovery engine
 *      proposes researched candidates from the investor's own watchlist and
 *      the curated exposure list.
 *   4. DISCOVERY IS RESEARCH, NOT PICKS: no data → no proposal; a candidate
 *      that fights the policy is rejected by measurement; every proposal
 *      carries visible evidence and is framed as an opportunity to
 *      investigate, never an instruction to buy.
 *   5. DECISIONS AND TODAY SHARE THE MEMORY: the thesis context rides on the
 *      attention seed, so a dismissal from either surface lands in one store.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// DB isolation BEFORE lib/db's lazy getDb() first runs (same pattern as
// tests/multi-portfolio-db.test.ts).
const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-decision-memory-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

import { dismissAttention, dismissDecisionThesis, listActiveDismissals, listDecisionDismissals, undismissAttentionByPrefix, undismissDecisionThesis } from "@/lib/db";
import {
  applyDecisionMemory,
  dismissalContextFor,
  revivalReason,
  thesisKeyOf,
  REVIVE_THEME_DROP_PTS,
  REVIVE_WEIGHT_GAIN_PP,
  type DecisionDismissal,
} from "@/lib/portfolio/engines/decision-memory";
import { computeDiscovery, type DiscoveryCandidate } from "@/lib/portfolio/engines/discovery";
import { computeRecommendations, type Recommendation } from "@/lib/portfolio/engines/recommend";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { seedsFromActions } from "@/lib/home/attention";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { DEFAULT_POLICY, derivePolicy, type InvestorPolicy, type PolicyAnswers } from "@/lib/portfolio/alignment/policy";
import type { ContextFundamentals, MarketContext, RawHolding } from "@/lib/portfolio/model/types";
import type { RecommendedAction } from "@/lib/home/contracts";

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

/* ── Fixtures (deterministic walk, same family as the sibling suites) ────── */

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
      q("IEF", 95), q("SHY", 82), q("TIP", 108), q("VNQ", 85), q("VXUS", 60),
      q("VEA", 50), q("VYM", 120), q("USFR", 50), q("DBC", 22),
      // Watchlist discovery candidates with real series:
      q("KO", 62), q("NVDA", 130),
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
      ["KO", walk(300, 0.0002, 0.008, 47)],
      ["NVDA", walk(300, 0.0009, 0.03, 49)],
    ]),
    fundamentals: new Map<string, ContextFundamentals>([
      ["AAPL", fund({ sector: "Technology", country: "United States", dividendYield: 0.005, marketCap: 3e12, beta: 1.25 })],
      ["MSFT", fund({ sector: "Technology", country: "United States", dividendYield: 0.007, marketCap: 3e12, beta: 0.9 })],
      ["JNJ", fund({ sector: "Healthcare", country: "United States", dividendYield: 0.03, marketCap: 4e11, beta: 0.6 })],
      ["IEF", fund({ country: "United States", dividendYield: 0.035, duration: 7.4, creditQuality: "us_government" })],
      ["KO", fund({ sector: "Consumer Defensive", country: "United States", dividendYield: 0.031, marketCap: 2.6e11, peRatio: 22, beta: 0.55 })],
      ["NVDA", fund({ sector: "Technology", country: "United States", dividendYield: 0.0003, marketCap: 3e12, peRatio: 55, beta: 1.7 })],
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

/* AAPL ≈ 26% breaching the 20% cap; everything else near 14%. */
const CONCENTRATED = () => [
  raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 130 }),
  raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 36 }),
  raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 96 }),
  raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 150 }),
  raw({ id: "gld", assetClass: "commodity", symbol: "GLD", quantity: 60 }),
  raw({ id: "cash", assetClass: "cash", quantity: 19_450, unit: "currency" }),
];

function evalFor(rs: RawHolding[], policy: InvestorPolicy, c = ctx()) {
  const { holdings } = normalizeHoldings(rs, c);
  return evaluate(holdings, c, policy);
}

const trimRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: "trim:aapl-lot-42",
  action: "REDUCE",
  title: "Trim AAPL from 26.0% to 20%",
  subject: "AAPL",
  symbol: "AAPL",
  rationale: "AAPL is 26.0% of the portfolio against the 20% cap you set.",
  theme: "concentration",
  policyBasis: "your concentration cap — at most 20% in a single position",
  confidence: 80,
  confidenceBasis: [],
  amount: 6000,
  impact: { alignmentDelta: 3, themeDeltas: [], riskDelta: null, diversificationDelta: 0, incomeDelta: 0, inflationDelta: null, liquidityDelta: 0 },
  tradeoffs: [],
  change: { kind: "sell", holdingId: "aapl", amount: 6000 },
  priority: 3,
  alternatives: [],
  alternativesEvaluated: 0,
  ...over,
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 1. Thesis identity                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

describe("thesisKeyOf — the underlying action, not the card", () => {
  it("recognizes the same reduce-thesis across different ids, sizes and wording", () => {
    const a = trimRec({ id: "trim:aapl-lot-42", title: "Trim AAPL from 26.0% to 20%", amount: 6000 });
    const b = trimRec({ id: "trim:aapl-relisted-99", title: "Reduce AAPL exposure to your cap", amount: 3100 });
    expect(thesisKeyOf(a)).toBe("reduce:AAPL");
    expect(thesisKeyOf(a)).toBe(thesisKeyOf(b));
  });

  it("gap theses are ticker-agnostic: IEF and SHY filling no_bonds are ONE idea", () => {
    const viaIef = trimRec({ id: "gap:no_bonds", action: "ADD", symbol: "IEF", subject: "Treasuries" });
    const viaShy = trimRec({ id: "gap:no_bonds", action: "ADD", symbol: "SHY", subject: "Short Treasuries" });
    expect(thesisKeyOf(viaIef)).toBe("gap:no_bonds");
    expect(thesisKeyOf(viaIef)).toBe(thesisKeyOf(viaShy));
  });

  it("exit and reduce are DIFFERENT theses for the same symbol; discovery keys by symbol", () => {
    expect(thesisKeyOf(trimRec({ action: "SELL" }))).toBe("exit:AAPL");
    expect(thesisKeyOf(trimRec({ action: "SELL" }))).not.toBe(thesisKeyOf(trimRec()));
    expect(thesisKeyOf(trimRec({ id: "discover:KO", action: "INVESTIGATE", symbol: "KO" }))).toBe("discover:KO");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 2. Suppression and revival                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe("applyDecisionMemory — dismissed stays dismissed until material change", () => {
  const policy = derivePolicy(answers({}));
  const e = evalFor(CONCENTRATED(), policy);
  const recs = computeRecommendations(e, ctx());
  const trim = recs.find((r) => thesisKeyOf(r) === "reduce:AAPL");

  const dismissalNow = (): DecisionDismissal => ({
    ...dismissalContextFor(trim!, e),
    dismissedAt: new Date().toISOString(),
  });

  it("the engine generates the trim; a matching dismissal suppresses it — and only it", () => {
    expect(trim).toBeDefined();
    const verdict = applyDecisionMemory(recs, [dismissalNow()], e);
    expect(verdict.suppressed.map((s) => thesisKeyOf(s.rec))).toEqual(["reduce:AAPL"]);
    expect(verdict.active.map(thesisKeyOf)).not.toContain("reduce:AAPL");
    // Alternatives survive: everything else the engine measured stays.
    expect(verdict.active.length).toBe(recs.length - 1);
  });

  it("a REGENERATED trim under a different id is still the same thesis and stays suppressed", () => {
    const regenerated = recs.map((r) =>
      thesisKeyOf(r) === "reduce:AAPL" ? { ...r, id: "trim:aapl-fresh-build-7", title: "Trim AAPL from 26.1% to 20%" } : r,
    );
    const verdict = applyDecisionMemory(regenerated, [dismissalNow()], e);
    expect(verdict.active.map(thesisKeyOf)).not.toContain("reduce:AAPL");
  });

  it("a policy change revives the thesis, and the card says why it is back", () => {
    const d = { ...dismissalNow(), policyUpdatedAt: "2020-01-01T00:00:00.000Z" };
    const verdict = applyDecisionMemory(recs, [d], e);
    const revived = verdict.active.find((r) => thesisKeyOf(r) === "reduce:AAPL");
    expect(revived).toBeDefined();
    expect(verdict.revived[0]?.reason).toContain("policy changed");
    expect(revived!.rationale).toContain("You dismissed this on");
  });

  it("subject growth revives at ≥5pp — and NOT at 4pp (dismissal is not a timer)", () => {
    const base = dismissalNow();
    const grewALittle = { ...base, subjectWeightPct: (base.subjectWeightPct ?? 26) - 4 };
    const grewALot = { ...base, subjectWeightPct: (base.subjectWeightPct ?? 26) - REVIVE_WEIGHT_GAIN_PP };
    expect(revivalReason(grewALittle, trim!, e)).toBeNull();
    expect(revivalReason(grewALot, trim!, e)).toContain("grew from");
  });

  it("theme deterioration revives at ≥12pts — and NOT at 8pts", () => {
    const base = dismissalNow();
    const current = e.alignment.themes.find((t) => t.id === "concentration")!.score!;
    const mild = { ...base, themeScore: current + 8 };
    const severe = { ...base, themeScore: current + REVIVE_THEME_DROP_PTS };
    expect(revivalReason(mild, trim!, e)).toBeNull();
    expect(revivalReason(severe, trim!, e)).toContain("fell from");
  });

  it("dismissal is NOT a policy exception: the alignment score still reflects the breach", () => {
    // Suppressing the recommendation must not touch the measured mismatch —
    // "stop repeating this" ≠ "QQQM/AAPL may be any size".
    const verdict = applyDecisionMemory(recs, [dismissalNow()], e);
    expect(verdict.active.map(thesisKeyOf)).not.toContain("reduce:AAPL");
    expect(e.alignment.themes.find((t) => t.id === "concentration")!.status).toBe("mismatch");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 3. Persistence round-trip                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

describe("decision_dismissal persistence", () => {
  it("dismiss → list → undismiss round-trips per portfolio", () => {
    dismissDecisionThesis(1, {
      thesisKey: "reduce:QQQM",
      dismissedAt: "2026-08-15T00:00:00.000Z",
      policyUpdatedAt: "2026-08-15T15:17:32.570Z",
      themeId: "concentration",
      themeScore: 65,
      subjectWeightPct: 25.4,
      title: "Trim QQQM from 25.4% to 20%",
    });
    expect(listDecisionDismissals(1).map((d) => d.thesisKey)).toContain("reduce:QQQM");
    // Portfolio-scoped: portfolio 2 shares nothing.
    expect(listDecisionDismissals(2)).toEqual([]);
    // Re-dismissing refreshes rather than duplicating.
    dismissDecisionThesis(1, {
      thesisKey: "reduce:QQQM",
      dismissedAt: "2026-08-16T00:00:00.000Z",
      policyUpdatedAt: null, themeId: null, themeScore: null, subjectWeightPct: null,
      title: "Trim QQQM",
    });
    const rows = listDecisionDismissals(1).filter((d) => d.thesisKey === "reduce:QQQM");
    expect(rows).toHaveLength(1);
    expect(rows[0].dismissedAt).toBe("2026-08-16T00:00:00.000Z");

    undismissDecisionThesis(1, "reduce:QQQM");
    expect(listDecisionDismissals(1)).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 4. Decisions ↔ Today shared state                                           */
/* ────────────────────────────────────────────────────────────────────────── */

describe("attention seeds carry the decision thesis", () => {
  it("a decision-backed action seed exposes the thesis + revival context for the dismiss route", () => {
    const action: RecommendedAction = {
      id: "trim:qqqm-1",
      symbol: "QQQM",
      subject: "QQQM",
      action: "REDUCE",
      title: "Trim QQQM from 25.4% to 20%",
      reason: "Above your cap.",
      decisionScore: 57,
      priority: 1,
      confidence: 0.8,
      expectedImpact: null,
      expectedImprovement: null,
      severity: "medium",
      href: "/portfolio?tab=decisions",
      source: "decision",
      why: null,
      impact: null,
      alternativesEvaluated: null,
      thesis: {
        key: "reduce:QQQM",
        title: "Trim QQQM from 25.4% to 20%",
        policyUpdatedAt: "2026-08-15T15:17:32.570Z",
        themeId: "concentration",
        themeScore: 65,
        subjectWeightPct: 25.4,
      },
    };
    const seeds = seedsFromActions([action]);
    expect(seeds[0].thesis?.key).toBe("reduce:QQQM");
    expect(seeds[0].thesis?.subjectWeightPct).toBe(25.4);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 5. Discovery guardrails                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe("computeDiscovery — research, never picks", () => {
  const policy = derivePolicy(answers({ concentration: "conviction" })); // aligned book below
  const e = evalFor(CONCENTRATED(), policy, ctx());

  const pool: DiscoveryCandidate[] = [
    { symbol: "KO", name: "Coca-Cola", source: "watchlist", watchlistNotes: "defensive compounder, watch under $60" },
    { symbol: "NVDA", name: "NVIDIA", source: "watchlist", watchlistNotes: null },
    { symbol: "ZZZZ", name: "No Data Corp", source: "watchlist", watchlistNotes: "no quote exists" },
    { symbol: "AAPL", name: "Apple", source: "watchlist", watchlistNotes: "already a 26% position" },
    { symbol: "TIP", source: "curated", assetClass: "bond" },
  ];

  it("no data → no proposal; held positions are not 'discovered'; output is bounded", () => {
    const out = computeDiscovery(e, ctx(), pool);
    const symbols = out.map((r) => r.symbol);
    expect(symbols).not.toContain("ZZZZ"); // rule 2: silent skip, never a padded card
    expect(symbols).not.toContain("AAPL"); // already 26% of the book
    expect(out.length).toBeLessThanOrEqual(2); // fewer, better
  });

  it("every proposal is an INVESTIGATE with visible evidence and honest framing", () => {
    const out = computeDiscovery(e, ctx(), pool);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.action).toBe("INVESTIGATE");
      expect(r.id).toBe(`discover:${r.symbol}`);
      expect(r.policyBasis).toContain("opportunity to investigate, not an instruction to buy");
      // Evidence: either a measured correlation or an explicit disclosure that
      // it could not be measured — never silence.
      expect(/correlation to your (five largest positions|book)/i.test(r.rationale)).toBe(true);
      expect(r.tradeoffs.length).toBeGreaterThan(0);
      // The simulated impact rides on the card like every other decision.
      expect(r.impact.themeDeltas).toBeDefined();
    }
  });

  it("the investor's own watchlist notes surface as evidence", () => {
    const out = computeDiscovery(e, ctx(), pool);
    const ko = out.find((r) => r.symbol === "KO");
    if (ko) expect(ko.rationale).toContain("defensive compounder");
    // KO may lose the ranking to another candidate; the invariant that matters:
    // any watchlist-sourced proposal cites the watchlist.
    for (const r of out) {
      if (r.policyBasis.includes("YOUR watchlist")) {
        expect(pool.some((p) => p.symbol === r.symbol && p.source === "watchlist")).toBe(true);
      }
    }
  });

  it("a dismissed discovery stays dismissed (excludeTheses) — no re-pitching", () => {
    const all = computeDiscovery(e, ctx(), pool);
    expect(all.length).toBeGreaterThan(0);
    const excluded = computeDiscovery(e, ctx(), pool, {
      excludeTheses: new Set(all.map((r) => `discover:${r.symbol}`)),
    });
    expect(excluded.map((r) => r.symbol)).not.toEqual(all.map((r) => r.symbol));
    for (const r of excluded) expect(all.map((a) => a.symbol)).not.toContain(r.symbol);
  });

  it("a candidate that fights the policy is rejected by measurement", () => {
    // A preservation book with a shallow tolerance: NVDA (beta 1.7, vol 3%/day
    // walk) pushes Downside/Structure the wrong way at any meaningful size —
    // the simulation gate must reject it while still allowing ballast-like
    // candidates through.
    const timid = derivePolicy(answers({ goal: "preservation", drawdown: "shallow" }));
    const defensiveBook = [
      raw({ id: "ief", assetClass: "bond", symbol: "IEF", quantity: 500 }),
      raw({ id: "jnj", assetClass: "equity", symbol: "JNJ", quantity: 60 }),
      raw({ id: "cash", assetClass: "cash", quantity: 12_000, unit: "currency" }),
    ];
    const eTimid = evalFor(defensiveBook, timid, ctx());
    const out = computeDiscovery(eTimid, ctx(), pool);
    expect(out.map((r) => r.symbol)).not.toContain("NVDA");
  });
});

describe("computeDiscovery — diversity over volume", () => {
  const policy = derivePolicy(answers({ concentration: "conviction" }));
  const e = evalFor(CONCENTRATED(), policy, ctx());

  it("never restates an active recommendation: excluded symbols and covered asset classes are skipped", () => {
    const pool: DiscoveryCandidate[] = [
      { symbol: "IEF", source: "curated", assetClass: "bond" },
      { symbol: "SHY", source: "curated", assetClass: "bond" },
      { symbol: "KO", source: "watchlist", watchlistNotes: "defensive compounder" },
    ];
    // An active "Add bonds via IEF" exists → IEF (symbol) and SHY (class) are
    // both repetition, not discovery.
    const out = computeDiscovery(e, ctx(), pool, {
      excludeSymbols: new Set(["IEF"]),
      excludeAssetClasses: new Set(["bond"]),
    });
    const symbols = out.map((r) => r.symbol);
    expect(symbols).not.toContain("IEF");
    expect(symbols).not.toContain("SHY");
  });

  it("one proposal per role: two ballast candidates yield ONE ballast card", () => {
    const pool: DiscoveryCandidate[] = [
      { symbol: "IEF", source: "curated", assetClass: "bond" },
      { symbol: "SHY", source: "curated", assetClass: "bond" },
      { symbol: "TIP", source: "curated", assetClass: "bond" },
    ];
    const out = computeDiscovery(e, ctx(), pool);
    const ballast = out.filter((r) => r.rationale.startsWith("Ballast"));
    expect(ballast.length).toBeLessThanOrEqual(1);
  });
});

describe("Today surface semantics (attention seeds)", () => {
  const base: RecommendedAction = {
    id: "x", symbol: "GLD", subject: "Gold", action: "INVESTIGATE",
    title: "Worth a look: GLD — diversifier", reason: "Measured correlation 0.25.",
    decisionScore: 54, priority: 3, confidence: 0.6, expectedImpact: null,
    expectedImprovement: null, severity: "low", href: "/portfolio?tab=decisions",
    source: "decision", why: null, impact: null, alternativesEvaluated: null,
    thesis: { key: "discover:GLD", title: "Worth a look: GLD", policyUpdatedAt: null, themeId: null, themeScore: null, subjectWeightPct: null },
  };

  it("a discovery surfaces as a SIGNAL (research), never an ACTION (act-now) — with a Research primary step", () => {
    const [seed] = seedsFromActions([base]);
    expect(seed.kind).toBe("signal");
    expect(seed.primaryAction.label).toBe("Research GLD");
    expect(seed.primaryAction.href).toContain("/research?symbol=GLD");
    // The thesis still rides along — dismissing the idea on Today writes the
    // same decision memory as dismissing it in Decisions.
    expect(seed.thesis?.key).toBe("discover:GLD");
  });

  it("a corrective decision keeps the ACTION kind and the decision deep link", () => {
    const [seed] = seedsFromActions([{ ...base, action: "REDUCE", symbol: "QQQM", thesis: { ...base.thesis!, key: "reduce:QQQM" } }]);
    expect(seed.kind).toBe("action");
    expect(seed.primaryAction.href).toBe("/portfolio?tab=decisions");
  });
});

describe("recommendation titles — acronym-safe sentence casing", () => {
  it("ADD titles keep acronyms intact ('US Treasury', never 'us treasury')", () => {
    // The all-equity book against a shallow tolerance generates the ballast
    // ADD whose exposure label contains "US Treasury".
    const timid: InvestorPolicy = {
      ...DEFAULT_POLICY,
      priorities: { ...DEFAULT_POLICY.priorities, resilience: 3 },
      tolerances: { ...DEFAULT_POLICY.tolerances, maxDrawdownPct: 15 },
    };
    const equityBook = [
      raw({ id: "aapl", assetClass: "equity", symbol: "AAPL", quantity: 120 }),
      raw({ id: "msft", assetClass: "equity", symbol: "MSFT", quantity: 55 }),
      raw({ id: "cash", assetClass: "cash", quantity: 4_000, unit: "currency" }),
    ];
    const rec = computeRecommendations(evalFor(equityBook, timid, ctx()), ctx()).find((r) => r.id === "gap:no_bonds");
    expect(rec).toBeDefined();
    expect(rec!.title).toContain("US Treasury");
    expect(rec!.title).not.toContain("us treasury");
  });
});

describe("cross-surface restore (undismissAttentionByPrefix)", () => {
  it("lifting a thesis also lifts its banded story hides and merged twin — and nothing else", () => {
    const now = Date.now();
    dismissAttention("action:QQQM:50", now, now + 86_400_000);
    dismissAttention("action:QQQM:70", now, now + 86_400_000); // another band, same story
    dismissAttention("concentration:qqqm", now, now + 86_400_000); // merged twin
    dismissAttention("action:IEF:70", now, now + 86_400_000); // unrelated — must survive

    undismissAttentionByPrefix(["action:QQQM:", "concentration:qqqm"]);

    const left = listActiveDismissals(now).map((d) => d.dedupeKey);
    expect(left).toEqual(["action:IEF:70"]);
    undismissAttentionByPrefix(["action:IEF:"]); // cleanup
  });
});
