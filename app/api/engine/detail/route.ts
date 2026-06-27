/**
 * GET /api/engine/detail?symbol=AAPL
 *
 * Reads from per-symbol Parquet detail snapshot written by the engine.
 * No DuckDB connection — zero lock contention with concurrent engine runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol param required" }, { status: 400 });
  }

  // Prefer snapshot (no lock), fall back to live DuckDB query if snapshot missing
  const snapshotExists = fs.existsSync(detailSnapshotPath(symbol));
  const script = snapshotExists ? READ_SNAPSHOT_SCRIPT(symbol) : LIVE_QUERY_SCRIPT(symbol);

  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", ["-c", script]);
    let out = ""; let err = "";
    py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    py.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    py.on("close", (code) => {
      if (code !== 0) {
        resolve(NextResponse.json({ error: err || "Query failed" }, { status: 500 }));
        return;
      }
      try {
        const data = JSON.parse(out.trim()) as Record<string, unknown>;
        // Snapshot says no data yet — return empty shell rather than 404
        if (data.error === "no_snapshot") {
          resolve(NextResponse.json({
            symbol, scorecard: null, regime_history: [], forecasts: [],
            mc: null, fundamentals: null, features: [], factor_history: [], prices: [],
          }));
          return;
        }
        resolve(NextResponse.json(data));
      } catch {
        resolve(NextResponse.json({ error: "Failed to parse detail JSON" }, { status: 500 }));
      }
    });
  });
}
