/**
 * The read model every non-editing surface uses: the Research Hub strip, the
 * Valuation Register, and (later) the IC report header.
 *
 * These surfaces display a valuation; they never compute one. Giving them a
 * single shaped read — rather than each assembling a case, a live price and an
 * engine prior for itself — is what keeps "one intrinsic value in the system"
 * true in practice and not just in principle.
 *
 * Pure apart from the engine-prior file read, which is a cached `fs` call.
 */

import { getEnginePrior, type EnginePrior } from "./engine-prior";
import {
  caseFreshness,
  computeCaseResult,
  userAuthoredKeys,
  VALUATION_METHOD_LABEL,
  type AssumptionKey,
  type CaseResult,
  type ValuationCase,
  type ValuationMethod,
} from "./case";
import type { FreshnessLevel } from "../provenance";

export interface ValuationSummary {
  symbol: string;
  currency: string;
  method: ValuationMethod;
  methodLabel: string;
  version: number;
  /** Priced against the live quote when one was supplied, else the stored price. */
  result: CaseResult;
  /** The price `result` was computed against. */
  price: number | null;
  /** Whether that price was live or the one stored on the case. */
  priceIsLive: boolean;
  /** The engine's Monte Carlo median, when the symbol was in the last scored run. */
  enginePrior: EnginePrior | null;
  /**
   * Case fair value minus the engine's median, as a fraction of the engine's.
   * Positive means the case is more optimistic than the systematic prior.
   */
  engineSpread: number | null;
  /** Assumptions the user personally owns — how much of this is their judgment. */
  ownedKeys: AssumptionKey[];
  /** True when nothing but the seed and AI have ever touched it. */
  untouched: boolean;
  freshness: FreshnessLevel;
  freshnessLabel: string;
  updatedAt: string;
  lastUserEventAt: string | null;
}

/**
 * Shape a stored case for display, repricing it against a live quote.
 *
 * The stored `margin_of_safety` column is as of the last write, which is correct
 * for the audit trail and wrong for a dashboard — a case written at $180 should
 * not still claim a 23% margin of safety after the stock has run to $240. Passing
 * `livePrice` recomputes without appending a version, so the market moving is
 * never mistaken for the user changing their mind.
 */
export function summarizeForDisplay(
  vcase: ValuationCase,
  livePrice: number | null = null,
): ValuationSummary {
  const price = livePrice ?? vcase.priceAt;
  const result = livePrice != null ? computeCaseResult(vcase.assumptions, livePrice) : vcase.result;
  const prior = getEnginePrior(vcase.symbol);
  const fresh = caseFreshness(vcase.updatedAt);
  const owned = userAuthoredKeys(vcase.assumptions);

  const engineSpread =
    prior?.p50 != null && prior.p50 !== 0 && result.fairValue != null
      ? (result.fairValue - prior.p50) / Math.abs(prior.p50)
      : null;

  return {
    symbol: vcase.symbol,
    currency: vcase.currency,
    method: vcase.method,
    methodLabel: VALUATION_METHOD_LABEL[vcase.method],
    version: vcase.version,
    result,
    price,
    priceIsLive: livePrice != null,
    enginePrior: prior,
    engineSpread,
    ownedKeys: owned,
    untouched: vcase.lastUserEventAt == null,
    freshness: fresh.level,
    freshnessLabel: fresh.label,
    updatedAt: vcase.updatedAt,
    lastUserEventAt: vcase.lastUserEventAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Register grouping                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Why a case is asking for attention. Ordered by how much it matters, which is
 * the order the Register sorts in — a broken case outranks a stale one.
 */
export type CaseFlag =
  | "unvaluable"
  | "negative_margin"
  | "stale"
  | "untouched"
  | "engine_divergence";

export const CASE_FLAG_LABEL: Record<CaseFlag, string> = {
  unvaluable: "Cannot be valued",
  negative_margin: "Priced above your case",
  stale: "Not reviewed in months",
  untouched: "Never reviewed by you",
  engine_divergence: "Far from the engine's prior",
};

export const CASE_FLAG_DETAIL: Record<CaseFlag, string> = {
  unvaluable: "The assumptions no longer produce a value — usually a discount rate at or below terminal growth.",
  negative_margin: "The market price is above the value your own assumptions imply.",
  stale: "A valuation is worth revisiting each quarter; this one has not changed in over 90 days.",
  untouched: "Still the seeded or AI-authored case — none of these assumptions are yours yet.",
  engine_divergence: "This case differs from the quant engine's Monte Carlo median by more than 30%.",
};

const ENGINE_DIVERGENCE_THRESHOLD = 0.3;

/** Everything currently worth flagging about a case, most important first. */
export function caseFlags(summary: ValuationSummary): CaseFlag[] {
  const flags: CaseFlag[] = [];
  if (summary.result.invalidReason !== null) flags.push("unvaluable");
  if (summary.result.marginOfSafety != null && summary.result.marginOfSafety < 0) {
    flags.push("negative_margin");
  }
  if (summary.freshness === "stale") flags.push("stale");
  if (summary.untouched) flags.push("untouched");
  if (summary.engineSpread != null && Math.abs(summary.engineSpread) > ENGINE_DIVERGENCE_THRESHOLD) {
    flags.push("engine_divergence");
  }
  return flags;
}

/**
 * Register sort: what needs attention first, then by thinnest margin of safety.
 *
 * Deliberately not "highest margin of safety first". The Register's job is to
 * surface cases that have gone wrong or gone unexamined, not to rank ideas —
 * ranking is the Screener's job.
 */
export function compareForRegister(a: ValuationSummary, b: ValuationSummary): number {
  const flagWeight = (s: ValuationSummary) => caseFlags(s).length;
  const byFlags = flagWeight(b) - flagWeight(a);
  if (byFlags !== 0) return byFlags;

  const mosA = a.result.marginOfSafety;
  const mosB = b.result.marginOfSafety;
  if (mosA == null && mosB == null) return a.symbol.localeCompare(b.symbol);
  if (mosA == null) return 1;
  if (mosB == null) return -1;
  return mosA - mosB;
}
