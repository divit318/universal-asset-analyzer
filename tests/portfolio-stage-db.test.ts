/**
 * Idea-lifecycle DB layer (lib/db.ts) against an isolated throwaway database:
 * the watchlist stage migration, the setIdeaStage CRUD, and the buy/sell
 * auto-transitions wired into the ledger write primitives (§4.5).
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called, so this never
 * touches data/app.db.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-stage-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  addToWatchlist,
  listWatchlist,
  getIdeaStage,
  setIdeaStage,
  addUniversalLot,
  reconcileOwnedStages,
  removePosition,
  removeLot,
  listLots,
  upsertUniversalPosition,
  getIdeaOrigin,
} = await import("../lib/db");

describe("watchlist stage migration", () => {
  it("gives every new watchlist row a default stage of 'surfaced'", () => {
    addToWatchlist("AAPL", "Apple Inc.");
    const row = listWatchlist().find((w) => w.symbol === "AAPL");
    expect(row?.stage).toBe("surfaced");
    expect(row?.stageChangedAt).toBeNull();
  });
});

describe("setIdeaStage", () => {
  it("changes an existing row and reports the previous stage", () => {
    addToWatchlist("MSFT", "Microsoft");
    const res = setIdeaStage("MSFT", "researching");
    expect(res).toEqual({ changed: true, from: "surfaced" });
    expect(getIdeaStage("MSFT")).toBe("researching");
    const row = listWatchlist().find((w) => w.symbol === "MSFT");
    expect(typeof row?.stageChangedAt).toBe("number");
  });

  it("is a no-op when the stage is unchanged", () => {
    setIdeaStage("MSFT", "thesis");
    const res = setIdeaStage("MSFT", "thesis");
    expect(res).toEqual({ changed: false, from: "thesis" });
  });

  it("does not create a row for an untracked symbol without createIfMissing", () => {
    const res = setIdeaStage("ZZZZ", "thesis");
    expect(res).toEqual({ changed: false, from: null });
    expect(getIdeaStage("ZZZZ")).toBeNull();
  });

  it("adds an untracked symbol at the given stage with createIfMissing", () => {
    const res = setIdeaStage("LIN", "thesis", { createIfMissing: true, name: "Linde plc" });
    expect(res).toEqual({ changed: true, from: null });
    const row = listWatchlist().find((w) => w.symbol === "LIN");
    expect(row?.stage).toBe("thesis");
    expect(row?.name).toBe("Linde plc");
  });
});

/**
 * Provenance (lib/idea-source.ts). The property that matters is that an
 * unrecorded origin stays unrecorded and a recorded one is never overwritten:
 * both directions of that are how "why am I seeing this?" stays truthful.
 */
describe("idea provenance", () => {
  it("stores the surface that produced the idea", () => {
    addToWatchlist("NVO", "Novo Nordisk", undefined, { source: "screener", detail: "Equity screen · rank #2" });
    const row = listWatchlist().find((w) => w.symbol === "NVO");
    expect(row?.source).toBe("screener");
    expect(row?.sourceDetail).toBe("Equity screen · rank #2");
  });

  it("keeps the FIRST origin when a symbol is re-added from somewhere else", () => {
    addToWatchlist("NVO", "Novo Nordisk", undefined, { source: "research", detail: "Researched as Equity" });
    const row = listWatchlist().find((w) => w.symbol === "NVO");
    expect(row?.source).toBe("screener");
    expect(row?.sourceDetail).toBe("Equity screen · rank #2");
  });

  it("records no origin at all when the caller has none — never a default", () => {
    addToWatchlist("SAP", "SAP SE");
    const row = listWatchlist().find((w) => w.symbol === "SAP");
    expect(row?.source).toBeNull();
    expect(row?.sourceDetail).toBeNull();
  });

  it("backfills an origin onto a row that never had one", () => {
    addToWatchlist("SAP", "SAP SE", undefined, { source: "compare", detail: "Compared against MSFT" });
    expect(listWatchlist().find((w) => w.symbol === "SAP")?.source).toBe("compare");
  });

  it("reports every legacy row as unrecorded rather than guessing", () => {
    // A row written directly, as an older build would have.
    setIdeaStage("LEGACY", "surfaced", { createIfMissing: true, name: "Legacy Idea" });
    expect(getIdeaOrigin("LEGACY")).toEqual({ source: null, detail: null });
    expect(getIdeaOrigin("NEVER-TRACKED")).toBeNull();
  });
});

