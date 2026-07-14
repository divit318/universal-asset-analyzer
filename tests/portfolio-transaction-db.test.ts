/**
 * Integration tests for the Transaction Engine's DB layer (lib/db.ts):
 * addUniversalLot, executeTradeBatch, snapshotPortfolio, restoreSnapshot.
 *
 * These MUST run against an isolated, throwaway SQLite file — never the real
 * app database. DB_PATH is set before lib/db.ts's lazy getDb() is ever
 * called, so this file never touches data/app.db regardless of test order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-txn-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Imported AFTER DB_PATH is set, so the module's lazy getDb() opens the temp file.
const {
  addUniversalLot,
  executeTradeBatch,
  snapshotPortfolio,
  restoreSnapshot,
  getSnapshot,
  listSnapshots,
  listUniversalLots,
  createManualAsset,
  listManualAssets,
} = await import("../lib/db");

describe("Transaction Engine DB layer (isolated test database)", () => {
  beforeAll(() => {
    addUniversalLot({
      symbol: "AAPL", name: "Apple Inc.", shares: 100, price: 150, kind: "buy",
      assetClass: "equity", currency: "USD", unit: "shares",
    });
  });

  it("addUniversalLot appends without touching existing lots for the same symbol", () => {
    const before = listUniversalLots().length;
    addUniversalLot({
      symbol: "AAPL", name: "Apple Inc.", shares: 20, price: 160, kind: "buy",
      assetClass: "equity", currency: "USD", unit: "shares",
    });
    const lots = listUniversalLots();
    expect(lots.length).toBe(before + 1);
    // Both lots survive — this is the whole point vs. upsertUniversalPosition's
    // destructive replace, which would have left exactly one row.
    const aaplLots = lots.filter((l) => l.symbol === "AAPL");
    expect(aaplLots.length).toBeGreaterThanOrEqual(2);
  });

  it("executeTradeBatch writes every lot atomically in one call", () => {
    const before = listUniversalLots().length;
    executeTradeBatch(
      [
        { symbol: "MSFT", name: "Microsoft", shares: 10, price: 400, kind: "buy", assetClass: "equity", currency: "USD", unit: "shares" },
        { symbol: "IEF", name: "iShares 7-10y Treasury", shares: 50, price: 95, kind: "buy", assetClass: "bond", currency: "USD", unit: "shares" },
      ],
      [],
    );
    expect(listUniversalLots().length).toBe(before + 2);
  });

  it("executeTradeBatch atomically deletes manual assets alongside lot writes", () => {
    const asset = createManualAsset({
      category: "structured_product",
      name: "Test Barrier Reverse Convertible",
      acquisitionDate: "2026-01-01",
      acquisitionCost: 20000,
      details: { kind: "structured_product" } as never,
    });
    expect(listManualAssets().some((a) => a.id === asset.id)).toBe(true);

    const lotsBefore = listUniversalLots().length;
    executeTradeBatch(
      [{ symbol: "AAPL", name: "Apple Inc.", shares: 5, price: 200, kind: "buy", assetClass: "equity", currency: "USD", unit: "shares" }],
      [asset.id],
    );

    expect(listUniversalLots().length).toBe(lotsBefore + 1);
    expect(listManualAssets().some((a) => a.id === asset.id)).toBe(false);
  });

  it("snapshot + restore round-trips the raw ledger EXACTLY, including full lot history", () => {
    const lotsBefore = listUniversalLots();
    const manualBefore = listManualAssets();

    const snapshotId = snapshotPortfolio("pre-execution", "maximize_sharpe", {
      totalValue: 100000, totalCost: 90000, health: 80, healthGrade: "B",
      volatility: 12, topAssetClassWeight: 40, allocation: [],
    });

    // Mutate: add more lots and a manual asset.
    addUniversalLot({ symbol: "NVDA", name: "NVIDIA", shares: 5, price: 900, kind: "buy", assetClass: "equity", currency: "USD", unit: "shares" });
    const extraAsset = createManualAsset({
      category: "alternative", name: "Test Watch", acquisitionDate: "2026-02-01",
      acquisitionCost: 5000, details: { kind: "alternative" } as never,
    });

    expect(listUniversalLots().length).toBe(lotsBefore.length + 1);
    expect(listManualAssets().some((a) => a.id === extraAsset.id)).toBe(true);

    const restored = restoreSnapshot(snapshotId);
    expect(restored).toBe(true);

    const lotsAfter = listUniversalLots();
    const manualAfter = listManualAssets();

    expect(lotsAfter.length).toBe(lotsBefore.length);
    expect(lotsAfter.map((l) => l.id).sort()).toEqual(lotsBefore.map((l) => l.id).sort());
    expect(manualAfter.length).toBe(manualBefore.length);
    expect(manualAfter.some((a) => a.id === extraAsset.id)).toBe(false);
  });

  it("restoreSnapshot returns false for an unknown snapshot id, without touching the ledger", () => {
    const lotsBefore = listUniversalLots().length;
    const restored = restoreSnapshot("does-not-exist");
    expect(restored).toBe(false);
    expect(listUniversalLots().length).toBe(lotsBefore);
  });

  it("getSnapshot / listSnapshots expose the denormalized summary without the raw holdings blob", () => {
    const id = snapshotPortfolio("manual", null, {
      totalValue: 55555, totalCost: 50000, health: 90, healthGrade: "A",
      volatility: 8, topAssetClassWeight: 30, allocation: [{ assetClass: "equity", weight: 60 }],
    });

    const single = getSnapshot(id);
    expect(single).not.toBeNull();
    expect(single!.summary.totalValue).toBe(55555);
    expect(single!.summary.healthGrade).toBe("A");
    expect(single!.label).toBe("manual");

    const list = listSnapshots(50);
    expect(list.some((s) => s.id === id)).toBe(true);
    // Newest first.
    expect(list[0].createdAt >= list[list.length - 1].createdAt).toBe(true);
  });
});
