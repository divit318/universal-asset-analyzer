/**
 * IC Pipeline — Stage 5: Valuation.
 *
 * Phase 2 rebuild. The model no longer produces a single number here: it
 * proposes inputs (lib/ic/valuation-inputs.ts), a validation boundary checks
 * them, and the deterministic engine (lib/ic/valuation-engine.ts, assembled
 * by lib/ic/valuation-suite.ts) computes every value, scenario, sensitivity
 * and the headline. This module orchestrates that and reconciles the result
 * against the two other estimates that exist in the app:
 *
 *   1. The user's ValuationCase (persisted, versioned, correctable) — the
 *      report renders an explicit reconciliation row, not a silent override.
 *   2. The quant engine's Monte Carlo prior, when the symbol was scored.
 *
 * Both reconciliations are deterministic text computed from the numbers —
 * no model call sits between two numbers and the sentence comparing them.
 */

import type { CanonicalFacts } from "./ic/canonical";
import { defaultProposal, proposeValuationInputs, resolveProposal } from "./ic/valuation-inputs";
import { assembleValuationSuite, type ValuationSuiteResult } from "./ic/valuation-suite";
import type { ValuationCase } from "./valuation/case";
import { fmtMoney, fmtPercent } from "./ic/format";

export type { ValuationSuiteResult } from "./ic/valuation-suite";

/* ── Reconciliation vs the user's ValuationCase (Phase 2.3) ────────────── */

export interface CaseReconciliation {
  caseFairValue: number;
  caseVersion: number;
  engineHeadline: number | null;
  /** |case − engine| / engine, when both exist. */
  spread: number | null;
  divergent: boolean;
  explanation: string;
}

export function reconcileWithCase(
  suite: ValuationSuiteResult,
  vcase: ValuationCase | null,
): CaseReconciliation | null {
  if (!vcase || vcase.result.fairValue == null || !Number.isFinite(vcase.result.fairValue)) return null;
  const caseFairValue = vcase.result.fairValue;
  const engineHeadline = suite.headline?.perShare ?? null;
  const c = suite.currency;

  if (engineHeadline == null) {
    return {
      caseFairValue,
      caseVersion: vcase.version,
      engineHeadline: null,
      spread: null,
      divergent: false,
      explanation: `Your valuation case (v${vcase.version}) carries a fair value of ${fmtMoney(caseFairValue, c)}. The report engine produced no headline to compare it against${suite.blockingViolations.length > 0 ? ` (valuation blocked: ${suite.blockingViolations[0]?.invariant})` : ""}.`,
    };
  }

  const spread = Math.abs(caseFairValue - engineHeadline) / Math.abs(engineHeadline);
  const divergent = spread > 0.30;
  const direction = caseFairValue >= engineHeadline ? "above" : "below";
  return {
    caseFairValue,
    caseVersion: vcase.version,
    engineHeadline,
    spread,
    divergent,
    explanation: divergent
      ? `Your valuation case (v${vcase.version}, ${fmtMoney(caseFairValue, c)}) sits ${fmtPercent(spread)} ${direction} this report's blended estimate (${fmtMoney(engineHeadline, c)}). A spread this wide means the two disagree on growth or discount assumptions: compare the case's assumptions against the engine inputs in the valuation tab before trusting either.`
      : `Your valuation case (v${vcase.version}, ${fmtMoney(caseFairValue, c)}) is ${fmtPercent(spread)} ${direction} this report's blended estimate (${fmtMoney(engineHeadline, c)}): within the 30% agreement band.`,
  };
}

/* ── Reconciliation vs the quant engine's Monte Carlo prior ─────────────── */

export interface PriorReconciliation {
  mcP50: number;
  engineHeadline: number | null;
  spread: number | null;
  divergent: boolean;
  explanation: string;
}

export function reconcileWithPrior(
  suite: ValuationSuiteResult,
  mcP50: number | null,
): PriorReconciliation | null {
  if (mcP50 == null || !Number.isFinite(mcP50) || mcP50 === 0) return null;
  const engineHeadline = suite.headline?.perShare ?? null;
  const c = suite.currency;
  if (engineHeadline == null) {
    return {
      mcP50,
      engineHeadline: null,
      spread: null,
      divergent: false,
      explanation: `The quant engine's Monte Carlo median is ${fmtMoney(mcP50, c)}; this report produced no headline to compare it against.`,
    };
  }
  const spread = Math.abs(engineHeadline - mcP50) / Math.abs(mcP50);
  const divergent = spread > 0.30;
  const direction = engineHeadline >= mcP50 ? "above" : "below";
  return {
    mcP50,
    engineHeadline,
    spread,
    divergent,
    explanation: `${divergent ? "Divergence: " : ""}this report's blended estimate (${fmtMoney(engineHeadline, c)}) is ${fmtPercent(spread)} ${direction} the quant engine's Monte Carlo median (${fmtMoney(mcP50, c)})${divergent ? ": the systematic prior and this report disagree materially; the difference is in the growth and discount inputs, which are inspectable in the valuation tab" : ": within the 30% agreement band"}.`,
  };
}

/* ── Stage runner ───────────────────────────────────────────────────────── */

export interface ValuationStageResult {
  suite: ValuationSuiteResult;
  caseReconciliation: CaseReconciliation | null;
  priorReconciliation: PriorReconciliation | null;
}

export interface ValuationStageInput {
  facts: CanonicalFacts;
  /** Platform WACC (fraction) and a components description, from lib/valuation/prefill. */
  wacc: { value: number; components: string };
  vcase: ValuationCase | null;
  enginePriorP50: number | null;
  model?: string;
  /** Skip the model input-proposal call (used by tests/harness). */
  skipModelProposal?: boolean;
}

export async function runValuationStage(input: ValuationStageInput): Promise<ValuationStageResult> {
  const defaults = defaultProposal(input.facts);
  const raw = input.skipModelProposal
    ? null
    : await proposeValuationInputs(input.facts, defaults, input.model);
  const proposal = resolveProposal(raw, defaults, raw === null);

  const suite = assembleValuationSuite({
    facts: input.facts,
    proposal,
    wacc: input.wacc,
  });

  return {
    suite,
    caseReconciliation: reconcileWithCase(suite, input.vcase),
    priorReconciliation: reconcileWithPrior(suite, input.enginePriorP50),
  };
}
