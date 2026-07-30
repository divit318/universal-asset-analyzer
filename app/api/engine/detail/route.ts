/**
 * GET /api/engine/detail?symbol=AAPL
 *
 * Reads from per-symbol Parquet detail snapshot written by the engine.
 * No DuckDB connection — zero lock contention with concurrent engine runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import path from "path";
import fs from "fs";
import { EngineTimeoutError, runEnginePython } from "@/lib/engine-python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The snapshot path reads a small per-symbol Parquet and is quick. The DuckDB
 *  fallback below is not, so both are bounded — a symbol with no snapshot must
 *  fail fast and visibly instead of pinning an expanded row open on a spinner. */
const SNAPSHOT_TIMEOUT_MS = 15_000;
const LIVE_QUERY_TIMEOUT_MS = 25_000;

const DETAIL_DIR = path.join(process.cwd(), "data", "detail_snapshots");
const DUCKDB_PATH = path.join(process.cwd(), "data", "engine.duckdb");

function detailSnapshotPath(symbol: string): string {
  return path.join(DETAIL_DIR, `${symbol}.parquet`);
}

const READ_SNAPSHOT_SCRIPT = (symbol: string) => `
import polars as pl, json, sys, os

sym = ${JSON.stringify(symbol)}
path = ${JSON.stringify(detailSnapshotPath(symbol))}

if not os.path.exists(path):
    print(json.dumps({"error": "no_snapshot"}))
    sys.exit(0)

df = pl.read_parquet(path)
tables = {}
for row in df.iter_rows(named=True):
    tables[row["key"]] = json.loads(row["json"])

def first(lst):
    return lst[0] if lst else None

result = {
    "symbol": sym,
    "scorecard":      first(tables.get("scorecard", [])),
    "regime_history": tables.get("regime", []),
    "forecasts":      tables.get("forecasts", []),
    "mc":             first(tables.get("mc", [])),
    "fundamentals":   first(tables.get("fundamentals", [])),
    "features":       tables.get("features", []),
    "factor_history": tables.get("factor_history", []),
    "prices":         tables.get("prices", []),
}
print(json.dumps(result, default=str))
`.trim();

// Fallback: live DuckDB query when snapshot doesn't exist yet (first run)
const LIVE_QUERY_SCRIPT = (symbol: string) => `
import duckdb, json, sys

sym = ${JSON.stringify(symbol)}
conn = duckdb.connect(${JSON.stringify(DUCKDB_PATH)}, read_only=True)

def q(sql, params=None):
    try:
        df = conn.execute(sql, params or []).fetchdf()
        for col in df.columns:
            if str(df[col].dtype) in ('object', 'datetime64[ns]', 'date32[day][pyarrow]'):
                try: df[col] = df[col].astype(str)
                except Exception: pass
        return json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
    except Exception: return []

result = {
    "symbol": sym,
    "scorecard":      (q("SELECT * FROM scorecard_daily WHERE symbol=? ORDER BY date DESC LIMIT 1", [sym]) or [None])[0],
    "regime_history": q("SELECT date, regime_label, prob_bull, prob_bear, prob_range, prob_crash, prob_recovery FROM regime_daily WHERE symbol=? ORDER BY date DESC LIMIT 60", [sym]),
    "forecasts":      q("SELECT horizon_days, p10, p25, p50, p75, p90, prob_up FROM forecasts WHERE symbol=? AND date=(SELECT MAX(date) FROM forecasts WHERE symbol=?) ORDER BY horizon_days", [sym, sym]),
    "mc":             (q("SELECT intrinsic_p10, intrinsic_p25, intrinsic_p50, intrinsic_p75, intrinsic_p90, wacc, terminal_growth FROM mc_valuation WHERE symbol=? ORDER BY date DESC LIMIT 1", [sym]) or [None])[0],
    "fundamentals":   (q("SELECT * FROM fundamentals WHERE symbol=?", [sym]) or [None])[0],
    "features":       q("SELECT feature, value FROM features_daily WHERE symbol=? AND date=(SELECT MAX(date) FROM features_daily WHERE symbol=?) ORDER BY ABS(value) DESC LIMIT 60", [sym, sym]),
    "factor_history": q("SELECT date, momentum, quality, value, low_vol, revision, composite FROM factors_daily WHERE symbol=? ORDER BY date DESC LIMIT 90", [sym]),
    "prices":         q("SELECT date, close, volume FROM price_daily WHERE symbol=? ORDER BY date DESC LIMIT 252", [sym]),
}
conn.close()
print(json.dumps(result, default=str))
`.trim();

export async function GET(req: NextRequest) {
  // Strict validation is load-bearing here: the symbol is interpolated into a
  // generated Python script, so the charset gate is what prevents injection.
  const symbol = normalizeSymbol(req.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` param is required" }, { status: 400 });
  }

  // Prefer snapshot (no lock), fall back to live DuckDB query if snapshot missing
  const snapshotExists = fs.existsSync(detailSnapshotPath(symbol));
  const script = snapshotExists ? READ_SNAPSHOT_SCRIPT(symbol) : LIVE_QUERY_SCRIPT(symbol);
  const timeoutMs = snapshotExists ? SNAPSHOT_TIMEOUT_MS : LIVE_QUERY_TIMEOUT_MS;

  const emptyShell = {
    symbol, scorecard: null, regime_history: [], forecasts: [],
    mc: null, fundamentals: null, features: [], factor_history: [], prices: [],
  };

  try {
    const out = await runEnginePython(["-c", script], { timeoutMs });
    const data = JSON.parse(out.trim()) as Record<string, unknown>;
    // Snapshot says no data yet — return empty shell rather than 404
    if (data.error === "no_snapshot") return NextResponse.json(emptyShell);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof EngineTimeoutError) {
      // The row stays open and says why, rather than spinning: this symbol has no
      // detail snapshot and the live DuckDB fallback couldn't finish in budget.
      return NextResponse.json(
        { ...emptyShell, error: `No detail snapshot for ${symbol} yet, and the live query timed out. Re-run the engine to publish one.` },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 },
    );
  }
}
