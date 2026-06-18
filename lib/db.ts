import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PortfolioPosition, StockFundamentals, WatchlistItem } from "./types";

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
      symbol   TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      added_at TEXT NOT NULL
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
  `);
  return db;
}

interface WatchlistRow {
  symbol: string;
  name: string;
  added_at: string;
}

export function listWatchlist(): WatchlistItem[] {
  const rows = getDb()
    .prepare("SELECT symbol, name, added_at FROM watchlist ORDER BY added_at DESC")
    .all() as unknown as WatchlistRow[];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    addedAt: r.added_at,
  }));
}

export function addToWatchlist(symbol: string, name: string): WatchlistItem {
  const item: WatchlistItem = {
    symbol: symbol.toUpperCase(),
    name,
    addedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO watchlist (symbol, name, added_at) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET name = excluded.name`,
    )
    .run(item.symbol, item.name, item.addedAt);
  return item;
}

export function removeFromWatchlist(symbol: string): void {
  getDb()
    .prepare("DELETE FROM watchlist WHERE symbol = ?")
    .run(symbol.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Fundamentals cache (screener dataset persistence)                          */
/* -------------------------------------------------------------------------- */

/** Upsert one company's cached fundamentals with the current timestamp. */
export function putFundamentals(rows: StockFundamentals[]): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT INTO fundamentals_cache (symbol, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  );
  for (const row of rows) stmt.run(row.symbol, JSON.stringify(row), now);
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
