"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown } from "lucide-react";
import type { ChartQAReasoning, ChartQARelatedTarget, ChartQAResult } from "@/lib/ai-chart-qa";
import type { ChartQAContext, ChartQASelection } from "@/lib/types";
import { DRAWING_TOOL_LABEL } from "./drawing-categories";
import type { DrawingToolId } from "./types";
import type { AskAIPayload } from "../pattern-analysis-panel";

const OVERVIEW_QUESTIONS = [
  "Why is today's price action important?",
  "Explain the current trend.",
  "What technical signals matter most?",
];
const CANDLE_QUESTIONS = ["Explain this candle.", "Why did volume change today?", "Is this significant?"];
const PATTERN_QUESTIONS = ["How reliable is this pattern?", "Why did it form?", "What would invalidate it?"];
const DEFAULT_DRAWING_QUESTIONS = ["Review this drawing.", "What am I missing?", "Is this valid?"];
const DRAWING_QUESTIONS: Record<string, string[]> = {
  "trend-line": ["Review my trendline.", "Is this trendline valid?", "Where could this fail?"],
  "parallel-channel": ["Is this channel still holding?", "What would break this channel?", "Review this setup."],
  pitchfork: ["Is this median line meaningful?", "What would invalidate this pitchfork?", "Review this setup."],
  "fib-retracement": ["Is my Fibonacci anchored correctly?", "Is this retracement meaningful?", "What level matters most here?"],
  "fib-extension": ["Is my Fibonacci anchored correctly?", "Is this extension meaningful?", "What level matters most here?"],
  rectangle: ["Where is the strongest support?", "Is this zone still valid?", "What would break this level?"],
  "risk-reward": ["Is this risk/reward reasonable?", "What am I missing?", "Review this setup."],
};

function examplesFor(selection: ChartQASelection): string[] {
  switch (selection.kind) {
    case "drawing":
      return DRAWING_QUESTIONS[selection.drawing?.type ?? ""] ?? DEFAULT_DRAWING_QUESTIONS;
    case "pattern":
      return PATTERN_QUESTIONS;
    case "candle":
      return CANDLE_QUESTIONS;
    case "overview":
    default:
      return OVERVIEW_QUESTIONS;
  }
}

const REASONING_LABELS: [keyof ChartQAReasoning, string][] = [
  ["observation", "Observation"],
  ["interpretation", "Interpretation"],
  ["supportingEvidence", "Supporting Evidence"],
  ["bullCase", "Bull Case"],
  ["bearCase", "Bear Case"],
  ["invalidation", "Invalidation Conditions"],
];

export interface AIDockProps {
  /** Drives both the context-indicator label and the rotating placeholder examples. */
  selection: ChartQASelection;
  /** Lazy — invoked only on submit, so hovering/selecting never triggers the (more expensive) full context build. */
  buildContext: () => ChartQAContext;
  onNavigate: (target: ChartQARelatedTarget, payload?: AskAIPayload) => void;
  /** A one-time, dismissible suggestion after a brand-new drawing is created — never a popup, never repeats. */
  nudge?: { toolId: DrawingToolId } | null;
  onDismissNudge?: () => void;
}

/**
 * The Fullscreen workspace's single AI input — replaces what would otherwise
 * be separate Explain/Validate/Ask-AI buttons per drawing type. Context is
 * inferred entirely from `selection` (already tracked by chart-workspace.tsx
 * for the drawing/crosshair/pattern state); the user never states what
 * they're referring to. Deliberately no suggestion chips under the input —
 * only the rotating placeholder communicates example questions.
 */
