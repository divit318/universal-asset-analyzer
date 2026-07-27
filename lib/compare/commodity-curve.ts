/**
 * Fetches the futures curve for a single commodity, for the Compare page's
 * signature chart. `lib/screener/universes/commodity.ts` computes the same
 * curve for its `curveSlope`/`rollYield` metrics but only keeps the derived
 * scalar — this re-fetches the dated contracts for just the 2-5 commodities
 * a user is actively comparing, reusing its exported `datedContracts()`.
 */

import { getQuotes } from "../yahoo";
import { datedContracts, type CurvePoint } from "../screener/universes/commodity";
import { COMMODITIES } from "../assets/reference/commodities";

const CURVE_POINTS = 6;

export async function getCurvePoints(symbol: string): Promise<CurvePoint[]> {
  const ref = COMMODITIES.find((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  if (!ref) return [];

  const symbols = datedContracts(ref, CURVE_POINTS);
  const dated = await getQuotes(symbols).catch(() => []);
  const bySymbol = new Map(dated.map((d) => [d.symbol.toUpperCase(), d]));

  return symbols
    .map((sym, i) => {
      const d = bySymbol.get(sym.toUpperCase());
      if (!d || d.price == null || d.price <= 0) return null;
      return { symbol: sym, price: d.price, monthsOut: i + 1 };
    })
    .filter((p): p is CurvePoint => p != null);
}
