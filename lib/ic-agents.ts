/**
 * IC Pipeline — Stage 3: Investigation Agent Network
 *
 * 9 specialized AI agents run in parallel, each answering the questions
 * assigned to their domain using the structured data available.
 * Each agent returns structured findings with a confidence level.
 */

import { runPrompt } from "./ai";
import { taskForAgentDomain } from "./ai/task-registry";
import { extractJson } from "./json-extract";
import { verifyGrounding, collectClaimText, type GroundingReport } from "./ai/grounding";
import type { InvestigativeQuestion, AgentDomain } from "./ic-questions";
import type { FundamentalsSnapshot, FinancialStatements, InsiderActivity, AnalystConsensus } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import type { DetectedSignal } from "./ic-signals";

export interface AgentFinding {
  agent: AgentDomain;
  agentLabel: string;
  questionsAnswered: number;
  findings: string;
  keyInsights: string[];
  confidence: "high" | "medium" | "low";
  dataLimitations: string | null;
  /** Verification that the agent's figures trace back to its data slice. */
  grounding?: GroundingReport;
}

/* -------------------------------------------------------------------------- */
/* Context builders — each agent gets the data slice relevant to it          */
/* -------------------------------------------------------------------------- */

interface AgentContext {
  companyName: string;
  symbol: string;
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  analyst?: AnalystConsensus;
  insider?: InsiderActivity;
  screenerIn?: ScreenerInCompany | null;
  signals: DetectedSignal[];
}

function formatNum(v: number | null | undefined, suffix = "", decimals = 1): string {
  if (v == null) return "n/a";
  return `${v.toFixed(decimals)}${suffix}`;
}

