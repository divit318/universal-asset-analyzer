/**
 * Phase-4 live validation for the Indian screener.
 *
 * Builds the India universe (first run enriches ~500 NSE names — minutes),
 * then runs a matrix of realistic investor queries through the SAME pipeline
 * the /api/screener route uses, printing top results for manual inspection.
 *
 * Usage: npx tsx scripts/india-screener-harness.ts [--queries-only]
 */

import { runScreen } from "../lib/screener/pipeline";
import { getUniverseProvider } from "../lib/screener/universes";
import type { FilterValues } from "../lib/assets/types";

const fmtCr = (v: number | null | undefined) =>
  v == null ? "—" : `₹${Math.round(v / 1e7).toLocaleString("en-IN")} Cr`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
const x = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}x`);

interface Q { name: string; filters: FilterValues; expect?: (rows: { symbol: string; metrics: Record<string, number | null> }[]) => string | null }

const QUERIES: Q[] = [
  { name: "ROIC > 20%", filters: { roic: { kind: "range", min: 20, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.roic ?? -1) > 20) ? null : "row with roic ≤ 20 leaked" },
  { name: "Fwd P/E < 25", filters: { forwardPE: { kind: "range", min: null, max: 25 } },
    expect: (rows) => rows.every((r) => r.metrics.forwardPE != null && r.metrics.forwardPE < 25) ? null : "null/≥25 P/E leaked" },
  { name: "Mkt cap > ₹10,000 Cr", filters: { marketCap: { kind: "range", min: 1e11, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.marketCap ?? 0) > 1e11) ? null : "small cap leaked" },
  { name: "ROIC > 20 AND P/E < 25", filters: { roic: { kind: "range", min: 20, max: null }, forwardPE: { kind: "range", min: null, max: 25 } } },
  { name: "Dividend yield > 2%", filters: { dividendYield: { kind: "range", min: 2, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.dividendYield ?? -1) > 2) ? null : "null yield leaked" },
  { name: "Revenue growth > 15%", filters: { revenueGrowthYoY: { kind: "range", min: 15, max: null } } },
  { name: "EPS growth > 15%", filters: { epsGrowthYoY: { kind: "range", min: 15, max: null } } },
  { name: "D/E < 0.5", filters: { debtToEquity: { kind: "range", min: null, max: 0.5 } },
    expect: (rows) => rows.every((r) => r.metrics.debtToEquity != null && r.metrics.debtToEquity < 0.5) ? null : "null D/E leaked" },
  { name: "Large caps (> ₹1,00,000 Cr)", filters: { marketCap: { kind: "range", min: 1e12, max: null } } },
  { name: "Banks ROE > 15%", filters: { sector: { kind: "select", value: "Financial Services" }, roe: { kind: "range", min: 15, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.roe ?? -1) > 15) ? null : "null/low ROE leaked" },
  { name: "IT rev growth > 10%", filters: { sector: { kind: "select", value: "Technology" }, revenueGrowthYoY: { kind: "range", min: 10, max: null } } },
  { name: "Consumer ROIC > 20%", filters: { sector: { kind: "select", value: "Consumer Defensive" }, roic: { kind: "range", min: 20, max: null } } },
  // Phase 5: ownership + ROCE (screener.in extracts — coverage grows via trickle)
  { name: "Promoter > 50%", filters: { promoterHolding: { kind: "range", min: 50, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.promoterHolding ?? -1) > 50) ? null : "null promoter leaked" },
  { name: "FII > 15%", filters: { fiiHolding: { kind: "range", min: 15, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.fiiHolding ?? -1) > 15) ? null : "null FII leaked" },
  { name: "ROCE > 20% (screener.in)", filters: { roce: { kind: "range", min: 20, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.roce ?? -1) > 20) ? null : "null ROCE leaked" },
  // Phase 6: QoQ ownership deltas (percentage points)
  { name: "FII accumulation ≥ +0.5pp QoQ", filters: { fiiChangeQoQ: { kind: "range", min: 0.5, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.fiiChangeQoQ ?? -99) >= 0.5) ? null : "null FII delta leaked" },
  { name: "FII selling ≤ -1pp QoQ", filters: { fiiChangeQoQ: { kind: "range", min: null, max: -1 } },
    expect: (rows) => rows.every((r) => r.metrics.fiiChangeQoQ != null && r.metrics.fiiChangeQoQ <= -1) ? null : "null FII delta leaked" },
  { name: "Promoter increased ≥ +0.3pp QoQ", filters: { promoterChangeQoQ: { kind: "range", min: 0.3, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.promoterChangeQoQ ?? -99) >= 0.3) ? null : "null promoter delta leaked" },
  // Phase 7: multi-quarter trends
  { name: "FII streak ≥ 3 consecutive quarters", filters: { fiiStreak: { kind: "range", min: 3, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.fiiStreak ?? -99) >= 3) ? null : "null streak leaked" },
  { name: "FII selling streak ≤ -3", filters: { fiiStreak: { kind: "range", min: null, max: -3 } },
    expect: (rows) => rows.every((r) => r.metrics.fiiStreak != null && r.metrics.fiiStreak <= -3) ? null : "null streak leaked" },
  { name: "Promoter fell > 2pp over 4 qtrs", filters: { promoterChange4Q: { kind: "range", min: null, max: -2 } },
    expect: (rows) => rows.every((r) => r.metrics.promoterChange4Q != null && r.metrics.promoterChange4Q <= -2) ? null : "null 4Q change leaked" },
  { name: "DII accumulation ≥ 2 consecutive quarters", filters: { diiStreak: { kind: "range", min: 2, max: null } },
    expect: (rows) => rows.every((r) => (r.metrics.diiStreak ?? -99) >= 2) ? null : "null streak leaked" },
];

async function main() {
  console.log("Building/loading India universe…");
  const t0 = Date.now();
  const provider = getUniverseProvider("indiaEquity");
  let { status, candidates } = await provider.load();
  while (status.stage === "building") {
    await new Promise((r) => setTimeout(r, 10_000));
    ({ status, candidates } = await provider.load());
    console.log(`  …${status.ready}/${status.total} enriched`);
  }
  console.log(`universe: ${candidates.length} names, stage=${status.stage}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Coverage census — the honesty check on every filterable metric.
  const keys = ["marketCap", "forwardPE", "evToEbitda", "dividendYield", "revenueGrowthYoY", "epsGrowthYoY", "roic", "roe", "roce", "promoterHolding", "fiiHolding", "diiHolding", "operatingMargin", "debtToEquity", "fcfYield", "oneYearReturn"];
  console.log("\nMetric coverage:");
  for (const k of keys) {
    const n = candidates.filter((c) => c.metrics[k] != null).length;
    console.log(`  ${k.padEnd(18)} ${n}/${candidates.length} (${Math.round((n / candidates.length) * 100)}%)`);
  }

  // Duplicate check: one row per base ticker.
  const bases = candidates.map((c) => c.symbol.replace(/\.(NS|BO)$/, ""));
  const dupes = bases.filter((b, i) => bases.indexOf(b) !== i);
  console.log(`\nduplicates: ${dupes.length ? dupes.join(",") : "none"}; non-.NS symbols: ${candidates.filter((c) => !c.symbol.endsWith(".NS")).length}`);

  for (const query of QUERIES) {
    const res = await runScreen({ assetClass: "indiaEquity", filters: query.filters, size: 5, offset: 0 } as Parameters<typeof runScreen>[0]);
    const top = res.rows.map((r) => `${r.symbol.replace(".NS", "")}(${pct(r.metrics.roic as number | null)} roic, ${x(r.metrics.forwardPE as number | null)} pe, ${fmtCr(r.metrics.marketCap as number | null)})`).join("; ");
    const verdict = query.expect?.(res.rows as never) ?? null;
    console.log(`\n▸ ${query.name}: ${res.total} matches ${verdict ? `❌ ${verdict}` : "✓"}`);
    console.log(`   ${top || "(no rows)"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
