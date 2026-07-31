/**
 * Model Validation — did the Quant Engine's own signals actually work?
 *
 *   GET  /api/engine/validation  → the last cached run, or `{ cached: false }`.
 *   POST /api/engine/validation  → run it now, cache, and return it.
 *
 * This is the /engine desk's final section, and it is split GET/POST on purpose.
 * The work is a Yahoo history fetch per flagged name — dozens of network round
 * trips — so it must never run just because someone opened the page. The desk
 * explains what validation does and shows the last result; the user decides when
 * to spend the time.
 *
 * Replaces the standalone /backtest page and /api/backtest. The aggregation
 * itself is unchanged and still lives in `lib/backtest.ts` (pure, unit-tested);
 * only the trigger semantics, caching, and where it surfaces have moved.
 */

import { NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getHistory } from "@/lib/yahoo";
import { priceOnOrBefore } from "@/lib/portfolio-performance";
import { runBacktest, type BacktestInput, type BacktestResult } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNAL_LOG_PATH = path.join(process.cwd(), "data", "signal_log.csv");
const CACHE_PATH = path.join(process.cwd(), "data", "engine_validation.json");

export interface ValidationRun {
  result: BacktestResult;
  window: { from: string; to: string };
  cohortSize: number;
  priced: number;
  ranAt: string;
}

interface SignalRow {
  date: string;
  symbol: string;
  compositeScore: number;
  signal: string;
}

/** Parse the engine's signal log, tolerating CRLF and the trailing empty
 *  forward-return column. */
function parseSignalLog(csv: string): SignalRow[] {
  const lines = csv.replace(/\r/g, "").trim().split("\n");
  const rows: SignalRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 4) continue;
    const compositeScore = Number(c[2]);
    if (!Number.isFinite(compositeScore)) continue;
    rows.push({ date: c[0], symbol: c[1], compositeScore, signal: c[3] });
  }
  return rows;
}

async function readCache(): Promise<ValidationRun | null> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8")) as ValidationRun;
  } catch {
    return null;
  }
}

async function writeCache(run: ValidationRun): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(run));
  await rename(tmp, CACHE_PATH);
}

export async function GET() {
  const cached = await readCache();
  if (!cached) {
    return NextResponse.json({ cached: false as const });
  }
  return NextResponse.json({ cached: true as const, ...cached });
}

export async function POST() {
  let csv: string;
  try {
    csv = await readFile(SIGNAL_LOG_PATH, "utf8");
  } catch {
    return NextResponse.json(
      { error: "No signal log yet — run the engine to generate signals before validating them." },
      { status: 404 },
    );
  }

  const rows = parseSignalLog(csv);
  // Latest actionable signal per symbol.
  const latestBySymbol = new Map<string, SignalRow>();
  for (const r of rows) {
    if (r.signal === "HOLD") continue;
    const prev = latestBySymbol.get(r.symbol);
    if (!prev || r.date > prev.date) latestBySymbol.set(r.symbol, r);
  }
  const cohort = [...latestBySymbol.values()];
  if (cohort.length === 0) {
    return NextResponse.json({ empty: true, reason: "No actionable (non-HOLD) signals in the log to validate." });
  }

  const earliest = cohort.reduce((min, r) => (r.date < min ? r.date : min), cohort[0].date);
  const rangeDays = Math.ceil((Date.now() - Date.parse(earliest)) / 86_400_000) + 20;

  // Join each signal to its realized return since it fired. One name failing to
  // price is not a failed validation — it just drops out of the cohort, and the
  // response reports priced-vs-cohort so the user can see the coverage.
  const inputs: BacktestInput[] = [];
  await Promise.all(
    cohort.map(async (r) => {
      try {
        const history = await getHistory(r.symbol, Math.max(30, rangeDays));
        if (history.length < 2) return;
        const at = priceOnOrBefore(
          history.map((h) => ({ date: h.date.slice(0, 10), close: h.close })),
          r.date,
        );
        const now = history[history.length - 1].close;
        if (at == null || at <= 0 || now <= 0) return;
        inputs.push({
          symbol: r.symbol,
          signal: r.signal,
          compositeScore: r.compositeScore,
          realizedReturn: (now - at) / at,
        });
      } catch {
        /* unpriceable symbol — excluded from the cohort, not fatal */
      }
    }),
  );

  const run: ValidationRun = {
    result: runBacktest(inputs),
    window: { from: earliest, to: new Date().toISOString().slice(0, 10) },
    cohortSize: cohort.length,
    priced: inputs.length,
    ranAt: new Date().toISOString(),
  };

  // Cache failures must not lose the result the user just waited for.
  try { await writeCache(run); } catch { /* non-fatal */ }

  return NextResponse.json({ cached: true as const, ...run });
}
