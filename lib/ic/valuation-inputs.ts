/**
 * IC Report — valuation input proposal boundary (Phase 2).
 *
 * The LLM's only role in valuation: propose INPUTS (growth, fade length,
 * terminal growth, exit multiple, relative multiples, scenario deltas) with a
 * justification per field. Every proposed field is schema-validated and
 * range-checked here; a field that fails validation falls back to the
 * history-derived default and the fallback is recorded, so the report can
 * state exactly which inputs the model chose and which the engine kept.
 */

import { runAnalysis } from "../ai/analysis";
import { LooseObjectSchema } from "../ai/schemas/loose";
import { ValuationProposalWireSchema, IC_SCHEMA_VERSION } from "../ai/schemas/ic";
import { BANDS } from "./valuation-engine";
import type { CanonicalFacts } from "./canonical";
import { fmtPercent, fmtMultiple } from "./format";

export interface ValuationProposal {
  /** Stage-1 FCF growth, fraction. */
  growthY1: number;
  /** Explicit fade period, years. */
  fadeYears: number;
  terminalGrowth: number;
  /** Optional WACC adjustment vs the platform default, in basis points. */
  waccAdjustmentBp: number;
  /** EV/FCF exit multiple for the terminal cross-check. */
  exitMultiple: number | null;
  /** Relative-method inputs. */
  peMultiple: number | null;
  evEbitdaMultiple: number | null;
  /** Required equity FCF yield, fraction. */
  fcfRequiredYield: number | null;
  /** Scenario growth deltas (absolute, fractions). */
  bearGrowthDelta: number;
  bullGrowthDelta: number;
  justifications: Record<string, string>;
}

export interface ResolvedField<T> {
  value: T;
  /** Who chose the value the engine actually used. */
  source: "model" | "default";
  /** Set when a model proposal was rejected by the validation boundary. */
  rejectedValue?: number | null;
  rejectionReason?: string;
  justification?: string;
}

export interface ResolvedProposal {
  growthY1: ResolvedField<number>;
  fadeYears: ResolvedField<number>;
  terminalGrowth: ResolvedField<number>;
  waccAdjustmentBp: ResolvedField<number>;
  exitMultiple: ResolvedField<number | null>;
  peMultiple: ResolvedField<number | null>;
  evEbitdaMultiple: ResolvedField<number | null>;
  fcfRequiredYield: ResolvedField<number | null>;
  bearGrowthDelta: ResolvedField<number>;
  bullGrowthDelta: ResolvedField<number>;
  /** True when the model call failed entirely and every field is a default. */
  modelUnavailable: boolean;
  promptVersion: string;
}

export const VALUATION_INPUT_PROMPT_VERSION = "vi-2";

/* ── History-derived defaults ───────────────────────────────────────────── */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Defaults derived from delivered history, clamped into the invariant bands.
 * Deliberately conservative: delivered growth is capped at the justification
 * threshold so an NVDA-style 68% delivered CAGR cannot silently compound for
 * a decade (the defect that produced 300x-spot "intrinsic values").
 */
export function defaultProposal(facts: CanonicalFacts): ValuationProposal {
  const delivered = facts.statements?.revenueCagr ?? facts.revenueGrowthYoY?.value ?? 0.05;
  const growthY1 = clamp(delivered, -0.10, BANDS.growthJustifyAbove);
  const terminalGrowth = facts.market === "IN" ? 0.035 : 0.025;
  const fwdPe = facts.forwardPE?.value ?? facts.trailingPE?.value ?? null;
  return {
    growthY1,
    fadeYears: 10,
    terminalGrowth,
    waccAdjustmentBp: 0,
    exitMultiple: null,
    peMultiple: fwdPe != null ? clamp(fwdPe, 5, 50) : null,
    evEbitdaMultiple: facts.evToEbitda?.value != null ? clamp(facts.evToEbitda.value, 3, 40) : null,
    fcfRequiredYield: 0.04,
    bearGrowthDelta: Math.max(0.03, Math.abs(growthY1) * 0.4),
    bullGrowthDelta: Math.max(0.03, Math.abs(growthY1) * 0.4),
    justifications: {
      growth: `Held at delivered history (${fmtPercent(delivered)}) clamped to the defensible band; model proposal unavailable or rejected.`,
    },
  };
}

/* ── Validation boundary ────────────────────────────────────────────────── */

interface FieldRule {
  min: number;
  max: number;
  reason: string;
}

