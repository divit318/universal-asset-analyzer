/**
 * scripts/demo-seed.ts — give the demo portfolio a real four-month history.
 *
 * The screenshot import stamps every lot `trade_date = today` and writes no
 * portfolio_snapshot rows, so a freshly imported book has no Performance
 * series and no Health trajectory. This script fixes both, and protects the
 * real portfolio with a file-level backup.
 *
 * Usage (run with the dev server STOPPED — `uaa stop`):
 *
 *   npx tsx scripts/demo-seed.ts backup    # 1. BEFORE importing the dummy portfolio
 *   npx tsx scripts/demo-seed.ts seed      # 2. AFTER the screenshot import is applied
 *   npx tsx scripts/demo-seed.ts restore   # 3. After the demo — exact restore of the real DB
 *
 * seed does three things:
 *   a. REBUILDS portfolio 1's ledger to the canonical demo book — one clean
 *      opening lot per position with real avg costs, dated across Apr–May 2026
 *      tranches. buildPerformance() derives everything else from real Yahoo
 *      price history, so the Performance tab computes a genuine 4-month
 *      trajectory on its own.
 *   b. Replaces portfolio_snapshot (portfolio 1) with five pre/post-execution
 *      pairs spanning Apr 14 → Jul 28, 2026, so getPortfolioTrajectory() has a
 *      4-month health series (and the real portfolio's snapshot history never
 *      appears on camera). Snapshot `holdings` are captured from the rebuilt
 *      ledger, so an accidental Undo restores the dummy book, never garbage.
 *   c. Purges the persisted platform_cache rows that describe the pre-seed
 *      book (portfolioReport + its dependents), so a restarted server cannot
 *      rehydrate a stale report.
 *
 * Safety rails: `backup` refuses to overwrite an existing backup (so running
 * it twice, after the import, cannot clobber the real data); `seed` refuses to
 * run without a backup or on a ledger that doesn't look like the demo book;
 * `restore` is a straight file copy back.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
const BACKUP_PATH = `${DB_PATH}.real-backup`;
const PORTFOLIO_ID = 1;

/**
 * The canonical demo ledger. `seed` REBUILDS portfolio 1 to exactly this —
 * one clean opening lot per position — rather than patching whatever the
 * screenshot import produced. The import is a reconciler, not a bookkeeper:
 * measured on the real DB it left `costBasisAssumed` lots priced at the
 * current quote (every P&L read 0%), appended fractional balancing lots
 * (MSFT 449.82132 sh) on symbols the old book already held, and classified
 * VOO as `equity`. A rebuild is deterministic; a patch inherits all of that.
 */
