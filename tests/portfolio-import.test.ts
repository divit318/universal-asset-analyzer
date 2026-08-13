import { describe, it, expect } from "vitest";
import { balancingBuyPrice, reconcile, type ExistingPosition } from "@/lib/portfolio/import/reconcile";
import { mergeDuplicates, toFiniteNumber } from "@/lib/portfolio/import/extract";
import { namesMatch, validateExtraction, validatePosition, type QuoteCheck } from "@/lib/portfolio/import/validate";
import { aggregateLots } from "@/lib/portfolio-lots";
import type { ExtractedPosition, ExtractionResult } from "@/lib/portfolio/import/types";
import type { PortfolioLot } from "@/lib/types";

function pos(o: Partial<ExtractedPosition>): ExtractedPosition {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    quantity: 10,
    avgCost: 150,
    costBasis: null,
    currentPrice: 180,
    marketValue: 1800,
    pnl: null,
    pnlPct: null,
    currency: "USD",
    assetClassGuess: "equity",
    confidence: "high",
    note: null,
    sourceImages: [0],
    ...o,
  };
}

function extraction(o: Partial<ExtractionResult>): ExtractionResult {
  return {
    positions: [],
    cash: null,
    totalValue: null,
    currency: "USD",
    brokerage: null,
    appearsComplete: null,
    completenessReason: null,
    warnings: [],
    model: "test-model",
    ...o,
  };
}

function existing(o: Partial<ExistingPosition> & { symbol: string }): ExistingPosition {
  return { name: o.symbol, quantity: 10, avgCost: 100, lotCount: 1, assetClass: "equity", currency: "USD", ...o };
}

const noQuotes = new Map<string, QuoteCheck>();

function preview(ext: ExtractionResult, held: ExistingPosition[], assumeComplete = false) {
  return reconcile(ext, validateExtraction(ext, noQuotes), held, { assumeComplete });
}

/* ────────────────────────── extraction sanitizers ────────────────────────── */

describe("toFiniteNumber", () => {
  it("passes numbers through and rejects junk", () => {
    expect(toFiniteNumber(12.5)).toBe(12.5);
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
  });

  it("parses display-formatted strings", () => {
    expect(toFiniteNumber("1,234.56")).toBe(1234.56);
    expect(toFiniteNumber("$2,180.00")).toBe(2180);
    expect(toFiniteNumber("(123.45)")).toBe(-123.45);
    expect(toFiniteNumber("-4.2%")).toBe(-4.2);
  });
});

