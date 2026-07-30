import { describe, it, expect } from "vitest";
import {
  xirr,
  positionPerformance,
  benchmarkComparison,
  priceOnOrBefore,
  portfolioPerformance,
  MIN_DAYS_TO_ANNUALIZE,
} from "@/lib/portfolio-performance";
import type { PortfolioLot } from "@/lib/types";

let nextId = 1;
function lot(o: Partial<PortfolioLot> & { shares: number; price: number }): PortfolioLot {
  return {
    id: nextId++,
    symbol: "AAPL",
    name: "Apple",
    kind: "buy",
    fees: 0,
    tradeDate: "2025-01-01",
    createdAt: "2025-01-01T00:00:00Z",
    ...o,
  };
}

describe("xirr", () => {
  it("returns null without a sign change", () => {
    expect(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: -50 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: 100 }])).toBeNull();
  });

  it("solves a doubling over one year to ~100%", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 200 },
    ]);
    expect(r).toBeCloseTo(1.0, 2);
  });

  it("solves a flat return to ~0%", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 100 },
    ]);
    expect(r).toBeCloseTo(0, 3);
  });

  it("handles multiple contributions (money-weighted)", () => {
    // Two $100 buys 6 months apart, worth $230 after a year from the first.
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-07-01", amount: -100 },
      { date: "2026-01-01", amount: 230 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.1); // positive, money-weighted > simple naive
  });

  it("solves a loss to a negative rate", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 80 },
    ]);
    expect(r).toBeCloseTo(-0.2, 2);
  });
});

describe("positionPerformance", () => {
  it("splits realized and unrealized P&L", () => {
    const lots = [
      lot({ shares: 10, price: 100, tradeDate: "2025-01-01" }),
      lot({ shares: 4, price: 150, kind: "sell", tradeDate: "2025-06-01" }),
    ];
    const p = positionPerformance(lots, 130, "2026-01-01")!;
    expect(p.shares).toBe(6);
    expect(p.realizedPnl).toBeCloseTo(200, 6); // 4*(150-100)
    expect(p.currentValue).toBeCloseTo(6 * 130, 6);
    expect(p.unrealizedPnl).toBeCloseTo(6 * (130 - 100), 6); // 180
    expect(p.totalPnl).toBeCloseTo(380, 6);
    expect(p.holdingDays).toBe(365);
  });

  it("prices an all-cash-out flow set into an XIRR", () => {
    const p = positionPerformance([lot({ shares: 1, price: 100, tradeDate: "2025-01-01" })], 200, "2026-01-01")!;
    expect(p.xirr).toBeCloseTo(1.0, 2);
  });
});

describe("priceOnOrBefore", () => {
  const hist = [
    { date: "2025-01-01", close: 100 },
    { date: "2025-06-01", close: 120 },
    { date: "2025-12-01", close: 150 },
  ];
  it("returns the last close on or before the date", () => {
    expect(priceOnOrBefore(hist, "2025-06-15")).toBe(120);
    expect(priceOnOrBefore(hist, "2025-12-01")).toBe(150);
  });
  it("falls back to the earliest close for a pre-history date", () => {
    expect(priceOnOrBefore(hist, "2024-01-01")).toBe(100);
  });
});

describe("benchmarkComparison", () => {
  it("computes outperformance sign correctly (portfolio beat index)", () => {
    // Bought AAPL at 100, now 200 (doubled). Index went 100 → 120 over the same window.
    const lots = [lot({ symbol: "AAPL", shares: 1, price: 100, tradeDate: "2025-01-01" })];
    const bench = benchmarkComparison(
      lots,
      "SPY",
      [{ date: "2025-01-01", close: 100 }],
      120,
      "2026-01-01",
      1.0, // portfolio xirr ~100%
    );
    expect(bench).not.toBeNull();
    expect(bench!.currentValue).toBeCloseTo(120, 6); // $100 in index → $120
    expect(bench!.xirr).toBeCloseTo(0.2, 2);
    expect(bench!.outperformancePct!).toBeGreaterThan(0); // portfolio beat the index
  });
});

