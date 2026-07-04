import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PortfolioPosition, ResearchNote, StockFundamentals, WatchlistItem, SectorRotationEntry, TimelineEvent } from "./types";

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
    CREATE TABLE IF NOT EXISTS portfolio (
      symbol   TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      shares   REAL NOT NULL,
      avg_cost REAL NOT NULL,
      added_at TEXT NOT NULL
    );
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
  `);
  // Migrate existing watchlist rows: add new columns if the DB predates them
  for (const col of ["target_price REAL", "alert_pct_drop REAL", "notes TEXT"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
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

export function clearFundamentals(): void {
  getDb().prepare("DELETE FROM fundamentals_cache").run();
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

export function listPortfolio(): PortfolioPosition[] {
  const rows = getDb()
    .prepare("SELECT symbol, name, shares, avg_cost, added_at FROM portfolio ORDER BY added_at DESC")
    .all() as unknown as PortfolioRow[];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    shares: r.shares,
    avgCost: r.avg_cost,
    addedAt: r.added_at,
  }));
}

export function upsertPosition(
  symbol: string,
  name: string,
  shares: number,
  avgCost: number,
): PortfolioPosition {
  const pos: PortfolioPosition = {
    symbol: symbol.toUpperCase(),
    name,
    shares,
    avgCost,
    addedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO portfolio (symbol, name, shares, avg_cost, added_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET name = excluded.name, shares = excluded.shares,
         avg_cost = excluded.avg_cost`,
    )
    .run(pos.symbol, pos.name, pos.shares, pos.avgCost, pos.addedAt);
  return pos;
}

export function removePosition(symbol: string): void {
  getDb()
    .prepare("DELETE FROM portfolio WHERE symbol = ?")
    .run(symbol.toUpperCase());
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
