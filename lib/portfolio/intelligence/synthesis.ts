/**
 * AI synthesis over the settled findings — the executive summary and the one
 * cross-finding observation.
 *
 * Follows lib/portfolio/thesis.ts to the letter: the model never detects,
 * ranks or re-characterizes anything. Every finding arrives with its severity
 * and figures already decided, the prompt forbids new claims, and the whole
 * response degrades to a deterministic summary assembled from the same
 * findings when the AI is unavailable. Cached in scanner_cache by a content
 * hash of the findings themselves, and a failure is never cached.
 */

import { runAnalysis } from "@/lib/ai/analysis";
import { LooseObjectSchema } from "@/lib/ai/schemas/loose";
import {
  PortfolioCriticWireSchema,
  PORTFOLIO_CRITIC_SCHEMA_VERSION,
} from "@/lib/ai/schemas/portfolio-critic";
import { getScannerCache, putScannerCache } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { AI_NARRATIVE_UNAVAILABLE, AI_RECOVERY_HINT } from "@/lib/ai/availability";
import type {
  IntelligenceCoverage,
  IntelligenceFinding,
  WhatChanged,
} from "./types";

export interface SynthesisStats {
  totalValue: number;
  holdingCount: number;
  healthTotal: number;
  healthGrade: string;
}

export interface SynthesisResult {
  executiveSummary: string;
  crossCurrents: string;
  source: "ai" | "fallback";
}

