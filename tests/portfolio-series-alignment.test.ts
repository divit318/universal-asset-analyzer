import { describe, it, expect } from "vitest";
import { alignPair, alignReturns, datedReturns } from "@/lib/portfolio/engines/series";
import { computeCorrelation } from "@/lib/portfolio/engines/risk";
import { pearson } from "@/lib/portfolio-analytics";
import type { Holding, MarketContext } from "@/lib/portfolio/model/types";

/* ────────────────────────────────────────────────────────────────────────────
   Date alignment — the 2026-07-28 portfolio audit.

   `MarketContext.history` was a Map<string, number[]>: closes with the dates
   discarded. So every cross-holding statistic had to guess the alignment, and
   the two that did guessed differently — computeRisk() tail-aligned, while
   computeCorrelation() handed unequal arrays to pearson(), which truncates to
   the shorter and reads from INDEX 0. Head alignment across unequal lengths
   correlates two DIFFERENT calendar periods.

   This is not hypothetical: the portfolio requests a fixed 400-CALENDAR-day
   window per symbol, so an equity yields ~275 observations and crypto ~400.
   ──────────────────────────────────────────────────────────────────────────── */

/** Sessions Mon-Fri only, ascending, ending at `endExclusiveIdx` days ago. */
function weekdayDates(count: number, endDaysAgo = 0): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  while (out.length < count + endDaysAgo) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return endDaysAgo > 0 ? out.slice(0, count) : out;
}