export function AIDock({ selection, buildContext, onNavigate, nudge, onDismissNudge }: AIDockProps) {
  const [question, setQuestion] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChartQAResult | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const selectionKey = `${selection.kind}:${selection.drawing?.type ?? ""}`;
  const examples = useMemo(() => examplesFor(selection), [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps -- examplesFor is a pure function of selectionKey's own fields

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setPlaceholderIdx(0);
  }, [selectionKey]);

  useEffect(() => {
    if (question.length > 0 || examples.length <= 1) return;
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % examples.length), 3500);
    return () => clearInterval(id);
  }, [examples, question.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- only whether question is empty matters, not its exact text

  async function handleSubmit() {
    const q = question.trim();
    if (!q || loading) return;
    onDismissNudge?.(); // asking anything at all means the nudge has served its purpose
    setLoading(true);
    setResult(null);
    setReasoningOpen(false);
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 45_000); // matches the chart-qa task's own timeoutMs
    try {
      const context = buildContext();
      const res = await fetch("/api/ai/chart-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: context.symbol, question: q, context }),
        signal: ac.signal,
      });
      if (res.ok) {
        setResult((await res.json()) as ChartQAResult);
      } else {
        setResult({ answer: "Something went wrong reaching the analysis model. Please try again.", model: "unavailable" });
      }
    } catch {
      setResult({ answer: "Something went wrong reaching the analysis model. Please try again.", model: "unavailable" });
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  const nudgeQuestion = nudge ? (DRAWING_QUESTIONS[nudge.toolId] ?? DEFAULT_DRAWING_QUESTIONS)[0] : null;
  const nudgeLabel = nudge ? `Review ${(DRAWING_TOOL_LABEL[nudge.toolId] ?? "this drawing").toLowerCase()}` : null;

  function handleAcceptNudge() {
    if (!nudgeQuestion) return;
    setQuestion(nudgeQuestion);
    onDismissNudge?.();
  }

  const hasReasoning = result?.reasoning != null && Object.values(result.reasoning).some((v) => v);

  return (
    <div className="border-t border-border bg-surface px-3 py-2.5">
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-micro font-semibold uppercase tracking-wide text-faint">{selection.label}</span>
          {nudgeLabel && (
            <div className="flex animate-fade-rise items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-micro text-brand">
              <button onClick={handleAcceptNudge} className="font-medium hover:underline">
                {nudgeLabel}
              </button>
              <button onClick={onDismissNudge} aria-label="Dismiss suggestion" className="text-brand/60 transition-colors hover:text-brand">
                ×
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-control border border-border-strong bg-surface-2 px-3 py-2 transition-colors focus-within:border-brand">
          <Bot className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
          <div className="relative min-w-0 flex-1">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              disabled={loading}
              aria-label="Ask the AI about this chart"
              className="w-full bg-transparent text-sm text-foreground outline-none disabled:opacity-60"
            />
            {question.length === 0 && (
              <span
                key={placeholderIdx}
                className="pointer-events-none absolute inset-0 flex animate-fade-rise items-center text-sm text-faint"
              >
                {examples[placeholderIdx % examples.length]}
              </span>
            )}
          </div>
          {loading ? (
            <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-brand/50" title="Thinking…" />
          ) : (
            <kbd className="shrink-0 rounded border border-border-strong bg-surface-3 px-1.5 py-0.5 text-micro text-faint">↵</kbd>
          )}
        </div>

        {result && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs leading-relaxed text-foreground">{result.answer}</p>
              {result.confidence && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-micro font-medium uppercase tracking-wide ${
                    result.confidence === "high"
                      ? "bg-positive/15 text-positive"
                      : result.confidence === "low"
                        ? "bg-warning/15 text-warning"
                        : "bg-surface-3 text-muted"
                  }`}
                >
                  {result.confidence} confidence
                </span>
              )}
            </div>

            {result.relatedContext && result.relatedContext.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-micro font-semibold uppercase tracking-wide text-faint">Related</span>
                {result.relatedContext.map((rc, i) => (
                  <button
                    key={i}
                    onClick={() => onNavigate(rc.target, rc.target === "copilot" ? { question, label: rc.label } : undefined)}
                    title={rc.reason}
                    className="rounded-control border border-border px-2 py-0.5 text-micro font-medium text-muted transition-colors hover:border-brand hover:text-brand"
                  >
                    {rc.label}
                  </button>
                ))}
              </div>
            )}

            {hasReasoning && (
              <button
                onClick={() => setReasoningOpen((v) => !v)}
                className="flex items-center gap-1 self-start text-micro font-medium text-brand"
              >
                {reasoningOpen ? "Hide reasoning" : "Show reasoning"}
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${reasoningOpen ? "rotate-180" : ""}`} strokeWidth={2} />
              </button>
            )}

            {reasoningOpen && result.reasoning && (
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 sm:grid-cols-3">
                {REASONING_LABELS.map(([key, label]) => {
                  const value = result.reasoning?.[key];
                  if (!value) return null;
                  return (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-micro font-semibold uppercase tracking-wide text-faint">{label}</span>
                      <p className="text-xs leading-relaxed text-muted">{value}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