/** Deterministic djb2 hash — a cache key, not a security primitive. */
function hashOf(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Keyed on what the model actually reasons over: the findings (id + severity +
 * headline figure) — not the raw holdings. A price tick that changes no finding
 * must not burn an AI call; a threshold crossing that changes one must.
 */
export function synthesisContentHash(findings: IntelligenceFinding[]): string {
  const parts = findings.map((f) => `${f.id}:${f.severity}:${Math.round(f.weightPct ?? 0)}`).sort();
  return `portfolio-critic:${hashOf(parts.join("|"))}`;
}

/**
 * The fallback must still be USEFUL: the findings are already computed and
 * ranked, so an AI outage degrades the summary from "written" to "assembled",
 * never to an apology.
 */
export function fallbackSummary(findings: IntelligenceFinding[]): string {
  const top = findings.slice(0, 3);
  const lead = `${findings.length} ${findings.length === 1 ? "thing" : "things"} you may be missing. `;
  const bullets = top.map((f) => `${f.title}: ${f.headline}`).join(" ");
  return `${lead}${bullets} ${AI_NARRATIVE_UNAVAILABLE} ${AI_RECOVERY_HINT}`;
}

function severityTag(f: IntelligenceFinding): string {
  return f.severity.toUpperCase();
}

export function buildCriticPrompt(
  findings: IntelligenceFinding[],
  whatChanged: WhatChanged,
  stats: SynthesisStats,
  coverage: IntelligenceCoverage,
): string {
  const findingBlock = findings
    .map((f, i) => {
      const lines = [
        `${i + 1}. [${severityTag(f)}] ${f.title}`,
        `   Detected: ${f.headline}`,
        `   Why it matters: ${f.whyItMatters}`,
      ];
      if (f.blindSpot) lines.push(`   Possible blind spot: ${f.blindSpot}`);
      if (f.caveat) lines.push(`   Data caveat: ${f.caveat}`);
      return lines.join("\n");
    })
    .join("\n");

  const changes = whatChanged.changed
    ? [
        whatChanged.holdingsAdded.length > 0 ? `added ${whatChanged.holdingsAdded.join(", ")}` : "",
        whatChanged.holdingsRemoved.length > 0 ? `removed ${whatChanged.holdingsRemoved.join(", ")}` : "",
        whatChanged.resized.length > 0
          ? `resized ${whatChanged.resized.map((r) => `${r.label} ${r.fromPct.toFixed(1)}%→${r.toPct.toFixed(1)}%`).join(", ")}`
          : "",
        whatChanged.newFindings.length > 0 ? `new findings since then: ${whatChanged.newFindings.join("; ")}` : "",
        whatChanged.resolvedFindings.length > 0 ? `resolved since then: ${whatChanged.resolvedFindings.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(". ")
    : "Nothing has changed since the previous analysis.";

  const opaqueNote =
    coverage.fundsOpaque.length > 0
      ? `Constituent data was unavailable for ${coverage.fundsOpaque.join(", ")} — the look-through findings could not see inside them, so exposure through those funds is UNKNOWN, not zero.`
      : "All held funds had constituent data.";

  return `You are a sharp, unbiased portfolio critic reviewing a self-directed investor's portfolio from the outside. The system has already DETECTED and RANKED every finding below with its evidence — your job is only to write the executive answer to the question "what are you missing?".

RULES — these exist because breaking them produces output that contradicts the evidence displayed next to yours:

1. Use ONLY the findings below. Never introduce a security, figure, or claim that is not in them.
2. Never soften a HIGH finding or inflate a LOW one — the severity is settled.
3. Never re-derive or re-characterize a finding. Combine them; do not reinterpret them.
4. Speak directly to the investor ("you", "your portfolio"). Be direct, not cruel; specific, not generic.
5. Never give a buy/sell instruction. Frame everything as what to examine or reconsider — this is a challenge layer, not advice.
6. Behavioural observations must stay hedged exactly as the findings hedge them ("may indicate").
7. If a data caveat qualifies a figure you cite (e.g. a look-through lower bound), preserve the qualifier ("at least").

SETTLED FINDINGS (ranked by consequence; severities are final)
${findingBlock}

WHAT CHANGED SINCE THE PREVIOUS ANALYSIS
${changes}

PORTFOLIO
Total value: ${formatCurrency(stats.totalValue)} across ${stats.holdingCount} holdings. Health: ${stats.healthTotal}/100 (${stats.healthGrade}).
${opaqueNote}

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "executiveSummary": "3-5 sentences. Lead with the single most consequential finding and its figure. Weave in 2-4 findings total. End with the ONE question this portfolio most needs its owner to answer. Do not enumerate findings mechanically — synthesize them into what they mean together.",
  "crossCurrents": "ONE sentence: an observation that only becomes visible when two or more of the findings are combined — something no single finding says on its own. If no genuine cross-finding observation exists, return an empty string rather than manufacturing one."
}`;
}

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function synthesizeIntelligence(
  findings: IntelligenceFinding[],
  whatChanged: WhatChanged,
  stats: SynthesisStats,
  coverage: IntelligenceCoverage,
): Promise<SynthesisResult> {
  const cacheKey = `v1:${synthesisContentHash(findings)}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as SynthesisResult;
    } catch {
      // fall through and regenerate — a corrupted cache entry is not fatal
    }
  }

  const fallback: SynthesisResult = {
    executiveSummary: fallbackSummary(findings),
    crossCurrents: "",
    source: "fallback",
  };

  let result: SynthesisResult;
  try {
    const analysis = await runAnalysis({
      taskType: "portfolio-intelligence",
      subjectKey: `portfolio:critic:${synthesisContentHash(findings)}`,
      prompt: buildCriticPrompt(findings, whatChanged, stats, coverage),
      schema: LooseObjectSchema,
      wireSchema: PortfolioCriticWireSchema,
      schemaVersion: PORTFOLIO_CRITIC_SCHEMA_VERSION,
    });
    const parsed = analysis.data as Record<string, unknown>;
    const executiveSummary = cleanString(parsed.executiveSummary);
    result = executiveSummary
      ? {
          executiveSummary,
          // Deliberately NOT back-filled: "no cross-finding observation" is a
          // real and useful answer, and substituting a generic one would defeat
          // the instruction that produced the empty string.
          crossCurrents: cleanString(parsed.crossCurrents),
          source: "ai",
        }
      : fallback;
  } catch {
    result = fallback;
  }

  // Only cache a real AI result — caching the fallback would keep serving "AI
  // unavailable" for the TTL window even after the AI comes back up.
  if (result.source === "ai") putScannerCache(cacheKey, JSON.stringify(result));
  return result;
}
