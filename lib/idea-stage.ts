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

import { assetClassForSymbol } from "./assets/registry";
import { displayAssetName } from "./format";
import { describeOrigin, type IdeaOrigin, type IdeaSource } from "./idea-source";
import type { PortfolioAssetClass } from "./portfolio/model/types";
import type { IdeaStage, TargetDirection } from "./types";

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
 * Whether a holding is an *idea* at all — the one predicate that decides which
 * of the portfolio's holdings the pipeline is answerable for.
 *
 * A pipeline symbol is a symbol a market quotes: everything you can research,
 * price and re-buy. That excludes exactly two things, and they are the whole of
 * the legitimate gap between the Holdings count and the Owned count:
 *
 *  - **Cash** — stored as a synthetic `CASH-USD` lot (see store.ts), quoted by
 *    nobody, and bookkeeping rather than a position anyone researches.
 *  - **Manually-valued assets** — property, private stakes, collectibles. They
 *    carry `symbol: null` because no ticker exists, so there is nothing for a
 *    research pipeline to act on.
 *
 * The character class is deliberately wider than a US equity ticker: Yahoo
 * quotes futures as `HE=F`, forex as `USDCHF=X`, indices as `^GSPC` and crypto
 * as `USD136148-USD`. Those are tradeable and *are* held in this ledger, so
 * excluding them would reintroduce the same disagreement this predicate exists
 * to prevent — the board would show a holding it refused to call owned.
 */
export function isPipelineSymbol(symbol: string | null | undefined): symbol is string {
  if (!symbol) return false;
  const sym = symbol.trim().toUpperCase();
  if (sym.startsWith("CASH-")) return false;
  return /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/.test(sym);
}

/**
 * The stage the pipeline must *show*, given what the ledger says.
 *
 * `owned` is not an opinion about an idea — it is a fact about the ledger, so
 * the ledger wins over the stored stage in both directions. A held name reads
 * `owned` whatever its watchlist row says; a row that still says `owned` for a
 * name the ledger no longer holds has been left behind by a ledger change that
 * didn't reconcile it, and reads `exited`.
 *
 * Without this the Owned column was a separately-maintained list: BND and VTI
 * sat in it for a portfolio that has never held either, because the stage was
 * written by their (since-deleted) buys and nothing reverted it, while a held
 * forex position sat under Surfaced. A column that claims to show what you own
 * has to be derived from what you own.
 */
export function effectiveStage(stored: IdeaStage, held: boolean): IdeaStage {
  if (held) return "owned";
  return stored === "owned" ? "exited" : stored;
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
  if (input.assetClass === "cash") return null;
  // Only quoted symbols move through the pipeline — the same predicate the board
  // uses, so a holding can never be shown as owned by one and skipped by the other.
  if (!isPipelineSymbol(sym)) return null;

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

/* -------------------------------------------------------------------------- */
/* The board                                                                   */
/* -------------------------------------------------------------------------- */

export interface PipelineRow {
  symbol: string;
  name: string;
  stage: IdeaStage;
  daysInStage: number;
  /** True when persisted on the watchlist; false for a held-but-untracked name. */
  tracked: boolean;
  /** True when currently held in the portfolio. */
  held: boolean;
  /**
   * The holding's own class when held, otherwise what the symbol's shape says
   * (Yahoo's suffixes are a convention, not a guess) — null when it says nothing,
   * which for a bare ticker means "an equity or a fund", a distinction no symbol
   * carries. Drives the board's filter; never used as a number.
   */
  assetClass: PortfolioAssetClass | null;
  /**
   * Where this idea came from, and one sentence describing it. `origin.source` is
   * null for rows tracked before provenance was captured, and `originLabel` says
   * so out loud — see lib/idea-source.ts.
   */
  origin: IdeaOrigin;
  originLabel: string;
  /** The user's own price target, carried for the "why now?" rationale. */
  targetPrice: number | null;
  targetDirection: TargetDirection | null;
  /** Whether the user has written anything about it. */
  hasNotes: boolean;
}

/** A watchlist row, reduced to what the board needs. */
export interface TrackedIdea {
  symbol: string;
  name: string;
  stage: IdeaStage;
  stageChangedAt: number | null;
  addedAt: string;
  source: IdeaSource | null;
  sourceDetail: string | null;
  targetPrice?: number | null;
  targetDirection?: TargetDirection | null;
  notes?: string | null;
}

/** A portfolio holding, reduced to what the board needs. */
export interface HeldPosition {
  /** null for cash and manually-valued assets — see {@link isPipelineSymbol}. */
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  /** First acquisition date, used for days-in-stage on an untracked holding. */
  acquiredAt: string;
}

/**
 * The board, built from the watchlist and the portfolio's own holdings.
 *
 * Pure by design: the route hands it the two lists and asserts nothing about
 * them, so `tests/pipeline-board.test.ts` can pin the property that actually
 * matters — the Owned column is exactly the set of quoted holdings, always —
 * without a database or a Next request.
 *
 * Holdings that aren't on the watchlist are merged in as derived `owned` rows so
 * the board reflects the real portfolio without a migration side effect; moving
 * such a row persists it (one pipeline, one object).
 */
export function buildPipelineRows(input: {
  tracked: TrackedIdea[];
  holdings: HeldPosition[];
  now?: number;
}): PipelineRow[] {
  const now = input.now ?? Date.now();
  const held = new Map<string, HeldPosition>();
  for (const h of input.holdings) {
    if (isPipelineSymbol(h.symbol)) held.set(h.symbol.toUpperCase(), h);
  }

  const rows: PipelineRow[] = input.tracked.map((t) => {
    const symbol = t.symbol.toUpperCase();
    const position = held.get(symbol);
    const origin: IdeaOrigin = { source: t.source, detail: t.sourceDetail, at: t.addedAt };
    return {
      symbol,
      name: displayAssetName(symbol, t.name),
      stage: effectiveStage(t.stage, position != null),
      daysInStage: daysInStage(t.stageChangedAt, t.addedAt, now),
      tracked: true,
      held: position != null,
      assetClass: position?.assetClass ?? assetClassForSymbol(symbol),
      origin,
      originLabel: describeOrigin(origin, now),
      targetPrice: t.targetPrice ?? null,
      targetDirection: t.targetDirection ?? null,
      hasNotes: (t.notes ?? "").trim().length > 0,
    };
  });

  const trackedSymbols = new Set(rows.map((r) => r.symbol));
  for (const [symbol, position] of held) {
    if (trackedSymbols.has(symbol)) continue;
    // A held-but-untracked name has a knowable origin: the ledger created it.
    // That is a fact about the position, not an assumption about intent.
    const origin: IdeaOrigin = {
      source: "ledger",
      detail: `${position.assetClass} position opened`,
      at: position.acquiredAt,
    };
    rows.push({
      symbol,
      name: displayAssetName(symbol, position.name),
      stage: "owned",
      daysInStage: daysInStage(null, position.acquiredAt, now),
      tracked: false,
      held: true,
      assetClass: position.assetClass,
      origin,
      originLabel: describeOrigin(origin, now),
      targetPrice: null,
      targetDirection: null,
      hasNotes: false,
    });
  }

  return rows;
}
