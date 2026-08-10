/**
 * Build-time bake of the landing hero's data series. Fetches the NIFTY 50
 * index (^NSEI, daily closes, full available history) through the
 * yahoo-finance2 dependency the app already uses, runs the pure bake math
 * in app/landing/_components/ink/hero-data.ts, and writes the committed
 * JSON asset the hero field imports. The landing page itself NEVER
 * fetches: this script is the only network touch, and it runs here, at
 * the developer's desk, not in anyone's browser.
 *
 * Usage: npx tsx scripts/build-hero-series.ts
 *
 * Re-run and commit the output whenever the series should be refreshed;
 * the hero renders identically offline either way.
 */

import fs from "node:fs";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import { buildHeroSeries } from "../app/landing/_components/ink/hero-data";

const SYMBOL = "^NSEI";
const INDEX_NAME = "NIFTY 50";
const OUT = path.join(process.cwd(), "app", "landing", "_components", "ink", "hero-series.json");

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

interface Bar {
  date?: Date | string;
  close?: number | null;
  adjclose?: number | null;
}

async function main() {
  const chart = (await yahooFinance.chart(SYMBOL, {
    period1: new Date("2000-01-01"),
    interval: "1d",
  })) as { quotes?: Bar[] };
  const bars = (chart?.quotes ?? []).filter((q): q is Bar & { close: number } => typeof q.close === "number" && q.close > 0 && q.date != null);
  if (bars.length < 500) throw new Error(`only ${bars.length} usable bars for ${SYMBOL}; refusing to bake`);

  const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const asset = buildHeroSeries(
    bars.map((b) => b.close),
    {
      index: INDEX_NAME,
      symbol: SYMBOL,
      source: "yahoo-finance2 chart, daily closes",
      start: iso(bars[0].date!),
      end: iso(bars[bars.length - 1].date!),
    },
  );

  fs.writeFileSync(OUT, JSON.stringify(asset));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`baked ${asset.index} (${asset.symbol}) ${asset.start} to ${asset.end}`);
  console.log(`${bars.length} daily closes -> ${asset.points} samples, sigma ${asset.smoothSigma}, ${kb} KB`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