describe("portfolioPerformance", () => {
  it("aggregates positions and benchmarks against the index", () => {
    const lotsBySymbol = new Map<string, PortfolioLot[]>([
      ["AAPL", [lot({ symbol: "AAPL", name: "Apple", shares: 1, price: 100, tradeDate: "2025-01-01" })]],
      ["MSFT", [lot({ symbol: "MSFT", name: "Microsoft", shares: 1, price: 200, tradeDate: "2025-01-01" })]],
    ]);
    const prices: Record<string, number> = { AAPL: 150, MSFT: 250 };
    const perf = portfolioPerformance(
      lotsBySymbol,
      (s) => prices[s] ?? null,
      "2026-01-01",
      { symbol: "SPY", history: [{ date: "2025-01-01", close: 100 }], priceNow: 110 },
    );
    expect(perf.costBasis).toBeCloseTo(300, 6);
    expect(perf.currentValue).toBeCloseTo(400, 6);
    expect(perf.unrealizedPnl).toBeCloseTo(100, 6);
    expect(perf.positions).toHaveLength(2);
    expect(perf.positions[0].symbol).toBe("MSFT"); // sorted by current value desc
    expect(perf.benchmark?.symbol).toBe("SPY");
    expect(perf.benchmark?.currentValue).toBeCloseTo(330, 6); // $300 in index → +10% = 330
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Unpriced positions — the 2026-07-28 portfolio audit.

   `portfolioPerformance` called `positionPerformance(lots, price ?? 0, asOf)`.
   That `?? 0` valued any position without a resolvable quote at ZERO against its
   full cost basis — i.e. reported it as a total loss — and then let the benchmark
   replication see the capital outflow with no terminal value to credit.

   It fired on the most ordinary holding there is. `upsertCash()` records cash as
   a synthetic `CASH-USD` lot, no provider quotes a synthetic ticker, and a real
   $9.28M book with $1.25M of cash reported −$1,228,679 of P&L on a page whose
   headline read +$14,920 — and told the user they were $1.22M behind SPY. All of
   it was the phantom loss on cash.
   ──────────────────────────────────────────────────────────────────────────── */

describe("portfolioPerformance — unpriced positions", () => {
  const asOf = "2025-06-30T00:00:00Z";

  /** One priced equity plus one position whose price cannot be resolved. */
  function book() {
    return new Map<string, PortfolioLot[]>([
      ["AAPL", [lot({ symbol: "AAPL", name: "Apple", shares: 100, price: 200, tradeDate: "2025-01-02" })]],
      ["CASH-USD", [lot({ symbol: "CASH-USD", name: "USD Cash", shares: 1_000_000, price: 1, tradeDate: "2025-01-02" })]],
    ]);
  }

  it("excludes an unpriced position instead of valuing it at zero", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf);

    expect(p.unpricedSymbols).toEqual(["CASH-USD"]);
    // Only AAPL is counted: 100 × 220 = 22,000 against a 20,000 basis.
    expect(p.currentValue).toBeCloseTo(22_000, 6);
    expect(p.costBasis).toBeCloseTo(20_000, 6);
    // The regression: this was −978,000 (a $1,000,000 phantom loss on cash
    // against AAPL's +$2,000 gain).
    expect(p.unrealizedPnl).toBeCloseTo(2_000, 6);
    expect(p.totalPnl).toBeCloseTo(2_000, 6);
    expect(p.totalPnl).toBeGreaterThan(0);
  });

  it("keeps the excluded position out of the per-position table", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf);
    expect(p.positions.map((x) => x.symbol)).toEqual(["AAPL"]);
  });

  it("keeps an unpriced position's cash flows out of the benchmark replication", () => {
    const history = [
      { date: "2025-01-02", close: 500 },
      { date: "2025-06-30", close: 550 },
    ];
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, {
      symbol: "SPY",
      history,
      priceNow: 550,
    });

    // Only AAPL's $20,000 buys the index: 40 units at 500, worth 40 × 550.
    expect(p.benchmark).not.toBeNull();
    expect(p.benchmark!.currentValue).toBeCloseTo(22_000, 6);
    // Both grew 10% over the same window, so neither is meaningfully ahead. The
    // regression had the portfolio $1M "behind" a benchmark that had been handed
    // the cash the portfolio was never credited for.
    expect(Math.abs(p.benchmark!.currentValue - p.currentValue)).toBeLessThan(1);
  });

  it("prices cash at par when the caller resolves it — the route's fix", () => {
    // The route maps any CASH-* symbol to 1, because that IS its price.
    const priceFor = (s: string) => (s.startsWith("CASH-") ? 1 : s === "AAPL" ? 220 : null);
    const p = portfolioPerformance(book(), priceFor, asOf);

    expect(p.unpricedSymbols).toEqual([]);
    expect(p.currentValue).toBeCloseTo(1_022_000, 6);
    // Cash contributes exactly zero P&L — value equals basis — rather than
    // −$1,000,000.
    expect(p.unrealizedPnl).toBeCloseTo(2_000, 6);
    const cash = p.positions.find((x) => x.symbol === "CASH-USD");
    expect(cash?.unrealizedPnl).toBeCloseTo(0, 6);
  });

  it("reports no exclusions for a fully priced book", () => {
    const p = portfolioPerformance(
      new Map([["AAPL", [lot({ shares: 10, price: 100 })]]]),
      () => 120,
      asOf,
    );
    expect(p.unpricedSymbols).toEqual([]);
  });

  it("still reports a CLOSED position, which needs no current price", () => {
    // Bought 10 @ 100, sold all 10 @ 150: realized +500, nothing left to value.
    const lots = [
      lot({ symbol: "MSFT", shares: 10, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
      lot({ symbol: "MSFT", shares: 10, price: 150, kind: "sell", tradeDate: "2025-03-02" }),
    ];
    const p = portfolioPerformance(new Map([["MSFT", lots]]), () => null, asOf);

    expect(p.unpricedSymbols).toEqual([]);
    expect(p.realizedPnl).toBeCloseTo(500, 6);
    // A closed position carries no OPEN value...
    expect(p.currentValue).toBeCloseTo(0, 6);
    // ...but it IS listed, flagged closed. It used to be filtered out of
    // `positions` while its realized P&L still accrued into the headline above the
    // table, so a fully-exited winner contributed to the total and appeared nowhere
    // in the breakdown of that total.
    expect(p.positions.map((x) => x.symbol)).toEqual(["MSFT"]);
    expect(p.positions[0].closed).toBe(true);
    expect(p.positions[0].realizedPnl).toBeCloseTo(500, 6);
  });

  it("ranks open positions above closed ones regardless of P&L", () => {
    const p = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        [
          "GLD",
          [
            lot({ symbol: "GLD", shares: 10, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
            lot({ symbol: "GLD", shares: 10, price: 150, kind: "sell", tradeDate: "2025-03-02" }),
          ],
        ],
        ["AAPL", [lot({ symbol: "AAPL", shares: 1, price: 100, tradeDate: "2025-01-02" })]],
      ]),
      (s) => (s === "AAPL" ? 110 : null),
      asOf,
    );
    expect(p.positions.map((x) => x.symbol)).toEqual(["AAPL", "GLD"]);
  });

  it("lists every position that contributes to the headline P&L", () => {
    // The additive-decomposition rule: the table under a total must account for it.
    const p = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        [
          "GLD",
          [
            lot({ symbol: "GLD", shares: 10, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
            lot({ symbol: "GLD", shares: 10, price: 150, kind: "sell", tradeDate: "2025-03-02" }),
          ],
        ],
        ["AAPL", [lot({ symbol: "AAPL", shares: 1, price: 100, tradeDate: "2025-01-02" })]],
      ]),
      (s) => (s === "AAPL" ? 110 : null),
      asOf,
    );
    const summed = p.positions.reduce((s, x) => s + x.totalPnl, 0);
    expect(summed).toBeCloseTo(p.totalPnl, 6);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   GLD: Return% must be reconstructible from the row it sits on.

   The Performance tab's GLD row read:

     Value $0.18 · Cost $0.18 · Realized +$2,856.18 · Unrealized $0.00 ·
     Total P&L +$2,856.18 · Return +0.8%

   Every figure was correct, and together they looked impossible — $2,856 on a
   $0.18 basis is 1,560,000%, not 0.8%. The denominator was the $375,026 the
   position had consumed over its life, and it appeared nowhere. `grossInvested`
   exists so the row can be checked.
   ──────────────────────────────────────────────────────────────────────────── */

describe("positionPerformance — Return% is reconstructible", () => {
  /** GLD's real ledger, post-repair: two buys at 371.90, two sells, fully exited. */
  const gld = () => [
    lot({ symbol: "GLD", name: "SPDR Gold Shares", shares: 672.223716052702, price: 371.9, kind: "buy", tradeDate: "2026-07-25" }),
    lot({ symbol: "GLD", name: "SPDR Gold Shares", shares: 336.181769292821, price: 371.9, kind: "buy", tradeDate: "2026-07-25" }),
    lot({ symbol: "GLD", name: "SPDR Gold Shares", shares: 382.3606295012, price: 374.9, kind: "sell", tradeDate: "2026-07-27" }),
    lot({ symbol: "GLD", name: "SPDR Gold Shares", shares: 626.044855844323, price: 374.63, kind: "sell", tradeDate: "2026-07-28" }),
  ];

  it("reports the denominator its return is measured against", () => {
    const p = positionPerformance(gld(), null, "2026-07-29T00:00:00Z")!;

    // Fully exited by the repaired final sell — no dust residual left behind.
    expect(p.shares).toBe(0);
    expect(p.closed).toBe(true);
    expect(p.currentValue).toBeCloseTo(0, 6);
    expect(p.costBasis).toBeCloseTo(0, 6);
    expect(p.unrealizedPnl).toBeCloseTo(0, 6);

    // Gross capital deployed: 1008.4054853 shares × $371.90.
    expect(p.grossInvested).toBeCloseTo(375_025.9998, 3);

    // And the percentage is exactly that ratio — checkable from the row.
    expect(p.totalReturnPct).toBeCloseTo(p.totalPnl / p.grossInvested, 12);
    expect(p.totalPnl).toBeCloseTo(p.realizedPnl + p.unrealizedPnl, 6);
    expect(p.totalReturnPct * 100).toBeCloseTo(0.76, 2);
  });

  it("holds for a partially sold-down position too, where Cost != Deployed", () => {
    const p = positionPerformance(
      [
        lot({ symbol: "X", shares: 100, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
        lot({ symbol: "X", shares: 99, price: 110, kind: "sell", tradeDate: "2025-03-02" }),
      ],
      120,
      "2025-06-30",
    )!;

    // One share left: Cost is $100 while $10,000 was deployed. Reading the return
    // against Cost gives 10.9x the truth, which is exactly how the GLD row read.
    expect(p.costBasis).toBeCloseTo(100, 6);
    expect(p.grossInvested).toBeCloseTo(10_000, 6);
    expect(p.grossInvested).not.toBeCloseTo(p.costBasis, 1);
    expect(p.totalReturnPct).toBeCloseTo(p.totalPnl / p.grossInvested, 12);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   FX. `shares × price` is a figure in the HOLDING's currency; summing it into a
   base-currency total adds francs to dollars. The book carries a CHF forex
   position, so this was live — it escaped notice only because that position also
   happened to be unpriced.
   ──────────────────────────────────────────────────────────────────────────── */

describe("positionPerformance — FX", () => {
  const chf = () => [lot({ symbol: "USDCHF=X", shares: 1000, price: 0.8, kind: "buy", tradeDate: "2025-01-02" })];

  it("converts value, cost, P&L and the return denominator at one rate", () => {
    const p = positionPerformance(chf(), { priceBase: 0.9 * 1.25, fxRate: 1.25 }, "2025-06-30")!;

    // 1000 units at 0.9 CHF = 900 CHF = $1,125 at 1.25.
    expect(p.currentValue).toBeCloseTo(1125, 6);
    // Cost 800 CHF = $1,000 — NOT 800, which is what an unconverted basis gave.
    expect(p.costBasis).toBeCloseTo(1000, 6);
    expect(p.unrealizedPnl).toBeCloseTo(125, 6);
    expect(p.grossInvested).toBeCloseTo(1000, 6);
    // The percentage is FX-invariant, because both sides converted at one rate.
    expect(p.totalReturnPct).toBeCloseTo(0.125, 12);
  });

  /* ────────────────────────────────────────────────────────────────────────
     A CLOSED foreign position has no RawHolding — `aggregateOpenPositions()`
     drops `shares === 0` — so `priceFor()` returns null, and the fx rate used to
     default to 1. A position that banked CHF 2,000 was reported as $2,000.
     ──────────────────────────────────────────────────────────────────────── */
  it("converts a CLOSED foreign position's realized P&L, never at 1.0", () => {
    // Bought 1,000 @ CHF 100 (2025-01-02), sold all @ CHF 120 (2025-03-03).
    // Realized = CHF 20,000. At the sell date's rate of 1.25 that is $25,000.
    const lots = [
      lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
      lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 120, kind: "sell", tradeDate: "2025-03-03" }),
    ];
    const p = positionPerformance(lots, null, "2025-06-30", {
      // Historical series: 1.10 in January, 1.25 by March.
      fxOn: (cur, date) => (cur === "CHF" ? (date >= "2025-03-01" ? 1.25 : 1.1) : 1),
    })!;

    expect(p.closed).toBe(true);
    // The regression: this was 20_000 (francs printed as dollars).
    expect(p.realizedPnl).toBeCloseTo(25_000, 6);
    // Capital deployed converts at the BUY's own date: 100,000 CHF x 1.10.
    expect(p.grossInvested).toBeCloseTo(110_000, 6);
    expect(p.totalReturnPct).toBeCloseTo(25_000 / 110_000, 12);
  });

  it("is equivalent to a plain number when the rate is 1", () => {
    const asNumber = positionPerformance(chf(), 0.9, "2025-06-30")!;
    const asPricing = positionPerformance(chf(), { priceBase: 0.9, fxRate: 1 }, "2025-06-30")!;
    expect(asPricing).toEqual(asNumber);
  });

  /* ── The fallback chain, which must never end at an implicit 1.0 ───────────── */

  const closedChf = () => [
    lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
    lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 120, kind: "sell", tradeDate: "2025-03-03" }),
  ];

  it("falls back to TODAY's rate when no historical series is available", () => {
    const p = positionPerformance(closedChf(), null, "2025-06-30", {
      fxOn: () => null, // series missing / fetch failed
      fxNow: (cur) => (cur === "CHF" ? 1.2 : null),
    })!;
    // CHF 20,000 at 1.20 — approximate (it ignores drift since the sale), but not
    // off by the whole exchange rate the way 1.0 was.
    expect(p.realizedPnl).toBeCloseTo(24_000, 6);
  });

  it("falls back to the live valuation's rate before ever reaching 1.0", () => {
    // Open foreign position, ledger has no currency recorded (a pre-migration row):
    // the valuation's own fxRate must still be used.
    const legacy = [lot({ symbol: "NESN.SW", shares: 1_000, price: 100, kind: "buy", tradeDate: "2025-01-02" })];
    const p = positionPerformance(legacy, { priceBase: 110 * 1.3, fxRate: 1.3 }, "2025-06-30", {
      fxOn: () => null,
      fxNow: () => null,
    })!;
    expect(p.grossInvested).toBeCloseTo(130_000, 6);
  });

  it("never silently reports a foreign realized gain at 1.0", () => {
    // No resolvers at all — the worst case. With a currency on the ledger and an
    // open valuation absent, 1.0 is unavoidable, so this asserts the SHAPE of the
    // guarantee: whenever ANY rate source exists, it is used.
    const withNothing = positionPerformance(closedChf(), null, "2025-06-30")!;
    const withNow = positionPerformance(closedChf(), null, "2025-06-30", {
      fxNow: () => 1.25,
    })!;
    expect(withNothing.realizedPnl).toBeCloseTo(20_000, 6); // documented last resort
    expect(withNow.realizedPnl).toBeCloseTo(25_000, 6);
    expect(withNow.realizedPnl).not.toBeCloseTo(withNothing.realizedPnl, 1);
  });

  it("converts each sell at its OWN date, not one rate for the position", () => {
    // Two sells either side of a big FX move. A single cumulative figure cannot
    // express this: CHF 10,000 banked at 1.10 and CHF 10,000 at 1.50.
    const lots = [
      lot({ symbol: "NESN.SW", currency: "CHF", shares: 2_000, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
      lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 110, kind: "sell", tradeDate: "2025-02-03" }),
      lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 110, kind: "sell", tradeDate: "2025-05-05" }),
    ];
    const p = positionPerformance(lots, null, "2025-06-30", {
      fxOn: (cur, date) => (cur === "CHF" ? (date >= "2025-05-01" ? 1.5 : 1.1) : 1),
    })!;
    expect(p.realizedPnl).toBeCloseTo(10_000 * 1.1 + 10_000 * 1.5, 6);
  });

  it("leaves a base-currency book completely unchanged", () => {
    // The no-regression guarantee: for a USD book every rate is 1 on every date, so
    // supplying resolvers must change nothing.
    const usd = [
      lot({ symbol: "AAPL", currency: "USD", shares: 100, price: 200, kind: "buy", tradeDate: "2025-01-02" }),
      lot({ symbol: "AAPL", currency: "USD", shares: 40, price: 250, kind: "sell", tradeDate: "2025-03-03" }),
    ];
    const bare = positionPerformance(usd, 260, "2025-06-30")!;
    const withFx = positionPerformance(usd, 260, "2025-06-30", {
      fxOn: (cur) => (cur === "USD" ? 1 : null),
      fxNow: (cur) => (cur === "USD" ? 1 : null),
    })!;
    expect(withFx).toEqual(bare);
    expect(bare.realizedPnl).toBeCloseTo(40 * (250 - 200), 6);
  });

  it("converts the benchmark replication's cash flows too", () => {
    // Without FX the replication would buy the index with 800 francs treated as
    // $800, understating the benchmark by the FX rate and flattering the user.
    const p = portfolioPerformance(
      new Map([["USDCHF=X", chf()]]),
      () => ({ priceBase: 0.9 * 1.25, fxRate: 1.25 }),
      "2025-06-30",
      { symbol: "SPY", history: [{ date: "2025-01-02", close: 500 }], priceNow: 550 },
    );
    // $1,000 of converted capital buys 2 units at 500, worth 2 × 550.
    expect(p.benchmark!.currentValue).toBeCloseTo(1100, 6);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Reconciliation. The panel stated that manually-valued assets were excluded and
   printed a total $2,665.81 below the page's Total Value, when those assets came
   to $1,750. `excluded` + `portfolioValue` make the subtraction checkable.
   ──────────────────────────────────────────────────────────────────────────── */

describe("portfolioPerformance — reconciliation against the portfolio total", () => {
  const asOf = "2025-06-30T00:00:00Z";

  function book() {
    return new Map<string, PortfolioLot[]>([
      ["AAPL", [lot({ symbol: "AAPL", shares: 100, price: 200, tradeDate: "2025-01-02" })]],
      ["USDCHF=X", [lot({ symbol: "USDCHF=X", shares: 1000, price: 0.8, tradeDate: "2025-01-02" })]],
    ]);
  }

  /** The real book's three manual assets: $1,750 of value against a $15,250 basis. */
  const manualAssets = [
    { label: "Small Land Parcel - Rural TX", valueBase: 550, costBasisBase: 7_500 },
    { label: "Acme AI Inc. - Series A", valueBase: 600, costBasisBase: 3_750 },
    { label: "Rolex Daytona (2019)", valueBase: 600, costBasisBase: 4_000 },
  ];

  it("accounts for every dollar between the in-scope figure and the total", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, undefined, {
      otherHoldings: manualAssets,
      fallbackValueFor: () => 4_639.62,
    });

    const excludedTotal = p.excluded.reduce((s, e) => s + e.valueBase, 0);
    expect(p.portfolioValue).toBeCloseTo(p.currentValue + excludedTotal, 6);
    // No residual: the exact failure being regression-tested is a stated exclusion
    // that does not account for the gap.
    expect(p.portfolioValue - excludedTotal - p.currentValue).toBeCloseTo(0, 6);
  });

  it("names the unpriced position, not just the manual assets", () => {
    // The prose only ever mentioned real estate / private markets / alternatives
    // ($1,750). The single biggest exclusion was a forex position ($4,639.62).
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, undefined, {
      otherHoldings: [manualAssets[2]],
      fallbackValueFor: () => 4_639.62,
    });

    expect(p.excluded.filter((e) => e.reason === "unpriced")).toEqual([
      { label: "USDCHF=X", reason: "unpriced", valueBase: 4_639.62, costBasisBase: 800 },
    ]);
    expect(p.excluded.filter((e) => e.reason === "manual")).toHaveLength(1);
  });

  it("carries an unpriced position at cost when the caller has no valuation", () => {
    // Cost is a value we know; zero is a claim we do not — valuing it at zero is
    // what reported a $1.25M cash balance as a total loss.
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf);
    expect(p.excluded).toEqual([
      { label: "USDCHF=X", reason: "unpriced", valueBase: 800, costBasisBase: 800 },
    ]);
    expect(p.portfolioValue).toBeCloseTo(22_000 + 800, 6);
    // Carried at cost ⇒ contributes exactly zero P&L, never a fabricated one.
    expect(p.total.pnl).toBeCloseTo(p.totalPnl, 6);
  });

  it("reports the portfolio total as the in-scope value for a fully priced book", () => {
    const p = portfolioPerformance(new Map([["AAPL", [lot({ shares: 10, price: 100 })]]]), () => 120, asOf);
    expect(p.excluded).toEqual([]);
    expect(p.portfolioValue).toBeCloseTo(p.currentValue, 6);
  });

  /* ──────────────────────────────────────────────────────────────────────────
     B1: the Dashboard and the Performance tab must never disagree on the SIGN.

     Live, before the fix:
       Dashboard    (value − cost) / cost over every holding   → −$396.01
       Performance  realized + unrealized over the traded book → +$5,359.31

     The Dashboard could not see realized P&L (a sold position leaves `holdings`);
     Performance could not see manual assets (no dated trades). Each omitted a real
     signed loss the other counted, and they landed on opposite sides of zero.
     ────────────────────────────────────────────────────────────────────────── */

  /** How the Dashboard tile is computed, from the same report fields. */
  const dashboardTotalReturn = (p: ReturnType<typeof portfolioPerformance>) => p.total;

  it("agrees with the Dashboard on sign AND magnitude, realized loss included", () => {
    // Deliberately reproduces the live shape of the bug: the traded book is UP while
    // the whole portfolio is DOWN, so the two old formulas landed on opposite sides
    // of zero. AAPL is +$16,000 unrealized, a closed GLD position banked −$9,819.50
    // (traded book: +$6,180.50), and the manual assets are $13,500 underwater
    // (portfolio: −$7,319.50).
    const closedLoser = [
      lot({ symbol: "GLD", shares: 100, price: 200, kind: "buy", tradeDate: "2025-01-02" }),
      lot({ symbol: "GLD", shares: 100, price: 101.805, kind: "sell", tradeDate: "2025-03-02" }),
    ];
    const p = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        ["AAPL", [lot({ symbol: "AAPL", shares: 100, price: 200, tradeDate: "2025-01-02" })]],
        ["GLD", closedLoser],
      ]),
      (s) => (s === "AAPL" ? 360 : null),
      asOf,
      undefined,
      { otherHoldings: manualAssets },
    );

    expect(p.realizedPnl).toBeCloseTo(-9_819.5, 6);
    // The traded book alone — what the Performance tab used to show — is POSITIVE.
    expect(p.totalPnl).toBeCloseTo(6_180.5, 6);

    // The Dashboard's number IS this object — not a parallel formula.
    const dash = dashboardTotalReturn(p);
    expect(dash.pnl).toBeCloseTo(p.total.pnl, 12);
    expect(dash.pct).toBeCloseTo(p.total.pct, 12);

    // The shared definition sees the realized loss AND the manual write-down.
    expect(p.total.pnl).toBeCloseTo(-7_319.5, 6);
    // Denominator is capital at risk: AAPL's 20,000 basis + 15,250 of manual cost.
    expect(p.total.cost).toBeCloseTo(35_250, 6);
    expect(p.total.pct).toBeCloseTo((-7_319.5 / 35_250) * 100, 9);

    // The regression itself: both panels read one number, so one sign.
    expect(Math.sign(p.total.pnl)).toBe(Math.sign(dash.pnl));
    // ...and this asserts the fixture really does reproduce the old sign flip: the
    // traded-book-only figure disagrees with the whole-portfolio one. If a future
    // change made these agree by accident, the test above would stop proving
    // anything, so the divergence is pinned here on purpose.
    expect(Math.sign(p.totalPnl)).not.toBe(Math.sign(p.total.pnl));
  });

  it("bridges the traded book to the headline, so the table still reconciles", () => {
    const p = portfolioPerformance(
      new Map([["AAPL", [lot({ symbol: "AAPL", shares: 100, price: 200, tradeDate: "2025-01-02" })]]]),
      () => 220,
      asOf,
      undefined,
      { otherHoldings: manualAssets },
    );
    const excludedPnl = p.excluded.reduce((s, e) => s + (e.valueBase - e.costBasisBase), 0);
    // headline = what the table sums to + what the reconciliation card states.
    expect(p.total.pnl).toBeCloseTo(p.totalPnl + excludedPnl, 6);
    expect(p.positions.reduce((s, x) => s + x.totalPnl, 0)).toBeCloseTo(p.totalPnl, 6);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   B3: the Dashboard header total and the Performance panel's total-value line.

   They used to be two numbers from two `MarketContext` builds against a 15-second
   quote cache: $9,260,734.55 vs $9,262,809.37, a $2,074.82 gap, with the panel's
   line labelled "Total portfolio value" as though it were the header's equal.

   The structural fix is composition — `report.performance` is derived from the
   report's own evaluation, and the panel receives `report.totalValue` as a prop, so
   there is only one total. What can still be asserted PURELY (no network) is the
   invariant the route's runtime check enforces: the performance block's own
   denominator must equal the independently-summed portfolio cost.
   ──────────────────────────────────────────────────────────────────────────── */

describe("portfolioPerformance — closed foreign position, dated FX", () => {
  const asOf = "2025-06-30T00:00:00Z";

  /** One open USD holding plus a fully-exited CHF one. */
  function book() {
    return new Map<string, PortfolioLot[]>([
      ["AAPL", [lot({ symbol: "AAPL", currency: "USD", shares: 100, price: 200, tradeDate: "2025-01-02" })]],
      [
        "NESN.SW",
        [
          lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
          lot({ symbol: "NESN.SW", currency: "CHF", shares: 1_000, price: 120, kind: "sell", tradeDate: "2025-03-03" }),
        ],
      ],
    ]);
  }

  const fxOn = (cur: string, date: string) =>
    cur === "CHF" ? (date >= "2025-03-01" ? 1.25 : 1.1) : 1;

  it("carries the converted realized P&L into the headline total", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, undefined, {
      fxOn,
      fxNow: (cur) => (cur === "CHF" ? 1.3 : 1),
    });

    // CHF 20,000 banked at the 2025-03-03 rate of 1.25 = $25,000 — not $20,000.
    expect(p.realizedPnl).toBeCloseTo(25_000, 6);
    // And it reaches the number both panels render.
    expect(p.total.pnl).toBeCloseTo(2_000 + 25_000, 6);
    // The closed position is listed, and the table still decomposes the traded book.
    expect(p.positions.map((x) => x.symbol)).toEqual(["AAPL", "NESN.SW"]);
    expect(p.positions.reduce((s, x) => s + x.totalPnl, 0)).toBeCloseTo(p.totalPnl, 6);
  });

  it("keeps total.cost on TODAY's rate, so the Dashboard invariant still holds", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, undefined, {
      fxOn,
      fxNow: (cur) => (cur === "CHF" ? 1.3 : 1),
    });
    // Only AAPL is open, so capital at risk is its $20,000 basis. The closed CHF
    // position contributes no cost — which is what keeps this equal to
    // `normalizeHoldings().totalCost`, the assertion in lib/portfolio/report.ts.
    expect(p.total.cost).toBeCloseTo(20_000, 6);
  });

  it("converts the closed position's flows in the benchmark replication", () => {
    const p = portfolioPerformance(book(), (s) => (s === "AAPL" ? 220 : null), asOf, {
      symbol: "SPY",
      history: [
        { date: "2025-01-02", close: 500 },
        { date: "2025-03-03", close: 550 },
      ],
      priceNow: 600,
    }, { fxOn, fxNow: (cur) => (cur === "CHF" ? 1.3 : 1) });

    // AAPL buys $20,000 -> 40 units @500. NESN buys CHF 100,000 x 1.10 = $110,000
    // -> 220 units @500; sells CHF 120,000 x 1.25 = $150,000 -> -272.7272 units @550.
    // Net units = 40 + 220 - 272.727272... = -12.727272...; clamped at 0 by the
    // engine, so terminal value is 0 rather than a negative holding.
    const expectedUnits = 40 + 110_000 / 500 - 150_000 / 550;
    expect(expectedUnits).toBeLessThan(0);
    expect(p.benchmark!.currentValue).toBe(0);
    // The point of the assertion: the flows were converted, so the replication saw
    // $150,000 of proceeds rather than CHF 120,000 treated as $120,000.
  });
});

