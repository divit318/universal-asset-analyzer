/**
 * Assistant portfolio awareness (READ-ONLY) — the data source behind both the
 * App Assistant's deterministic portfolio answers and the compact portfolio
 * block injected into its prompt.
 *
 * Two tiers, because the full portfolio report is only cheap when warm:
 *
 *   1. **Holdings line** — symbols straight from the SQLite ledger
 *      (listRawHoldings, ~ms, always available). Enough for "do I own X?".
 *   2. **Metrics snapshot** — value, P&L, weights, sector/class exposure from
 *      getPortfolioForIOS()'s report. That call carries a 5-minute in-memory
 *      cache but costs ~40s COLD (live quotes for every holding), so it is
 *      raced against a short budget: warm → real figures; cold → the caller
 *      proceeds without them (and the attempt itself warms the cache — by the
 *      user's next question the figures are there).
 *
 * Every number here is computed by the same deterministic engines the
 * Portfolio page uses — the model NARRATES this data, it never computes it.
 * Nothing in this module can mutate anything.
 */

import { listWatchlist } from "./db";
import { getPortfolioForIOS } from "./ios/server";
import { listRawHoldings } from "./portfolio/store";
import type { UniversalPortfolioReport } from "./portfolio/report";

export interface AssistantPortfolioSnapshot {
  holdingCount: number;
  totalValue: number;
  totalReturnDollar: number;
  totalReturnPct: number;
  todayChangePct: number;
  baseCurrency: string;
  /** Top positions by weight, descending. */
  topPositions: { symbol: string; name: string; weightPct: number; valueBase: number }[];
  /** Sector weights, descending (top slice first). */
  sectors: { label: string; weightPct: number }[];
  /** Asset-class weights, descending. */
  assetClasses: { label: string; weightPct: number }[];
  /** Concentration findings, as the allocation engine phrases them. */
  concentration: string[];
}

/** Pure: shape the report into the compact snapshot the assistant needs. */
export function snapshotFromReport(report: UniversalPortfolioReport): AssistantPortfolioSnapshot {
  const total = report.totalValue || 1;
  const topPositions = [...report.holdings]
    .filter((h) => h.symbol)
    .sort((a, b) => b.valuation.valueBase - a.valuation.valueBase)
    .slice(0, 8)
    .map((h) => ({
      symbol: h.symbol!,
      name: h.name,
      weightPct: (h.valuation.valueBase / total) * 100,
      valueBase: h.valuation.valueBase,
    }));
  const slices = (view: { slices: { label: string; weight: number }[] }) =>
    view.slices
      .filter((s) => s.weight >= 0.5)
      .slice(0, 6)
      .map((s) => ({ label: s.label, weightPct: s.weight }));

  return {
    holdingCount: report.holdingCount,
    totalValue: report.totalValue,
    totalReturnDollar: report.totalReturnDollar,
    totalReturnPct: report.totalReturn,
    todayChangePct: report.todayChangePct,
    baseCurrency: report.baseCurrency,
    topPositions,
    sectors: slices(report.allocation.bySector),
    assetClasses: slices(report.allocation.byAssetClass),
    concentration: report.concentration.map((c) => `${c.label} ${c.pct.toFixed(0)}%`),
  };
}

/**
 * The metrics snapshot, if it can be had within `budgetMs`. A timeout starts
 * (or joins) the cache-warming computation but never blocks the caller on it.
 */
export async function getPortfolioSnapshot(budgetMs = 600): Promise<AssistantPortfolioSnapshot | null> {
  try {
    const result = await Promise.race([
      getPortfolioForIOS().then(({ report }) => (report ? snapshotFromReport(report) : null)),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), budgetMs)),
    ]);
    return result === "timeout" ? null : result;
  } catch {
    return null;
  }
}

/** Held symbols from the local ledger — always available, ~ms. */
export function heldSymbols(): string[] {
  try {
    return [...new Set(listRawHoldings().map((h) => h.symbol).filter((s): s is string => Boolean(s && s.trim())))];
  } catch {
    return [];
  }
}

/** Watchlist symbols from the local ledger — always available, ~ms. Without
 * this the assistant could see holdings but not the watchlist, so "do I
 * already own anything on my watchlist?" — a question its own starter chip
 * suggests — was unanswerable. */
export function watchedSymbols(): string[] {
  try {
    return listWatchlist().map((i) => i.symbol);
  } catch {
    return [];
  }
}

const money = (v: number, ccy: string) =>
  `${ccy === "USD" ? "$" : `${ccy} `}${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * Render the portfolio section of the App Assistant prompt. Always includes
 * the holdings line; includes live figures only when the snapshot is warm —
 * absent figures are declared absent so the model says "open Portfolio for
 * values" instead of inventing them.
 */
export function renderPortfolioBlock(
  symbols: string[],
  snapshot: AssistantPortfolioSnapshot | null,
  watchlist: string[] = [],
): string {
  // The portfolio/watchlist overlap is precomputed here rather than left to
  // the model: set arithmetic is exactly where a light model slips (observed:
  // correct member lists under a wrong headline count). Deterministic data,
  // narrated — never recomputed.
  const held = new Set(symbols.map((s) => s.toUpperCase()));
  const alsoHeld = watchlist.filter((s) => held.has(s.toUpperCase()));
  const watchOnly = watchlist.filter((s) => !held.has(s.toUpperCase()));
  const watchLine =
    watchlist.length > 0
      ? `\nUSER WATCHLIST (read-only): ${watchlist.length} names — ${watchlist.join(", ")}` +
        (symbols.length > 0
          ? `\nWatchlist∩portfolio: ${alsoHeld.length} also held (${alsoHeld.join(", ") || "none"}); ${watchOnly.length} watch-only (${watchOnly.join(", ") || "none"}).`
          : "")
      : "";
  if (symbols.length === 0) return `USER PORTFOLIO: empty — no positions yet.${watchLine}`;

  const lines = [`USER PORTFOLIO (read-only): ${symbols.length} positions — ${symbols.join(", ")}`];
  if (snapshot) {
    const c = snapshot.baseCurrency;
    lines.push(
      `Total value ${money(snapshot.totalValue, c)}; P&L ${signedPct(snapshot.totalReturnPct)} (${money(snapshot.totalReturnDollar, c)}) since inception; today ${signedPct(snapshot.todayChangePct)}.`,
      `Top positions by weight: ${snapshot.topPositions.map((p) => `${p.symbol} ${p.weightPct.toFixed(1)}%`).join(", ")}.`,
      `Sector weights: ${snapshot.sectors.map((s) => `${s.label} ${s.weightPct.toFixed(1)}%`).join(", ")}.`,
      `Asset classes: ${snapshot.assetClasses.map((s) => `${s.label} ${s.weightPct.toFixed(1)}%`).join(", ")}.`,
    );
    if (snapshot.concentration.length > 0) lines.push(`Concentration flags: ${snapshot.concentration.join("; ")}.`);
  } else {
    lines.push("(Live values/weights not loaded right now — for figures, point the user at the Portfolio page.)");
  }
  return lines.join("\n") + watchLine;
}
