/**
 * Simulator generation (lib/portfolio/simulator/generate.ts) — the
 * deterministic guards around the AI. The AI proposes; these functions
 * dispose: allocation normalization, selection validation and budget
 * rebalancing, live-quote sizing with value conservation.
 */
import { describe, expect, it } from "vitest";
import {
  buildAllocationPrompt,
  buildSelectionPrompt,
  candidateFilterFor,
  fallbackAllocation,
  fallbackSelection,
  normalizeAllocation,
  parseSelectionResponse,
  rebalanceToBudgets,
  sizeHoldings,
  type ClassAllocation,
  type SelectionPick,
} from "../lib/portfolio/simulator/generate";
import { allowedClassesFor } from "../lib/portfolio/simulator/preferences";
import { DEFAULT_CONSTRAINTS, OBJECTIVES } from "../lib/portfolio/engines/optimize";
import type { SimProfile } from "../lib/portfolio/simulator/types";

function profile(overrides: Partial<SimProfile> = {}): SimProfile {
  return {
    cash: 100_000,
    currency: "USD",
    horizon: "long",
    targetDate: null,
    objective: "growth",
    riskAppetite: 7,
    maxDrawdownPct: 35,
    role: "standalone",
    complementRef: null,
    preferences: {},
    followUps: [],
    intakeComplete: true,
    ...overrides,
  };
}

const sum = (a: ClassAllocation) => Object.values(a).reduce((s, v) => s + (v ?? 0), 0);

describe("normalizeAllocation", () => {
  it("scales any proposal to exactly 100 with the policy cash floor", () => {
    const a = normalizeAllocation({ etf: 60, bond: 60, cash: 0 });
    expect(sum(a)).toBeCloseTo(100, 6);
    expect(a.cash ?? 0).toBeGreaterThanOrEqual(DEFAULT_CONSTRAINTS.minCashPct);
  });

  it("drops unknown classes, negatives and non-numbers", () => {
    const a = normalizeAllocation({ etf: 50, lottery: 30, bond: -10, crypto: "abc" });
    expect(a).not.toHaveProperty("lottery");
    expect(a).not.toHaveProperty("bond");
    expect(a).not.toHaveProperty("crypto");
    expect(sum(a)).toBeCloseTo(100, 6);
  });

  it("degrades an empty/garbage proposal to 100% cash, never to nothing", () => {
    expect(normalizeAllocation({})).toEqual({ cash: 100 });
    expect(normalizeAllocation({ moon: 100 })).toEqual({ cash: 100 });
  });
});

describe("fallbackAllocation", () => {
  it("is the objective's strategic target, restricted to generatable classes and summing to 100", () => {
    for (const objective of Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[]) {
      const a = fallbackAllocation(profile({ objective }));
      expect(sum(a), `objective ${objective}`).toBeCloseTo(100, 1);
      expect(a.cash ?? 0).toBeGreaterThanOrEqual(DEFAULT_CONSTRAINTS.minCashPct);
    }
  });

  /**
   * The objective's strategic target is a house view; the client's permitted
   * instrument types are an instruction. Inflation Protection targets 20%
   * commodities and 20% REITs — a client who said "public stocks, ETFs and
   * investment-grade bonds only" must not get either, and the weight must be
   * redistributed rather than dumped into cash.
   */
  it("honours the client's permitted instrument types over the objective's template", () => {
    const coreOnly = profile({
      objective: "inflation_protection",
      preferences: { breadth: { optionIds: ["core_only"], other: null } },
    });
    const a = fallbackAllocation(coreOnly);
    expect(a.commodity).toBeUndefined();
    expect(a.reit).toBeUndefined();
    expect(sum(a)).toBeCloseTo(100, 1);
    // The freed weight went to the classes that ARE allowed, not to cash.
    expect(a.cash ?? 0).toBeLessThan(50);
    expect((a.equity ?? 0) + (a.etf ?? 0) + (a.bond ?? 0)).toBeGreaterThan(50);
  });
});

