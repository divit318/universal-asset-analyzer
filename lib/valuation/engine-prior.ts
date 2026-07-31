/**
 * The quant engine's Monte Carlo intrinsic-value prior, read cheaply.
 *
 * The engine already computes a 50,000-path DCF per symbol and stores it in
 * DuckDB, but the only way to read it was /api/engine/detail, which spawns a
 * Python interpreter per symbol because the per-symbol snapshots are Parquet.
 * That is fine for a deliberate drill-down and hopeless for anything that wants
 * many symbols at once — the Research Hub strip on every page view, or the whole
 * Valuation Register.
 *
 * So the engine now publishes one flat JSON map (`export_valuation_priors` in
 * engine/data/loader.py) and this module reads it with plain `fs`, caching it
 * against the file's mtime. In steady state a prior costs a map lookup and no
 * subprocess at all.
 *
 * If the map is missing — an engine that last ran before this existed — one
 * bounded Python call backfills it from DuckDB. That is one subprocess per engine
 * run rather than one per symbol read, and concurrent callers share it.
 */

import fs from "fs";
import path from "path";
import { runEnginePython } from "../engine-python";

export interface EnginePrior {
  symbol: string;
  /** Monte Carlo intrinsic value per share, by percentile. */
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  /** The discount rate the engine used, as a fraction. */
  wacc: number | null;
  /** Terminal growth the engine used, as a fraction. */
  terminalGrowth: number | null;
  /** Engine run date this prior came from. */
  asOf: string | null;
}

export interface EnginePriorSnapshot {
  priors: Map<string, EnginePrior>;
  /** When the engine published the map. */
  generatedAt: string | null;
  runDate: string | null;
}

// Overridable for tests, matching the DB_PATH convention in lib/db.ts.
const PRIORS_PATH =
  process.env.VALUATION_PRIORS_PATH ?? path.join(process.cwd(), "data", "valuation_priors.json");
const DUCKDB_PATH = path.join(process.cwd(), "data", "engine.duckdb");
const BACKFILL_TIMEOUT_MS = 30_000;

const EMPTY: EnginePriorSnapshot = { priors: new Map(), generatedAt: null, runDate: null };

let cache: { mtimeMs: number; snapshot: EnginePriorSnapshot } | null = null;
/** Shared so a burst of concurrent readers triggers at most one backfill. */
let backfillInFlight: Promise<void> | null = null;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseSnapshot(raw: string): EnginePriorSnapshot {
  const parsed = JSON.parse(raw) as {
    generatedAt?: unknown;
    runDate?: unknown;
    priors?: Record<string, Record<string, unknown>>;
  };
  const priors = new Map<string, EnginePrior>();
  for (const [symbol, row] of Object.entries(parsed.priors ?? {})) {
    if (row == null || typeof row !== "object") continue;
    const p50 = num(row.p50);
    // A prior without a median is not a prior.
    if (p50 == null) continue;
    priors.set(symbol.toUpperCase(), {
      symbol: symbol.toUpperCase(),
      p10: num(row.p10),
      p25: num(row.p25),
      p50,
      p75: num(row.p75),
      p90: num(row.p90),
      wacc: num(row.wacc),
      terminalGrowth: num(row.terminalGrowth),
      asOf: typeof row.asOf === "string" ? row.asOf : null,
    });
  }
  return {
    priors,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
    runDate: typeof parsed.runDate === "string" ? parsed.runDate : null,
  };
}

/** Read the published map, using the in-memory copy unless the file has changed. */
function readFromDisk(): EnginePriorSnapshot | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(PRIORS_PATH);
  } catch {
    return null;
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.snapshot;
  try {
    const snapshot = parseSnapshot(fs.readFileSync(PRIORS_PATH, "utf8"));
    cache = { mtimeMs: stat.mtimeMs, snapshot };
    return snapshot;
  } catch {
    // A truncated or malformed map degrades to "no prior" rather than throwing
    // into whatever page happened to ask.
    return null;
  }
}

/**
 * One-shot backfill for a DuckDB that predates the published map.
 *
 * Deliberately not a per-request fallback: it reads every symbol at once and
 * writes the same file the engine writes, so it happens once and then never
 * again until the next engine run.
 */
const BACKFILL_SCRIPT = `
import duckdb, json, sys, datetime, pathlib

out = pathlib.Path(${JSON.stringify(PRIORS_PATH)})
try:
    conn = duckdb.connect(${JSON.stringify(DUCKDB_PATH)}, read_only=True)
except Exception as e:
    print(json.dumps({"error": str(e)})); sys.exit(0)

try:
    rows = conn.execute("""
        SELECT m.symbol, m.date, m.intrinsic_p10, m.intrinsic_p25, m.intrinsic_p50,
               m.intrinsic_p75, m.intrinsic_p90, m.wacc, m.terminal_growth
        FROM mc_valuation m
        JOIN (SELECT symbol, MAX(date) AS d FROM mc_valuation GROUP BY symbol) latest
          ON m.symbol = latest.symbol AND m.date = latest.d
    """).fetchall()
except Exception as e:
    print(json.dumps({"error": str(e)})); sys.exit(0)
finally:
    conn.close()

priors = {}
run_date = None
for (sym, date, p10, p25, p50, p75, p90, wacc, tg) in rows:
    if p50 is None:
        continue
    run_date = run_date or (str(date) if date is not None else None)
    priors[str(sym)] = {"p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90,
                        "wacc": wacc, "terminalGrowth": tg,
                        "asOf": str(date) if date is not None else None}

payload = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "runDate": run_date, "count": len(priors), "priors": priors}
tmp = out.with_suffix(".json.tmp")
out.parent.mkdir(parents=True, exist_ok=True)
tmp.write_text(json.dumps(payload, default=str))
tmp.rename(out)
print(json.dumps({"count": len(priors)}))
`;

async function backfill(): Promise<void> {
  if (backfillInFlight) return backfillInFlight;
  backfillInFlight = (async () => {
    try {
      await runEnginePython(["-c", BACKFILL_SCRIPT], { timeoutMs: BACKFILL_TIMEOUT_MS });
    } catch {
      /* no engine, no DuckDB, or it timed out — callers degrade to no prior */
    } finally {
      // Cleared regardless so a later engine run can be picked up.
      backfillInFlight = null;
    }
  })();
  return backfillInFlight;
}

/**
 * Every published prior. Synchronous and cheap — safe to call per request.
 * Returns an empty map when the engine has never published one.
 */
export function enginePriors(): EnginePriorSnapshot {
  return readFromDisk() ?? EMPTY;
}

/** The prior for one symbol, or null when the engine has not scored it. */
export function getEnginePrior(symbol: string): EnginePrior | null {
  return enginePriors().priors.get(symbol.trim().toUpperCase()) ?? null;
}

/**
 * Like `getEnginePrior`, but backfills the map once if it has never been
 * published. Use from routes that can afford to wait on a cold start; use the
 * synchronous form anywhere on a latency budget.
 */
export async function getEnginePriorEnsured(symbol: string): Promise<EnginePrior | null> {
  const direct = getEnginePrior(symbol);
  if (direct) return direct;
  if (fs.existsSync(PRIORS_PATH) || !fs.existsSync(DUCKDB_PATH)) return null;
  await backfill();
  return getEnginePrior(symbol);
}

/** True when the engine has published a prior map at all. */
export function hasEnginePriors(): boolean {
  return enginePriors().priors.size > 0;
}
