/**
 * Scanner wire schemas (schema v1) — the six pipeline stages
 * (lib/scanner/{classifier,causal-engine,sector-impact,company-impact,dedup,
 * thesis-builder}.ts) plus the v1 event screener, carried as JSON Schema
 * Draft 7 on Devin sessions.
 *
 * The tranche-5 lesson applied throughout: the wire constrains SHAPE, not
 * policy. Category vocabularies, strength clamps, index bounds, and
 * time-horizon coercions all live in the stages' sanitizers, which already
 * tolerate everything a model has ever actually emitted — a wire enum here
 * would make sessions the only transport forbidden from quirks the app
 * handles fine. Enums appear only where the sanitizer's fallback would
 * silently flip meaning (direction).
 */

import { z } from "zod";

export const SCANNER_SCHEMA_VERSION = 1;

const direction3 = z.enum(["bullish", "bearish", "neutral"]);
const confidence100 = z.number().min(0).max(100);

export const ClassificationsWireSchema = z.object({
  classifications: z
    .array(
      z.object({
        id: z.string().min(1).describe("The event id EXACTLY as given — never invent or renumber"),
        category: z.string().min(2),
        affectedSectors: z.array(z.string()).max(6),
        affectedThemes: z.array(z.string()).max(6),
        affectedTickers: z.array(z.string()).max(10),
      }),
    )
    .min(1),
});

export const CausalEffectsWireSchema = z.object({
  effects: z
    .array(
      z.object({
        order: z.number().int().min(1).max(2).describe("1 = first-order effect, 2 = second-order"),
        description: z.string().min(10),
        direction: direction3,
        affectedSectors: z.array(z.string()).max(6),
        affectedTickers: z.array(z.string()).max(10),
      }),
    )
    .min(1)
    .max(6),
});

export const SectorImpactsWireSchema = z.object({
  sectorImpacts: z
    .array(
      z.object({
        sector: z.string().min(2),
        direction: direction3,
        strength: z.number().describe("Impact strength; the engine clamps the scale"),
        rationale: z.string().min(10),
        keyBeneficiaries: z.array(z.string()).max(6),
        keyLosers: z.array(z.string()).max(6),
      }),
    )
    .min(1),
});

export const CompanyMatchesWireSchema = z.object({
  // May legitimately be EMPTY: a sector event with no listed candidates that
  // plausibly fit is an honest answer, not a validation failure.
  matches: z
    .array(
      z.object({
        symbol: z.string().min(1).describe("Exactly as listed in the candidates"),
        direction: z.enum(["bullish", "bearish"]),
        rationale: z.string().min(10),
        timeframe: z.enum(["short", "medium", "long"]),
        confidence: confidence100,
      }),
    )
    .max(12),
});

export const ClustersWireSchema = z.object({
  clusters: z
    .array(
      z.object({
        index: z.number().int().min(0).describe("The headline's index EXACTLY as listed"),
        clusterId: z.string().min(1),
        category: z.string().min(2),
        masterHeadline: z.string().min(10),
        summary: z.string(),
      }),
    )
    .min(1),
});

export const ScannerThesisWireSchema = z.object({
  headline: z.string().min(10),
  summary: z.string().min(30),
  bullCase: z.array(z.string().min(5)).min(2).max(4),
  bearCase: z.array(z.string().min(5)).min(2).max(4),
  keyCatalysts: z.array(z.string().min(5)).max(5),
  keyRisks: z.array(z.string().min(5)).max(5),
  timeHorizon: z.string().min(3).describe("days | weeks | months | quarters — the engine coerces"),
  confidence: confidence100,
  potentialWinners: z.array(z.string()).max(8),
  potentialLosers: z.array(z.string()).max(8),
});

export const EmergingThemesWireSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(3),
        description: z.string().min(10),
        momentum: confidence100,
        topTickers: z.array(z.string()).max(6),
      }),
    )
    .max(6),
});

export const RiskAlertsWireSchema = z.object({
  alerts: z
    .array(
      z.object({
        headline: z.string().min(5).describe("The risk in ~8 words"),
        severity: z.enum(["high", "medium", "low"]),
        affectedSectors: z.array(z.string()).max(6),
        affectedTickers: z.array(z.string()).max(10),
        rationale: z.string().min(10),
      }),
    )
    .max(5),
});

/** v1 event screener (lib/event-screener.ts). */
export const EventScanWireSchema = z.object({
  themes: z.array(z.string().min(2)).max(8),
  signals: z
    .array(
      z.object({
        ticker: z.string().min(1),
        name: z.string().min(1),
        direction: direction3,
        confidence: confidence100,
        theme: z.string(),
        rationale: z.string().min(10),
        timeframe: z.enum(["short", "medium", "long"]),
        isIndian: z.boolean(),
      }),
    )
    .max(15),
  summary: z.string().min(20),
});
