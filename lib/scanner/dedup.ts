/**
 * Scanner v2 — semantic story deduplication.
 *
 * Takes raw NewsItems from all sources and clusters them into MarketEvents.
 * A MarketEvent represents one real-world happening, regardless of how many
 * outlets covered it.
 *
 * Algorithm:
 *   1. Ask the AI to group headlines by topic (one batch call).
 *   2. Build a MarketEvent per cluster with all source URLs preserved.
 *   3. Falls back to simple headline-prefix dedup if AI is unavailable.
 */

import { extractJsonObject } from "../json-extract";
import { ClustersWireSchema } from "../ai/schemas/scanner";
import { describeError, scannerPrompt, type ScanRunContext } from "./llm";
import { storyIdFor } from "../story-id";
import type { NewsItem, MarketEvent, SignalCategory } from "../types";

import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
function uid(): string {
  return crypto.randomUUID();
}

interface ClusterAssignment {
  index: number;
  clusterId: string;
  category: SignalCategory;
  masterHeadline: string;
  summary: string;
}

const SIGNAL_CATEGORIES: SignalCategory[] = [
  "macro", "company", "market", "commodity", "geopolitics", "policy", "sentiment",
];

function sanitizeAssignment(item: unknown): ClusterAssignment | null {
  if (item === null || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  if (typeof a.clusterId !== "string" || typeof a.masterHeadline !== "string") return null;
  const index = Number(a.index);
  const category = typeof a.category === "string" ? a.category.toLowerCase() : "";
  return {
    index: Number.isFinite(index) ? index : -1,
    clusterId: a.clusterId,
    category: (SIGNAL_CATEGORIES as string[]).includes(category)
      ? (category as SignalCategory)
      : "company",
    masterHeadline: a.masterHeadline,
    summary: typeof a.summary === "string" ? a.summary : "",
  };
}

function buildDedupePrompt(items: NewsItem[]): string {
  const headlines = items
    .map((n, i) => `${i}: [${n.source}] ${n.headline}`)
    .join("\n");

  return `You are a financial news editor. Group these ${items.length} headlines into clusters where each cluster represents ONE real-world event or story.

HEADLINES:
${headlines}

Rules:
- Headlines about the same event (even from different sources) belong in the same cluster
- Use a short kebab-case cluster ID (e.g. "rbi-rate-cut", "nvidia-blackwell-launch")
- Assign each headline to exactly one cluster
- Category must be one of: macro, company, market, commodity, geopolitics, policy, sentiment
- masterHeadline: the clearest, most informative version of the story in one sentence
- summary: 1-2 sentence synthesis of what happened and why it matters to investors

${JSON_SCHEMA_LEAD_IN}
{
  "clusters": [
    {
      "index": 0,
      "clusterId": "rbi-rate-cut",
      "category": "macro",
      "masterHeadline": "RBI cuts repo rate by 25bps to 6.25% amid cooling inflation",
      "summary": "The Reserve Bank of India reduced its benchmark rate for the first time in two years, citing moderation in CPI. Lower rates reduce borrowing costs across the economy and pressure bank NIMs."
    }
  ]
}`;
}

function fallbackDedup(items: NewsItem[]): MarketEvent[] {
  const seen = new Set<string>();
  const events: MarketEvent[] = [];
  for (const item of items) {
    const key = item.headline.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: uid(),
      category: "company",
      headline: item.headline,
      summary: item.summary ?? item.headline,
      publishedAt: item.publishedAt,
      sources: [{ headline: item.headline, source: item.source, url: item.url, storyId: item.storyId ?? storyIdFor(item) }],
      affectedTickers: item.tickers,
      affectedSectors: [],
      affectedThemes: [],
      causalChain: [],
      sourceStoryIds: [item.storyId ?? storyIdFor(item)],
    });
  }
  return events;
}

/** Deduplicate and cluster raw news into MarketEvents. */
export async function deduplicateIntoEvents(
  items: NewsItem[],
  run?: ScanRunContext,
): Promise<MarketEvent[]> {
  if (items.length === 0) return [];

  // Cap at 20 items — local models time out on larger prompts
  const capped = items.slice(0, 20);

  // Timeout is handled centrally by the "opportunity-engine" task's
  // configured timeoutMs (lib/ai/task-registry.ts) — a local model
  // realistically needs minutes, not the 25s this used to race against,
  // which meant this stage fell back on nearly every run.
  let clusters: ClusterAssignment[];
  try {
    const raw = await scannerPrompt(run, "opportunity-engine", buildDedupePrompt(capped), {
      maxTokens: 1500,
      wire: ClustersWireSchema,
      stage: "dedupe",
    });
    const parsed = extractJsonObject(raw, { clusters: [] as unknown[] });
    clusters = parsed.clusters.map(sanitizeAssignment).filter((c): c is ClusterAssignment => c !== null);
  } catch (err) {
    if (run?.signal?.aborted) throw err;
    run?.degrade?.(`story clustering fell back to headline dedup: ${describeError(err)}`);
    return fallbackDedup(capped);
  }

  if (clusters.length === 0) {
    run?.degrade?.("story clustering returned no clusters; fell back to headline dedup");
    return fallbackDedup(capped);
  }

  // Group assignments by clusterId
  const clusterMap = new Map<
    string,
    {
      category: SignalCategory;
      masterHeadline: string;
      summary: string;
      indices: number[];
    }
  >();

  for (const assignment of clusters) {
    const existing = clusterMap.get(assignment.clusterId);
    if (existing) {
      existing.indices.push(assignment.index);
    } else {
      clusterMap.set(assignment.clusterId, {
        category: assignment.category,
        masterHeadline: assignment.masterHeadline,
        summary: assignment.summary,
        indices: [assignment.index],
      });
    }
  }

  // Build MarketEvents
  const events: MarketEvent[] = [];
  for (const [, cluster] of clusterMap) {
    const clusterItems = cluster.indices
      .filter((i) => i >= 0 && i < capped.length)
      .map((i) => capped[i]);

    if (clusterItems.length === 0) continue;

    // Use earliest publish time across cluster
    const publishedAt = clusterItems
      .map((i) => i.publishedAt)
      .sort()
      .at(0) ?? new Date().toISOString();

    // Collect all mentioned tickers across cluster
    const tickers = Array.from(
      new Set(clusterItems.flatMap((i) => i.tickers)),
    );

    events.push({
      id: uid(),
      category: cluster.category,
      headline: cluster.masterHeadline,
      summary: cluster.summary,
      publishedAt,
      sources: clusterItems.map((i) => ({
        headline: i.headline,
        source: i.source,
        url: i.url,
        storyId: i.storyId ?? storyIdFor(i),
      })),
      affectedTickers: tickers,
      affectedSectors: [],
      affectedThemes: [],
      causalChain: [],
      sourceStoryIds: clusterItems.map((i) => i.storyId ?? storyIdFor(i)),
    });
  }

  // Sort newest first
  events.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return events;
}
