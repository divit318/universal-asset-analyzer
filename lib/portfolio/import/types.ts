/**
 * Screenshot Import — shared types.
 *
 * The wire contract between the extraction engine (extract.ts), the
 * validation pass (validate.ts), the reconciliation engine (reconcile.ts),
 * the two API routes (/api/portfolio/import/extract, /apply) and the
 * confirmation dialog. Client-safe: no server imports.
 *
 * ## The DCA invariant (why the shapes look the way they do)
 *
 * A brokerage holdings page shows AGGREGATE positions — "12 shares, avg cost
 * $177.50" — not the individual purchases that produced them. This module
 * therefore models exactly what the screenshot proves and nothing more:
 * extraction produces position-level aggregates, and reconciliation turns a
 * quantity change into ONE meta-marked balancing transaction whose price makes
 * the ledger's aggregate agree with the screenshot. It never fabricates
 * purchase dates or invents per-lot prices; when the only honest way to match
 * the screenshot is to replace a symbol's recorded transaction history (an
 * avg-cost change with no quantity change), that action is explicitly labelled
 * `rebaseline` and flagged destructive so the user opts into it knowingly.
 */

export type ImportConfidence = "high" | "medium" | "low";

/** One position as read off the screenshot(s). Every field is what was VISIBLE — null means "not shown", never "assumed zero". */
export interface ExtractedPosition {
  /** Ticker as displayed, uppercased. Null when the page shows names only. */
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  /** Average cost per share/unit, when the page shows it. */
  avgCost: number | null;
  /** Total cost basis, when shown (some brokerages show this instead of avg cost). */
  costBasis: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  /** Unrealized P&L in currency, when shown (negative = loss). */
  pnl: number | null;
  /** Unrealized P&L in percent, when shown. */
  pnlPct: number | null;
  currency: string | null;
  /** Best-effort class guess from context: equity | etf | reit | bond | crypto | commodity | cash. */
  assetClassGuess: string | null;
  confidence: ImportConfidence;
  /** Anything odd the model noticed about this row (cut off, ambiguous column, …). */
  note: string | null;
  /** Indices of the uploaded screenshots this row was read from. */
  sourceImages: number[];
}

/** The structured read of the full screenshot set. */
export interface ExtractionResult {
  positions: ExtractedPosition[];
  /** A cash/sweep balance when one is visible. */
  cash: { amount: number; currency: string } | null;
  /** The page's own stated total portfolio value, when visible. */
  totalValue: number | null;
  currency: string | null;
  /** Brokerage the layout appears to belong to, when recognizable. */
  brokerage: string | null;
  /**
   * Whether the screenshots appear to show the ENTIRE portfolio (e.g. the
   * stated total ≈ sum of visible positions, no scroll cut-off). Null = cannot
   * tell. Advisory only — the user's own answer always wins.
   */
  appearsComplete: boolean | null;
  completenessReason: string | null;
  /** Extraction-level problems: blurry regions, cropped columns, ambiguous headers. */
  warnings: string[];
  /** Which model read the screenshots — provenance, surfaced in the preview. */
  model: string;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable machine code, e.g. "value-mismatch", "unverified-symbol". */
  code: string;
  /** User-safe explanation of what didn't reconcile and what to check. */
  message: string;
}

/** How a screenshot position relates to what UAA already holds. */
export type ChangeKind =
  | "new" // not currently in the portfolio
  | "increase" // quantity went up
  | "decrease" // quantity went down
  | "cost-change" // same quantity, different average cost
  | "unchanged" // matches within tolerance
  | "missing" // held in UAA but not visible in the screenshots
  | "conflict"; // extraction can't be reconciled without guessing

/** The concrete write applying a row would perform. */
export type PlannedAction =
  | "add" // new symbol: one opening lot at the screenshot's aggregate
  | "append-buy" // balancing buy lot (preserves existing transaction history)
  | "append-sell" // balancing sell lot (preserves existing transaction history)
  | "rebaseline" // replace the symbol's ledger with one opening lot (destructive)
  | "set-cash" // set the CASH-<CUR> position to the visible balance
  | "remove" // delete the position (only offered when the user confirms completeness)
  | "none"; // nothing to do (unchanged / unresolvable / not visible)

export interface ReconciliationRow {
  /** Stable row key for selection state. */
  key: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  currency: string;
  kind: ChangeKind;
  action: PlannedAction;
  extracted: {
    quantity: number | null;
    avgCost: number | null;
    marketValue: number | null;
    currentPrice: number | null;
    confidence: ImportConfidence;
  } | null;
  existing: { quantity: number; avgCost: number; lotCount: number } | null;
  /**
   * For append-buy/append-sell: the single balancing transaction that makes
   * the ledger's aggregate equal the screenshot's. Meta-marked synthetic on
   * write — it reconciles state, it does not claim to be a real trade.
   */
  delta: { kind: "buy" | "sell"; quantity: number; price: number } | null;
  /** True when applying replaces a multi-lot transaction history. */
  destructive: boolean;
  issues: ValidationIssue[];
  /** Pre-checked in the confirmation UI. Never true for destructive rows or rows with errors. */
  defaultSelected: boolean;
}

/** What the extract route returns — everything the confirmation screen needs, with nothing written yet. */
export interface ImportPreview {
  rows: ReconciliationRow[];
  extraction: {
    brokerage: string | null;
    totalValue: number | null;
    currency: string | null;
    appearsComplete: boolean | null;
    completenessReason: string | null;
    warnings: string[];
    model: string;
  };
  /** Portfolio-level reconciliation: sum of read positions vs the page's own stated total. */
  totals: {
    extractedSum: number | null;
    statedTotal: number | null;
    withinTolerance: boolean | null;
  };
  changeCount: number;
  needsReviewCount: number;
}

/** One confirmed write, as posted to /api/portfolio/import/apply. */
export interface ImportApplyAction {
  action: Exclude<PlannedAction, "none">;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  /** add / rebaseline / set-cash: the absolute position. */
  quantity?: number;
  avgCost?: number;
  /** append-buy / append-sell: the balancing transaction. */
  delta?: { kind: "buy" | "sell"; quantity: number; price: number };
  confidence: ImportConfidence;
  /** True when avgCost was not visible and current price was used instead. */
  costAssumed?: boolean;
}
