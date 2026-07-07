import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getHistory } from "@/lib/yahoo";
import { priceOnOrBefore } from "@/lib/portfolio-performance";
import { runBacktest, type BacktestInput } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * GET /api/backtest — did the quant engine's actionable signals work?
 *
 * Reads the engine's signal log, keeps the latest actionable (non-HOLD) signal
 * per symbol, joins each to its realized return since it fired (Yahoo history),
 * and aggregates. Bounded to the ~50 names the engine actually flagged, so it
 * stays a single fast request.
 */
export async function GET() {
  let csv: string;
  try {
    csv = await readFile(path.join(process.cwd(), "data", "signal_log.csv"), "utf8");
  } catch {
    return NextResponse.json({ error: "No signal log found — run the quant engine first." }, { status: 404 });
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
    return NextResponse.json({ empty: true, reason: "No actionable (non-HOLD) signals in the log." });
  }

  const earliest = cohort.reduce((min, r) => (r.date < min ? r.date : min), cohort[0].date);
  const rangeDays = Math.ceil((Date.now() - Date.parse(earliest)) / 86_400_000) + 20;

  // Join each signal to its realized return since it fired.
  const inputs: BacktestInput[] = [];
  await Promise.all(
    cohort.map(async (r) => {
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
    }),
  );

  const result = runBacktest(inputs);
  return NextResponse.json({
    result,
    window: { from: earliest, to: new Date().toISOString().slice(0, 10) },
    cohortSize: cohort.length,
    priced: inputs.length,
  });
}