describe("mergeDuplicates", () => {
  it("merges agreeing reads of the same symbol across screenshots", () => {
    const merged = mergeDuplicates([
      pos({ symbol: "NVDA", quantity: 12, avgCost: 142.3, sourceImages: [0] }),
      pos({ symbol: "NVDA", quantity: 12, avgCost: 142.3, marketValue: 2180, sourceImages: [1] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceImages).toEqual([0, 1]);
  });

  it("keeps a disagreement visible instead of picking a side", () => {
    const merged = mergeDuplicates([
      pos({ symbol: "NVDA", quantity: 12 }),
      pos({ symbol: "NVDA", quantity: 18 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBeNull();
    expect(merged[0].confidence).toBe("low");
    expect(merged[0].note).toMatch(/[Cc]onflict/);
  });

  it("never merges name-only rows", () => {
    const merged = mergeDuplicates([
      pos({ symbol: null, name: "Some Fund A" }),
      pos({ symbol: null, name: "Some Fund B" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

/* ────────────────────────────── validation ───────────────────────────────── */

describe("validatePosition", () => {
  it("accepts a self-consistent position", () => {
    const issues = validatePosition(
      pos({ quantity: 10, currentPrice: 180, marketValue: 1800, avgCost: 150, costBasis: 1500 }),
      { symbol: "AAPL", name: "Apple Inc.", price: 181, currency: "USD" },
    );
    expect(issues).toHaveLength(0);
  });

  it("errors when quantity × price is far from the displayed value (decimal misread)", () => {
    const issues = validatePosition(pos({ quantity: 100, currentPrice: 180, marketValue: 1800 }), undefined);
    expect(issues.some((i) => i.code === "value-mismatch" && i.severity === "error")).toBe(true);
  });

  it("warns on a small value drift (display rounding vs misread)", () => {
    const issues = validatePosition(pos({ quantity: 10, currentPrice: 180, marketValue: 1730 }), undefined);
    const v = issues.find((i) => i.code === "value-mismatch");
    expect(v?.severity).toBe("warning");
  });

  it("flags a percentage read as a quantity", () => {
    const issues = validatePosition(
      pos({ quantity: 4.2, pnlPct: 4.2, currentPrice: 180, marketValue: 2180 }),
      undefined,
    );
    expect(issues.some((i) => i.code === "percent-as-quantity")).toBe(true);
  });

  it("flags swapped cost/value columns via the P&L sign", () => {
    const issues = validatePosition(
      pos({ avgCost: 200, currentPrice: 180, pnl: 350, marketValue: 1800, quantity: 10 }),
      undefined,
    );
    expect(issues.some((i) => i.code === "pnl-sign-mismatch")).toBe(true);
  });

  it("warns when the ticker has no live quote", () => {
    const issues = validatePosition(pos({ symbol: "ZZZZQ" }), undefined);
    expect(issues.some((i) => i.code === "unverified-symbol")).toBe(true);
  });

  it("warns when the name doesn't match the quoted security", () => {
    const issues = validatePosition(pos({ symbol: "AAPL", name: "Advance Auto Parts" }), {
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 180,
      currency: "USD",
    });
    expect(issues.some((i) => i.code === "name-mismatch")).toBe(true);
  });

  it("errors on a missing quantity", () => {
    const issues = validatePosition(pos({ quantity: null }), undefined);
    expect(issues.some((i) => i.code === "no-quantity" && i.severity === "error")).toBe(true);
  });
});

describe("namesMatch", () => {
  it("matches abbreviations and suffixes", () => {
    expect(namesMatch("NVIDIA Corp", "NVIDIA Corporation")).toBe(true);
    expect(namesMatch("Apple", "Apple Inc.")).toBe(true);
    expect(namesMatch("Advance Auto Parts", "Apple Inc.")).toBe(false);
  });
});

describe("validateExtraction — portfolio totals", () => {
  it("warns when positions don't sum to the stated total", () => {
    const out = validateExtraction(
      extraction({ positions: [pos({ marketValue: 1000 })], totalValue: 5000 }),
      noQuotes,
    );
    expect(out.portfolioIssues.some((i) => i.code === "total-mismatch")).toBe(true);
  });

  it("stays quiet when they reconcile (cash included)", () => {
    const out = validateExtraction(
      extraction({
        positions: [pos({ quantity: 10, currentPrice: 180, marketValue: 1800, avgCost: null, costBasis: null })],
        cash: { amount: 200, currency: "USD" },
        totalValue: 2000,
      }),
      noQuotes,
    );
    expect(out.portfolioIssues).toHaveLength(0);
  });
});

/* ───────────────────────────── reconciliation ────────────────────────────── */

describe("balancingBuyPrice", () => {
  it("solves the price that lands the aggregate on the screenshot", () => {
    // 10 @ 170 → screenshot says 12 @ 177.50: buy 2 @ p.
    const p = balancingBuyPrice(10, 170, 12, 177.5)!;
    expect(p).toBeCloseTo(215, 10);
    // Feeding it back through the real average-cost aggregation reproduces
    // the screenshot exactly — the DCA history is preserved, not rewritten.
    const lots: PortfolioLot[] = [
      { id: 1, symbol: "AAPL", name: "Apple", shares: 5, price: 180, kind: "buy", fees: 0, tradeDate: "2026-01-01", createdAt: "" },
      { id: 2, symbol: "AAPL", name: "Apple", shares: 5, price: 160, kind: "buy", fees: 0, tradeDate: "2026-02-01", createdAt: "" },
      { id: 3, symbol: "AAPL", name: "Apple", shares: 2, price: p, kind: "buy", fees: 0, tradeDate: "2026-08-10", createdAt: "" },
    ];
    const agg = aggregateLots(lots)!;
    expect(agg.shares).toBe(12);
    expect(agg.avgCost).toBeCloseTo(177.5, 10);
    expect(agg.lotCount).toBe(3); // history intact
  });

  it("returns null when no buy can produce the screenshot's average", () => {
    // Avg cost FELL from 170 to 100 while adding only 2 shares — impossible via buys.
    expect(balancingBuyPrice(10, 170, 12, 100)).toBeNull();
    expect(balancingBuyPrice(10, 170, 8, 150)).toBeNull(); // not an increase
  });
});

describe("reconcile", () => {
  it("classifies a brand-new holding as an add", () => {
    const p = preview(extraction({ positions: [pos({ symbol: "NVDA", quantity: 12, avgCost: 142.3 })] }), []);
    const row = p.rows.find((r) => r.symbol === "NVDA")!;
    expect(row.kind).toBe("new");
    expect(row.action).toBe("add");
    expect(row.defaultSelected).toBe(true);
    expect(p.changeCount).toBe(1);
  });

  it("uses the current price for a new holding without visible cost — flagged, not silent", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "NVDA", quantity: 12, avgCost: null, costBasis: null, currentPrice: 180, marketValue: 2160 })] }),
      [],
    );
    const row = p.rows.find((r) => r.symbol === "NVDA")!;
    expect(row.action).toBe("add");
    expect(row.extracted?.avgCost).toBe(180);
    expect(row.issues.some((i) => i.code === "cost-assumed")).toBe(true);
  });

  it("refuses a new holding with no honest number to record", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "NVDA", quantity: 12, avgCost: null, costBasis: null, currentPrice: null, marketValue: null })] }),
      [],
    );
    const row = p.rows.find((r) => r.symbol === "NVDA")!;
    expect(row.kind).toBe("conflict");
    expect(row.action).toBe("none");
    expect(row.defaultSelected).toBe(false);
  });

  it("expresses an increase as ONE balancing buy that preserves history", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 12, avgCost: 177.5, currentPrice: 180, marketValue: 2160 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 170, lotCount: 4 })],
    );
    const row = p.rows.find((r) => r.symbol === "AAPL")!;
    expect(row.kind).toBe("increase");
    expect(row.action).toBe("append-buy");
    expect(row.destructive).toBe(false);
    expect(row.delta?.quantity).toBeCloseTo(2, 9);
    expect(row.delta?.price).toBeCloseTo(215, 6);
  });

  it("expresses a decrease as a sell at the screenshot's price", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 6, avgCost: 170, currentPrice: 180, marketValue: 1080 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 170, lotCount: 4 })],
    );
    const row = p.rows.find((r) => r.symbol === "AAPL")!;
    expect(row.kind).toBe("decrease");
    expect(row.action).toBe("append-sell");
    expect(row.delta).toEqual({ kind: "sell", quantity: 4, price: 180 });
  });

  it("marks an unchanged holding unchanged (display rounding tolerated)", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 10, avgCost: 170.0004, currentPrice: 180, marketValue: 1800 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 170, lotCount: 4 })],
    );
    const row = p.rows.find((r) => r.symbol === "AAPL")!;
    expect(row.kind).toBe("unchanged");
    expect(row.action).toBe("none");
    expect(p.changeCount).toBe(0);
  });

  it("turns a cost change with unchanged quantity into an explicit rebaseline, destructive over real history", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 10, avgCost: 184.2, currentPrice: 190, marketValue: 1900 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 181.4, lotCount: 3 })],
    );
    const row = p.rows.find((r) => r.symbol === "AAPL")!;
    expect(row.kind).toBe("cost-change");
    expect(row.action).toBe("rebaseline");
    expect(row.destructive).toBe(true);
    expect(row.defaultSelected).toBe(false); // destructive is never pre-checked
  });

  it("falls back to a flagged rebaseline when no buy can reconcile the average", () => {
    const p = preview(
      // Avg cost fell 170 → 100 while shares rose — irreconcilable by buying.
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 12, avgCost: 100, currentPrice: 100, marketValue: 1200 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 170, lotCount: 4 })],
    );
    const row = p.rows.find((r) => r.symbol === "AAPL")!;
    expect(row.kind).toBe("conflict");
    expect(row.action).toBe("rebaseline");
    expect(row.defaultSelected).toBe(false);
    expect(row.issues.some((i) => i.code === "irreconcilable-average")).toBe(true);
  });

  it("NEVER deletes holdings missing from a partial screenshot", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL" })] }),
      [existing({ symbol: "AAPL" }), existing({ symbol: "MSFT", quantity: 5, avgCost: 300 })],
      false,
    );
    const msft = p.rows.find((r) => r.symbol === "MSFT")!;
    expect(msft.kind).toBe("missing");
    expect(msft.action).toBe("none");
  });

  it("offers (but never pre-checks) deletion when the user asserts completeness", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 10, avgCost: 100 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 100 }), existing({ symbol: "MSFT", quantity: 5, avgCost: 300, lotCount: 2 })],
      true,
    );
    const msft = p.rows.find((r) => r.symbol === "MSFT")!;
    expect(msft.action).toBe("remove");
    expect(msft.destructive).toBe(true);
    expect(msft.defaultSelected).toBe(false);
  });

  it("never proposes deleting cash off a holdings screenshot, even when 'complete'", () => {
    const p = preview(
      extraction({ positions: [pos({ symbol: "AAPL", quantity: 10, avgCost: 100 })] }),
      [existing({ symbol: "AAPL", quantity: 10, avgCost: 100 }), existing({ symbol: "CASH-USD", quantity: 5000, avgCost: 1, assetClass: "cash" })],
      true,
    );
    const cash = p.rows.find((r) => r.symbol === "CASH-USD")!;
    expect(cash.action).toBe("none");
  });

  it("sets cash when a visible balance differs from the recorded one", () => {
    const p = preview(
      extraction({ positions: [], cash: { amount: 2500, currency: "USD" } }),
      [existing({ symbol: "CASH-USD", quantity: 1000, avgCost: 1, assetClass: "cash" })],
    );
    const cash = p.rows.find((r) => r.symbol === "CASH-USD")!;
    expect(cash.action).toBe("set-cash");
    expect(cash.extracted?.quantity).toBe(2500);
  });

  it("keeps rows with validation errors out of the default selection", () => {
    const p = preview(
      // 100 × 180 = 18000 vs displayed 1800 — hard value mismatch.
      extraction({ positions: [pos({ symbol: "NVDA", quantity: 100, currentPrice: 180, marketValue: 1800 })] }),
      [],
    );
    const row = p.rows.find((r) => r.symbol === "NVDA")!;
    expect(row.kind).toBe("conflict");
    expect(row.defaultSelected).toBe(false);
    expect(p.needsReviewCount).toBe(1);
  });

  it("reports totals reconciliation", () => {
    const p = preview(
      extraction({
        positions: [pos({ symbol: "AAPL", quantity: 10, currentPrice: 180, marketValue: 1800 })],
        cash: { amount: 200, currency: "USD" },
        totalValue: 2000,
      }),
      [],
    );
    expect(p.totals.extractedSum).toBe(2000);
    expect(p.totals.withinTolerance).toBe(true);
  });
});
