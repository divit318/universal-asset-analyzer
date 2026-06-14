import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { WatchlistItem } from "./types";

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
