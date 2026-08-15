/**
 * Correlation clusters — groups of holdings that move as one trade.
 *
 * The old health score charged co-movement three separate times (Diversification,
 * Concentration, Correlation each re-measured a slice of it). The alignment
 * engine instead asks the one question co-movement actually raises: HOW BIG is
 * the biggest single bet, once names that trade together are counted as one?
 * NVDA + QQQM + VOO at 12% + 20% + 14% is not three positions — it is a 46% bet
 * with three tickers, and it is judged against the investor's own cap exactly
 * once, here.
 *
 * Clusters are connected components over the risk engine's own correlation
 * matrix, using the SAME r-threshold its highPairs list uses — one definition
 * of "highly correlated" across the app. Holdings without a return series are
 * simply absent (the matrix already excludes them, deliberately, rather than
 * assuming them uncorrelated); their sizes are still policed by the single-name
 * cap check.
 */

import { HIGH_CORRELATION_R, type CorrelationMatrix } from "../engines/risk";
import type { Holding } from "../model/types";

export { HIGH_CORRELATION_R };

export interface CorrelationCluster {
  /** Members, largest weight first. */
  symbols: string[];
  /** Combined % of portfolio value. */
  weight: number;
  /** Mean pairwise r inside the cluster. */
  avgR: number;
}

/**
 * Connected components of the correlation graph (edge = r > HIGH_CORRELATION_R),
 * keeping only genuine clusters (≥ 2 members), sorted by combined weight
 * descending. Returns [] when there is no matrix or no cluster.
 */
export function correlationClusters(
  correlation: CorrelationMatrix | null,
  holdings: Holding[],
): CorrelationCluster[] {
  if (!correlation || correlation.symbols.length < 2) return [];
  const { symbols, matrix } = correlation;
  const n = symbols.length;

  const weightBySymbol = new Map<string, number>();
  for (const h of holdings) {
    if (!h.symbol) continue;
    const key = h.symbol.toUpperCase();
    weightBySymbol.set(key, (weightBySymbol.get(key) ?? 0) + h.weight);
  }

  // Union-find over the r > threshold edges.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = matrix[i]?.[j];
      if (r != null && Number.isFinite(r) && r > HIGH_CORRELATION_R) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const clusters: CorrelationCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let rSum = 0;
    let rCount = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const r = matrix[members[a]]?.[members[b]];
        if (r != null && Number.isFinite(r)) {
          rSum += r;
          rCount++;
        }
      }
    }
    const named = members
      .map((i) => ({ symbol: symbols[i], weight: weightBySymbol.get(symbols[i].toUpperCase()) ?? 0 }))
      .sort((a, b) => b.weight - a.weight);
    clusters.push({
      symbols: named.map((m) => m.symbol),
      weight: named.reduce((s, m) => s + m.weight, 0),
      avgR: rCount > 0 ? rSum / rCount : 0,
    });
  }

  return clusters.sort((a, b) => b.weight - a.weight);
}
