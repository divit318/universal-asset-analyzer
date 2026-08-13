/**
 * Screenshot Import — validation pass.
 *
 * Pure, deterministic checks over an {@link ExtractionResult}, cross-checked
 * against live quotes the route fetched. This is the layer that catches what
 * vision models actually get wrong on financial tables — swapped decimals,
 * percentages read as quantities, market value confused with cost basis,
 * plausible-looking tickers that don't exist — by insisting that the numbers
 * on a real brokerage page must reconcile with each other:
 *
 *     quantity × currentPrice ≈ marketValue
 *     quantity × avgCost      ≈ costBasis
 *     Σ marketValue           ≈ the page's own stated total
 *
 * A failed check FLAGS, never fixes: silently "correcting" a misread is the
 * exact failure mode this feature must not have.
 *
 * No I/O — fully unit-testable.
 */

import type { ExtractedPosition, ExtractionResult, ValidationIssue } from "./types";

/** The slice of a live quote validation needs (subset of lib/types.ts Quote). */
export interface QuoteCheck {
  symbol: string;
  name: string;
  price: number;
  currency: string;
}

/** Internal-consistency tolerance: displayed values are rounded, so ±2.5% is display noise, beyond it is a misread. */
const RECONCILE_TOLERANCE = 0.025;
/** Beyond this the numbers aren't rounding noise or a stale page — something was misread badly. */
const RECONCILE_HARD_LIMIT = 0.2;
/** A screenshot may be days old; a live-price gap under this is staleness, beyond it suggests a decimal/ticker misread. */
const LIVE_PRICE_TOLERANCE = 0.4;
/** Portfolio-level: Σ positions vs the page's stated total. */
const TOTAL_TOLERANCE = 0.03;

function relDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

/** Crude token-overlap check that an extracted name plausibly names the quoted security. */
export function namesMatch(extracted: string, quoted: string): boolean {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,()'&-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !["inc", "corp", "co", "ltd", "plc", "the", "of", "class", "etf", "trust", "fund", "shares"].includes(t));
  const a = new Set(tokens(extracted));
  const b = new Set(tokens(quoted));
  if (a.size === 0 || b.size === 0) return true; // nothing meaningful to compare
  for (const t of a) {
    for (const u of b) {
      if (t === u || t.startsWith(u) || u.startsWith(t)) return true;
    }
  }
  return false;
}

function issue(severity: ValidationIssue["severity"], code: string, message: string): ValidationIssue {
  return { severity, code, message };
}

