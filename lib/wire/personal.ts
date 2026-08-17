/**
 * For You — the scan's signals joined to the user's own names, plus a
 * deterministic aggregate readout.
 *
 * Replaces the two near-identical Watchlist Impact / Portfolio Impact panels
 * with one join. Every directional conclusion here is computed in code from
 * the pipeline's already-scored output — the readout sentence is composed
 * from settled facts, never asked of a model (see AGENTS.md, "Never let the
 * model derive a directional verdict").
 */

import type { ScannerOpportunity, SignalDirection } from "../types";

export interface AffectedName {
  ticker: string;
  name: string;
  direction: SignalDirection;
  composite: number;
  rationale: string;
  opportunityId: string;
  theme: string;
}

export interface ImpactGroup {
  /** How many symbols the user tracks in this bucket. */
  tracked: number;
  /** Names this scan flagged, bearish first (risk reads before comfort). */
  affected: AffectedName[];
}

export interface PersonalImpact {
  portfolio: ImpactGroup;
  watchlist: ImpactGroup;
  /**
   * One or two sentences of settled facts ("2 holdings carry bullish
   * signals…"), null when the scan touches nothing the user tracks.
   */
  readout: string | null;
  /** A theme ≥2 affected names share — the concentration worth knowing about. */
  commonThread: { theme: string; tickers: string[] } | null;
}

function symbolKey(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/, "").toUpperCase();
}

const DIRECTION_RANK: Record<SignalDirection, number> = { bearish: 0, bullish: 1, neutral: 2 };

function toAffected(o: ScannerOpportunity): AffectedName {
  return {
    ticker: o.ticker,
    name: o.name,
    direction: o.direction,
    composite: o.opportunityScore.composite,
    rationale: o.rationale,
    opportunityId: o.id,
    theme: o.theme,
  };
}

function affectedIn(
  opportunities: ScannerOpportunity[],
  symbols: Set<string>,
): AffectedName[] {
  return opportunities
    .filter((o) => symbols.has(symbolKey(o.ticker)))
    .map(toAffected)
    .sort(
      (a, b) =>
        DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction] || b.composite - a.composite,
    );
}

function listTickers(names: AffectedName[], max = 4): string {
  const tickers = names.map((n) => n.ticker.replace(/\.(NS|BO)$/, ""));
  const head = tickers.slice(0, max).join(", ");
  return tickers.length > max ? `${head} +${tickers.length - max}` : head;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Join scan output to the user's names. Symbols in both buckets count as
 * portfolio only — owning a name outranks watching it.
 */
export function buildPersonalImpact(
  opportunities: ScannerOpportunity[],
  portfolioSymbols: string[],
  watchlistSymbols: string[],
): PersonalImpact {
  const held = new Set(portfolioSymbols.map(symbolKey));
  const watchedOnly = new Set(
    watchlistSymbols.map(symbolKey).filter((s) => !held.has(s)),
  );

  const portfolio: ImpactGroup = {
    tracked: held.size,
    affected: affectedIn(opportunities, held),
  };
  const watchlist: ImpactGroup = {
    tracked: watchedOnly.size,
    affected: affectedIn(opportunities, watchedOnly),
  };

  // Common thread: a theme ≥2 affected names (across both buckets) share.
  const byTheme = new Map<string, string[]>();
  for (const n of [...portfolio.affected, ...watchlist.affected]) {
    const key = n.theme.trim();
    if (!key) continue;
    byTheme.set(key, [...(byTheme.get(key) ?? []), n.ticker]);
  }
  const thread = [...byTheme.entries()]
    .filter(([, tickers]) => tickers.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)[0];

  const parts: string[] = [];
  const pfBull = portfolio.affected.filter((n) => n.direction === "bullish");
  const pfBear = portfolio.affected.filter((n) => n.direction === "bearish");
  if (pfBear.length > 0) {
    parts.push(`${plural(pfBear.length, "holding")} carr${pfBear.length === 1 ? "ies" : "y"} bearish signals (${listTickers(pfBear)})`);
  }
  if (pfBull.length > 0) {
    parts.push(`${plural(pfBull.length, "holding")} carr${pfBull.length === 1 ? "ies" : "y"} bullish signals (${listTickers(pfBull)})`);
  }
  const wlAffected = watchlist.affected;
  if (wlAffected.length > 0) {
    parts.push(`${plural(wlAffected.length, "watchlist name")} flagged (${listTickers(wlAffected)})`);
  }

  return {
    portfolio,
    watchlist,
    readout: parts.length > 0 ? `${parts.join("; ")}.` : null,
    commonThread: thread ? { theme: thread[0], tickers: thread[1] } : null,
  };
}
