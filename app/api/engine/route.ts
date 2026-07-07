/**
 * GET  /api/engine?symbols=AAPL,MSFT  — read latest scorecard from Parquet snapshot
 * POST /api/engine                     — trigger a daily run (subprocess, streams stdout)
 *
 * Reads NEVER touch engine.duckdb — they go to scorecard_snapshot.parquet which is
 * written atomically (tmp + rename) at the end of each engine run. This eliminates
 * all read/write lock contention regardless of whether the engine is currently running.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "scorecard_snapshot.parquet");

// Track the active engine process. DuckDB allows only one writer at a time —
// spawning a second process without killing the first causes "Conflicting lock".
let activeEngineProcess: ReturnType<typeof spawn> | null = null;

async function readScorecardSnapshot(symbols?: string[]): Promise<object[]> {
  if (!fs.existsSync(SNAPSHOT_PATH)) return [];

  // Read Parquet via a minimal Python one-liner — fast, no DuckDB involved
  const filter = symbols?.length
    ? `df = df[df["symbol"].isin(${JSON.stringify(symbols)})]`
    : "";
  const script = `
import polars as pl, json, sys
df = pl.read_parquet(${JSON.stringify(SNAPSHOT_PATH)})
${filter}
print(df.to_pandas().to_json(orient="records", date_format="iso"))
`.trim();

  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["-c", script]);
    let out = ""; let err = "";
    py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    py.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    py.on("close", (code) => {
      if (code !== 0) { reject(new Error(err || "Parquet read failed")); return; }
      try { resolve(JSON.parse(out.trim()) as object[]); }
      catch { reject(new Error("Failed to parse snapshot JSON")); }
    });
  });
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return NextResponse.json(
      { error: "No scorecard data yet. Run the engine first.", scorecard: [], count: 0 },
      { status: 200 }  // 200 so UI shows empty state, not an error banner
    );
  }

  try {
    const rows = await readScorecardSnapshot(symbols);
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

      py.on("close", (code) => {
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
