/**
 * Watchlist view preferences — the vocabulary and defaults behind the page's
 * "Customize" popover.
 *
 * Design constraints, in order:
 *
 * 1. **The default experience must be excellent with zero configuration.**
 *    Settings exist for workflow differences (a value investor wants "Near
 *    target" where a momentum trader wants "Alerts firing"), never as a
 *    prerequisite for a good page.
 * 2. **Only preferences that materially change the page.** Which chips, which
 *    default filter, which columns, the default sort, and the two attention
 *    thresholds that are genuinely a matter of taste (earnings horizon, what
 *    counts as a big move). Nothing else — this is a popover, not an admin
 *    panel.
 * 3. **Persist instantly, tolerate anything.** Stored in localStorage under one
 *    key; {@link sanitizeWatchlistSettings} accepts any historical or
 *    hand-edited shape and always returns something valid, merging with
 *    defaults so adding a preference later never resets the rest.
 *
 * Pure and client-safe. Tested in `tests/watchlist-settings.test.ts`.
 */

import { BIG_MOVE_PCT, EARNINGS_SOON_DAYS } from "./watchlist-pulse";

/* -------------------------------------------------------------------------- */
/* Quick filters                                                               */
/* -------------------------------------------------------------------------- */

export const WATCHLIST_FILTERS = [
  "all",
  "attention",
  "alerts",
  "owned",
  "not-owned",
  "near-target",
  "earnings",
  "high-conviction",
  "no-thesis",
  "no-target",
  "stale",
] as const;

export type WatchlistFilter = (typeof WATCHLIST_FILTERS)[number];

export const isWatchlistFilter = (v: unknown): v is WatchlistFilter =>
  typeof v === "string" && (WATCHLIST_FILTERS as readonly string[]).includes(v);

export const FILTER_LABEL: Record<WatchlistFilter, string> = {
  all: "All",
  attention: "Needs attention",
  alerts: "Alerts firing",
  owned: "Owned",
  "not-owned": "Not owned",
  "near-target": "Near target",
  earnings: "Earnings soon",
  "high-conviction": "High conviction",
  "no-thesis": "No thesis",
  "no-target": "No target",
  stale: "Stale review",
};

/** One line for the settings popover: what the filter selects. */
export const FILTER_DESCRIPTION: Record<WatchlistFilter, string> = {
  all: "Everything on the list",
  attention: "Names with a live reason to look",
  alerts: "Price alerts firing right now",
  owned: "Already held in your portfolio",
  "not-owned": "Candidates you don't hold yet",
  "near-target": "Within a few percent of your level, or past it",
  earnings: "Reporting within your earnings horizon",
  "high-conviction": "Marked high conviction in the thesis",
  "no-thesis": "Missing a written thesis",
  "no-target": "No price level being watched",
  stale: "Thesis not reviewed in 90 days",
};

/** The label as a predicate, for the empty state's "No name currently …". */
export const FILTER_EMPTY: Record<WatchlistFilter, string> = {
  all: "is on this list", // unreachable: "all" with no rows renders the list empty state instead
  attention: "needs attention — a quiet list is the good outcome",
  alerts: "has an alert firing",
  owned: "is held in your portfolio",
  "not-owned": "is outside your portfolio",
  "near-target": "is near or past your target",
  earnings: "reports earnings within your horizon",
  "high-conviction": "is marked high conviction",
  "no-thesis": "is missing a thesis",
  "no-target": "is missing a target",
  stale: "has a thesis older than a 90-day review",
};

/** The chips a fresh install shows, in order. */
export const DEFAULT_QUICK_FILTERS: WatchlistFilter[] = ["all", "attention", "alerts", "owned", "earnings"];

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Columns the user may hide. Symbol / Last / Today are the table's identity and
 * stay; everything else is a preference. Keys match the column keys in
 * `app/watchlist/page.tsx`.
 */
export const HIDEABLE_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "attention", label: "Attention" },
  { key: "target", label: "My target" },
  { key: "upside", label: "Upside" },
  { key: "consensus", label: "Consensus" },
  { key: "fromHigh", label: "From high" },
  { key: "fit", label: "Portfolio fit" },
  { key: "stage", label: "Stage" },
  { key: "sector", label: "Sector" },
  { key: "nextEvent", label: "Next event" },
  { key: "notes", label: "Thesis" },
];

/* -------------------------------------------------------------------------- */
/* Sort                                                                        */
/* -------------------------------------------------------------------------- */

