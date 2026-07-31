import { describe, expect, it } from "vitest";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { computeAllocation } from "@/lib/portfolio/engines/allocation";
import { computeRisk } from "@/lib/portfolio/engines/risk";
import { alignReturns, datedReturns } from "@/lib/portfolio/engines/series";
import type { MarketContext, RawHolding } from "@/lib/portfolio/model/types";

/* ────────────────────────────────────────────────────────────────────────────
   Coverage-gap renormalization × date alignment — the 2026-07-31 merge.

   Two independent corrections landed on the SAME loop in computeRisk() from two
   branches, and the merge had to carry both:

   - DATE alignment (divit-local): index i must be the same session in every
     holding's series. Tail alignment zipped a 400-observation crypto series
     against a 275-observation equity series position by position.

   - Coverage-gap RENORMALIZATION (origin/main): `w = weight / 100` used each
     observed holding's RAW portfolio weight, so an unmodelled gap contributed
     nothing to the sum — arithmetically identical to asserting the gap returns
     exactly 0% every day, i.e. that unmeasured risk is riskless.

   Neither branch had a test for the renormalization at all, and neither had one
   for the combination, so nothing would have caught a resolution that kept the
   markers tidy and silently dropped one of the two. The last test here is the
   one that only fails if they are NOT composed.
   ──────────────────────────────────────────────────────────────────────────── */

/** Deterministic pseudo-random walk, so vol is stable across runs. */
function walk(n: number, drift: number, vol: number, seed = 1): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const out = [100];
  for (let i = 1; i < n; i++) out.push(Math.max(out[i - 1] * (1 + drift + rnd() * vol), 1));
  return out;
}

