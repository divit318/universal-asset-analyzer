/**
 * IC Pipeline — Stage 6: Investment Committee Report
 *
 * Orchestrates the full pipeline and assembles the final IC report.
 * Exposes a streaming-friendly interface: callers can receive progress
 * events as each stage completes.
 */

import { detectAllSignals, type DetectedSignal, type SignalDetectionInput } from "./ic-signals";
import { generateQuestions, groupByAgent, type InvestigativeQuestion } from "./ic-questions";
import { runAgentNetwork, type AgentFinding } from "./ic-agents";
import { formThesis, type Thesis } from "./ic-thesis";
import { runValuationEngine, type ValuationResult } from "./ic-valuation";
import type { FundamentalsSnapshot, FinancialStatements, InsiderActivity, AnalystConsensus } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { getActiveModelName } from "./ai";

export type ICReportStage =
  | "signals"
  | "questions"
  | "agents"
  | "agent_complete"
  | "thesis"
  | "valuation"
  | "done"
  | "error";

export interface ICProgressEvent {
  stage: ICReportStage;
  message: string;
  data?: unknown;
}

export interface ICReport {
  symbol: string;
  companyName: string;
  generatedAt: string;
  model: string;
  signals: DetectedSignal[];
  questions: InvestigativeQuestion[];
  agentFindings: AgentFinding[];
  thesis: Thesis;
  valuation: ValuationResult;
  monitorables: string[];
}

export interface ICReportInput {
  symbol: string;
  companyName: string;
  currentPrice?: number | null;
  currency?: string;
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  analyst?: AnalystConsensus;
  insider?: InsiderActivity;
  screenerIn?: ScreenerInCompany | null;
}

export async function generateICReport(
  input: ICReportInput,
  onProgress?: (event: ICProgressEvent) => void,
): Promise<ICReport> {
  const emit = (stage: ICReportStage, message: string, data?: unknown) => {
    onProgress?.({ stage, message, data });
  };

  const { symbol, companyName } = input;

  // Stage 1: Signal detection
  emit("signals", "Detecting signals from financial data…");
  const signalInput: SignalDetectionInput = {
    snapshot: input.snapshot,
    statements: input.statements,
    insider: input.insider,
    epsSurprises: input.analyst?.epsSurprises,
    screenerIn: input.screenerIn,
  };
  const signals = detectAllSignals(signalInput);
  emit("signals", `Detected ${signals.length} signals`, signals);

  // Stage 2: Question generation
  emit("questions", "Generating investigative questions…");
  const questions = generateQuestions(signals, companyName, symbol);
  const questionsByAgent = groupByAgent(questions);
  emit("questions", `Generated ${questions.length} questions across ${questionsByAgent.size} agents`, questions);

  // Stage 3: Agent network
  emit("agents", `Dispatching ${questionsByAgent.size} agents in parallel…`);
  const agentFindings = await runAgentNetwork(
    {
      companyName,
      symbol,
      questionsByAgent,
      snapshot: input.snapshot,
      statements: input.statements,
      analyst: input.analyst,
      insider: input.insider,
      screenerIn: input.screenerIn,
      signals,
    },
    (finding) => {
      emit("agent_complete", `${finding.agentLabel} complete (${finding.confidence} confidence)`, finding);
    },
  );
  emit("agents", `All ${agentFindings.length} agents complete`);

  // Stage 4: Thesis formation
  emit("thesis", "Forming investment thesis…");
  const thesis = await formThesis(companyName, symbol, agentFindings, signals);
  emit("thesis", "Thesis formed", thesis);

  // Stage 5: Valuation engine
  emit("valuation", "Running valuation engine…");
  const valuation = await runValuationEngine(
    symbol,
    input.currentPrice ?? null,
    input.snapshot ?? ({} as FundamentalsSnapshot),
    input.statements ?? null,
    input.analyst ?? ({} as AnalystConsensus),
    input.screenerIn,
    input.currency ?? "$",
  );
  emit("valuation", `Valuation: ${valuation.intrinsicValueRange} (${valuation.impliedUpside})`, valuation);

  // Derive monitorables from thesis keyDrivers + high-severity signals
  const monitorables = [
    ...thesis.keyDrivers,
    ...signals
      .filter((s) => s.severity === "high")
      .map((s) => `Monitor: ${s.category.replace(/_/g, " ").toLowerCase()} — ${s.description}`),
  ].slice(0, 8);

  const report: ICReport = {
    symbol,
    companyName,
    generatedAt: new Date().toISOString(),
    model: getActiveModelName(),
    signals,
    questions,
    agentFindings,
    thesis,
    valuation,
    monitorables,
  };

  emit("done", "IC report complete", report);
  return report;
}