const RULES: Record<string, FieldRule> = {
  growthY1: { min: BANDS.growthMin, max: BANDS.growthMax, reason: "outside explicit growth band" },
  fadeYears: { min: 5, max: 15, reason: "fade period must be 5–15 years" },
  terminalGrowth: { min: BANDS.terminalGrowthMin, max: BANDS.terminalGrowthMax, reason: "outside terminal growth band" },
  waccAdjustmentBp: { min: -300, max: 300, reason: "WACC adjustment capped at ±300bp" },
  exitMultiple: { min: BANDS.exitMultipleMin, max: BANDS.exitMultipleMax, reason: "outside exit multiple band" },
  peMultiple: { min: 2, max: 80, reason: "P/E multiple outside 2–80x" },
  evEbitdaMultiple: { min: 2, max: 50, reason: "EV/EBITDA outside 2–50x" },
  // Above 10% is a distressed-credit yield, not an equity FCF target — a
  // model that proposes it is reaching for the band edge, not reasoning.
  fcfRequiredYield: { min: 0.02, max: 0.10, reason: "required FCF yield outside 2–10%" },
  bearGrowthDelta: { min: 0.01, max: 0.25, reason: "bear delta outside 1–25pp" },
  bullGrowthDelta: { min: 0.01, max: 0.25, reason: "bull delta outside 1–25pp" },
};

function resolveField<T extends number | null>(
  name: string,
  proposed: unknown,
  fallback: T,
  justification: string | undefined,
  nullable: boolean,
): ResolvedField<T> {
  const rule = RULES[name];
  if (proposed == null) {
    return nullable && proposed === null
      ? { value: null as T, source: "model", justification }
      : { value: fallback, source: "default" };
  }
  const num = typeof proposed === "number" ? proposed : Number(proposed);
  if (!Number.isFinite(num)) {
    return { value: fallback, source: "default", rejectedValue: null, rejectionReason: "not a number" };
  }
  if (rule && (num < rule.min || num > rule.max)) {
    return { value: fallback, source: "default", rejectedValue: num, rejectionReason: rule.reason };
  }
  return { value: num as T, source: "model", justification };
}

export function resolveProposal(
  raw: Partial<ValuationProposal> | null,
  defaults: ValuationProposal,
  modelUnavailable: boolean,
): ResolvedProposal {
  const j = raw?.justifications ?? {};
  const r = <T extends number | null>(name: keyof ValuationProposal & string, fallback: T, nullable = false): ResolvedField<T> =>
    resolveField(name, raw?.[name], fallback, j[name] ?? j.growth, nullable);

  const resolved: ResolvedProposal = {
    growthY1: r("growthY1", defaults.growthY1),
    fadeYears: { ...r("fadeYears", defaults.fadeYears), value: Math.round(r("fadeYears", defaults.fadeYears).value) },
    terminalGrowth: r("terminalGrowth", defaults.terminalGrowth),
    waccAdjustmentBp: r("waccAdjustmentBp", defaults.waccAdjustmentBp),
    exitMultiple: r("exitMultiple", defaults.exitMultiple, true),
    peMultiple: r("peMultiple", defaults.peMultiple, true),
    evEbitdaMultiple: r("evEbitdaMultiple", defaults.evEbitdaMultiple, true),
    fcfRequiredYield: r("fcfRequiredYield", defaults.fcfRequiredYield, true),
    bearGrowthDelta: r("bearGrowthDelta", defaults.bearGrowthDelta),
    bullGrowthDelta: r("bullGrowthDelta", defaults.bullGrowthDelta),
    modelUnavailable,
    promptVersion: VALUATION_INPUT_PROMPT_VERSION,
  };

  // Growth above the justification threshold without a justification string is
  // rejected here (the engine would block it anyway; better to fall back).
  if (resolved.growthY1.value > BANDS.growthJustifyAbove && !resolved.growthY1.justification) {
    resolved.growthY1 = {
      value: Math.min(defaults.growthY1, BANDS.growthJustifyAbove),
      source: "default",
      rejectedValue: resolved.growthY1.value,
      rejectionReason: "growth above 25% requires a documented justification",
    };
  }
  return resolved;
}

/* ── LLM proposal call ──────────────────────────────────────────────────── */

