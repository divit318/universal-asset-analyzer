/**
 * TEMP (demo prep): dump actual daily closes (May 1 - today) for the symbols in
 * the planned demo ledger, as CSV, so every seeded lot uses the real close.
 * Run: npx tsx scripts/demo-closes.ts > /tmp/demo-closes.csv
 */
import { getHistory } from "../lib/yahoo";

const SYMBOLS = ["VOO", "IEF", "MSFT", "GOOGL", "LLY", "V", "COIN", "ABNB", "DASH", "AMZN", "AMD", "XOM", "ABBV", "SPY", "RGA", "NKE"];
const START = "2026-05-01";

async function main() {
  const bySym = new Map<string, Map<string, number>>();
  const dates = new Set<string>();
  for (const sym of SYMBOLS) {
    const h = await getHistory(sym, 400);
    const m = new Map<string, number>();
    for (const p of h) {
      const c = p.adjClose ?? p.close;
      const d = p.date.slice(0, 10);
      if (c > 0 && d >= START) { m.set(d, c); dates.add(d); }
    }
    bySym.set(sym, m);
  }
  const sorted = [...dates].sort();
  console.log("date," + SYMBOLS.join(","));
  for (const d of sorted) {
    console.log(d + "," + SYMBOLS.map((s) => bySym.get(s)?.get(d)?.toFixed(2) ?? "").join(","));
  }
}

main();
