/**
 * Integration tests for the Screenshot Import's DB write primitive
 * (lib/db.ts:applyPortfolioImport): atomicity, history preservation on
 * balancing lots, rebaseline semantics, removal, and provenance meta.
 *
 * Runs against an isolated, throwaway SQLite file — never data/app.db.
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-import-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Imported AFTER DB_PATH is set, so the module's lazy getDb() opens the temp file.
const { addUniversalLot, applyPortfolioImport, listPortfolio, listUniversalLots } = await import("../lib/db");

describe("applyPortfolioImport (isolated test database)", () => {
  it("adds a new holding as one provenance-carrying opening lot", () => {
    applyPortfolioImport([
      {
        type: "lot", symbol: "NVDA", name: "NVIDIA Corp", shares: 12, price: 142.3, kind: "buy",
        assetClass: "equity", currency: "USD", unit: "shares",
        meta: { source: "screenshot-import", importedAt: "2026-08-10T00:00:00Z", confidence: "high", aggregateImport: true },
      },
    ]);
    const nvda = listPortfolio().find((p) => p.symbol === "NVDA")!;
    expect(nvda.shares).toBe(12);
    expect(nvda.avgCost).toBeCloseTo(142.3, 9);
    const lot = listUniversalLots().find((l) => l.symbol === "NVDA")!;
    expect(JSON.parse(lot.meta!)).toMatchObject({ source: "screenshot-import", aggregateImport: true });
  });

  it("a balancing buy preserves the existing DCA lots and lands the aggregate on the screenshot", () => {
    // Real history: 5 @ 180 and 5 @ 160 (avg 170).
    addUniversalLot({ symbol: "AAPL", name: "Apple Inc.", shares: 5, price: 180, kind: "buy", assetClass: "equity", tradeDate: "2026-01-05" });
    addUniversalLot({ symbol: "AAPL", name: "Apple Inc.", shares: 5, price: 160, kind: "buy", assetClass: "equity", tradeDate: "2026-03-11" });

    // Screenshot says 12 @ 177.50 → balancing buy of 2 @ 215 (solved upstream).
    applyPortfolioImport([
      {
        type: "lot", symbol: "AAPL", name: "Apple Inc.", shares: 2, price: 215, kind: "buy",
        assetClass: "equity", currency: "USD", unit: "shares",
        meta: { source: "screenshot-import", importedAt: "2026-08-10T00:00:00Z", confidence: "high", synthetic: true },
      },
    ]);

    const aapl = listPortfolio().find((p) => p.symbol === "AAPL")!;
    expect(aapl.shares).toBe(12);
    expect(aapl.avgCost).toBeCloseTo(177.5, 9);
    // The two real purchases are untouched — reconciliation appended, never rewrote.
    const lots = listUniversalLots().filter((l) => l.symbol === "AAPL");
    expect(lots.length).toBe(3);
    expect(lots.filter((l) => l.meta === null).length).toBe(2);
  });

  it("rebaseline replaces the symbol's ledger with a single opening lot", () => {
    addUniversalLot({ symbol: "MSFT", name: "Microsoft", shares: 3, price: 300, kind: "buy", assetClass: "equity" });
    addUniversalLot({ symbol: "MSFT", name: "Microsoft", shares: 2, price: 420, kind: "buy", assetClass: "equity" });

    applyPortfolioImport([
      {
        type: "rebaseline", symbol: "MSFT", name: "Microsoft", quantity: 5, avgCost: 350,
        assetClass: "equity", currency: "USD", unit: "shares",
        meta: { source: "screenshot-import", importedAt: "2026-08-10T00:00:00Z", confidence: "medium", aggregateImport: true },
      },
    ]);

    const lots = listUniversalLots().filter((l) => l.symbol === "MSFT");
    expect(lots.length).toBe(1);
    const msft = listPortfolio().find((p) => p.symbol === "MSFT")!;
    expect(msft.shares).toBe(5);
    expect(msft.avgCost).toBeCloseTo(350, 9);
  });

  it("remove deletes the position", () => {
    addUniversalLot({ symbol: "SOLD", name: "Sold Corp", shares: 1, price: 10, kind: "buy", assetClass: "equity" });
    applyPortfolioImport([{ type: "remove", symbol: "SOLD" }]);
    expect(listPortfolio().some((p) => p.symbol === "SOLD")).toBe(false);
  });

  it("mixed batches apply together", () => {
    const beforeCount = listUniversalLots().length;
    applyPortfolioImport([
      { type: "lot", symbol: "QQQM", name: "Invesco NASDAQ 100", shares: 4, price: 271.4, kind: "buy", assetClass: "etf", unit: "shares", meta: { source: "screenshot-import" } },
      { type: "lot", symbol: "AAPL", name: "Apple Inc.", shares: 2, price: 190, kind: "sell", assetClass: "equity", unit: "shares", meta: { source: "screenshot-import", synthetic: true } },
      { type: "rebaseline", symbol: "CASH-USD", name: "USD Cash", quantity: 1410, avgCost: 1, assetClass: "cash", currency: "USD", unit: "currency", meta: { source: "screenshot-import" } },
    ]);
    expect(listUniversalLots().length).toBe(beforeCount + 3);
    expect(listPortfolio().find((p) => p.symbol === "AAPL")!.shares).toBe(10);
    expect(listPortfolio().find((p) => p.symbol === "CASH-USD")!.shares).toBe(1410);
  });

  it("no-ops on an empty batch", () => {
    const before = listUniversalLots().length;
    applyPortfolioImport([]);
    expect(listUniversalLots().length).toBe(before);
  });
});
