/**
 * One-off backfill: replace symbol-as-name rows in the watchlist and
 * portfolio_lot tables with the instrument's real display name.
 *
 * Why these rows exist: until 2026-08, /api/watchlist and /api/portfolio
 * defaulted a missing `name` to the raw symbol — which for an Indian mutual
 * fund is an opaque Morningstar ID ("0P0001BA9B.BO") that then surfaced as
 * the "name" on every read. The write paths now resolve real names
 * (lib/yahoo.ts resolveDisplayName); this script repairs what was stored
 * before that fix.
 *
 * Usage:
 *   npx tsx scripts/backfill-display-names.ts            # dry run (default): report, change nothing
 *   npx tsx scripts/backfill-display-names.ts --apply    # write the fixes
 *
 * Only rows whose stored name is missing or equal to the symbol are touched —
 * a name a user typed themselves is never overwritten. Idempotent.
 */

import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import { getQuote } from "../lib/yahoo";

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");

interface Target {
  table: string;
  symbol: string;
  name: string | null;
}

async function main() {
  const db = new DatabaseSync(DB_PATH);

  const targets: Target[] = [];
  for (const table of ["watchlist", "portfolio_lot"]) {
    const rows = db
      .prepare(`SELECT DISTINCT symbol, name FROM ${table}`)
      .all() as unknown as { symbol: string; name: string | null }[];
    for (const r of rows) {
      const bad = !r.name || r.name.trim() === "" || r.name.trim().toUpperCase() === r.symbol.trim().toUpperCase();
      if (bad) targets.push({ table, symbol: r.symbol, name: r.name });
    }
  }

  if (targets.length === 0) {
    console.log("Nothing to backfill — every stored name already differs from its symbol.");
    db.close();
    return;
  }

  console.log(`${targets.length} row group(s) with symbol-as-name${APPLY ? "" : " (dry run — pass --apply to write)"}:\n`);

  let fixed = 0;
  for (const t of targets) {
    let resolved: string | null = null;
    try {
      const q = await getQuote(t.symbol);
      if (q.name && q.name !== q.symbol) resolved = q.name;
    } catch {
      /* provider miss — leave the row alone rather than writing a guess */
    }

    if (!resolved) {
      console.log(`  ${t.table}  ${t.symbol}  →  (no name resolvable — skipped)`);
      continue;
    }

    console.log(`  ${t.table}  ${t.symbol}  →  "${resolved}"`);
    if (APPLY) {
      db.prepare(`UPDATE ${t.table} SET name = ? WHERE symbol = ?`).run(resolved, t.symbol);
      fixed++;
    }
  }

  console.log(APPLY ? `\nDone — ${fixed} updated.` : "\nDry run complete — nothing written.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
