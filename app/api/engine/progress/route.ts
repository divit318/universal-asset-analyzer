/**
 * GET /api/engine/progress — read-only poll of the current/last engine run's
 * stage, written by engine/daily_run.py at each checkpoint (factors →
 * factors+mc → complete). Lets the UI show partial results and a stage
 * label while a run is still in progress instead of one long blank wait.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EngineProgress {
  stage: "factors" | "factors+mc" | "complete" | string;
  updated_at: string;
  n_ready: number;
  n_total: number;
}

export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "engine_progress.json"), "utf8");
    return NextResponse.json(JSON.parse(raw) as EngineProgress);
  } catch {
    return NextResponse.json({ stage: null, updated_at: null, n_ready: 0, n_total: 0 });
  }
}