/** Default-sort choices. `""` = smart (attention first, ties by list order). */
export const SORT_CHOICES: Array<{ key: string; label: string }> = [
  { key: "", label: "Attention (default)" },
  { key: "fit", label: "Portfolio fit" },
  { key: "change", label: "Today's move" },
  { key: "upside", label: "Upside to target" },
  { key: "nextEvent", label: "Next event" },
  { key: "symbol", label: "Symbol A–Z" },
];

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                  */
/* -------------------------------------------------------------------------- */

export const EARNINGS_HORIZON_CHOICES = [7, 14, 30] as const;
export const BIG_MOVE_CHOICES = [3, 5, 8] as const;

/* -------------------------------------------------------------------------- */
/* The settings object                                                         */
/* -------------------------------------------------------------------------- */

export interface WatchlistViewSettings {
  /** Which quick-filter chips render, in order. Always contains "all" first. */
  quickFilters: WatchlistFilter[];
  /** The filter the page opens on. */
  defaultFilter: WatchlistFilter;
  /** Column keys hidden from the table (subset of HIDEABLE_COLUMNS). */
  hiddenColumns: string[];
  /** Default sort when the user has not clicked a header. "" = smart. */
  defaultSortKey: string;
  /** "Earnings soon" horizon, days. */
  earningsHorizonDays: number;
  /** A day move at or beyond this magnitude counts as information. */
  bigMovePct: number;
}

export const DEFAULT_WATCHLIST_SETTINGS: WatchlistViewSettings = {
  quickFilters: DEFAULT_QUICK_FILTERS,
  defaultFilter: "all",
  hiddenColumns: [],
  defaultSortKey: "",
  earningsHorizonDays: EARNINGS_SOON_DAYS,
  bigMovePct: BIG_MOVE_PCT,
};

/**
 * Coerce ANY value into a valid settings object, merging with defaults.
 * Unknown filters and columns are dropped; out-of-range thresholds snap back to
 * their defaults; "all" is always the first chip so the user can never
 * configure themselves out of seeing the list.
 */
export function sanitizeWatchlistSettings(raw: unknown): WatchlistViewSettings {
  const d = DEFAULT_WATCHLIST_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { ...d, quickFilters: [...d.quickFilters], hiddenColumns: [] };
  const v = raw as Partial<Record<keyof WatchlistViewSettings, unknown>>;

  const filters = Array.isArray(v.quickFilters)
    ? [...new Set(v.quickFilters.filter(isWatchlistFilter))]
    : [...d.quickFilters];
  const quickFilters: WatchlistFilter[] = ["all", ...filters.filter((f) => f !== "all")];

  const defaultFilter =
    isWatchlistFilter(v.defaultFilter) && quickFilters.includes(v.defaultFilter) ? v.defaultFilter : "all";

  const hideable = new Set(HIDEABLE_COLUMNS.map((c) => c.key));
  const hiddenColumns = Array.isArray(v.hiddenColumns)
    ? [...new Set(v.hiddenColumns.filter((c): c is string => typeof c === "string" && hideable.has(c)))]
    : [];

  const defaultSortKey =
    typeof v.defaultSortKey === "string" && SORT_CHOICES.some((s) => s.key === v.defaultSortKey)
      ? v.defaultSortKey
      : "";

  const earningsHorizonDays = (EARNINGS_HORIZON_CHOICES as readonly number[]).includes(v.earningsHorizonDays as number)
    ? (v.earningsHorizonDays as number)
    : d.earningsHorizonDays;

  const bigMovePct = (BIG_MOVE_CHOICES as readonly number[]).includes(v.bigMovePct as number)
    ? (v.bigMovePct as number)
    : d.bigMovePct;

  return { quickFilters, defaultFilter, hiddenColumns, defaultSortKey, earningsHorizonDays, bigMovePct };
}

/** True when nothing differs from the defaults — the popover's "Reset" gate. */
export function isDefaultSettings(s: WatchlistViewSettings): boolean {
  const d = DEFAULT_WATCHLIST_SETTINGS;
  return (
    s.quickFilters.join(",") === d.quickFilters.join(",") &&
    s.defaultFilter === d.defaultFilter &&
    s.hiddenColumns.length === 0 &&
    s.defaultSortKey === d.defaultSortKey &&
    s.earningsHorizonDays === d.earningsHorizonDays &&
    s.bigMovePct === d.bigMovePct
  );
}
