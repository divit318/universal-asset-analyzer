/**
 * Scanner v2 — causal reasoning engine.
 *
 * For macro and policy events, derives first-order and second-order effects.
 * Example:
 *   Fed cuts rates
 *   → 1st order: lower financing costs, NIM compression for banks
 *   → 2nd order: homebuilders benefit, REITs re-rate upward, utilities become less attractive
 *
 * Runs one Ollama call per macro/policy event, sequentially — Ollama's
 * default local setup serves one request at a time regardless of how many
 * are fired, so dispatching them concurrently doesn't parallelize anything;
 * it only queues them behind each other while each one's own timeout keeps
 * counting down. Sequential dispatch makes each call's timeout budget
 * meaningful and gives steady progress instead of a burst of failures.
 */

import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import { extractJsonObject } from "../json-extract";
import type { MarketEvent, CausalEffect, SignalDirection } from "../types";

import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
function sanitizeEffect(item: unknown): CausalEffect | null {
  if (item === null || typeof item !== "object") return null;
  const e = item as Record<string, unknown>;
  if (typeof e.description !== "string") return null;
  const order = Number(e.order);
  const direction = typeof e.direction === "string" ? e.direction.toLowerCase() : "";
  return {
    order: order === 2 ? 2 : 1,
    description: e.description,
    direction: (["bullish", "bearish", "neutral"] as string[]).includes(direction)
      ? (direction as SignalDirection)
      : "neutral",
    affectedSectors: Array.isArray(e.affectedSectors)
      ? e.affectedSectors.filter((x): x is string => typeof x === "string")
      : [],
    affectedTickers: Array.isArray(e.affectedTickers)
      ? e.affectedTickers.filter((x): x is string => typeof x === "string")
      : [],
  };
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

${JSON_SCHEMA_LEAD_IN}
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

async function buildCausalChainForEvent(
  event: MarketEvent,
  run?: ScanRunContext,
): Promise<CausalEffect[]> {
  try {
    const raw = await scannerPrompt(run, "opportunity-engine", buildCausalPrompt(event), {
      maxTokens: 1200,
    });
    const parsed = extractJsonObject(raw, { effects: [] as unknown[] });
    return parsed.effects.map(sanitizeEffect).filter((e): e is CausalEffect => e !== null);
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    run?.degrade?.(`causal chain skipped for "${event.headline.slice(0, 60)}": ${describeError(err)}`);
    return [];
  }
}

/**
 * Enrich macro and policy events with first/second-order causal chains.
 * Other event categories are returned unchanged.
 */
export async function buildCausalChains(
  events: MarketEvent[],
  run?: ScanRunContext,
): Promise<MarketEvent[]> {
  const macroEvents = events.filter(
    (e) => e.category === "macro" || e.category === "policy" || e.category === "geopolitics",
  );
  if (macroEvents.length === 0) return events;

  run?.setUnits?.(macroEvents.length);
  const enrichedMap = new Map<string, MarketEvent>();
  for (let i = 0; i < macroEvents.length; i++) {
    const event = macroEvents[i];
    run?.item?.(`${event.headline.slice(0, 60)} (${i + 1} of ${macroEvents.length})`);
    const chain = await buildCausalChainForEvent(event, run);
    enrichedMap.set(event.id, { ...event, causalChain: chain });
    run?.tick?.();
  }

  // Rebuild in original order
  return events.map((e) => enrichedMap.get(e.id) ?? e);
}
