/**
 * The Asset Registry's type contract — platform-wide shared infrastructure,
 * NOT screener-private. Research Hub, Scanner, Compare, Portfolio, Watchlist
 * and the future Opportunity Engine are all meant to query this registry
 * instead of hardcoding per-asset behavior, so "add an asset class" becomes
 * "add one definition file" rather than "touch a dozen switch statements".
 *
 * Relationship to the two existing taxonomies:
 *   - lib/market.ts       MarketRegion — *where* it trades (US/IN/JP/…)
 *   - lib/asset-class.ts  AssetClass   — *what kind of instrument* it is
 * Those stay the source of truth for symbol→class detection. This registry
 * layers the *configuration* for each class on top (filters, templates,
 * columns, ranking, prompts, capabilities) and reuses AssetClass as its key
 * space rather than inventing a competing one.
 */

import type { AssetClass } from "../asset-class";
import type { DataSourceId } from "../provenance";
import type { TaskType } from "../ai/task-registry";

/**
 * The screenable identity of an asset class. A superset of AssetClass in
 * spirit but a strict subset in practice: "reit" is not a distinct Yahoo
 * quoteType (a REIT is an EQUITY with sector=Real Estate), and "bond" is not
 * one either (see BOND_UNIVERSE_NOTE in ./bond.ts). Both are real, distinct
 * *screening* domains with their own filters, templates and ranking, so the
 * registry keys on this id and maps back to the detection-level AssetClass
 * via `assetClass` below.
 */
export type AssetClassId =
  | "equity"
  | "etf"
  | "reit"
  | "crypto"
  | "commodity"
  | "bond"
  | "forex";

export const ASSET_CLASS_IDS: AssetClassId[] = [
  "equity",
  "etf",
  "reit",
  "crypto",
  "commodity",
  "bond",
  "forex",
];

/* -------------------------------------------------------------------------- */
/* Data availability — the honesty layer                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether a metric has a real source behind it *in this codebase today*.
 *
 * This exists because the filter engine's core semantic — "an active filter
 * excludes rows whose value is unknown" (lib/screener/filter-engine.ts, and
 * inherited from the original lib/fundamental-screener.ts) — turns a metric
 * with no provider into a silent trap: filtering on it would return zero
 * rows and look like "nothing matched" rather than "we can't answer that".
 *
 * So every metric declares its provenance up front. `unavailable` metrics are
 * still *declared* (they're part of an honest description of the asset class,
 * and they're exactly the spec for the next data provider someone wires up)
 * but the registry refuses to build a filter for them, and the UI renders
 * them in a "needs a data provider" section instead of as a working input.
 * Nothing in the pipeline ever silently pretends an unavailable metric is 0.
 */
export type MetricAvailability =
  /** Read straight off a provider response field. */
  | "live"
  /** Computed by us from live fields, via a documented formula on MetricDef.formula. */
  | "derived"
  /** From a small curated table that ships with the app; carries an `asOf` date. */
  | "reference"
  /** No provider wired. Declared for completeness; never filterable. */
  | "unavailable";

