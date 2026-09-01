import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { betaVsBenchmark } from "@/lib/valuation/beta";
import type { HistoryPoint } from "@/lib/types";

/**
 * Parity with engine/models/monte_carlo.py:compute_rolling_beta.
 *
 * The fixture (tests/fixtures/beta-parity.json) is a seeded synthetic series
 * (numpy default_rng(42), 320 days, true beta 1.3 + noise) and the expected
 * values below were produced by running the Python engine function on the
 * exact same series (2026-09-01). If either implementation drifts — window,
 * log returns, OLS, Blume–Vasicek shrinkage, clipping — this fails.
 */
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "beta-parity.json"), "utf8"),
) as { dates: string[]; stock: number[]; index: number[] };

const series = (closes: number[], dates: string[]): HistoryPoint[] =>
  dates.map((date, i) => ({ date, close: closes[i] }));

describe("betaVsBenchmark", () => {
  const stock = series(fixture.stock, fixture.dates);
  const index = series(fixture.index, fixture.dates);

  it("matches the Python engine on fully overlapping history", () => {
    // engine: compute_rolling_beta on the fixture as stored = 1.182714805504
    expect(betaVsBenchmark(stock, index)).toBeCloseTo(1.182714805504, 10);
  });

  it("matches the Python engine when the stock has calendar gaps", () => {
    // Stock missing every 7th day; inner-join alignment must match polars'.
    // engine: 1.151214123762
    const gapped = stock.filter((_, i) => i % 7 !== 0);
    expect(betaVsBenchmark(gapped, index)).toBeCloseTo(1.151214123762, 10);
  });

  it("refuses to regress on thin overlap instead of guessing", () => {
    // The engine returns 1.0 here; this port returns null so the caller can
    // label the fallback as a default rather than a measurement.
    expect(betaVsBenchmark(stock.slice(0, 40), index)).toBeNull();
    expect(betaVsBenchmark([], index)).toBeNull();
    expect(betaVsBenchmark(stock, [])).toBeNull();
  });

  it("clips runaway betas into the engine's [0.1, 4.0] band", () => {
    // A stock moving 10x the index every day: raw beta ≈ 10, shrunk ≈ 7 — clip to 4.
    const wild = fixture.dates.map((date, i) => ({
      date,
      close: 50 * Math.exp(10 * Math.log(fixture.index[i] / fixture.index[0])),
    }));
    expect(betaVsBenchmark(wild, index)).toBe(4.0);
  });

  it("returns null when the benchmark is flat (zero variance)", () => {
    const flat = fixture.dates.map((date) => ({ date, close: 100 }));
    expect(betaVsBenchmark(stock, flat)).toBeNull();
  });
});