/** Validate one position. Exported for targeted tests. */
export function validatePosition(
  pos: ExtractedPosition,
  quote: QuoteCheck | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!pos.symbol) {
    issues.push(
      issue(
        "error",
        "no-symbol",
        `No ticker is visible for "${pos.name ?? "this position"}" — it can't be imported without one.`,
      ),
    );
  }

  if (pos.quantity === null) {
    issues.push(issue("error", "no-quantity", "No quantity could be read for this position."));
  } else if (pos.quantity <= 0) {
    issues.push(issue("error", "bad-quantity", `Quantity ${pos.quantity} is not a valid position size.`));
  }

  // Percentage misread heuristic: quantity identical to the row's own P&L%
  // while the value math disagrees is the classic "read the % column" error.
  if (
    pos.quantity !== null &&
    pos.pnlPct !== null &&
    pos.quantity === pos.pnlPct &&
    pos.marketValue !== null &&
    pos.currentPrice !== null &&
    relDiff(pos.quantity * pos.currentPrice, pos.marketValue) > RECONCILE_TOLERANCE
  ) {
    issues.push(
      issue(
        "error",
        "percent-as-quantity",
        `Quantity (${pos.quantity}) equals the P&L percentage and doesn't reconcile with the market value — likely a misread column.`,
      ),
    );
  }

  // quantity × currentPrice ≈ marketValue
  if (pos.quantity !== null && pos.quantity > 0 && pos.currentPrice !== null && pos.marketValue !== null) {
    const implied = pos.quantity * pos.currentPrice;
    const diff = relDiff(implied, pos.marketValue);
    if (diff > RECONCILE_HARD_LIMIT) {
      issues.push(
        issue(
          "error",
          "value-mismatch",
          `Quantity × price (${implied.toFixed(2)}) is ${Math.round(diff * 100)}% away from the displayed market value (${pos.marketValue.toFixed(2)}) — one of these was misread.`,
        ),
      );
    } else if (diff > RECONCILE_TOLERANCE) {
      issues.push(
        issue(
          "warning",
          "value-mismatch",
          `Quantity × price (${implied.toFixed(2)}) doesn't quite match the displayed market value (${pos.marketValue.toFixed(2)}). Verify before applying.`,
        ),
      );
    }
  }

  // quantity × avgCost ≈ costBasis
  if (pos.quantity !== null && pos.quantity > 0 && pos.avgCost !== null && pos.costBasis !== null) {
    const implied = pos.quantity * pos.avgCost;
    const diff = relDiff(implied, pos.costBasis);
    if (diff > RECONCILE_TOLERANCE) {
      issues.push(
        issue(
          diff > RECONCILE_HARD_LIMIT ? "error" : "warning",
          "cost-mismatch",
          `Quantity × avg cost (${implied.toFixed(2)}) doesn't match the displayed cost basis (${pos.costBasis.toFixed(2)}).`,
        ),
      );
    }
  }

  // P&L sign should agree with price vs cost — catches a swapped cost/value column.
  if (pos.pnl !== null && pos.pnl !== 0 && pos.avgCost !== null && pos.currentPrice !== null && pos.avgCost !== pos.currentPrice) {
    const expectGain = pos.currentPrice > pos.avgCost;
    if (expectGain !== pos.pnl > 0) {
      issues.push(
        issue(
          "warning",
          "pnl-sign-mismatch",
          "The P&L sign disagrees with price vs avg cost — the cost and value columns may have been swapped.",
        ),
      );
    }
  }

  if (pos.symbol && !quote) {
    issues.push(
      issue(
        "warning",
        "unverified-symbol",
        `"${pos.symbol}" did not resolve to a live quote — the ticker may be misread, or it may be unlisted.`,
      ),
    );
  }

  if (quote) {
    if (pos.name && quote.name && !namesMatch(pos.name, quote.name)) {
      issues.push(
        issue(
          "warning",
          "name-mismatch",
          `The displayed name "${pos.name}" doesn't obviously match ${quote.symbol} ("${quote.name}") — verify the ticker.`,
        ),
      );
    }
    if (pos.currentPrice !== null && quote.price > 0 && relDiff(pos.currentPrice, quote.price) > LIVE_PRICE_TOLERANCE) {
      issues.push(
        issue(
          "warning",
          "price-differs",
          `The screenshot's price (${pos.currentPrice}) is far from today's live price (${quote.price.toFixed(2)}) — an old screenshot, a different listing, or a decimal misread.`,
        ),
      );
    }
    if (pos.currency && quote.currency && pos.currency !== quote.currency.toUpperCase()) {
      issues.push(
        issue(
          "warning",
          "currency-mismatch",
          `The screenshot reads as ${pos.currency} but ${quote.symbol} trades in ${quote.currency}.`,
        ),
      );
    }
  }

  if (pos.confidence === "low" && !issues.some((i) => i.severity === "error")) {
    issues.push(issue("warning", "low-confidence", pos.note ?? "The model was not confident reading this row."));
  }

  return issues;
}

export interface ValidationOutput {
  /** Parallel to extraction.positions. */
  positionIssues: ValidationIssue[][];
  /** Portfolio-level findings (total reconciliation, duplicates). */
  portfolioIssues: ValidationIssue[];
}

/** Validate the whole extraction against live quotes. */
export function validateExtraction(
  extraction: ExtractionResult,
  quotes: Map<string, QuoteCheck>,
): ValidationOutput {
  const positionIssues = extraction.positions.map((pos) =>
    validatePosition(pos, pos.symbol ? quotes.get(pos.symbol) : undefined),
  );

  const portfolioIssues: ValidationIssue[] = [];

  // Σ positions (+ cash) vs the page's own stated total.
  if (extraction.totalValue !== null && extraction.totalValue > 0) {
    const values = extraction.positions.map((p) => p.marketValue);
    if (values.every((v) => v !== null)) {
      const sum = values.reduce((acc: number, v) => acc + (v as number), 0) + (extraction.cash?.amount ?? 0);
      const diff = relDiff(sum, extraction.totalValue);
      if (diff > TOTAL_TOLERANCE) {
        portfolioIssues.push(
          issue(
            "warning",
            "total-mismatch",
            `The visible positions sum to ${sum.toFixed(2)} but the page states a total of ${extraction.totalValue.toFixed(2)} (${Math.round(diff * 100)}% apart) — the screenshots may not show everything, or a value was misread.`,
          ),
        );
      }
    }
  }

  return { positionIssues, portfolioIssues };
}
