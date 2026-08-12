/**
 * Contextual Research Intelligence — shared types.
 *
 * The intel layer watches what the user is researching and surfaces at most
 * three quiet, high-threshold observations on the side of the page. Its core
 * contract is that "nothing to say" is the common, correct output — a card
 * exists only when a candidate clears the relevance threshold in
 * lib/intel/score.ts.
 *
 * Client-safe: pure types only, imported by both the engine (server) and the
 * rail component (client).
 */

/** Where the user currently is. Determines which generators run. */
export type IntelSurface =
  | "research" // single-symbol deep research (/research, /valuation, /ic-report)
  | "compare" // multi-symbol comparison (/compare)
  | "portfolio" // portfolio manager (/portfolio)
  | "watchlist" // watchlist (/watchlist)
  | "wire"; // market wire (/wire)

export interface IntelContext {
  surface: IntelSurface;
  /** Symbols in focus, most significant first. Empty for list-level surfaces. */
  symbols: string[];
}

/**
 * The four insight families. `suggestion` is deliberately the rarest — it is
 * capped at one card per set and carries the highest threshold, so UAA reads
 * as a research desk, not a stock-picking product.
 */
export type IntelCategory = "lead" | "event" | "portfolio" | "suggestion";

/** What clicking the card's action does. */
export interface IntelAction {
  label: string;
  /** `navigate` pushes href; `assistant` opens the app assistant with the prompt preloaded. */
  kind: "navigate" | "assistant";
  href?: string;
  prompt?: string;
}

/**
 * Per-candidate evaluation dimensions, each 0–1. Composed into a single score
 * by lib/intel/score.ts — generators state what they measured, the scorer
 * decides what clears the bar.
 */
export interface IntelSignals {
  /** How tied this is to what the user is looking at right now. */
  relevance: number;
  /** Would this plausibly change a research conclusion or a position? */
  materiality: number;
  /** Fresh now vs. already old news. */
  timeliness: number;
  /** Beyond what the page the user is on already shows. */
  novelty: number;
  /** Is there a concrete next step? */
  actionability: number;
  /** Data quality / how sure the generator is of its own numbers. */
  confidence: number;
  /** Grounded in the user's actual holdings/watchlist. */
  portfolioRelevance: number;
}

/** A potential insight, before scoring/selection. */
export interface IntelCandidate {
  /**
   * Stable dedup fingerprint: same observation → same id across runs, so
   * dismissals stick (e.g. "event:NVDA:earnings-2026-08-12").
   */
  id: string;
  category: IntelCategory;
  /** Short eyebrow label, e.g. "Research Lead", "Just In". */
  eyebrow: string;
  /** One-sentence observation. The card body. */
  title: string;
  /** Optional second line of supporting detail. */
  detail?: string;
  symbol?: string;
  action: IntelAction;
  signals: IntelSignals;
  /** Set on AI-originated candidates so the UI can label interpretation vs. measurement. */
  source: "computed" | "ai";
}

/** A candidate that cleared selection, as served to the client. */
export interface IntelCard {
  id: string;
  category: IntelCategory;
  eyebrow: string;
  title: string;
  detail?: string;
  symbol?: string;
  action: IntelAction;
  source: "computed" | "ai";
  score: number;
}

export interface IntelResponse {
  cards: IntelCard[];
  generatedAt: string;
  /** True while the background AI pass for this context hasn't completed yet —
   *  the client may poll once more; false means this set is final. */
  aiPending: boolean;
}

/** User feedback the client reports back, used for suppression. */
export type IntelEventStatus = "shown" | "dismissed" | "opened";