/**
 * Exclusions and permitted instrument types are the two intake answers that are
 * instructions, not preferences. The prompt states them; these enforce them —
 * because a 7B model has been observed asserting a constraint and violating it in
 * the same response.
 */
describe("hard constraint enforcement", () => {
  const allocation: ClassAllocation = { etf: 60, bond: 30, cash: 10 };

  it("keeps a forbidden class out of the allocation entirely", () => {
    const allowed = allowedClassesFor({ breadth: { optionIds: ["core_only"], other: null } });
    const a = normalizeAllocation({ etf: 40, bond: 30, commodity: 20, crypto: 5, cash: 5 }, allowed);
    expect(a.commodity).toBeUndefined();
    expect(a.crypto).toBeUndefined();
    expect(sum(a)).toBeCloseTo(100, 6);
  });

  it("drops an excluded pick and reports it, rather than silently shipping it", () => {
    const p = profile({ preferences: { exclusions: { optionIds: ["fossil"], other: null } } });
    const { picks, dropped } = parseSelectionResponse(
      JSON.stringify({
        picks: [
          { symbol: "VOO", assetClass: "etf", name: "Vanguard S&P 500 ETF", weightPct: 60, why: "core" },
          { symbol: "XOM", assetClass: "equity", name: "Exxon Mobil", weightPct: 10, why: "energy" },
        ],
      }),
      { ...allocation, equity: 10 },
      candidateFilterFor(p.preferences),
    );
    expect(dropped).toContain("XOM");
    expect(picks.map((x) => x.symbol)).not.toContain("XOM");
  });

  it("leaves a class unfilled rather than backfilling it with something excluded", () => {
    // Commodities are permitted, but every curated commodity candidate that is
    // NOT fossil-related still exists (GLD), so this uses the harsher case: the
    // class is forbidden outright, so its budget must go unfilled.
    const picks = fallbackSelection(
      { etf: 50, commodity: 40, cash: 10 },
      candidateFilterFor({ breadth: { optionIds: ["core_only"], other: null } }),
    );
    expect(picks.some((x) => x.assetClass === "commodity")).toBe(false);
    expect(picks.some((x) => x.assetClass === "etf")).toBe(true);
  });

  it("never offers an excluded instrument on the menu in the first place", () => {
    const p = profile({
      preferences: {
        exclusions: { optionIds: ["fossil"], other: null },
        breadth: { optionIds: ["commodities"], other: null },
      },
    });
    const prompt = buildSelectionPrompt(p, { etf: 50, commodity: 40, cash: 10 });
    // Offering XOM/USO and discarding the pick afterwards wastes a model call and
    // thins the book for nothing.
    expect(prompt).not.toContain("XOM");
    expect(prompt).not.toContain("United States Oil Fund");
    expect(prompt).toContain("GLD"); // gold is not a fossil-fuel exclusion
  });

  it("states the client's constraints, and their meaning, in both prompts", () => {
    const p = profile({
      preferences: {
        income: { optionIds: ["predictable"], other: null },
        tax: { optionIds: ["taxable_us_high"], other: null },
      },
    });
    for (const prompt of [buildAllocationPrompt(p), buildSelectionPrompt(p, allocation)]) {
      expect(prompt).toContain("coupons and rent");
      expect(prompt).toContain("municipal bonds (MUB)");
    }
  });

  it("tells the allocator only about the classes the mandate permits", () => {
    const p = profile({ preferences: { breadth: { optionIds: ["core_only"], other: null } } });
    const prompt = buildAllocationPrompt(p);
    expect(prompt).toMatch(/Available asset classes: [^\n]*/);
    const line = prompt.match(/Available asset classes: ([^.]*)\./)![1];
    expect(line).not.toContain("commodity");
    expect(line).not.toContain("crypto");
    expect(line).toContain("bond");
  });
});

