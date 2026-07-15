import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ChartDrawingRecord, PortfolioPosition, PortfolioLot, ResearchNote, StockFundamentals, WatchlistItem, SectorRotationEntry, TimelineEvent, Notification, Decision, DecisionAction, DecisionHorizon, ManualAsset, ManualAssetCategory } from "./types";
import { aggregateOpenPositions } from "./portfolio-lots";
import type { AlertEvent } from "./alerts";

let db: DatabaseSync | null = null;

/** Lazily open the SQLite database so importing this module has no side effects. */
function getDb(): DatabaseSync {
  if (db) return db;

  const file =
    process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
  mkdirSync(path.dirname(file), { recursive: true });

  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      symbol          TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      added_at        TEXT NOT NULL,
      target_price    REAL,
      alert_pct_drop  REAL,
      notes           TEXT
    );
    CREATE TABLE IF NOT EXISTS fundamentals_cache (
      symbol     TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_cache (
      cache_key  TEXT PRIMARY KEY,
      dataset    TEXT NOT NULL,
      symbol     TEXT,
      value      TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      source     TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_platform_cache_symbol  ON platform_cache(symbol);
    CREATE INDEX IF NOT EXISTS idx_platform_cache_dataset ON platform_cache(dataset);
    CREATE TABLE IF NOT EXISTS real_estate_lookup_cache (
      address_key TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio (
      symbol   TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      shares   REAL NOT NULL,
      avg_cost REAL NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_lot (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT NOT NULL,
      name       TEXT NOT NULL,
      shares     REAL NOT NULL,
      price      REAL NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'buy',
      fees       REAL NOT NULL DEFAULT 0,
      trade_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_lot_symbol
      ON portfolio_lot (symbol);
    CREATE TABLE IF NOT EXISTS research_session (
      id         TEXT PRIMARY KEY,
      symbol     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_message (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      meta       TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_message_session
      ON research_message (session_id, id);
    CREATE TABLE IF NOT EXISTS research_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_notes_symbol
      ON research_notes (symbol);
    CREATE TABLE IF NOT EXISTS scanner_cache (
      cache_key  TEXT PRIMARY KEY,
      result     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scanner_snapshot (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      result       TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sector_rotation_snapshot (
      as_of      TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline_event (
      id         TEXT PRIMARY KEY,
      symbol     TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_event_symbol
      ON timeline_event (symbol, timestamp DESC);
    CREATE TABLE IF NOT EXISTS notification (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key  TEXT NOT NULL,
      symbol     TEXT,
      kind       TEXT NOT NULL,
      severity   TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_created
      ON notification (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_dedup
      ON notification (dedup_key, created_at);
    CREATE TABLE IF NOT EXISTS decision (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol       TEXT NOT NULL,
      name         TEXT,
      action       TEXT NOT NULL,
      conviction   INTEGER NOT NULL,
      thesis       TEXT,
      price_at     REAL,
      currency     TEXT,
      target_price REAL,
      horizon      TEXT,
      fit_score    REAL,
      fit_tier     TEXT,
      status       TEXT NOT NULL DEFAULT 'open',
      close_price  REAL,
      closed_at    TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_symbol ON decision (symbol);
    CREATE INDEX IF NOT EXISTS idx_decision_created ON decision (created_at DESC);
    CREATE TABLE IF NOT EXISTS chart_drawing (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT NOT NULL,
      timeframe  TEXT NOT NULL,
      type       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chart_drawing_scope
      ON chart_drawing (symbol, timeframe);
    CREATE TABLE IF NOT EXISTS manual_asset (
      id                  TEXT PRIMARY KEY,
      category            TEXT NOT NULL,
      name                TEXT NOT NULL,
      acquisition_date    TEXT NOT NULL,
      acquisition_cost    REAL NOT NULL,
      current_value       REAL,
      current_value_as_of TEXT,
      notes               TEXT,
      details             TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manual_asset_category ON manual_asset (category);

    CREATE TABLE IF NOT EXISTS portfolio_snapshot (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      objective  TEXT,
      holdings   TEXT NOT NULL,
      summary    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshot_created ON portfolio_snapshot (created_at DESC);
    CREATE TABLE IF NOT EXISTS saved_screen (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      template_id TEXT,
      -- FilterValues, JSON-serialized. Stored opaquely and re-validated against
      -- the Asset Registry on load (lib/screener/filter-engine.ts#parseFilters),
      -- so a screen saved against a metric that later loses its data provider
      -- degrades to "that filter is gone" rather than to a broken screen.
      filters     TEXT NOT NULL,
      sort_key    TEXT NOT NULL,
      sort_dir    TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_screen_class ON saved_screen (asset_class);

    -- "Continue where you left off". One row per (kind, ref) — revisiting a
    -- symbol bumps its timestamp rather than appending, so the list stays a set
    -- of *places* the user has been, not a raw event log that fills with twenty
    -- consecutive AAPL views.
    CREATE TABLE IF NOT EXISTS activity (
      kind  TEXT NOT NULL,
      ref   TEXT NOT NULL,
      label TEXT NOT NULL,
      href  TEXT NOT NULL,
      at    TEXT NOT NULL,
      PRIMARY KEY (kind, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at DESC);
  `);
  // Migrate existing watchlist rows: add new columns if the DB predates them
  for (const col of ["target_price REAL", "alert_pct_drop REAL", "notes TEXT"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // Universal Portfolio: a lot used to be implicitly "shares of a US equity, in
  // USD". These columns make that explicit so the ledger can also hold a bond
  // fund, 1.4 BTC, or $50k of cash.
  //
  // The DEFAULTs are what preserve backward compatibility: every pre-existing row
  // is, in fact, an equity position in USD priced per share, so the defaults are
  // the identity mapping and no existing holding's value changes. See
  // tests/portfolio-migration.test.ts, which asserts exactly that.
  for (const col of [
    "asset_class TEXT NOT NULL DEFAULT 'equity'",
    "currency TEXT NOT NULL DEFAULT 'USD'",
    "unit TEXT NOT NULL DEFAULT 'shares'",
    "meta TEXT",
  ]) {
    try { db.exec(`ALTER TABLE portfolio_lot ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // One-time: seed the lot ledger from the legacy aggregate `portfolio` table so
  // existing holdings survive the move to a lot-backed model. Each legacy row
  // becomes one opening buy lot; aggregating it reproduces the same shares/avg
  // cost exactly. Runs only when the ledger is empty but legacy rows exist.
  const lotCount = (db.prepare("SELECT COUNT(*) AS n FROM portfolio_lot").get() as { n: number }).n;
  if (lotCount === 0) {
    const legacy = db
      .prepare("SELECT symbol, name, shares, avg_cost, added_at FROM portfolio")
      .all() as unknown as PortfolioRow[];
    const insert = db.prepare(
      `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at)
       VALUES (?, ?, ?, ?, 'buy', 0, ?, ?)`,
    );
    for (const r of legacy) {
      insert.run(r.symbol, r.name, r.shares, r.avg_cost, r.added_at, r.added_at);
    }
  }
  return db;
}

interface WatchlistRow {
  symbol: string;
  name: string;
  added_at: string;
  target_price: number | null;
  alert_pct_drop: number | null;
  notes: string | null;
}

export function listWatchlist(): WatchlistItem[] {
  const rows = getDb()
    .prepare("SELECT symbol, name, added_at, target_price, alert_pct_drop, notes FROM watchlist ORDER BY added_at DESC")
    .all() as unknown as WatchlistRow[];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    addedAt: r.added_at,
    targetPrice: r.target_price ?? null,
    alertPctDrop: r.alert_pct_drop ?? null,
    notes: r.notes ?? null,
  }));
}

export function addToWatchlist(symbol: string, name: string): WatchlistItem {
  const item: WatchlistItem = {
    symbol: symbol.toUpperCase(),
    name,
    addedAt: new Date().toISOString(),
    targetPrice: null,
    alertPctDrop: null,
    notes: null,
  };
  getDb()
    .prepare(
      `INSERT INTO watchlist (symbol, name, added_at) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET name = excluded.name`,
    )
    .run(item.symbol, item.name, item.addedAt);
  return item;
}

export function updateWatchlistItem(
  symbol: string,
  patch: { targetPrice?: number | null; alertPctDrop?: number | null; notes?: string | null },
): void {
  const db = getDb();
  if ("targetPrice" in patch) {
    db.prepare("UPDATE watchlist SET target_price = ? WHERE symbol = ?")
      .run(patch.targetPrice ?? null, symbol.toUpperCase());
  }
  if ("alertPctDrop" in patch) {
    db.prepare("UPDATE watchlist SET alert_pct_drop = ? WHERE symbol = ?")
      .run(patch.alertPctDrop ?? null, symbol.toUpperCase());
  }
  if ("notes" in patch) {
    db.prepare("UPDATE watchlist SET notes = ? WHERE symbol = ?")
      .run(patch.notes ?? null, symbol.toUpperCase());
  }
}

export function removeFromWatchlist(symbol: string): void {
  getDb()
    .prepare("DELETE FROM watchlist WHERE symbol = ?")
    .run(symbol.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Research notes (cross-stock AI memory)                                     */
/* -------------------------------------------------------------------------- */

interface NoteRow {
  id: number;
  symbol: string;
  content: string;
  created_at: string;
}

export function listNotes(symbol: string): ResearchNote[] {
  const rows = getDb()
    .prepare("SELECT id, symbol, content, created_at FROM research_notes WHERE symbol = ? ORDER BY id DESC")
    .all(symbol.toUpperCase()) as unknown as NoteRow[];
  return rows.map((r) => ({ id: r.id, symbol: r.symbol, content: r.content, createdAt: r.created_at }));
}

export function listAllNotes(): ResearchNote[] {
  const rows = getDb()
    .prepare("SELECT id, symbol, content, created_at FROM research_notes ORDER BY id DESC")
    .all() as unknown as NoteRow[];
  return rows.map((r) => ({ id: r.id, symbol: r.symbol, content: r.content, createdAt: r.created_at }));
}

export function addNote(symbol: string, content: string): ResearchNote {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare("INSERT INTO research_notes (symbol, content, created_at) VALUES (?, ?, ?)")
    .run(symbol.toUpperCase(), content.trim(), now) as unknown as { lastInsertRowid: number };
  return { id: Number(result.lastInsertRowid), symbol: symbol.toUpperCase(), content: content.trim(), createdAt: now };
}

export function deleteNote(id: number): void {
  getDb().prepare("DELETE FROM research_notes WHERE id = ?").run(id);
}

/* -------------------------------------------------------------------------- */
/* Chart drawings — persisted trend lines, Fibonacci, pitchforks, etc.        */
/* Scoped by exact (symbol, timeframe); `data` is the JSON-serialized         */
/* DrawingObject payload (points/style/locked/hidden/metadata).              */
/* -------------------------------------------------------------------------- */

interface ChartDrawingRow {
  id: number;
  symbol: string;
  timeframe: string;
  type: string;
  data: string;
  created_at: number;
  updated_at: number;
}

function mapChartDrawingRow(r: ChartDrawingRow): ChartDrawingRecord {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    type: r.type,
    data: r.data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listChartDrawings(symbol: string, timeframe: string): ChartDrawingRecord[] {
  const rows = getDb()
    .prepare(
      "SELECT id, symbol, timeframe, type, data, created_at, updated_at FROM chart_drawing WHERE symbol = ? AND timeframe = ? ORDER BY id ASC",
    )
    .all(symbol.toUpperCase(), timeframe) as unknown as ChartDrawingRow[];
  return rows.map(mapChartDrawingRow);
}

export function insertChartDrawing(
  symbol: string,
  timeframe: string,
  type: string,
  data: string,
): ChartDrawingRecord {
  const now = Date.now();
  const result = getDb()
    .prepare(
      "INSERT INTO chart_drawing (symbol, timeframe, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(symbol.toUpperCase(), timeframe, type, data, now, now) as unknown as { lastInsertRowid: number };
  return {
    id: Number(result.lastInsertRowid),
    symbol: symbol.toUpperCase(),
    timeframe,
    type,
    data,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateChartDrawing(id: number, data: string): void {
  getDb().prepare("UPDATE chart_drawing SET data = ?, updated_at = ? WHERE id = ?").run(data, Date.now(), id);
}

export function deleteChartDrawing(id: number): void {
  getDb().prepare("DELETE FROM chart_drawing WHERE id = ?").run(id);
}

export function clearChartDrawings(symbol: string, timeframe: string): void {
  getDb()
    .prepare("DELETE FROM chart_drawing WHERE symbol = ? AND timeframe = ?")
    .run(symbol.toUpperCase(), timeframe);
}

/* -------------------------------------------------------------------------- */
/* Fundamentals cache (screener dataset persistence)                          */
/* -------------------------------------------------------------------------- */

/** Upsert one company's cached fundamentals with the current timestamp. */
export function putFundamentals(rows: StockFundamentals[]): void {
  if (rows.length === 0) return;
  const now = Date.now();
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO fundamentals_cache (symbol, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  );
  database.exec("BEGIN");
  try {
    for (const row of rows) stmt.run(row.symbol, JSON.stringify(row), now);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

interface CacheRow {
  data: string;
  updated_at: number;
}

/** Load cached fundamentals newer than `maxAgeMs`, plus the newest timestamp. */
export function getFreshFundamentals(maxAgeMs: number): {
  rows: StockFundamentals[];
  builtAt: number | null;
} {
  const cutoff = Date.now() - maxAgeMs;
  const rows = getDb()
    .prepare("SELECT data, updated_at FROM fundamentals_cache WHERE updated_at >= ?")
    .all(cutoff) as unknown as CacheRow[];
  let builtAt: number | null = null;
  const parsed = rows.map((r) => {
    if (builtAt == null || r.updated_at > builtAt) builtAt = r.updated_at;
    return JSON.parse(r.data) as StockFundamentals;
  });
  return { rows: parsed, builtAt };
}

/**
 * Drop cached fundamentals. With `symbols`, only those rows — the cache is
 * shared by every enriched universe (equities and REITs both draw on it, and
 * they overlap), so a "Refresh data" on one class must not evict the other's
 * work and force it to re-fetch hundreds of companies it already had.
 */
export function clearFundamentals(symbols?: string[]): void {
  const database = getDb();
  if (!symbols) {
    database.prepare("DELETE FROM fundamentals_cache").run();
    return;
  }
  if (symbols.length === 0) return;

  const stmt = database.prepare("DELETE FROM fundamentals_cache WHERE symbol = ?");
  database.exec("BEGIN");
  try {
    for (const symbol of symbols) stmt.run(symbol);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Real estate lookup cache (RentCast address search — free tier is 50        */
/* calls/month, so results are cached for a long TTL at the route layer).     */
/* -------------------------------------------------------------------------- */

function normalizeAddressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

export function putRealEstateLookup(address: string, data: unknown): void {
  const key = normalizeAddressKey(address);
  getDb()
    .prepare(
      `INSERT INTO real_estate_lookup_cache (address_key, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(address_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(data), Date.now());
}

export function getCachedRealEstateLookup<T>(
  address: string,
  maxAgeMs: number,
): { data: T; updatedAt: number } | null {
  const key = normalizeAddressKey(address);
  const row = getDb()
    .prepare("SELECT data, updated_at FROM real_estate_lookup_cache WHERE address_key = ?")
    .get(key) as unknown as { data: string; updated_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.updated_at > maxAgeMs) return null;
  return { data: JSON.parse(row.data) as T, updatedAt: row.updated_at };
}

/* -------------------------------------------------------------------------- */
/* Portfolio positions                                                         */
/* -------------------------------------------------------------------------- */

interface PortfolioRow {
  symbol: string;
  name: string;
  shares: number;
  avg_cost: number;
  added_at: string;
}

interface PortfolioLotRow {
  id: number;
  symbol: string;
  name: string;
  shares: number;
  price: number;
  kind: string;
  fees: number;
  trade_date: string;
  created_at: string;
}

function rowToLot(r: PortfolioLotRow): PortfolioLot {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    shares: r.shares,
    price: r.price,
    kind: r.kind === "sell" ? "sell" : "buy",
    fees: r.fees,
    tradeDate: r.trade_date,
    createdAt: r.created_at,
  };
}

/** All lots for a symbol (or the whole ledger when omitted), oldest first. */
export function listLots(symbol?: string): PortfolioLot[] {
  const db = getDb();
  const rows = (
    symbol
      ? db.prepare("SELECT * FROM portfolio_lot WHERE symbol = ? ORDER BY trade_date, id").all(symbol.toUpperCase())
      : db.prepare("SELECT * FROM portfolio_lot ORDER BY trade_date, id").all()
  ) as unknown as PortfolioLotRow[];
  return rows.map(rowToLot);
}

/**
 * The holdings view: aggregate every symbol's lots into a position (average-cost
 * method), newest-inception first, closed positions excluded. Shape-compatible
 * with the previous single-row-per-symbol model, so all existing consumers are
 * untouched.
 */
export function listPortfolio(): PortfolioPosition[] {
  return aggregateOpenPositions(listLots()).map((p) => ({
    symbol: p.symbol,
    name: p.name,
    shares: p.shares,
    avgCost: p.avgCost,
    addedAt: p.firstTradeDate,
  }));
}

/** Append one buy/sell transaction to a symbol's ledger. */
export function addLot(
  symbol: string,
  name: string,
  lot: { shares: number; price: number; kind?: "buy" | "sell"; fees?: number; tradeDate?: string },
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      symbol.toUpperCase(),
      name,
      lot.shares,
      lot.price,
      lot.kind ?? "buy",
      lot.fees ?? 0,
      lot.tradeDate ?? now.slice(0, 10),
      now,
    );
}

/** Remove a single transaction by id (for editing a ledger). */
export function removeLot(id: number): void {
  getDb().prepare("DELETE FROM portfolio_lot WHERE id = ?").run(id);
}

/**
 * Set a symbol's position to an absolute shares/avgCost — the "edit position"
 * semantics the current UI relies on. Implemented by replacing the symbol's
 * ledger with one opening lot, so lots stay the single source of truth. New
 * transaction-based flows should call {@link addLot} instead.
 */
export function upsertPosition(
  symbol: string,
  name: string,
  shares: number,
  avgCost: number,
): PortfolioPosition {
  const sym = symbol.toUpperCase();
  const addedAt = new Date().toISOString();
  const db = getDb();
  db.prepare("DELETE FROM portfolio_lot WHERE symbol = ?").run(sym);
  db.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at)
     VALUES (?, ?, ?, ?, 'buy', 0, ?, ?)`,
  ).run(sym, name, shares, avgCost, addedAt.slice(0, 10), addedAt);
  return { symbol: sym, name, shares, avgCost, addedAt };
}

export function removePosition(symbol: string): void {
  getDb().prepare("DELETE FROM portfolio_lot WHERE symbol = ?").run(symbol.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Universal Portfolio — asset-class-aware lot access                          */
/* -------------------------------------------------------------------------- */

/**
 * A lot row including the universal columns (asset_class, currency, unit, meta).
 * Consumed by lib/portfolio/store.ts, which maps it into the Universal Holdings
 * Model. The SQL stays here so lib/db.ts remains the single schema source of truth.
 */
export interface UniversalLotRow {
  id: number;
  symbol: string;
  name: string;
  shares: number;
  price: number;
  kind: string;
  fees: number;
  trade_date: string;
  created_at: string;
  asset_class: string | null;
  currency: string | null;
  unit: string | null;
  meta: string | null;
}

export function listUniversalLots(): UniversalLotRow[] {
  return getDb()
    .prepare("SELECT * FROM portfolio_lot ORDER BY trade_date, id")
    .all() as unknown as UniversalLotRow[];
}

/**
 * Replace a symbol's ledger with one opening lot, carrying its asset class.
 * Same semantics as {@link upsertPosition} — which it now backs — but class-aware,
 * so a bond fund is stored AS a bond fund instead of silently as an equity.
 */
export function upsertUniversalPosition(input: {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  assetClass: string;
  currency?: string;
  unit?: string;
  meta?: Record<string, unknown> | null;
}): void {
  const sym = input.symbol.toUpperCase();
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare("DELETE FROM portfolio_lot WHERE symbol = ?").run(sym);
  db.prepare(
    `INSERT INTO portfolio_lot
       (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta)
     VALUES (?, ?, ?, ?, 'buy', 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sym,
    input.name,
    input.quantity,
    input.avgCost,
    now.slice(0, 10),
    now,
    input.assetClass,
    (input.currency ?? "USD").toUpperCase(),
    input.unit ?? "shares",
    input.meta ? JSON.stringify(input.meta) : null,
  );
}

/* -------------------------------------------------------------------------- */
/* Transaction Engine — batch trade execution, snapshots, undo                 */
/* -------------------------------------------------------------------------- */

/**
 * Append one buy/sell transaction, carrying the universal columns. Same shape
 * as {@link addLot} but class-aware, and — unlike {@link upsertUniversalPosition}
 * — additive rather than destructive: it does not touch the symbol's existing
 * lots. This is what preserves real trade history (and therefore correct
 * average-cost/realized-P&L via lib/portfolio-lots.ts's aggregateLots()) when a
 * position is resized, instead of collapsing it into one "opening lot" that
 * looks like the position was bought fresh today.
 */
export function addUniversalLot(input: {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  kind: "buy" | "sell";
  assetClass: string;
  currency?: string;
  unit?: string;
  fees?: number;
  tradeDate?: string;
  meta?: Record<string, unknown> | null;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO portfolio_lot
         (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.symbol.toUpperCase(),
      input.name,
      input.shares,
      input.price,
      input.kind,
      input.fees ?? 0,
      input.tradeDate ?? now.slice(0, 10),
      now,
      input.assetClass,
      (input.currency ?? "USD").toUpperCase(),
      input.unit ?? "shares",
      input.meta ? JSON.stringify(input.meta) : null,
    );
}

export interface LotWrite {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  kind: "buy" | "sell";
  assetClass: string;
  currency?: string;
  unit?: string;
  meta?: Record<string, unknown> | null;
}

/**
 * Atomically append a batch of new lots and delete a batch of manual assets, as
 * one all-or-nothing unit. This is the Transaction Engine's write primitive —
 * executing N trades as N separate HTTP calls (the ad hoc approach used before
 * this existed) has zero cross-holding atomicity; a failure partway through
 * leaves some holdings updated and others not, with nothing to roll back.
 * Follows the exact BEGIN/COMMIT/ROLLBACK shape already used by
 * {@link putFundamentals} and {@link putTimelineEvents}.
 */
export function executeTradeBatch(lots: LotWrite[], manualAssetIdsToDelete: string[]): void {
  if (lots.length === 0 && manualAssetIdsToDelete.length === 0) return;
  const database = getDb();
  const now = new Date().toISOString();
  const lotStmt = database.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  );
  const manualStmt = database.prepare("DELETE FROM manual_asset WHERE id = ?");

  database.exec("BEGIN");
  try {
    for (const lot of lots) {
      lotStmt.run(
        lot.symbol.toUpperCase(),
        lot.name,
        lot.shares,
        lot.price,
        lot.kind,
        now.slice(0, 10),
        now,
        lot.assetClass,
        (lot.currency ?? "USD").toUpperCase(),
        lot.unit ?? "shares",
        lot.meta ? JSON.stringify(lot.meta) : null,
      );
    }
    for (const id of manualAssetIdsToDelete) manualStmt.run(id);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

export interface PortfolioSnapshotSummary {
  totalValue: number;
  totalCost: number;
  health: number;
  healthGrade: string;
  volatility: number | null;
  topAssetClassWeight: number;
  allocation: { assetClass: string; weight: number }[];
}

export interface PortfolioSnapshot {
  id: string;
  label: string;
  objective: string | null;
  summary: PortfolioSnapshotSummary;
  createdAt: string;
}

interface PortfolioSnapshotRow {
  id: string;
  label: string;
  objective: string | null;
  holdings: string;
  summary: string;
  created_at: string;
}

/**
 * Capture the CURRENT raw ledger state — every lot (full history, not just the
 * open-position aggregate) and every manual asset — as a restorable snapshot.
 * This is deliberately a snapshot of the RAW rows, not a derived aggregate:
 * restoring it later is then a straight wipe-and-reinsert, which is exact and
 * needs no reconstruction logic (and correctly rolls back trade history too,
 * not just the current balance).
 */
export function snapshotPortfolio(
  label: string,
  objective: string | null,
  summary: PortfolioSnapshotSummary,
): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const database = getDb();
  const lots = database.prepare("SELECT * FROM portfolio_lot").all() as unknown as UniversalLotRow[];
  const manualAssets = database.prepare("SELECT * FROM manual_asset").all() as unknown as ManualAssetRow[];
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO portfolio_snapshot (id, label, objective, holdings, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, label, objective, JSON.stringify({ lots, manualAssets }), JSON.stringify(summary), now);
  return id;
}

function rowToSnapshot(r: Omit<PortfolioSnapshotRow, "holdings">): PortfolioSnapshot {
  return { id: r.id, label: r.label, objective: r.objective, summary: JSON.parse(r.summary), createdAt: r.created_at };
}

export function getSnapshot(id: string): PortfolioSnapshot | null {
  const r = getDb()
    .prepare("SELECT id, label, objective, summary, created_at FROM portfolio_snapshot WHERE id = ?")
    .get(id) as unknown as Omit<PortfolioSnapshotRow, "holdings"> | undefined;
  return r ? rowToSnapshot(r) : null;
}

export function listSnapshots(limit = 20): PortfolioSnapshot[] {
  const rows = getDb()
    .prepare("SELECT id, label, objective, summary, created_at FROM portfolio_snapshot ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as Omit<PortfolioSnapshotRow, "holdings">[];
  return rows.map(rowToSnapshot);
}

/**
 * Restore the portfolio to exactly the raw ledger state captured in a snapshot
 * — the Undo primitive. Wipes both ledgers and re-inserts the snapshotted rows
 * verbatim (including original ids), atomically. Returns false if the snapshot
 * id doesn't exist.
 */
export function restoreSnapshot(id: string): boolean {
  const row = getDb().prepare("SELECT holdings FROM portfolio_snapshot WHERE id = ?").get(id) as unknown as { holdings: string } | undefined;
  if (!row) return false;
  const { lots, manualAssets } = JSON.parse(row.holdings) as { lots: UniversalLotRow[]; manualAssets: ManualAssetRow[] };

  const database = getDb();
  const insertLot = database.prepare(
    `INSERT INTO portfolio_lot (id, symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertManual = database.prepare(
    `INSERT INTO manual_asset (id, category, name, acquisition_date, acquisition_cost, current_value, current_value_as_of, notes, details, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  database.exec("BEGIN");
  try {
    database.exec("DELETE FROM portfolio_lot");
    database.exec("DELETE FROM manual_asset");
    for (const l of lots) {
      insertLot.run(l.id, l.symbol, l.name, l.shares, l.price, l.kind, l.fees, l.trade_date, l.created_at, l.asset_class, l.currency, l.unit, l.meta);
    }
    for (const m of manualAssets) {
      insertManual.run(m.id, m.category, m.name, m.acquisition_date, m.acquisition_cost, m.current_value, m.current_value_as_of, m.notes, m.details, m.created_at, m.updated_at);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Notifications (alert delivery)                                             */
/* -------------------------------------------------------------------------- */

interface NotificationRow {
  id: number;
  dedup_key: string;
  symbol: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string;
  read: number;
  created_at: string;
}

function rowToNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    dedupKey: r.dedup_key,
    symbol: r.symbol,
    kind: r.kind,
    severity: r.severity === "warning" ? "warning" : "info",
    title: r.title,
    body: r.body,
    read: r.read === 1,
    createdAt: r.created_at,
  };
}

/**
 * Persist newly-fired alerts, skipping any whose dedup key already fired within
 * the last `dedupHours` (default 24h) — so an unchanged condition doesn't spam
 * the same notification on every monitor run. Returns how many were inserted.
 */
export function createNotifications(events: AlertEvent[], dedupHours = 24): number {
  if (events.length === 0) return 0;
  const db = getDb();
  const since = new Date(Date.now() - dedupHours * 3_600_000).toISOString();
  const exists = db.prepare(
    "SELECT 1 FROM notification WHERE dedup_key = ? AND created_at > ? LIMIT 1",
  );
  const insert = db.prepare(
    `INSERT INTO notification (dedup_key, symbol, kind, severity, title, body, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const now = new Date().toISOString();
  let inserted = 0;
  for (const e of events) {
    if (exists.get(e.dedupKey, since)) continue;
    insert.run(e.dedupKey, e.symbol, e.kind, e.severity, e.title, e.body, now);
    inserted++;
  }
  return inserted;
}

export function listNotifications(limit = 50): Notification[] {
  const rows = getDb()
    .prepare("SELECT * FROM notification ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as unknown as NotificationRow[];
  return rows.map(rowToNotification);
}

export function getNotificationById(id: number): Notification | null {
  const row = getDb().prepare("SELECT * FROM notification WHERE id = ?").get(id) as NotificationRow | undefined;
  return row ? rowToNotification(row) : null;
}

export function unreadNotificationCount(): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM notification WHERE read = 0").get() as { n: number };
  return r.n;
}

export function markNotificationRead(id: number): void {
  getDb().prepare("UPDATE notification SET read = 1 WHERE id = ?").run(id);
}

export function markAllNotificationsRead(): void {
  getDb().prepare("UPDATE notification SET read = 1 WHERE read = 0").run();
}

/* -------------------------------------------------------------------------- */
/* Decision journal (track record)                                            */
/* -------------------------------------------------------------------------- */

interface DecisionRow {
  id: number;
  symbol: string;
  name: string | null;
  action: string;
  conviction: number;
  thesis: string | null;
  price_at: number | null;
  currency: string | null;
  target_price: number | null;
  horizon: string | null;
  fit_score: number | null;
  fit_tier: string | null;
  status: string;
  close_price: number | null;
  closed_at: string | null;
  created_at: string;
}

function rowToDecision(r: DecisionRow): Decision {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    action: r.action as DecisionAction,
    conviction: r.conviction,
    thesis: r.thesis,
    priceAt: r.price_at,
    currency: r.currency,
    targetPrice: r.target_price,
    horizon: (r.horizon as DecisionHorizon | null) ?? null,
    fitScore: r.fit_score,
    fitTier: r.fit_tier,
    status: r.status === "closed" ? "closed" : "open",
    closePrice: r.close_price,
    closedAt: r.closed_at,
    createdAt: r.created_at,
  };
}

export interface CreateDecisionInput {
  symbol: string;
  name?: string | null;
  action: DecisionAction;
  conviction: number;
  thesis?: string | null;
  priceAt?: number | null;
  currency?: string | null;
  targetPrice?: number | null;
  horizon?: DecisionHorizon | null;
  fitScore?: number | null;
  fitTier?: string | null;
}

export function createDecision(input: CreateDecisionInput): Decision {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO decision
        (symbol, name, action, conviction, thesis, price_at, currency, target_price, horizon, fit_score, fit_tier, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      input.symbol.toUpperCase(),
      input.name ?? null,
      input.action,
      Math.max(1, Math.min(5, Math.round(input.conviction))),
      input.thesis ?? null,
      input.priceAt ?? null,
      input.currency ?? null,
      input.targetPrice ?? null,
      input.horizon ?? null,
      input.fitScore ?? null,
      input.fitTier ?? null,
      now,
    );
  return getDecision(Number(info.lastInsertRowid))!;
}

export function getDecision(id: number): Decision | null {
  const r = getDb().prepare("SELECT * FROM decision WHERE id = ?").get(id) as unknown as DecisionRow | undefined;
  return r ? rowToDecision(r) : null;
}

export function listDecisions(): Decision[] {
  const rows = getDb()
    .prepare("SELECT * FROM decision ORDER BY created_at DESC, id DESC")
    .all() as unknown as DecisionRow[];
  return rows.map(rowToDecision);
}

export function closeDecision(id: number, closePrice: number | null): void {
  getDb()
    .prepare("UPDATE decision SET status = 'closed', close_price = ?, closed_at = ? WHERE id = ?")
    .run(closePrice, new Date().toISOString(), id);
}

export function deleteDecision(id: number): void {
  getDb().prepare("DELETE FROM decision WHERE id = ?").run(id);
}

/* -------------------------------------------------------------------------- */
/* Manual assets (Real Estate / Private Markets / Alternatives / Structured   */
/* Products) — no ticker, no live price; `details` is a category-specific     */
/* JSON blob (same "generic row + opaque JSON" shape as fundamentals_cache).  */
/* -------------------------------------------------------------------------- */

export interface ManualAssetRow {
  id: string;
  category: string;
  name: string;
  acquisition_date: string;
  acquisition_cost: number;
  current_value: number | null;
  current_value_as_of: string | null;
  notes: string | null;
  details: string;
  created_at: string;
  updated_at: string;
}

function rowToManualAsset(r: ManualAssetRow): ManualAsset {
  return {
    id: r.id,
    category: r.category as ManualAssetCategory,
    name: r.name,
    acquisitionDate: r.acquisition_date,
    acquisitionCost: r.acquisition_cost,
    currentValue: r.current_value,
    currentValueAsOf: r.current_value_as_of,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // The DB doesn't enforce that `details`'s shape matches `category` — the
    // API layer (app/api/manual-assets/) is the single writer and always
    // sends a matching pair, the same trust boundary fundamentals_cache uses
    // for its opaque StockFundamentals JSON.
    details: JSON.parse(r.details),
  } as ManualAsset;
}

export interface CreateManualAssetInput {
  category: ManualAssetCategory;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  currentValue?: number | null;
  currentValueAsOf?: string | null;
  notes?: string | null;
  details: ManualAsset["details"];
}

export function createManualAsset(input: CreateManualAssetInput): ManualAsset {
  const id = globalThis.crypto?.randomUUID?.() ?? `ma-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO manual_asset
        (id, category, name, acquisition_date, acquisition_cost, current_value, current_value_as_of, notes, details, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.category,
      input.name,
      input.acquisitionDate,
      input.acquisitionCost,
      input.currentValue ?? null,
      input.currentValueAsOf ?? null,
      input.notes ?? null,
      JSON.stringify(input.details),
      now,
      now,
    );
  return getManualAsset(id)!;
}

export function getManualAsset(id: string): ManualAsset | null {
  const r = getDb().prepare("SELECT * FROM manual_asset WHERE id = ?").get(id) as unknown as ManualAssetRow | undefined;
  return r ? rowToManualAsset(r) : null;
}

export function listManualAssets(category?: ManualAssetCategory): ManualAsset[] {
  const rows = category
    ? (getDb().prepare("SELECT * FROM manual_asset WHERE category = ? ORDER BY created_at DESC").all(category) as unknown as ManualAssetRow[])
    : (getDb().prepare("SELECT * FROM manual_asset ORDER BY created_at DESC").all() as unknown as ManualAssetRow[]);
  return rows.map(rowToManualAsset);
}

export interface UpdateManualAssetInput {
  name?: string;
  currentValue?: number | null;
  currentValueAsOf?: string | null;
  notes?: string | null;
  details?: ManualAsset["details"];
}

export function updateManualAsset(id: string, input: UpdateManualAssetInput): ManualAsset | null {
  const existing = getManualAsset(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE manual_asset SET
        name = ?, current_value = ?, current_value_as_of = ?, notes = ?, details = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.name ?? existing.name,
      input.currentValue !== undefined ? input.currentValue : existing.currentValue,
      input.currentValueAsOf !== undefined ? input.currentValueAsOf : existing.currentValueAsOf,
      input.notes !== undefined ? input.notes : existing.notes,
      JSON.stringify(input.details ?? existing.details),
      new Date().toISOString(),
      id,
    );
  return getManualAsset(id);
}

export function deleteManualAsset(id: string): void {
  getDb().prepare("DELETE FROM manual_asset WHERE id = ?").run(id);
}

/* -------------------------------------------------------------------------- */
/* Research copilot sessions + messages (Memory Layer persistence)            */
/* -------------------------------------------------------------------------- */

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  meta: string | null; // JSON: citations, suggestions, reasoning
  createdAt: string;
}

/** Create the session row if it doesn't exist yet. */
export function ensureSession(id: string, symbol: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO research_session (id, symbol, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(id, symbol.toUpperCase(), now, now);
}

/** Append one message to a session. */
export function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  meta: string | null = null,
): void {
  getDb()
    .prepare(
      `INSERT INTO research_message (session_id, role, content, meta, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, role, content, meta, new Date().toISOString());
}

interface MessageRow {
  role: "user" | "assistant";
  content: string;
  meta: string | null;
  created_at: string;
}

/** Load a session's messages in chronological order. */
export function getSessionMessages(sessionId: string): StoredMessage[] {
  const rows = getDb()
    .prepare(
      "SELECT role, content, meta, created_at FROM research_message WHERE session_id = ? ORDER BY id ASC",
    )
    .all(sessionId) as unknown as MessageRow[];
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    meta: r.meta,
    createdAt: r.created_at,
  }));
}

/* -------------------------------------------------------------------------- */
/* Scanner v2 cache                                                            */
/* -------------------------------------------------------------------------- */

const SCANNER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

interface ScannerCacheRow {
  result: string;
  created_at: number;
}

export function getScannerCache(cacheKey: string): string | null {
  const cutoff = Date.now() - SCANNER_CACHE_TTL;
  const row = getDb()
    .prepare("SELECT result, created_at FROM scanner_cache WHERE cache_key = ? AND created_at >= ?")
    .get(cacheKey, cutoff) as unknown as ScannerCacheRow | undefined;
  return row?.result ?? null;
}

export function putScannerCache(cacheKey: string, result: string): void {
  getDb()
    .prepare(
      `INSERT INTO scanner_cache (cache_key, result, created_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result, created_at = excluded.created_at`,
    )
    .run(cacheKey, result, Date.now());
  // Prune entries older than TTL
  const cutoff = Date.now() - SCANNER_CACHE_TTL;
  getDb().prepare("DELETE FROM scanner_cache WHERE created_at < ?").run(cutoff);
}

/* -------------------------------------------------------------------------- */
/* Scanner snapshot — the last default-parameter auto-scan, kept indefinitely */
/* -------------------------------------------------------------------------- */
//
// Deliberately NOT stored in scanner_cache above: that table's TTL is global
// and pruned on every write from *any* feature (market-summary,
// movement-explainer, per-scope KG cache, timeline sync markers all share
// it) — a real ScannerResult stored there cannot outlive 15 minutes no
// matter what read-side TTL logic is added, since the next unrelated write
// deletes it. This is a separate, singleton-row table with no global prune,
// so callers (Mission Control, Knowledge Graph) can read "the last scan"
// hours or days later rather than only within the last 15 minutes.

interface ScannerSnapshotRow {
  result: string;
  generated_at: string;
}

export function getScannerSnapshot(): { result: string; generatedAt: string } | null {
  const row = getDb()
    .prepare("SELECT result, generated_at FROM scanner_snapshot WHERE id = 1")
    .get() as unknown as ScannerSnapshotRow | undefined;
  return row ? { result: row.result, generatedAt: row.generated_at } : null;
}

export function putScannerSnapshot(result: string, generatedAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO scanner_snapshot (id, result, generated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET result = excluded.result, generated_at = excluded.generated_at`,
    )
    .run(result, generatedAt);
}

/* -------------------------------------------------------------------------- */
/* Sector Rotation snapshots                                                  */
/* -------------------------------------------------------------------------- */

const SECTOR_ROTATION_RETENTION = 730; // ~2 years of daily snapshots

interface SectorRotationRow {
  as_of: string;
  data: string;
}

/** Most recent N snapshots, newest first. */
export function getLatestSectorRotationSnapshots(
  limit = 2,
): { asOf: string; sectors: SectorRotationEntry[] }[] {
  const rows = getDb()
    .prepare("SELECT as_of, data FROM sector_rotation_snapshot ORDER BY as_of DESC LIMIT ?")
    .all(limit) as unknown as SectorRotationRow[];
  return rows.map((r) => ({ asOf: r.as_of, sectors: JSON.parse(r.data) as SectorRotationEntry[] }));
}

export function putSectorRotationSnapshot(asOf: string, sectors: SectorRotationEntry[]): void {
  getDb()
    .prepare(
      `INSERT INTO sector_rotation_snapshot (as_of, data, created_at) VALUES (?, ?, ?)
       ON CONFLICT(as_of) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`,
    )
    .run(asOf, JSON.stringify(sectors), Date.now());
  // Prune snapshots beyond the retention window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SECTOR_ROTATION_RETENTION);
  getDb()
    .prepare("DELETE FROM sector_rotation_snapshot WHERE as_of < ?")
    .run(cutoff.toISOString().slice(0, 10));
}

/* -------------------------------------------------------------------------- */
/* Investment Timeline — durable per-symbol event history                    */
/* -------------------------------------------------------------------------- */

interface TimelineEventRow {
  id: string;
  symbol: string;
  timestamp: string;
  data: string;
}

/**
 * Insert new timeline events, ignoring any whose id already exists (events
 * are immutable once persisted — `id` is a deterministic hash of the event's
 * natural key, so re-syncing the same news/filing/alert is a no-op).
 */
export function putTimelineEvents(events: TimelineEvent[]): void {
  if (events.length === 0) return;
  const database = getDb();
  const stmt = database.prepare(
    `INSERT OR IGNORE INTO timeline_event (id, symbol, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  database.exec("BEGIN");
  try {
    for (const event of events) {
      stmt.run(event.id, event.symbol, event.timestamp, JSON.stringify(event), now);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

/** All persisted events for one symbol, newest first. */
export function listTimelineEvents(symbol: string): TimelineEvent[] {
  const rows = getDb()
    .prepare("SELECT id, symbol, timestamp, data FROM timeline_event WHERE symbol = ? ORDER BY timestamp DESC")
    .all(symbol.toUpperCase()) as unknown as TimelineEventRow[];
  return rows.map((r) => JSON.parse(r.data) as TimelineEvent);
}

/** All persisted events across a set of symbols (portfolio/watchlist scope), newest first. */
export function listTimelineEventsForSymbols(symbols: string[]): TimelineEvent[] {
  if (symbols.length === 0) return [];
  const placeholders = symbols.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id, symbol, timestamp, data FROM timeline_event WHERE symbol IN (${placeholders}) ORDER BY timestamp DESC`)
    .all(...symbols.map((s) => s.toUpperCase())) as unknown as TimelineEventRow[];
  return rows.map((r) => JSON.parse(r.data) as TimelineEvent);
}

/* -------------------------------------------------------------------------- */
/* Saved screens                                                              */
/* -------------------------------------------------------------------------- */

/** A saved screener configuration. `filters` is stored as opaque JSON — see the table comment. */
export interface SavedScreen {
  id: string;
  name: string;
  assetClass: string;
  templateId: string | null;
  filters: Record<string, unknown>;
  sortKey: string;
  sortDir: "asc" | "desc";
  createdAt: string;
  updatedAt: string;
}

interface SavedScreenRow {
  id: string;
  name: string;
  asset_class: string;
  template_id: string | null;
  filters: string;
  sort_key: string;
  sort_dir: string;
  created_at: string;
  updated_at: string;
}

function toSavedScreen(r: SavedScreenRow): SavedScreen {
  let filters: Record<string, unknown> = {};
  try {
    filters = JSON.parse(r.filters) as Record<string, unknown>;
  } catch {
    // A corrupted filter blob must not take down the whole saved-screens list;
    // the screen loads with no filters and the user can re-set them.
  }
  return {
    id: r.id,
    name: r.name,
    assetClass: r.asset_class,
    templateId: r.template_id,
    filters,
    sortKey: r.sort_key,
    sortDir: r.sort_dir === "asc" ? "asc" : "desc",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listSavedScreens(assetClass?: string): SavedScreen[] {
  const db = getDb();
  const rows = (
    assetClass
      ? db
          .prepare("SELECT * FROM saved_screen WHERE asset_class = ? ORDER BY updated_at DESC")
          .all(assetClass)
      : db.prepare("SELECT * FROM saved_screen ORDER BY updated_at DESC").all()
  ) as unknown as SavedScreenRow[];
  return rows.map(toSavedScreen);
}

export function getSavedScreen(id: string): SavedScreen | null {
  const row = getDb()
    .prepare("SELECT * FROM saved_screen WHERE id = ?")
    .get(id) as unknown as SavedScreenRow | undefined;
  return row ? toSavedScreen(row) : null;
}

/** Create or overwrite a saved screen. Reusing an id updates it in place, preserving created_at. */
export function saveScreen(input: Omit<SavedScreen, "createdAt" | "updatedAt">): SavedScreen {
  const now = new Date().toISOString();
  const existing = getSavedScreen(input.id);
  const createdAt = existing?.createdAt ?? now;

  getDb()
    .prepare(
      `INSERT INTO saved_screen (id, name, asset_class, template_id, filters, sort_key, sort_dir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         asset_class = excluded.asset_class,
         template_id = excluded.template_id,
         filters = excluded.filters,
         sort_key = excluded.sort_key,
         sort_dir = excluded.sort_dir,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.name,
      input.assetClass,
      input.templateId,
      JSON.stringify(input.filters),
      input.sortKey,
      input.sortDir,
      createdAt,
      now,
    );

  return { ...input, createdAt, updatedAt: now };
}

export function deleteSavedScreen(id: string): void {
  getDb().prepare("DELETE FROM saved_screen WHERE id = ?").run(id);
}

/* -------------------------------------------------------------------------- */
/* Platform cache (lib/platform/cache.ts persistence tier)                     */
/* -------------------------------------------------------------------------- */
//
// The disk tier behind the Smart Cache. Only datasets whose policy sets
// `persist: true` land here — expensive-to-rebuild, slow-moving things
// (statements, filings, profiles, price history, AI reports) that should
// survive a process restart rather than being re-downloaded on every `npm run
// dev`. Live quotes are deliberately absent.
//
// Unlike `scanner_cache`, writes here do NOT globally prune: expiry is decided
// per row by the dataset's own policy, so one feature's write can never evict
// another feature's still-valid data.

export interface PlatformCacheRow {
  cacheKey: string;
  dataset: string;
  symbol: string | null;
  value: string;
  fetchedAt: number;
  expiresAt: number;
  source: string;
  version: number;
}

interface RawPlatformCacheRow {
  cache_key: string;
  dataset: string;
  symbol: string | null;
  value: string;
  fetched_at: number;
  expires_at: number;
  source: string;
  version: number;
}

export function getPlatformCache(cacheKey: string): PlatformCacheRow | null {
  const row = getDb()
    .prepare("SELECT * FROM platform_cache WHERE cache_key = ?")
    .get(cacheKey) as unknown as RawPlatformCacheRow | undefined;
  if (!row) return null;
  return {
    cacheKey: row.cache_key,
    dataset: row.dataset,
    symbol: row.symbol,
    value: row.value,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    source: row.source,
    version: row.version,
  };
}

export function putPlatformCache(row: PlatformCacheRow): void {
  getDb()
    .prepare(
      `INSERT INTO platform_cache (cache_key, dataset, symbol, value, fetched_at, expires_at, source, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         value      = excluded.value,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         source     = excluded.source,
         version    = excluded.version`,
    )
    .run(
      row.cacheKey,
      row.dataset,
      row.symbol,
      row.value,
      row.fetchedAt,
      row.expiresAt,
      row.source,
      row.version,
    );
}

/** Selective invalidation: by exact key, by dataset, by symbol, or by (symbol, dataset) pairs. */
export function deletePlatformCache(opts: {
  cacheKey?: string;
  symbol?: string;
  datasets?: string[];
}): number {
  const database = getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (opts.cacheKey) {
    where.push("cache_key = ?");
    args.push(opts.cacheKey);
  }
  if (opts.symbol) {
    where.push("symbol = ?");
    args.push(opts.symbol);
  }
  if (opts.datasets && opts.datasets.length > 0) {
    where.push(`dataset IN (${opts.datasets.map(() => "?").join(", ")})`);
    args.push(...opts.datasets);
  }
  if (where.length === 0) return 0;

  const result = database
    .prepare(`DELETE FROM platform_cache WHERE ${where.join(" AND ")}`)
    .run(...args);
  return Number(result.changes ?? 0);
}

/** Drop rows whose stale-while-revalidate window has fully elapsed. Called on a timer, not on every write. */
export function prunePlatformCache(now = Date.now()): number {
  const result = getDb()
    .prepare("DELETE FROM platform_cache WHERE expires_at < ?")
    .run(now);
  return Number(result.changes ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Activity — "Continue where you left off" (home Module 10)                   */
/* -------------------------------------------------------------------------- */

interface ActivityRow {
  kind: string;
  ref: string;
  label: string;
  href: string;
  at: string;
}

/**
 * Records that the user visited something. Upserts on (kind, ref): a second
 * visit to the same research page moves it to the top of the list rather than
 * adding a duplicate entry.
 *
 * Deliberately fire-and-forget at the call site — a failure to log a visit must
 * never break the page the user is actually trying to read.
 */
export function recordActivity(input: {
  kind: string;
  ref: string;
  label: string;
  href: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO activity (kind, ref, label, href, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, ref) DO UPDATE SET label = excluded.label, href = excluded.href, at = excluded.at`,
    )
    .run(input.kind, input.ref, input.label, input.href, new Date().toISOString());

  // Keep the table bounded. The homepage shows a handful; nobody is served by
  // an unbounded history, and this is cheaper than a scheduled prune.
  getDb().prepare(
    `DELETE FROM activity WHERE rowid NOT IN (SELECT rowid FROM activity ORDER BY at DESC LIMIT 50)`,
  ).run();
}

export function listActivity(limit = 6): ActivityRow[] {
  return getDb()
    .prepare("SELECT kind, ref, label, href, at FROM activity ORDER BY at DESC LIMIT ?")
    .all(limit) as unknown as ActivityRow[];
}
