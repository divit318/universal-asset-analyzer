import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ChartDrawingRecord, PortfolioPosition, PortfolioLot, ResearchNote, StockFundamentals, WatchlistItem, WatchlistGroup, TargetRevision, IdeaStage, TargetDirection, SectorRotationEntry, TimelineEvent, Notification, Decision, DecisionAction, DecisionHorizon, ManualAsset, ManualAssetCategory } from "./types";
import { aggregateOpenPositions } from "./portfolio-lots";
import { isIdeaStage, autoStageForTrade, effectiveStage, isPipelineSymbol } from "./idea-stage";
import { isIdeaSource, type IdeaSource } from "./idea-source";
import { isUsablePrice } from "./watchlist-metrics";
import {
  coerceAssumptionSet, computeCaseResult, isValuationMethod, DEFAULT_VALUATION_METHOD,
  versionKeyOf,
} from "./valuation/case";
import type {
  AssumptionSet, CaseAuthor, CaseEventKind, CaseResult, ValuationCase, ValuationEvent,
  ValuationMethod,
} from "./valuation/case";
import type { AlertEvent } from "./alerts";
import type { AttentionDismissal } from "./home/contracts";
import type { Simulation, SimProfile, SimHolding, SimThesis, SimHeadline } from "./portfolio/simulator/types";
import { normalizeStoredProfile } from "./portfolio/simulator/profile";

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
    /* Named watchlists.
     *
     * Deliberately NOT a group_id column on the watchlist table: that table's primary
     * key is the symbol, and every symbol-keyed API in the app (getIdeaStage,
     * updateWatchlistItem, notes, targets, alerts) depends on it staying that
     * way. Membership therefore lives in its own join table, which also means a
     * symbol can appear in several lists while its research state — target,
     * thesis, stage — is stored once. Your target for AAPL is your target for
     * AAPL regardless of which list you are looking at it through. */
    CREATE TABLE IF NOT EXISTS watchlist_group (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      /* Ticker compared against, e.g. SPY. Null = no benchmark for this list. */
      benchmark  TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist_member (
      group_id INTEGER NOT NULL,
      symbol   TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (group_id, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_member_symbol ON watchlist_member (symbol);
    /* Every revision of a price target, so a user can review their own changes
     * of mind. Append-only; nothing here is ever updated. */
    CREATE TABLE IF NOT EXISTS watchlist_target_history (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol             TEXT NOT NULL,
      previous_target    REAL,
      new_target         REAL,
      previous_direction TEXT,
      new_direction      TEXT,
      note               TEXT,
      changed_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_target_history_symbol
      ON watchlist_target_history (symbol, changed_at DESC);
    /* The last price the alert evaluator actually observed, per symbol.
     *
     * This is what turns a *state* test into a *crossing* test: without a
     * previous observation there is no way to distinguish "the price just moved
     * through your level" from "the price has been sitting past your level for a
     * month", and the latter is not an event. Persisted rather than held in
     * memory so a crossing that happens while the server is down is still
     * detected on the next run. */
    CREATE TABLE IF NOT EXISTS price_alert_state (
      symbol              TEXT PRIMARY KEY,
      last_price          REAL NOT NULL,
      /* Today's % change as last observed. The drop alert is a same-day measure,
       * so its transition test is against this rather than against a price. */
      last_change_percent REAL,
      last_seen_at        INTEGER NOT NULL
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
    /* Named portfolios. Every ledger row (portfolio_lot, manual_asset,
     * portfolio_snapshot) carries a portfolio_id defaulting to 1 — the seeded
     * "Main Portfolio" — so every pre-existing caller that doesn't name one
     * keeps reading and writing exactly what it always did. Aggregate surfaces
     * (Home, Calendar, Knowledge Graph…) deliberately stay on the default
     * portfolio; only the Portfolio page switches. */
    CREATE TABLE IF NOT EXISTS portfolios (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS kg_snapshot (
      scope_key    TEXT PRIMARY KEY,
      graph        TEXT NOT NULL,
      generated_at TEXT NOT NULL
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

    /* Simulator: AI-generated hypothetical portfolios. A row is a *specification*
     * (intake profile + hypothetical holdings), never a computed result — all
     * analytics are recomputed live through the same engines as the real
     * portfolio. The headline column is the one denormalization (list-view numbers),
     * refreshed on every evaluation. */
    CREATE TABLE IF NOT EXISTS simulation (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft',
      profile     TEXT NOT NULL,
      holdings    TEXT NOT NULL DEFAULT '[]',
      thesis      TEXT,
      headline    TEXT,
      promoted_at TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_simulation_updated ON simulation (updated_at DESC);
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

    -- Attention Queue dismissals (§13). One row per dismissed story identity
    -- (dedupe_key). A dismissal suppresses the story until expires_at, after
    -- which the same story is allowed back into the queue; a *materially worse*
    -- version has a different dedupe_key and so is never suppressed by this row.
    CREATE TABLE IF NOT EXISTS attention_dismissal (
      dedupe_key   TEXT PRIMARY KEY,
      dismissed_at INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attention_dismissal_expires ON attention_dismissal (expires_at);

    -- Change detection (lib/home/changes.ts). Exactly two slots: 'current' is
    -- the state of the most recent digest build; 'baseline' is the state at the
    -- end of the previous visit, promoted from 'current' when a new visit
    -- starts (a VISIT_GAP_MS pause between builds). The diff shown on the
    -- dashboard is always baseline vs the fresh build.
    CREATE TABLE IF NOT EXISTS home_fingerprint (
      slot     TEXT PRIMARY KEY CHECK (slot IN ('current', 'baseline')),
      data     TEXT NOT NULL,
      taken_at INTEGER NOT NULL
    );

    -- Per-page change baselines for the materiality lens (lib/materiality.ts).
    -- Same two-slot design as home_fingerprint, keyed by page so each surface
    -- keeps its own "what did this look like on my previous visit" blob
    -- (e.g. page = 'portfolio-scores' stores symbol → holding score).
    CREATE TABLE IF NOT EXISTS page_fingerprint (
      page     TEXT NOT NULL,
      slot     TEXT NOT NULL CHECK (slot IN ('current', 'baseline')),
      data     TEXT NOT NULL,
      taken_at INTEGER NOT NULL,
      PRIMARY KEY (page, slot)
    );

    -- Valuation as a persisted object rather than a page.
    --
    -- The valuation_event table is the truth: append-only, one row per version,
    -- each carrying a FULL assumption snapshot rather than a delta. Storage is
    -- free and delta reconstruction is a bug farm, so diffing any two versions
    -- stays a pure function over two rows.
    --
    -- valuation_case is a materialized projection of the newest event, rewritten
    -- inside the same transaction. It exists only so the Research Hub strip and
    -- the Valuation Register can read one indexed row instead of scanning the
    -- log. The log is authoritative; if they ever disagree, the projection is
    -- wrong.
    --
    -- price_at is on every event deliberately. Without the price as it stood
    -- when the case was written, "what margin of safety did you actually believe
    -- when you committed?" is unanswerable, and assumption-level calibration
    -- becomes impossible to add without a backfill that cannot be reconstructed.
    --
    -- There is deliberately NO stage column: the idea lifecycle already lives on
    -- watchlist.stage (4.5), and the Register joins it rather than keeping a
    -- second copy that can drift.
    CREATE TABLE IF NOT EXISTS valuation_case (
      symbol               TEXT PRIMARY KEY,
      currency             TEXT NOT NULL DEFAULT 'USD',
      method               TEXT NOT NULL DEFAULT 'dcf_fcf',
      version              INTEGER NOT NULL,
      author               TEXT NOT NULL,
      assumptions          TEXT NOT NULL,
      fair_value           REAL,
      fair_value_bear      REAL,
      fair_value_bull      REAL,
      implied_growth       REAL,
      margin_of_safety     REAL,
      terminal_value_share REAL,
      price_at             REAL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      last_user_event_at   TEXT
    );
    -- Both indexes serve the Register: "what have I not looked at" and
    -- "where is the margin of safety".
    CREATE INDEX IF NOT EXISTS idx_valuation_case_updated ON valuation_case (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_valuation_case_mos     ON valuation_case (margin_of_safety DESC);

    CREATE TABLE IF NOT EXISTS valuation_event (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol         TEXT NOT NULL,
      version        INTEGER NOT NULL,
      author         TEXT NOT NULL,
      kind           TEXT NOT NULL,
      assumptions    TEXT NOT NULL,
      result         TEXT NOT NULL,
      price_at       REAL,
      trigger_source TEXT,
      note           TEXT,
      created_at     TEXT NOT NULL,
      UNIQUE (symbol, version)
    );
    CREATE INDEX IF NOT EXISTS idx_valuation_event_symbol
      ON valuation_event (symbol, version DESC);

    /* AI analysis jobs (ai-migration/03-architecture.md §4): durable record of
     * a provider-agnostic analysis run. The id IS the idempotency key —
     * hash(task, subject, input, schema version) — so a restarted server
     * re-attaches to the same Devin session instead of double-spawning. */
    CREATE TABLE IF NOT EXISTS ai_job (
      id             TEXT PRIMARY KEY,
      task_type      TEXT NOT NULL,
      subject_key    TEXT NOT NULL,
      input_hash     TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      provider       TEXT NOT NULL,
      status         TEXT NOT NULL CHECK (status IN
                     ('pending','running','succeeded','failed','timeout','cancelled')),
      session_id     TEXT,
      session_url    TEXT,
      error          TEXT,
      acus           REAL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      finished_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ai_job_status ON ai_job (status, updated_at DESC);

    /* AI analysis result cache (ai-migration/03-architecture.md §5), keyed
     * exactly on (analysis_type, subject, input hash, schema version). The
     * input_hash is the primary invalidator — same content-hash pattern as
     * the portfolio thesis. Freshness windows stay the caller's policy. */
    CREATE TABLE IF NOT EXISTS ai_result (
      analysis_type  TEXT NOT NULL,
      subject_key    TEXT NOT NULL,
      input_hash     TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      provider       TEXT NOT NULL,
      meta_json      TEXT,
      result_json    TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      PRIMARY KEY (analysis_type, subject_key, input_hash, schema_version)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_result_subject
      ON ai_result (analysis_type, subject_key, created_at DESC);
  `);
  // The valuation case names its methodology rather than leaving "DCF" implicit.
  // ADD COLUMN with a NOT NULL DEFAULT backfills every prior row to the only
  // method that has ever existed, so the migration is the identity mapping.
  for (const col of ["method TEXT NOT NULL DEFAULT 'dcf_fcf'"]) {
    try { db.exec(`ALTER TABLE valuation_case ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // Which version of the symbol's valuation case a decision was committed
  // against (the Judgment Ledger's join). Deliberately nullable and NOT
  // backfilled: every decision logged before the Ledger existed was made
  // against a case version nobody recorded, and possibly against no case at
  // all. NULL therefore means "not recorded", which lib/ledger.ts renders as an
  // approximation computed from the case's *current* assumptions and labels as
  // such. Backfilling the newest version would silently claim the user held
  // today's assumptions when they acted, which is exactly the false precision
  // the rest of this module refuses to manufacture.
  try { db.exec("ALTER TABLE decision ADD COLUMN case_version INTEGER"); } catch { /* already exists */ }
  /*
   * Standing definitions: a saved screen remembers the symbols it matched last
   * time it was loaded, so the next load can say what *changed* rather than just
   * restating the list.
   *
   * That difference is most of the value of saving a screen at all. A screen you
   * re-run by hand is a query; a screen that tells you "PANW left, ROIC fell to
   * 11.4" is a monitor. Stored as a JSON symbol array on the row rather than a
   * separate table because it is strictly derived, per-screen, and worthless
   * without its parent.
   */
  for (const col of ["last_symbols TEXT", "last_run_at TEXT"]) {
    try { db.exec(`ALTER TABLE saved_screen ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  // Migrate existing watchlist rows: add new columns if the DB predates them
  for (const col of ["target_price REAL", "alert_pct_drop REAL", "notes TEXT"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // Idea lifecycle (§4.5): every tracked symbol carries a stage. Safe on an
  // existing populated table — ADD COLUMN with a NOT NULL DEFAULT backfills
  // every prior row to 'surfaced', and the guard makes the migration idempotent.
  for (const col of ["stage TEXT NOT NULL DEFAULT 'surfaced'", "stage_changed_at INTEGER"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // Price-target direction. Left NULL for pre-existing rows on purpose: NULL
  // means "not recorded", which lib/watchlist-metrics.ts resolves from the price
  // at read time. Backfilling a guess here would freeze that guess forever.
  //
  // This column is what reconciles two engines that disagreed: lib/alerts.ts
  // fired a target when price <= target (a buy limit) while the watchlist page
  // and CSV export fired when price >= target (a valuation target), so for any
  // target a user set, exactly one of the two was permanently firing.
  try { db.exec("ALTER TABLE watchlist ADD COLUMN target_direction TEXT"); } catch { /* already exists */ }
  // Provenance (see lib/idea-source.ts). Deliberately NOT backfilled and
  // deliberately nullable: every row that predates this column has an origin
  // nobody recorded, and the honest rendering of that is "origin not recorded".
  // Defaulting them to 'watchlist' would convert missing history into a false
  // claim that no later read could distinguish from a real one.
  for (const col of ["source TEXT", "source_detail TEXT"]) {
    try { db.exec(`ALTER TABLE watchlist ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  /* Named watchlists — seed the default list and adopt every existing symbol
   * into it, so a pre-existing user opens the page to exactly what they had.
   * Both steps are guarded by their own emptiness check rather than a version
   * flag, which makes the migration idempotent and also self-healing: a symbol
   * added by an older build that wrote only to `watchlist` gets adopted on the
   * next boot instead of becoming invisible. */
  try {
    const groupCount = db.prepare("SELECT COUNT(*) AS n FROM watchlist_group").get() as { n: number };
    if (groupCount.n === 0) {
      db.prepare("INSERT INTO watchlist_group (id, name, benchmark, sort_order, created_at) VALUES (1, ?, ?, 0, ?)")
        .run(DEFAULT_WATCHLIST_NAME, "SPY", Date.now());
    }
    // Adopt orphans into the lowest-ordered list.
    const fallback = db
      .prepare("SELECT id FROM watchlist_group ORDER BY sort_order, id LIMIT 1")
      .get() as { id: number } | undefined;
    if (fallback) {
      db.prepare(
        `INSERT OR IGNORE INTO watchlist_member (group_id, symbol, added_at)
         SELECT ?, w.symbol, w.added_at FROM watchlist w
         WHERE NOT EXISTS (SELECT 1 FROM watchlist_member m WHERE m.symbol = w.symbol)`,
      ).run(fallback.id);
    }
  } catch (err) {
    // A failed list migration must not make the app unbootable; `listWatchlist()`
    // reads the `watchlist` table directly and is unaffected either way.
    console.warn("[db] watchlist group migration skipped:", err instanceof Error ? err.message : err);
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
  // Multi-portfolio: every ledger row belongs to a named portfolio. DEFAULT 1
  // backfills all pre-existing rows into the seeded "Main Portfolio", so this
  // is the identity migration for a single-portfolio database.
  for (const [table, col] of [
    ["portfolio_lot", "portfolio_id INTEGER NOT NULL DEFAULT 1"],
    ["manual_asset", "portfolio_id INTEGER NOT NULL DEFAULT 1"],
    ["portfolio_snapshot", "portfolio_id INTEGER NOT NULL DEFAULT 1"],
  ]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  try {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM portfolios").get() as { n: number }).n;
    if (n === 0) {
      db.prepare("INSERT INTO portfolios (id, name, created_at) VALUES (1, ?, ?)")
        .run("Main Portfolio", new Date().toISOString());
    }
  } catch (err) {
    console.warn("[db] portfolios seed skipped:", err instanceof Error ? err.message : err);
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
  target_direction: string | null;
  alert_pct_drop: number | null;
  notes: string | null;
  stage: string | null;
  stage_changed_at: number | null;
  source: string | null;
  source_detail: string | null;
}

function rowToWatchlistItem(r: WatchlistRow): WatchlistItem {
  return {
    symbol: r.symbol,
    name: r.name,
    addedAt: r.added_at,
    // A stored 0 or a negative is not a price. Those rows exist because the old
    // editor accepted "0" (a truthy string), and they divided into the upside
    // formula as +Infinity%. Normalized away on read so no consumer inherits it.
    targetPrice: isUsablePrice(r.target_price) ? r.target_price : null,
    targetDirection: r.target_direction === "above" || r.target_direction === "below" ? r.target_direction : null,
    alertPctDrop: r.alert_pct_drop ?? null,
    notes: r.notes ?? null,
    stage: isIdeaStage(r.stage) ? r.stage : "surfaced",
    stageChangedAt: r.stage_changed_at ?? null,
    // An unrecognized stored value reads as "not recorded", never as a default
    // surface: a row written by a future build with a source this build doesn't
    // know is honestly unknown to us, and so is a legacy NULL.
    source: isIdeaSource(r.source) ? r.source : null,
    sourceDetail: r.source_detail ?? null,
  };
}

const WATCHLIST_COLUMNS =
  "symbol, name, added_at, target_price, target_direction, alert_pct_drop, notes, stage, stage_changed_at, source, source_detail";

/**
 * Every tracked symbol, across every named list.
 *
 * Signature deliberately unchanged and unparameterized. Ten callers depend on it
 * — the alert monitor, the timeline, the knowledge graph, the calendar, the home
 * digest, the pipeline board, the CSV export, the AI digest — and every one of
 * them means "everything I am tracking", not "one tab of it". Introducing named
 * lists must not silently narrow any of those. Use {@link listWatchlistByGroup}
 * when you specifically want one list.
 */
export function listWatchlist(): WatchlistItem[] {
  const rows = getDb()
    .prepare(`SELECT ${WATCHLIST_COLUMNS} FROM watchlist ORDER BY added_at DESC`)
    .all() as unknown as WatchlistRow[];
  return rows.map(rowToWatchlistItem);
}

/* -------------------------------------------------------------------------- */
/* Named watchlists                                                            */
/* -------------------------------------------------------------------------- */

export const DEFAULT_WATCHLIST_NAME = "My Watchlist";

interface WatchlistGroupRow {
  id: number;
  name: string;
  benchmark: string | null;
  sort_order: number;
  created_at: number;
  count: number;
}

export function listWatchlistGroups(): WatchlistGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.name, g.benchmark, g.sort_order, g.created_at,
              (SELECT COUNT(*) FROM watchlist_member m WHERE m.group_id = g.id) AS count
       FROM watchlist_group g
       ORDER BY g.sort_order, g.id`,
    )
    .all() as unknown as WatchlistGroupRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    benchmark: r.benchmark ?? null,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    count: r.count,
  }));
}

/** The list a bare "add to watchlist" lands in — the first by display order. */
export function defaultWatchlistGroupId(): number {
  const row = getDb()
    .prepare("SELECT id FROM watchlist_group ORDER BY sort_order, id LIMIT 1")
    .get() as { id: number } | undefined;
  if (row) return row.id;
  // No lists at all (a DB whose migration was skipped). Create one rather than
  // failing the write — a symbol must always have somewhere to go.
  const now = Date.now();
  getDb()
    .prepare("INSERT INTO watchlist_group (name, benchmark, sort_order, created_at) VALUES (?, ?, 0, ?)")
    .run(DEFAULT_WATCHLIST_NAME, "SPY", now);
  return (getDb().prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

export function createWatchlistGroup(name: string, benchmark: string | null = null): WatchlistGroup {
  const db = getDb();
  const next = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM watchlist_group").get() as { n: number };
  const now = Date.now();
  db.prepare("INSERT INTO watchlist_group (name, benchmark, sort_order, created_at) VALUES (?, ?, ?, ?)")
    .run(name, benchmark, next.n, now);
  const id = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
  return { id, name, benchmark, sortOrder: next.n, createdAt: now, count: 0 };
}

export function updateWatchlistGroup(
  id: number,
  patch: { name?: string; benchmark?: string | null },
): void {
  const db = getDb();
  if (patch.name !== undefined) {
    db.prepare("UPDATE watchlist_group SET name = ? WHERE id = ?").run(patch.name, id);
  }
  if ("benchmark" in patch) {
    db.prepare("UPDATE watchlist_group SET benchmark = ? WHERE id = ?").run(patch.benchmark ?? null, id);
  }
}

/**
 * Delete a list. Refuses to remove the last one — the page has no coherent state
 * with zero lists, and "delete everything" is not what the button means.
 *
 * Symbols that were only in this list keep their research state (target, thesis,
 * stage) and are moved to the surviving default list rather than destroyed:
 * deleting a *view* must not silently delete months of notes.
 */
export function deleteWatchlistGroup(id: number): { deleted: boolean; reason?: string; movedSymbols: number } {
  const db = getDb();
  const total = db.prepare("SELECT COUNT(*) AS n FROM watchlist_group").get() as { n: number };
  if (total.n <= 1) return { deleted: false, reason: "You need at least one watchlist.", movedSymbols: 0 };

  const survivor = db
    .prepare("SELECT id FROM watchlist_group WHERE id != ? ORDER BY sort_order, id LIMIT 1")
    .get(id) as { id: number } | undefined;
  if (!survivor) return { deleted: false, reason: "No other watchlist to move symbols into.", movedSymbols: 0 };

  const orphans = db
    .prepare(
      `SELECT symbol FROM watchlist_member
       WHERE group_id = ?
         AND symbol NOT IN (SELECT symbol FROM watchlist_member WHERE group_id != ?)`,
    )
    .all(id, id) as unknown as { symbol: string }[];

  const insert = db.prepare("INSERT OR IGNORE INTO watchlist_member (group_id, symbol, added_at) VALUES (?, ?, ?)");
  const now = new Date().toISOString();
  for (const o of orphans) insert.run(survivor.id, o.symbol, now);

  db.prepare("DELETE FROM watchlist_member WHERE group_id = ?").run(id);
  db.prepare("DELETE FROM watchlist_group WHERE id = ?").run(id);
  return { deleted: true, movedSymbols: orphans.length };
}

/** Copy a list's membership into a new list. Research state is shared, not cloned. */
export function duplicateWatchlistGroup(id: number, name: string): WatchlistGroup | null {
  const db = getDb();
  const source = db.prepare("SELECT benchmark FROM watchlist_group WHERE id = ?").get(id) as
    | { benchmark: string | null }
    | undefined;
  if (!source) return null;
  const group = createWatchlistGroup(name, source.benchmark ?? null);
  db.prepare(
    `INSERT OR IGNORE INTO watchlist_member (group_id, symbol, added_at)
     SELECT ?, symbol, added_at FROM watchlist_member WHERE group_id = ?`,
  ).run(group.id, id);
  const count = db.prepare("SELECT COUNT(*) AS n FROM watchlist_member WHERE group_id = ?").get(group.id) as { n: number };
  return { ...group, count: count.n };
}

/** Persist an explicit display order. Ids not supplied keep their current order. */
export function reorderWatchlistGroups(orderedIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE watchlist_group SET sort_order = ? WHERE id = ?");
  orderedIds.forEach((id, index) => stmt.run(index, id));
}

/** One list's symbols, newest membership first. */
export function listWatchlistByGroup(groupId: number): WatchlistItem[] {
  const rows = getDb()
    .prepare(
      `SELECT ${WATCHLIST_COLUMNS.split(", ").map((c) => `w.${c}`).join(", ")}
       FROM watchlist w
       JOIN watchlist_member m ON m.symbol = w.symbol
       WHERE m.group_id = ?
       ORDER BY m.added_at DESC`,
    )
    .all(groupId) as unknown as WatchlistRow[];
  return rows.map(rowToWatchlistItem);
}

/** Which lists a symbol currently appears in. */
export function groupsForSymbol(symbol: string): number[] {
  const rows = getDb()
    .prepare("SELECT group_id FROM watchlist_member WHERE symbol = ? ORDER BY group_id")
    .all(symbol.toUpperCase()) as unknown as { group_id: number }[];
  return rows.map((r) => r.group_id);
}

export function addSymbolToGroup(symbol: string, groupId: number): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO watchlist_member (group_id, symbol, added_at) VALUES (?, ?, ?)")
    .run(groupId, symbol.toUpperCase(), new Date().toISOString());
}

/**
 * Remove a symbol from one list. Its research state — and the `watchlist` row —
 * survive as long as it is still in some other list; only the last removal
 * deletes the underlying row.
 */
export function removeSymbolFromGroup(symbol: string, groupId: number): { removedEntirely: boolean } {
  const db = getDb();
  const sym = symbol.toUpperCase();
  db.prepare("DELETE FROM watchlist_member WHERE group_id = ? AND symbol = ?").run(groupId, sym);
  const remaining = db.prepare("SELECT COUNT(*) AS n FROM watchlist_member WHERE symbol = ?").get(sym) as { n: number };
  if (remaining.n === 0) {
    removeFromWatchlist(sym);
    return { removedEntirely: true };
  }
  return { removedEntirely: false };
}

/* -------------------------------------------------------------------------- */
/* Target revision history                                                     */
/* -------------------------------------------------------------------------- */

interface TargetRevisionRow {
  id: number;
  symbol: string;
  previous_target: number | null;
  new_target: number | null;
  previous_direction: string | null;
  new_direction: string | null;
  note: string | null;
  changed_at: number;
}

const asDirection = (v: string | null): TargetDirection | null =>
  v === "above" || v === "below" ? v : null;

export function recordTargetRevision(input: {
  symbol: string;
  previousTarget: number | null;
  newTarget: number | null;
  previousDirection: TargetDirection | null;
  newDirection: TargetDirection | null;
  note?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO watchlist_target_history
         (symbol, previous_target, new_target, previous_direction, new_direction, note, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.symbol.toUpperCase(),
      input.previousTarget,
      input.newTarget,
      input.previousDirection,
      input.newDirection,
      input.note?.trim() || null,
      Date.now(),
    );
}

export function listTargetRevisions(symbol: string, limit = 25): TargetRevision[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM watchlist_target_history WHERE symbol = ? ORDER BY changed_at DESC, id DESC LIMIT ?`,
    )
    .all(symbol.toUpperCase(), limit) as unknown as TargetRevisionRow[];
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    previousTarget: r.previous_target ?? null,
    newTarget: r.new_target ?? null,
    previousDirection: asDirection(r.previous_direction),
    newDirection: asDirection(r.new_direction),
    note: r.note ?? null,
    changedAt: r.changed_at,
  }));
}

/** Revision counts for a set of symbols, so the UI can show a badge without N queries. */
export function targetRevisionCounts(symbols: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  const placeholders = symbols.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT symbol, COUNT(*) AS n FROM watchlist_target_history
       WHERE symbol IN (${placeholders}) GROUP BY symbol`,
    )
    .all(...symbols.map((s) => s.toUpperCase())) as unknown as { symbol: string; n: number }[];
  for (const r of rows) out.set(r.symbol, r.n);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Crossing detection state                                                    */
/* -------------------------------------------------------------------------- */

export interface PriceAlertState {
  symbol: string;
  lastPrice: number;
  lastChangePercent: number | null;
  lastSeenAt: number;
}

export function getPriceAlertStates(symbols: string[]): Map<string, PriceAlertState> {
  const out = new Map<string, PriceAlertState>();
  if (symbols.length === 0) return out;
  const placeholders = symbols.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT symbol, last_price, last_change_percent, last_seen_at
       FROM price_alert_state WHERE symbol IN (${placeholders})`,
    )
    .all(...symbols.map((s) => s.toUpperCase())) as unknown as {
    symbol: string;
    last_price: number;
    last_change_percent: number | null;
    last_seen_at: number;
  }[];
  for (const r of rows) {
    out.set(r.symbol, {
      symbol: r.symbol,
      lastPrice: r.last_price,
      lastChangePercent: r.last_change_percent ?? null,
      lastSeenAt: r.last_seen_at,
    });
  }
  return out;
}

export function putPriceAlertStates(
  entries: { symbol: string; price: number; changePercent?: number | null }[],
  now = Date.now(),
): void {
  if (entries.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO price_alert_state (symbol, last_price, last_change_percent, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       last_price = excluded.last_price,
       last_change_percent = excluded.last_change_percent,
       last_seen_at = excluded.last_seen_at`,
  );
  for (const e of entries) {
    if (!Number.isFinite(e.price) || e.price <= 0) continue;
    const chg = e.changePercent != null && Number.isFinite(e.changePercent) ? e.changePercent : null;
    stmt.run(e.symbol.toUpperCase(), e.price, chg, now);
  }
}

/**
 * Record a target's direction without the side effects of a user edit.
 *
 * `updateWatchlistItem` deliberately writes a revision row and re-arms crossing
 * detection whenever a target changes — correct for a person changing their mind,
 * wrong for the monitor filling in a column that was simply never populated.
 * Using the user-facing path here would fabricate a "revision" the user never
 * made and reset the very baseline the backfill exists to make usable.
 */
export function backfillTargetDirection(symbol: string, direction: TargetDirection): void {
  getDb()
    .prepare("UPDATE watchlist SET target_direction = ? WHERE symbol = ? AND target_direction IS NULL")
    .run(direction, symbol.toUpperCase());
}

/**
 * Forget the observed price for a symbol, so the next evaluation re-arms instead
 * of comparing against a baseline taken under a different target.
 *
 * Called whenever a target changes. Without it, moving a target from $260 to
 * $150 while the price sat at $190 would make the *next* tick look like a
 * downward crossing of $150 that never happened.
 */
export function resetPriceAlertState(symbol: string): void {
  getDb().prepare("DELETE FROM price_alert_state WHERE symbol = ?").run(symbol.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Idea lifecycle — stage reads/writes (§4.5)                                  */
/* -------------------------------------------------------------------------- */

export function getIdeaStage(symbol: string): IdeaStage | null {
  const row = getDb()
    .prepare("SELECT stage FROM watchlist WHERE symbol = ?")
    .get(symbol.toUpperCase()) as { stage: string | null } | undefined;
  if (!row) return null;
  return isIdeaStage(row.stage) ? row.stage : "surfaced";
}

/**
 * Set a symbol's lifecycle stage. Returns whether the stage actually changed
 * and what it was before — the caller uses that to raise a Journal prompt
 * exactly once per real transition (§4.5). `stage_changed_at` is only bumped on
 * a real change, so "days in stage" stays honest.
 *
 * `createIfMissing` adds the symbol to the pipeline at the given stage when it
 * isn't tracked yet — how a buy of an untracked name becomes an `owned` idea
 * (one pipeline, one object; §4.5 / P11). Without it, a no-op on an untracked
 * symbol (a partial sell of a name never watched).
 */
export function setIdeaStage(
  symbol: string,
  stage: IdeaStage,
  opts: { createIfMissing?: boolean; name?: string; origin?: { source: IdeaSource; detail?: string | null } } = {},
): { changed: boolean; from: IdeaStage | null } {
  const db = getDb();
  const sym = symbol.toUpperCase();
  const from = getIdeaStage(sym);
  const now = Date.now();

  if (from === null) {
    if (!opts.createIfMissing) return { changed: false, from: null };
    db.prepare(
      `INSERT INTO watchlist (symbol, name, added_at, stage, stage_changed_at, source, source_detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         stage = excluded.stage,
         stage_changed_at = excluded.stage_changed_at,
         source = COALESCE(watchlist.source, excluded.source),
         source_detail = COALESCE(watchlist.source_detail, excluded.source_detail)`,
    ).run(
      sym,
      opts.name ?? sym,
      new Date(now).toISOString(),
      stage,
      now,
      opts.origin?.source ?? null,
      opts.origin?.detail ?? null,
    );
    return { changed: true, from: null };
  }

  if (from === stage) return { changed: false, from };
  db.prepare("UPDATE watchlist SET stage = ?, stage_changed_at = ? WHERE symbol = ?").run(stage, now, sym);
  return { changed: true, from };
}

/**
 * Bring every stored `owned` stage back in line with the ledger.
 *
 * {@link reconcileStageForLedgerWrite} only fires on the two INSERT primitives,
 * so every path that *removes* holdings — removeLot, removePosition, the
 * replace-the-ledger upserts, restoreSnapshot (Undo) — used to leave `owned`
 * behind on names the portfolio no longer held. That is how BND and VTI came to
 * sit in the Pipeline's Owned column, and on the Watchlist's Stage column, for a
 * portfolio whose ledger contains neither: their buys wrote the stage, the lots
 * were deleted, and nothing told the stage.
 *
 * The Pipeline board derives its columns through `effectiveStage()` and so is
 * correct either way; this exists so the *stored* value every other surface
 * reads stops drifting. Returns how many rows it changed.
 */
export function reconcileOwnedStages(portfolioId = 1): number {
  const heldSymbols = new Set(
    aggregateOpenPositions(listLots(undefined, portfolioId))
      .filter((p) => p.shares > 1e-9 && isPipelineSymbol(p.symbol))
      .map((p) => p.symbol.toUpperCase()),
  );

  let changed = 0;
  for (const row of listWatchlist()) {
    const next = effectiveStage(row.stage, heldSymbols.has(row.symbol.toUpperCase()));
    if (next !== row.stage && setIdeaStage(row.symbol, next).changed) changed++;
  }
  return changed;
}

/**
 * Auto-transition a symbol's stage after a ledger write (§4.5). Buy → owned
 * (adding the name to the pipeline if untracked); a sell that fully closes the
 * position → exited (only for names already tracked). Called from the two
 * ledger write primitives so every buy/sell path reconciles the pipeline
 * without each route wiring it. Descriptive only — never blocks the write.
 */
function reconcileStageForLedgerWrite(symbol: string, name: string, kind: "buy" | "sell", assetClass: string): void {
  const stillHeld =
    kind === "sell"
      ? aggregateOpenPositions(listLots(symbol.toUpperCase())).some(
          (p) => p.symbol.toUpperCase() === symbol.toUpperCase() && p.shares > 1e-9,
        )
      : true;
  const next = autoStageForTrade({ kind, assetClass, symbol, stillHeld });
  if (!next) return;
  try {
    // A buy of an untracked name is a real, knowable provenance: the idea entered
    // the pipeline BY being bought, rather than being researched and then bought.
    setIdeaStage(symbol, next, {
      createIfMissing: next === "owned",
      name,
      origin: { source: "ledger", detail: `${assetClass} position opened` },
    });
  } catch {
    /* stage reconciliation must never break a trade write */
  }
}

/**
 * Track a symbol.
 *
 * `origin` records WHICH surface produced the idea (lib/idea-source.ts). It is
 * optional so no caller breaks, but an omitted origin stores NULL — which reads
 * as "origin not recorded" rather than as a default — so every add path should
 * pass one. On conflict the EARLIEST origin is kept: provenance answers where an
 * idea came from, and re-adding a screened name from Research must not rewrite
 * its history.
 */
export function addToWatchlist(
  symbol: string,
  name: string,
  groupId?: number,
  origin?: { source: IdeaSource; detail?: string | null },
): WatchlistItem {
  const sym = symbol.toUpperCase();
  const db = getDb();
  db.prepare(
    `INSERT INTO watchlist (symbol, name, added_at, source, source_detail) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       name = excluded.name,
       source = COALESCE(watchlist.source, excluded.source),
       source_detail = COALESCE(watchlist.source_detail, excluded.source_detail)`,
  ).run(sym, name, new Date().toISOString(), origin?.source ?? null, origin?.detail ?? null);
  // Membership is what makes the symbol visible in a named list. Callers that
  // predate named lists (Research's "add to watchlist", the command palette)
  // pass no group and land in the default one.
  try {
    addSymbolToGroup(sym, groupId ?? defaultWatchlistGroupId());
  } catch {
    /* the settings row is written either way; a missing membership self-heals on boot */
  }
  // Re-adding an already-tracked symbol only touches `name` (and fills a NULL
  // origin) on conflict — read the row back rather than fabricating fresh/null
  // fields, so a re-add never reports a reset addedAt or discards an existing
  // target price/direction, alert threshold, notes or stage. Reading back also
  // settles provenance correctly: on conflict the stored, EARLIER origin wins, so
  // echoing what this call passed would misreport what is now persisted.
  const row = db
    .prepare(`SELECT ${WATCHLIST_COLUMNS} FROM watchlist WHERE symbol = ?`)
    .get(sym) as unknown as WatchlistRow;
  return rowToWatchlistItem(row);
}

/** The persisted origin of a tracked symbol, or null when it isn't tracked. */
export function getIdeaOrigin(symbol: string): { source: IdeaSource | null; detail: string | null } | null {
  const row = getDb()
    .prepare("SELECT source, source_detail FROM watchlist WHERE symbol = ?")
    .get(symbol.toUpperCase()) as { source: string | null; source_detail: string | null } | undefined;
  if (!row) return null;
  return {
    source: isIdeaSource(row.source) ? row.source : null,
    detail: row.source_detail ?? null,
  };
}

export function updateWatchlistItem(
  symbol: string,
  patch: {
    targetPrice?: number | null;
    targetDirection?: TargetDirection | null;
    alertPctDrop?: number | null;
    notes?: string | null;
    /** Optional rationale, stored against the target revision this write creates. */
    targetNote?: string | null;
  },
): void {
  const db = getDb();

  /* Record the revision BEFORE mutating, while the previous values are still
     readable, and only when the target actually changed — re-saving the same
     number should not manufacture a history entry. Also re-arms crossing
     detection: a baseline captured under the old target would make the next
     tick look like a crossing of the new one. */
  const touchesTarget = "targetPrice" in patch || "targetDirection" in patch;
  if (touchesTarget) {
    const before = db
      .prepare("SELECT target_price, target_direction FROM watchlist WHERE symbol = ?")
      .get(symbol.toUpperCase()) as { target_price: number | null; target_direction: string | null } | undefined;
    const prevTarget = isUsablePrice(before?.target_price) ? before!.target_price : null;
    const prevDirection = asDirection(before?.target_direction ?? null);
    const nextTarget =
      "targetPrice" in patch ? (isUsablePrice(patch.targetPrice) ? patch.targetPrice! : null) : prevTarget;
    const nextDirection =
      "targetDirection" in patch
        ? patch.targetDirection === "above" || patch.targetDirection === "below"
          ? patch.targetDirection
          : null
        : prevDirection;

    if (prevTarget !== nextTarget || prevDirection !== nextDirection) {
      try {
        recordTargetRevision({
          symbol,
          previousTarget: prevTarget,
          newTarget: nextTarget,
          previousDirection: prevDirection,
          newDirection: nextDirection,
          note: patch.targetNote ?? null,
        });
      } catch {
        /* history is an audit trail, never a gate on the write itself */
      }
      try {
        resetPriceAlertState(symbol);
      } catch {
        /* re-arm is best-effort; a stale baseline self-corrects on the next tick */
      }
    }
  }

  if ("targetPrice" in patch) {
    // Only a usable price is stored. Clearing the target also clears its
    // direction, so a later target can never inherit a stale one.
    const next = isUsablePrice(patch.targetPrice) ? patch.targetPrice : null;
    db.prepare("UPDATE watchlist SET target_price = ? WHERE symbol = ?")
      .run(next, symbol.toUpperCase());
    if (next == null) {
      db.prepare("UPDATE watchlist SET target_direction = NULL WHERE symbol = ?")
        .run(symbol.toUpperCase());
    }
  }
  if ("targetDirection" in patch) {
    const dir = patch.targetDirection === "above" || patch.targetDirection === "below" ? patch.targetDirection : null;
    db.prepare("UPDATE watchlist SET target_direction = ? WHERE symbol = ?")
      .run(dir, symbol.toUpperCase());
  }
  if ("alertPctDrop" in patch) {
    // A drop threshold is a magnitude; a stored negative would make the
    // evaluator's `changePercent <= -threshold` test fire on every up day.
    const pct = patch.alertPctDrop;
    const next = typeof pct === "number" && Number.isFinite(pct) && pct > 0 ? Math.abs(pct) : null;
    db.prepare("UPDATE watchlist SET alert_pct_drop = ? WHERE symbol = ?")
      .run(next, symbol.toUpperCase());
  }
  if ("notes" in patch) {
    db.prepare("UPDATE watchlist SET notes = ? WHERE symbol = ?")
      .run(patch.notes ?? null, symbol.toUpperCase());
  }
}

/**
 * Remove a symbol's research state entirely, along with everything keyed to it.
 *
 * The associated rows have to go too. Leaving them behind means re-adding the
 * symbol months later resurrects a "Target history: 3 changes" panel describing
 * decisions about a position the user has already discarded, and an alert
 * baseline captured under a target that no longer exists. The UI promises that
 * removing a name deletes "its target, alerts and thesis" — this is what makes
 * that promise true.
 */
export function removeFromWatchlist(symbol: string): void {
  const db = getDb();
  const sym = symbol.toUpperCase();
  db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(sym);
  db.prepare("DELETE FROM watchlist_member WHERE symbol = ?").run(sym);
  for (const sql of [
    "DELETE FROM watchlist_target_history WHERE symbol = ?",
    "DELETE FROM price_alert_state WHERE symbol = ?",
  ]) {
    // Guarded individually: on a database that predates either table, the
    // primary deletion above must still succeed.
    try { db.prepare(sql).run(sym); } catch { /* table absent — nothing to clean */ }
  }
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
  currency: string | null;
  meta: string | null;
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
    // The ledger is the only surviving record of a CLOSED position's currency, so
    // this has to travel with the lot. Dropping it made a closed foreign position's
    // realized P&L convert at 1.0.
    currency: (r.currency ?? undefined) || undefined,
    // Provenance travels with the lot. The performance engine needs it to tell a
    // deposit from the Transaction Engine's value-conserving cash plug; dropping
    // it here is what let internal bookkeeping be counted as invested capital.
    meta: parseLotMeta(r.meta),
  };
}

function parseLotMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** All lots for a symbol (or the whole ledger when omitted), oldest first. */
export function listLots(symbol?: string, portfolioId = 1): PortfolioLot[] {
  const db = getDb();
  const rows = (
    symbol
      ? db.prepare("SELECT * FROM portfolio_lot WHERE symbol = ? AND portfolio_id = ? ORDER BY trade_date, id").all(symbol.toUpperCase(), portfolioId)
      : db.prepare("SELECT * FROM portfolio_lot WHERE portfolio_id = ? ORDER BY trade_date, id").all(portfolioId)
  ) as unknown as PortfolioLotRow[];
  return rows.map(rowToLot);
}

/**
 * The holdings view: aggregate every symbol's lots into a position (average-cost
 * method), newest-inception first, closed positions excluded. Shape-compatible
 * with the previous single-row-per-symbol model, so all existing consumers are
 * untouched.
 */
export function listPortfolio(portfolioId = 1): PortfolioPosition[] {
  return aggregateOpenPositions(listLots(undefined, portfolioId)).map((p) => ({
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
  portfolioId = 1,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at, portfolio_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      portfolioId,
    );
}

/** Remove a single transaction by id (for editing a ledger). */
export function removeLot(id: number): void {
  getDb().prepare("DELETE FROM portfolio_lot WHERE id = ?").run(id);
  reconcileOwnedStages();
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
  portfolioId = 1,
): PortfolioPosition {
  const sym = symbol.toUpperCase();
  const addedAt = new Date().toISOString();
  const db = getDb();
  db.prepare("DELETE FROM portfolio_lot WHERE symbol = ? AND portfolio_id = ?").run(sym, portfolioId);
  db.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at, portfolio_id)
     VALUES (?, ?, ?, ?, 'buy', 0, ?, ?, ?)`,
  ).run(sym, name, shares, avgCost, addedAt.slice(0, 10), addedAt, portfolioId);
  reconcileOwnedStages(portfolioId);
  return { symbol: sym, name, shares, avgCost, addedAt };
}

export function removePosition(symbol: string, portfolioId = 1): void {
  getDb().prepare("DELETE FROM portfolio_lot WHERE symbol = ? AND portfolio_id = ?").run(symbol.toUpperCase(), portfolioId);
  reconcileOwnedStages(portfolioId);
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

export function listUniversalLots(portfolioId = 1): UniversalLotRow[] {
  return getDb()
    .prepare("SELECT * FROM portfolio_lot WHERE portfolio_id = ? ORDER BY trade_date, id")
    .all(portfolioId) as unknown as UniversalLotRow[];
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
}, portfolioId = 1): void {
  const sym = input.symbol.toUpperCase();
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare("DELETE FROM portfolio_lot WHERE symbol = ? AND portfolio_id = ?").run(sym, portfolioId);
  db.prepare(
    `INSERT INTO portfolio_lot
       (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta, portfolio_id)
     VALUES (?, ?, ?, ?, 'buy', 0, ?, ?, ?, ?, ?, ?, ?)`,
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
    portfolioId,
  );
  // This REPLACES the symbol's ledger, so it can close a position as easily as
  // open one (an edit to 0 shares) — reconcile rather than assume a buy.
  reconcileOwnedStages(portfolioId);
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
}, portfolioId = 1): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO portfolio_lot
         (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta, portfolio_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      portfolioId,
    );
  reconcileStageForLedgerWrite(input.symbol, input.name, input.kind, input.assetClass);
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
export function executeTradeBatch(lots: LotWrite[], manualAssetIdsToDelete: string[], portfolioId = 1): void {
  if (lots.length === 0 && manualAssetIdsToDelete.length === 0) return;
  const database = getDb();
  const now = new Date().toISOString();
  const lotStmt = database.prepare(
    `INSERT INTO portfolio_lot (symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta, portfolio_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
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
        portfolioId,
      );
    }
    for (const id of manualAssetIdsToDelete) manualStmt.run(id);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  // Reconcile pipeline stages AFTER the batch commits, so a rebalance that fully
  // exits a position marks it `exited` and any buy marks its symbol `owned`.
  for (const lot of lots) {
    reconcileStageForLedgerWrite(lot.symbol, lot.name, lot.kind, lot.assetClass);
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
  portfolioId = 1,
): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const database = getDb();
  const lots = database.prepare("SELECT * FROM portfolio_lot WHERE portfolio_id = ?").all(portfolioId) as unknown as UniversalLotRow[];
  const manualAssets = database.prepare("SELECT * FROM manual_asset WHERE portfolio_id = ?").all(portfolioId) as unknown as ManualAssetRow[];
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO portfolio_snapshot (id, label, objective, holdings, summary, created_at, portfolio_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, label, objective, JSON.stringify({ lots, manualAssets }), JSON.stringify(summary), now, portfolioId);
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
  const row = getDb().prepare("SELECT holdings, portfolio_id FROM portfolio_snapshot WHERE id = ?").get(id) as unknown as { holdings: string; portfolio_id: number } | undefined;
  if (!row) return false;
  const { lots, manualAssets } = JSON.parse(row.holdings) as { lots: UniversalLotRow[]; manualAssets: ManualAssetRow[] };
  // Undo is scoped to the snapshot's own portfolio — restoring Main must not
  // wipe a promoted portfolio's ledger, and vice versa.
  const portfolioId = row.portfolio_id ?? 1;

  const database = getDb();
  const insertLot = database.prepare(
    `INSERT INTO portfolio_lot (id, symbol, name, shares, price, kind, fees, trade_date, created_at, asset_class, currency, unit, meta, portfolio_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertManual = database.prepare(
    `INSERT INTO manual_asset (id, category, name, acquisition_date, acquisition_cost, current_value, current_value_as_of, notes, details, created_at, updated_at, portfolio_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM portfolio_lot WHERE portfolio_id = ?").run(portfolioId);
    database.prepare("DELETE FROM manual_asset WHERE portfolio_id = ?").run(portfolioId);
    for (const l of lots) {
      insertLot.run(l.id, l.symbol, l.name, l.shares, l.price, l.kind, l.fees, l.trade_date, l.created_at, l.asset_class, l.currency, l.unit, l.meta, portfolioId);
    }
    for (const m of manualAssets) {
      insertManual.run(m.id, m.category, m.name, m.acquisition_date, m.acquisition_cost, m.current_value, m.current_value_as_of, m.notes, m.details, m.created_at, m.updated_at, portfolioId);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  // Undo rewinds the ledger, so it must rewind what the ledger implied: without
  // this, undoing a rebalance left every name it bought sitting in the Pipeline's
  // Owned column forever. After the commit — the stage table is not part of the
  // snapshot and must not be rolled back with it.
  reconcileOwnedStages(portfolioId);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Named portfolios                                                           */
/* -------------------------------------------------------------------------- */

export interface PortfolioMeta {
  id: number;
  name: string;
  createdAt: string;
}

export function listPortfolios(): PortfolioMeta[] {
  const rows = getDb().prepare("SELECT id, name, created_at FROM portfolios ORDER BY id").all() as unknown as {
    id: number;
    name: string;
    created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export function getPortfolioMeta(id: number): PortfolioMeta | null {
  const r = getDb().prepare("SELECT id, name, created_at FROM portfolios WHERE id = ?").get(id) as unknown as
    | { id: number; name: string; created_at: string }
    | undefined;
  return r ? { id: r.id, name: r.name, createdAt: r.created_at } : null;
}

export function createPortfolio(name: string): PortfolioMeta {
  const now = new Date().toISOString();
  const res = getDb().prepare("INSERT INTO portfolios (name, created_at) VALUES (?, ?)").run(name, now);
  return { id: Number(res.lastInsertRowid), name, createdAt: now };
}

/* -------------------------------------------------------------------------- */
/* Simulator — hypothetical portfolios                                        */
/* -------------------------------------------------------------------------- */

interface SimulationRow {
  id: string;
  name: string;
  status: string;
  profile: string;
  holdings: string;
  thesis: string | null;
  headline: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSimulation(r: SimulationRow): Simulation {
  return {
    id: r.id,
    name: r.name,
    status: r.status as Simulation["status"],
    // Normalized, not just parsed. `JSON.parse` + cast asserts a shape the
    // stored JSON does not necessarily have: rows written before `preferences`
    // was added to SimProfile deserialize without it, and generation dereferences
    // it immediately. This is the one place stored JSON becomes a SimProfile, so
    // normalizing here is what makes the declared type true for every caller.
    profile: normalizeStoredProfile(JSON.parse(r.profile)),
    holdings: JSON.parse(r.holdings),
    thesis: r.thesis ? JSON.parse(r.thesis) : null,
    headline: r.headline ? JSON.parse(r.headline) : null,
    promotedAt: r.promoted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createSimulation(name: string, profile: SimProfile): Simulation {
  const id = globalThis.crypto?.randomUUID?.() ?? `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO simulation (id, name, status, profile, holdings, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, '[]', ?, ?)`,
    )
    .run(id, name, JSON.stringify(profile), now, now);
  return getSimulation(id)!;
}

export function getSimulation(id: string): Simulation | null {
  const r = getDb().prepare("SELECT * FROM simulation WHERE id = ?").get(id) as unknown as SimulationRow | undefined;
  return r ? rowToSimulation(r) : null;
}

export function listSimulations(): Simulation[] {
  const rows = getDb().prepare("SELECT * FROM simulation ORDER BY updated_at DESC").all() as unknown as SimulationRow[];
  return rows.map(rowToSimulation);
}

export interface SimulationPatch {
  name?: string;
  status?: Simulation["status"];
  profile?: SimProfile;
  holdings?: SimHolding[];
  thesis?: SimThesis | null;
  headline?: SimHeadline | null;
  promotedAt?: string | null;
}

/** Partial update; only the provided fields change. Returns the fresh row. */
export function updateSimulation(id: string, patch: SimulationPatch): Simulation | null {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name); }
  if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.profile !== undefined) { sets.push("profile = ?"); args.push(JSON.stringify(patch.profile)); }
  if (patch.holdings !== undefined) { sets.push("holdings = ?"); args.push(JSON.stringify(patch.holdings)); }
  if (patch.thesis !== undefined) { sets.push("thesis = ?"); args.push(patch.thesis ? JSON.stringify(patch.thesis) : null); }
  if (patch.headline !== undefined) { sets.push("headline = ?"); args.push(patch.headline ? JSON.stringify(patch.headline) : null); }
  if (patch.promotedAt !== undefined) { sets.push("promoted_at = ?"); args.push(patch.promotedAt); }
  if (sets.length === 0) return getSimulation(id);
  sets.push("updated_at = ?");
  args.push(new Date().toISOString());
  const res = getDb().prepare(`UPDATE simulation SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  return res.changes > 0 ? getSimulation(id) : null;
}

export function deleteSimulation(id: string): boolean {
  return getDb().prepare("DELETE FROM simulation WHERE id = ?").run(id).changes > 0;
}

/** Copy of everything except identity/status — a duplicate is always a fresh
 * un-promoted draft of the same spec, never a second claim to a promotion. */
export function duplicateSimulation(id: string): Simulation | null {
  const src = getSimulation(id);
  if (!src) return null;
  const newId = globalThis.crypto?.randomUUID?.() ?? `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  // Stay within the same 80-char name cap the API enforces on create/rename.
  const copyName = `${src.name.slice(0, 73)} (copy)`;
  getDb()
    .prepare(
      `INSERT INTO simulation (id, name, status, profile, holdings, thesis, headline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId,
      copyName,
      src.status === "promoted" ? "complete" : src.status,
      JSON.stringify(src.profile),
      JSON.stringify(src.holdings),
      src.thesis ? JSON.stringify(src.thesis) : null,
      src.headline ? JSON.stringify(src.headline) : null,
      now,
      now,
    );
  return getSimulation(newId);
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
  case_version: number | null;
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
    caseVersion: r.case_version ?? null,
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
  /** Version of the symbol's valuation case this call was made against. */
  caseVersion?: number | null;
}

export function createDecision(input: CreateDecisionInput): Decision {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO decision
        (symbol, name, action, conviction, thesis, price_at, currency, target_price, horizon, fit_score, fit_tier, status, created_at, case_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
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
      input.caseVersion ?? null,
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

export function listManualAssets(category?: ManualAssetCategory, portfolioId = 1): ManualAsset[] {
  const rows = category
    ? (getDb().prepare("SELECT * FROM manual_asset WHERE category = ? AND portfolio_id = ? ORDER BY created_at DESC").all(category, portfolioId) as unknown as ManualAssetRow[])
    : (getDb().prepare("SELECT * FROM manual_asset WHERE portfolio_id = ? ORDER BY created_at DESC").all(portfolioId) as unknown as ManualAssetRow[]);
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

export function getScannerCache(cacheKey: string, ttlMs = SCANNER_CACHE_TTL): string | null {
  const cutoff = Date.now() - ttlMs;
  const row = getDb()
    .prepare("SELECT result, created_at FROM scanner_cache WHERE cache_key = ? AND created_at >= ?")
    .get(cacheKey, cutoff) as unknown as ScannerCacheRow | undefined;
  return row?.result ?? null;
}

export function putScannerCache(cacheKey: string, result: string, ttlMs = SCANNER_CACHE_TTL): void {
  getDb()
    .prepare(
      `INSERT INTO scanner_cache (cache_key, result, created_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result, created_at = excluded.created_at`,
    )
    .run(cacheKey, result, Date.now());
  // Prune entries older than the LONGEST TTL any caller uses (stage-level LLM
  // entries live 60 minutes — see lib/scanner/prompt-cache.ts), so a shorter-
  // lived writer can't evict a longer-lived reader's still-valid rows.
  const cutoff = Date.now() - Math.max(ttlMs, 60 * 60 * 1000);
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
/* Knowledge Graph snapshots — the previous graph per scope, kept so a fresh  */
/* build can report "what changed since your last visit". One row per scope   */
/* key ("symbol:AAPL", "portfolio", …), no global prune (see scanner_snapshot */
/* above for why scanner_cache is the wrong home for anything long-lived).    */
/* -------------------------------------------------------------------------- */

interface KgSnapshotRow {
  graph: string;
  generated_at: string;
}

export function getKgSnapshot(scopeKey: string): { graph: string; generatedAt: string } | null {
  const row = getDb()
    .prepare("SELECT graph, generated_at FROM kg_snapshot WHERE scope_key = ?")
    .get(scopeKey) as unknown as KgSnapshotRow | undefined;
  return row ? { graph: row.graph, generatedAt: row.generated_at } : null;
}

export function putKgSnapshot(scopeKey: string, graph: string, generatedAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO kg_snapshot (scope_key, graph, generated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET graph = excluded.graph, generated_at = excluded.generated_at`,
    )
    .run(scopeKey, graph, generatedAt);
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
  /** Symbols this screen matched the last time it was run. Empty until then. */
  lastSymbols: string[];
  /** When that snapshot was taken, for "changes since…" copy. */
  lastRunAt: string | null;
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
  last_symbols: string | null;
  last_run_at: string | null;
}

function toSavedScreen(r: SavedScreenRow): SavedScreen {
  let filters: Record<string, unknown> = {};
  try {
    filters = JSON.parse(r.filters) as Record<string, unknown>;
  } catch {
    // A corrupted filter blob must not take down the whole saved-screens list;
    // the screen loads with no filters and the user can re-set them.
  }
  let lastSymbols: string[] = [];
  try {
    const parsed = r.last_symbols ? (JSON.parse(r.last_symbols) as unknown) : [];
    if (Array.isArray(parsed)) lastSymbols = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // Same tolerance as the filter blob: a corrupt snapshot means "no baseline",
    // so the next load simply reports no changes instead of failing to open.
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
    lastSymbols,
    lastRunAt: r.last_run_at,
  };
}

/**
 * Record what a saved screen matched, so the next load can diff against it.
 *
 * Capped at 500 symbols: the point is to detect entries and exits among names a
 * human might act on, and a screen matching more than 500 is not a watchlist,
 * it's a universe. Storing all of them would bloat every row for no decision.
 */
export function recordScreenRun(id: string, symbols: string[]): void {
  getDb()
    .prepare("UPDATE saved_screen SET last_symbols = ?, last_run_at = ? WHERE id = ?")
    .run(JSON.stringify(symbols.slice(0, 500)), new Date().toISOString(), id);
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
export function saveScreen(
  // The run snapshot is derived, written by recordScreenRun, and never supplied
  // by a caller creating or editing a screen.
  input: Omit<SavedScreen, "createdAt" | "updatedAt" | "lastSymbols" | "lastRunAt">,
): SavedScreen {
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

  // An UPSERT preserves any existing run snapshot (the columns aren't in the
  // statement above), so re-saving a screen doesn't wipe its baseline; re-reading
  // is the honest way to report what's actually stored.
  return getSavedScreen(input.id) ?? { ...input, createdAt, updatedAt: now, lastSymbols: [], lastRunAt: null };
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

/**
 * When the user last visited one specific thing — the materiality lens's
 * "changed since your last visit" baseline. Read at page load, BEFORE the
 * current visit's debounced recordActivity() lands, so it still reports the
 * previous visit. Null = never visited (first visit skips the check).
 */
export function getActivityAt(kind: string, ref: string): string | null {
  const row = getDb()
    .prepare("SELECT at FROM activity WHERE kind = ? AND ref = ?")
    .get(kind, ref) as { at: string } | undefined;
  return row?.at ?? null;
}

/* -------------------------------------------------------------------------- */
/* Attention Queue dismissals (§13)                                            */
/* -------------------------------------------------------------------------- */

interface AttentionDismissalRow {
  dedupe_key: string;
  dismissed_at: number;
  expires_at: number;
}

/** Persist (or refresh) a dismissal of a story identity until `expiresAt`. */
export function dismissAttention(dedupeKey: string, dismissedAt: number, expiresAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO attention_dismissal (dedupe_key, dismissed_at, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET dismissed_at = excluded.dismissed_at, expires_at = excluded.expires_at`,
    )
    .run(dedupeKey, dismissedAt, expiresAt);
}

/** Remove a dismissal — the Undo path (§14). */
export function undismissAttention(dedupeKey: string): void {
  getDb().prepare("DELETE FROM attention_dismissal WHERE dedupe_key = ?").run(dedupeKey);
}

/**
 * Active (unexpired) dismissals, pruning lapsed rows opportunistically on read
 * (§12 — the queue never accumulates dead dismissal rows). The digest joins
 * this into its build server-side (§18).
 */
export function listActiveDismissals(now: number = Date.now()): AttentionDismissal[] {
  const db = getDb();
  db.prepare("DELETE FROM attention_dismissal WHERE expires_at <= ?").run(now);
  const rows = db
    .prepare("SELECT dedupe_key, dismissed_at, expires_at FROM attention_dismissal")
    .all() as unknown as AttentionDismissalRow[];
  return rows.map((r) => ({ dedupeKey: r.dedupe_key, dismissedAt: r.dismissed_at, expiresAt: r.expires_at }));
}

/* -------------------------------------------------------------------------- */
/* Home change-detection fingerprints (lib/home/changes.ts)                    */
/* -------------------------------------------------------------------------- */

export type HomeFingerprintSlot = "current" | "baseline";

/** The stored blob is opaque JSON here; lib/home/changes.ts owns its shape. */
export function getHomeFingerprint(slot: HomeFingerprintSlot): { data: string; takenAt: number } | null {
  const row = getDb()
    .prepare("SELECT data, taken_at FROM home_fingerprint WHERE slot = ?")
    .get(slot) as { data: string; taken_at: number } | undefined;
  return row ? { data: row.data, takenAt: row.taken_at } : null;
}

export function putHomeFingerprint(slot: HomeFingerprintSlot, data: string, takenAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO home_fingerprint (slot, data, taken_at) VALUES (?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET data = excluded.data, taken_at = excluded.taken_at`,
    )
    .run(slot, data, takenAt);
}

/* -------------------------------------------------------------------------- */
/* Per-page materiality baselines (lib/materiality.ts)                         */
/* -------------------------------------------------------------------------- */

/** Same slot semantics as home_fingerprint; the blob is opaque JSON owned by the page's route. */
export function getPageFingerprint(page: string, slot: HomeFingerprintSlot): { data: string; takenAt: number } | null {
  const row = getDb()
    .prepare("SELECT data, taken_at FROM page_fingerprint WHERE page = ? AND slot = ?")
    .get(page, slot) as { data: string; taken_at: number } | undefined;
  return row ? { data: row.data, takenAt: row.taken_at } : null;
}

export function putPageFingerprint(page: string, slot: HomeFingerprintSlot, data: string, takenAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO page_fingerprint (page, slot, data, taken_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(page, slot) DO UPDATE SET data = excluded.data, taken_at = excluded.taken_at`,
    )
    .run(page, slot, data, takenAt);
}

/* -------------------------------------------------------------------------- */
/* Valuation cases (lib/valuation/case.ts)                                     */
/* -------------------------------------------------------------------------- */

interface ValuationCaseRow {
  symbol: string;
  currency: string;
  method: string;
  version: number;
  author: string;
  assumptions: string;
  fair_value: number | null;
  fair_value_bear: number | null;
  fair_value_bull: number | null;
  implied_growth: number | null;
  margin_of_safety: number | null;
  terminal_value_share: number | null;
  price_at: number | null;
  created_at: string;
  updated_at: string;
  last_user_event_at: string | null;
}

interface ValuationEventRow {
  id: number;
  symbol: string;
  version: number;
  author: string;
  kind: string;
  assumptions: string;
  result: string;
  price_at: number | null;
  trigger_source: string | null;
  note: string | null;
  created_at: string;
}

const CASE_COLUMNS =
  `symbol, currency, method, version, author, assumptions, fair_value, fair_value_bear,
   fair_value_bull, implied_growth, margin_of_safety, terminal_value_share,
   price_at, created_at, updated_at, last_user_event_at`;

/**
 * Rebuild a case from its projection row. Returns null when the stored
 * assumptions cannot be parsed, so the caller re-seeds rather than valuing a
 * half-built model — a wrong fair value is worse than none.
 *
 * The result is recomputed from the stored assumptions rather than read out of
 * the projection columns. Those columns exist for indexed queries (the Register
 * sorts on margin_of_safety and updated_at); reading them back as the result
 * meant `invalidReason` and `impliedUpside` had to be fabricated, so every
 * write response claimed the case was valuable even when the user had just
 * saved a WACC below terminal growth. Deriving instead makes it impossible for
 * the returned object to disagree with its own assumptions.
 */
function rowToValuationCase(r: ValuationCaseRow): ValuationCase | null {
  const assumptions = coerceAssumptionSet(JSON.parse(r.assumptions) as unknown);
  if (!assumptions) return null;
  return {
    symbol: r.symbol,
    currency: r.currency,
    method: isValuationMethod(r.method) ? r.method : DEFAULT_VALUATION_METHOD,
    version: r.version,
    author: r.author as CaseAuthor,
    assumptions,
    // Priced at the stored price; callers holding a live quote recompute.
    result: computeCaseResult(assumptions, r.price_at),
    priceAt: r.price_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUserEventAt: r.last_user_event_at,
  };
}

export function getValuationCase(symbol: string): ValuationCase | null {
  const row = getDb()
    .prepare(`SELECT ${CASE_COLUMNS} FROM valuation_case WHERE symbol = ?`)
    .get(symbol.toUpperCase()) as ValuationCaseRow | undefined;
  return row ? rowToValuationCase(row) : null;
}

/** Every case, newest activity first. The Valuation Register's read. */
export function listValuationCases(): ValuationCase[] {
  const rows = getDb()
    .prepare(`SELECT ${CASE_COLUMNS} FROM valuation_case ORDER BY updated_at DESC`)
    .all() as unknown as ValuationCaseRow[];
  return rows.map(rowToValuationCase).filter((c): c is ValuationCase => c !== null);
}

export interface ValuationEventWrite {
  symbol: string;
  currency: string;
  /** Defaults to the only method that exists today. */
  method?: ValuationMethod;
  author: CaseAuthor;
  kind: CaseEventKind;
  assumptions: AssumptionSet;
  result: CaseResult;
  priceAt: number | null;
  triggerSource?: string | null;
  note?: string | null;
  /**
   * True for an event that records something which happened *alongside* the
   * case without changing it — today, only `decision_committed`, where the user
   * acted on the case but revised none of its assumptions.
   *
   * Annotations move neither freshness clock. This is not a nicety: `updated_at`
   * drives the `stale` flag and `last_user_event_at` drives `untouched`, so
   * treating a logged BUY as an ordinary write would mark an eight-month-old
   * seeded case as freshly reviewed by the user the moment they traded it —
   * silently emptying the two attention flags the Judgment Ledger exists to
   * raise. The version still increments and the projection still matches the
   * newest event, so the log remains the authority.
   */
  annotation?: boolean;
}

/**
 * Append one version to a symbol's case.
 *
 * The event insert and the projection rewrite happen in a single transaction, so
 * the projection can never describe a version the log does not contain. Version
 * numbers are allocated from the log (not the projection) because the log is the
 * authority, and the UNIQUE(symbol, version) constraint makes a lost update loud
 * rather than silent.
 */
export function appendValuationEvent(write: ValuationEventWrite): ValuationCase {
  const database = getDb();
  const symbol = write.symbol.toUpperCase();
  const now = new Date().toISOString();
  const assumptionsJson = JSON.stringify(write.assumptions);
  const resultJson = JSON.stringify(write.result);

  database.exec("BEGIN");
  try {
    const prior = database
      .prepare("SELECT MAX(version) AS v FROM valuation_event WHERE symbol = ?")
      .get(symbol) as { v: number | null } | undefined;
    const version = (prior?.v ?? 0) + 1;

    database
      .prepare(
        `INSERT INTO valuation_event
           (symbol, version, author, kind, assumptions, result, price_at, trigger_source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        symbol, version, write.author, write.kind, assumptionsJson, resultJson,
        write.priceAt, write.triggerSource ?? null, write.note ?? null, now,
      );

    // A user event stamps last_user_event_at; anything else preserves whatever
    // was there, so "you have not looked at this in eight months" stays true.
    // An annotation never stamps it, however authored — see `annotation`.
    const userStamp = write.author === "user" && !write.annotation ? now : null;
    // Same reasoning for the review clock: an annotation leaves updated_at where
    // it was, so acting on a stale case does not make it look current.
    const updatedClause = write.annotation
      ? "updated_at = valuation_case.updated_at"
      : "updated_at = excluded.updated_at";
    database
      .prepare(
        `INSERT INTO valuation_case
           (symbol, currency, method, version, author, assumptions, fair_value, fair_value_bear,
            fair_value_bull, implied_growth, margin_of_safety, terminal_value_share,
            price_at, created_at, updated_at, last_user_event_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           currency             = excluded.currency,
           method               = excluded.method,
           version              = excluded.version,
           author               = excluded.author,
           assumptions          = excluded.assumptions,
           fair_value           = excluded.fair_value,
           fair_value_bear      = excluded.fair_value_bear,
           fair_value_bull      = excluded.fair_value_bull,
           implied_growth       = excluded.implied_growth,
           margin_of_safety     = excluded.margin_of_safety,
           terminal_value_share = excluded.terminal_value_share,
           price_at             = excluded.price_at,
           ${updatedClause},
           last_user_event_at   = COALESCE(excluded.last_user_event_at, valuation_case.last_user_event_at)`,
      )
      .run(
        symbol, write.currency, write.method ?? DEFAULT_VALUATION_METHOD,
        version, write.author, assumptionsJson,
        write.result.fairValue, write.result.fairValueBear, write.result.fairValueBull,
        write.result.impliedGrowth, write.result.marginOfSafety,
        write.result.terminalValueShare, write.priceAt, now, now, userStamp,
      );

    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  const saved = getValuationCase(symbol);
  if (!saved) throw new Error(`Valuation case for ${symbol} could not be read back after write`);
  return saved;
}

/** A symbol's version history, newest first. */
export function listValuationEvents(symbol: string, limit = 50): ValuationEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, symbol, version, author, kind, assumptions, result, price_at,
              trigger_source, note, created_at
       FROM valuation_event WHERE symbol = ? ORDER BY version DESC LIMIT ?`,
    )
    .all(symbol.toUpperCase(), limit) as unknown as ValuationEventRow[];

  return rows.flatMap((r) => {
    const assumptions = coerceAssumptionSet(JSON.parse(r.assumptions) as unknown);
    if (!assumptions) return [];
    return [{
      id: r.id,
      symbol: r.symbol,
      version: r.version,
      author: r.author as CaseAuthor,
      kind: r.kind as CaseEventKind,
      assumptions,
      result: JSON.parse(r.result) as CaseResult,
      priceAt: r.price_at,
      trigger: r.trigger_source,
      note: r.note,
      createdAt: r.created_at,
    }];
  });
}

/**
 * The assumption snapshots behind a specific set of (symbol, version) pairs.
 *
 * This is the Judgment Ledger's join: a decision stores the case version it was
 * committed against, and answering "what margin of safety did you actually
 * believe when you acted?" requires the assumptions as they stood then, not as
 * they stand now. Because `valuation_event` carries a full snapshot per version
 * rather than a delta, that is a lookup rather than a reconstruction.
 *
 * One query for the whole set — a page's worth of decisions would otherwise be
 * a query each. Pairs the caller asks for that do not exist are simply absent
 * from the map, which the caller must treat as "unknown" rather than "zero".
 */
export function assumptionsAtVersions(
  pairs: readonly { symbol: string; version: number }[],
): Map<string, AssumptionSet> {
  const out = new Map<string, AssumptionSet>();
  if (pairs.length === 0) return out;

  // Deduplicate: several decisions commonly share one case version.
  const unique = new Map(pairs.map((p) => [versionKeyOf(p.symbol, p.version), p]));
  const placeholders = [...unique.values()].map(() => "(symbol = ? AND version = ?)").join(" OR ");
  const params = [...unique.values()].flatMap((p) => [p.symbol.toUpperCase(), p.version]);

  const rows = getDb()
    .prepare(`SELECT symbol, version, assumptions FROM valuation_event WHERE ${placeholders}`)
    .all(...params) as unknown as { symbol: string; version: number; assumptions: string }[];

  for (const r of rows) {
    const assumptions = coerceAssumptionSet(JSON.parse(r.assumptions) as unknown);
    if (assumptions) out.set(versionKeyOf(r.symbol, r.version), assumptions);
  }
  return out;
}

/**
 * Destructive: erases a symbol's case *and its entire history*. Exists for
 * "start this valuation over" and for test isolation; deliberately not exposed
 * through the API in Phase 2, because discarding an audit trail should be a
 * considered act rather than a stray click.
 */
export function resetValuationCase(symbol: string): void {
  const database = getDb();
  const sym = symbol.toUpperCase();
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM valuation_event WHERE symbol = ?").run(sym);
    database.prepare("DELETE FROM valuation_case WHERE symbol = ?").run(sym);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* AI analysis jobs + result cache (ai-migration/03-architecture.md §4–5)      */
/* -------------------------------------------------------------------------- */

export type AiJobStatus = "pending" | "running" | "succeeded" | "failed" | "timeout" | "cancelled";

export interface AiJobRow {
  id: string;
  taskType: string;
  subjectKey: string;
  inputHash: string;
  schemaVersion: number;
  provider: string;
  status: AiJobStatus;
  sessionId: string | null;
  sessionUrl: string | null;
  error: string | null;
  acus: number | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

interface AiJobDbRow {
  id: string; task_type: string; subject_key: string; input_hash: string;
  schema_version: number; provider: string; status: AiJobStatus;
  session_id: string | null; session_url: string | null; error: string | null;
  acus: number | null; created_at: number; updated_at: number; finished_at: number | null;
}

function mapAiJob(r: AiJobDbRow): AiJobRow {
  return {
    id: r.id, taskType: r.task_type, subjectKey: r.subject_key, inputHash: r.input_hash,
    schemaVersion: r.schema_version, provider: r.provider, status: r.status,
    sessionId: r.session_id, sessionUrl: r.session_url, error: r.error, acus: r.acus,
    createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  };
}

export function upsertAiJob(job: {
  id: string; taskType: string; subjectKey: string; inputHash: string;
  schemaVersion: number; provider: string; status: AiJobStatus;
}): void {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO ai_job (id, task_type, subject_key, input_hash, schema_version, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, provider = excluded.provider, updated_at = excluded.updated_at`,
  ).run(job.id, job.taskType, job.subjectKey, job.inputHash, job.schemaVersion, job.provider, job.status, now, now);
}

export function updateAiJob(
  id: string,
  patch: Partial<Pick<AiJobRow, "status" | "sessionId" | "sessionUrl" | "error" | "acus">> & { finished?: boolean },
): void {
  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [Date.now()];
  if (patch.status !== undefined) { sets.push("status = ?"); params.push(patch.status); }
  if (patch.sessionId !== undefined) { sets.push("session_id = ?"); params.push(patch.sessionId); }
  if (patch.sessionUrl !== undefined) { sets.push("session_url = ?"); params.push(patch.sessionUrl); }
  if (patch.error !== undefined) { sets.push("error = ?"); params.push(patch.error); }
  if (patch.acus !== undefined) { sets.push("acus = ?"); params.push(patch.acus); }
  if (patch.finished) { sets.push("finished_at = ?"); params.push(Date.now()); }
  params.push(id);
  getDb().prepare(`UPDATE ai_job SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function getAiJob(id: string): AiJobRow | null {
  const row = getDb().prepare("SELECT * FROM ai_job WHERE id = ?").get(id) as unknown as AiJobDbRow | undefined;
  return row ? mapAiJob(row) : null;
}

/** Jobs marked running whose in-memory driver died with the process — restart-recovery candidates. */
export function listRunningAiJobs(): AiJobRow[] {
  const rows = getDb().prepare("SELECT * FROM ai_job WHERE status IN ('pending','running') ORDER BY updated_at DESC")
    .all() as unknown as AiJobDbRow[];
  return rows.map(mapAiJob);
}

export interface AiResultRow {
  provider: string;
  metaJson: string | null;
  resultJson: string;
  createdAt: number;
}

/**
 * Exact-key cache read: (analysis_type, subject, input hash, schema version).
 * `maxAgeMs` is the caller's freshness policy (lib/platform/registry.ts owns
 * the numbers); pass Infinity to accept any stored row (stale-while-refresh).
 */
export function getAiResult(
  key: { analysisType: string; subjectKey: string; inputHash: string; schemaVersion: number },
  maxAgeMs: number,
): AiResultRow | null {
  const row = getDb().prepare(
    `SELECT provider, meta_json, result_json, created_at FROM ai_result
     WHERE analysis_type = ? AND subject_key = ? AND input_hash = ? AND schema_version = ?`,
  ).get(key.analysisType, key.subjectKey, key.inputHash, key.schemaVersion) as unknown as
    { provider: string; meta_json: string | null; result_json: string; created_at: number } | undefined;
  if (!row) return null;
  if (Number.isFinite(maxAgeMs) && Date.now() - row.created_at > maxAgeMs) return null;
  return { provider: row.provider, metaJson: row.meta_json, resultJson: row.result_json, createdAt: row.created_at };
}

/**
 * Latest row for (type, subject, schema) regardless of input hash — for
 * prompts that embed live data (the compare prompt carries current prices),
 * where an exact-hash read can never hit twice across a price tick. The
 * caller's `maxAgeMs` is what bounds staleness, exactly as in getAiResult.
 */
export function getLatestAiResult(
  key: { analysisType: string; subjectKey: string; schemaVersion: number },
  maxAgeMs: number,
): AiResultRow | null {
  const row = getDb().prepare(
    `SELECT provider, meta_json, result_json, created_at FROM ai_result
     WHERE analysis_type = ? AND subject_key = ? AND schema_version = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(key.analysisType, key.subjectKey, key.schemaVersion) as unknown as
    { provider: string; meta_json: string | null; result_json: string; created_at: number } | undefined;
  if (!row) return null;
  if (Number.isFinite(maxAgeMs) && Date.now() - row.created_at > maxAgeMs) return null;
  return { provider: row.provider, metaJson: row.meta_json, resultJson: row.result_json, createdAt: row.created_at };
}

export function putAiResult(
  key: { analysisType: string; subjectKey: string; inputHash: string; schemaVersion: number },
  value: { provider: string; metaJson?: string | null; resultJson: string },
): void {
  getDb().prepare(
    `INSERT INTO ai_result (analysis_type, subject_key, input_hash, schema_version, provider, meta_json, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(analysis_type, subject_key, input_hash, schema_version) DO UPDATE SET
       provider = excluded.provider, meta_json = excluded.meta_json,
       result_json = excluded.result_json, created_at = excluded.created_at`,
  ).run(key.analysisType, key.subjectKey, key.inputHash, key.schemaVersion,
        value.provider, value.metaJson ?? null, value.resultJson, Date.now());
  // Sweep rows past any plausible freshness window (30 days) plus superseded
  // input hashes for the same (type, subject) older than 7 days.
  const db = getDb();
  db.prepare("DELETE FROM ai_result WHERE created_at < ?").run(Date.now() - 30 * 24 * 60 * 60 * 1000);
  db.prepare(
    `DELETE FROM ai_result WHERE analysis_type = ? AND subject_key = ? AND input_hash != ? AND created_at < ?`,
  ).run(key.analysisType, key.subjectKey, key.inputHash, Date.now() - 7 * 24 * 60 * 60 * 1000);
}
