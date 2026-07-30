/**
 * Simulator editing — pure transforms over a hypothetical holdings list, plus
 * the swap/rationale AI contracts.
 *
 * Every transform CONSERVES the mandate's total: buying more of something
 * drains the cash sleeve, trimming or removing refills it. A hypothetical
 * book whose total drifts with every edit stops meaning "what would I do with
 * this cash" — the invariant is the point, so it lives here in pure,
 * testable functions rather than scattered across dialogs.
 */

import { extractJson } from "@/lib/json-extract";
import { OBJECTIVES } from "@/lib/portfolio/engines/optimize";
import type { SimHolding, SimProfile } from "./types";

const SYMBOL_RE = /^[A-Z0-9.\-=^]{1,12}$/;

/* ─────────────────────────── cash conservation ─────────────────────────── */

function cashIndex(holdings: SimHolding[]): number {
  return holdings.findIndex((h) => h.assetClass === "cash");
}

/** Move `deltaDollars` INTO the cash sleeve (negative = spend cash). Creates
 * the sleeve if the book has none. Never lets cash go below zero — callers
 * cap spends with {@link availableCash} first. */
function adjustCash(holdings: SimHolding[], deltaDollars: number, currency: string): SimHolding[] {
  if (Math.abs(deltaDollars) < 0.005) return holdings;
  const i = cashIndex(holdings);
  if (i === -1) {
    if (deltaDollars <= 0) return holdings; // nothing to spend from
    return [
      ...holdings,
      {
        symbol: null,
        name: `Cash (${currency})`,
        assetClass: "cash",
        currency,
        quantity: Math.round(deltaDollars * 100) / 100,
        targetWeight: 0,
        rationale: "Liquidity sleeve — refilled by trims and removals.",
        addedBy: "user",
      },
    ];
  }
  const next = [...holdings];
  const newQty = Math.round((next[i].quantity + deltaDollars) * 100) / 100;
  if (newQty < -0.005) throw new Error("Edit would overdraw the cash sleeve");
  if (newQty <= 0) return next.filter((_, idx) => idx !== i);
  next[i] = { ...next[i], quantity: newQty };
  return next;
}

export function availableCash(holdings: SimHolding[]): number {
  const i = cashIndex(holdings);
  return i === -1 ? 0 : holdings[i].quantity;
}

/* ─────────────────────────── transforms ────────────────────────────────── */

export interface EditResult {
  holdings: SimHolding[];
  /** Symbols whose rationale is now stale and should be re-narrated. */
  changedSymbols: string[];
  /** Set when the request had to be capped (e.g. not enough cash). */
  note: string | null;
}

/** Change a position's quantity. The dollar difference (at `price`, in the
 * mandate currency) flows to/from the cash sleeve; increases are capped at
 * available cash rather than minting money. */
export function applyQuantityEdit(
  holdings: SimHolding[],
  symbol: string,
  newQuantity: number,
  priceBase: number,
  currency: string,
): EditResult {
  const i = holdings.findIndex((h) => h.symbol === symbol);
  if (i === -1) throw new Error(`No holding ${symbol} to adjust`);
  if (!Number.isFinite(newQuantity) || newQuantity < 0) throw new Error("Quantity must be ≥ 0");
  if (!Number.isFinite(priceBase) || priceBase <= 0) throw new Error("A live price is required to adjust quantity");
  if (newQuantity === 0) return removeHolding(holdings, symbol, priceBase, currency);

  const h = holdings[i];
  let qty = newQuantity;
  let note: string | null = null;
  const deltaDollars = (qty - h.quantity) * priceBase;
  const cash = availableCash(holdings);
  if (deltaDollars > cash + 0.005) {
    // Cap the buy at what the sleeve can fund — the mandate total is fixed.
    const affordable = h.quantity + cash / priceBase;
    qty = h.assetClass === "crypto" ? Math.floor(affordable * 1e6) / 1e6 : Math.floor(affordable);
    if (qty <= h.quantity) {
      throw new Error(`Not enough cash to increase ${symbol} — the sleeve holds ${cash.toFixed(2)}`);
    }
    note = `Capped at ${qty.toLocaleString("en-US")} — the cash sleeve only covers that much.`;
  }

  const next = [...holdings];
  next[i] = { ...h, quantity: qty, addedBy: "user" };
  return {
    holdings: adjustCash(next, -(qty - h.quantity) * priceBase, currency),
    changedSymbols: [symbol],
    note,
  };
}

