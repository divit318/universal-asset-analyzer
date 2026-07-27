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
