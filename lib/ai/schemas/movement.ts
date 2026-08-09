/**
 * Movement explainer output schema (schema v1) — one shape, two zod views:
 *
 *  - `MovementWireSchema` — the clean, constraint-carrying schema, convertible
 *    to JSON Schema Draft 7 for a structured-output wire format. No
 *    transforms/catches (those are unrepresentable in JSON Schema and would
 *    weaken the platform-side validation).
 *  - `MovementAnalysisSchema` — the tolerant PARSE schema the runtime's
 *    output runs through. It encodes the tolerances the old
 *    hand-rolled parser in lib/movement-explainer.ts had (enum case variants,
 *    evidence arriving as an array, missing fields → defaults).
 */

import { z } from "zod";

export const MOVEMENT_SCHEMA_VERSION = 1;

const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;
const PERSISTENCE = ["transient", "short-term", "durable"] as const;
const CATEGORIES = [
  "earnings", "analyst", "macro", "sector", "valuation",
  "news", "technical", "volume", "sentiment", "other",
] as const;

/* ------------------------------- wire view ------------------------------- */

export const MovementWireSchema = z.object({
  summary: z.string().min(20).describe("2-3 sentence plain-English explanation of the movement"),
  drivers: z
    .array(
      z.object({
        category: z.enum(CATEGORIES).describe("The kind of driver"),
        description: z.string().min(1).describe("What happened, one sentence"),
        evidence: z
          .string()
          .min(1)
          .describe("The specific fact from the EVIDENCE section that supports this driver — quote it, do not invent"),
        direction: z.enum(DIRECTIONS),
      }),
    )
    .min(1)
    .max(4)
    .describe("Most important driver first"),
  confidence: z.number().int().min(0).max(100)
    .describe("How well the evidence explains the move; lower it if evidence is thin"),
  persistence: z.enum(PERSISTENCE),
});

/* ------------------------------ parse view ------------------------------- */

const direction = z.preprocess(
  (v) => (typeof v === "string" ? v.toLowerCase() : v),
  z.enum(DIRECTIONS).catch("neutral"),
);

const persistence = z.preprocess(
  (v) => (typeof v === "string" ? v.toLowerCase() : v),
  z.enum(PERSISTENCE).catch("transient"),
);

const category = z.preprocess(
  (v) => (typeof v === "string" ? v.toLowerCase() : v),
  z.enum(CATEGORIES).catch("other"),
);

/** Models occasionally return an array of evidence snippets — join, don't reject. */
const evidence = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join("; ") : v),
  z.string().catch(""),
);

export const MovementAnalysisSchema = z.object({
  summary: z.string().min(1),
  drivers: z
    .array(z.object({ category, description: z.string().catch(""), evidence, direction }))
    .catch([]),
  confidence: z.coerce
    .number()
    .catch(0)
    .transform((n) => Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0))),
  persistence,
});

export type MovementAnalysis = z.infer<typeof MovementAnalysisSchema>;
