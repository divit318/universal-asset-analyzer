/**
 * GET /api/engine/detail?symbol=AAPL
 *
 * Returns the complete mathematical working for a single symbol:
 * - scorecard row (composite + all factor z-scores)
 * - regime posterior probabilities (all 5 states, last 30 days for chart)
 * - forecast quantile distribution (all 5 horizons)
 * - MC valuation percentiles
 * - fundamentals used as inputs
 * - top features from features_daily (latest date, sorted by |value|)
 * - factors_daily history (last 90 days for sparklines)
 *
 * No LLM involved. Pure numerical output.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUCKDB_PATH = path.join(process.cwd(), "data", "engine.duckdb");

const QUERY_SCRIPT = (symbol: string) => `
import duckdb, json, sys

sym = ${JSON.stringify(symbol)}
conn = duckdb.connect(${JSON.stringify(DUCKDB_PATH)}, read_only=True)

def q(sql, params=None):
    try:
        df = conn.execute(sql, params or []).fetchdf()
        # Convert date columns to string before serialising
        for col in df.columns:
            if hasattr(df[col], 'dt') or str(df[col].dtype) in ('object', 'datetime64[ns]', 'date32[day][pyarrow]'):
                try:
                    df[col] = df[col].astype(str)
                except Exception:
                    pass
        return json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
    except Exception as e:
        return []

# 1. Latest scorecard row
scorecard = q(
    "SELECT * FROM scorecard_daily WHERE symbol=? ORDER BY date DESC LIMIT 1", [sym]
)

# 2. Regime posteriors — last 60 trading days
regime_history = q(
    "SELECT date, regime_label, prob_bull, prob_bear, prob_range, prob_crash, prob_recovery "
    "FROM regime_daily WHERE symbol=? ORDER BY date DESC LIMIT 60", [sym]
)

# 3. Forecast distributions — all horizons, latest date
forecasts = q(
    "SELECT horizon_days, p10, p25, p50, p75, p90, prob_up "
    "FROM forecasts WHERE symbol=? AND date=(SELECT MAX(date) FROM forecasts WHERE symbol=?) "
    "ORDER BY horizon_days", [sym, sym]
)

# 4. MC valuation — latest
mc = q(
    "SELECT intrinsic_p10, intrinsic_p25, intrinsic_p50, intrinsic_p75, intrinsic_p90, "
    "wacc, terminal_growth FROM mc_valuation WHERE symbol=? ORDER BY date DESC LIMIT 1", [sym]
)

# 5. Fundamentals
fund = q(
    "SELECT * FROM fundamentals WHERE symbol=?", [sym]
)

# 6. Top 40 features by absolute value — latest date only
features = q(
    "SELECT feature, value FROM features_daily "
    "WHERE symbol=? AND date=(SELECT MAX(date) FROM features_daily WHERE symbol=?) "
    "ORDER BY ABS(value) DESC LIMIT 60", [sym, sym]
)

# 7. Factor history — last 90 days for sparklines
factor_history = q(
    "SELECT date, momentum, quality, value, low_vol, revision, composite "
    "FROM factors_daily WHERE symbol=? ORDER BY date DESC LIMIT 90", [sym]
)

# 8. Price history — last 252 days for chart
prices = q(
    "SELECT date, close, volume FROM price_daily WHERE symbol=? "
    "ORDER BY date DESC LIMIT 252", [sym]
)

conn.close()

result = {
    "symbol": sym,
    "scorecard": scorecard[0] if scorecard else None,
    "regime_history": regime_history,
    "forecasts": forecasts,
    "mc": mc[0] if mc else None,
    "fundamentals": fund[0] if fund else None,
    "features": features,
    "factor_history": factor_history,
    "prices": prices,
}
print(json.dumps(result, default=str))
`;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
  if (!symbol) {
    return NextResponse.json({ error: "symbol param required" }, { status: 400 });
  }

  if (!fs.existsSync(DUCKDB_PATH)) {
    return NextResponse.json(
      { error: "Engine database not initialized. Run the engine first." },
      { status: 404 },
    );
  }

  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", ["-c", QUERY_SCRIPT(symbol)]);
    let out = "";
    let err = "";
    py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    py.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    py.on("close", (code) => {
      if (code !== 0) {
        resolve(NextResponse.json({ error: err || "Query failed" }, { status: 500 }));
        return;
      }
      try {
        const data = JSON.parse(out.trim()) as object;
        resolve(NextResponse.json(data));
      } catch {
        resolve(NextResponse.json({ error: "Failed to parse detail JSON" }, { status: 500 }));
      }
    });
  });
}
