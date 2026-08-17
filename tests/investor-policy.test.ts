/**
 * Investor Policy — the model that replaced universal health weights.
 *
 * Locks down the three contracts the alignment engine depends on:
 *  1. derivePolicy maps every wizard answer to the tolerances/priorities its
 *     option label promises (the chip TEXT is the spec — a "≤30%" chip that
 *     derives 45 lies to the user).
 *  2. parseInvestorPolicy is lenient at the boundary (clamps, defaults,
 *     drops unknowns) and never returns an out-of-range policy.
 *  3. priorityShares is a probability distribution over the enabled themes.
 */

import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_THEMES,
  answersFromPolicy,
  applyPolicyPatch,
  DEFAULT_POLICY,
  derivePolicy,
  describePolicy,
  describePolicyPatch,
  effectiveCapPct,
  parseInvestorPolicy,
  priorityShares,
  type PolicyAnswers,
} from "@/lib/portfolio/alignment/policy";
import { MAX_SINGLE_HOLDING_PCT } from "@/lib/portfolio/policy";

const BASE: PolicyAnswers = {
  goal: "balanced",
  horizon: "medium",
  drawdown: "moderate",
  concentration: "focused",
  liquidity: "buffer",
  income: "no",
  inflation: "no",
  exposure: "home",
};

describe("derivePolicy", () => {
  it("maps each answer to the tolerance its option label states", () => {
    const p = derivePolicy(BASE);
    expect(p.tolerances.maxDrawdownPct).toBe(30); // "moderate" chip says ≤30%
    expect(p.tolerances.maxPositionPct).toBe(MAX_SINGLE_HOLDING_PCT); // "focused" = the optimizer's own 20% cap
    expect(p.tolerances.liquidityFloorPct).toBe(10); // "buffer" chip says ~10%
    expect(p.tolerances.incomeYieldPct).toBe(0);
    expect(p.confirmed).toBe(true);
  });

  it("income/inflation/exposure answers override the goal preset — an explicit 'no' means no", () => {
    // The income GOAL preset turns the income theme on at 3; answering the
    // income QUESTION "no" must win, or the investor cannot opt out.
    const p = derivePolicy({ ...BASE, goal: "income", income: "no" });
    expect(p.priorities.income).toBe(0);

    const on = derivePolicy({ ...BASE, income: "living" });
    expect(on.priorities.income).toBe(3);
    expect(on.tolerances.incomeYieldPct).toBe(4.5);
  });

  it("a short horizon raises downside and liquidity priorities (less time to recover)", () => {
    const medium = derivePolicy(BASE);
    const short = derivePolicy({ ...BASE, horizon: "short" });
    expect(short.priorities.resilience).toBeGreaterThanOrEqual(medium.priorities.resilience);
    expect(short.priorities.liquidity).toBeGreaterThanOrEqual(medium.priorities.liquidity);
  });

  it("round-trips through answersFromPolicy for every canonical answer set", () => {
    const goals: PolicyAnswers["goal"][] = ["growth", "balanced", "income", "preservation"];
    for (const goal of goals) {
      const answers: PolicyAnswers = { ...BASE, goal, drawdown: "deep", concentration: "spread", income: "steady", exposure: "global" };
      expect(answersFromPolicy(derivePolicy(answers))).toEqual(answers);
    }
  });
});

