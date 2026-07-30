/**
 * The ValuationCase persistence layer against an isolated throwaway database.
 *
 * The invariants under test are the ones the whole architecture rests on: the
 * event log is append-only, the case row is never more than a projection of the
 * newest event, and version numbers come from the log.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-valuation-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  appendValuationEvent,
  getValuationCase,
  listValuationCases,
  listValuationEvents,
  resetValuationCase,
} = await import("../lib/db");

const {
  applyAiProposals,
  applyUserEdits,
  computeCaseResult,
  diffAssumptions,
  seedAssumptions,
} = await import("../lib/valuation/case");

const SEED = {
  baseFcf: 100e9,
  sharesOutstanding: 15e9,
  netDebt: -50e9,
  price: 232,
  discountRate: 9,
  terminalGrowth: 2.5,
  deliveredGrowth: 8.1,
};

function seed(symbol: string, price: number | null = SEED.price) {
  const assumptions = seedAssumptions({ ...SEED, price });
  return appendValuationEvent({
    symbol,
    currency: "USD",
    author: "reverse",
    kind: "seeded",
    assumptions,
    result: computeCaseResult(assumptions, price),
    priceAt: price,
    triggerSource: "first_read",
  });
}

describe("appendValuationEvent", () => {
  it("creates version 1 and a readable projection", () => {
    const saved = seed("AAPL");
    expect(saved.version).toBe(1);
    expect(saved.symbol).toBe("AAPL");
    expect(saved.author).toBe("reverse");
    expect(saved.result.fairValue).toBeGreaterThan(0);
    expect(saved.priceAt).toBe(232);
    expect(saved.lastUserEventAt).toBeNull();

    const read = getValuationCase("AAPL");
    expect(read?.version).toBe(1);
    expect(read?.assumptions.growthRate1.value).toBeCloseTo(8.1, 10);
  });

  it("increments the version monotonically and keeps every prior version", () => {
    seed("MSFT");
    const first = getValuationCase("MSFT")!;

    const edited = applyUserEdits(first.assumptions, [
      { key: "growthRate1", value: 7, rationale: "Cloud decelerating." },
    ]);
    const v2 = appendValuationEvent({
      symbol: "MSFT",
      currency: "USD",
      author: "user",
      kind: "assumption_changed",
      assumptions: edited,
      result: computeCaseResult(edited, 232),
      priceAt: 232,
    });

    expect(v2.version).toBe(2);
    const events = listValuationEvents("MSFT");
    expect(events.map((e) => e.version)).toEqual([2, 1]);
    // The log is append-only: version 1 still holds the original assumption.
    expect(events[1].assumptions.growthRate1.value).toBeCloseTo(8.1, 10);
    expect(events[0].assumptions.growthRate1.value).toBe(7);
  });

  it("keeps the projection equal to the newest event", () => {
    seed("GOOGL");
    const base = getValuationCase("GOOGL")!;
    const edited = applyUserEdits(base.assumptions, [{ key: "terminalGrowth", value: 2 }]);
    appendValuationEvent({
      symbol: "GOOGL",
      currency: "USD",
      author: "user",
      kind: "assumption_changed",
      assumptions: edited,
      result: computeCaseResult(edited, 232),
      priceAt: 232,
    });

    const projection = getValuationCase("GOOGL")!;
    const newest = listValuationEvents("GOOGL")[0];
    expect(projection.version).toBe(newest.version);
    expect(projection.assumptions).toEqual(newest.assumptions);
    expect(projection.result.fairValue).toBeCloseTo(newest.result.fairValue!, 8);
    expect(projection.result.marginOfSafety).toBeCloseTo(newest.result.marginOfSafety!, 8);
  });

  it("stores the price at write time on every event", () => {
    // Without this, "what margin of safety did you believe when you decided?"
    // is unanswerable and calibration cannot be added later.
    seed("NVDA", 100);
    const base = getValuationCase("NVDA")!;
    const edited = applyUserEdits(base.assumptions, [{ key: "growthRate1", value: 12 }]);
    appendValuationEvent({
      symbol: "NVDA",
      currency: "USD",
      author: "user",
      kind: "assumption_changed",
      assumptions: edited,
      result: computeCaseResult(edited, 180),
      priceAt: 180,
    });

    const events = listValuationEvents("NVDA");
    expect(events.map((e) => e.priceAt)).toEqual([180, 100]);
  });

  it("stamps last_user_event_at only for user events, and preserves it after", () => {
    seed("AMZN");
    expect(getValuationCase("AMZN")!.lastUserEventAt).toBeNull();

    const base = getValuationCase("AMZN")!;
    const edited = applyUserEdits(base.assumptions, [{ key: "growthRate1", value: 6 }]);
    appendValuationEvent({
      symbol: "AMZN", currency: "USD", author: "user", kind: "assumption_changed",
      assumptions: edited, result: computeCaseResult(edited, 232), priceAt: 232,
    });
    const afterUser = getValuationCase("AMZN")!;
    expect(afterUser.lastUserEventAt).not.toBeNull();

    // A later AI refresh must not erase when the user last engaged, or the
    // Register can never say "you have not looked at this in eight months".
    const refreshed = applyAiProposals(afterUser.assumptions, [
      { key: "terminalGrowth", value: 2.2, rationale: "Mature segment mix." },
    ]).assumptions;
    appendValuationEvent({
      symbol: "AMZN", currency: "USD", author: "ai", kind: "ai_refresh",
      assumptions: refreshed, result: computeCaseResult(refreshed, 232), priceAt: 232,
      triggerSource: "ic_report",
    });

    const afterAi = getValuationCase("AMZN")!;
    expect(afterAi.author).toBe("ai");
    expect(afterAi.version).toBe(3);
    expect(afterAi.lastUserEventAt).toBe(afterUser.lastUserEventAt);
  });

  it("records what caused each write", () => {
    seed("META");
    const events = listValuationEvents("META");
    expect(events[0].kind).toBe("seeded");
    expect(events[0].trigger).toBe("first_read");
    expect(events[0].note).toBeNull();
  });

  it("survives a user edit that makes the model unvaluable", () => {
    seed("INTC");
    const base = getValuationCase("INTC")!;
    const broken = applyUserEdits(base.assumptions, [{ key: "discountRate", value: 1 }]);
    const saved = appendValuationEvent({
      symbol: "INTC", currency: "USD", author: "user", kind: "assumption_changed",
      assumptions: broken, result: computeCaseResult(broken, 232), priceAt: 232,
    });
    expect(saved.version).toBe(2);
    expect(saved.result.fairValue).toBeNull();
    // The prior, valuable version is still there to fall back to.
    expect(listValuationEvents("INTC")[1].result.fairValue).toBeGreaterThan(0);
  });

  it("normalises the symbol", () => {
    seed("tsla".toUpperCase());
    expect(getValuationCase("tsla")?.symbol).toBe("TSLA");
  });

  it("reports an unvaluable case as unvaluable on read", () => {
    // Regression: the projection used to hand back a hardcoded invalidReason of
    // null, so every write response claimed the case was valuable. Saving a WACC
    // below terminal growth then produced scenario cards full of "—" with no
    // explanation, because the UI reads this field to decide what to render.
    seed("PYPL");
    const base = getValuationCase("PYPL")!;
    const broken = applyUserEdits(base.assumptions, [{ key: "discountRate", value: 1 }]);
    const saved = appendValuationEvent({
      symbol: "PYPL", currency: "USD", author: "user", kind: "assumption_changed",
      assumptions: broken, result: computeCaseResult(broken, 232), priceAt: 232,
    });

    expect(saved.result.invalidReason).toBe("wacc_below_terminal_growth");
    expect(getValuationCase("PYPL")!.result.invalidReason).toBe("wacc_below_terminal_growth");
  });

  it("derives the result from the stored assumptions, never contradicting them", () => {
    seed("SHOP");
    const read = getValuationCase("SHOP")!;
    const recomputed = computeCaseResult(read.assumptions, read.priceAt);
    expect(read.result.fairValue).toBeCloseTo(recomputed.fairValue!, 8);
    expect(read.result.impliedUpside).toBeCloseTo(recomputed.impliedUpside!, 8);
    expect(read.result.impliedGrowth).toBeCloseTo(recomputed.impliedGrowth!, 8);
  });
});

describe("listValuationCases", () => {
  it("returns every case, for the Register", () => {
    const symbols = listValuationCases().map((c) => c.symbol);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
    // Ordered by most recent activity.
    expect(symbols.length).toBeGreaterThan(3);
  });
});

describe("case history as a diff", () => {
  it("reconstructs what changed between two versions from the log alone", () => {
    seed("ORCL");
    const base = getValuationCase("ORCL")!;
    const edited = applyUserEdits(base.assumptions, [
      { key: "growthRate1", value: 5.5, rationale: "License mix shifting." },
    ]);
    appendValuationEvent({
      symbol: "ORCL", currency: "USD", author: "user", kind: "assumption_changed",
      assumptions: edited, result: computeCaseResult(edited, 232), priceAt: 232,
    });

    const [newest, oldest] = listValuationEvents("ORCL");
    const changes = diffAssumptions(oldest.assumptions, newest.assumptions);
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toBe("growthRate1");
    expect(changes[0].to).toBe(5.5);
  });
});

describe("resetValuationCase", () => {
  it("erases the case and its history", () => {
    seed("CRM");
    expect(getValuationCase("CRM")).not.toBeNull();
    resetValuationCase("CRM");
    expect(getValuationCase("CRM")).toBeNull();
    expect(listValuationEvents("CRM")).toEqual([]);
  });

  it("lets a symbol start over at version 1", () => {
    seed("ADBE");
    resetValuationCase("ADBE");
    expect(seed("ADBE").version).toBe(1);
  });
});