/** Remove a position; its live value refills the cash sleeve. */
export function removeHolding(
  holdings: SimHolding[],
  symbol: string,
  priceBase: number,
  currency: string,
): EditResult {
  const i = holdings.findIndex((h) => h.symbol === symbol);
  if (i === -1) throw new Error(`No holding ${symbol} to remove`);
  const freed = holdings[i].quantity * priceBase;
  const next = holdings.filter((_, idx) => idx !== i);
  return { holdings: adjustCash(next, freed, currency), changedSymbols: [], note: null };
}

/** Add a new position, funded from the cash sleeve at `priceBase`. */
export function addHolding(
  holdings: SimHolding[],
  input: {
    symbol: string;
    name: string;
    assetClass: SimHolding["assetClass"];
    currency: string;
    quantity: number;
  },
  priceBase: number,
  baseCurrency: string,
): EditResult {
  const symbol = input.symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new Error("Invalid symbol");
  if (holdings.some((h) => h.symbol === symbol)) {
    throw new Error(`${symbol} is already in this portfolio — adjust it instead`);
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be positive");
  if (!Number.isFinite(priceBase) || priceBase <= 0) throw new Error("A live price is required");

  let qty = input.quantity;
  let note: string | null = null;
  const cash = availableCash(holdings);
  if (qty * priceBase > cash + 0.005) {
    const affordable = cash / priceBase;
    qty = input.assetClass === "crypto" ? Math.floor(affordable * 1e6) / 1e6 : Math.floor(affordable);
    if (qty <= 0) throw new Error(`Not enough cash — the sleeve holds ${cash.toFixed(2)}`);
    note = `Capped at ${qty.toLocaleString("en-US")} — the cash sleeve only covers that much.`;
  }

  const added: SimHolding = {
    symbol,
    name: input.name,
    assetClass: input.assetClass,
    currency: input.currency,
    quantity: qty,
    targetWeight: 0, // manual position — its "target" is whatever the user sized
    rationale: null, // freshly narrated by the refresh-narrative call
    addedBy: "user",
  };
  return {
    holdings: adjustCash([...holdings, added], -qty * priceBase, baseCurrency),
    changedSymbols: [symbol],
    note,
  };
}

/** Replace one position with an alternative of equal value (the swap): the
 * outgoing position's live value buys whole shares of the replacement, and
 * the rounding residue lands in cash. */
export function applySwap(
  holdings: SimHolding[],
  outSymbol: string,
  replacement: { symbol: string; name: string; why: string | null },
  outPriceBase: number,
  inPriceBase: number,
  inCurrency: string,
  baseCurrency: string,
): EditResult {
  const i = holdings.findIndex((h) => h.symbol === outSymbol);
  if (i === -1) throw new Error(`No holding ${outSymbol} to swap`);
  const inSymbol = replacement.symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(inSymbol)) throw new Error("Invalid replacement symbol");
  if (holdings.some((h) => h.symbol === inSymbol)) {
    throw new Error(`${inSymbol} is already in this portfolio`);
  }
  if (!Number.isFinite(inPriceBase) || inPriceBase <= 0) throw new Error("A live price is required for the replacement");

  const out = holdings[i];
  const value = out.quantity * outPriceBase;
  const fractional = out.assetClass === "crypto";
  const qty = fractional ? Math.floor((value / inPriceBase) * 1e6) / 1e6 : Math.floor(value / inPriceBase);
  if (qty <= 0) throw new Error(`${inSymbol}'s price exceeds the position's value — swap not possible`);

  const next = [...holdings];
  next[i] = {
    symbol: inSymbol,
    name: replacement.name,
    assetClass: out.assetClass,
    currency: inCurrency,
    quantity: qty,
    targetWeight: out.targetWeight,
    rationale: replacement.why,
    addedBy: "user",
  };
  const residue = value - qty * inPriceBase;
  return { holdings: adjustCash(next, residue, baseCurrency), changedSymbols: [inSymbol], note: null };
}

