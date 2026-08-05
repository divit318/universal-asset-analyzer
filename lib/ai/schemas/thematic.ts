/**
 * Thematic engine wire schemas (schema v1) — one per model stage of the
 * 10-stage framework (lib/thematic-engine.ts), carried as JSON Schema Draft 7
 * on Devin sessions.
 *
 * Two stages answer ARRAYS in the prompt contract (dependency chain, tier
 * mapping). The sessions API's `structured_output` is an object, so their
 * wire schemas wrap the array in a single-key object ({nodes}/{mappings});
 * the engine's list extraction accepts both the bare array (token stack,
 * whose prompts are unchanged) and the wrapped form (sessions). Everything
 * else keeps the engine's own coercions (coerceScore10/coerceTier/coerceEnum
 * and the per-item sanitizers) as the parse layer — including the "string
 * null" lesson: `estimatedCapitalUSD` is nullable on the wire, and the
 * engine's coerceOptionalText still catches models that spell absence "null".
 */

import { z } from "zod";

export const THEMATIC_SCHEMA_VERSION = 1;

const score10 = z.number().min(0).max(10).describe("Integer 0-10; never a 0-100 scale");

export const FutureStateWireSchema = z.object({
  inevitabilityScore: score10,
  timeHorizon: z.string().min(2).describe('e.g. "3-7 years"'),
  drivingForces: z.array(z.string().min(3)).min(2).max(4),
  rationale: z.string().min(20).describe("2-3 sentences on why this score"),
});

const DependencyNodeWire = z.object({
  tier: z.number().int().min(1).max(6),
  tierLabel: z.string().min(2),
  description: z.string().min(10),
  exampleCompanies: z.array(z.string().min(1)).min(1).max(4),
  isBottleneck: z.boolean(),
});

export const DependencyChainWireSchema = z.object({
  nodes: z.array(DependencyNodeWire).min(6).max(6).describe("Exactly one node per tier, tiers 1-6"),
});

export const BottleneckWireSchema = z.object({
  score: score10,
  bottleneckTier: z.number().int().min(1).max(6),
  bottleneckDescription: z.string().min(20),
  scarceFactors: z.array(z.string().min(3)).min(2).max(4),
  substituteRisk: z.enum(["low", "medium", "high"]),
  substituteRationale: z.string().min(10),
  expansionDifficulty: z.string().min(20).describe("Specific to THIS theme; never reuse example wording"),
});

export const SupplyDemandWireSchema = z.object({
  score: score10,
  demandTrajectory: z.enum(["accelerating", "growing", "stable", "declining"]),
  supplyTrajectory: z.enum(["constrained", "tight", "balanced", "oversupplied"]),
  capitalCyclePhase: z.enum(["early", "mid", "late", "downturn"]),
  demandDrivers: z.array(z.string().min(3)).min(2).max(4),
  supplyConstraints: z.array(z.string().min(3)).min(2).max(4),
  investmentSignal: z.enum(["strong", "moderate", "weak", "avoid"]),
});

export const CommodityFrameworkWireSchema = z.object({
  score: score10,
  primaryCommodities: z.array(z.string().min(2)).min(1).max(4),
  demandCatalysts: z.array(z.string().min(3)).min(2).max(4),
  supplyRisks: z.array(z.string().min(3)).min(2).max(4),
  substitutionRisk: z.enum(["low", "medium", "high"]),
  recyclingEconomics: z.string().min(10),
  reserveConcentration: z.string().min(10),
});

export const PolicyWireSchema = z.object({
  score: score10,
  relevantPolicies: z
    .array(
      z.object({
        country: z.string().min(2),
        policy: z.string().min(5).describe("Specific policy name or description"),
        impact: z.enum(["highly positive", "positive", "neutral", "negative"]),
        estimatedCapitalUSD: z
          .string()
          .nullable()
          .describe('Headline capital committed, e.g. "$370B"; null when not quantified'),
      }),
    )
    .min(2)
    .max(6),
  capitalFlowDirection: z.string().min(10),
  geopoliticalFactors: z.array(z.string().min(3)).min(1).max(4),
  indiaSpecificPolicies: z.array(z.string().min(3)).max(5),
});

export const StructuralAdvantageWireSchema = z.object({
  score: score10,
  currentLeader: z.string().min(2),
  fastestImproving: z.string().min(2),
  regions: z
    .array(
      z.object({
        region: z.string().min(2),
        advantages: z.array(z.string().min(3)).min(1).max(4),
        disadvantages: z.array(z.string().min(3)).min(1).max(4),
      }),
    )
    .min(3)
    .max(6)
    .describe("Only regions genuinely relevant to this theme, ranked by relevance"),
  longTermImplications: z.string().min(40).describe("3-5 sentence synthesis"),
});

export const TierMappingWireSchema = z.object({
  mappings: z
    .array(
      z.object({
        symbol: z.string().min(1).describe("Exactly as listed in COMPANIES"),
        tier: z.number().int().min(1).max(6),
        strategicImportance: z.enum(["critical", "high", "medium", "low"]),
        moatType: z.enum(["cost", "scale", "technology", "distribution", "regulation", "none"]),
        relevanceRationale: z.string().min(3).describe("One short clause, max 15 words"),
      }),
    )
    .min(1)
    .max(18),
});
