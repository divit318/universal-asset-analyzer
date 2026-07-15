import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ChartDrawingRecord, PortfolioPosition, PortfolioLot, ResearchNote, StockFundamentals, WatchlistItem, SectorRotationEntry, TimelineEvent, Notification, Decision, DecisionAction, DecisionHorizon } from "./types";
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
  `);
  // Migrate existing watchlist rows: add new columns if the DB predates them
  for (const col of ["target_price REAL", "alert_pct_drop REAL", "notes TEXT"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
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
