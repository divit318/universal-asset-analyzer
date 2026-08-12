/**
 * Screenshot Import — extraction engine.
 *
 * Turns brokerage screenshots into a structured {@link ExtractionResult}
 * through the AI platform's vision path (`portfolio-import` task; the Router
 * restricts candidates to vision-capable provider/model pairs). Everything
 * here is about making the model a careful TRANSCRIBER rather than a helpful
 * guesser: the prompt bans inference of invisible fields, the sanitizer
 * refuses non-numeric junk, and cross-screenshot duplicates are merged only
 * when they agree — a disagreement is preserved and flagged, never averaged.
 *
 * Server-only (calls the AI platform). Pure helpers are exported for tests.
 */

import { runPromptWithMeta } from "../../ai";
import { extractJsonObject } from "../../json-extract";
import type { ExtractedPosition, ExtractionResult, ImportConfidence } from "./types";
import type { ProviderImageAttachment } from "../../ai/provider";

const EXTRACTION_PROMPT = `You are reading screenshot(s) of a brokerage account's holdings/portfolio page. Transcribe every INDIVIDUAL security position visible, exactly as displayed.

Rules — these are absolute:
- Transcribe only what is VISIBLE. If a field is not shown for a position, use null. Never estimate, infer, or compute a value that is not printed on the screen.
- A field being null is correct and expected. Guessing is a failure.
- "Qty"/"Quantity"/"Shares"/"Units" is the position size. "% of account"/"Weight"/"Allocation" is NOT a quantity — never put a percentage in the quantity field.
- "Avg cost"/"Average price"/"Cost/share" is the per-unit purchase cost. "Cost basis"/"Total cost" is the TOTAL. "Market value"/"Value"/"Equity" is the CURRENT value. Do not swap them.
- Totals, subtotals, "Total account value", buying power and margin rows are NOT positions. Report the account total in totalValue instead.
- Watch decimals and thousands separators: "1,234.5" is 1234.5. Negative amounts may be shown in red, with a minus sign, or in parentheses — "(123.45)" is -123.45.
- Fractional share quantities (e.g. 0.3701) are common and valid.
- Cash / sweep / money-market balances go in the "cash" field, not in positions.
- If the same security is visible in more than one screenshot, report it once per screenshot; include the screenshot index in sourceImages.
- If part of the table is cut off, blurry, or a column header is ambiguous, say so in warnings and lower that position's confidence.

Respond with JSON only, exactly this shape:
{
  "positions": [
    {
      "symbol": "ticker as displayed, uppercase, or null if only a name is shown",
      "name": "security name as displayed, or null",
      "quantity": number or null,
      "avgCost": number or null,
      "costBasis": number or null,
      "currentPrice": number or null,
      "marketValue": number or null,
      "pnl": number or null,
      "pnlPct": number or null,
      "currency": "ISO code if determinable (from symbols like $, ₹, €, or explicit labels), else null",
      "assetClassGuess": "equity" | "etf" | "reit" | "bond" | "crypto" | "commodity" | null,
      "confidence": "high" | "medium" | "low",
      "note": "anything odd about this row, or null",
      "sourceImages": [0-based screenshot indices]
    }
  ],
  "cash": { "amount": number, "currency": "ISO code" } or null,
  "totalValue": the page's own stated total portfolio value, or null,
  "currency": "the account's currency if determinable, else null",
  "brokerage": "brokerage name if the layout is recognizable, else null",
  "appearsComplete": true if these screenshots clearly show the ENTIRE portfolio (e.g. the stated total matches the sum of visible positions, no cut-off rows), false if clearly partial, null if you cannot tell,
  "completenessReason": "one sentence explaining the appearsComplete judgment, or null",
  "warnings": ["extraction-level problems: cropped columns, blur, ambiguous headers"]
}`;

/* -------------------------------------------------------------------------- */
/* Sanitization — the model's JSON is never trusted shape-wise                 */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a value the model produced into a finite number or null. Accepts
 * numeric strings with currency symbols / thousands separators / parentheses
 * negatives, because models occasionally echo the display format despite
 * being told to emit numbers.
 */
export function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, "$1").replace(/[,$€£₹\s%]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function toCleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.toLowerCase() !== "null" ? s : null;
}

function toConfidence(v: unknown): ImportConfidence {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

const CLASS_GUESSES = new Set(["equity", "etf", "reit", "bond", "crypto", "commodity", "forex", "cash"]);

function sanitizePosition(raw: unknown): ExtractedPosition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const symbol = toCleanString(r.symbol)?.toUpperCase() ?? null;
  const name = toCleanString(r.name);
  if (!symbol && !name) return null;
  const classGuess = toCleanString(r.assetClassGuess)?.toLowerCase() ?? null;
  return {
    symbol,
    name,
    quantity: toFiniteNumber(r.quantity),
    avgCost: toFiniteNumber(r.avgCost),
    costBasis: toFiniteNumber(r.costBasis),
    currentPrice: toFiniteNumber(r.currentPrice),
    marketValue: toFiniteNumber(r.marketValue),
    pnl: toFiniteNumber(r.pnl),
    pnlPct: toFiniteNumber(r.pnlPct),
    currency: toCleanString(r.currency)?.toUpperCase() ?? null,
    assetClassGuess: classGuess && CLASS_GUESSES.has(classGuess) ? classGuess : null,
    confidence: toConfidence(r.confidence),
    note: toCleanString(r.note),
    sourceImages: Array.isArray(r.sourceImages)
      ? r.sourceImages.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0)
      : [],
  };
}

