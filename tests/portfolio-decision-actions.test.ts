/**
 * Decision Center → executable action resolution.
 *
 * The contract under test (app/portfolio/_components/universal/decision-action.ts):
 * every recommendation's own `change` object maps onto the ONE write path that
 * already exists for it, and the ledger's indivisibility rule (a `manual:` asset
 * has no share ledger) is respected by never offering a partial sale of one.
 * All fixtures are hand-constructed minimal DecisionCards/Holdings.
 */
import { describe, expect, it } from "vitest";
import {
  executionLabel,
  resolveDecisionExecution,
  type DecisionExecution,
} from "@/app/portfolio/_components/universal/decision-action";
import type { DecisionCard } from "@/lib/portfolio/engines/decision";
import type { Recommendation } from "@/lib/portfolio/engines/recommend";
import type { PortfolioChange } from "@/lib/portfolio/engines/simulate";
import type { Holding } from "@/lib/portfolio/model/types";

/* ────────────────────────────── Fixtures ────────────────────────────── */

function holding(partial: Partial<Holding> & { id: string }): Holding {
  const valueBase = partial.valuation?.valueBase ?? 10_000;
  return {
    assetClass: "equity",
    symbol: null,
    name: partial.id,
    currency: "USD",
    quantity: 10,
    unit: "shares",
    costBasis: valueBase,
    costBasisBase: valueBase,
    acquiredAt: "2024-01-01",
    weight: 10,
    valuation: {
      mode: "market",
      value: valueBase,
      valueBase,
      fxRate: 1,
      source: "yahoo",
      asOf: "2026-08-12T20:00:00.000Z",
      stale: false,
    },
    unrealizedPL: null,
    unrealizedPct: null,
    liquidity: "t0",
    income: null,
    factors: {},
    metrics: {},
    attributes: {},
    score: null,
    meta: {},
    ...partial,
  } as Holding;
}

function decision(
  change: PortfolioChange,
  overrides: Partial<Recommendation> = {},
): DecisionCard {
  const rec: Partial<Recommendation> = {
    id: "rec-1",
    action: "ADD",
    title: "Test decision",
    subject: "Test",
    symbol: null,
    rationale: "because",
    confidence: 80,
    confidenceBasis: [],
    amount: 5_000,
    tradeoffs: [],
    change,
    priority: 1,
    alternatives: [],
    alternativesEvaluated: 1,
    ...overrides,
  };
  return { recommendation: rec as Recommendation } as DecisionCard;
}

const candidateAGG = holding({ id: "candidate:AGG", symbol: "AGG", name: "iShares Core US Aggregate Bond ETF" });

/* ────────────────────────────── Buys ────────────────────────────── */

describe("resolveDecisionExecution — buy changes", () => {
  it("routes a gap-fill ADD of an unheld symbol to the opening-buy flow", () => {
    const d = decision({ kind: "buy", holding: candidateAGG, amount: 9_000 }, { symbol: "AGG", amount: 9_000 });
    expect(resolveDecisionExecution(d, [holding({ id: "lot:VOO", symbol: "VOO" })])).toEqual({
      kind: "buy_new",
      symbol: "AGG",
      name: "iShares Core US Aggregate Bond ETF",
      amount: 9_000,
    });
  });

  it("routes a buy of an ALREADY-HELD symbol through that existing position (avg cost keeps averaging)", () => {
    const held = holding({ id: "lot:AGG", symbol: "AGG" });
    const exec = resolveDecisionExecution(
      decision({ kind: "buy", holding: candidateAGG, amount: 4_000 }, { symbol: "AGG", amount: 4_000 }),
      [held],
    );
    expect(exec).toEqual({ kind: "buy_existing", holding: held, amount: 4_000 });
  });

  it("matches held symbols case-insensitively", () => {
    const held = holding({ id: "lot:agg", symbol: "agg" });
    const exec = resolveDecisionExecution(
      decision({ kind: "buy", holding: candidateAGG, amount: 4_000 }, { symbol: "AGG" }),
      [held],
    );
    expect(exec.kind).toBe("buy_existing");
  });

  it("never routes a buy INTO a manual asset, even on a symbol match", () => {
    // A manually-valued asset cannot be bought into in increments (no share
    // ledger) — the engine refuses it, so the UI must not offer it.
    const manual = holding({ id: "manual:agg-note", symbol: "AGG" });
    const exec = resolveDecisionExecution(
      decision({ kind: "buy", holding: candidateAGG, amount: 4_000 }, { symbol: "AGG" }),
      [manual],
    );
    expect(exec.kind).toBe("buy_new");
  });
});

/* ────────────────────────────── Sells ────────────────────────────── */

