/**
 * IC Pipeline — Stage 3.5: Synthesis pass (Phase 3.4/3.5).
 *
 * After the agent network: deduplicate repeated facts across agents (a fact
 * repeated by five agents is one fact, not five findings), surface explicit
 * cross-agent disagreements as first-class output (disagreement is signal),
 * and produce a short cross-agent summary of only the differentiated
 * findings.
 *
 * Deduplication is deterministic (token-overlap); disagreement detection and
 * the summary use one schema-validated LLM call and degrade gracefully to
 * the deterministic parts when the model is unavailable.
 */

import { runPrompt } from "./ai";
import { extractJsonObject } from "./json-extract";
import type { AgentFinding } from "./ic-agents";

export const SYNTHESIS_PROMPT_VERSION = "synth-1";

export interface DedupedInsight {
  insight: string;
  /** First agent to state it. */
  agent: string;
  /** Other agents that repeated substantially the same point. */
  alsoStatedBy: string[];
}

export interface Disagreement {
  topic: string;
  positions: { agent: string; position: string }[];
}

export interface SynthesisResult {
  dedupedInsights: DedupedInsight[];
  /** How many raw insights were folded into others. */
  duplicatesRemoved: number;
  disagreements: Disagreement[];
  crossAgentSummary: string;
  /** Agents that flagged data limitations, for the report-level disclosure banner. */
  dataGapAgents: { agent: string; limitation: string }[];
  promptVersion: string;
  modelUnavailable: boolean;
}

/* ── Deterministic dedup ────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "for", "with", "is",
  "are", "was", "be", "has", "have", "its", "this", "that", "at", "by", "as",
  "from", "it", "their", "which", "but", "not", "than", "over", "vs",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9%.$₹\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** Jaccard similarity over content tokens. Exported for tests. */
export function insightSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const DUP_THRESHOLD = 0.55;

/** Fold near-identical insights across agents into one, keeping attribution. */
export function dedupeInsights(findings: AgentFinding[]): { deduped: DedupedInsight[]; removed: number } {
  const deduped: DedupedInsight[] = [];
  let removed = 0;
  for (const f of findings) {
    for (const raw of f.keyInsights) {
      const existing = deduped.find((d) => insightSimilarity(d.insight, raw) >= DUP_THRESHOLD);
      if (existing) {
        if (existing.agent !== f.agentLabel && !existing.alsoStatedBy.includes(f.agentLabel)) {
          existing.alsoStatedBy.push(f.agentLabel);
        }
        removed++;
      } else {
        deduped.push({ insight: raw, agent: f.agentLabel, alsoStatedBy: [] });
      }
    }
  }
  return { deduped, removed };
}

/** Collect per-agent data-limitation flags for the disclosure banner (3.8). */
export function collectDataGaps(findings: AgentFinding[]): { agent: string; limitation: string }[] {
  return findings
    .filter((f) => f.dataLimitations && f.dataLimitations.trim() && f.dataLimitations.trim().toLowerCase() !== "null")
    .map((f) => ({ agent: f.agentLabel, limitation: f.dataLimitations!.trim() }));
}

/* ── LLM pass: disagreements + summary ──────────────────────────────────── */

export async function synthesiseFindings(
  companyName: string,
  symbol: string,
  findings: AgentFinding[],
  model?: string,
): Promise<SynthesisResult> {
  const { deduped, removed } = dedupeInsights(findings);
  const dataGapAgents = collectDataGaps(findings);

  const base: SynthesisResult = {
    dedupedInsights: deduped,
    duplicatesRemoved: removed,
    disagreements: [],
    crossAgentSummary: "",
    dataGapAgents,
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    modelUnavailable: false,
  };

  if (findings.length < 2) return { ...base, modelUnavailable: true };

  const perAgent = findings
    .map((f) => `[${f.agentLabel}] (confidence: ${f.confidence})\n${f.findings.slice(0, 900)}`)
    .join("\n\n---\n\n");

  const prompt = `You are the synthesis editor for an investment committee reviewing ${companyName} (${symbol}). Below are findings from ${findings.length} specialist agents, each of whom saw a different data slice.

Your two jobs:
1. DISAGREEMENTS: find places where two or more agents reach OPPOSING conclusions on the same underlying question (one reads a fact as strength, another as weakness; one says sustainable, another says not). Disagreement is signal — do not paper over it. Report none if there are none; do not invent any.
2. SUMMARY: 3-5 sentences of what the network established that a single analyst would have missed — only differentiated findings, no repetition of the obvious.

AGENT FINDINGS:
${perAgent}

Reply with ONLY a raw JSON object:
{
  "disagreements": [
    { "topic": "one line naming the disputed question", "positions": [ { "agent": "Agent label", "position": "their stance in one sentence" } ] }
  ],
  "crossAgentSummary": "3-5 sentences"
}`;

  try {
    const raw = await runPrompt("investment-thesis", prompt, { maxTokens: 800, json: true, model });
    const parsed = extractJsonObject(raw, {
      disagreements: [] as unknown[],
      crossAgentSummary: "",
    });
    const agentLabels = new Set(findings.map((f) => f.agentLabel));
    const disagreements = parsed.disagreements
      .map((d): Disagreement | null => {
        if (d === null || typeof d !== "object") return null;
        const o = d as Record<string, unknown>;
        if (typeof o.topic !== "string" || !Array.isArray(o.positions)) return null;
        const positions = o.positions
          .map((p): Disagreement["positions"][number] | null => {
            if (p === null || typeof p !== "object") return null;
            const q = p as Record<string, unknown>;
            if (typeof q.agent !== "string" || typeof q.position !== "string") return null;
            // A disagreement citing an agent that did not run is fabricated.
            if (!agentLabels.has(q.agent)) return null;
            return { agent: q.agent, position: q.position };
          })
          .filter((p): p is Disagreement["positions"][number] => p !== null);
        return positions.length >= 2 ? { topic: o.topic, positions } : null;
      })
      .filter((d): d is Disagreement => d !== null);

    return {
      ...base,
      disagreements,
      crossAgentSummary: typeof parsed.crossAgentSummary === "string" ? parsed.crossAgentSummary : "",
    };
  } catch {
    return { ...base, modelUnavailable: true };
  }
}