export interface MetricDef {
  key: string;
  label: string;
  /** Longer explanation surfaced in the UI as help text / tooltip. */
  description: string;
  /** Filter section this metric renders under, e.g. "Valuation". Must be one of the class's `filterGroups`. */
  group: string;
  /** Drives formatting + the input suffix. */
  unit: "%" | "x" | "$" | "$B" | "yrs" | "bps" | "score" | "";
  availability: MetricAvailability;
  /** Which provider backs it. Null for `unavailable` metrics. */
  source: DataSourceId | null;
  /** Required when availability === "derived": the formula, in words. */
  formula?: string;
  /** Required when availability === "reference": when the shipped table was last verified. */
  asOf?: string;
  /** Required when availability === "unavailable": what it would take to make it real. */
  requires?: string;
  /**
   * For ranking + explanation: is a higher value better for the holder?
   * `null` for metrics with no inherent direction (e.g. market cap, maturity).
   */
  better: "higher" | "lower" | null;
  /** Step hint for numeric inputs. */
  step?: number;
  /** Values are entered/displayed in billions (market cap, AUM). */
  scale?: 1e9;
  /** Categorical metric: the allowed values. Presence of this makes it a select filter. */
  options?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

export type FilterKind = "range" | "select" | "multiselect" | "boolean";

/** A filter is a *renderable* view of a metric. The engine builds these from metrics. */
export interface FilterDef {
  /** Same key as the MetricDef it filters. */
  key: string;
  label: string;
  description: string;
  kind: FilterKind;
  unit: MetricDef["unit"];
  /** Section heading it renders under, e.g. "Valuation". */
  group: string;
  options?: readonly string[];
  step?: number;
  scale?: 1e9;
}

/**
 * What a range filter's numbers are measured *against*.
 *
 * "P/E under 15" is a statement about the whole market; "P/E in the cheapest
 * quartile of its own sector" is a statement about the company. Investors think
 * in the second form far more often than screeners let them express it, and the
 * difference is not cosmetic: an absolute P/E floor silently screens out every
 * utility and screens in every miner, because it is really a sector filter
 * wearing a valuation label.
 *
 * With a frame, the same input box answers a different question:
 *   absolute  — the raw metric value (the only mode that existed before)
 *   class     — percentile against every asset in the class
 *   peer      — percentile against the asset's own peer group (see
 *               AssetClassDefinition.peerGroupBy: sector for equities, issuer
 *               type for bonds, sector for crypto, property type for REITs)
 *
 * Percentiles are always oriented so that **100 is best**, with the metric's own
 * `better` direction already folded in — so `min: 75` means "top quartile"
 * whether the metric is ROIC (high is good) or expense ratio (low is good).
 * One mental model, no per-metric sign reasoning.
 *
 * Cost note: percentiles are precomputed once per universe build and cached
 * (lib/screener/universe-stats.ts), so a framed filter is an O(1) map lookup per
 * row at screen time — the same cost as an absolute one.
 */
export type FilterFrame = "absolute" | "class" | "peer";

/**
 * What to do with a candidate whose value for this filter is unknown.
 *
 * The engine's long-standing rule is `exclude` — you cannot confirm an unknown
 * ROIC clears a 12% floor, so it doesn't. That rule is right by default and
 * stays the default. But it was previously *global and invisible*, which made a
 * thin metric indistinguishable from a strict screen: filtering on a field 40%
 * of the universe lacks quietly deletes 40% of the universe. Making it a
 * per-filter choice with a visible count turns that from a trap into a decision.
 */
export type MissingPolicy = "exclude" | "include";

/** The user's chosen value for one filter. */
export type FilterValue =
  | {
      kind: "range";
      min: number | null;
      max: number | null;
      /** Defaults to "absolute" — i.e. exactly the previous behaviour. */
      frame?: FilterFrame;
      /** Defaults to "exclude" — i.e. exactly the previous behaviour. */
      missing?: MissingPolicy;
    }
  | { kind: "select"; value: string | null }
  | { kind: "multiselect"; values: string[] }
  | { kind: "boolean"; value: boolean | null };

/** All active filters for one screen run, keyed by metric key. */
export type FilterValues = Record<string, FilterValue>;

/**
 * Soft preferences: "I'd rather have low leverage" as opposed to "reject
 * anything above 1.0x".
 *
 * Hard filters are AND-gates, and AND-gates are a poor model of how anyone
 * actually chooses an investment. A name that misses one threshold by 2% while
 * dominating on five other dimensions is a name you want to see; a filter makes
 * it invisible. That single property is responsible for most of the
 * empty-result frustration in every screener on the market, and for the quiet
 * damage of screens that are technically satisfied and practically useless.
 *
 * A preference instead adds weight to the ranking: nothing is excluded, the
 * ordering shifts. Keyed by metric, valued by weight (1 = same pull as one
 * default rank factor). Cost is zero on top of ranking, which already reads
 * precomputed percentiles.
 */
export type SoftPreferences = Record<string, number>;

/* -------------------------------------------------------------------------- */
/* Templates (a.k.a. presets)                                                  */
/* -------------------------------------------------------------------------- */

export interface TemplateDef {
  id: string;
  name: string;
  tagline: string;
  /** Pre-set filter values applied when the template is picked. */
  filters: FilterValues;
  /** Overrides the class's default ranking when this template is active. */
  rank?: RankFactor[];
  sort?: { key: string; dir: "asc" | "desc" };
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One input to the composite rank score. Scoring is percentile-based: a
 * candidate's value for `metric` is ranked against the *whole evaluated
 * universe* (not just the filtered set), so a name's score doesn't move
 * around as you tighten unrelated filters — that's the "stable ranking"
 * requirement. It also sidesteps per-asset-class calibration entirely: a
 * percentile is unit-free, so the same ranking code works for a P/E, a TVL
 * and a bond duration without any of the lerp-range tuning that
 * lib/crypto-scoring.ts had to do by hand.
 */
export interface RankFactor {
  metric: string;
  weight: number;
  /** Overrides MetricDef.better when a template wants the opposite tilt. */
  direction?: "higher" | "lower";
}

/* -------------------------------------------------------------------------- */
/* Results table                                                               */
/* -------------------------------------------------------------------------- */

export interface ResultColumnDef {
  /** Metric key, or one of the built-ins: "symbol" | "name" | "price" | "changePercent" | "rankScore". */
  key: string;
  label: string;
  /** Column display width hint; the table is registry-driven, not hardcoded per class. */
  align?: "left" | "right";
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the platform can actually *do* with this asset class. Modules query
 * these instead of maintaining their own switch statements — e.g. Portfolio
 * asks `can(id, "portfolio")` before offering to hold it, Compare asks
 * `can(id, "compare")`.
 */
export type Capability =
  | "screen"
  | "research"
  | "compare"
  | "portfolio"
  | "watchlist"
  | "chart"
  | "news"
  | "fundamentals";

/* -------------------------------------------------------------------------- */
/* The definition                                                              */
/* -------------------------------------------------------------------------- */

export interface AssetClassDefinition {
  id: AssetClassId;
  label: string;
  /** Short plural noun for UI copy: "stocks", "ETFs", "pairs". */
  noun: string;
  description: string;
  icon: string;
  /** Tailwind accent token used by chips/tabs for this class. */
  accent: string;