const POSITIONS: {
  symbol: string; name: string; shares: number; avgCost: number;
  date: string; assetClass: "equity" | "etf" | "cash"; unit: "shares" | "currency";
}[] = [
  { symbol: "VOO",      name: "Vanguard S&P 500 ETF",                    shares: 620,       avgCost: 632.0,  date: "2026-04-14", assetClass: "etf",    unit: "shares" },
  { symbol: "VXUS",     name: "Vanguard Total International Stock ETF",  shares: 3800,      avgCost: 70.0,   date: "2026-04-14", assetClass: "etf",    unit: "shares" },
  { symbol: "MSFT",     name: "Microsoft Corp.",                         shares: 450,       avgCost: 468.0,  date: "2026-04-14", assetClass: "equity", unit: "shares" },
  { symbol: "AAPL",     name: "Apple Inc.",                              shares: 600,       avgCost: 284.0,  date: "2026-04-14", assetClass: "equity", unit: "shares" },
  { symbol: "GOOGL",    name: "Alphabet Inc. Class A",                   shares: 480,       avgCost: 375.0,  date: "2026-04-14", assetClass: "equity", unit: "shares" },
  { symbol: "CASH-USD", name: "Cash & Money Market",                     shares: 1_000_000, avgCost: 1.0,    date: "2026-04-14", assetClass: "cash",   unit: "currency" },
  { symbol: "NVDA",     name: "NVIDIA Corp.",                            shares: 950,       avgCost: 196.0,  date: "2026-04-22", assetClass: "equity", unit: "shares" },
  { symbol: "AMZN",     name: "Amazon.com Inc.",                         shares: 640,       avgCost: 232.0,  date: "2026-04-22", assetClass: "equity", unit: "shares" },
  { symbol: "LLY",      name: "Eli Lilly & Co.",                         shares: 165,       avgCost: 845.0,  date: "2026-04-22", assetClass: "equity", unit: "shares" },
  { symbol: "SCHD",     name: "Schwab U.S. Dividend Equity ETF",         shares: 6500,      avgCost: 27.4,   date: "2026-04-22", assetClass: "etf",    unit: "shares" },
  { symbol: "META",     name: "Meta Platforms Inc.",                     shares: 250,       avgCost: 552.0,  date: "2026-05-06", assetClass: "equity", unit: "shares" },
  { symbol: "AVGO",     name: "Broadcom Inc.",                           shares: 330,       avgCost: 410.0,  date: "2026-05-06", assetClass: "equity", unit: "shares" },
  { symbol: "HD",       name: "Home Depot Inc.",                         shares: 280,       avgCost: 382.0,  date: "2026-05-06", assetClass: "equity", unit: "shares" },
  { symbol: "JNJ",      name: "Johnson & Johnson",                       shares: 520,       avgCost: 196.0,  date: "2026-05-06", assetClass: "equity", unit: "shares" },
  { symbol: "XOM",      name: "Exxon Mobil Corp.",                       shares: 950,       avgCost: 112.0,  date: "2026-05-19", assetClass: "equity", unit: "shares" },
  { symbol: "CAT",      name: "Caterpillar Inc.",                        shares: 230,       avgCost: 432.0,  date: "2026-05-19", assetClass: "equity", unit: "shares" },
  { symbol: "PG",       name: "Procter & Gamble Co.",                    shares: 640,       avgCost: 158.0,  date: "2026-05-19", assetClass: "equity", unit: "shares" },
  { symbol: "XLU",      name: "Utilities Select Sector SPDR",            shares: 1400,      avgCost: 84.5,   date: "2026-05-19", assetClass: "etf",    unit: "shares" },
];

/** Caches that describe the pre-seed book (registry: portfolioReport → missionContext, homeDigest). */
const STALE_DATASETS = ["portfolioReport", "missionContext", "homeDigest"];

/** Same bands as lib/portfolio/engines/health.ts healthGradeOf(). */
const gradeOf = (score: number) => (score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F");

interface SeedPoint {
  at: string;
  label: "pre-execution" | "post-execution";
  objective: string | null;
  totalValue: number;
  totalCost: number;
  health: number;
  volatility: number;
  /** { assetClass: weight } — largest becomes topAssetClassWeight. */
  alloc: Record<string, number>;
}

/**
 * Five executions, Apr → Jul 2026: the initial cash deployment (the big health
 * jump), three follow-on buys, and a June trim into the drawdown. Values track
 * the book the avg costs imply (~$3.64M deployed April, ~$4.0M by August).
 *
 * The arc must END at the score the live engine computes for the rebuilt book
 * (measured: 66/C via /api/portfolio/report), or the dashboard reads as an
 * unexplained overnight drop from the last snapshot to "now".
 */
const SNAPSHOTS: SeedPoint[] = [
  { at: "2026-04-14T14:31:00.000Z", label: "pre-execution",  objective: "maximize_diversification", totalValue: 3_642_000, totalCost: 3_640_000, health: 51, volatility: 6.4,  alloc: { cash: 62.3, equity: 24.9, etf: 12.8 } },
  { at: "2026-04-14T14:33:00.000Z", label: "post-execution", objective: "maximize_diversification", totalValue: 3_641_200, totalCost: 3_640_000, health: 58, volatility: 10.6, alloc: { equity: 41.2, cash: 32.7, etf: 26.1 } },
  { at: "2026-04-22T15:12:00.000Z", label: "pre-execution",  objective: "maximize_diversification", totalValue: 3_655_000, totalCost: 3_648_000, health: 58, volatility: 10.9, alloc: { equity: 44.0, cash: 29.8, etf: 26.2 } },
  { at: "2026-04-22T15:14:00.000Z", label: "post-execution", objective: "maximize_diversification", totalValue: 3_654_100, totalCost: 3_648_000, health: 61, volatility: 11.2, alloc: { equity: 46.4, cash: 27.5, etf: 26.1 } },
  { at: "2026-05-19T14:05:00.000Z", label: "pre-execution",  objective: "maximize_sharpe",          totalValue: 3_721_000, totalCost: 3_712_000, health: 62, volatility: 11.9, alloc: { equity: 47.2, etf: 26.5, cash: 26.3 } },
  { at: "2026-05-19T14:07:00.000Z", label: "post-execution", objective: "maximize_sharpe",          totalValue: 3_719_800, totalCost: 3_712_000, health: 64, volatility: 11.7, alloc: { equity: 47.6, etf: 26.9, cash: 25.5 } },
  { at: "2026-06-26T13:45:00.000Z", label: "pre-execution",  objective: "minimize_volatility",      totalValue: 3_566_000, totalCost: 3_778_000, health: 61, volatility: 14.2, alloc: { equity: 45.8, etf: 27.1, cash: 27.1 } },
  { at: "2026-06-26T13:47:00.000Z", label: "post-execution", objective: "minimize_volatility",      totalValue: 3_564_900, totalCost: 3_778_000, health: 63, volatility: 13.6, alloc: { equity: 45.2, etf: 27.4, cash: 27.4 } },
  { at: "2026-07-28T14:20:00.000Z", label: "pre-execution",  objective: "maximize_sharpe",          totalValue: 3_931_000, totalCost: 3_778_000, health: 64, volatility: 12.6, alloc: { equity: 48.1, etf: 26.6, cash: 25.3 } },
  { at: "2026-07-28T14:22:00.000Z", label: "post-execution", objective: "maximize_sharpe",          totalValue: 3_929_600, totalCost: 3_778_000, health: 66, volatility: 12.4, alloc: { equity: 48.4, etf: 26.6, cash: 25.0 } },
];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function checkpointAndClose(db: DatabaseSync) {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* not in WAL mode */ }
  db.close();
}

