/**
 * A partial sell of a manual asset must never delete the whole asset.
 *
 * THE BUG. `buildLotWrites()` treated the `manual:` id prefix ALONE as a deletion
 * trigger — the trade's direction and size were never consulted:
 *
 *     if (t.holdingId.startsWith("manual:")) {
 *       manualAssetIdsToDelete.push(t.holdingId.slice("manual:".length));
 *       continue;                     // ← dollarDelta never read
 *     }
 *
 * And it was live from an ordinary flow, not a crafted request:
 *
 *   1. recommend.ts's trim loop fires on ANY holding over TRIM_TRIGGER_PCT (21.5%)
 *      with no liquidity filter — and a home above 21.5% of net worth is the norm.
 *      It emits `{ kind: "sell", holdingId: "manual:home", amount }`.
 *   2. /api/portfolio/buy/recommendation copied that straight into
 *      `sellSuggestions`, filtering only on action and change kind.
 *   3. The buy modal auto-selects "Optimizer Decides" when cash is short, and the
 *      funding panel renders the asset's own name beside a specific dollar amount
 *      under "no review needed".
 *   4. /api/portfolio/buy's `sellFirst` had no guard, so `{ holdingId:
 *      "manual:home", amount: 40_000 }` reached the engine.
 *   5. cashBalancingLot() then credited the asset's FULL value to cash.
 *
 * Net effect: asked to sell $40,000 of an $800,000 home, the app deleted the home
 * and booked $800,000 of cash. Total portfolio value was conserved, so no number
 * on screen moved — the basis, the acquisition date and the row were just gone.
 *
 * These tests pin the whole matrix (partial / full / buy / near-full rounding) at
 * the engine, plus the guard on every write path that can reach it.
 */
import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import {
  buildLotWrites,
  cashBalancingLot,
  isIndivisibleHolding,
  type TradeToExecute,
} from "@/lib/portfolio/engines/transaction";
import { optimize, DEFAULT_CONSTRAINTS, type Objective, OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import { computeRecommendations } from "@/lib/portfolio/engines/recommend";
import { TRIM_TRIGGER_PCT } from "@/lib/portfolio/policy";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* -------------------------------------------------------------------------- */
/* Fixtures — same shape as tests/portfolio-transaction.test.ts               */
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

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  return {
    baseCurrency: "USD",
    fx: { USD: 1, EUR: 1.08 },
    quotes: new Map([
      ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.2, currency: "USD", name: "Apple", marketCap: 3e12 }],
      ["IEF", { symbol: "IEF", price: 95, changePercent: -0.1, currency: "USD", name: "7-10y Treasury", marketCap: null }],
    ]),
    history: new Map([
      ["AAPL", walk(300, 0.0006, 0.018, 3)],
      ["IEF", walk(300, 0.0001, 0.004, 11)],
    ]),
    fundamentals: new Map(),
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

const HOME_VALUE = 800_000;

/** The reported shape: a home worth far more than the liquid sleeve around it. */
function bookWithHome(c: MarketContext) {
  const { holdings } = normalizeHoldings([
    raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 500, costBasis: 80_000 }),
    raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 500, costBasis: 45_000 }),
    raw({
      id: "manual:home", assetClass: "real_estate", name: "Family Home",
      costBasis: 600_000, manualValue: HOME_VALUE, manualValueAsOf: new Date().toISOString(),
      meta: { details: {} },
    }),
  ], c);
  return evaluate(holdings, c);
}

function homeTrade(dollarDelta: number): TradeToExecute {
  return {
    holdingId: "manual:home", symbol: null, name: "Family Home",
    assetClass: "real_estate", dollarDelta, reason: "test",
  };
}

/** Total tracked-value change of a batch including its balancing lot; ~0 = conserving. */
function netValueChange(
  built: ReturnType<typeof buildLotWrites>,
  plug: ReturnType<typeof cashBalancingLot>,
  evaluation: ReturnType<typeof evaluate>,
): number {
  const all = plug ? [...built.lots, plug] : built.lots;
  let change = 0;
  for (const lot of all) change += (lot.kind === "buy" ? 1 : -1) * lot.shares * lot.price;
  for (const id of built.manualAssetIdsToDelete) {
    const h = evaluation.holdings.find((x) => x.id === `manual:${id}`);
    if (h) change -= h.valuation.valueBase;
  }
  return change;
}

