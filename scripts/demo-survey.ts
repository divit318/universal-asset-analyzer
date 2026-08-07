/**
 * TEMP (demo prep): survey real price history for candidate demo symbols so the
 * seeded 3-month journey uses actual closes and actual winners/losers.
 * Run: npx tsx scripts/demo-survey.ts
 */
import { getHistory } from "../lib/yahoo";

const SYMBOLS = [
  "SPY", "VOO", "QQQ", "IEF", "TLT", "GLD",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "AMD", "TSM", "CRM",
  "UNH", "LLY", "JNJ", "ABBV",
  "JPM", "V", "MA", "BAC", "RGA",
  "XOM", "CVX", "COP",
  "CAT", "DE", "HON", "GE",
  "NEE", "DUK", "PG", "KO", "COST", "WMT", "NKE", "SBUX",
  "ABNB", "DASH", "UBER", "SHOP", "PLTR", "SNOW", "CRWD",
  "RDDT", "GTLB", "COIN", "CART", "DBX",
];

const START = "2026-05-01";

async function main() {
  const rows: { sym: string; first: string; last: string; startPx: number; endPx: number; retPct: number; maxDDPct: number }[] = [];
  for (const sym of SYMBOLS) {
    try {
      const h = await getHistory(sym, 400);
      const pts = h
        .map((p) => ({ d: p.date.slice(0, 10), c: p.adjClose ?? p.close }))
        .filter((p) => p.c > 0 && p.d >= START);
      if (pts.length < 10) { console.log(`${sym}: no data`); continue; }
      const startPx = pts[0].c;
      const endPx = pts[pts.length - 1].c;
      let peak = -Infinity, maxDD = 0;
      for (const p of pts) {
        peak = Math.max(peak, p.c);
        maxDD = Math.min(maxDD, (p.c - peak) / peak);
      }
      rows.push({
        sym, first: pts[0].d, last: pts[pts.length - 1].d,
        startPx, endPx, retPct: ((endPx / startPx) - 1) * 100, maxDDPct: maxDD * 100,
      });
    } catch (e) {
      console.log(`${sym}: ERROR ${e instanceof Error ? e.message : e}`);
    }
  }
  rows.sort((a, b) => b.retPct - a.retPct);
  console.log("sym".padEnd(6), "first".padEnd(11), "last".padEnd(11), "start".padStart(9), "end".padStart(9), "ret%".padStart(8), "maxDD%".padStart(8));
  for (const r of rows) {
    console.log(
      r.sym.padEnd(6), r.first.padEnd(11), r.last.padEnd(11),
      r.startPx.toFixed(2).padStart(9), r.endPx.toFixed(2).padStart(9),
      r.retPct.toFixed(1).padStart(8), r.maxDDPct.toFixed(1).padStart(8),
    );
  }
}

main();