describe("resolveDecisionExecution — sell changes", () => {
  it("routes a REDUCE trim to a partial sell with the engine's own amount", () => {
    const qqqm = holding({ id: "lot:QQQM", symbol: "QQQM" });
    const exec = resolveDecisionExecution(
      decision({ kind: "sell", holdingId: "lot:QQQM", amount: 4_120 }, { action: "REDUCE", amount: 4_120 }),
      [qqqm],
    );
    expect(exec).toEqual({ kind: "sell", holding: qqqm, amount: 4_120, full: false });
  });

  it("routes an exit (action SELL) to a full sale", () => {
    const weak = holding({ id: "lot:WEAK", symbol: "WEAK" });
    const exec = resolveDecisionExecution(
      // recommend.ts sizes an exit as Math.round(valueBase) — up to $0.50 short.
      decision({ kind: "sell", holdingId: "lot:WEAK", amount: 10_000 }, { action: "SELL", amount: 10_000 }),
      [weak],
    );
    expect(exec).toEqual({ kind: "sell", holding: weak, amount: 10_000, full: true });
  });

  it("treats a REDUCE whose amount covers the whole position (minus dust) as full", () => {
    // Mirrors engines/transaction.ts isFullDisposal: residue < $1 AND < 1% of position.
    const h = holding({ id: "lot:X", symbol: "X", valuation: {
      mode: "market", value: 500, valueBase: 500, fxRate: 1, source: "yahoo",
      asOf: "2026-08-12T20:00:00.000Z", stale: false,
    } });
    const exec = resolveDecisionExecution(
      decision({ kind: "sell", holdingId: "lot:X", amount: 499.6 }, { action: "REDUCE" }),
      [h],
    ) as Extract<DecisionExecution, { kind: "sell" }>;
    expect(exec.kind).toBe("sell");
    expect(exec.full).toBe(true);
  });

  it("refuses to offer a partial sale of a manual asset — advice stands, trade doesn't exist", () => {
    const home = holding({ id: "manual:home", symbol: null, name: "Primary residence", valuation: {
      mode: "manual", value: 800_000, valueBase: 800_000, fxRate: 1, source: "user",
      asOf: "2026-08-12T20:00:00.000Z", stale: false,
    } });
    const exec = resolveDecisionExecution(
      decision({ kind: "sell", holdingId: "manual:home", amount: 40_000 }, { action: "REDUCE", amount: 40_000 }),
      [home],
    );
    expect(exec).toEqual({ kind: "manual_partial", holding: home });
  });

  it("allows a FULL disposal of a manual asset (row deletion is a trade the ledger can express)", () => {
    const stake = holding({ id: "manual:stake", symbol: null, name: "PE stake" });
    const exec = resolveDecisionExecution(
      decision({ kind: "sell", holdingId: "manual:stake", amount: 10_000 }, { action: "SELL", amount: 10_000 }),
      [stake],
    ) as Extract<DecisionExecution, { kind: "sell" }>;
    expect(exec.kind).toBe("sell");
    expect(exec.full).toBe(true);
  });

  it("reports stale when the holding has left the book since the report was built", () => {
    const exec = resolveDecisionExecution(
      decision({ kind: "sell", holdingId: "lot:GONE", amount: 1_000 }, { action: "REDUCE" }),
      [],
    );
    expect(exec).toEqual({ kind: "stale" });
  });
});

/* ────────────────────────────── Targets & labels ────────────────────────────── */

describe("resolveDecisionExecution — target changes and labels", () => {
  it("routes a target-weight change to the Optimize tab", () => {
    const exec = resolveDecisionExecution(
      decision({ kind: "target", holdingId: "lot:VOO", targetWeight: 20 }, { action: "REALLOCATE" }),
      [holding({ id: "lot:VOO", symbol: "VOO" })],
    );
    expect(exec).toEqual({ kind: "rebalance" });
  });

  it("labels every executable kind and stays silent for the non-executable ones", () => {
    const h = holding({ id: "lot:QQQM", symbol: "QQQM" });
    expect(executionLabel({ kind: "buy_new", symbol: "AGG", name: "AGG", amount: 1 })).toBe("Buy AGG");
    expect(executionLabel({ kind: "buy_existing", holding: h, amount: 1 })).toBe("Buy more QQQM");
    expect(executionLabel({ kind: "sell", holding: h, amount: 1, full: false })).toBe("Sell QQQM");
    expect(executionLabel({ kind: "sell", holding: h, amount: 1, full: true })).toBe("Sell all QQQM");
    expect(executionLabel({ kind: "rebalance" })).toBe("Open in Optimize");
    expect(executionLabel({ kind: "manual_partial", holding: h })).toBeNull();
    expect(executionLabel({ kind: "stale" })).toBeNull();
  });
});