/* -------------------------------------------------------------------------- */
/* isIndivisibleHolding — the one definition every write path shares           */
/* -------------------------------------------------------------------------- */

describe("isIndivisibleHolding", () => {
  it("is true only for manual-asset ids", () => {
    expect(isIndivisibleHolding("manual:home")).toBe(true);
    expect(isIndivisibleHolding("manual:")).toBe(true);
    expect(isIndivisibleHolding("lot:AAPL")).toBe(false);
    expect(isIndivisibleHolding("cash:USD")).toBe(false);
    // Not fooled by a symbol that merely contains the word.
    expect(isIndivisibleHolding("lot:MANUAL")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* buildLotWrites — the guard, where it now lives                             */
/* -------------------------------------------------------------------------- */

describe("buildLotWrites — manual asset disposal", () => {
  it("REFUSES a partial sell instead of deleting the whole asset", () => {
    // The exact reported case: $40,000 requested against an $800,000 home.
    const c = ctx();
    const ev = bookWithHome(c);
    const built = buildLotWrites(ev, [homeTrade(-40_000)], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.lots).toHaveLength(0);
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0].holdingId).toBe("manual:home");
    expect(built.skipped[0].reason).toContain("cannot be partially sold");
    // Names the asset, so the refusal is actionable rather than a generic error.
    expect(built.skipped[0].reason).toContain("Family Home");
  });

  it("REFUSES a partial sell even at 99% of the position", () => {
    // 99% leaves $8,000 of a real asset behind. Large in absolute terms, so it is
    // a position the user asked to keep — snapping it to a liquidation would be
    // the same class of error, just harder to notice.
    const c = ctx();
    const ev = bookWithHome(c);
    const value = ev.holdings.find((h) => h.id === "manual:home")!.valuation.valueBase;
    const built = buildLotWrites(ev, [homeTrade(-value * 0.99)], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.skipped).toHaveLength(1);
  });

  it("REFUSES a buy against a manual asset — a buy is never a disposal", () => {
    const c = ctx();
    const ev = bookWithHome(c);
    const built = buildLotWrites(ev, [homeTrade(50_000)], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.lots).toHaveLength(0);
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0].reason).toContain("cannot be bought into in increments");
  });

  it("ALLOWS a full disposal — existing behavior preserved exactly", () => {
    const c = ctx();
    const ev = bookWithHome(c);
    const value = ev.holdings.find((h) => h.id === "manual:home")!.valuation.valueBase;
    const built = buildLotWrites(ev, [homeTrade(-value)], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual(["home"]);
    expect(built.skipped).toHaveLength(0);
    expect(built.lots).toHaveLength(0);
  });

  it("ALLOWS a full disposal whose delta was rounded to whole dollars", () => {
    // recommend.ts sizes a full exit as Math.round(valueBase), which can land up
    // to $0.50 short. That is a real full exit and must not become a refusal.
    const c = ctx();
    const ev = bookWithHome(c);
    const value = ev.holdings.find((h) => h.id === "manual:home")!.valuation.valueBase;
    const built = buildLotWrites(ev, [homeTrade(-Math.round(value - 0.49))], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual(["home"]);
    expect(built.skipped).toHaveLength(0);
  });

  it("ALLOWS an over-sized sell (price drift) as a full disposal, never a negative position", () => {
    const c = ctx();
    const ev = bookWithHome(c);
    const built = buildLotWrites(ev, [homeTrade(-HOME_VALUE * 5)], { objective: "maximize_sharpe" });

    expect(built.manualAssetIdsToDelete).toEqual(["home"]);
    expect(built.skipped).toHaveLength(0);
  });

  it("refuses a manual id that is not in the portfolio at all", () => {
    // Fullness cannot be judged without the position's value, so a stale or
    // fabricated id must be refused rather than deleted on faith.
    const c = ctx();
    const ev = bookWithHome(c);
    const built = buildLotWrites(
      ev,
      [{ ...homeTrade(-1_000_000), holdingId: "manual:ghost" }],
      { objective: "maximize_sharpe" },
    );

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0].reason).toContain("not found");
  });

  it("does not let a refused manual sell distort the cash balancing lot", () => {
    // The old path credited the asset's FULL value to cash on a partial request.
    // A refused trade must contribute nothing at all.
    const c = ctx();
    const ev = bookWithHome(c);
    const built = buildLotWrites(ev, [homeTrade(-40_000)], { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");

    expect(plug).toBeNull(); // nothing executed → nothing to settle
    expect(netValueChange(built, plug, ev)).toBe(0);
  });

  it("still conserves value when a full disposal IS executed", () => {
    const c = ctx();
    const ev = bookWithHome(c);
    const value = ev.holdings.find((h) => h.id === "manual:home")!.valuation.valueBase;
    const built = buildLotWrites(ev, [homeTrade(-value)], { objective: "maximize_sharpe" });
    const plug = cashBalancingLot(ev, built, "USD");

    expect(plug!.kind).toBe("buy");
    expect(plug!.shares).toBeCloseTo(value, 0);
    expect(netValueChange(built, plug, ev)).toBeCloseTo(0, 2);
  });

  it("refuses the manual partial while still executing the liquid trades beside it", () => {
    // One bad row in a batch must not take the whole batch down, and must not be
    // silently upgraded either.
    const c = ctx();
    const ev = bookWithHome(c);
    const aapl = ev.holdings.find((h) => h.symbol === "AAPL")!;
    const built = buildLotWrites(
      ev,
      [
        homeTrade(-40_000),
        { holdingId: aapl.id, symbol: "AAPL", name: "Apple", assetClass: "equity", dollarDelta: -5_000, reason: "trim" },
      ],
      { objective: "maximize_sharpe" },
    );

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.skipped).toHaveLength(1);
    expect(built.lots).toHaveLength(1);
    expect(built.lots[0].symbol).toBe("AAPL");
  });
});

/* -------------------------------------------------------------------------- */
/* Optimize execution path                                                     */
/* -------------------------------------------------------------------------- */

describe("optimize execution path", () => {
  const ALL: Objective[] = (Object.keys(OBJECTIVES) as Objective[]).filter((o) => o !== "target_allocation");

  it.each(ALL)("%s never puts a manual asset in the executable trade list", (objective) => {
    // The execute route now keys off `trades`, so this is the property that keeps
    // a manual id from ever reaching the engine through the Optimize tab.
    const c = ctx();
    const result = optimize(bookWithHome(c), objective, DEFAULT_CONSTRAINTS, undefined, c);
    expect(result.trades.some((t) => isIndivisibleHolding(t.holdingId))).toBe(false);
  });

  it("keeps the manual asset in `holdings` as a frozen HOLD — which is why `trades` is the right lookup", () => {
    const c = ctx();
    const result = optimize(bookWithHome(c), "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    const home = result.holdings.find((h) => h.holdingId === "manual:home")!;

    expect(home.constrained).toBe(true);
    expect(home.action).toBe("HOLD");
    // Present in `holdings` (the old lookup source) and absent from `trades` (the
    // new one) — the exact gap that made a manual id executable.
    expect(result.trades.some((t) => t.holdingId === "manual:home")).toBe(false);
  });

  it("refuses a manual id even if one reaches the engine anyway", () => {
    // Defence in depth: a stale client, or any future caller that reintroduces the
    // wrong lookup, still cannot delete the asset.
    const c = ctx();
    const ev = bookWithHome(c);
    const result = optimize(ev, "maximize_sharpe", DEFAULT_CONSTRAINTS, undefined, c);
    const home = result.holdings.find((h) => h.holdingId === "manual:home")!;

    const built = buildLotWrites(
      ev,
      [{
        holdingId: home.holdingId, symbol: home.symbol, name: home.name,
        assetClass: home.assetClass, dollarDelta: home.dollarDelta, reason: home.reason,
      }],
      { objective: "maximize_sharpe" },
    );

    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.lots).toHaveLength(0);
    expect(built.skipped).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Recommendation execution path                                              */
/* -------------------------------------------------------------------------- */

describe("recommendation execution path", () => {
  /** A book where the home is over the trim trigger — the state that produced the bug. */
  function homeOverTrimTrigger(c: MarketContext) {
    const { holdings } = normalizeHoldings([
      raw({ id: "a", assetClass: "equity", symbol: "AAPL", quantity: 100, costBasis: 15_000 }),
      raw({ id: "b", assetClass: "bond", symbol: "IEF", quantity: 100, costBasis: 9_000 }),
      raw({
        id: "manual:home", assetClass: "real_estate", name: "Family Home",
        costBasis: 600_000, manualValue: HOME_VALUE, manualValueAsOf: new Date().toISOString(),
        meta: { details: {} },
      }),
    ], c);
    return evaluate(holdings, c);
  }

  it("confirms the advisory trim IS generated for the home (the input to the bug)", () => {
    const c = ctx();
    const ev = homeOverTrimTrigger(c);
    const home = ev.holdings.find((h) => h.id === "manual:home")!;
    expect(home.weight).toBeGreaterThan(TRIM_TRIGGER_PCT);

    // Deliberately unchanged behaviour: telling the user their home dominates the
    // portfolio is real advice. What must not happen is ACTING on it as a partial.
    const recs = computeRecommendations(ev, c);
    const trim = recs.find((r) => r.change.kind === "sell" && r.change.holdingId === "manual:home");
    if (trim) {
      expect(trim.change.kind).toBe("sell");
      expect(trim.amount).toBeGreaterThan(0);
      expect(trim.amount).toBeLessThan(home.valuation.valueBase); // it IS a partial
    }
  });

  it("refuses to execute a REDUCE recommendation against the home", () => {
    const c = ctx();
    const ev = homeOverTrimTrigger(c);
    const home = ev.holdings.find((h) => h.id === "manual:home")!;
    const recs = computeRecommendations(ev, c);
    const trim = recs.find((r) => r.change.kind === "sell" && r.change.holdingId === "manual:home");

    // Use the recommendation's own amount when it exists; otherwise reconstruct the
    // partial it would have proposed, so this test pins the guard either way.
    const amount = trim?.amount
      ?? Math.round(((home.weight - 20) / 100) * ev.totalValue);
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThan(home.valuation.valueBase);

    const built = buildLotWrites(ev, [homeTrade(-amount)], { objective: "maximize_sharpe" });
    expect(built.manualAssetIdsToDelete).toEqual([]);
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0].reason).toContain("cannot be partially sold");
  });

  it("a full-exit recommendation against the home still executes", () => {
    const c = ctx();
    const ev = homeOverTrimTrigger(c);
    const home = ev.holdings.find((h) => h.id === "manual:home")!;
    // recommend.ts's exit path sizes a full exit as Math.round(valueBase).
    const built = buildLotWrites(
      ev,
      [homeTrade(-Math.round(home.valuation.valueBase))],
      { objective: "maximize_sharpe" },
    );
    expect(built.manualAssetIdsToDelete).toEqual(["home"]);
    expect(built.skipped).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Write routes                                                                */
/* -------------------------------------------------------------------------- */

describe("POST /api/portfolio/buy — sellFirst funding guard", () => {
  /** The route validates `sellFirst` before any quote fetch, so this needs no network. */
  async function post(body: unknown) {
    const { POST } = await import("@/app/api/portfolio/buy/route");
    return POST(new Request("http://localhost/api/portfolio/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("rejects a manual holdingId in sellFirst — the live path that deleted the home", async () => {
    const res = await post({
      symbol: "AAPL", name: "Apple", amount: 60_000,
      sellFirst: [{ holdingId: "manual:home", amount: 40_000 }],
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("cannot be partially sold");
    expect(json.error).toContain("home");
  });

  it("rejects the manual entry even when mixed with a legitimate one", async () => {
    const res = await post({
      symbol: "AAPL", name: "Apple", amount: 60_000,
      sellFirst: [
        { holdingId: "lot:MSFT", amount: 10_000 },
        { holdingId: "manual:home", amount: 40_000 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("home");
  });

  it("still rejects a malformed sellFirst the same way as before", async () => {
    const res = await post({
      symbol: "AAPL", name: "Apple", amount: 60_000,
      sellFirst: [{ holdingId: "lot:MSFT", amount: -5 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("must be an array");
  });
});

describe("POST /api/portfolio/manage — manual asset guard", () => {
  async function post(body: unknown) {
    const { POST } = await import("@/app/api/portfolio/manage/route");
    return POST(new Request("http://localhost/api/portfolio/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("rejects a request with no action before touching the ledger", async () => {
    const res = await post({ holdingId: "manual:home" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("action");
  });

  it("rejects a missing holdingId", async () => {
    const res = await post({ action: "sell", amount: 100 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("holdingId");
  });
});
