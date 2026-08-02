/**
 * Free-text analysis output (schema v1) — the shape for migrated call sites
 * whose product is prose (financial insight, calendar brief, audit memo…).
 * One field so both providers share a seam: Ollama's raw answer is wrapped
 * as { text }; Devin provides { text } via structured output.
 */

import { z } from "zod";

export const TEXT_SCHEMA_VERSION = 1;

export const TextWireSchema = z.object({
  text: z
    .string()
    .min(40)
    .describe("The complete requested prose answer — plain text, no markdown fences, no preamble"),
});

export const TextAnalysisSchema = z.object({
  text: z.string().min(1),
});

export type TextAnalysis = z.infer<typeof TextAnalysisSchema>;
