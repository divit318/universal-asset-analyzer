/**
 * The Idea lifecycle — pure stage logic (§4.5).
 *
 * A stage travels with a tracked symbol through the investment loop. The
 * ordering here is the funnel the Pipeline board renders; `passed`/`exited` are
 * terminal outcomes kept off the main funnel. Descriptive, never a gate — no
 * function here decides whether an action is *allowed*, only what stage an idea
 * is *in*.
 *
 * Kept free of React and of the database so the transition rules and the
 * days-in-stage math are unit-testable in isolation (tests/idea-stage.test.ts).
 */

import type { IdeaStage } from "./types";

/** The main funnel, in order. `passed`/`exited` are terminal, shown apart. */
export const PIPELINE_STAGES: IdeaStage[] = ["surfaced", "researching", "thesis", "owned"];
export const TERMINAL_STAGES: IdeaStage[] = ["passed", "exited"];
export const IDEA_STAGES: IdeaStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

export const STAGE_LABEL: Record<IdeaStage, string> = {
  surfaced: "Surfaced",
  researching: "Researching",
  thesis: "Thesis",
  owned: "Owned",
  passed: "Passed",
  exited: "Exited",
};

export function isIdeaStage(value: unknown): value is IdeaStage {
  return typeof value === "string" && (IDEA_STAGES as string[]).includes(value);
}

/**
 * The stage a ledger write auto-transitions a symbol to, where unambiguous
 * (§4.5): a buy makes it `owned`; a sell that closes the position makes it
 * `exited`. A partial sell (still held) leaves the stage untouched. Cash lots,
 * balancing entries, and non-ticker rows never transition. Returns null when no
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
  if (input.assetClass === "cash" || sym.startsWith("CASH-")) return null;
  // Only real tickers move through the pipeline.
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(sym)) return null;

  if (input.kind === "buy") return "owned";
  // A sell only transitions when it fully closes the position.
  return input.stillHeld ? null : "exited";
}

/** Whole days a symbol has sat in its current stage. Falls back to the row's
 *  added-at when the stage timestamp predates the migration. */
export function daysInStage(
  stageChangedAt: number | null,
  addedAt: string,
  now: number = Date.now(),
): number {
  const since = stageChangedAt ?? Date.parse(addedAt);
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, Math.floor((now - since) / 86_400_000));
}
