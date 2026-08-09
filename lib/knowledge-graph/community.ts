/**
 * Community detection for the knowledge graph. Pure, deterministic, client-safe.
 *
 * Synchronous label propagation with stable tie-breaking: each node adopts the
 * most common community among its neighbors (weighted by edge strength), ties
 * broken by the smallest community id, iterated to convergence (bounded). At
 * the graph sizes this feature enforces (<100 nodes) this is exact enough and
 * costs microseconds.
 *
 * Communities inform LAYOUT (cluster cohesion forces) and grouping in the
 * table view. They deliberately do NOT drive node colour: hue + shape already
 * encode node type, and one visual channel cannot serve two masters (see
 * docs/kg/02_JOBS.md, decision log).
 */

import type { GraphNode, GraphEdge } from "./types";

/** Deterministic community id per node id. Singleton nodes get their own community. */
export function detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ids = nodes.map((n) => n.id).sort();
  const community = new Map<string, number>(ids.map((id, i) => [id, i]));
  const neighbors = new Map<string, { id: string; weight: number }[]>();
  for (const e of edges) {
    if (!community.has(e.source) || !community.has(e.target)) continue;
    const w = Math.max(1, e.strength);
    neighbors.set(e.source, [...(neighbors.get(e.source) ?? []), { id: e.target, weight: w }]);
    neighbors.set(e.target, [...(neighbors.get(e.target) ?? []), { id: e.source, weight: w }]);
  }

  const MAX_ITERATIONS = 20;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    for (const id of ids) {
      const around = neighbors.get(id);
      if (!around || around.length === 0) continue;
      const votes = new Map<number, number>();
      for (const { id: nid, weight } of around) {
        const c = community.get(nid)!;
        votes.set(c, (votes.get(c) ?? 0) + weight);
      }
      let best = community.get(id)!;
      let bestVotes = -1;
      for (const [c, v] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
        if (v > bestVotes) {
          best = c;
          bestVotes = v;
        }
      }
      if (best !== community.get(id)) {
        community.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Renumber densely (0, 1, 2, ...) in first-seen order for stable output.
  const renumber = new Map<number, number>();
  const out = new Map<string, number>();
  for (const id of ids) {
    const raw = community.get(id)!;
    if (!renumber.has(raw)) renumber.set(raw, renumber.size);
    out.set(id, renumber.get(raw)!);
  }
  return out;
}
