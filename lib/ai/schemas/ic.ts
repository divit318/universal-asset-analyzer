/**
 * IC Report wire schemas (schema v1) — the four model calls in the IC
 * pipeline (lib/ic-agents.ts, lib/ic-thesis.ts, lib/ic-synthesis.ts,
 * lib/ic/valuation-inputs.ts), carried as JSON Schema Draft 7 on Devin
 * sessions.
 *
 * Parse tolerance stays in the feature modules (normalizeAgentBag /
 * parseThesisBag / the synthesis sanitizer / resolveProposal's band-clamping)
 * — the parse view everywhere is the shared LooseObjectSchema. Notable wire
 * decisions:
 *
 *   - `dataLimitations` is nullable, not optional-with-min-length: "null or a
 *     sentence" is the prompt's exact contract, and an honest "no gaps" must
 *     not be padded into prose.
 *   - `disagreements` may be EMPTY: the synthesis prompt says "Report none if
 *     there are none; do not invent any" — a min-items would order the model
 *     to fabricate conflict.
 *   - Every valuation-proposal number is nullable: the resolver treats null
 *     as "use the deterministic default", and the validation boundary clamps
 *     everything to bands regardless — the wire constrains shape, not policy.
 */

import { z } from "zod";

export const IC_SCHEMA_VERSION = 1;

export const AgentFindingWireSchema = z.object({
  findings: z
    .string()
    .min(120)
    .describe("2-4 paragraphs of integrated findings for a senior investment committee, citing numbers from DATA"),
  keyInsights: z
    .array(z.string().min(8).describe("Actionable insight grounded in a figure from DATA"))
    .min(3)
    .max(5),
  confidence: z.enum(["high", "medium", "low"]),
  dataLimitations: z.string().nullable().describe("null, or a sentence describing missing data"),
});

export const ThesisWireSchema = z.object({
  bull: z.string().min(40),
  bear: z.string().min(40),
  base: z.string().min(40),
  variantPerception: z.string().min(20),
  marketExpectations: z.string().min(20),
  keyCatalysts: z.array(z.string().min(5)).min(3).max(5),
  keyRisks: z.array(z.string().min(5)).min(3).max(5),
  keyDrivers: z.array(z.string().min(5)).min(3).max(5),
});

export const SynthesisWireSchema = z.object({
  disagreements: z
    .array(
      z.object({
        topic: z.string().min(5).describe("One line naming the disputed question"),
        positions: z
          .array(
            z.object({
              agent: z.string().min(2).describe("Agent label exactly as shown in AGENT FINDINGS"),
              position: z.string().min(5),
            }),
          )
          .min(2),
      }),
    )
    .max(6)
    .describe("EMPTY when the agents genuinely agree - never invent conflict"),
  crossAgentSummary: z.string().min(20),
});

export const ValuationProposalWireSchema = z.object({
  growthY1: z.number().nullable(),
  fadeYears: z.number().nullable(),
  terminalGrowth: z.number().nullable(),
  waccAdjustmentBp: z.number().nullable(),
  exitMultiple: z.number().nullable(),
  peMultiple: z.number().nullable(),
  evEbitdaMultiple: z.number().nullable(),
  fcfRequiredYield: z.number().nullable(),
  bearGrowthDelta: z.number().nullable(),
  bullGrowthDelta: z.number().nullable(),
  justifications: z.record(z.string(), z.string()),
});