describe("parseInvestorPolicy", () => {
  it("null/undefined yields the labelled defaults", () => {
    const r = parseInvestorPolicy(null);
    expect("policy" in r && r.policy).toEqual(DEFAULT_POLICY);
  });

  it("clamps out-of-range tolerances instead of rejecting the whole policy", () => {
    const r = parseInvestorPolicy({
      tolerances: { maxPositionPct: 400, maxDrawdownPct: -10, liquidityFloorPct: 250, cashRangePct: [90, 10], incomeYieldPct: 99 },
    });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.tolerances.maxPositionPct).toBe(100);
    expect(r.policy.tolerances.maxDrawdownPct).toBe(5);
    expect(r.policy.tolerances.liquidityFloorPct).toBe(100);
    // A reversed range is repaired, not rejected.
    expect(r.policy.tolerances.cashRangePct[0]).toBeLessThanOrEqual(r.policy.tolerances.cashRangePct[1]);
    expect(r.policy.tolerances.incomeYieldPct).toBe(15);
  });

  it("an enabled income theme always gets a scoring target (documented 2% floor)", () => {
    const r = parseInvestorPolicy({ priorities: { income: 2 }, tolerances: { incomeYieldPct: 0 } });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.tolerances.incomeYieldPct).toBe(2);
  });

  it("drops unknown priority keys and clamps levels to 0-3", () => {
    const r = parseInvestorPolicy({ priorities: { structure: 9, nonsense: 3 } });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.priorities.structure).toBe(3);
    expect("nonsense" in r.policy.priorities).toBe(false);
  });

  it("a policy round-trips through JSON unchanged", () => {
    const p = derivePolicy({ ...BASE, goal: "growth", exposure: "global" });
    const r = parseInvestorPolicy(JSON.parse(JSON.stringify(p)));
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy).toEqual(p);
  });

  it("rejects a non-object payload", () => {
    expect("error" in parseInvestorPolicy([1, 2, 3])).toBe(true);
    expect("error" in parseInvestorPolicy("policy")).toBe(true);
  });
});

describe("priorityShares", () => {
  it("is a probability distribution over the enabled themes", () => {
    const shares = priorityShares(DEFAULT_POLICY);
    const sum = ALIGNMENT_THEMES.reduce((s, t) => s + shares[t], 0);
    expect(sum).toBeCloseTo(1, 9);
    // Themes at priority 0 carry exactly nothing.
    expect(shares.income).toBe(0);
    expect(shares.inflation).toBe(0);
    expect(shares.exposure).toBe(0);
  });

  it("all-zero priorities produce all-zero shares (unscorable, not NaN)", () => {
    const p = { ...DEFAULT_POLICY, priorities: { structure: 0, resilience: 0, concentration: 0, liquidity: 0, income: 0, inflation: 0, exposure: 0 } as const };
    const shares = priorityShares(p);
    for (const t of ALIGNMENT_THEMES) expect(shares[t]).toBe(0);
  });
});

