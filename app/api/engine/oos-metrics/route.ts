/**
 * GET /api/engine/oos-metrics
 * Returns live OOS metrics from signal_log.csv + data_health.json.
 *
 * Response shape:
 *   {
 *     live_IC:          number | null,
 *     hit_rate:         number | null,
 *     strong_buy_alpha: number | null,
 *     sharpe_live:      number | null,
 *     n_obs:            number,
 *     ic_quality:       "HIGH" | "MEDIUM" | "LOW" | "DEGRADED" | "INSUFFICIENT",
 *     data_health:      object | null,
 *   }
 */

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNAL_LOG_PATH = path.join(process.cwd(), "data", "signal_log.csv");
const DATA_HEALTH_PATH = path.join(process.cwd(), "data", "data_health.json");

type IcQuality = "HIGH" | "MEDIUM" | "LOW" | "DEGRADED" | "INSUFFICIENT";

function classifyIc(ic: number | null, nObs: number): IcQuality {
  if (nObs < 20) return "INSUFFICIENT";
  if (ic === null) return "INSUFFICIENT";
  if (ic >= 0.06) return "HIGH";
  if (ic >= 0.02) return "MEDIUM";
  if (ic >= 0.0) return "LOW";
  return "DEGRADED";
}

function readOosMetrics(): {
  live_IC: number | null;
  hit_rate: number | null;
  strong_buy_alpha: number | null;
  sharpe_live: number | null;
  n_obs: number;
} {
  if (!fs.existsSync(SIGNAL_LOG_PATH)) {
    return { live_IC: null, hit_rate: null, strong_buy_alpha: null, sharpe_live: null, n_obs: 0 };
  }

  const csv = fs.readFileSync(SIGNAL_LOG_PATH, "utf-8");
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return { live_IC: null, hit_rate: null, strong_buy_alpha: null, sharpe_live: null, n_obs: 0 };
  }

  const headers = lines[0].split(",");
  const idxDate = headers.indexOf("date");
  const idxComp = headers.indexOf("composite_score");
  const idxSig  = headers.indexOf("signal");
  const idxFwd  = headers.indexOf("fwd_return_21d");

  const cutoffMs = Date.now() - 84 * 24 * 60 * 60 * 1000; // 84 days

  const valid: Array<{ composite: number; signal: string; fwd: number }> = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const fwdStr = parts[idxFwd]?.trim();
    if (!fwdStr) continue;
    const fwd = parseFloat(fwdStr);
    if (!isFinite(fwd)) continue;
    const dateStr = parts[idxDate]?.trim();
    if (!dateStr) continue;
    const ts = Date.parse(dateStr);
    if (!isFinite(ts) || ts < cutoffMs) continue;
    const composite = parseFloat(parts[idxComp]?.trim() || "");
    if (!isFinite(composite)) continue;
    valid.push({ composite, signal: parts[idxSig]?.trim() || "", fwd });
  }

  if (valid.length < 20) {
    return { live_IC: null, hit_rate: null, strong_buy_alpha: null, sharpe_live: null, n_obs: valid.length };
  }

  // Spearman rank correlation (composite vs fwd_return_21d)
  const n = valid.length;
  const rankArr = (arr: number[]): number[] => {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[indexed[i].i] = i + 1;
    return ranks;
  };

  const compRanks = rankArr(valid.map((r) => r.composite));
  const fwdRanks  = rankArr(valid.map((r) => r.fwd));

  let dSqSum = 0;
  for (let i = 0; i < n; i++) dSqSum += (compRanks[i] - fwdRanks[i]) ** 2;
  const live_IC = 1 - (6 * dSqSum) / (n * (n * n - 1));

  // Hit rate: fraction of STRONG_BUY with fwd > 0
  const sbRows = valid.filter((r) => r.signal === "STRONG_BUY");
  const hit_rate = sbRows.length > 0
    ? sbRows.filter((r) => r.fwd > 0).length / sbRows.length
    : null;

  // Strong buy alpha vs universe mean
  const meanFwd = valid.reduce((s, r) => s + r.fwd, 0) / n;
  const strong_buy_alpha = sbRows.length > 0
    ? sbRows.reduce((s, r) => s + r.fwd, 0) / sbRows.length - meanFwd
    : null;

  // Sharpe: annualised mean/std of 21d returns
  const fwds = valid.map((r) => r.fwd);
  const mean = fwds.reduce((s, v) => s + v, 0) / n;
  const variance = fwds.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const sharpe_live = std > 1e-8 ? (mean / std) * Math.sqrt(252 / 21) : null;

  return {
    live_IC: isFinite(live_IC) ? live_IC : null,
    hit_rate,
    strong_buy_alpha,
    sharpe_live: sharpe_live !== null && isFinite(sharpe_live) ? sharpe_live : null,
    n_obs: n,
  };
}

export async function GET() {
  const metrics = readOosMetrics();
  const ic_quality = classifyIc(metrics.live_IC, metrics.n_obs);

  let data_health: object | null = null;
  if (fs.existsSync(DATA_HEALTH_PATH)) {
    try {
      data_health = JSON.parse(fs.readFileSync(DATA_HEALTH_PATH, "utf-8"));
    } catch {
      data_health = null;
    }
  }

  return NextResponse.json({
    ...metrics,
    ic_quality,
    data_health,
  });
}
