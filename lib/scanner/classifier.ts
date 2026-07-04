/**
 * Scanner v2 — event classification.
 *
 * Takes deduplicated MarketEvents and enriches them with:
 * - Confirmed SignalCategory
 * - Affected sectors (standardized names)
 * - Affected themes (e.g. "AI Infrastructure", "Rate Cycle")
 * - Affected tickers (NSE/NYSE format)
 *
 * Runs a single batch Ollama call for efficiency.
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type { MarketEvent, SignalCategory } from "../types";

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

interface BatchClassificationResponse {
  classifications: ClassificationResult[];
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

Return ONLY valid JSON:
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
): Promise<MarketEvent[]> {
  if (events.length === 0) return events;

  let parsed: BatchClassificationResponse | null = null;
  try {
    const raw = await runPrompt(buildClassificationPrompt(events), {
      maxTokens: 3000,
      json: true,
    });
    parsed = extractJson<BatchClassificationResponse>(raw);
  } catch {
    // Return events unmodified if classification fails
    return events;
  }

  if (!parsed?.classifications?.length) return events;

  const classMap = new Map<string, ClassificationResult>(
    parsed.classifications.map((c) => [c.id, c]),
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
