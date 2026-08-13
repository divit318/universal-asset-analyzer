/**
 * Regenerate the Try It section's pre-loaded result by running the REAL
 * deterministic engines (lib/landing-demo.ts) and baking the output:
 *
 *   npx tsx scripts/landing-demo-fixture.ts [SYMBOL]
 *
 * Writes app/landing/_components/sections/demo-fixture.json. The fixture is
 * genuine engine output frozen at a visible as-of date. Never hand-edit it;
 * rerun this script instead. Default symbol: RELIANCE.NS.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeForDemo } from "../lib/landing-demo";

const symbol = process.argv[2] ?? "RELIANCE.NS";
const outPath = join(__dirname, "..", "app", "landing", "_components", "sections", "demo-fixture.json");

async function main() {
  const t0 = Date.now();
  const analysis = await analyzeForDemo(symbol, (s) => {
    console.log(`  stage ${s.id}: ${s.label} (${s.ms}ms)`);
  });
  const elapsedMs = Date.now() - t0;
  writeFileSync(outPath, JSON.stringify({ ...analysis, fixtureElapsedMs: elapsedMs }, null, 2) + "\n");
  console.log(`Baked ${symbol} (${analysis.recommendationLabel} ${analysis.composite}, ${elapsedMs}ms) → ${outPath}`);
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
