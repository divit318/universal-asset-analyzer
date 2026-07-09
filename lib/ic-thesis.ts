/**
 * IC Pipeline — Stage 4: Thesis Formation
 *
 * Aggregates all agent findings into structured Bull / Bear / Base theses,
 * variant perception, key catalysts, and key risks.
 */

import { runPrompt } from "./ai";
import { extractJson } from "./json-extract";
import type { AgentFinding } from "./ic-agents";
import type { DetectedSignal } from "./ic-signals";

export interface Thesis {
  bull: string;
  bear: string;
  base: string;
  variantPerception: string;
  marketExpectations: string;
  keyCatalysts: string[];
  keyRisks: string[];
  keyDrivers: string[];
}

function buildAgentSummary(findings: AgentFinding[]): string {
  return findings
    .map((f) => {
      const insights = f.keyInsights.length > 0 ? `\n  Key insights:\n  - ${f.keyInsights.join("\n  - ")}` : "";
      return `[${f.agentLabel}] (confidence: ${f.confidence})\n${f.findings}${insights}`;
    })
    .join("\n\n---\n\n");
}

function buildSignalSummary(signals: DetectedSignal[]): string {
  if (signals.length === 0) return "No material signals detected.";
  return signals
    .map((s) => `[${s.severity.toUpperCase()}] ${s.category}: ${s.description}`)
    .join("\n");
}

export async function formThesis(
  companyName: string,
  symbol: string,
  agentFindings: AgentFinding[],
  signals: DetectedSignal[],
  model?: string,
): Promise<Thesis> {
  const agentSummary = buildAgentSummary(agentFindings);
  const signalSummary = buildSignalSummary(signals);

  const prompt = `You are the head of an investment committee at a top-tier fund. You have received research from 9 specialist agents on ${companyName} (${symbol}). Your job is to synthesise this into a formal investment thesis.

DETECTED SIGNALS:
${signalSummary}

AGENT RESEARCH:
${agentSummary}

Synthesise all findings into a structured thesis. Return as JSON:
{
  "bull": "The bull case in 3-4 sentences. Assume the most optimistic reasonable scenario. Cite specific metrics and catalysts.",
  "bear": "The bear case in 3-4 sentences. What goes wrong, and why could the stock be worth materially less?",
  "base": "The base case — most probable outcome over 12-18 months. Balanced view that integrates the agent findings.",
  "variantPerception": "In 2-3 sentences: what does the market appear to be missing or mispricing? This is your edge.",
  "marketExpectations": "In 2 sentences: what growth, margin, and return assumptions does the current price appear to embed?",
  "keyCatalysts": ["3-5 specific events or milestones that could close the gap between price and value — include timeframes where possible"],
  "keyRisks": ["3-5 specific risks that could cause permanent capital loss, not just price volatility"],
  "keyDrivers": ["3-5 fundamental metrics or business outcomes that investors should monitor most closely going forward"]
}`;

  try {
    const raw = await runPrompt("investment-thesis", prompt, { maxTokens: 1500, json: true, model });
    return extractJson<Thesis>(raw);
  } catch {
    return {
      bull: "Thesis formation unavailable — AI response could not be parsed.",
      bear: "",
      base: "",
      variantPerception: "",
      marketExpectations: "",
      keyCatalysts: [],
      keyRisks: [],
      keyDrivers: [],
    };
  }
}