describe("parseSelectionResponse + rebalanceToBudgets", () => {
  const allocation: ClassAllocation = { etf: 60, bond: 30, cash: 10 };

  it("keeps valid picks and scales each class to exactly its budget", () => {
    const { picks } = parseSelectionResponse(
      JSON.stringify({
        picks: [
          { symbol: "voo", assetClass: "etf", name: "Vanguard S&P 500", weightPct: 40, why: "core" },
          { symbol: "QQQ", assetClass: "etf", name: "Invesco QQQ", weightPct: 40, why: "growth tilt" },
          { symbol: "BND", assetClass: "bond", name: "Total Bond", weightPct: 25, why: "ballast" },
        ],
      }),
      allocation,
    );
    const etf = picks.filter((p) => p.assetClass === "etf");
    const bond = picks.filter((p) => p.assetClass === "bond");
    expect(etf.reduce((s, p) => s + p.weightPct, 0)).toBeCloseTo(60, 1);
    expect(bond.reduce((s, p) => s + p.weightPct, 0)).toBeCloseTo(30, 1);
    expect(etf[0].symbol).toBe("VOO"); // normalized casing
  });

  it("discards invalid symbols, unknown classes, cash picks, bad weights and duplicates", () => {
    const { picks } = parseSelectionResponse(
      JSON.stringify({
        picks: [
          { symbol: "not a ticker!!", assetClass: "etf", weightPct: 30 },
          { symbol: "VOO", assetClass: "meme", weightPct: 30 },
          { symbol: "SGOV", assetClass: "cash", weightPct: 10 },
          { symbol: "BND", assetClass: "bond", weightPct: -5 },
          { symbol: "QQQ", assetClass: "etf", weightPct: 30, why: "a" },
          { symbol: "QQQ", assetClass: "etf", weightPct: 30, why: "duplicate" },
        ],
      }),
      allocation,
    );
    // QQQ survives and absorbs the whole 60% etf budget; bond refills from the
    // curated fallback rather than vanishing.
    const etf = picks.filter((p) => p.assetClass === "etf");
    expect(etf).toHaveLength(1);
    expect(etf[0].weightPct).toBeCloseTo(60, 1);
    const bond = picks.filter((p) => p.assetClass === "bond");
    expect(bond).toHaveLength(1);
    expect(bond[0].weightPct).toBeCloseTo(30, 1);
  });

  it("fills a class the AI ignored entirely from the curated fallback", () => {
    const picks = rebalanceToBudgets([], allocation);
    expect(picks.some((p) => p.assetClass === "etf")).toBe(true);
    expect(picks.some((p) => p.assetClass === "bond")).toBe(true);
    expect(picks.reduce((s, p) => s + p.weightPct, 0)).toBeCloseTo(90, 1); // ex-cash
  });
});

describe("fallbackSelection", () => {
  it("produces one curated pick per budgeted class with the class budget as weight", () => {
    const picks = fallbackSelection({ etf: 50, bond: 40, cash: 10 });
    expect(picks).toHaveLength(2);
    expect(picks.every((p) => p.why.length > 0)).toBe(true);
    expect(picks.reduce((s, p) => s + p.weightPct, 0)).toBeCloseTo(90, 1);
  });
});