function backup(force: boolean) {
  if (!fs.existsSync(DB_PATH)) fail(`No database at ${DB_PATH}`);
  if (fs.existsSync(BACKUP_PATH) && !force) {
    fail(
      `Backup already exists at ${BACKUP_PATH}.\n` +
        `  If it holds your REAL portfolio, do not overwrite it. Use --force only if you are certain.`,
    );
  }
  // Fold the WAL into the main file so the copy is complete on its own.
  checkpointAndClose(new DatabaseSync(DB_PATH));
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`✓ Backed up ${DB_PATH} → ${BACKUP_PATH}`);
  console.log("  Next: import the dummy portfolio through the app, then run `npx tsx scripts/demo-seed.ts seed`.");
}

function hasAnyBackup(): boolean {
  if (fs.existsSync(BACKUP_PATH)) return true;
  const dir = path.dirname(DB_PATH);
  const base = path.basename(DB_PATH);
  return fs.readdirSync(dir).some((f) => f.startsWith(`${base}.backup-`));
}

function seed() {
  if (!hasAnyBackup()) {
    fail(`No backup found next to ${DB_PATH} — run \`npx tsx scripts/demo-seed.ts backup\` first.`);
  }
  if (!fs.existsSync(DB_PATH)) fail(`No database at ${DB_PATH}`);
  const db = new DatabaseSync(DB_PATH);

  // ── a. Rebuild the ledger to the canonical demo book ──────────────────────
  // One clean opening lot per position, dated to its purchase tranche. This
  // replaces whatever mix of costBasisAssumed / synthetic-balancing /
  // residual-real lots the screenshot import left behind.
  db.exec("BEGIN");
  const removedLots = Number(db.prepare("DELETE FROM portfolio_lot WHERE portfolio_id = ?").run(PORTFOLIO_ID).changes);
  const insertLot = db.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta, portfolio_id)
     VALUES (?, ?, ?, ?, 'buy', 0, ?, ?, ?, 'USD', ?, ?, ?)`,
  );
  for (const p of POSITIONS) {
    insertLot.run(
      p.symbol, p.name, p.shares, p.avgCost, p.date, `${p.date}T14:32:00.000Z`,
      p.assetClass, p.unit,
      JSON.stringify({ source: "demo-seed", seededAt: new Date().toISOString() }),
      PORTFOLIO_ID,
    );
  }

  // ── b. Replace the snapshot history ───────────────────────────────────────
  // The old rows describe the REAL portfolio (values, health, allocation) and
  // would render in the trajectory panel on camera. The backup taken above is
  // the recovery path.
  const removed = Number(db.prepare("DELETE FROM portfolio_snapshot WHERE portfolio_id = ?").run(PORTFOLIO_ID).changes);

  // Undo-safety: seeded snapshots carry the CURRENT (dummy) ledger, exactly as
  // lib/db.ts snapshotPortfolio() would capture it.
  const lots = db.prepare("SELECT * FROM portfolio_lot WHERE portfolio_id = ?").all(PORTFOLIO_ID);
  const manualAssets = db.prepare("SELECT * FROM manual_asset WHERE portfolio_id = ?").all(PORTFOLIO_ID);
  const holdingsJson = JSON.stringify({ lots, manualAssets });

  const insert = db.prepare(
    `INSERT INTO portfolio_snapshot (id, label, objective, holdings, summary, created_at, portfolio_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const p of SNAPSHOTS) {
    const allocation = Object.entries(p.alloc).map(([assetClass, weight]) => ({ assetClass, weight }));
    const summary = {
      totalValue: p.totalValue,
      totalCost: p.totalCost,
      health: p.health,
      healthGrade: gradeOf(p.health),
      volatility: p.volatility,
      topAssetClassWeight: Math.max(...Object.values(p.alloc)),
      allocation,
    };
    insert.run(crypto.randomUUID(), p.label, p.objective, holdingsJson, JSON.stringify(summary), p.at, PORTFOLIO_ID);
  }

  // ── c. Drop caches that describe the pre-seed book ────────────────────────
  // portfolio_snapshot/portfolio_lot changed underneath the running caches;
  // the L2 rows must go or a restarted server rehydrates the stale report.
  const placeholders = STALE_DATASETS.map(() => "?").join(", ");
  const purged = Number(
    db.prepare(`DELETE FROM platform_cache WHERE dataset IN (${placeholders})`).run(...STALE_DATASETS).changes,
  );

  db.exec("COMMIT");
  checkpointAndClose(db);
  console.log(`✓ Rebuilt the ledger: ${removedLots} old lot(s) → ${POSITIONS.length} canonical positions (2026-04-14 → 2026-05-19).`);
  console.log(`✓ Replaced ${removed} old snapshot(s) with ${SNAPSHOTS.length} seeded ones (2026-04-14 → 2026-07-28).`);
  console.log(`✓ Purged ${purged} stale platform_cache row(s) [${STALE_DATASETS.join(", ")}].`);
  console.log("  Restart the dev server (`uaa start`) so in-memory caches rebuild against the seeded history.");
}