function buildDataContext(ctx: AgentContext, domains: AgentDomain[]): string {
  const parts: string[] = [];

  const s = ctx.snapshot;
  const st = ctx.statements;
  const a = ctx.analyst;
  const ins = ctx.insider;
  const si = ctx.screenerIn;

  if (domains.includes("business") || domains.includes("valuation")) {
    if (s) {
      parts.push(`VALUATION METRICS:
  Trailing P/E: ${formatNum(s.trailingPE, "x")}
  Forward P/E: ${formatNum(s.forwardPE, "x")}
  PEG: ${formatNum(s.pegRatio, "x", 2)}
  P/B: ${formatNum(s.priceToBook, "x")}
  Dividend yield: ${s.dividendYield != null ? formatNum(s.dividendYield * 100, "%") : "n/a"}

PROFITABILITY:
  ROE: ${s.returnOnEquity != null ? formatNum(s.returnOnEquity * 100, "%") : "n/a"}
  ROA: ${s.returnOnAssets != null ? formatNum(s.returnOnAssets * 100, "%") : "n/a"}
  Gross margin: ${s.grossMargins != null ? formatNum(s.grossMargins * 100, "%") : "n/a"}
  Operating margin: ${s.operatingMargins != null ? formatNum(s.operatingMargins * 100, "%") : "n/a"}
  Net margin: ${s.profitMargins != null ? formatNum(s.profitMargins * 100, "%") : "n/a"}

GROWTH:
  Revenue growth (YoY): ${s.revenueGrowth != null ? formatNum(s.revenueGrowth * 100, "%") : "n/a"}
  Earnings growth (YoY): ${s.earningsGrowth != null ? formatNum(s.earningsGrowth * 100, "%") : "n/a"}

BALANCE SHEET:
  D/E ratio: ${formatNum(s.debtToEquity, "x", 2)}
  Current ratio: ${formatNum(s.currentRatio, "x", 2)}
  Total debt: ${s.totalDebt != null ? `$${(s.totalDebt / 1e9).toFixed(1)}B` : "n/a"}
  Total cash: ${s.totalCash != null ? `$${(s.totalCash / 1e9).toFixed(1)}B` : "n/a"}
  EBITDA: ${s.ebitda != null ? `$${(s.ebitda / 1e9).toFixed(1)}B` : "n/a"}
  FCF: ${s.freeCashflow != null ? `$${(s.freeCashflow / 1e9).toFixed(1)}B` : "n/a"}`);
    }
  }

  if ((domains.includes("accounting") || domains.includes("capitalAllocation")) && st) {
    const rev = st.revenue.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
    const ni = st.netIncome.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
    const fcf = st.freeCashFlow.map((p) => `FY${p.fy}: $${(p.value / 1e9).toFixed(1)}B`).join(", ");
    const om = st.operatingMargin.map((p) => `FY${p.fy}: ${(p.value * 100).toFixed(1)}%`).join(", ");
    parts.push(`FINANCIAL STATEMENTS (EDGAR):
  Revenue: ${rev}
  Net income: ${ni}
  Free cash flow: ${fcf}
  Operating margin trend: ${om}
  Revenue CAGR: ${st.revenueCagr != null ? formatNum(st.revenueCagr * 100, "%") : "n/a"}
  FCF CAGR: ${st.fcfCagr != null ? formatNum(st.fcfCagr * 100, "%") : "n/a"}`);
  }

  if (domains.includes("management") || domains.includes("governance")) {
    if (a) {
      const total = a.strongBuy + a.buy + a.hold + a.sell + a.strongSell;
      parts.push(`ANALYST CONSENSUS (${a.numberOfOpinions ?? 0} analysts):
  Target: mean $${a.targetMean?.toFixed(0) ?? "n/a"} (low $${a.targetLow?.toFixed(0) ?? "n/a"} – high $${a.targetHigh?.toFixed(0) ?? "n/a"})
  Upside: ${a.upsidePercent != null ? `${a.upsidePercent >= 0 ? "+" : ""}${a.upsidePercent.toFixed(1)}%` : "n/a"}
  Distribution: ${total > 0 ? `SB:${a.strongBuy} B:${a.buy} H:${a.hold} S:${a.sell} SS:${a.strongSell}` : a.recommendationKey ?? "n/a"}
  EPS revisions (30d): ↑${a.epsRevisionsUp30d ?? 0} ↓${a.epsRevisionsDown30d ?? 0}
  EPS surprises (recent): ${a.epsSurprises.slice(0, 4).map((v) => `${(v * 100).toFixed(1)}%`).join(", ") || "none"}`);
    }
    if (ins) {
      parts.push(`INSIDER ACTIVITY: ${ins.buyCount} buys, ${ins.sellCount} sells, net ${ins.netValue >= 0 ? "+" : "-"}$${Math.abs(ins.netValue / 1e6).toFixed(0)}M
  Recent: ${ins.transactions.slice(0, 3).map((t) => `${t.name} ${t.type} ${t.shares ? (t.shares / 1000).toFixed(0) + "K shares" : ""}`).join("; ")}`);
    }
  }

  if (si) {
    parts.push(`SCREENER.IN (Indian market):
  Market cap: ₹${si.marketCap ?? "n/a"} Cr | Price: ₹${si.currentPrice ?? "n/a"}
  P/E: ${si.pe ?? "n/a"} | P/B: ${si.bookValue ? (((si.currentPrice ?? 0) / si.bookValue)).toFixed(1) + "x" : "n/a"}
  ROCE: ${si.roce ?? "n/a"}% | ROE: ${si.roe ?? "n/a"}%
  Debt: ₹${si.debt ?? "n/a"} Cr | Dividend yield: ${si.dividendYield ?? "n/a"}%
  52W: ₹${si.low52w ?? "n/a"} – ₹${si.high52w ?? "n/a"}
  Promoter holding: ${si.promoterHolding ?? "n/a"}%
  Shareholding: ${si.shareholding.map((s) => `${s.name}: ${s.values.at(-1)}%`).join(", ")}`);

    if (si.ratios.length > 0) {
      const keyRatios = si.ratios.slice(0, 6);
      parts.push(`KEY RATIOS (historical):
${keyRatios.map((r) => `  ${r.name}: ${r.values.slice(-3).map((v) => `${v.period} ${v.value}`).join(", ")}`).join("\n")}`);
    }

    if (si.peers.length > 0) {
      parts.push(`PEERS: ${si.peers.slice(0, 5).map((p) => `${p.name} (P/E ${p.pe ?? "n/a"}, ROCE ${p.roce ?? "n/a"}%)`).join("; ")}`);
    }
  }

  if (ctx.signals.length > 0) {
    parts.push(`DETECTED SIGNALS:
${ctx.signals.map((s) => `  [${s.severity.toUpperCase()}] ${s.category}: ${s.description}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Agent system prompts                                                       */
/* -------------------------------------------------------------------------- */

const AGENT_CONFIG: Record<AgentDomain, { label: string; persona: string }> = {
  business: {
    label: "Business Analyst",
    persona: "You are a business analyst specialising in understanding how companies make money. Focus on unit economics, revenue drivers, pricing power, customer concentration, and business model durability.",
  },
  industry: {
    label: "Industry Analyst",
    persona: "You are an industry analyst. Focus on sector growth rates, competitive dynamics, regulatory environment, technology disruption, and where the industry is in its lifecycle.",
  },
  competition: {
    label: "Competitive Intelligence Analyst",
    persona: "You are a competitive intelligence analyst. Focus on market share trends, competitive moats (or lack thereof), threat from new entrants, substitutes, and peer benchmarking.",
  },
  management: {
    label: "Management Quality Analyst",
    persona: "You are an analyst focused on management quality. Focus on track record of delivery vs. guidance, communication quality, strategic vision, skin in the game, and red flags in commentary.",
  },
  capitalAllocation: {
    label: "Capital Allocation Analyst",
    persona: "You are a capital allocation specialist. Assess whether management is deploying capital into high-ROIC opportunities. Evaluate M&A track record, buyback timing, dividend policy, and capex decisions.",
  },
  accounting: {
    label: "Forensic Accounting Analyst",
    persona: "You are a forensic accounting analyst. Focus on earnings quality, cash conversion, working capital trends, revenue recognition, off-balance-sheet items, and red flags in financial statement trends.",
  },
  valuation: {
    label: "Valuation Analyst",
    persona: "You are a valuation specialist. Work through intrinsic value estimates using the available data: DCF assumptions, relative multiples vs peers, and scenario analysis. Be explicit about assumptions and their sensitivity.",
  },
  governance: {
    label: "Governance & Ownership Analyst",
    persona: "You are a governance analyst. Focus on ownership structure, board quality, promoter/insider behaviour, related-party transactions, capital market conduct, and minority shareholder protection.",
  },
  risk: {
    label: "Risk Analyst",
    persona: "You are a risk specialist. Identify and size the key risks: macro, regulatory, competitive, execution, financial, and black swan. Focus on risks that could cause permanent capital loss.",
  },
};

/* -------------------------------------------------------------------------- */
/* Single agent runner                                                        */
/* -------------------------------------------------------------------------- */

async function runAgent(
  domain: AgentDomain,
  questions: InvestigativeQuestion[],
  ctx: AgentContext,
  model?: string,
): Promise<AgentFinding> {
  const config = AGENT_CONFIG[domain];
  const dataContext = buildDataContext(ctx, [domain]);

  const questionList = questions
    .slice(0, 6) // Cap per agent to control token usage
    .map((q, i) => `Q${i + 1}: ${q.question}`)
    .join("\n");

  const prompt = `${config.persona}

You are analysing ${ctx.companyName} (${ctx.symbol}). Use ONLY the structured data provided below to answer the questions. Do not make up facts. If data is insufficient to answer a question, say so explicitly.

DATA:
${dataContext}

QUESTIONS TO INVESTIGATE:
${questionList}

IMPORTANT: Reply with ONLY a raw JSON object. No markdown, no code fences, no explanation before or after. Start your reply with { and end with }.

{
  "findings": "2-4 paragraphs of integrated findings. Be specific — cite numbers. Write for a senior investment committee.",
  "keyInsights": ["3-5 bullet points — the most important actionable insights"],
  "confidence": "high|medium|low",
  "dataLimitations": "null or a sentence describing missing data"
}`;

  const raw = await runPrompt(taskForAgentDomain(domain), prompt, { maxTokens: 1200, json: true, model });

  // Extract JSON: find the first { ... last } block, tolerating preamble/fences
  const parsed = extractAgentJson(raw);

  // Verify the agent's prose against the exact data slice it was handed: every
  // figure in its findings/insights must trace to a number in `dataContext`.
  const grounding = verifyGrounding(
    collectClaimText([parsed.findings, parsed.keyInsights]),
    dataContext,
  );

  return {
    agent: domain,
    agentLabel: config.label,
    questionsAnswered: questions.length,
    findings: parsed.findings,
    keyInsights: parsed.keyInsights,
    confidence: parsed.confidence,
    dataLimitations: parsed.dataLimitations,
    grounding,
  };
}

/** Extract agent JSON from a raw LLM response, with multiple fallback strategies. */
function extractAgentJson(raw: string): {
  findings: string;
  keyInsights: string[];
  confidence: "high" | "medium" | "low";
  dataLimitations: string | null;
} {
  // Strategy 1: shared brace/fence extraction (lib/json-extract.ts)
  try {
    const parsed = extractJson<{
      findings?: string;
      keyInsights?: string[];
      confidence?: string;
      dataLimitations?: string | null;
    }>(raw);
    if (parsed.findings) {
      return {
        findings: parsed.findings,
        keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
        confidence: normaliseConfidence(parsed.confidence),
        dataLimitations: parsed.dataLimitations ?? null,
      };
    }
  } catch { /* fall through */ }

  // Strategy 2: extract prose text by aggressively stripping all JSON scaffolding
  const cleanText = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    // Remove trailing JSON fragments: anything from ", "keyInsights": [ onwards
    .replace(/",?\s*"keyInsights"\s*:\s*\[[\s\S]*$/m, "")
    .replace(/",?\s*"confidence"\s*:\s*"[^"]*"[\s\S]*$/m, "")
    .replace(/",?\s*"dataLimitations"\s*:[\s\S]*$/m, "")
    // Remove leading JSON open and "findings": "
    .replace(/^\s*\{[\s\S]*?"findings"\s*:\s*"/m, "")
    // Strip surrounding quotes left after removal
    .replace(/^"|"$/g, "")
    // Unescape JSON string escapes
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();

  return {
    findings: cleanText || "Insufficient data for analysis.",
    keyInsights: [],
    confidence: "low",
    dataLimitations: "AI response format could not be fully parsed.",
  };
}

function normaliseConfidence(v?: string): "high" | "medium" | "low" {
  if (!v) return "low";
  const s = v.toLowerCase();
  if (s.includes("high")) return "high";
  if (s.includes("med")) return "medium";
  return "low";
}

/* -------------------------------------------------------------------------- */
/* Public: run all agents in parallel                                        */
/* -------------------------------------------------------------------------- */

export interface AgentNetworkInput {
  companyName: string;
  symbol: string;
  questionsByAgent: Map<AgentDomain, InvestigativeQuestion[]>;
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  analyst?: AnalystConsensus;
  insider?: InsiderActivity;
  screenerIn?: ScreenerInCompany | null;
  signals: DetectedSignal[];
}

export interface AgentFailure {
  agent: AgentDomain;
  agentLabel: string;
  error: string;
}

export interface AgentNetworkResult {
  findings: AgentFinding[];
  failures: AgentFailure[];
}

/**
 * Run every investigation agent, one at a time. Ollama's default local setup
 * serves one request at a time regardless of how many we fire (n_slots = 1) —
 * dispatching all of them concurrently doesn't parallelize anything, it just
 * queues them, and a fixed per-request timeout then races against however
 * many agents happen to be ahead of it in that queue rather than against its
 * own generation time. Later agents lost that race and silently timed out
 * every run. Sequential dispatch makes each agent's timeout budget meaningful
 * (it only has to cover its own generation) and gives steady, honest progress
 * instead of a burst of near-simultaneous failures.
 */
export async function runAgentNetwork(
  input: AgentNetworkInput,
  onAgentComplete?: (finding: AgentFinding) => void,
  model?: string,
): Promise<AgentNetworkResult> {
  const ctx: AgentContext = {
    companyName: input.companyName,
    symbol: input.symbol,
    snapshot: input.snapshot,
    statements: input.statements,
    analyst: input.analyst,
    insider: input.insider,
    screenerIn: input.screenerIn,
    signals: input.signals,
  };

  const entries = [...input.questionsByAgent.entries()];
  const findings: AgentFinding[] = [];
  const failures: AgentFailure[] = [];

  for (const [domain, questions] of entries) {
    try {
      const finding = await runAgent(domain, questions, ctx, model);
      findings.push(finding);
      onAgentComplete?.(finding);
    } catch (err) {
      failures.push({
        agent: domain,
        agentLabel: AGENT_CONFIG[domain].label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { findings, failures };
}
