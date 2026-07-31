/**
 * Cross-theme overlap (PR-4) — "how much of this theme do I already own via
 * another one?".
 *
 * The platform cache keeps every generated thematic report, so comparing two
 * themes costs no inference and no network: company overlap is a Jaccard over
 * the mapped tierCompanies symbols, and the market-level relationship comes
 * from correlating the proxy series each report already carries
 * (proxyPerformance, PR-3). Pure and deterministic — the API route supplies
 * the reports; this module never touches the cache itself, so it stays
 * client-safe and unit-testable.
 */

import type { ThematicReport } from "./thematic-engine";

export interface ThemeOverlap {
  /** The other theme, as its report spells it. */
  theme: string;
  generatedAt: string;
  /** Symbols mapped by BOTH reports, alphabetical. */
  sharedSymbols: string[];
  /** |A ∩ B| / |A ∪ B| over mapped company symbols, 0–1. Null when either side mapped nothing. */
  jaccard: number | null;
  /** Companies each side mapped, for the "6 of 14" phrasing. */
  companiesA: number;
  companiesB: number;
  /** Proxy tickers both themes resolve to (e.g. LIT shared by Battery and EV). */
  sharedProxies: string[];
  /** Pearson correlation of weekly returns between the two lead proxies, or null without enough aligned data. */
  proxyCorrelation1Y: number | null;
}

/** Pearson correlation of two equal-length numeric series; null under n=8. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return +(cov / Math.sqrt(va * vb)).toFixed(2);
}

/** Weekly returns over the dates both series share, aligned by date. */
function alignedReturns(
  a: { date: string; close: number }[],
  b: { date: string; close: number }[],
): [number[], number[]] {
  const bByDate = new Map(b.map((p) => [p.date, p.close]));
  const pairs = a.filter((p) => bByDate.has(p.date));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    const pa0 = pairs[i - 1].close, pa1 = pairs[i].close;
    const pb0 = bByDate.get(pairs[i - 1].date)!, pb1 = bByDate.get(pairs[i].date)!;
    if (pa0 > 0 && pb0 > 0) {
      ra.push(pa1 / pa0 - 1);
      rb.push(pb1 / pb0 - 1);
    }
  }
  return [ra, rb];
}

/** Compare the current report against one previously saved report. */
export function overlapBetween(current: ThematicReport, other: ThematicReport): ThemeOverlap {
  const symbolsA = new Set(current.tierCompanies.map((c) => c.symbol.toUpperCase()));
  const symbolsB = new Set(other.tierCompanies.map((c) => c.symbol.toUpperCase()));
  const shared = [...symbolsA].filter((s) => symbolsB.has(s)).sort();
  const unionSize = new Set([...symbolsA, ...symbolsB]).size;

  const proxiesA = new Set(current.supplyDemand.commodityProxies.map((p) => p.ticker.toUpperCase()));
  const sharedProxies = [...new Set(other.supplyDemand.commodityProxies.map((p) => p.ticker.toUpperCase()))]
    .filter((t) => proxiesA.has(t))
    .sort();

  // Market-level relationship: the lead proxy series each report carries.
  const seriesA = current.proxyPerformance?.proxies[0]?.series;
  const seriesB = other.proxyPerformance?.proxies[0]?.series;
  let proxyCorrelation1Y: number | null = null;
  if (seriesA && seriesB) {
    const [ra, rb] = alignedReturns(seriesA, seriesB);
    proxyCorrelation1Y = pearson(ra, rb);
  }

  return {
    theme: other.theme,
    generatedAt: other.generatedAt,
    sharedSymbols: shared,
    jaccard: unionSize > 0 ? +(shared.length / unionSize).toFixed(2) : null,
    companiesA: symbolsA.size,
    companiesB: symbolsB.size,
    sharedProxies,
    proxyCorrelation1Y,
  };
}

/**
 * Overlaps against every other saved report, most-overlapping first.
 * Themes with nothing in common (no shared names, no shared proxies, no
 * correlation basis) are dropped — an empty comparison is noise, not insight.
 */
export function computeOverlaps(current: ThematicReport, others: ThematicReport[]): ThemeOverlap[] {
  return others
    .filter((o) => o.theme.toLowerCase() !== current.theme.toLowerCase())
    .map((o) => overlapBetween(current, o))
    .filter((o) => o.sharedSymbols.length > 0 || o.sharedProxies.length > 0 || o.proxyCorrelation1Y != null)
    .sort((a, b) => b.sharedSymbols.length - a.sharedSymbols.length || (b.jaccard ?? 0) - (a.jaccard ?? 0));
}
