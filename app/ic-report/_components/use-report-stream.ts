"use client";

/**
 * IC Report — streaming state hook.
 *
 * Consumes the SSE stream and assembles a PARTIAL report as each stage
 * completes, so the page renders sections the moment their data exists
 * instead of watching an empty container for minutes (Phase 5.1). On mount
 * it asks the server for run status: an in-flight run is re-attached (the
 * server run survives tab close, Phase 7.4), otherwise the latest persisted
 * report is restored with its age.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ICReport, ICProgressEvent, ICReportStage } from "@/lib/ic-report";
import type { AgentFinding, AgentFailure } from "@/lib/ic-agents";
import type { DetectedSignal, SignalCheck } from "@/lib/ic-signals";
import type { InvestigativeQuestion } from "@/lib/ic-questions";
import type { SynthesisResult } from "@/lib/ic-synthesis";
import type { Thesis } from "@/lib/ic-thesis";
import type { ValuationSuiteResult, CaseReconciliation, PriorReconciliation } from "@/lib/ic-valuation";
import type { HistoryStats } from "@/lib/ic/history-stats";
import type { CanonicalFacts } from "@/lib/ic/canonical";

export interface PartialReport {
  facts?: CanonicalFacts;
  signalChecks?: SignalCheck[];
  signals?: DetectedSignal[];
  questions?: InvestigativeQuestion[];
  valuation?: ValuationSuiteResult;
  caseReconciliation?: CaseReconciliation | null;
  priorReconciliation?: PriorReconciliation | null;
  historyStats?: HistoryStats | null;
  agentFindings: AgentFinding[];
  agentFailures?: AgentFailure[];
  synthesis?: SynthesisResult | null;
  thesis?: Thesis;
}

export interface HistoryEntry {
  symbol: string;
  generatedAt: string;
  market: string;
  model: string;
}

export interface StreamState {
  running: boolean;
  stage: ICReportStage | null;
  events: ICProgressEvent[];
  partial: PartialReport;
  report: ICReport | null;
  error: string | null;
  history: HistoryEntry[];
  restoredFromCache: boolean;
}

const EMPTY_PARTIAL: PartialReport = { agentFindings: [] };

export function useReportStream() {
  const [state, setState] = useState<StreamState>({
    running: false,
    stage: null,
    events: [],
    partial: EMPTY_PARTIAL,
    report: null,
    error: null,
    history: [],
    restoredFromCache: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const applyEvent = useCallback((event: ICProgressEvent & { report?: ICReport }) => {
    setState((prev) => {
      const partial: PartialReport = { ...prev.partial };
      const d = event.data as Record<string, unknown> | undefined;
      switch (event.stage) {
        case "signals":
          if (d && "signalChecks" in d) {
            partial.signalChecks = d.signalChecks as SignalCheck[];
            partial.signals = d.signals as DetectedSignal[];
            partial.facts = d.facts as CanonicalFacts;
          }
          break;
        case "questions":
          if (Array.isArray(event.data)) partial.questions = event.data as InvestigativeQuestion[];
          break;
        case "valuation":
          if (d && "valuation" in d) {
            partial.valuation = d.valuation as ValuationSuiteResult;
            partial.caseReconciliation = d.caseReconciliation as CaseReconciliation | null;
            partial.priorReconciliation = d.priorReconciliation as PriorReconciliation | null;
          }
          if (d && "historyStats" in d) partial.historyStats = d.historyStats as HistoryStats;
          break;
        case "agent_complete":
          if (d && "agent" in d) partial.agentFindings = [...partial.agentFindings, event.data as AgentFinding];
          break;
        case "agents":
          if (d && "failures" in d) partial.agentFailures = d.failures as AgentFailure[];
          break;
        case "synthesis":
          if (d && "dedupedInsights" in d) partial.synthesis = event.data as SynthesisResult;
          break;
        case "thesis":
          if (d && "bull" in d) partial.thesis = event.data as Thesis;
          break;
        default:
          break;
      }

      return {
        ...prev,
        stage: event.stage === "agent_complete" ? prev.stage : event.stage,
        events: [...prev.events, event],
        partial,
        report: event.stage === "done" && event.report ? event.report : prev.report,
        error: event.stage === "error" ? event.message : prev.error,
        running: event.stage === "done" || event.stage === "error" ? false : prev.running,
        restoredFromCache: event.stage === "done" ? false : prev.restoredFromCache,
      };
    });
  }, []);

  /** Restore state for a symbol: reattach to an in-flight run or load history. */
  const restore = useCallback(async (symbol: string): Promise<"running" | "restored" | "none"> => {
    try {
      const res = await fetch(`/api/ic-report?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) return "none";
      const data = (await res.json()) as {
        inFlight: { status: string } | null;
        history: HistoryEntry[];
        report: ICReport | null;
      };
      if (data.inFlight?.status === "running") {
        setState((prev) => ({ ...prev, history: data.history }));
        void start(symbol); // re-attach: the server replays events
        return "running";
      }
      setState((prev) => ({
        ...prev,
        history: data.history,
        report: data.report ?? prev.report,
        restoredFromCache: data.report != null,
      }));
      return data.report ? "restored" : "none";
    } catch {
      return "none";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistoric = useCallback(async (symbol: string, generatedAt: string) => {
    const res = await fetch(`/api/ic-report?symbol=${encodeURIComponent(symbol)}&generatedAt=${encodeURIComponent(generatedAt)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { report: ICReport | null };
    if (data.report) {
      setState((prev) => ({ ...prev, report: data.report, restoredFromCache: true, error: null }));
    }
  }, []);

  const start = useCallback(async (symbol: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState((prev) => ({
      ...prev,
      running: true,
      stage: null,
      events: [],
      partial: EMPTY_PARTIAL,
      report: null,
      error: null,
      restoredFromCache: false,
    }));

    try {
      const res = await fetch("/api/ic-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            applyEvent(JSON.parse(chunk.slice(6)) as ICProgressEvent & { report?: ICReport });
          } catch {
            /* malformed SSE line */
          }
        }
      }
      // Refresh history after a completed run.
      void fetch(`/api/ic-report?symbol=${encodeURIComponent(symbol)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { history?: HistoryEntry[] } | null) => {
          if (d?.history) setState((prev) => ({ ...prev, history: d.history! }));
        });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setState((prev) => ({ ...prev, error: err.message }));
      }
    } finally {
      setState((prev) => ({ ...prev, running: false }));
    }
  }, [applyEvent]);

  /** Detach from the stream. The server-side run continues (Stop = stop watching). */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, running: false }));
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, stop, restore, loadHistoric };
}