/** Every calendar day, ascending — the crypto session calendar. */
function everyDayDates(count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("datedReturns", () => {
  it("labels a return with the LATER of the two dates it spans", () => {
    const s = datedReturns([100, 110, 121], ["2025-01-01", "2025-01-02", "2025-01-03"]);
    expect(s.returns).toEqual([0.1, 0.1]);
    // Off-by-one here would line every series up one session out of step.
    expect(s.dates).toEqual(["2025-01-02", "2025-01-03"]);
  });

  it("keeps dates parallel when a non-positive close is dropped", () => {
    const s = datedReturns([100, 0, 110, 121], ["a", "b", "c", "d"]);
    // The 0 close is skipped as a base, so only c→d survives as a return
    // alongside b→c's own base of 0 being rejected.
    expect(s.dates.length).toBe(s.returns.length);
  });

  it("carries no dates when they don't match the closes, rather than mislabelling", () => {
    const s = datedReturns([100, 110, 121], ["2025-01-01"]);
    expect(s.returns).toHaveLength(2);
    expect(s.dates).toEqual([]);
  });
});

describe("alignReturns", () => {
  it("joins on the shared calendar, not on position", () => {
    const a = { dates: ["d1", "d2", "d3", "d4"], returns: [1, 2, 3, 4] };
    const b = { dates: ["d2", "d3", "d4", "d5"], returns: [20, 30, 40, 50] };
    const { dates, series } = alignReturns([a, b]);
    expect(dates).toEqual(["d2", "d3", "d4"]);
    expect(series[0]).toEqual([2, 3, 4]);
    expect(series[1]).toEqual([20, 30, 40]);
  });

  it("aligns a 7-day crypto calendar against a 5-day equity calendar", () => {
    // 60 weekday sessions vs 84 calendar days covering the same span.
    const eq = weekdayDates(60);
    const crypto = everyDayDates(84);
    const a = { dates: eq, returns: eq.map((_, i) => i) };
    const b = { dates: crypto, returns: crypto.map((_, i) => i * 100) };

    const { dates, series } = alignReturns([a, b]);
    // Only the weekdays are shared, and every index must be the same date.
    expect(dates.length).toBeGreaterThan(20);
    expect(dates.every((d) => eq.includes(d) && crypto.includes(d))).toBe(true);
    for (let i = 0; i < dates.length; i++) {
      expect(a.returns[eq.indexOf(dates[i])]).toBe(series[0][i]);
      expect(b.returns[crypto.indexOf(dates[i])]).toBe(series[1][i]);
    }
  });

  it("returns equal-length series for every input", () => {
    const s = alignReturns([
      { dates: ["d1", "d2", "d3"], returns: [1, 2, 3] },
      { dates: ["d1", "d3"], returns: [10, 30] },
      { dates: ["d1", "d2", "d3", "d4"], returns: [100, 200, 300, 400] },
    ]);
    expect(s.series.map((x) => x.length)).toEqual([2, 2, 2]);
    expect(s.dates).toEqual(["d1", "d3"]);
  });

  it("degrades to tail alignment — and says so — when dates are absent", () => {
    const s = alignReturns([
      { dates: [], returns: [1, 2, 3, 4, 5] },
      { dates: [], returns: [30, 40, 50] },
    ]);
    // Tail, not head: both series must end on the same (most recent) observation.
    expect(s.series[0]).toEqual([3, 4, 5]);
    expect(s.series[1]).toEqual([30, 40, 50]);
    // Empty dates is the signal that there is no calendar guarantee.
    expect(s.dates).toEqual([]);
  });

  it("yields nothing when there is no usable overlap", () => {
    const s = alignReturns([
      { dates: ["d1", "d2"], returns: [1, 2] },
      { dates: ["d9", "d8"], returns: [9, 8] },
    ]);
    expect(s.series).toEqual([]);
  });
});

describe("alignPair", () => {
  it("is null below pearson's 5-point floor rather than yielding a fabricated r=0", () => {
    const a = { dates: ["d1", "d2", "d3"], returns: [1, 2, 3] };
    const b = { dates: ["d1", "d2", "d3"], returns: [3, 2, 1] };
    expect(alignPair(a, b)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The end-to-end consequence, through computeCorrelation                      */
/* -------------------------------------------------------------------------- */

function holding(symbol: string, value: number): Holding {
  return {
    id: symbol,
    assetClass: "equity",
    symbol,
    name: symbol,
    currency: "USD",
    quantity: 1,
    unit: "shares",
    costBasis: value,
    costBasisBase: value,
    acquiredAt: "2024-01-01",
    valuation: {
      mode: "market",
      value,
      valueBase: value,
      fxRate: 1,
      source: "yahoo",
      asOf: "2025-06-01",
      stale: false,
    },
    weight: 50,
    unrealizedPL: 0,
    unrealizedPct: 0,
    liquidity: "t0",
    income: null,
    factors: {},
    metrics: {},
    attributes: {},
    score: null,
    meta: {},
  };
}

function ctxWith(
  series: Record<string, { closes: number[]; dates: string[] }>,
): MarketContext {
  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes: new Map(),
    history: new Map(Object.entries(series).map(([s, v]) => [s, v.closes])),
    historyDates: new Map(Object.entries(series).map(([s, v]) => [s, v.dates])),
    fundamentals: new Map(),
    benchmarkReturns: [],
    benchmarkDates: [],
    asOf: "2025-06-01T00:00:00.000Z",
  };
}

/** Closes whose day-over-day returns follow `f(i)`, starting from 100. */
function closesFrom(f: (i: number) => number, n: number): number[] {
  const out = [100];
  for (let i = 0; i < n; i++) out.push(out[out.length - 1] * (1 + f(i)));
  return out;
}

describe("computeCorrelation — date alignment", () => {
  it("recovers the true correlation when one series is longer than the other", () => {
    // LONG has 200 extra leading observations of unrelated noise. SHORT overlaps
    // only the tail. Head alignment (the old behaviour) compared LONG's oldest
    // noise against SHORT's real data and produced a meaningless r.
    const allDates = weekdayDates(300);
    const sharedDates = allDates.slice(-99);

    // Over the SHARED window the two series move together almost exactly.
    const shared = (i: number) => 0.01 * Math.sin(i * 0.7);
    const noise = (i: number) => 0.01 * Math.cos(i * 2.3);

    const longCloses = closesFrom((i) => (i < 200 ? noise(i) : shared(i - 200)), 299);
    const shortCloses = closesFrom((i) => shared(i) * 0.99, 99);

    const c = computeCorrelation(
      [holding("LONG", 1000), holding("SHORT", 1000)],
      ctxWith({
        LONG: { closes: longCloses, dates: allDates },
        SHORT: { closes: shortCloses, dates: [allDates[allDates.length - 100], ...sharedDates] },
      }),
    );

    expect(c).not.toBeNull();
    // The overlap is genuinely near-perfectly correlated, and date alignment finds it.
    expect(c!.matrix[0][1]).toBeGreaterThan(0.95);
  });

  it("is not fooled by two series that overlap on no dates at all", () => {
    const early = weekdayDates(60);
    const late = weekdayDates(200).slice(-60);
    const c = computeCorrelation(
      [holding("EARLY", 1000), holding("LATE", 1000)],
      ctxWith({
        EARLY: { closes: closesFrom((i) => 0.01 * Math.sin(i), 59), dates: early },
        LATE: { closes: closesFrom((i) => 0.01 * Math.sin(i), 59), dates: late },
      }),
    );
    // Identical shapes over disjoint periods must NOT report r = 1. With no
    // shared date there is no measurable pair, so there is no matrix at all.
    expect(c).toBeNull();
  });

  it("leaves an unmeasurable pair as NaN, never as a diversifying 0", () => {
    const dates = weekdayDates(60);
    const holdings = [holding("A", 1000), holding("B", 1000), holding("C", 1000)];
    const c = computeCorrelation(
      holdings,
      ctxWith({
        A: { closes: closesFrom((i) => 0.01 * Math.sin(i), 59), dates },
        B: { closes: closesFrom((i) => 0.01 * Math.cos(i), 59), dates },
        // C shares only 3 dates with A and B — below pearson's 5-point floor.
        // Its other 57 observations are in 2024, where A and B have none.
        C: {
          closes: closesFrom((i) => 0.01 * Math.sin(i * 3), 59),
          dates: [
            ...Array.from({ length: 57 }, (_, i) => `2024-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`),
            ...dates.slice(0, 3),
          ],
        },
      }),
    );
    expect(c).not.toBeNull();
    const ci = c!.symbols.indexOf("C");
    const ai = c!.symbols.indexOf("A");
    // Unknown, not zero. A fabricated 0 renders an unmeasured holding as a
    // perfect diversifier — the one lie this engine most wants to avoid.
    expect(Number.isNaN(c!.matrix[ai][ci])).toBe(true);
    expect(c!.matrix[ai][ci]).not.toBe(0);
  });

  it("still works when a fixture supplies no dates (tail-aligned fallback)", () => {
    const noDates: MarketContext = {
      ...ctxWith({}),
      history: new Map([
        ["A", closesFrom((i) => 0.01 * Math.sin(i), 59)],
        ["B", closesFrom((i) => 0.01 * Math.sin(i), 40)],
      ]),
      historyDates: undefined,
    };
    const c = computeCorrelation([holding("A", 1000), holding("B", 1000)], noDates);
    expect(c).not.toBeNull();
    expect(Number.isFinite(c!.matrix[0][1])).toBe(true);
  });

  it("agrees with a hand-aligned pearson on identical calendars", () => {
    const dates = weekdayDates(80);
    const aCloses = closesFrom((i) => 0.01 * Math.sin(i * 0.5), 79);
    const bCloses = closesFrom((i) => 0.008 * Math.sin(i * 0.5 + 1), 79);
    const c = computeCorrelation(
      [holding("A", 1000), holding("B", 1000)],
      ctxWith({ A: { closes: aCloses, dates }, B: { closes: bCloses, dates } }),
    );
    const expected = pearson(
      datedReturns(aCloses, dates).returns,
      datedReturns(bCloses, dates).returns,
    );
    expect(c!.matrix[0][1]).toBeCloseTo(expected, 10);
  });
});
