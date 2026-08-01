/**
 * Investment Knowledge Graph — AI narrative (v2).
 *
 * A short, sourced read of the current graph state. Not template filling:
 * the model receives the real nodes, edges, insights, and diff, and must
 * return observations that each cite the node ids they rest on. Any
 * observation citing a node that is not in the graph is DROPPED — if the
 * model cannot support a claim from the graph, the claim does not ship.
 */

import { runPromptWithMeta } from "../ai";
import { extractJsonObject } from "../json-extract";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import type { KnowledgeGraph, GraphNarrative, NarrativeObservation } from "./types";

/** Compact, token-bounded digest of the graph for the prompt. */
export function buildNarrativePrompt(graph: KnowledgeGraph): string {
  const nodeLines = graph.nodes
    .slice(0, 40)
    .map((n) => `- ${n.id} [${n.type}${n.instrument ? `/${n.instrument}` : ""}] ${n.fullLabel}${n.weight != null ? ` (${(n.weight * 100).toFixed(1)}% of book)` : ""}`)
    .join("\n");
  const edgeLines = graph.edges
    .slice(0, 60)
    .map((e) => `- ${e.source} -${e.type}-> ${e.target}: ${e.evidence.slice(0, 90)}`)
    .join("\n");
  const concentration = graph.insights.concentrationRisks
    .map((c) => `- ${c.sector}: ${c.symbols.join(", ")}${c.weight != null ? ` (${(c.weight * 100).toFixed(0)}% of book)` : ""}`)
    .join("\n");
  const changes = graph.changes
    ? [
        ...graph.changes.addedNodes.map((n) => `- NEW node: ${n.label} (${n.id})`),
        ...graph.changes.addedEdges.map((e) => `- NEW edge: ${e.sourceLabel} ${e.label} ${e.targetLabel}`),
        ...graph.changes.removedNodes.map((n) => `- REMOVED node: ${n.label}`),
      ]
        .slice(0, 15)
        .join("\n")
    : "(no previous snapshot to compare against)";

  return `You are an investment analyst reading a knowledge graph of a user's ${graph.scope} view ("${graph.id}"). Every fact you may use is listed below. Do not use outside knowledge about these companies; only restate and connect what the graph shows.

NODES:
${nodeLines}

EDGES:
${edgeLines}

SECTOR CONCENTRATION:
${concentration || "(none flagged)"}

CHANGES SINCE LAST SNAPSHOT:
${changes}

Write 2-4 short observations about what this graph shows: what changed, where risk or concentration sits, and what deserves a closer look. Each observation MUST cite the node ids (from the NODES list, e.g. "company:NVDA") that support it. If you cannot support an observation with specific nodes, do not write it. ${JSON_SCHEMA_LEAD_IN}
{
  "observations": [
    { "text": "<1-2 sentences>", "nodeIds": ["<node id>", "..."] }
  ]
}`;
}

const NARRATIVE_DEFAULTS: { observations: NarrativeObservation[] } = { observations: [] };

/**
 * Pure: parse and ENFORCE sourcing. Observations with no valid node citation
 * are dropped; cited ids not present in the graph are stripped.
 */
export function parseNarrativeResponse(raw: string, validNodeIds: Set<string>): NarrativeObservation[] {
  const parsed = extractJsonObject(raw, NARRATIVE_DEFAULTS);
  if (!Array.isArray(parsed.observations)) return [];
  return parsed.observations
    .filter((o): o is NarrativeObservation => o != null && typeof o.text === "string" && o.text.trim().length > 0)
    .map((o) => ({
      text: o.text.trim(),
      nodeIds: Array.isArray(o.nodeIds) ? o.nodeIds.filter((id) => typeof id === "string" && validNodeIds.has(id)) : [],
    }))
    .filter((o) => o.nodeIds.length > 0)
    .slice(0, 4);
}

/** Generate the narrative for a graph. Empty observations = the model had nothing supportable to say. */
export async function narrateGraph(graph: KnowledgeGraph): Promise<GraphNarrative> {
  const validIds = new Set(graph.nodes.map((n) => n.id));
  let observations: NarrativeObservation[] = [];
  let model: string | null = null;
  try {
    const { text, model: answeredBy } = await runPromptWithMeta("knowledge-graph-explain", buildNarrativePrompt(graph), {
      json: true,
    });
    model = answeredBy;
    observations = parseNarrativeResponse(text, validIds);
  } catch {
    observations = [];
  }
  return {
    observations,
    origin: "ai",
    model,
    generatedAt: new Date().toISOString(),
  };
}
