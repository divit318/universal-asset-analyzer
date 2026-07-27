/**
 * Symbol context — the one join that makes the dashboard feel like one brain.
 *
 * For every symbol the digest is about to render (queue rows, radar ideas,
 * movers), gather what the platform already knows about it from state it
 * already holds: the book (held weight), the watchlist (pipeline stage), and
 * the visit log (when it was last researched). Modules look up
 * `digest.symbolContext[symbol]` instead of each inventing its own partial
 * picture — the queue, the radar, and the brief all see the same facts.
 *
 * Deliberately a join, not a fetch: everything here was already loaded for
 * other digest slices, so context costs no extra I/O and can never slow the
 * first paint.
 *
 * Pure — unit-tested in tests/home-symbol-context.test.ts.
 */

import type { SymbolContext } from "./contracts";
import type { IdeaStage, WatchlistItem } from "../types";

export interface SymbolContextInputs {
  /** symbol (any case) → portfolio weight as a PERCENTAGE (0-100). */
  heldWeights: Map<string, number>;
  watchlist: Pick<WatchlistItem, "symbol" | "stage">[];
  /** The visit log — only `kind: "research"` rows contribute research recency. */
  activity: { kind: string; ref: string; at: string }[];
}

/** Looks like a ticker: 1-12 chars of A-Z, digits, dots, hyphens (BRK.B, BTC-USD). */
const SYMBOL_RE = /^[A-Z0-9.\-=^]{1,12}$/;

/**
 * Build the symbol → context map for a set of symbols. Symbols with nothing
 * known about them are omitted — an absent entry means "the platform has no
 * history with this name", which is itself information the UI can render.
 */
export function buildSymbolContext(
  symbols: Iterable<string>,
  inputs: SymbolContextInputs,
): Record<string, SymbolContext> {
  const stageBySymbol = new Map<string, IdeaStage>();
  for (const w of inputs.watchlist) {
    stageBySymbol.set(w.symbol.toUpperCase(), w.stage);
  }

  const researchedAt = new Map<string, string>();
  for (const a of inputs.activity) {
    if (a.kind !== "research") continue;
    const sym = a.ref.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym)) continue;
    const prev = researchedAt.get(sym);
    if (!prev || a.at > prev) researchedAt.set(sym, a.at);
  }

  const heldBySymbol = new Map<string, number>();
  for (const [sym, weight] of inputs.heldWeights) {
    heldBySymbol.set(sym.toUpperCase(), weight);
  }

  const out: Record<string, SymbolContext> = {};
  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym || out[sym]) continue;

    const heldWeightPct = heldBySymbol.get(sym) ?? null;
    const watchlistStage = stageBySymbol.get(sym) ?? null;
    const lastResearchedAt = researchedAt.get(sym) ?? null;

    if (heldWeightPct == null && watchlistStage == null && lastResearchedAt == null) continue;

    out[sym] = { symbol: sym, heldWeightPct, watchlistStage, lastResearchedAt };
  }

  return out;
}
