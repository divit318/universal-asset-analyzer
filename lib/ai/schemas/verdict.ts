/**
 * Investment Verdict — the first Zod-defined analysis schema.
 *
 * Single source of truth for the shape a Devin sessions-API verdict must
 * satisfy: the Zod object validates at runtime (client-side, belt over the
 * API's server-side braces) and compiles to the Draft-7 JSON Schema the
 * sessions API requires via `z.toJSONSchema(…, { target: "draft-7" })`.
 *
 * Deliberately mirrors lib/ai/verdict.ts's InvestmentVerdict fields that the
 * UI renders, WITHOUT replacing that interface yet — the CLI/Ollama paths keep
 * their existing extractJsonObject defaults until Phase 5 migrates them. Keep
 * the two in sync; the golden harness diffs them field by field.
 *
 * SCHEMA_VERSION participates in every cache/idempotency key: bump it on ANY
 * shape change, or cached rows validated against the old shape would be served
 * as if they matched the new one.
 */

import { z } from "zod";

export const VERDICT_SCHEMA_VERSION = 1;

export const VerdictSchema = z.object({
  verdict: z.enum(["BUY", "HOLD", "SELL"]),
  confidence: z.number().min(0).max(100).describe("0-100, calibrated, not performative"),
  headline: z.string().min(10).max(200).describe("One-line thesis, numbers-first"),
  thesis: z
    .string()
    .min(50)
    .max(1200)
    .describe("2-4 sentences. Institutional buy-side memo style. Only supplied data."),
  catalysts: z.array(z.string().min(5)).min(2).max(5),
  risks: z.array(z.string().min(5)).min(2).max(5),
  timeHorizon: z.enum(["short-term", "medium-term", "long-term"]),
  caveats: z
    .array(z.string())
    .describe("Anything the supplied data could not support. Empty array if none. Never invent."),
});

export type Verdict = z.infer<typeof VerdictSchema>;

/** Draft-7 JSON Schema for `structured_output_schema`. Self-contained, no $ref. */
export function verdictJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(VerdictSchema, { target: "draft-7" }) as Record<string, unknown>;
}