function factsForPrompt(facts: CanonicalFacts): string {
  const lines: string[] = [];
  const st = facts.statements;
  if (st) {
    lines.push(`Revenue CAGR (${st.revenueCagrYears ?? "?"}y): ${st.revenueCagr != null ? fmtPercent(st.revenueCagr) : "n/a"}`);
    lines.push(`FCF CAGR (${st.fcfCagrYears ?? "?"}y): ${st.fcfCagr != null ? fmtPercent(st.fcfCagr) : "n/a"}`);
    lines.push(`Operating margin trend: ${st.operatingMargin.map((p) => `FY${p.fy} ${fmtPercent(p.value)}`).join(", ")}`);
  }
  if (facts.revenueGrowthYoY) lines.push(`Revenue growth YoY: ${fmtPercent(facts.revenueGrowthYoY.value)}`);
  if (facts.trailingPE) lines.push(`Trailing P/E: ${fmtMultiple(facts.trailingPE.value)}`);
  if (facts.forwardPE) lines.push(`Forward P/E: ${fmtMultiple(facts.forwardPE.value)}`);
  if (facts.evToEbitda) lines.push(`EV/EBITDA (current): ${fmtMultiple(facts.evToEbitda.value)}`);
  if (facts.screenerIn?.peers?.length) {
    const peerPes = facts.screenerIn.peers
      .map((p) => (p.pe != null ? Number.parseFloat(p.pe) : NaN))
      .filter((x) => Number.isFinite(x));
    if (peerPes.length) lines.push(`Peer P/Es (screener.in): ${peerPes.map((x) => x.toFixed(1)).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Ask the model for valuation inputs. Never asks for, and never accepts, a
 * price target. Returns null when the model is unavailable or unparseable —
 * the caller then uses history-derived defaults and says so.
 */
export async function proposeValuationInputs(
  facts: CanonicalFacts,
  defaults: ValuationProposal,
  model?: string,
): Promise<Partial<ValuationProposal> | null> {
  const prompt = `You are a valuation analyst. Propose DCF and relative-valuation INPUTS for ${facts.companyName} (${facts.symbol}), sector: ${facts.screenerIn?.sector ?? "n/a"}.

You do NOT produce price targets, fair values, or upside figures. You propose input assumptions only; deterministic code computes all values.

EVIDENCE:
${factsForPrompt(facts)}

Anchors (history-derived defaults you may adjust WITH justification):
- stage-1 FCF growth: ${fmtPercent(defaults.growthY1)}
- fade period: ${defaults.fadeYears} years (linear fade to terminal)
- terminal growth: ${fmtPercent(defaults.terminalGrowth)}

Rules:
- growthY1 within ${fmtPercent(BANDS.growthMin)}..${fmtPercent(BANDS.growthMax)}; anything above ${fmtPercent(BANDS.growthJustifyAbove)} MUST carry a justification grounded in the evidence
- terminalGrowth within ${fmtPercent(BANDS.terminalGrowthMin)}..${fmtPercent(BANDS.terminalGrowthMax)}
- multiples must be defensible vs the company's own current multiples and peers shown above
- if the evidence is insufficient for a field, return null for it — do not guess

Reply with ONLY a raw JSON object (no fences, no prose):
{
  "growthY1": number,
  "fadeYears": number,
  "terminalGrowth": number,
  "waccAdjustmentBp": number,
  "exitMultiple": number | null,
  "peMultiple": number | null,
  "evEbitdaMultiple": number | null,
  "fcfRequiredYield": number | null,
  "bearGrowthDelta": number,
  "bullGrowthDelta": number,
  "justifications": { "growthY1": "...", "peMultiple": "...", "terminalGrowth": "..." }
}`;

  try {
    const analysis = await runAnalysis({
      taskType: "scenario-analysis",
      subjectKey: `ic:valuation-inputs:${facts.symbol}`,
      prompt,
      schema: LooseObjectSchema,
      wireSchema: ValuationProposalWireSchema,
      schemaVersion: IC_SCHEMA_VERSION,
      model,
    });
    const bag = analysis.data as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const parsed = {
      growthY1: num(bag.growthY1),
      fadeYears: num(bag.fadeYears),
      terminalGrowth: num(bag.terminalGrowth),
      waccAdjustmentBp: num(bag.waccAdjustmentBp),
      exitMultiple: num(bag.exitMultiple),
      peMultiple: num(bag.peMultiple),
      evEbitdaMultiple: num(bag.evEbitdaMultiple),
      fcfRequiredYield: num(bag.fcfRequiredYield),
      bearGrowthDelta: num(bag.bearGrowthDelta),
      bullGrowthDelta: num(bag.bullGrowthDelta),
      justifications:
        bag.justifications && typeof bag.justifications === "object" && !Array.isArray(bag.justifications)
          ? (bag.justifications as Record<string, string>)
          : ({} as Record<string, string>),
    };
    // A proposal that came back with no growth at all is treated as a failed call.
    if (parsed.growthY1 == null && parsed.peMultiple == null && parsed.evEbitdaMultiple == null) return null;
    return parsed as Partial<ValuationProposal>;
  } catch {
    return null;
  }
}