describe("auto-transitions on ledger writes", () => {
  it("a buy of an untracked symbol adds it to the pipeline at 'owned'", () => {
    expect(getIdeaStage("NVDA")).toBeNull();
    addUniversalLot({ symbol: "NVDA", name: "NVIDIA", shares: 10, price: 100, kind: "buy", assetClass: "equity" });
    expect(getIdeaStage("NVDA")).toBe("owned");
  });

  it("a buy of a tracked symbol moves it to 'owned'", () => {
    setIdeaStage("AAPL", "researching");
    addUniversalLot({ symbol: "AAPL", name: "Apple Inc.", shares: 5, price: 200, kind: "buy", assetClass: "equity" });
    expect(getIdeaStage("AAPL")).toBe("owned");
  });

  it("a partial sell leaves the stage untouched", () => {
    // NVDA holds 10 shares (from above); sell 4 → still held.
    addUniversalLot({ symbol: "NVDA", name: "NVIDIA", shares: 4, price: 110, kind: "sell", assetClass: "equity" });
    expect(getIdeaStage("NVDA")).toBe("owned");
  });

  it("a sell that closes the position moves it to 'exited'", () => {
    // NVDA now holds 6 shares; sell the rest → fully exited.
    addUniversalLot({ symbol: "NVDA", name: "NVIDIA", shares: 6, price: 120, kind: "sell", assetClass: "equity" });
    expect(getIdeaStage("NVDA")).toBe("exited");
  });

  it("never transitions a cash lot", () => {
    addUniversalLot({ symbol: "CASH-USD", name: "USD Cash", shares: 1000, price: 1, kind: "buy", assetClass: "cash" });
    expect(getIdeaStage("CASH-USD")).toBeNull();
  });
});

/**
 * The drift that put BND and VTI in the Pipeline's Owned column: their buys wrote
 * `owned`, their lots were then deleted, and no removal path told the stage. Every
 * path that can take a holding out of the ledger is pinned here.
 */
describe("stages stay reconciled when holdings LEAVE the ledger", () => {
  it("marks a name exited when its whole position is removed", () => {
    addUniversalLot({ symbol: "BND", name: "Vanguard Total Bond Market", shares: 10, price: 72, kind: "buy", assetClass: "etf" });
    expect(getIdeaStage("BND")).toBe("owned");

    removePosition("BND");
    expect(getIdeaStage("BND")).toBe("exited");
  });

  it("marks a name exited when its last lot is deleted individually", () => {
    addUniversalLot({ symbol: "VTI", name: "Vanguard Total Stock Market", shares: 4, price: 300, kind: "buy", assetClass: "etf" });
    expect(getIdeaStage("VTI")).toBe("owned");

    for (const lot of listLots("VTI")) removeLot(lot.id);
    expect(getIdeaStage("VTI")).toBe("exited");
  });

  it("reconciles an edit that replaces a position with a zero-share one", () => {
    addUniversalLot({ symbol: "IEF", name: "iShares 7-10 Year Treasury", shares: 5, price: 95, kind: "buy", assetClass: "bond" });
    expect(getIdeaStage("IEF")).toBe("owned");

    upsertUniversalPosition({ symbol: "IEF", name: "iShares 7-10 Year Treasury", quantity: 0, avgCost: 95, assetClass: "bond" });
    expect(getIdeaStage("IEF")).toBe("exited");
  });

  it("is idempotent, and repairs a stage set by hand against the ledger", () => {
    expect(reconcileOwnedStages()).toBe(0);

    // A row claiming `owned` with nothing behind it — exactly the BND/VTI state.
    setIdeaStage("LIN", "owned");
    expect(reconcileOwnedStages()).toBe(1);
    expect(getIdeaStage("LIN")).toBe("exited");

    // And the other direction: a held name whose row was never moved.
    setIdeaStage("AAPL", "surfaced");
    expect(reconcileOwnedStages()).toBe(1);
    expect(getIdeaStage("AAPL")).toBe("owned");

    expect(reconcileOwnedStages()).toBe(0);
  });

  it("records the ledger as the origin of an idea that arrived by being bought", () => {
    addUniversalLot({ symbol: "KO", name: "Coca-Cola", shares: 10, price: 60, kind: "buy", assetClass: "equity" });
    const row = listWatchlist().find((w) => w.symbol === "KO");
    expect(row?.source).toBe("ledger");
    expect(row?.sourceDetail).toBe("equity position opened");
  });

  it("leaves a partially-sold position owned", () => {
    addUniversalLot({ symbol: "TSM", name: "TSMC", shares: 10, price: 200, kind: "buy", assetClass: "equity" });
    addUniversalLot({ symbol: "TSM", name: "TSMC", shares: 4, price: 220, kind: "sell", assetClass: "equity" });
    expect(getIdeaStage("TSM")).toBe("owned");
    expect(reconcileOwnedStages()).toBe(0);
  });
});
