/**
 * POST /api/portfolio — "Add holding" must ADD.
 *
 * What broke and is pinned here: adding a symbol that was already held went
 * through upsertHolding(), which REPLACES the symbol's whole ledger with one
 * opening lot — 10 AAPL across three recorded lots plus realized-P&L history
 * became 5 AAPL, one lot, no history, silently. An existing position now gets
 * an APPENDED buy lot; a brand-new symbol keeps the opening-lot upsert; cash
 * keeps its documented SET semantics (a balance correction, not a deposit —
 * deposits are the Allocate-new-cash flow).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// DB isolation BEFORE lib/db's lazy getDb() first runs (same pattern as
// tests/portfolio-transaction-db.test.ts).
const tmpDir = mkdtempSync(path.join(tmpdir(), "uaa-add-holding-route-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

// The route's fundFromCash path calls buildEvaluation() — whose market-context
// build fetches live quotes/FX. Fake ONLY that context (offline, USD, no
// quotes); the holdings come from the REAL isolated ledger through the REAL
// normalize + evaluate pipeline, so the cash draw is planned against exactly
// what the DB holds and the resulting sell lots land in that same DB.
vi.mock("@/lib/portfolio/report", async () => {
  const { listRawHoldings } = await import("@/lib/portfolio/store");
  const { normalizeHoldings } = await import("@/lib/portfolio/model/holding");
  const { evaluate } = await import("@/lib/portfolio/engines/simulate");
  const buildEvaluation = async () => {
    const ctx = {
      baseCurrency: "USD",
      fx: { USD: 1 },
      quotes: new Map(),
      history: new Map(),
      fundamentals: new Map(),
      benchmarkReturns: [],
      asOf: new Date().toISOString(),
    } as unknown as import("@/lib/portfolio/model/types").MarketContext;
    const { holdings } = normalizeHoldings(listRawHoldings(), ctx);
    return { ctx, evaluation: evaluate(holdings, ctx) };
  };
  return { buildEvaluation } as unknown as typeof import("@/lib/portfolio/report");
});

import { POST } from "@/app/api/portfolio/route";
import { listUniversalLots } from "@/lib/db";
import { listLedgerPositionSummaries } from "@/lib/portfolio/store";

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

const req = (body: unknown) =>
  new Request("http://localhost/api/portfolio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/portfolio (Add holding)", () => {
  it("creates a brand-new position as one opening lot", async () => {
    const res = await POST(req({ symbol: "AAPL", name: "Apple Inc.", quantity: 10, avgCost: 150, assetClass: "equity" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.appended).toBe(false);

    const lots = listUniversalLots().filter((l) => l.symbol === "AAPL");
    expect(lots).toHaveLength(1);
    expect(lots[0].shares).toBe(10);
    expect(lots[0].price).toBe(150);
  });

  it("APPENDS to an existing position — quantity grows, history survives, avg cost blends", async () => {
    const res = await POST(req({ symbol: "AAPL", name: "Apple Inc.", quantity: 5, avgCost: 200, assetClass: "equity" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.appended).toBe(true);
    expect(json.priorQuantity).toBe(10);
    expect(json.newQuantity).toBe(15);

    // The regression: this used to be ONE lot of 5 @ 200 — the original 10 @ 150
    // and its history deleted. Both lots must survive.
    const lots = listUniversalLots().filter((l) => l.symbol === "AAPL");
    expect(lots).toHaveLength(2);

    const pos = listLedgerPositionSummaries().find((p) => p.symbol === "AAPL")!;
    expect(pos.quantity).toBeCloseTo(15, 9);
    // Weighted average: (10×150 + 5×200) / 15
    expect(pos.avgCost).toBeCloseTo((10 * 150 + 5 * 200) / 15, 6);
    expect(pos.lotCount).toBe(2);
  });

  it("cash keeps SET semantics: recording a balance replaces the previous entry, never stacks", async () => {
    const first = await POST(req({ assetClass: "cash", currency: "USD", amount: 500 }));
    expect(first.status).toBe(201);
    const second = await POST(req({ assetClass: "cash", currency: "USD", amount: 700 }));
    expect(second.status).toBe(201);

    const cash = listLedgerPositionSummaries().find((p) => p.symbol === "CASH-USD")!;
    // 700, not 1200 — this is a stated-balance correction, and the dialog says so.
    expect(cash.quantity).toBeCloseTo(700, 9);
  });

  it("fundFromCash pays for the entry out of tracked cash: $700 cash + $500 add → $200 cash", async () => {
    // The user-reported expectation, pinned at the route level: adding a
    // holding with funding enabled must debit cash by exactly the cost.
    const res = await POST(req({
      symbol: "MSFT", name: "Microsoft", quantity: 2, avgCost: 250, assetClass: "equity", fundFromCash: true,
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.fundedFromCash).toBe(true);
    expect(json.cashDrawn).toBeCloseTo(500, 6);

    const cash = listLedgerPositionSummaries().find((p) => p.symbol === "CASH-USD")!;
    expect(cash.quantity).toBeCloseTo(200, 6);
    const msft = listLedgerPositionSummaries().find((p) => p.symbol === "MSFT")!;
    expect(msft.quantity).toBeCloseTo(2, 9);
  });

  it("fundFromCash with insufficient cash records new capital — cash untouched, and the response says so", async () => {
    // $200 left; a $10,000 entry cannot be funded. Full-fund or nothing:
    // no partial draw, no negative cash, honest response.
    const res = await POST(req({
      symbol: "IEF", name: "iShares 7-10Y Treasury", quantity: 100, avgCost: 100, assetClass: "bond", fundFromCash: true,
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.fundedFromCash).toBe(false);
    expect(json.cashDrawn).toBe(0);
    expect(json.cashAvailable).toBeCloseTo(200, 6);

    const cash = listLedgerPositionSummaries().find((p) => p.symbol === "CASH-USD")!;
    expect(cash.quantity).toBeCloseTo(200, 6);
    expect(listLedgerPositionSummaries().some((p) => p.symbol === "IEF")).toBe(true);
  });

  it("funded cross-currency entries are refused rather than drawing the wrong amount", async () => {
    const res = await POST(req({
      symbol: "SAP", name: "SAP SE", quantity: 1, avgCost: 200, currency: "EUR", assetClass: "equity", fundFromCash: true,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("EUR");
    // Nothing written on refusal.
    expect(listLedgerPositionSummaries().some((p) => p.symbol === "SAP")).toBe(false);
  });
});
