/**
 * Yahoo fundamentals mappers — the invariants the research page's headers
 * depend on:
 *   - the insider summary line is computed from EXACTLY the transactions the
 *    table renders (they can never disagree again);
 *   - SEC Form 4 compensation codes (awards/grants/exercises) are never
 *     counted as open-market sells;
 *   - the analyst count derives from the rating distribution it is shown next to.
 */

import { describe, expect, it } from "vitest";
import { classifyTx, mapInsider, mapAnalyst, mapSnapshot } from "@/lib/fundamentals";
import { describeFiling } from "@/lib/edgar";

/* ── mapSnapshot: equity vs fund yield fields ────────────────────────────── */

describe("mapSnapshot yields", () => {
  it("maps the equity dividendYield and the fund `yield` field independently", () => {
    // Yahoo populates summaryDetail.dividendYield for single equities ONLY;
    // funds carry summaryDetail.yield (mirrored in defaultKeyStatistics.yield).
    // Probed live 2026-08-14: BND {dividendYield: null, yield: 0.0403}.
    const equity = mapSnapshot("MO", { summaryDetail: { dividendYield: 0.0652 } });
    expect(equity.dividendYield).toBeCloseTo(0.0652, 6);
    expect(equity.fundYield).toBeNull();

    const bondFund = mapSnapshot("BND", { summaryDetail: { yield: 0.0403 } });
    expect(bondFund.dividendYield).toBeNull();
    expect(bondFund.fundYield).toBeCloseTo(0.0403, 6);
  });

  it("falls back to defaultKeyStatistics.yield when summaryDetail has none", () => {
    const snap = mapSnapshot("SGOV", { defaultKeyStatistics: { yield: 0.0379 } });
    expect(snap.fundYield).toBeCloseTo(0.0379, 6);
  });

  it("keeps a genuine zero fund yield as 0, distinct from unknown (null)", () => {
    // GLDM (a bullion trust) reports yield: 0 — factually no distributions.
    expect(mapSnapshot("GLDM", { summaryDetail: { yield: 0 } }).fundYield).toBe(0);
    expect(mapSnapshot("XXXX", {}).fundYield).toBeNull();
  });
});

/* ── classifyTx ──────────────────────────────────────────────────────────── */

describe("classifyTx", () => {
  it("classifies open-market sales and purchases", () => {
    expect(classifyTx("Sale at price 76.73 per share.")).toBe("sell");
    expect(classifyTx("Purchase at price 30.00 per share.")).toBe("buy");
  });

  it("never classifies compensation events as sells, even when a price is quoted", () => {
    expect(classifyTx("Stock Award(Grant) at price 76.05 per share.")).toBe("other");
    expect(classifyTx("Conversion of Exercise of derivative security at price 20.00 per share.")).toBe("other");
    expect(classifyTx("Sale of shares to cover tax withholding")).toBe("other");
    expect(classifyTx("Stock Gift")).toBe("other");
  });
});

/* ── mapInsider: header ≡ table ──────────────────────────────────────────── */

describe("mapInsider", () => {
  const tx = (text: string, value: number, date: string, name = "INSIDER") => ({
    filerName: name,
    transactionText: text,
    shares: 100,
    value,
    startDate: date,
  });

  it("computes buy/sell counts and net value from the SAME rows it returns", () => {
    const raw = {
      insiderTransactions: {
        transactions: [
          tx("Sale at price 76.73 per share.", 55_322, "2026-08-03"),
          tx("Sale at price 77.17 per share.", 308_680, "2026-08-03"),
          tx("Purchase at price 60.00 per share.", 60_000, "2026-07-01"),
          // Director grants that used to be miscounted as disposals:
          tx("Stock Award(Grant) at price 76.05 per share.", 60_003, "2026-06-30"),
          tx("Stock Award(Grant) at price 76.05 per share.", 60_003, "2026-06-30"),
        ],
      },
    };
    const insider = mapInsider(raw);

    // Header totals recomputed from the returned rows must match exactly.
    const sells = insider.transactions.filter((t) => t.type === "sell");
    const buys = insider.transactions.filter((t) => t.type === "buy");
    const net =
      buys.reduce((s, t) => s + (t.value ?? 0), 0) -
      sells.reduce((s, t) => s + (t.value ?? 0), 0);

    expect(insider.sellCount).toBe(sells.length);
    expect(insider.buyCount).toBe(buys.length);
    expect(insider.netValue).toBe(net);

    expect(insider.sellCount).toBe(2);
    expect(insider.buyCount).toBe(1);
    expect(insider.transactions.filter((t) => t.type === "other")).toHaveLength(2);
  });

  it("never counts transactions it does not return (header reconciles with the table)", () => {
    // 30 sells in the raw feed, but only 20 rows ship to the client — the
    // header must describe those 20, not the hidden 30.
    const raw = {
      insiderTransactions: {
        transactions: Array.from({ length: 30 }, (_, i) =>
          tx("Sale at price 50.00 per share.", 1_000, `2026-07-${String((i % 28) + 1).padStart(2, "0")}`),
        ),
      },
    };
    const insider = mapInsider(raw);
    expect(insider.transactions.length).toBeLessThanOrEqual(20);
    expect(insider.sellCount).toBe(insider.transactions.filter((t) => t.type === "sell").length);
    expect(insider.netValue).toBe(-insider.transactions.reduce((s, t) => s + (t.value ?? 0), 0));
  });
});

/* ── mapAnalyst: one count ───────────────────────────────────────────────── */

describe("mapAnalyst", () => {
  it("derives the analyst count from the rating distribution when present", () => {
    const raw = {
      financialData: { currentPrice: 79, targetMeanPrice: 89, numberOfAnalystOpinions: 23 },
      recommendationTrend: { trend: [{ period: "0m", strongBuy: 4, buy: 12, hold: 8, sell: 0, strongSell: 0 }] },
    };
    const analyst = mapAnalyst(raw);
    // 4+12+8 = 24 — the distribution, not financialData's 23.
    expect(analyst.numberOfOpinions).toBe(24);
    expect(analyst.strongBuy + analyst.buy + analyst.hold + analyst.sell + analyst.strongSell).toBe(
      analyst.numberOfOpinions,
    );
  });

  it("falls back to financialData's count when there is no distribution", () => {
    const raw = {
      financialData: { currentPrice: 79, targetMeanPrice: 89, numberOfAnalystOpinions: 7 },
    };
    expect(mapAnalyst(raw).numberOfOpinions).toBe(7);
  });
});

/* ── describeFiling: no echoes, no raw IDs ───────────────────────────────── */

describe("describeFiling", () => {
  it("maps common forms to human descriptions when EDGAR echoes the form", () => {
    expect(describeFiling("4", "FORM 4")).toBe("Insider transaction report");
    expect(describeFiling("144", "144")).toBe("Notice of proposed insider sale");
    expect(describeFiling("8-K", "8-K")).toBe("Current report — material event");
    expect(describeFiling("10-Q", "")).toBe("Quarterly report");
  });

  it("never leaks raw numeric artifacts", () => {
    expect(describeFiling("S-8", "42485")).toBe("Employee stock plan registration");
  });

  it("keeps a real primary-document description when EDGAR provides one", () => {
    expect(describeFiling("8-K", "Results of Operations and Financial Condition")).toBe(
      "Results of Operations and Financial Condition",
    );
  });

  it("falls back to a generic label for unmapped forms", () => {
    expect(describeFiling("X-17A-5", "X-17A-5")).toBe("SEC filing");
  });
});