/* ─────────────────────────── AI contracts ──────────────────────────────── */

export interface SwapSuggestion {
  symbol: string;
  name: string;
  why: string;
}

export function buildSwapPrompt(
  profile: SimProfile,
  holdings: SimHolding[],
  outSymbol: string,
  menu: string,
): string {
  const out = holdings.find((h) => h.symbol === outSymbol);
  const book = holdings
    .map((h) => `- ${h.symbol ?? "CASH"} (${h.assetClass}) target ${h.targetWeight}%`)
    .join("\n");
  return `You are a portfolio architect. The client wants alternatives to ONE holding in this hypothetical portfolio.

Mandate: ${OBJECTIVES[profile.objective].label}, risk ${profile.riskAppetite}/10, horizon ${profile.horizon}, base currency ${profile.currency}.

Current book:
${book}

Replace: ${outSymbol} — ${out?.name ?? ""} (${out?.assetClass ?? ""}), currently ${out?.targetWeight ?? 0}% of the book. The replacement keeps the same dollar value and role.

Curated candidates for this class (you may also suggest other instruments you are certain are real, liquid tickers):
${menu}

Suggest exactly 3 alternatives. Do NOT suggest anything already in the book, and do not suggest ${outSymbol} itself. Each "why" is one concrete sentence (≤ 140 chars) comparing it to ${outSymbol} for THIS mandate.

Respond with JSON only:
{"alternatives": [{"symbol": "...", "name": "...", "why": "..."}]}`;
}

export function parseSwapResponse(raw: string, holdings: SimHolding[], outSymbol: string): SwapSuggestion[] {
  const parsed = extractJson<{ alternatives?: unknown }>(raw);
  const arr = Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
  const held = new Set(holdings.map((h) => h.symbol).filter(Boolean));
  const out: SwapSuggestion[] = [];
  for (const a of arr) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
    if (!SYMBOL_RE.test(symbol) || symbol === outSymbol || held.has(symbol)) continue;
    if (out.some((x) => x.symbol === symbol)) continue;
    out.push({
      symbol,
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : symbol,
      why: typeof o.why === "string" ? o.why.trim().slice(0, 200) : "",
    });
    if (out.length === 3) break;
  }
  return out;
}

export function buildRationalePrompt(
  profile: SimProfile,
  holdings: SimHolding[],
  symbols: string[],
): string {
  const book = holdings
    .map((h) => `- ${h.symbol ?? "CASH"} (${h.assetClass}): ${h.name}, target ${h.targetWeight}%`)
    .join("\n");
  return `You are a portfolio architect. The client edited this hypothetical portfolio; write a fresh one-line rationale for each listed holding so the stated reasoning matches the book as it now stands.

Mandate: ${OBJECTIVES[profile.objective].label}, risk ${profile.riskAppetite}/10, horizon ${profile.horizon}.

The book after the edit:
${book}

Write rationales for: ${symbols.join(", ")}. Each is one concrete sentence (≤ 140 chars) — why this instrument, in this book, for this mandate. Never mention the edit itself.

Respond with JSON only: {"rationales": {"SYMBOL": "..."}}`;
}

export function parseRationaleResponse(raw: string, symbols: string[]): Record<string, string> {
  const parsed = extractJson<{ rationales?: Record<string, unknown> }>(raw);
  const out: Record<string, string> = {};
  const src = parsed.rationales ?? {};
  for (const s of symbols) {
    const v = src[s] ?? src[s.toUpperCase()];
    if (typeof v === "string" && v.trim()) out[s] = v.trim().slice(0, 200);
  }
  return out;
}
