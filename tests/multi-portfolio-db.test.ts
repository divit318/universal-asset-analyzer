/**
 * Multi-portfolio DB layer — the isolation contract. Every ledger row belongs
 * to a named portfolio; a function called without a portfolioId reads and
 * writes the seeded Main Portfolio (id 1) exactly as it did before the column
 * existed. Nothing here may leak between books: that is the entire point.
 *
 * DB_PATH is set before lib/db.ts's lazy getDb() is ever called.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-multiportfolio-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const {
  listPortfolios,
  createPortfolio,
  getPortfolioMeta,
  addUniversalLot,
  executeTradeBatch,
  listLots,
  listPortfolio,
  listUniversalLots,
  removePosition,
  snapshotPortfolio,
  restoreSnapshot,
} = await import("../lib/db");
const { listRawHoldings } = await import("../lib/portfolio/store");

describe("portfolios table", () => {
  it("seeds the Main Portfolio as id 1", () => {
    const all = listPortfolios();
    expect(all[0]).toMatchObject({ id: 1, name: "Main Portfolio" });
  });

  it("creates named portfolios with sequential ids", () => {
    const created = createPortfolio("Retirement 2045");
    expect(created.id).toBeGreaterThan(1);
    expect(getPortfolioMeta(created.id)?.name).toBe("Retirement 2045");
    expect(listPortfolios().length).toBeGreaterThanOrEqual(2);
  });
});

describe("ledger isolation", () => {
  const second = createPortfolio("Second Book");

  it("defaults every un-parameterized call to the Main Portfolio", () => {
    addUniversalLot({ symbol: "VOO", name: "Vanguard S&P 500", shares: 10, price: 500, kind: "buy", assetClass: "etf" });
    addUniversalLot({ symbol: "QQQ", name: "Invesco QQQ", shares: 5, price: 400, kind: "buy", assetClass: "etf" }, second.id);

    expect(listLots().map((l) => l.symbol)).toEqual(["VOO"]);
    expect(listLots(undefined, second.id).map((l) => l.symbol)).toEqual(["QQQ"]);
    expect(listPortfolio().map((p) => p.symbol)).toEqual(["VOO"]);
    expect(listPortfolio(second.id).map((p) => p.symbol)).toEqual(["QQQ"]);
    expect(listUniversalLots(second.id)).toHaveLength(1);
    expect(listRawHoldings(second.id).map((r) => r.symbol)).toEqual(["QQQ"]);
    expect(listRawHoldings().map((r) => r.symbol)).toEqual(["VOO"]);
  });

  it("nets overlapping tickers into ONE position when merging into a book", () => {
    // The promote-merge requirement: a second buy lot for a held symbol must
    // aggregate, never appear as a duplicate row.
    executeTradeBatch(
      [{ symbol: "QQQ", name: "Invesco QQQ", shares: 3, price: 420, kind: "buy", assetClass: "etf" }],
      [],
      second.id,
    );
    const positions = listPortfolio(second.id);
    expect(positions).toHaveLength(1);
    expect(positions[0].shares).toBe(8);
    // Average cost blends the lots: (5*400 + 3*420) / 8
    expect(positions[0].avgCost).toBeCloseTo((5 * 400 + 3 * 420) / 8, 6);
  });

  it("scopes removePosition to its book", () => {
    addUniversalLot({ symbol: "SHARED", name: "Shared Ticker", shares: 1, price: 10, kind: "buy", assetClass: "equity" });
    addUniversalLot({ symbol: "SHARED", name: "Shared Ticker", shares: 2, price: 10, kind: "buy", assetClass: "equity" }, second.id);
    removePosition("SHARED", second.id);
    expect(listLots(undefined, second.id).some((l) => l.symbol === "SHARED")).toBe(false);
    expect(listLots().some((l) => l.symbol === "SHARED")).toBe(true);
    removePosition("SHARED"); // clean Main back up
  });

  it("snapshots and restores ONE book without touching the other", () => {
    const summary = {
      totalValue: 0, totalCost: 0, alignment: 50,
      volatility: null, topAssetClassWeight: 100, allocation: [],
    };
    const snapId = snapshotPortfolio("pre-test", null, summary, second.id);

    // Mutate BOTH books after the snapshot.
    executeTradeBatch(
      [{ symbol: "GLD", name: "SPDR Gold", shares: 2, price: 300, kind: "buy", assetClass: "commodity" }],
      [],
      second.id,
    );
    addUniversalLot({ symbol: "TLT", name: "iShares 20Y Treasury", shares: 4, price: 90, kind: "buy", assetClass: "bond" });

    expect(restoreSnapshot(snapId)).toBe(true);

    // Second book rolled back to pre-snapshot state…
    expect(listLots(undefined, second.id).map((l) => l.symbol).sort()).toEqual(["QQQ", "QQQ"]);
    // …while Main kept its post-snapshot trade.
    expect(listLots().some((l) => l.symbol === "TLT")).toBe(true);
  });
});
