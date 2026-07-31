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
import { EngineTimeoutError, enginePython, runEnginePython } from "@/lib/engine-python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "scorecard_snapshot.parquet");

/** Reading a 15KB Parquet is fast; *starting Python* is not. Well under a cold
 *  interpreter + polars import, but bounded so a wedged spawn can't hang the page. */
const READ_TIMEOUT_MS = 20_000;

// Track the active engine process. DuckDB allows only one writer at a time —
// spawning a second process without killing the first causes "Conflicting lock".
let activeEngineProcess: ReturnType<typeof spawn> | null = null;

/**
 * Memo of the full parsed snapshot, keyed on the Parquet's mtime+size.
 *
 * Without this, every visit to the desk — and every 3s poll during a run — paid a
 * fresh Python interpreter start plus a polars import just to re-read a file that
 * had not changed. The engine writes this snapshot atomically (tmp + rename), so
 * mtime+size is a sound invalidation key: any new content is a new fingerprint,
 * and a partially written file is never visible under this path.
 */
let memo: { fingerprint: string; rows: SnapshotRow[] } | null = null;
let inflight: Promise<SnapshotRow[]> | null = null;

interface SnapshotRow { symbol?: string; [k: string]: unknown }

function fingerprint(): string {
  try {
    const s = fs.statSync(SNAPSHOT_PATH);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absent";
  }
}

/** Always reads every row; filtering happens in-process so one symbol's request
 *  can be served from the same memo as the full-universe request. */
async function readScorecardSnapshot(): Promise<SnapshotRow[]> {
  const script = `
import polars as pl
df = pl.read_parquet(${JSON.stringify(SNAPSHOT_PATH)})
print(df.to_pandas().to_json(orient="records", date_format="iso"))
`.trim();

  const out = await runEnginePython(["-c", script], { timeoutMs: READ_TIMEOUT_MS });
  return JSON.parse(out.trim()) as SnapshotRow[];
}

async function loadRows(): Promise<SnapshotRow[]> {
  const fp = fingerprint();
  if (memo?.fingerprint === fp) return memo.rows;

  // Coalesce: the desk's poll and its initial load can overlap, and two
  // interpreters reading the same file is pure waste.
  inflight ??= readScorecardSnapshot()
    .then((rows) => { memo = { fingerprint: fp, rows }; return rows; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))
    : null;

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return NextResponse.json(
      { error: "No scorecard data yet. Run the engine first.", scorecard: [], count: 0 },
      { status: 200 }  // 200 so UI shows empty state, not an error banner
    );
  }

  try {
    const all = await loadRows();
    const rows = symbols ? all.filter((r) => typeof r.symbol === "string" && symbols.has(r.symbol)) : all;
    return NextResponse.json({ scorecard: rows, count: rows.length });
  } catch (err) {
    const message = err instanceof EngineTimeoutError
      ? "Reading the scorecard snapshot timed out. Check that the engine's Python environment is installed (.venv)."
      : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, scorecard: [], count: 0 }, { status: 500 });
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
      const py = spawn(enginePython(), args, {
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
