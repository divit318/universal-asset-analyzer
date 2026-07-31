/**
 * IC Pipeline — Stage 6: Investment Committee Report
 *
 * Orchestrates the full pipeline and assembles the final IC report.
 * Exposes a streaming-friendly interface: callers can receive progress
 * events as each stage completes.
 */

import { detectAllSignals, type DetectedSignal, type SignalDetectionInput } from "./ic-signals";
import { generateQuestions, groupByAgent, type InvestigativeQuestion } from "./ic-questions";
import { runAgentNetwork, type AgentFinding, type AgentFailure } from "./ic-agents";
import { formThesis, type Thesis } from "./ic-thesis";
import {
  runValuationEngine,
  computeRunHotCold,
  reconcileValuations,
  type ReconciliationResult,
  type ValuationResult,
} from "./ic-valuation";
import { summarizeCase, type ValuationCase } from "./valuation/case";
import type { FundamentalsSnapshot, FinancialStatements, InsiderActivity, AnalystConsensus } from "./types";
import type { ScreenerInCompany } from "./screener-in";
import { pickModel } from "./ai/router";
import { getHistory } from "./yahoo";

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
  /** Agents that failed to produce a finding — the thesis below was formed without their input. */
  agentFailures: AgentFailure[];
  thesis: Thesis;
  valuation: ValuationResult;
  /** Case vs. the engine's systematic prior. Null when no prior was supplied. */
  reconciliation: ReconciliationResult | null;
  monitorables: string[];
  runHotCold: ReturnType<typeof computeRunHotCold>;
}

export interface ICReportInput {
  symbol: string;
  /**
   * The ValuationCase to adjudicate. Supplied by the API route, which owns the
   * database — this module stays free of persistence so the pipeline remains a
   * pure orchestration of domain logic.
   */
  valuationCase?: ValuationCase | null;
  /**
   * The quant engine's Monte Carlo median intrinsic value per share, when the
   * symbol was in the last scored universe. Reconciling the case against it is
   * the engine-vs-judgment half of the three-way bridge; null until the engine
   * read seam lands, at which point this stage starts reporting the spread with
   * no further change here.
   */
  enginePriorP50?: number | null;
  companyName: string;
  currentPrice?: number | null;
  currency?: string;
  snapshot?: FundamentalsSnapshot;
  statements?: FinancialStatements | null;
  analyst?: AnalystConsensus;
  insider?: InsiderActivity;
  screenerIn?: ScreenerInCompany | null;
  /** Optional user-picked model override. Omit to let the Router choose per task. */
  model?: string;
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

  // Stage 3: Agent network — dispatched one at a time; see runAgentNetwork's docstring.
  emit("agents", `Investigating with ${questionsByAgent.size} agents…`);
  const { findings: agentFindings, failures: agentFailures } = await runAgentNetwork(
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
      valuationCaseSummary: input.valuationCase ? summarizeCase(input.valuationCase) : null,
    },
    (finding) => {
      emit("agent_complete", `${finding.agentLabel} complete (${finding.confidence} confidence)`, finding);
    },
    input.model,
  );

  if (agentFindings.length === 0) {
    const modelLabel = input.model ?? (await pickModel("ic-agent-analysis")) ?? "the selected model";
    throw new Error(
      `All ${questionsByAgent.size} investigation agents failed to produce findings using ${modelLabel}. ` +
      `This usually means the model is too large/slow for this machine or Ollama became unresponsive. ` +
      `Try a smaller/faster model, or check \`ollama ps\` for load issues. ` +
      `First failure: ${agentFailures[0]?.agentLabel} — ${agentFailures[0]?.error}`,
    );
  }

  emit(
    "agents",
    agentFailures.length === 0
      ? `All ${agentFindings.length} agents complete`
      : `${agentFindings.length}/${questionsByAgent.size} agents complete — ${agentFailures.length} failed (${agentFailures.map((f) => f.agentLabel).join(", ")}); thesis below is missing their input`,
    { failures: agentFailures },
  );

  // Stage 4: Thesis formation
  emit("thesis", "Forming investment thesis…");
  const thesis = await formThesis(companyName, symbol, agentFindings, signals, input.model);
  emit("thesis", "Thesis formed", thesis);

  // Stage 5: Valuation engine — fetch 5Y price history for run hot/cold
  emit("valuation", input.valuationCase ? "Adjudicating the valuation case…" : "Running valuation cross-checks…");
  const priceHistory = await getHistory(symbol, 7300).catch(() => []); // up to 20 years ≈ 7300 days
  const runHotCold = computeRunHotCold(priceHistory);
  if (runHotCold) {
    emit("valuation", `Run Hot/Cold: ${runHotCold.signal} (${runHotCold.percentile}th percentile of own history)`);
  }
  const valuation = await runValuationEngine(
    symbol,
    input.currentPrice ?? null,
    input.snapshot ?? ({} as FundamentalsSnapshot),
    input.statements ?? null,
    input.analyst ?? ({} as AnalystConsensus),
    input.screenerIn,
    input.currency ?? "$",
    priceHistory,
    companyName,
    input.model,
    input.valuationCase ?? null,
  );
  emit("valuation", `Valuation: ${valuation.intrinsicValueRange} (${valuation.impliedUpside})`, valuation);

  // Reconcile the case against the engine's prior when one is available. These
  // are the two estimates worth comparing: one the user owns, one nothing human
  // touched.
  let reconciliation: ReconciliationResult | null = null;
  if (input.enginePriorP50 != null && input.valuationCase) {
    reconciliation = await reconcileValuations(
      symbol,
      input.valuationCase.result.fairValue,
      input.enginePriorP50,
      input.currency ?? "$",
      valuation.approaches.map((a) => a.method),
    );
    emit("valuation", reconciliation.explanation, reconciliation);
  }

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
    model: input.model ?? (await pickModel("ic-agent-analysis")) ?? "unavailable",
    signals,
    questions,
    agentFindings,
    agentFailures,
    thesis,
    valuation,
    reconciliation,
    monitorables,
    runHotCold,
  };

  emit("done", "IC report complete", report);
  return report;
}
