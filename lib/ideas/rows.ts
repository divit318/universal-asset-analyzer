/**
 * IdeaRow — one tracked idea, shaped for the relevance engine and the board.
 *
 * Successor to the pipeline board's row type: `stage` (a stored label) is
 * replaced by `workflow` (derived from evidence + the ledger, lib/ideas/
 * evidence.ts) and `daysInStage` by `idleDays` (days since the last recorded
 * activity — a fact about the idea, not about a column).
 *
 * Pure: the page builds rows from data it already fetched; nothing here reads
 * the network or the database.
 */

import { assetClassForSymbol } from "../assets/registry";
import { describeOrigin, type IdeaOrigin } from "../idea-source";
import type { PortfolioAssetClass } from "../portfolio/model/types";
import type { TargetDirection, WatchlistItem } from "../types";
import { idleDays, type IdeaEvidence, type IdeaWorkflow } from "./evidence";

export interface IdeaRow {
  symbol: string;
  name: string;
  workflow: IdeaWorkflow;
  /** Whole days since the last recorded activity on this idea. */
  idleDays: number;
  /** Currently held in the portfolio (ledger fact). */
  held: boolean;
  /**
   * The symbol's asset class by shape (Yahoo's suffixes are a convention, not
   * a guess) — null when the shape says nothing, which for a bare ticker means
   * "an equity or a fund". Drives filters; never used as a number.
   */
  assetClass: PortfolioAssetClass | null;
  /** Where the idea came from, and one sentence describing it. */
  origin: IdeaOrigin;
  originLabel: string;
  targetPrice: number | null;
  targetDirection: TargetDirection | null;
  /** Whether the user has written anything about it. */
  hasNotes: boolean;
}

/** Build the engine-facing row from a watchlist item + its derived state. */
export function toIdeaRow(
  item: WatchlistItem,
  input: { workflow: IdeaWorkflow; evidence: IdeaEvidence; held: boolean; now?: number },
): IdeaRow {
  const now = input.now ?? Date.now();
  const symbol = item.symbol.toUpperCase();
  const origin: IdeaOrigin = { source: item.source, detail: item.sourceDetail, at: item.addedAt };
  // indiaEquity is a screening domain; as a *position class* it is equity.
  const cls = assetClassForSymbol(symbol);
  return {
    symbol,
    name: item.name,
    workflow: input.workflow,
    idleDays: idleDays(item, input.evidence, now),
    held: input.held,
    assetClass: cls === "indiaEquity" ? "equity" : cls,
    origin,
    originLabel: describeOrigin(origin, now),
    targetPrice: item.targetPrice ?? null,
    targetDirection: item.targetDirection ?? null,
    hasNotes: Boolean(item.notes?.trim()),
  };
}
