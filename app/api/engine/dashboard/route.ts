/**
 * GET /api/engine/dashboard — the market-wide brief the desk paints first.
 *
 * Three tiers, fastest first, because this request gates first meaningful paint:
 *
 *   1. `data/engine_dashboard.json`, written by `engine/dashboard.py` at each of
 *      the engine run's export stages. A file read: ~1ms, no subprocess.
 *   2. An in-process memo of tier 3's result, keyed on the DuckDB file's
 *      mtime+size, so a cold rebuild is paid at most once per engine run.
 *   3. `python -m engine.dashboard --write`, under a hard timeout, which also
 *      backfills tier 1 for every subsequent request.
 *
 * If all three miss, this returns an explicit `degraded` brief rather than
 * hanging — a cold read of a multi-GB engine.duckdb genuinely can take minutes,
 * and the page must say so instead of spinning forever.
 */

import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { EngineTimeoutError, runEnginePython } from "@/lib/engine-python";
import type { DashboardResponse } from "@/lib/engine-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "engine_dashboard.json");
const DUCKDB_PATH = path.join(process.cwd(), "data", "engine.duckdb");

/** Budget for the tier-3 rebuild. Generous enough for a warm DuckDB (sub-second)
 *  and a moderately cold one, short enough that the user gets a real answer. */
const REBUILD_TIMEOUT_MS = 12_000;

let memo: { fingerprint: string; payload: DashboardResponse } | null = null;

/** Coalesces concurrent rebuilds: React strict-mode double-mounts and the page's
 *  own poll can all land at once, and each one spawning its own DuckDB reader
 *  would make the very contention it's trying to avoid. */
let inflight: Promise<DashboardResponse> | null = null;

async function fingerprint(): Promise<string> {
  try {
    const s = await stat(DUCKDB_PATH);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "absent";
  }
}

async function readSnapshotFile(): Promise<DashboardResponse | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as DashboardResponse;
  } catch {
    return null;
  }
}

async function rebuild(): Promise<DashboardResponse> {
  const raw = await runEnginePython(["-m", "engine.dashboard"], { timeoutMs: REBUILD_TIMEOUT_MS });
  return JSON.parse(raw.trim()) as DashboardResponse;
}

export async function GET(request: Request) {
  const forceRebuild = new URL(request.url).searchParams.get("rebuild") === "1";

  if (!forceRebuild) {
    const snapshot = await readSnapshotFile();
    if (snapshot) return NextResponse.json(snapshot);

    const fp = await fingerprint();
    if (memo?.fingerprint === fp) return NextResponse.json(memo.payload);
  }

  try {
    inflight ??= rebuild().finally(() => { inflight = null; });
    const payload = await inflight;
    memo = { fingerprint: await fingerprint(), payload };
    return NextResponse.json(payload);
  } catch (err) {
    // Degraded, not failed: the page shows a "brief unavailable — run the engine"
    // state with its other sections intact, which is strictly more useful than a
    // 500 that blanks the whole desk.
    const reason =
      err instanceof EngineTimeoutError
        ? "The market brief took too long to build. Run the engine to publish a fresh snapshot — after that this loads instantly."
        : err instanceof Error
          ? err.message
          : "Could not build the market brief.";
    return NextResponse.json({ empty: true, degraded: true, reason } satisfies DashboardResponse);
  }
}
