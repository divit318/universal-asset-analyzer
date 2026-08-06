"use client";

import { useEffect, useState } from "react";

interface AiInsightPanelProps {
  /** Shown in the header, e.g. "Cost Analysis", "Holdings Interpretation". */
  label: string;
  /** Re-fetches whenever this changes — typically `${symbol}:${section}`. */
  resetKey: string;
  /** Short phrase for the pre-generation prompt, e.g. "what does this cost mean?". */
  promptHint: string;
  fetchInsight: () => Promise<{ insight: string; model: string }>;
}

/**
 * Shared "AI Insight" card shell — loading/error/refresh UI, used by any
 * asset-class's per-tab AI insight (Fund, Crypto, ...). Originally written
 * once for India (app/research/india/_components/ai-section-insight.tsx,
 * left as-is — its props are shaped around ScreenerInCompany specifically,
 * not worth churning) then copy-pasted for Fund; extracted here on the third
 * copy (Crypto) rather than pasting a fourth time.
 */
export function AiInsightPanel({ label, resetKey, promptHint, fetchInsight }: AiInsightPanelProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Hard 10s deadline on the "Analyzing…" affordance — past it the container
  // unmounts rather than spinning forever. Generation continues in the
  // background; the card mounts whenever the insight actually lands.
  const [timedOut, setTimedOut] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInsight();
      setInsight(result.insight);
      setModel(result.model);
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
  }, [resetKey]);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (insight) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent/70">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Insight — {label}
          </span>
          <button onClick={generate} disabled={loading} className="text-[10px] text-muted hover:text-foreground disabled:opacity-40">
            {loading ? "Refreshing…" : "↺ Refresh"}
          </button>
        </div>
        <p className="text-xs leading-6 text-muted">{insight}</p>
        {model && <span className="font-mono text-[9px] text-muted/40">{model}</span>}
      </div>
    );
  }

  // Failed or past the deadline → no container. A dashed box stuck on
  // "Analyzing…" or an error strip reads as a broken page; absence doesn't.
  if (error || (loading && timedOut) || !loading) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <span className="text-xs text-muted/60">AI is interpreting this section — {promptHint}</span>
      <span className="flex items-center gap-1.5 text-xs text-accent/70">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        Analyzing…
      </span>
    </div>
  );
}
