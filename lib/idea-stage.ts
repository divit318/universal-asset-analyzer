/**
 * Stored idea-stage vocabulary + the ledger's automatic transitions.
 *
 * The 2026-08 consolidation replaced the manually-curated pipeline stages with
 * a workflow DERIVED from evidence (lib/ideas/evidence.ts). What remains here
 * is the part that was always honest:
 *
 *  - the stored `stage` column's vocabulary (only `passed` and the ledger
 *    outcomes still carry meaning; `surfaced`/`researching`/`thesis` are legacy
 *    values that the derivation deliberately ignores),
 *  - the buy → `owned` / sell-all → `exited` auto-transitions,
 *  - `effectiveStage`, which lets the ledger win over a stale stored value in
 *    both directions,
 *  - `isPipelineSymbol`, the one predicate for "is this a researchable,
 *    market-quoted symbol at all".
 *
 * Kept free of React and of the database so the transition rules stay
 * unit-testable in isolation (tests/idea-stage.test.ts).
 */

import type { IdeaStage } from "./types";

/** Every value the `stage` column may store. Order is not meaningful. */
export const IDEA_STAGES: IdeaStage[] = ["surfaced", "researching", "thesis", "owned", "passed", "exited"];

export function isIdeaStage(value: unknown): value is IdeaStage {
  return typeof value === "string" && (IDEA_STAGES as string[]).includes(value);
}

/**
 * Whether a holding is an *idea* at all — the one predicate that decides which
 * of the portfolio's holdings the watchlist is answerable for.
 *
 * A trackable symbol is a symbol a market quotes: everything you can research,
 * price and re-buy. That excludes exactly two things:
 *
 *  - **Cash** — stored as a synthetic `CASH-USD` lot (see store.ts), quoted by
 *    nobody, and bookkeeping rather than a position anyone researches.
 *  - **Manually-valued assets** — property, private stakes, collectibles. They
 *    carry `symbol: null` because no ticker exists.
 *
 * The character class is deliberately wider than a US equity ticker: Yahoo
 * quotes futures as `HE=F`, forex as `USDCHF=X`, indices as `^GSPC` and crypto
 * as `USD136148-USD`. Those are tradeable and *are* held in this ledger, so
 * excluding them would let a surface show a holding it refused to call owned.
 */
export function isPipelineSymbol(symbol: string | null | undefined): symbol is string {
  if (!symbol) return false;
  const sym = symbol.trim().toUpperCase();
  if (sym.startsWith("CASH-")) return false;
  return /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/.test(sym);
}

/**
 * The stage a reader must treat as current, given what the ledger says.
 *
 * `owned` is not an opinion about an idea — it is a fact about the ledger, so
 * the ledger wins over the stored stage in both directions. A held name reads
 * `owned` whatever its row says; a row that still says `owned` for a name the
 * ledger no longer holds has been left behind by a ledger change that didn't
 * reconcile it, and reads `exited`.
 */
export function effectiveStage(stored: IdeaStage, held: boolean): IdeaStage {
  if (held) return "owned";
  return stored === "owned" ? "exited" : stored;
}

/**
 * The stage a ledger write auto-transitions a symbol to, where unambiguous:
 * a buy makes it `owned`; a sell that closes the position makes it `exited`.
 * A partial sell (still held) leaves the stage untouched. Cash lots, balancing
 * entries, and non-ticker rows never transition. Returns null when no
 * transition should fire.
 */
export function autoStageForTrade(input: {
  kind: "buy" | "sell";
  assetClass: string;
  symbol: string;
  /** True when, after this write, the symbol still has an open position. */
  stillHeld: boolean;
}): IdeaStage | null {
  const sym = input.symbol.trim().toUpperCase();
  // Cash, balancing plugs, and synthesized cash symbols are bookkeeping, not ideas.
  if (input.assetClass === "cash") return null;
  // Only quoted symbols carry workflow state — the same predicate every surface
  // uses, so a holding can never be shown as owned by one and skipped by another.
  if (!isPipelineSymbol(sym)) return null;

  if (input.kind === "buy") return "owned";
  // A sell only transitions when it fully closes the position.
  return input.stillHeld ? null : "exited";
}
