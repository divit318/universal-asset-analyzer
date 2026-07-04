"use client";

import { useEffect, useState } from "react";
import type { FinancialStatements, FundamentalsSnapshot, ScoreResult } from "@/lib/types";

/**
 * US equivalent of India's AiSectionInsight — auto-generates a short "what
 * changed and why it matters" note for the Financials tab, backed by the
 * platform's own scoring engine (lib/ai-financial-insight.ts) instead of
 * screener.in fields. Only mounts when the Financials tab is active, so
 * "auto-generate" doesn't mean "on every page load."
 */
interface Props {
  symbol: string;
  snapshot: FundamentalsSnapshot;
  statements: FinancialStatements | null;
  score: ScoreResult;
}

export function FinancialInsightCard({ symbol, snapshot, statements, score }: Props) {
  const [insight, setInsight] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/financial-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, snapshot, statements, score }),
      });
      const json = await res.json() as { insight?: string; model?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
      setInsight(json.insight ?? null);
      setModel(json.model ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (insight) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent/70">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Insight — Financial Trend Interpretation
          </span>
          <button
            onClick={generate}
            disabled={loading}
            className="text-[10px] text-muted hover:text-foreground disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "↺ Refresh"}
          </button>
        </div>
        <p className="text-xs leading-6 text-muted">{insight}</p>
        {model && <span className="font-mono text-[9px] text-muted/40">{model}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <span className="text-xs text-muted/60">
        {loading ? "AI is interpreting the financial trend…" : "AI interpretation unavailable"}
      </span>
      {!loading ? (
        <button
          onClick={generate}
          className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-medium transition-colors hover:border-accent/40 hover:text-accent"
        >
          {error ? "Retry" : "Generate AI Insight"}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-accent/70">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          Analyzing…
        </span>
      )}
      {error && <p className="text-[10px] text-negative">{error}</p>}
    </div>
  );
}
