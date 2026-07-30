/**
 * Where an idea came from — provenance for the Idea Pipeline (§4.5).
 *
 * Every tracked symbol entered the pipeline through some surface: a screen, a
 * scan, a research session, a thesis, a rebalance, or a bare manual add. Until
 * this existed, none of that was recorded — the `watchlist` row stored the
 * symbol, the name and the date, so "why am I seeing this?" was unanswerable
 * from stored data and the Pipeline board could only show a ticker.
 *
 * Two rules govern this module:
 *
 *  1. **Never fabricate an origin.** `null` is a real, expected value — every
 *     row written before the column existed has one, and the honest rendering of
 *     that is "origin not recorded", not a plausible guess. A guess here would
 *     be indistinguishable from a fact forever.
 *  2. **The FIRST origin wins.** Provenance answers where an idea came from, so
 *     re-adding a screened name from Research must not rewrite its history (see
 *     the COALESCE in `addToWatchlist`).
 *
 * Kept free of React and of the database so the vocabulary is shared by the
 * write paths, the API and the board without any of them importing each other.
 */

/**
 * The surfaces that can put a symbol into the pipeline. Each maps to a real
 * module in this app — nothing is declared here speculatively, because an
 * origin nobody writes is indistinguishable from a bug in the reader.
 */
export type IdeaSource =
  /** A screen matched it (`detail` = the asset class / template screened). */
  | "screener"
  /** An event scan flagged it (`detail` = the signal). */
  | "scanner"
  /** The Wire surfaced it against a theme (`detail` = the theme). */
  | "wire"
  /** Opened in Research and kept (`detail` = the asset class researched). */
  | "research"
  /** Kept out of a side-by-side comparison (`detail` = what it was compared to). */
  | "compare"
  /** An intrinsic-value run (`detail` = the resulting verdict, if any). */
  | "dcf"
  /** An institutional report (`detail` = the report's conclusion). */
  | "ic-report"
  /** A thematic map (`detail` = the theme and tier). */
  | "thematic"
  /** The home Radar module's own suggestion (`detail` = why it fired). */
  | "radar"
  /** Typed into the command palette. */
  | "command-palette"
  /** Added directly on the Watchlist page. */
  | "watchlist"
  /** A portfolio analysis proposed it — gap fill, cash deployment, optimizer. */
  | "portfolio-analysis"
  /** Recorded as a decision in the journal (`detail` = the action + conviction). */
  | "decision"
  /** It arrived by being BOUGHT: the ledger created the idea, not the other way round. */
  | "ledger"
  /** Created by a stage move on the board itself, with no earlier record. */
  | "pipeline";

export const IDEA_SOURCES: IdeaSource[] = [
  "screener",
  "scanner",
  "wire",
  "research",
  "compare",
  "dcf",
  "ic-report",
  "thematic",
  "radar",
  "command-palette",
  "watchlist",
  "portfolio-analysis",
  "decision",
  "ledger",
  "pipeline",
];

export function isIdeaSource(value: unknown): value is IdeaSource {
  return typeof value === "string" && (IDEA_SOURCES as string[]).includes(value);
}

/** Short label for a chip. */
export const IDEA_SOURCE_LABEL: Record<IdeaSource, string> = {
  screener: "Screener",
  scanner: "Scanner",
  wire: "The Wire",
  research: "Research",
  compare: "Compare",
  dcf: "DCF",
  "ic-report": "IC Report",
  thematic: "Thematic",
  radar: "Radar",
  "command-palette": "Command palette",
  watchlist: "Watchlist",
  "portfolio-analysis": "Portfolio analysis",
  decision: "Decision journal",
  ledger: "Your ledger",
  pipeline: "Pipeline",
};

/**
 * The verb each surface performed, so the sentence reads as an event that
 * happened rather than as a category. "Surfaced by a screen" and "Screener" are
 * the same fact, but only one of them answers "why am I seeing this?".
 */
const IDEA_SOURCE_PHRASE: Record<IdeaSource, string> = {
  screener: "Surfaced by a screen",
  scanner: "Flagged by an event scan",
  wire: "Surfaced by the Wire",
  research: "Kept from a research session",
  compare: "Kept from a comparison",
  dcf: "Kept from a valuation run",
  "ic-report": "Kept from an IC report",
  thematic: "Surfaced by a thematic map",
  radar: "Suggested by the Radar",
  "command-palette": "Added from the command palette",
  watchlist: "Added by hand to the watchlist",
  "portfolio-analysis": "Proposed by a portfolio analysis",
  decision: "Recorded as a decision",
  ledger: "Entered by being bought",
  pipeline: "Added on the pipeline board",
};

export interface IdeaOrigin {
  source: IdeaSource | null;
  /** What the surface knew at the time — a screen name, a signal, a theme. */
  detail: string | null;
  /** ISO timestamp the row was created. */
  at: string;
}

/** Whole days between `at` and now, or null when the timestamp is unusable. */
function ageDays(at: string, now: number): number | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * One sentence of provenance, or an explicit statement that there isn't any.
 *
 * Rows that predate the column return "Origin not recorded — this idea was
 * tracked before provenance was captured", which is the whole point: an
 * unknown origin has to READ as unknown. A dash, or a default of "Watchlist",
 * would turn missing history into a false claim.
 */
export function describeOrigin(origin: IdeaOrigin, now: number = Date.now()): string {
  const days = ageDays(origin.at, now);
  const when = days == null ? null : days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;

  if (!origin.source) {
    return days == null
      ? "Origin not recorded — this idea predates provenance capture"
      : `Origin not recorded — tracked for ${days}d, from before provenance was captured`;
  }

  const parts = [IDEA_SOURCE_PHRASE[origin.source]];
  if (origin.detail) parts.push(origin.detail);
  if (when) parts.push(when);
  return parts.join(" · ");
}