describe("sizeHoldings", () => {
  const quotes: Record<string, { price: number; currency: string; name: string }> = {
    VOO: { price: 500, currency: "USD", name: "Vanguard S&P 500 ETF" },
    BND: { price: 72, currency: "USD", name: "Vanguard Total Bond Market ETF" },
    "BTC-USD": { price: 60_000, currency: "USD", name: "Bitcoin" },
    EWG: { price: 40, currency: "EUR", name: "iShares Germany" },
  };
  const quoteFor = (s: string) => quotes[s] ?? null;
  const picks = (over: Partial<SelectionPick>[] = []): SelectionPick[] => [
    { symbol: "VOO", assetClass: "etf", name: "VOO", weightPct: 60, why: "core" },
    { symbol: "BND", assetClass: "bond", name: "BND", weightPct: 30, why: "ballast" },
    ...(over as SelectionPick[]),
  ];

  it("buys whole shares, conserves value to the cent, and routes the residual to cash", () => {
    const holdings = sizeHoldings(picks(), quoteFor, {}, 100_000, "USD", 10);
    const voo = holdings.find((h) => h.symbol === "VOO")!;
    const bnd = holdings.find((h) => h.symbol === "BND")!;
    const cash = holdings.find((h) => h.assetClass === "cash")!;
    expect(voo.quantity).toBe(Math.floor(60_000 / 500));
    expect(Number.isInteger(bnd.quantity)).toBe(true);
    const invested = voo.quantity * 500 + bnd.quantity * 72;
    expect(invested + cash.quantity).toBeCloseTo(100_000, 2);
  });

  it("buys fractional crypto", () => {
    const holdings = sizeHoldings(
      [{ symbol: "BTC-USD", assetClass: "crypto", name: "Bitcoin", weightPct: 5, why: "sleeve" }],
      quoteFor,
      {},
      100_000,
      "USD",
      95,
    );
    const btc = holdings.find((h) => h.symbol === "BTC-USD")!;
    expect(btc.quantity).toBeCloseTo(5_000 / 60_000, 4);
    expect(Number.isInteger(btc.quantity)).toBe(false);
  });

  it("drops a pick whose price exceeds its budget instead of overbuying, and cash absorbs it", () => {
    const holdings = sizeHoldings(
      [{ symbol: "BTC-USD", assetClass: "crypto", name: "Bitcoin", weightPct: 2, why: "x" }],
      // crypto is fractional so force the whole-share path with an etf:
      quoteFor,
      {},
      100,
      "USD",
      98,
    );
    // 2% of $100 = $2 budget; BTC fractional → tiny quantity survives
    expect(holdings.find((h) => h.symbol === "BTC-USD")).toBeTruthy();

    const etfCase = sizeHoldings(
      [{ symbol: "VOO", assetClass: "etf", name: "VOO", weightPct: 10, why: "x" }],
      quoteFor,
      {},
      1_000, // $100 budget < $500 share price → 0 shares
      "USD",
      90,
    );
    expect(etfCase.find((h) => h.symbol === "VOO")).toBeUndefined();
    expect(etfCase.find((h) => h.assetClass === "cash")!.quantity).toBeCloseTo(1_000, 2);
  });

  it("silently drops symbols with no live quote — an invented ticker cannot be persisted", () => {
    const holdings = sizeHoldings(
      picks([{ symbol: "FAKE123", assetClass: "equity", name: "Fake", weightPct: 5, why: "hallucinated" }]),
      quoteFor,
      {},
      100_000,
      "USD",
      5,
    );
    expect(holdings.find((h) => h.symbol === "FAKE123")).toBeUndefined();
  });

  it("converts foreign-currency prices through FX when sizing", () => {
    const holdings = sizeHoldings(
      [{ symbol: "EWG", assetClass: "etf", name: "iShares Germany", weightPct: 10, why: "x" }],
      quoteFor,
      { EUR: 1.1 }, // 1 EUR = 1.10 USD
      100_000,
      "USD",
      90,
    );
    const ewg = holdings.find((h) => h.symbol === "EWG")!;
    expect(ewg.quantity).toBe(Math.floor(10_000 / (40 * 1.1)));
    expect(ewg.currency).toBe("EUR");
  });
});

describe("prompts", () => {
  it("allocation prompt carries the mandate, the objective prior and the JSON contract", () => {
    const p = buildAllocationPrompt(profile());
    expect(p).toContain("100,000 USD");
    expect(p).toContain("Growth");
    expect(p).toContain('"allocation"');
    expect(p).toContain(`${DEFAULT_CONSTRAINTS.minCashPct}% cash`);
  });

  it("selection prompt lists budgets, the curated menu, and every intake answer", () => {
    const p = buildSelectionPrompt(
      profile({
        followUps: [{ question: "Exclusions?", answer: "No fossil fuels", assumption: null }],
      }),
      { etf: 60, bond: 30, cash: 10 },
    );
    expect(p).toContain("etf: 60%");
    expect(p).toContain("VOO — Vanguard S&P 500 ETF");
    expect(p).toContain("No fossil fuels");
    expect(p).not.toContain("CRYPTO:"); // unbudgeted classes get no menu
  });
});
