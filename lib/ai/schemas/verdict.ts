/**
 * Investment Verdict schema (schema v2) — one shape, two zod views, following
 * the movement-schema convention (lib/ai/schemas/movement.ts):
 *
 *  - `VerdictWireSchema` — clean, constraint-carrying; converted to JSON
 *    Schema Draft 7 for Devin's structured_output_schema. Mirrors the
 *    SCHEMA_BLOCK prompt contract in lib/ai/verdict.ts (same keys, same enums,
 *    same emission order — headline first, verdict last, which is also the
 *    streaming order the report route depends on).
 *  - `VerdictParseSchema` — deliberately a PASS-THROUGH record, not a tolerant
 *    re-implementation of the field coercions. Verdict defaulting is
 *    plan-dependent (`coerceFields` fills gaps from `defaultFields(plan)` —
 *    e.g. the fallback verdict derives from the composite score), so a schema
 *    cannot own it without duplicating logic that must stay in ONE place
 *    (lib/ai/verdict.ts). Both providers' outputs flow bag → coerceFields,
 *    exactly as the pre-migration parser did.
 *
 * v1 of this module was the Phase 4 spike's BUY/HOLD/SELL shape; that schema
 * now lives inside scripts/devin-spike-v1compat.ts, and this version bump is
 * why SCHEMA_VERSION is 2 — cache rows keyed v1 must not satisfy v2 readers.
 */

import { z } from "zod";

export const VERDICT_SCHEMA_VERSION = 2;

/* ------------------------------- wire view ------------------------------- */

export const VerdictWireSchema = z.object({
  headline: z
    .string()
    .min(8)
    .max(220)
    .describe("Decisive 10-14 word investment thesis naming the subject and the core reason"),
  thesis: z
    .string()
    .min(40)
    .describe("2-3 sentences: the investment case with specific metrics cited from the dossier"),
  catalysts: z
    .array(z.string().min(4).describe("Specific reason citing a number or fact from the dossier"))
    .min(2)
    .max(5),
  risks: z
    .array(z.string().min(4).describe("Specific risk citing a number or fact from the dossier"))
    .min(2)
    .max(5),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Lower it when the dossier's evidence is thin — honesty beats bravado"),
  timeHorizon: z.enum(["short-term", "medium-term", "long-term"]),
  keyMetrics: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1).describe("Formatted value, exactly as it appears in the dossier"),
        signal: z.enum(["positive", "negative", "neutral"]),
      }),
    )
    .min(3)
    .max(8),
  verdict: z.enum(["bullish", "bearish", "neutral"]),
});

export type VerdictWire = z.infer<typeof VerdictWireSchema>;

/* ------------------------------ parse view ------------------------------- */

/**
 * The loose field bag `assembleVerdict` → `coerceFields` narrows. Accepting
 * any object (including `{}`) is load-bearing for Ollama-path equivalence:
 * the pre-migration parser (`parseVerdictFields`) returned `{}` on missing
 * fields and let coerceFields default them per plan.
 */
export const VerdictParseSchema = z.record(z.string(), z.unknown());

export type VerdictFieldBag = z.infer<typeof VerdictParseSchema>;
