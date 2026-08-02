/**
 * IC Report — persistence and in-flight run registry (Phase 5.19 / 7.3 / 7.4).
 *
 * Reports are persisted to SQLite so a page reload or tab close does not
 * destroy the result of a multi-minute run, and so the report history per
 * ticker (with diffs) survives restarts. In-flight runs live in a
 * module-level registry: the SSE stream is a *view* onto the run, not its
 * owner — closing the tab leaves the pipeline running, and reopening the
 * page re-attaches to the live run.
 *
 * Uses its own connection to the app database (lib/db.ts owns the rest of
 * the schema; this table is IC-only).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ICReport, ICProgressEvent } from "../ic-report";

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ic_report (
      symbol        TEXT NOT NULL,
      generated_at  TEXT NOT NULL,
      market        TEXT NOT NULL,
      model         TEXT NOT NULL,
      report        TEXT NOT NULL,
      PRIMARY KEY (symbol, generated_at)
    );
  `);
  return db;
}

/* ── Report history ─────────────────────────────────────────────────────── */

export interface ReportListEntry {
  symbol: string;
  generatedAt: string;
  market: string;
  model: string;
}

export function saveReport(report: ICReport): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO ic_report (symbol, generated_at, market, model, report) VALUES (?, ?, ?, ?, ?)")
    .run(report.symbol.toUpperCase(), report.generatedAt, report.market, report.model, JSON.stringify(report));
  // Keep the last 10 reports per symbol.
  getDb()
    .prepare(`DELETE FROM ic_report WHERE symbol = ? AND generated_at NOT IN (
      SELECT generated_at FROM ic_report WHERE symbol = ? ORDER BY generated_at DESC LIMIT 10)`)
    .run(report.symbol.toUpperCase(), report.symbol.toUpperCase());
}

export function listReports(symbol: string): ReportListEntry[] {
  const rows = getDb()
    .prepare("SELECT symbol, generated_at, market, model FROM ic_report WHERE symbol = ? ORDER BY generated_at DESC")
    .all(symbol.toUpperCase()) as { symbol: string; generated_at: string; market: string; model: string }[];
  return rows.map((r) => ({ symbol: r.symbol, generatedAt: r.generated_at, market: r.market, model: r.model }));
}

export function getReport(symbol: string, generatedAt?: string): ICReport | null {
  const row = (generatedAt
    ? getDb().prepare("SELECT report FROM ic_report WHERE symbol = ? AND generated_at = ?").get(symbol.toUpperCase(), generatedAt)
    : getDb().prepare("SELECT report FROM ic_report WHERE symbol = ? ORDER BY generated_at DESC LIMIT 1").get(symbol.toUpperCase())
  ) as { report: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.report) as ICReport;
    return parsed.schemaVersion === 2 ? parsed : null;
  } catch {
    return null;
  }
}

/* ── In-flight run registry ─────────────────────────────────────────────── */

export interface InFlightRun {
  symbol: string;
  startedAt: string;
  status: "running" | "done" | "error";
  events: ICProgressEvent[];
  report: ICReport | null;
  error: string | null;
  listeners: Set<(event: ICProgressEvent) => void>;
}

const runs = new Map<string, InFlightRun>();

export function getRun(symbol: string): InFlightRun | null {
  return runs.get(symbol.toUpperCase()) ?? null;
}

export function startRun(symbol: string): InFlightRun {
  const run: InFlightRun = {
    symbol: symbol.toUpperCase(),
    startedAt: new Date().toISOString(),
    status: "running",
    events: [],
    report: null,
    error: null,
    listeners: new Set(),
  };
  runs.set(run.symbol, run);
  return run;
}

export function recordEvent(run: InFlightRun, event: ICProgressEvent): void {
  run.events.push(event);
  for (const l of run.listeners) {
    try { l(event); } catch { /* listener died with its stream */ }
  }
}

export function finishRun(run: InFlightRun, report: ICReport | null, error: string | null): void {
  run.status = error ? "error" : "done";
  run.report = report;
  run.error = error;
  if (report) saveReport(report);
  // Keep the finished run visible for reconnects for 10 minutes.
  setTimeout(() => {
    if (runs.get(run.symbol) === run) runs.delete(run.symbol);
  }, 10 * 60 * 1000).unref?.();
}
