/**
 * IC Pipeline — Stage 4: Thesis Formation.
 *
 * Aggregates agent findings into structured Bull / Bear / Base theses,
 * variant perception, key catalysts and key risks.
 *
 * Phase 3.11: scenario narratives are generated FROM the computed valuation —
 * the deterministic engine's bear/base/bull values, reverse-DCF implied
 * growth and headline are handed to the model as ESTABLISHED CONCLUSIONS,
 * computed in code and not up for revision. The model's job is to explain
 * what world produces those numbers, not to invent its own.
 */

import { runAnalysis } from "./ai/analysis";
import { LooseObjectSchema } from "./ai/schemas/loose";
import { ThesisWireSchema, IC_SCHEMA_VERSION } from "./ai/schemas/ic";
import { extractJsonObject } from "./json-extract";
import type { AgentFinding } from "./ic-agents";
import type { DetectedSignal } from "./ic-signals";
import type { ValuationSuiteResult } from "./ic/valuation-suite";
import type { SynthesisResult } from "./ic-synthesis";
import { fmtMoney, fmtPercent } from "./ic/format";

export const THESIS_PROMPT_VERSION = "thesis-2";

export interface Thesis {
  bull: string;
  bear: string;
  base: string;
  variantPerception: string;
  marketExpectations: string;
  keyCatalysts: string[];
  keyRisks: string[];
  keyDrivers: string[];
  promptVersion?: string;
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

/**
 * Render the deterministic engine's outputs as settled facts for the prompt.
 * Every directional conclusion is computed in code and handed over as fact —
 * the model may not contradict a number rendered beside its narrative.
 */
export function buildEstablishedConclusions(v: ValuationSuiteResult): string {
  const c = v.currency;
  const lines: string[] = ["ESTABLISHED CONCLUSIONS (computed deterministically: do not contradict, do not restate different numbers):"];
  if (v.spot != null) lines.push(`- Spot price: ${fmtMoney(v.spot, c)}`);
  if (v.headline) {
    lines.push(`- Blended value estimate: ${fmtMoney(v.headline.perShare, c)}${v.headline.vsSpot != null ? ` (${fmtPercent(v.headline.vsSpot, { signed: true })} vs spot)` : ""}`);
  } else {
    lines.push(`- No headline value estimate: ${v.blockingViolations.length > 0 ? `valuation blocked (${v.blockingViolations[0]?.invariant})` : "insufficient method coverage"}`);
  }
  const sc = v.dcf.scenarios;
  if (sc) {
    lines.push(
      `- Scenario values (per share): bear ${fmtMoney(sc.bear.result.perShare, c)}, base ${fmtMoney(sc.base.result.perShare, c)}, bull ${fmtMoney(sc.bull.result.perShare, c)}`,
      `- Scenario growth paths (stage-1): bear ${fmtPercent(sc.bear.inputs.growthPath[0])}, base ${fmtPercent(sc.base.inputs.growthPath[0])}, bull ${fmtPercent(sc.bull.inputs.growthPath[0])}`,
    );
  }
  if (v.reverse?.impliedGrowth != null) {
    lines.push(`- Reverse DCF: today's price implies ${fmtPercent(v.reverse.impliedGrowth)} stage-1 FCF growth${v.reverse.impliedYearsAtBaseGrowth != null ? ` (or ~${v.reverse.impliedYearsAtBaseGrowth} years at the base rate)` : ""}`);
  }
  if (v.dcf.base) {
    lines.push(`- Terminal value carries ${fmtPercent(v.dcf.base.terminalShare)} of the DCF's enterprise value`);
  }
  return lines.join("\n");
}

/** Exported for unit testing — pure, no I/O. */
export function parseThesis(raw: string): Thesis {
  return parseThesisBag(
    extractJsonObject(raw, {
      bull: "Thesis formation unavailable: AI response could not be parsed.",
      bear: "",
      base: "",
      variantPerception: "",
      marketExpectations: "",
      keyCatalysts: [] as string[],
      keyRisks: [] as string[],
      keyDrivers: [] as string[],
    }),
  );
}

/** The bag-shaped half of {@link parseThesis} — what the analysis seam feeds. */
export function parseThesisBag(bag: Record<string, unknown>): Thesis {
  const str = (v: unknown, dflt = ""): string => (typeof v === "string" ? v : dflt);
  const parsed = {
    bull: str(bag.bull, "Thesis formation unavailable: AI response could not be parsed."),
    bear: str(bag.bear),
    base: str(bag.base),
    variantPerception: str(bag.variantPerception),
    marketExpectations: str(bag.marketExpectations),
    keyCatalysts: Array.isArray(bag.keyCatalysts) ? bag.keyCatalysts : [],
    keyRisks: Array.isArray(bag.keyRisks) ? bag.keyRisks : [],
    keyDrivers: Array.isArray(bag.keyDrivers) ? bag.keyDrivers : [],
  };
  return {
    ...parsed,
    keyCatalysts: parsed.keyCatalysts.filter((x): x is string => typeof x === "string"),
    keyRisks: parsed.keyRisks.filter((x): x is string => typeof x === "string"),
    keyDrivers: parsed.keyDrivers.filter((x): x is string => typeof x === "string"),
    promptVersion: THESIS_PROMPT_VERSION,
  };
}

const EMPTY_THESIS: Thesis = {
  bull: "Thesis formation unavailable: the model did not return a usable response.",
  bear: "",
  base: "",
  variantPerception: "",
  marketExpectations: "",
  keyCatalysts: [],
  keyRisks: [],
  keyDrivers: [],
  promptVersion: THESIS_PROMPT_VERSION,
};

export async function formThesis(
  companyName: string,
  symbol: string,
  agentFindings: AgentFinding[],
  signals: DetectedSignal[],
  valuation: ValuationSuiteResult,
  synthesis: SynthesisResult | null,
  model?: string,
): Promise<Thesis> {
  const agentSummary = buildAgentSummary(agentFindings);
  const signalSummary = buildSignalSummary(signals);
  const established = buildEstablishedConclusions(valuation);
  const disagreementBlock = synthesis && synthesis.disagreements.length > 0
    ? `\nAGENT DISAGREEMENTS (surface these, do not resolve them silently):\n${synthesis.disagreements.map((d) => `- ${d.topic}: ${d.positions.map((p) => `${p.agent}: ${p.position}`).join(" | ")}`).join("\n")}\n`
    : "";

  const prompt = `You are the head of an investment committee. You have received research from ${agentFindings.length} specialist agents on ${companyName} (${symbol}). Synthesise it into a formal investment thesis.

${established}

DETECTED SIGNALS:
${signalSummary}
${disagreementBlock}
AGENT RESEARCH:
${agentSummary}

Rules:
- The bull/bear/base narratives must be consistent with the ESTABLISHED CONCLUSIONS above. The bear narrative describes the world that produces the bear value; it may not describe upside. Never invent a price target or an upside figure — reference only the established numbers.
- Cite specific figures from the agent research; no unsourced numbers.
- If the established conclusions include a blocked valuation, say the value case is unproven rather than asserting one.

Reply with ONLY a raw JSON object:
{
  "bull": "The bull case in 3-4 sentences: the world in which the bull scenario value is earned. Cite specific metrics and catalysts.",
  "bear": "The bear case in 3-4 sentences: what goes wrong to produce the bear scenario value.",
  "base": "The base case: most probable outcome over 12-18 months, consistent with the base scenario value.",
  "variantPerception": "2-3 sentences: what the market appears to be missing or mispricing, grounded in the reverse-DCF gap between implied and delivered growth.",
  "marketExpectations": "2 sentences: what growth, margin and return assumptions the current price embeds: use the reverse DCF conclusion.",
  "keyCatalysts": ["3-5 specific events or milestones that could close the gap between price and value, with timeframes where possible"],
  "keyRisks": ["3-5 specific risks that could cause permanent capital loss, not just price volatility"],
  "keyDrivers": ["3-5 fundamental metrics investors should monitor most closely going forward"]
}`;

  // One retry: a long synthesis can truncate mid-JSON on the first attempt
  // (observed with qwen3.5:9b at 1500 tokens), and a single failed parse
  // should not cost the report its thesis.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const analysis = await runAnalysis({
        taskType: "investment-thesis",
        subjectKey: `ic:thesis:${symbol}`,
        prompt,
        schema: LooseObjectSchema,
        wireSchema: ThesisWireSchema,
        schemaVersion: IC_SCHEMA_VERSION,
        model,
      });
      const parsed = parseThesisBag(analysis.data as Record<string, unknown>);
      if (parsed.bull && !parsed.bull.startsWith("Thesis formation unavailable")) return parsed;
    } catch {
      /* fall through to retry */
    }
  }
  return EMPTY_THESIS;
}
