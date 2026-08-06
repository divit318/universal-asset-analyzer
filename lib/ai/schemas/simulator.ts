/**
 * Portfolio Simulator wire schemas (schema v1) — the two structured stages of
 * lib/portfolio/simulator/generate.ts, carried as JSON Schema Draft 7 on
 * Devin sessions.
 *
 * Both stages keep their deterministic guards downstream
 * (`normalizeAllocation` clamps/renormalizes and enforces the allowed-class
 * mandate; `parseSelectionResponse` validates symbols against the candidate
 * menu and renormalizes weights per class), so the wire schemas constrain
 * SHAPE, not policy: an allocation whose numbers don't sum to 100 is the
 * normalizer's job to fix, not a reason to reject a session.
 */

import { z } from "zod";

export const SIMULATOR_SCHEMA_VERSION = 1;

/** Stage 1: {"allocation": {"etf": 40, ...}, "strategy": "..."} */
export const AllocationWireSchema = z.object({
  allocation: z
    .record(z.string(), z.number().min(0).max(100))
    .describe("Asset-class label -> target percent. Use ONLY the classes offered in the prompt."),
  strategy: z.string().min(10).describe("One sentence describing the design"),
});

/** Stage 2: {"picks": [{symbol, assetClass, name, weightPct, why}]} */
export const SelectionWireSchema = z.object({
  picks: z
    .array(
      z.object({
        symbol: z.string().min(1).describe("Exactly as listed in the candidate menu"),
        assetClass: z.string().min(1),
        name: z.string(),
        weightPct: z.number().min(0).max(100),
        // min 1, not 5: a terse "core" is a legal rationale downstream (the
        // parser truncates at 200 chars and tolerates empty), and the parity
        // run caught a legitimate short answer tripping a stricter bound.
        why: z.string().min(1),
      }),
    )
    .min(1)
    .max(25),
});

export type AllocationWire = z.infer<typeof AllocationWireSchema>;
export type SelectionWire = z.infer<typeof SelectionWireSchema>;