describe("describePolicy (AI prompt input)", () => {
  it("labels an unconfirmed policy as assumed and states opt-outs explicitly", () => {
    const text = describePolicy(DEFAULT_POLICY);
    expect(text).toContain("ASSUMED DEFAULTS");
    expect(text).toContain("Income: explicitly not a goal.");
    expect(text).toContain("Home-market concentration: accepted as deliberate.");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* v2: exceptions, statements, ranges, patches                                */
/* ────────────────────────────────────────────────────────────────────────── */

describe("policy v2 — migration and new fields", () => {
  it("a v1 blob parses cleanly: new fields default to empty/off (the whole migration)", () => {
    const v1 = {
      version: 1,
      goal: "growth",
      horizon: "short",
      priorities: { structure: 3, resilience: 3, concentration: 2, liquidity: 2, income: 0, inflation: 0, exposure: 0 },
      tolerances: { maxPositionPct: 20, maxDrawdownPct: 30, liquidityFloorPct: 10, cashRangePct: [1, 25], incomeYieldPct: 0 },
      confirmed: true,
      updatedAt: "2026-08-15T15:17:32.570Z",
    };
    const r = parseInvestorPolicy(v1);
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.version).toBe(2);
    expect(r.policy.exceptions).toEqual([]);
    expect(r.policy.statements).toEqual([]);
    expect(r.policy.tolerances.growthBandPct).toBeNull();
    // Nothing the investor set is altered by migration.
    expect(r.policy.goal).toBe("growth");
    expect(r.policy.tolerances.maxDrawdownPct).toBe(30);
    expect(r.policy.confirmed).toBe(true);
  });

  it("exceptions are upper-cased, deduped (last wins), clamped and bounded", () => {
    const r = parseInvestorPolicy({
      exceptions: [
        { symbol: "qqqm", maxPositionPct: 30, note: "conviction" },
        { symbol: "QQQM", maxPositionPct: 400, note: "  " }, // dupe, out-of-range, blank note
        { symbol: "", maxPositionPct: 30 }, // no symbol → dropped
      ],
    });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.exceptions).toHaveLength(1);
    expect(r.policy.exceptions[0]).toEqual({ symbol: "QQQM", maxPositionPct: 100, note: null });
  });

  it("the growth band is a real range: reversed ends are repaired, minimum width 5pp enforced", () => {
    const r = parseInvestorPolicy({ tolerances: { growthBandPct: [90, 40] } });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.tolerances.growthBandPct).toEqual([40, 90]);

    const narrow = parseInvestorPolicy({ tolerances: { growthBandPct: [50, 52] } });
    if (!("policy" in narrow)) throw new Error(narrow.error);
    expect(narrow.policy.tolerances.growthBandPct).toEqual([50, 55]);
  });

  it("statements without text or summary are dropped; kept ones are length-bounded", () => {
    const r = parseInvestorPolicy({
      statements: [
        { text: "I run a concentrated book", summary: "QQQM exception ≤30%", appliedAt: "2026-08-15T00:00:00.000Z" },
        { text: "", summary: "orphan" },
        { text: "x".repeat(600), summary: "long", appliedAt: "2026-08-15T00:00:00.000Z" },
      ],
    });
    if (!("policy" in r)) throw new Error(r.error);
    expect(r.policy.statements).toHaveLength(2);
    expect(r.policy.statements[1].text.length).toBe(500);
  });
});

describe("effectiveCapPct — one cap per holding, everywhere", () => {
  const base = parseInvestorPolicy({
    tolerances: { maxPositionPct: 20 },
    exceptions: [{ symbol: "QQQM", maxPositionPct: 30, note: null }],
  });
  const policy = "policy" in base ? base.policy : DEFAULT_POLICY;

  it("returns the exception cap for the excepted symbol (case-insensitive) and the general cap otherwise", () => {
    expect(effectiveCapPct(policy, "QQQM")).toBe(30);
    expect(effectiveCapPct(policy, "qqqm")).toBe(30);
    expect(effectiveCapPct(policy, "MSFT")).toBe(20);
    expect(effectiveCapPct(policy, null)).toBe(20);
  });

  it("an exception can only widen, never silently tighten below the general cap", () => {
    const r = parseInvestorPolicy({
      tolerances: { maxPositionPct: 20 },
      exceptions: [{ symbol: "AAPL", maxPositionPct: 10, note: null }],
    });
    if (!("policy" in r)) throw new Error(r.error);
    // The stored exception says 10, but the general cap already allows 20 —
    // effectiveCapPct returns the wider of the two (an "exception" that
    // quietly tightens is a constraint and belongs in the cap field).
    expect(effectiveCapPct(r.policy, "AAPL")).toBe(20);
  });
});

describe("applyPolicyPatch — the reviewed-interpretation merge", () => {
  it("merges only stated fields, adds/replaces/removes exceptions, and re-validates through the one boundary", () => {
    const patched = applyPolicyPatch(DEFAULT_POLICY, {
      priorities: { resilience: 3 },
      tolerances: { maxDrawdownPct: 400 as never }, // out of range → clamped by parse
      addExceptions: [{ symbol: "nvda", maxPositionPct: 35, note: "conviction" }],
    });
    expect(patched.priorities.resilience).toBe(3);
    expect(patched.priorities.structure).toBe(DEFAULT_POLICY.priorities.structure); // untouched
    expect(patched.tolerances.maxDrawdownPct).toBe(95); // clamped, not trusted
    expect(patched.exceptions).toEqual([{ symbol: "NVDA", maxPositionPct: 35, note: "conviction" }]);

    const removed = applyPolicyPatch(patched, { removeExceptionSymbols: ["nvda"] });
    expect(removed.exceptions).toEqual([]);
  });

  it("describePolicyPatch narrates every effect in plain language — what the user approves", () => {
    const lines = describePolicyPatch({
      priorities: { income: 0 },
      tolerances: { maxPositionPct: 35, growthBandPct: [60, 95] },
      addExceptions: [{ symbol: "QQQM", maxPositionPct: 30, note: "high conviction" }],
    });
    expect(lines).toContain("Income priority → Off (fact only)");
    expect(lines).toContain("Max single position → 35%");
    expect(lines).toContain("Growth-engine band → 60–95%");
    expect(lines.some((l) => l.includes("QQQM may be up to 30%") && l.includes("high conviction"))).toBe(true);
  });
});