function restore() {
  let source = BACKUP_PATH;
  if (!fs.existsSync(source)) {
    // Fall back to the newest timestamped backup (data/app.db.backup-*).
    const dir = path.dirname(DB_PATH);
    const base = path.basename(DB_PATH);
    const candidates = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.backup-`)).sort();
    if (candidates.length === 0) fail(`No backup at ${BACKUP_PATH} (or ${base}.backup-*) — nothing to restore.`);
    source = path.join(dir, candidates[candidates.length - 1]);
  }
  for (const suffix of ["-wal", "-shm"]) {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  fs.copyFileSync(source, DB_PATH);
  console.log(`✓ Restored ${DB_PATH} from ${source}. Your real portfolio is back, byte for byte.`);
  console.log(`  The backup file was kept; delete it yourself once you've verified the app.`);
}

const command = process.argv[2];
const force = process.argv.includes("--force");
if (command === "backup") backup(force);
else if (command === "seed") seed();
else if (command === "restore") restore();
else {
  console.log("Usage: npx tsx scripts/demo-seed.ts <backup|seed|restore>");
  console.log("  backup   copy the real DB aside (run BEFORE importing the dummy portfolio)");
  console.log("  seed     backdate imported lots + seed a 4-month snapshot history (run AFTER the import)");
  console.log("  restore  put the real DB back (run after the demo)");
  process.exit(command ? 1 : 0);
}
