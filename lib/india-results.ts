/**
 * Results-day intelligence for Indian listings — the deterministic join of
 * three things UAA already has:
 *
 *   1. the NSE results filing (when it hit the tape — lib/india-news.ts),
 *   2. the reported quarter's numbers (screener.in quarterly P&L, cached),
 *   3. the price reaction (Yahoo daily history).
 *
 * Nothing here is estimated: a YoY delta is only computed when the cached
 * quarterly table actually contains the reported quarter (matched by period),
 * and the "day move" is the close-to-close change of the first trading
 * session on/after the filing date, labeled with that session's date.
 */

import { getScreenerInCompany, type ScreenerInQuarterlyPL } from "./screener-in";
import { getHistory } from "./yahoo";
import { indianFiscalLabel } from "./format";

export interface ResultsDaySnapshot {
  symbol: string;                 // base symbol
  /** Indian fiscal quarter, e.g. "Q1 FY27" — null if the quarter can't be matched. */
  quarterLabel: string | null;
  /** Calendar period end, e.g. "Jun 2026". */
  periodEnded: string | null;
  reportedAt: string;             // ISO — the NSE filing timestamp
  /** YoY deltas for the reported quarter, % (null = data not yet in the table). */
  revenueYoY: number | null;
  netProfitYoY: number | null;
  /** Reported quarter EPS in ₹ (level, not a delta). */
  eps: number | null;
  /** Banks/NBFCs: the quarter's financing margin %, when published. */
  financingMarginPercent: number | null;
  /** Close-to-close % move of the first session on/after the filing date. */
  dayMovePct: number | null;
  /** The session `dayMovePct` describes (may be the next trading day). */
  dayMoveDate: string | null;
}

function pctChange(curr: number | null, prior: number | null): number | null {
  if (curr == null || prior == null || prior === 0) return null;
  return Number((((curr - prior) / Math.abs(prior)) * 100).toFixed(1));
}

/** "Jun 2026" period ends within `days` before the filing timestamp. */
function periodMatchesFiling(period: string, reportedAtMs: number, days = 100): boolean {
  const end = Date.parse(`28 ${period} UTC`); // ~month end
  return Number.isFinite(end) && reportedAtMs > end && reportedAtMs - end < days * 86_400_000;
}

/**
 * Build the snapshot. Uses the cached screener.in row (6h TTL — a company
 * that just reported is typically already warm from research/radar traffic)
 * and one cached history fetch; both fail soft to nulls.
 */
export async function getResultsDaySnapshot(
  nsSymbol: string,
  reportedAt: string,
): Promise<ResultsDaySnapshot> {
  const base = nsSymbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
  const reportedMs = Date.parse(reportedAt);

  const snapshot: ResultsDaySnapshot = {
    symbol: base,
    quarterLabel: null,
    periodEnded: null,
    reportedAt,
    revenueYoY: null,
    netProfitYoY: null,
    eps: null,
    financingMarginPercent: null,
    dayMovePct: null,
    dayMoveDate: null,
  };
  if (!Number.isFinite(reportedMs)) return snapshot;

  // ── The reported quarter's numbers, only if the table already has it ──
  const company = await getScreenerInCompany(base).catch(() => null);
  const q = company?.quarterlyPL ?? [];
  const latest: ScreenerInQuarterlyPL | undefined = q.at(-1);
  if (latest && periodMatchesFiling(latest.period, reportedMs)) {
    const yearAgo = q.length >= 5 ? q.at(-5)! : null;
    const aligned = yearAgo && yearAgo.period.slice(0, 3) === latest.period.slice(0, 3) ? yearAgo : null;
    snapshot.quarterLabel = indianFiscalLabel(latest.period);
    snapshot.periodEnded = latest.period;
    snapshot.revenueYoY = pctChange(latest.sales, aligned?.sales ?? null);
    snapshot.netProfitYoY = pctChange(latest.netProfit, aligned?.netProfit ?? null);
    snapshot.eps = latest.eps ?? null;
    if (company?.statementKind === "financial") {
      snapshot.financingMarginPercent = latest.financingMarginPercent ?? null;
    }
  }

  // ── Price reaction: first session on/after the filing date ──
  try {
    const history = await getHistory(`${base}.NS`, 30);
    const day = reportedAt.slice(0, 10);
    const idx = history.findIndex((p) => p.date.slice(0, 10) >= day);
    if (idx > 0) {
      const bar = history[idx];
      // Only within 3 calendar days of the filing — beyond that the "reaction"
      // label would be dishonest.
      if (Date.parse(bar.date) - reportedMs < 3 * 86_400_000) {
        const prev = history[idx - 1];
        if (prev.close > 0) {
          snapshot.dayMovePct = Number((((bar.close - prev.close) / prev.close) * 100).toFixed(1));
          snapshot.dayMoveDate = bar.date.slice(0, 10);
        }
      }
    }
  } catch {
    /* no price context — the snapshot stands without it */
  }

  return snapshot;
}

/** Compact one-line rendering shared by the radar and the notification body. */
export function describeResultsSnapshot(s: ResultsDaySnapshot): string | null {
  const parts: string[] = [];
  if (s.netProfitYoY != null) parts.push(`net profit ${s.netProfitYoY >= 0 ? "+" : ""}${s.netProfitYoY}% YoY`);
  if (s.revenueYoY != null) parts.push(`revenue ${s.revenueYoY >= 0 ? "+" : ""}${s.revenueYoY}% YoY`);
  if (s.financingMarginPercent != null) parts.push(`financing margin ${s.financingMarginPercent}%`);
  if (s.dayMovePct != null) parts.push(`shares ${s.dayMovePct >= 0 ? "+" : ""}${s.dayMovePct}% on ${s.dayMoveDate ?? "results day"}`);
  return parts.length ? parts.join("; ") : null;
}
