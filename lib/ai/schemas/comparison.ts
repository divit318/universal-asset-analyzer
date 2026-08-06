/**
 * Comparison wire schemas (schema v1) — the shapes the two compare prompt
 * contracts ask for (lib/ai-compare.ts equity block, lib/compare/
 * class-ai-compare.ts class block), carried as JSON Schema Draft 7 on Devin
 * sessions.
 *
 * Parse-side coercion stays where it always lived — normalizeRankings /
 * sanitizeKeyQuestions / finalizeComparison's `?? ""` defaults — so the parse
 * view is the shared LooseObjectSchema (see lib/ai/schemas/loose.ts). Two
 * details preserved deliberately from the local-model era:
 *
 *   - `noClearWinner` accepts boolean OR the strings "true"/"false" on the
 *     wire (the coercion downstream is lenient for a reason; a stricter wire
 *     would make Devin the only provider forbidden from a quirk the app
 *     already tolerates — pointless friction with zero consumer benefit).
 *   - Ranking symbols are NOT enum-constrained here even though the prompt
 *     names the valid set: `normalizeRankings` back-fills any missing or
 *     mis-shaped symbol from composite-score order, and a wire rejection for
 *     one bad symbol would cost the whole (otherwise fine) comparison.
 */

import { z } from "zod";

export const COMPARISON_SCHEMA_VERSION = 1;

const flexibleBool = z.union([z.boolean(), z.enum(["true", "false"])]);

const RankingWire = z.object({
  rank: z.number().int().min(1),
  symbol: z.string().min(1).describe("One of the compared symbols, exactly as given"),
  thesis: z.string().min(10).describe("1-2 sentences: the case for this pick specifically"),
  // Max 6, not the prompt's illustrative "a few": the parity run showed the
  // models legitimately produce 5-6 evidence-rich bullets for a mega-cap, and
  // a wire cap below observed behavior converts richness into corrective
  // turns (or worse, trimming). Production parse never capped these at all.
  strengths: z.array(z.string().min(3).describe("Short phrase citing a number")).min(1).max(6),
  weaknesses: z.array(z.string().min(3).describe("Short phrase citing a number")).min(1).max(6),
  bestFor: z.string().min(5).describe("The type of investor this pick suits best"),
});

const verdictTail = {
  rankings: z.array(RankingWire).min(2).max(5).describe("One entry per compared asset, best first"),
  noClearWinner: flexibleBool.describe(
    "true when the field is genuinely close and the ranking should not be read as decisive",
  ),
  tradeoffSummary: z.string().min(20),
  executiveSummary: z.string().min(20).describe("For someone who will only read this one paragraph"),
  conditionsForChange: z.string().min(10),
  confidenceScore: z.number().min(0).max(100),
};

/** The equity Compare page's ten-section narrative + ranked verdict. */
export const EquityComparisonWireSchema = z.object({
  overview: z.string().min(20),
  valuation: z.string().min(20).describe("Cite P/E, PEG, P/B, analyst upside specifically"),
  quality: z.string().min(20).describe("Cite ROE, margins, earnings growth"),
  growth: z.string().min(20),
  financialHealth: z.string().min(20).describe("Cite D/E, current ratio, FCF"),
  momentum: z.string().min(20),
  capitalAllocation: z.string().min(20),
  competitivePositioning: z.string().min(20),
  riskComparison: z.string().min(20),
  verdict: z.string().min(20).describe("One paragraph tying the sections together"),
  ...verdictTail,
});

/** The non-equity class framework: per-class key questions + the same verdict tail. */
export const ClassComparisonWireSchema = z.object({
  keyQuestions: z
    .array(
      z.object({
        label: z.string().min(1).describe("Repeat the question label exactly as given in the prompt"),
        answer: z.string().min(10),
      }),
    )
    .min(1)
    .max(8),
  ...verdictTail,
});

export type EquityComparisonWire = z.infer<typeof EquityComparisonWireSchema>;
export type ClassComparisonWire = z.infer<typeof ClassComparisonWireSchema>;