  /** Detection-level class this screening domain maps back to (lib/asset-class.ts). */
  assetClass: AssetClass;
  /** AI task this class's prompts route through (lib/ai/task-registry.ts). */
  taskType: TaskType;

  markets: string[];
  exchanges: string[];
  /** Identifier schemes that are meaningful for this class. */
  identifiers: ("ticker" | "isin" | "cusip" | "pair" | "contract" | "chain")[];
  providers: DataSourceId[];
  /** Free-text aliases the command palette / search can match on. */
  aliases: string[];
  /** Symbol shape check, e.g. crypto pairs must end in -USD. */
  validate?: (symbol: string) => boolean;

  capabilities: Capability[];

  /**
   * The attribute key that defines an asset's peer group, for `frame: "peer"`
   * filters and for peer-relative ranking.
   *
   * "Cheap for a bank" and "cheap for a software company" are different
   * statements, and a screener that can only compare across the whole class
   * cannot express either. This names the grouping that makes a comparison
   * fair for each class: sector for equities, issuer type for bonds, sector for
   * crypto, property type for REITs, sector focus for ETFs.
   *
   * Undefined for classes where every member is already comparable (forex —
   * 36 curated pairs are one peer group by construction).
   */
  peerGroupBy?: string;

  /** Every metric this class knows about — including the unavailable ones. */
  metrics: MetricDef[];
  /** Ordered filter groups; the UI renders sections in this order. */
  filterGroups: string[];
  templates: TemplateDef[];
  /** Default composite ranking when no template overrides it. */
  rank: RankFactor[];
  columns: ResultColumnDef[];
  defaultSort: { key: string; dir: "asc" | "desc" };

  /** Class-specific framing for the AI ranking explanation. */
  aiPrompt: {
    role: string;
    focus: string;
  };

  chart: {
    /** Default lookback for this class's sparkline/detail chart, in days. */
    lookbackDays: number;
    /** Crypto/commodities are log-scale-friendly; equities generally aren't. */
    logScale: boolean;
  };

  /**
   * Deterministic risk flags surfaced on results. Each returns a warning
   * string when it fires, or null. Kept in the registry (not the UI) so
   * Scanner/Watchlist can reuse the exact same flags.
   */
  warnings: {
    id: string;
    label: string;
    test: (metrics: Record<string, number | null>, attributes: Record<string, string | null>) => boolean;
  }[];
}