/** Two reads of the same field agree within floating/display tolerance. */
function agrees(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true; // one side not visible — no disagreement
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && Math.abs(a - b) / scale < 0.005;
}

const rank: Record<ImportConfidence, number> = { high: 2, medium: 1, low: 0 };

/**
 * Merge duplicate reads of the same symbol across screenshots.
 *
 * Agreement (same quantity within tolerance) collapses to one row keeping the
 * most complete/confident read. Disagreement keeps ONE row but nulls the
 * conflicting quantity and marks it low-confidence with an explanatory note —
 * validation then fails it into review rather than either read silently
 * winning. Positions without a symbol are never merged (two name-only rows
 * could be genuinely different securities).
 */
export function mergeDuplicates(positions: ExtractedPosition[]): ExtractedPosition[] {
  const out: ExtractedPosition[] = [];
  const bySymbol = new Map<string, number>(); // symbol → index in out

  for (const pos of positions) {
    if (!pos.symbol) {
      out.push(pos);
      continue;
    }
    const existingIdx = bySymbol.get(pos.symbol);
    if (existingIdx === undefined) {
      bySymbol.set(pos.symbol, out.length);
      out.push(pos);
      continue;
    }
    const prev = out[existingIdx];
    const sourceImages = [...new Set([...prev.sourceImages, ...pos.sourceImages])].sort((a, b) => a - b);
    if (agrees(prev.quantity, pos.quantity) && agrees(prev.avgCost, pos.avgCost)) {
      // Same position seen twice — keep the richer read, union provenance.
      const richer = (rank[pos.confidence] > rank[prev.confidence] ? pos : prev);
      const other = richer === pos ? prev : pos;
      out[existingIdx] = {
        ...richer,
        // Fill fields the richer read was missing from the other one.
        quantity: richer.quantity ?? other.quantity,
        avgCost: richer.avgCost ?? other.avgCost,
        costBasis: richer.costBasis ?? other.costBasis,
        currentPrice: richer.currentPrice ?? other.currentPrice,
        marketValue: richer.marketValue ?? other.marketValue,
        pnl: richer.pnl ?? other.pnl,
        pnlPct: richer.pnlPct ?? other.pnlPct,
        name: richer.name ?? other.name,
        currency: richer.currency ?? other.currency,
        sourceImages,
      };
    } else {
      out[existingIdx] = {
        ...prev,
        quantity: null,
        avgCost: null,
        confidence: "low",
        note: `Conflicting reads across screenshots (${prev.quantity ?? "?"} vs ${pos.quantity ?? "?"} units) — needs manual verification`,
        sourceImages,
      };
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                  */
/* -------------------------------------------------------------------------- */

const EXTRACTION_DEFAULTS = {
  positions: [] as unknown[],
  cash: null as unknown,
  totalValue: null as unknown,
  currency: null as unknown,
  brokerage: null as unknown,
  appearsComplete: null as unknown,
  completenessReason: null as unknown,
  warnings: [] as unknown[],
};

/**
 * Read the screenshot set into a sanitized, deduplicated ExtractionResult.
 * One call for the whole set — cross-screenshot dedup needs every image in
 * the same context, and the wire cost of N images in one request is the same
 * as N requests without the ability to reconcile them.
 */
export async function extractPortfolioScreenshots(
  images: ProviderImageAttachment[],
): Promise<ExtractionResult> {
  const { text, model } = await runPromptWithMeta("portfolio-import", EXTRACTION_PROMPT, {
    json: true,
    images,
  });

  const parsed = extractJsonObject(text, EXTRACTION_DEFAULTS);

  const positions = mergeDuplicates(
    (Array.isArray(parsed.positions) ? parsed.positions : [])
      .map(sanitizePosition)
      .filter((p): p is ExtractedPosition => p !== null),
  );

  let cash: ExtractionResult["cash"] = null;
  if (typeof parsed.cash === "object" && parsed.cash !== null) {
    const c = parsed.cash as Record<string, unknown>;
    const amount = toFiniteNumber(c.amount);
    if (amount !== null && amount > 0) {
      cash = { amount, currency: toCleanString(c.currency)?.toUpperCase() ?? "USD" };
    }
  }

  return {
    positions,
    cash,
    totalValue: toFiniteNumber(parsed.totalValue),
    currency: toCleanString(parsed.currency)?.toUpperCase() ?? null,
    brokerage: toCleanString(parsed.brokerage),
    appearsComplete: typeof parsed.appearsComplete === "boolean" ? parsed.appearsComplete : null,
    completenessReason: toCleanString(parsed.completenessReason),
    warnings: (Array.isArray(parsed.warnings) ? parsed.warnings : [])
      .map(toCleanString)
      .filter((w): w is string => w !== null),
    model,
  };
}