/** Sessions Mon-Fri only — the equity calendar. */
function weekdayDates(count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Every calendar day — the crypto calendar. */
function everyDayDates(count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const QUOTE = (symbol: string, price: number) => ({
  symbol, price, changePercent: 0.5, currency: "USD", name: symbol, marketCap: 1e11,
});

function ctx(overrides: Partial<MarketContext> = {}): MarketContext {
  const spy = walk(300, 0.0004, 0.012, 7);
  const benchmarkReturns: number[] = [];
  for (let i = 1; i < spy.length; i++) benchmarkReturns.push((spy[i] - spy[i - 1]) / spy[i - 1]);

  return {
    baseCurrency: "USD",
    fx: { USD: 1 },
    quotes: new Map([
      ["AAA", QUOTE("AAA", 100)],
      ["BBB", QUOTE("BBB", 100)],
      ["NOHIST", QUOTE("NOHIST", 100)],
    ]),
    history: new Map([
      ["AAA", walk(300, 0.0006, 0.018, 3)],
      ["BBB", walk(300, 0.0001, 0.006, 11)],
      // NOHIST deliberately absent → neither observed nor proxied.
    ]),
    fundamentals: new Map(),
    benchmarkReturns,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

/** Matches the fixture shape used by tests/portfolio-universal.test.ts. */
function raw(o: Partial<RawHolding> & Pick<RawHolding, "id" | "assetClass">): RawHolding {
  return {
    symbol: null, name: o.id, currency: "USD", quantity: 1, unit: "shares",
    costBasis: 1000, acquiredAt: "2024-01-01", manualValue: null, manualValueAsOf: null, meta: {},
    ...o,
  };
}

function equity(id: string, symbol: string, quantity: number): RawHolding {
  return raw({ id, assetClass: "equity", symbol, quantity });
}

function riskOf(raws: RawHolding[], c: MarketContext) {
  const { holdings, totalValue } = normalizeHoldings(raws, c);
  const alloc = computeAllocation(holdings, totalValue);
  return { risk: computeRisk(holdings, totalValue, alloc, c), holdings, totalValue };
}

/* -------------------------------------------------------------------------- */
/* A local reference implementation of the loop under test.                    */
/* Parameterised on the two corrections so a test can ask for either.          */
/* -------------------------------------------------------------------------- */

function stddev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function referenceVol(
  parts: { weight: number; closes: number[]; dates?: string[] }[],
  opts: { renormalizeTo?: number; align: "date" | "tail" },
): number {
  const scaleFactor =
    opts.renormalizeTo == null
      ? 1
      : Math.min(3, Math.max(0, opts.renormalizeTo) / parts.reduce((s, p) => s + p.weight, 0));

  let series: number[][];
  if (opts.align === "date") {
    series = alignReturns(parts.map((p) => datedReturns(p.closes, p.dates))).series;
  } else {
    const raw = parts.map((p) => datedReturns(p.closes, p.dates).returns);
    const minLen = Math.min(...raw.map((r) => r.length));
    series = raw.map((r) => r.slice(-minLen));
  }

  const len = series[0].length;
  const port = new Array(len).fill(0);
  for (let k = 0; k < parts.length; k++) {
    const w = (parts[k].weight * scaleFactor) / 100;
    for (let i = 0; i < len; i++) port[i] += w * series[k][i];
  }
  return Math.round(stddev(port) * Math.sqrt(252) * 100 * 10) / 10;
}

/* -------------------------------------------------------------------------- */

describe("coverage-gap renormalization", () => {
  it("is a no-op when there is no gap: scale factor 1, vol unchanged", () => {
    // Two market-priced holdings, both with history → observed covers 100%.
    const c = ctx();
    const { risk, holdings } = riskOf(
      [equity("a", "AAA", 100), equity("b", "BBB", 100)],
      c,
    );

    expect(risk.coverage.observedPct).toBe(100);
    expect(risk.coverage.unmodelledPct).toBe(0);

    // origin/main's own stated invariant: "the scale factor is 1, and this is
    // byte-identical to before". Nothing asserted it, so nothing would notice a
    // renormalization that quietly fired on a fully-covered book.
    const expected = referenceVol(
      holdings.map((h) => ({ weight: h.weight, closes: c.history.get(h.symbol!)! })),
      { align: "date" }, // no renormalizeTo → scaleFactor 1
    );
    expect(risk.annualizedVolatility).toBe(expected);
  });

  it("raises volatility when a gap exists, instead of treating it as riskless", () => {
    // NOHIST is market-priced, has no series, and `equity` is not in
    // PROXY_VOLATILITY — so it lands in the unmodelled bucket: a real gap.
    const c = ctx();
    const { risk, holdings } = riskOf(
      [equity("a", "AAA", 100), equity("b", "BBB", 100), equity("gap", "NOHIST", 400)],
      c,
    );

    expect(risk.coverage.unmodelledPct).toBeGreaterThan(0);
    expect(risk.coverage.observedPct).toBeLessThan(100);

    const observedParts = holdings
      .filter((h) => c.history.has(h.symbol!))
      .map((h) => ({ weight: h.weight, closes: c.history.get(h.symbol!)! }));

    const withoutFix = referenceVol(observedParts, { align: "date" });
    const withFix = referenceVol(observedParts, { align: "date", renormalizeTo: 100 });

    // The whole point: the gap must cost something.
    expect(withFix).toBeGreaterThan(withoutFix);
    expect(risk.annualizedVolatility).toBe(withFix);
  });

  it("bounds the extrapolation at 3x and still reports the gap", () => {
    // One small measured holding beside a very large gap. Unbounded, the scale
    // factor would be ~100/4 = 25x — an overconfident number extrapolated from
    // almost nothing.
    const c = ctx();
    const { risk, holdings } = riskOf(
      [equity("a", "AAA", 4), equity("gap", "NOHIST", 960)],
      c,
    );

    const observed = holdings.filter((h) => c.history.has(h.symbol!));
    const observedWeight = observed.reduce((s, h) => s + h.weight, 0);
    expect(100 / observedWeight).toBeGreaterThan(3); // unbounded factor would exceed the cap

    const capped = referenceVol(
      observed.map((h) => ({ weight: h.weight, closes: c.history.get(h.symbol!)! })),
      { align: "date", renormalizeTo: 100 },
    );
    expect(risk.annualizedVolatility).toBe(capped);

    // Above the bound the gap is real and must stay visible rather than being
    // papered over by the extrapolation.
    expect(risk.coverage.unmodelledPct).toBeGreaterThan(90);
  });
});

describe("renormalization × date alignment (the composed path)", () => {
  it("renormalizes over the DATE-aligned series, not over the raw tails", () => {
    // The case neither branch covered: a coverage gap AND two different session
    // calendars. Crypto trades every day, the equity only on weekdays, so the
    // two series have materially different lengths over the same window.
    const equityCloses = walk(220, 0.0006, 0.02, 5);
    const cryptoCloses = walk(300, 0.001, 0.05, 23);

    const c = ctx({
      quotes: new Map([
        ["AAA", QUOTE("AAA", 100)],
        ["BTC-USD", QUOTE("BTC-USD", 60000)],
        ["NOHIST", QUOTE("NOHIST", 100)],
      ]),
      history: new Map([
        ["AAA", equityCloses],
        ["BTC-USD", cryptoCloses],
      ]),
      historyDates: new Map([
        ["AAA", weekdayDates(220)],
        ["BTC-USD", everyDayDates(300)],
      ]),
    });

    const { risk, holdings } = riskOf(
      [
        equity("eq", "AAA", 100),
        raw({ id: "btc", assetClass: "crypto", symbol: "BTC-USD", quantity: 1, unit: "coins" }),
        equity("gap", "NOHIST", 300),
      ],
      c,
    );

    expect(risk.coverage.unmodelledPct).toBeGreaterThan(0);

    const parts = holdings
      .filter((h) => c.history.has(h.symbol!))
      .map((h) => ({
        weight: h.weight,
        closes: c.history.get(h.symbol!)!,
        dates: c.historyDates!.get(h.symbol!)!,
      }));

    const dateAligned = referenceVol(parts, { align: "date", renormalizeTo: 100 });
    const tailAligned = referenceVol(parts, { align: "tail", renormalizeTo: 100 });

    // Both corrections are live: the engine matches renormalized-over-aligned.
    expect(risk.annualizedVolatility).toBe(dateAligned);

    // And the two alignments genuinely disagree here, so the assertion above has
    // teeth — a revert to tail alignment (keeping the renormalization) fails.
    expect(dateAligned).not.toBe(tailAligned);
  });
});