describe("total.cost equals an independent sum of every holding's cost", () => {
  it("matches Σ costBasisBase across priced, unpriced and manual holdings", () => {
    const p = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        // Priced.
        ["AAPL", [lot({ symbol: "AAPL", shares: 100, price: 200, tradeDate: "2025-01-02" })]],
        // Unpriced → carried at cost.
        ["USDCHF=X", [lot({ symbol: "USDCHF=X", shares: 1_000, price: 0.8, tradeDate: "2025-01-02" })]],
        // Closed → no cost left, but realized P&L still counts.
        [
          "GLD",
          [
            lot({ symbol: "GLD", shares: 10, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
            lot({ symbol: "GLD", shares: 10, price: 150, kind: "sell", tradeDate: "2025-03-02" }),
          ],
        ],
      ]),
      (s) => (s === "AAPL" ? 220 : null),
      "2025-06-30T00:00:00Z",
      undefined,
      { otherHoldings: [{ label: "House", valueBase: 500_000, costBasisBase: 400_000 }] },
    );

    // What `normalizeHoldings()` would independently sum: 20,000 + 800 + 400,000.
    // (The closed GLD position holds nothing, so contributes no cost.)
    expect(p.total.cost).toBeCloseTo(420_800, 6);
    // And the value-side reconciliation still balances against the same snapshot.
    const excludedTotal = p.excluded.reduce((s, e) => s + e.valueBase, 0);
    expect(p.portfolioValue).toBeCloseTo(p.currentValue + excludedTotal, 6);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   B2: capital deployed must be CAPITAL, not bookkeeping.

   The Transaction Engine writes one `{ balancing: true }` cash lot per executed
   batch so a rebalance conserves total value. Those were summed as invested
   capital: $699,442.65 across 11 lots on the real book. Worse, cash is the funding
   account, so every deposit was counted once entering cash and again when it bought
   a security — a $15,866,581 denominator on a $9,245,881 portfolio (71.6% inflated),
   which made the reported return shrink every time the user rebalanced and showed
   "Deployed $5,267,690" on a $1,250,635 cash row.
   ──────────────────────────────────────────────────────────────────────────── */

describe("grossInvested — internal plumbing is not capital", () => {
  const asOf = "2025-06-30T00:00:00Z";

  it("excludes a balancing plug from a position's deployed capital", () => {
    const p = positionPerformance(
      [
        lot({ symbol: "AAPL", shares: 100, price: 100, kind: "buy", tradeDate: "2025-01-02" }),
        lot({
          symbol: "AAPL",
          shares: 50,
          price: 100,
          kind: "buy",
          tradeDate: "2025-02-02",
          meta: { balancing: true },
        }),
      ],
      120,
      asOf,
    )!;
    // Only the genuine $10,000 buy counts; the $5,000 plug does not.
    expect(p.grossInvested).toBeCloseTo(10_000, 6);
  });

  it("reports no deployed capital for a cash position", () => {
    // Cash is HELD, not deployed. This row read $5,267,690 against a $1,250,635
    // balance — 4.2x the position — in the very column added to make the
    // percentage checkable.
    const p = positionPerformance(
      [
        lot({ symbol: "CASH-USD", shares: 4_500_000, price: 1, kind: "buy", tradeDate: "2025-01-02" }),
        lot({ symbol: "CASH-USD", shares: 3_790_500, price: 1, kind: "sell", tradeDate: "2025-01-03" }),
      ],
      1,
      asOf,
    )!;
    expect(p.grossInvested).toBe(0);
    expect(p.grossInvested).not.toBeGreaterThan(p.currentValue);
  });

  it("does not let a rebalance inflate the return denominator", () => {
    // Same economics, twice: hold $100k of AAPL. The second book got there via a
    // deposit-into-cash then a purchase, plus a balancing plug — i.e. it rebalanced.
    // The old flow-sum denominator grew; capital at risk does not.
    const direct = portfolioPerformance(
      new Map([["AAPL", [lot({ symbol: "AAPL", shares: 1_000, price: 100, tradeDate: "2025-01-02" })]]]),
      () => 118,
      asOf,
    );
    const viaCash = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        ["AAPL", [lot({ symbol: "AAPL", shares: 1_000, price: 100, tradeDate: "2025-01-02" })]],
        [
          "CASH-USD",
          [
            lot({ symbol: "CASH-USD", shares: 100_000, price: 1, kind: "buy", tradeDate: "2025-01-01" }),
            lot({
              symbol: "CASH-USD",
              shares: 100_000,
              price: 1,
              kind: "sell",
              tradeDate: "2025-01-02",
              meta: { balancing: true },
            }),
          ],
        ],
      ]),
      (s) => (s === "AAPL" ? 118 : 1),
      asOf,
    );

    // Identical capital at risk, and therefore identical reported return.
    expect(viaCash.total.cost).toBeCloseTo(direct.total.cost, 6);
    expect(viaCash.total.pct).toBeCloseTo(direct.total.pct, 9);
  });

  it("reports a genuine +18% year as +18%, not a suppressed +10.5%", () => {
    // The concrete number from the audit: the old denominator would have reported
    // ~+10.5% on this, because it was 1.716x too large.
    const p = portfolioPerformance(
      new Map<string, PortfolioLot[]>([
        ["AAPL", [lot({ symbol: "AAPL", shares: 1_000, price: 1_000, tradeDate: "2024-06-30" })]],
        [
          "CASH-USD",
          [
            lot({ symbol: "CASH-USD", shares: 1_000_000, price: 1, kind: "buy", tradeDate: "2024-06-29" }),
            lot({
              symbol: "CASH-USD",
              shares: 1_000_000,
              price: 1,
              kind: "sell",
              tradeDate: "2024-06-30",
              meta: { balancing: true },
            }),
          ],
        ],
      ]),
      (s) => (s === "AAPL" ? 1_180 : 1),
      asOf,
    );
    expect(p.total.pct).toBeCloseTo(18, 6);
    // Sanity: the old flow-sum would have been 2,000,000 of "deployed" capital.
    expect(p.total.cost).toBeCloseTo(1_000_000, 6);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   The annualization gate is one constant, shared. The Portfolio page withheld its
   own XIRR under it ("Needs 90+ days (have 18)") while the benchmark card below
   printed "Underperforming by 10.3pp/yr" from the same 18 days.
   ──────────────────────────────────────────────────────────────────────────── */

describe("MIN_DAYS_TO_ANNUALIZE", () => {
  it("is a quarter, and is what the home digest gates on too", async () => {
    const { MIN_DAYS_TO_ANNUALIZE: fromContracts } = await import("../lib/home/contracts");
    expect(MIN_DAYS_TO_ANNUALIZE).toBe(90);
    expect(fromContracts).toBe(MIN_DAYS_TO_ANNUALIZE);
  });

  it("gates the benchmark comparison and the portfolio XIRR on ONE window", () => {
    // An 18-day book: both figures exist and both are unfit to display. The bug
    // was showing the DIFFERENCE of two rates each withheld on its own.
    const p = portfolioPerformance(
      new Map([["AAPL", [lot({ symbol: "AAPL", shares: 100, price: 200, tradeDate: "2025-06-12" })]]]),
      () => 205,
      "2025-06-30T00:00:00Z",
      { symbol: "SPY", history: [{ date: "2025-06-12", close: 500 }], priceNow: 510 },
    );

    expect(p.holdingDays).toBe(18);
    expect(p.holdingDays).toBeLessThan(MIN_DAYS_TO_ANNUALIZE);
    // Both annualized figures are present in the payload — the gate is the UI's
    // job, and this asserts there is exactly one threshold for it to apply.
    expect(p.xirr).not.toBeNull();
    expect(p.benchmark!.outperformancePct).not.toBeNull();
    // ...and that the raw dollar difference shown in their place needs no gate.
    expect(Number.isFinite(p.currentValue - p.benchmark!.currentValue)).toBe(true);
  });
});

describe("positionPerformance — null price", () => {
  it("returns null for an OPEN position with no price", () => {
    expect(positionPerformance([lot({ shares: 10, price: 100 })], null, "2025-06-30")).toBeNull();
  });

  it("returns null for a non-finite price rather than producing NaN figures", () => {
    expect(positionPerformance([lot({ shares: 10, price: 100 })], Number.NaN, "2025-06-30")).toBeNull();
    expect(positionPerformance([lot({ shares: 10, price: 100 })], Infinity, "2025-06-30")).toBeNull();
  });

  it("still values a CLOSED position with no price", () => {
    const perf = positionPerformance(
      [
        lot({ shares: 10, price: 100, kind: "buy" }),
        lot({ shares: 10, price: 130, kind: "sell", tradeDate: "2025-03-01" }),
      ],
      null,
      "2025-06-30",
    );
    expect(perf).not.toBeNull();
    expect(perf!.shares).toBe(0);
    expect(perf!.realizedPnl).toBeCloseTo(300, 6);
  });
});
