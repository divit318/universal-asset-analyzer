import { describe, expect, it } from "vitest";
import {
  EMPTY_REFINEMENT,
  parseAssumptionRefinement,
} from "@/lib/valuation/ai";
import {
  applyAiProposals,
  applyUserEdits,
  seedAssumptions,
  summarizeCase,
  type AssumptionKey,
  type ValuationCase,
} from "@/lib/valuation/case";
import { computeCaseResult } from "@/lib/valuation/case";

const SEED = {
  baseFcf: 100e9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
  price: 232,
  discountRate: 9,
  terminalGrowth: 2.5,
  deliveredGrowth: 8.1,
  now: "2026-01-15T00:00:00.000Z",
};

const NONE: ReadonlySet<AssumptionKey> = new Set();

function json(body: unknown): string {
  return JSON.stringify(body);
}

/* -------------------------------------------------------------------------- */
/* The locked rule, enforced at the parse boundary                             */
/* -------------------------------------------------------------------------- */

describe("parseAssumptionRefinement — locked assumptions", () => {
  it("demotes a value proposed for a user-owned assumption to a critique", () => {
    // The load-bearing asymmetry: AI may argue with the user's judgment but must
    // never quietly replace it. Enforced here, before the case is touched.
    const result = parseAssumptionRefinement(
      json({
        assumptions: [
          { key: "growthRate1", value: 9.2, rationale: "History says 8.1%.", critique: "7% is harsh versus a 5-year 8.1%." },
        ],
      }),
      new Set<AssumptionKey>(["growthRate1"]),
    );

    expect(result.proposals).toEqual([]);
    expect(result.critiques).toEqual([
      { key: "growthRate1", critique: "7% is harsh versus a 5-year 8.1%." },
    ]);
  });

  it("falls back to the rationale when a locked key has no explicit critique", () => {
    const result = parseAssumptionRefinement(
      json({ assumptions: [{ key: "growthRate1", value: 9.2, rationale: "History says 8.1%." }] }),
      new Set<AssumptionKey>(["growthRate1"]),
    );
    expect(result.proposals).toEqual([]);
    expect(result.critiques[0].critique).toBe("History says 8.1%.");
  });

  it("drops a locked key entirely when it carries no argument at all", () => {
    const result = parseAssumptionRefinement(
      json({ assumptions: [{ key: "growthRate1", value: 9.2 }] }),
      new Set<AssumptionKey>(["growthRate1"]),
    );
    expect(result.proposals).toEqual([]);
    expect(result.critiques).toEqual([]);
  });

  it("still proposes values for assumptions the user has not claimed", () => {
    const result = parseAssumptionRefinement(
      json({
        assumptions: [
          { key: "growthRate1", value: 9.2, rationale: "Locked — argue only." },
          { key: "terminalGrowth", value: 2.2, rationale: "Mature category." },
        ],
      }),
      new Set<AssumptionKey>(["growthRate1"]),
    );
    expect(result.proposals).toEqual([
      { key: "terminalGrowth", value: 2.2, rationale: "Mature category.", critique: null },
    ]);
    expect(result.critiques.map((c) => c.key)).toEqual(["growthRate1"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

describe("parseAssumptionRefinement — validation", () => {
  it("discards implausible values rather than clamping them", () => {
    // Clamping would attach a real rationale to a number the model never argued
    // for, which reads more convincing than it is.
    const result = parseAssumptionRefinement(
      json({
        assumptions: [
          { key: "terminalGrowth", value: 40, rationale: "Perpetual hypergrowth." },
          { key: "discountRate", value: 0.5, rationale: "Riskless." },
          { key: "growthRate1", value: 500, rationale: "Ten-bagger." },
        ],
      }),
      NONE,
    );
    expect(result.proposals).toEqual([]);
  });

  it("requires a rationale before storing a number", () => {
    const result = parseAssumptionRefinement(
      json({ assumptions: [{ key: "growthRate1", value: 7 }] }),
      NONE,
    );
    expect(result.proposals).toEqual([]);
  });

  it("ignores unknown keys and non-numeric values", () => {
    const result = parseAssumptionRefinement(
      json({
        assumptions: [
          { key: "vibes", value: 10, rationale: "Feels right." },
          { key: "growthRate1", value: "eight", rationale: "Stringly typed." },
          { key: "growthRate2", value: null, rationale: "Null." },
        ],
      }),
      NONE,
    );
    expect(result.proposals).toEqual([]);
  });

  it("keeps the first mention when a key is proposed twice", () => {
    const result = parseAssumptionRefinement(
      json({
        assumptions: [
          { key: "growthRate1", value: 7, rationale: "First." },
          { key: "growthRate1", value: 12, rationale: "Contradicts itself." },
        ],
      }),
      NONE,
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].value).toBe(7);
  });

  it("survives garbage without throwing", () => {
    expect(parseAssumptionRefinement("not json at all", NONE)).toEqual(EMPTY_REFINEMENT);
    expect(parseAssumptionRefinement("", NONE)).toEqual(EMPTY_REFINEMENT);
    expect(parseAssumptionRefinement(json({ assumptions: "nope" }), NONE).proposals).toEqual([]);
  });

  it("carries the assessment and de-duplicated weakest list through", () => {
    const result = parseAssumptionRefinement(
      json({
        assumptions: [],
        assessment: "  Agrees on growth, disagrees on WACC.  ",
        weakest: ["discountRate", "discountRate", "nonsense", "terminalGrowth"],
      }),
      NONE,
    );
    expect(result.assessment).toBe("Agrees on growth, disagrees on WACC.");
    expect(result.weakest).toEqual(["discountRate", "terminalGrowth"]);
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end: reverse DCF → case → AI → user edit → locked → AI again         */
/* -------------------------------------------------------------------------- */

describe("the full refinement flow", () => {
  it("lets AI refine a fresh case, then defers to the user permanently", () => {
    // 1. Seeded from the reverse DCF / delivered growth.
    const seeded = seedAssumptions(SEED);
    expect(seeded.growthRate1.locked).toBe(false);
    expect(seeded.growthRate1.source).toBe("history");

    // 2. AI refines it — allowed, nothing is claimed yet.
    const firstPass = parseAssumptionRefinement(
      json({
        assumptions: [{ key: "growthRate1", value: 9.2, rationale: "Services mix richer than group average." }],
        assessment: "Growth looks conservative.",
      }),
      new Set(),
    );
    const afterAi = applyAiProposals(seeded, firstPass.proposals).assumptions;
    expect(afterAi.growthRate1.value).toBe(9.2);
    expect(afterAi.growthRate1.source).toBe("ai");
    expect(afterAi.growthRate1.locked).toBe(false);

    // 3. The user disagrees and takes ownership.
    const afterUser = applyUserEdits(afterAi, [
      { key: "growthRate1", value: 7, rationale: "Services decelerating; I do not buy the mix argument." },
    ]);
    expect(afterUser.growthRate1.locked).toBe(true);
    expect(afterUser.growthRate1.source).toBe("user");

    // 4. AI runs again and tries to put its number back.
    const lockedKeys = new Set<AssumptionKey>(["growthRate1"]);
    const secondPass = parseAssumptionRefinement(
      json({
        assumptions: [{ key: "growthRate1", value: 9.2, rationale: "Still think 9.2%.", critique: "7% implies services stalls outright." }],
      }),
      lockedKeys,
    );
    const afterSecondAi = applyAiProposals(afterUser, secondPass.proposals).assumptions;

    // The user's value survives; the objection is recorded beside it.
    expect(afterSecondAi.growthRate1.value).toBe(7);
    expect(afterSecondAi.growthRate1.source).toBe("user");
    expect(secondPass.critiques[0].critique).toBe("7% implies services stalls outright.");

    // 5. And the case still values, so the flow produced a usable number throughout.
    const result = computeCaseResult(afterSecondAi, SEED.price);
    expect(result.fairValue).toBeGreaterThan(0);
    expect(result.invalidReason).toBeNull();
  });

  it("routes a proposal away even if the parse boundary is bypassed", () => {
    // Defence in depth: applyAiProposals must refuse a locked key on its own,
    // without relying on the parser having filtered it first.
    const owned = applyUserEdits(seedAssumptions(SEED), [{ key: "growthRate1", value: 7 }]);
    const { assumptions, respected } = applyAiProposals(owned, [
      { key: "growthRate1", value: 9.2, rationale: "Bypassing the parser.", critique: null },
    ]);
    expect(assumptions.growthRate1.value).toBe(7);
    expect(respected).toEqual(["growthRate1"]);
  });
});

/* -------------------------------------------------------------------------- */
/* The shared case formatter                                                   */
/* -------------------------------------------------------------------------- */

describe("summarizeCase", () => {
  const assumptions = applyUserEdits(seedAssumptions(SEED), [
    { key: "growthRate1", value: 7, rationale: "Services decelerating." },
  ]);
  const vcase: ValuationCase = {
    symbol: "AAPL",
    currency: "USD",
    method: "dcf_fcf",
    version: 3,
    author: "user",
    assumptions,
    result: computeCaseResult(assumptions, SEED.price),
    priceAt: SEED.price,
    createdAt: SEED.now,
    updatedAt: SEED.now,
    lastUserEventAt: SEED.now,
  };

  it("marks user-owned assumptions so AI knows what it may not change", () => {
    const text = summarizeCase(vcase);
    expect(text).toContain("user-owned");
    expect(text).toContain("Services decelerating.");
  });

  it("states the case's own value and the price-implied growth beside it", () => {
    const text = summarizeCase(vcase);
    expect(text).toContain("VALUATION CASE v3 (AAPL)");
    expect(text).toContain("Implied fair value:");
    expect(text).toContain("Margin of safety:");
  });

  it("tells AI that price-implied growth is conditional, not a market forecast", () => {
    // The prompt is the only place this caveat can travel, so it has to be in
    // the summary itself rather than only in the UI label.
    const text = summarizeCase(vcase);
    expect(text).toContain("given this case's WACC and terminal growth");
  });

  it("says so plainly when the case cannot be valued", () => {
    const broken = applyUserEdits(vcase.assumptions, [{ key: "discountRate", value: 1 }]);
    const text = summarizeCase({
      ...vcase,
      assumptions: broken,
      result: computeCaseResult(broken, SEED.price),
    });
    expect(text).toContain("not computable");
  });
});
