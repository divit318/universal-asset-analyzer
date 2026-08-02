/**
 * IC Pipeline — Stage 6: Investment Committee Report.
 *
 * Orchestrates the full pipeline and assembles the final IC report from one
 * canonical, validated facts object (Phase 1). Streaming-friendly: callers
 * receive typed progress events with per-stage payloads as each stage
 * completes, so the UI can render progressively instead of waiting minutes
 * for `done`.
 *
 * Stage order: signals → questions → valuation (deterministic engine, one
 * small input-proposal model call) → agents → synthesis → thesis. Valuation
 * runs BEFORE the agents and the thesis so both receive the engine's
 * established conclusions instead of inventing their own numbers.
 */

import { buildCanonicalFacts, type CanonicalFacts, type CanonicalInput } from "./ic/canonical";
import { evaluateAllSignals, type DetectedSignal, type SignalCheck } from "./ic-signals";
import { generateQuestions, groupByAgent, AGENT_COUNT, type InvestigativeQuestion } from "./ic-questions";
import { runAgentNetwork, AGENT_PROMPT_VERSION, type AgentFinding, type AgentFailure } from "./ic-agents";
import { synthesiseFindings, SYNTHESIS_PROMPT_VERSION, type SynthesisResult } from "./ic-synthesis";
import { formThesis, buildEstablishedConclusions, THESIS_PROMPT_VERSION, type Thesis } from "./ic-thesis";
import {
  runValuationStage,
  type ValuationSuiteResult,
  type CaseReconciliation,
  type PriorReconciliation,
} from "./ic-valuation";
import { VALUATION_INPUT_PROMPT_VERSION } from "./ic/valuation-inputs";
import { computeHistoryStats, type HistoryStats } from "./ic/history-stats";
import { summarizeCase, type ValuationCase } from "./valuation/case";
import { pickModel } from "./ai/router";
import { getHistory } from "./yahoo";

export { AGENT_COUNT };

export type ICReportStage =
  | "signals"
  | "questions"
  | "valuation"
  | "agents"
  | "agent_complete"
  | "synthesis"
  | "thesis"
  | "done"
  | "error";

export interface ICProgressEvent {
  stage: ICReportStage;
  message: string;
  data?: unknown;
  at: string;
}

export interface Monitorable {
  label: string;
  kind: "driver" | "signal";
  /** What to watch for, when derivable. */
  trigger: string | null;
  source: string;
}

export interface StageTiming {
  stage: string;
  ms: number;
}

export interface ICReport {
  schemaVersion: 2;
  symbol: string;
  companyName: string;
  market: CanonicalFacts["market"];
  currency: string;
  generatedAt: string;
  model: string;
  promptVersions: Record<string, string>;
  facts: CanonicalFacts;
  signalChecks: SignalCheck[];
  signals: DetectedSignal[];
  questions: InvestigativeQuestion[];
  agentFindings: AgentFinding[];
  /** Agents that failed — the thesis was formed without their input. */
  agentFailures: AgentFailure[];
  synthesis: SynthesisResult | null;
  thesis: Thesis;
  valuation: ValuationSuiteResult;
  caseReconciliation: CaseReconciliation | null;
  priorReconciliation: PriorReconciliation | null;
  historyStats: HistoryStats | null;
  monitorables: Monitorable[];
  timings: StageTiming[];
}

export interface ICReportInput {
  symbol: string;
  /** Raw provider payloads — the pipeline canonicalises them itself. */
  canonical: CanonicalInput;
  /** Platform WACC with a component description (lib/valuation/prefill). */
  wacc: { value: number; components: string };
  /** The ValuationCase to reconcile against. Supplied by the API route. */
  valuationCase?: ValuationCase | null;
  /** The quant engine's Monte Carlo median, when available. */
  enginePriorP50?: number | null;
  /** Optional user-picked model override. Omit to let the Router choose per task. */
  model?: string;
  /** Skip all model calls (harness/deterministic mode). */
  skipModelCalls?: boolean;
}

