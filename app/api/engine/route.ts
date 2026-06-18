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

// Track the active engine process. DuckDB allows only one writer at a time —
// spawning a second process without killing the first causes "Conflicting lock".
let activeEngineProcess: ReturnType<typeof spawn> | null = null;

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

  // Kill any existing engine run before starting a new one.
  // DuckDB single-writer constraint: second process will crash with lock error.
  if (activeEngineProcess) {
    try { activeEngineProcess.kill("SIGKILL"); } catch { /* already dead */ }
    activeEngineProcess = null;
    // Brief pause to let the OS release the file lock
    await new Promise((r) => setTimeout(r, 500));
  }

  const args = ["-m", "engine.daily_run"];
  if (body.universe) args.push("--universe", body.universe);
  else if (body.symbols?.length) args.push("--symbols", ...body.symbols);
  if (body.noFetch) args.push("--no-fetch");
  if (body.noForecast) args.push("--no-forecast");

  // Stream stdout lines to the client in real-time so the UI can show progress.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const py = spawn("python3", args, {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      activeEngineProcess = py;

      let stderr = "";

      const send = (line: string) => {
        controller.enqueue(encoder.encode(line + "\n"));
      };

      py.stdout.on("data", (d: Buffer) => {
        d.toString().split("\n").filter(Boolean).forEach(send);
      });
      py.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        if (activeEngineProcess === py) activeEngineProcess = null;
        py.kill();
        send("ERROR: Engine run timed out after 10 minutes");
        controller.close();
      }, 600_000);

      py.on("close", (code) => {
        clearTimeout(timer);
        if (activeEngineProcess === py) activeEngineProcess = null;
        if (code !== 0) {
          send(`ERROR: ${stderr.trim() || "Engine run failed (exit " + code + ")"}`);
        } else {
          send("DONE");
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
