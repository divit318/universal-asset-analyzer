/**
 * Scanner v2 — event classification.
 *
 * Takes deduplicated MarketEvents and enriches them with:
 * - Confirmed SignalCategory
 * - Affected sectors (standardized names)
 * - Affected themes (e.g. "AI Infrastructure", "Rate Cycle")
 * - Affected tickers (NSE/NYSE format)
 *
 * Runs a single batch AI call for efficiency.
 */

import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import { extractJsonObject } from "../json-extract";
import { ClassificationsWireSchema } from "../ai/schemas/scanner";
import type { MarketEvent, SignalCategory } from "../types";

import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
const SIGNAL_CATEGORIES: SignalCategory[] = [
  "macro", "company", "market", "commodity", "geopolitics", "policy", "sentiment",
];

const KNOWN_SECTORS = [
  "Technology",
  "Financials",
  "Healthcare",
  "Energy",
  "Industrials",
  "Consumer Cyclical",
  "Consumer Staples",
  "Utilities",
  "Real Estate",
  "Materials",
  "Communication Services",
  // India-specific
  "Banking",
  "Pharma",
  "IT Services",
  "Auto",
  "FMCG",
  "Infrastructure",
  "Power",
  "Metals",
  "Telecom",
];

interface ClassificationResult {
  id: string; // matches MarketEvent.id
  category: SignalCategory;
  affectedSectors: string[];
  affectedThemes: string[];
  affectedTickers: string[];
}

function sanitizeClassification(item: unknown): ClassificationResult | null {
  if (item === null || typeof item !== "object") return null;
  const c = item as Record<string, unknown>;
  if (typeof c.id !== "string") return null;
  const category = typeof c.category === "string" ? c.category.toLowerCase() : "";
  return {
    id: c.id,
    category: (SIGNAL_CATEGORIES as string[]).includes(category)
      ? (category as SignalCategory)
      : "company",
    affectedSectors: Array.isArray(c.affectedSectors)
      ? c.affectedSectors.filter((x): x is string => typeof x === "string")
      : [],
    affectedThemes: Array.isArray(c.affectedThemes)
      ? c.affectedThemes.filter((x): x is string => typeof x === "string")
      : [],
    affectedTickers: Array.isArray(c.affectedTickers)
      ? c.affectedTickers.filter((x): x is string => typeof x === "string")
      : [],
  };
}

function buildClassificationPrompt(events: MarketEvent[]): string {
  const items = events
    .map(
      (e, i) =>
        `${i}. [id:${e.id}] ${e.headline}\n   Summary: ${e.summary}`,
    )
    .join("\n\n");

  return `You are a financial analyst classifying market events for an investment intelligence platform.

EVENTS TO CLASSIFY:
${items}

For each event, provide:
1. category: one of macro | company | market | commodity | geopolitics | policy | sentiment
2. affectedSectors: list from [${KNOWN_SECTORS.join(", ")}] — max 4
3. affectedThemes: short investment themes active here (e.g. "AI Infrastructure", "Rate Cycle", "China Reopening") — max 3
4. affectedTickers: specific stock tickers mentioned or strongly implied — NSE format for Indian stocks (e.g. HDFCBANK not HDFCBANK.NS), NYSE/NASDAQ for US — max 5

${JSON_SCHEMA_LEAD_IN}
{
  "classifications": [
    {
      "id": "<event id>",
      "category": "macro",
      "affectedSectors": ["Banking", "Financials"],
      "affectedThemes": ["Rate Cycle", "Credit Expansion"],
      "affectedTickers": ["HDFCBANK", "ICICIBANK"]
    }
  ]
}`;
}

/** Enrich a batch of MarketEvents with classification data. */
export async function classifyEvents(
  events: MarketEvent[],
  run?: ScanRunContext,
): Promise<MarketEvent[]> {
  if (events.length === 0) return events;

  let parsed: { classifications: unknown[] };
  try {
    const raw = await scannerPrompt(run, "opportunity-engine", buildClassificationPrompt(events), {
      maxTokens: 3000,
      wire: ClassificationsWireSchema,
      stage: "classify",
    });
    parsed = extractJsonObject(raw, { classifications: [] as unknown[] });
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    // Return events unmodified if classification fails
    run?.degrade?.(`event classification skipped: ${describeError(err)}`);
    return events;
  }

  if (!parsed.classifications.length) return events;

  const classifications = parsed.classifications
    .map(sanitizeClassification)
    .filter((c): c is ClassificationResult => c !== null);
  if (classifications.length === 0) return events;

  const classMap = new Map<string, ClassificationResult>(
    classifications.map((c) => [c.id, c]),
  );

  return events.map((event) => {
    const cls = classMap.get(event.id);
    if (!cls) return event;
    return {
      ...event,
      category: cls.category,
      affectedSectors: cls.affectedSectors,
      affectedThemes: cls.affectedThemes,
      affectedTickers: [
        ...new Set([...event.affectedTickers, ...cls.affectedTickers]),
      ],
    };
  });
}