export async function generateICReport(
  input: ICReportInput,
  onProgress?: (event: ICProgressEvent) => void,
): Promise<ICReport> {
  const emit = (stage: ICReportStage, message: string, data?: unknown) => {
    onProgress?.({ stage, message, data, at: new Date().toISOString() });
  };
  const timings: StageTiming[] = [];
  const timed = async <T>(stage: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    const v = await fn();
    timings.push({ stage, ms: Math.round(performance.now() - t0) });
    return v;
  };

  const { symbol } = input;

  /* Stage 0: canonicalise */
  const facts = buildCanonicalFacts(input.canonical);
  const companyName = facts.companyName;

  /* Stage 1: Signal detection — full pass/fail record */
  emit("signals", "Evaluating signal checks against financial data…");
  const signalChecks = await timed("signals", () => evaluateAllSignals({
    snapshot: input.canonical.snapshot ?? undefined,
    statements: input.canonical.statements,
    insider: input.canonical.insider ?? undefined,
    epsSurprises: input.canonical.analyst?.epsSurprises,
    screenerIn: input.canonical.screenerIn,
    currency: facts.currency,
    market: facts.market,
  }));
  const signals = signalChecks.map((c) => c.signal).filter((s): s is DetectedSignal => s !== null);
  emit("signals", `${signalChecks.length} checks evaluated, ${signals.length} fired`, { signalChecks, signals, facts });

  /* Stage 2: Question generation */
  emit("questions", "Generating investigative questions…");
  const questions = await timed("questions", () => generateQuestions(signals, companyName, symbol));
  const questionsByAgent = groupByAgent(questions);
  emit("questions", `${questions.length} questions across ${AGENT_COUNT} agents (${questions.filter((q) => q.kind === "signal").length} signal-derived, ${questions.filter((q) => q.kind === "baseline").length} baseline)`, questions);

  /* Stage 3: Valuation — deterministic engine with a model input proposal */
  emit("valuation", "Running the valuation engine…");
  const historyPromise = getHistory(symbol, 7300).catch(() => []);
  const { suite, caseReconciliation, priorReconciliation } = await timed("valuation", () =>
    runValuationStage({
      facts,
      wacc: input.wacc,
      vcase: input.valuationCase ?? null,
      enginePriorP50: input.enginePriorP50 ?? null,
      model: input.model,
      skipModelProposal: input.skipModelCalls,
    }),
  );
  emit(
    "valuation",
    suite.headline
      ? `Valuation complete: blended estimate with ${suite.methods.filter((m) => m.applicable).length} applicable methods`
      : suite.blockingViolations.length > 0
        ? `Valuation blocked: ${suite.blockingViolations[0].invariant}`
        : "Valuation complete: no headline (insufficient method coverage)",
    { valuation: suite, caseReconciliation, priorReconciliation },
  );

  const historyStats = computeHistoryStats(await historyPromise);
  if (historyStats?.verdict) {
    const v = historyStats.verdict;
    emit("valuation", `Run hot/cold (${v.windowYears}y window): ${v.signal.replace("_", " ")} at the ${v.percentile}th percentile of its own rolling history`, { historyStats });
  }

  /* Stage 4: Agent network */
  emit("agents", `Investigating with ${AGENT_COUNT} agents…`);
  const engineConclusions = buildEstablishedConclusions(suite);
  const { findings: agentFindings, failures: agentFailures } = input.skipModelCalls
    ? { findings: [] as AgentFinding[], failures: [] as AgentFailure[] }
    : await timed("agents", () => runAgentNetwork(
        {
          facts,
          questionsByAgent,
          screenerIn: input.canonical.screenerIn,
          signals,
          valuationCaseSummary: input.valuationCase ? summarizeCase(input.valuationCase) : null,
          engineConclusions,
        },
        (finding) => {
          emit("agent_complete", `${finding.agentLabel} complete (${finding.confidence} confidence)`, finding);
        },
        input.model,
      ));

  if (!input.skipModelCalls && agentFindings.length === 0) {
    const modelLabel = input.model ?? (await pickModel("ic-agent-analysis")) ?? "the selected model";
    throw new Error(
      `All ${AGENT_COUNT} investigation agents failed to produce findings using ${modelLabel}. ` +
      `This usually means the model is too large or slow for this machine, or Ollama became unresponsive. ` +
      `Try a smaller model, or check \`ollama ps\` for load issues. ` +
      `First failure: ${agentFailures[0]?.agentLabel}: ${agentFailures[0]?.error}`,
    );
  }

  emit(
    "agents",
    agentFailures.length === 0
      ? `All ${agentFindings.length} agents complete`
      : `${agentFindings.length}/${AGENT_COUNT} agents complete. ${agentFailures.length} failed (${agentFailures.map((f) => f.agentLabel).join(", ")}); the thesis below is missing their input`,
    { failures: agentFailures },
  );

  /* Stage 4.5: Synthesis — dedup, disagreements, cross-agent summary */
  emit("synthesis", "Synthesising the agent network's findings…");
  const synthesis = input.skipModelCalls || agentFindings.length === 0
    ? null
    : await timed("synthesis", () => synthesiseFindings(companyName, symbol, agentFindings, input.model));
  if (synthesis) {
    emit(
      "synthesis",
      `${synthesis.dedupedInsights.length} differentiated insights (${synthesis.duplicatesRemoved} duplicates folded), ${synthesis.disagreements.length} disagreement${synthesis.disagreements.length === 1 ? "" : "s"}`,
      synthesis,
    );
  }

  /* Stage 5: Thesis — generated FROM the computed valuation */
  emit("thesis", "Forming investment thesis…");
  const thesis = input.skipModelCalls
    ? {
        bull: "", bear: "", base: "", variantPerception: "", marketExpectations: "",
        keyCatalysts: [], keyRisks: [], keyDrivers: [], promptVersion: THESIS_PROMPT_VERSION,
      }
    : await timed("thesis", () => formThesis(companyName, symbol, agentFindings, signals, suite, synthesis, input.model));
  emit("thesis", "Thesis formed", thesis);

  /* Monitorables: structured watch items, deduplicated against signals */
  const monitorables: Monitorable[] = [
    ...thesis.keyDrivers.map((d): Monitorable => ({ label: d, kind: "driver", trigger: null, source: "thesis key driver" })),
    ...signals
      .filter((s) => s.severity === "high")
      .map((s): Monitorable => ({
        label: s.description,
        kind: "signal",
        trigger: `re-check ${s.category.replace(/_/g, " ").toLowerCase()} next quarter`,
        source: `signal ${s.category}`,
      })),
  ].slice(0, 8);

  const report: ICReport = {
    schemaVersion: 2,
    symbol,
    companyName,
    market: facts.market,
    currency: facts.currency,
    generatedAt: new Date().toISOString(),
    model: input.model ?? (input.skipModelCalls ? "none (deterministic run)" : (await pickModel("ic-agent-analysis")) ?? "unavailable"),
    promptVersions: {
      agents: AGENT_PROMPT_VERSION,
      thesis: THESIS_PROMPT_VERSION,
      synthesis: SYNTHESIS_PROMPT_VERSION,
      valuationInputs: VALUATION_INPUT_PROMPT_VERSION,
    },
    facts,
    signalChecks,
    signals,
    questions,
    agentFindings,
    agentFailures,
    synthesis,
    thesis,
    valuation: suite,
    caseReconciliation,
    priorReconciliation,
    historyStats,
    monitorables,
    timings,
  };

  emit("done", "IC report complete", report);
  return report;
}
