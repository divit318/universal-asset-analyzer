/**
 * GET  /api/engine?symbols=AAPL,MSFT  — fetch latest scorecard rows from DuckDB
 * POST /api/engine                     — trigger a daily run (subprocess)
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUCKDB_PATH = path.join(process.cwd(), "data", "engine.duckdb");

// We query DuckDB via Python subprocess since there's no stable Node DuckDB
// binding for ARM. The scorecard is written daily; reads are from a snapshot.
// For reads we use a lightweight SQLite mirror written by the Python engine,
// or fall back to spawning a one-shot Python query.

async function queryScorecard(symbols?: string[]): Promise<object[]> {
  return new Promise((resolve, reject) => {
    const script = symbols && symbols.length > 0
      ? `
import duckdb, json, sys
conn = duckdb.connect("${DUCKDB_PATH}", read_only=True)
syms = ${JSON.stringify(symbols)}
placeholders = ",".join("?" for _ in syms)
rows = conn.execute(
  f"SELECT * FROM scorecard_daily WHERE symbol IN ({placeholders}) ORDER BY composite_score DESC",
  syms
).fetchdf()
conn.close()
print(rows.to_json(orient="records", date_format="iso"))
`
      : `
import duckdb, json, sys
conn = duckdb.connect("${DUCKDB_PATH}", read_only=True)
rows = conn.execute(
  "SELECT * FROM scorecard_daily WHERE date = (SELECT MAX(date) FROM scorecard_daily) ORDER BY composite_score DESC"
).fetchdf()
conn.close()
print(rows.to_json(orient="records", date_format="iso"))
`;

    const py = spawn("python3", ["-c", script]);
    let out = "";
    let err = "";
    py.stdout.on("data", (d) => { out += d.toString(); });
    py.stderr.on("data", (d) => { err += d.toString(); });
    py.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || "Python query failed"));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as object[]);
      } catch {
        reject(new Error("Failed to parse scorecard JSON"));
      }
    });
  });
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  if (!fs.existsSync(DUCKDB_PATH)) {
    return NextResponse.json({ error: "Engine database not initialized. Run POST /api/engine first." }, { status: 404 });
  }

  try {
    const rows = await queryScorecard(symbols);
    return NextResponse.json({ scorecard: rows, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    symbols?: string[];
    universe?: string;
    noFetch?: boolean;
    noForecast?: boolean;
  };

  const args = ["-m", "engine.daily_run"];
  if (body.universe) args.push("--universe", body.universe);
  else if (body.symbols?.length) args.push("--symbols", ...body.symbols);
  if (body.noFetch) args.push("--no-fetch");
  if (body.noForecast) args.push("--no-forecast");

  return new Promise<NextResponse>((resolve) => {
    const py = spawn("python3", args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    py.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    py.on("close", (code) => {
      if (code !== 0) {
        resolve(NextResponse.json({ error: stderr || "Engine run failed", stdout }, { status: 500 }));
        return;
      }
      resolve(NextResponse.json({ ok: true, stdout: stdout.slice(-2000) }));
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      py.kill();
      resolve(NextResponse.json({ error: "Engine run timed out" }, { status: 504 }));
    }, 600_000);
  });
}
