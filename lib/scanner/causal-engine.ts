/**
 * Scanner v2 — causal reasoning engine.
 *
 * For macro and policy events, derives first-order and second-order effects.
 * Example:
 *   Fed cuts rates
 *   → 1st order: lower financing costs, NIM compression for banks
 *   → 2nd order: homebuilders benefit, REITs re-rate upward, utilities become less attractive
 *
 * Runs one Ollama call per macro/policy event (parallel, up to 4 concurrent).
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type { MarketEvent, CausalEffect, SignalDirection } from "../types";

interface RawEffect {
  order: 1 | 2;
  description: string;
  direction: SignalDirection;
  affectedSectors: string[];
  affectedTickers: string[];
}

interface CausalResponse {
  effects: RawEffect[];
}

function buildCausalPrompt(event: MarketEvent): string {
  return `You are an institutional equity research analyst specializing in macro causality.

EVENT: ${event.headline}
CONTEXT: ${event.summary}

Map the investment cause-and-effect chain for this event.

First-order effects: direct, immediate consequences (what happens within days/weeks).
Second-order effects: downstream ripple effects (what happens over weeks/months as markets adjust).

Think like a seasoned sell-side analyst:
- Which sectors/industries benefit? Why?
- Which sectors/industries lose? Why?
- Which specific types of companies are most exposed?
- Are there non-obvious second-order effects?

Return ONLY valid JSON:
{
  "effects": [
    {
      "order": 1,
      "description": "Lower borrowing costs reduce corporate debt servicing expense",
      "direction": "bullish",
      "affectedSectors": ["Technology", "Real Estate"],
      "affectedTickers": []
    },
    {
      "order": 1,
      "description": "Net interest margin compression for banks as deposit rates stay elevated",
      "direction": "bearish",
      "affectedSectors": ["Banking", "Financials"],
      "affectedTickers": ["HDFCBANK", "ICICIBANK"]
    },
    {
      "order": 2,
      "description": "Housing affordability improves; homebuilders and building materials benefit",
      "direction": "bullish",
      "affectedSectors": ["Real Estate", "Materials"],
      "affectedTickers": []
    }
  ]
}

Include 2-4 first-order effects and 2-3 second-order effects. Be specific — generic statements are not useful.`;
}

const MAX_CONCURRENT = 4;

async function buildCausalChainForEvent(
  event: MarketEvent,
): Promise<CausalEffect[]> {
  try {
    const raw = await runPrompt("opportunity-engine", buildCausalPrompt(event), {
      maxTokens: 1200,
      json: true,
    });
    const parsed = extractJson<CausalResponse>(raw);
    if (!parsed?.effects?.length) return [];
    return parsed.effects.map((e) => ({
      order: e.order,
      description: e.description,
      direction: e.direction,
      affectedSectors: e.affectedSectors ?? [],
      affectedTickers: e.affectedTickers ?? [],
    }));
  } catch {
    return [];
  }
}

/**
 * Enrich macro and policy events with first/second-order causal chains.
 * Other event categories are returned unchanged.
 */
export async function buildCausalChains(
  events: MarketEvent[],
): Promise<MarketEvent[]> {
  const macroEvents = events.filter(
    (e) => e.category === "macro" || e.category === "policy" || e.category === "geopolitics",
  );
  if (macroEvents.length === 0) return events;

  // Process in batches to limit concurrent Ollama calls
  const enriched: MarketEvent[] = [];
  for (let i = 0; i < macroEvents.length; i += MAX_CONCURRENT) {
    const batch = macroEvents.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        const chain = await buildCausalChainForEvent(event);
        return { ...event, causalChain: chain };
      }),
    );
    for (const r of results) {
      enriched.push(
        r.status === "fulfilled" ? r.value : macroEvents[i + enriched.length],
      );
    }
  }

  // Rebuild in original order
  const enrichedMap = new Map(enriched.map((e) => [e.id, e]));
  return events.map((e) => enrichedMap.get(e.id) ?? e);
}
