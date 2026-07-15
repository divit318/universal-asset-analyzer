/**
 * The live Treasury curve, as a function you can evaluate at any maturity.
 *
 * Used by the bond universe to compute each fund's spread. Reuses the same four
 * yield indices lib/macro-analysis.ts already tracks (^IRX 13-week, ^FVX 5-year,
 * ^TNX 10-year, ^TYX 30-year) — no new provider, and it means the screener's
 * risk-free curve is the same one the macro page shows.
 *
 * Between the four known points the curve is linearly interpolated; outside
 * them it's flat-extrapolated (a 40-year bond is priced off the 30-year, which
 * is close enough and much better than refusing to answer).
 */

import { getQuotes } from "../yahoo";
import { YIELD_CURVE_SYMBOLS } from "../macro-analysis";

/** (maturity in years, yield %) anchors. */
type Curve = [number, number][];

let cache: { curve: Curve; at: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

const TENORS: [keyof typeof YIELD_CURVE_SYMBOLS, number][] = [
  ["threeMonth", 0.25],
  ["fiveYear", 5],
  ["tenYear", 10],
  ["thirtyYear", 30],
];

/**
 * A function from maturity (years) to Treasury yield (%). Returns a function
 * that always answers `null` if the curve couldn't be fetched — a missing
 * benchmark must produce a missing spread, never a spread computed against zero.
 */
export async function getYieldCurve(): Promise<(maturityYears: number) => number | null> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const symbols = TENORS.map(([key]) => YIELD_CURVE_SYMBOLS[key]);
      const quotes = await getQuotes(symbols);
      const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.price]));

      const curve: Curve = TENORS.map(([key, years]): [number, number] | null => {
        const price = bySymbol.get(YIELD_CURVE_SYMBOLS[key].toUpperCase());
        // These indices quote the yield directly as their "price" (^TNX = 4.23
        // means a 4.23% ten-year). A zero or missing value is bad data, not a
        // zero-rate world.
        return price != null && price > 0 ? [years, price] : null;
      }).filter((p): p is [number, number] => p != null);

      if (curve.length >= 2) cache = { curve, at: Date.now() };
    } catch {
      // Fall through: a failed curve fetch degrades spread to null rather than
      // failing the whole bond universe build.
    }
  }

  const curve = cache?.curve;
  if (!curve || curve.length < 2) return () => null;

  return (maturityYears: number): number | null => {
    if (!Number.isFinite(maturityYears) || maturityYears <= 0) return null;

    // Flat-extrapolate outside the known tenors.
    if (maturityYears <= curve[0][0]) return curve[0][1];
    const last = curve[curve.length - 1];
    if (maturityYears >= last[0]) return last[1];

    for (let i = 0; i < curve.length - 1; i++) {
      const [x0, y0] = curve[i];
      const [x1, y1] = curve[i + 1];
      if (maturityYears >= x0 && maturityYears <= x1) {
        const t = (maturityYears - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return null;
  };
}
