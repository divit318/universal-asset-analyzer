"use client";

import { useEffect, useRef, useState } from "react";
import type { InvestmentVerdict } from "@/app/api/ai/verdict/route";
import { GroundingBadge } from "@/app/_components/grounding-badge";

const VERDICT_COLORS = {
  bullish: {
    badge: "text-positive bg-positive/15 border-positive/30",
    border: "border-positive/20",
    bg: "bg-positive/5",
    dot: "bg-positive",
  },
  bearish: {
    badge: "text-negative bg-negative/15 border-negative/30",
    border: "border-negative/20",
    bg: "bg-negative/5",
    dot: "bg-negative",
  },
  neutral: {
    badge: "text-warning bg-warning/15 border-warning/30",
    border: "border-warning/20",
    bg: "bg-warning/5",
    dot: "bg-warning",
  },
};

const CONFIDENCE_COLOR = {
  high: "text-positive",
  medium: "text-warning",
  low: "text-negative",
};

const SIGNAL_COLOR = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted",
};

function VerdictSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-6 w-20 animate-pulse rounded-full bg-surface-2" />
        <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
        <div className="ml-auto h-4 w-16 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-4/6 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          {[70, 85, 60].map((w) => (
            <div key={w} className="h-2.5 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="space-y-1.5">
          {[80, 65, 75].map((w) => (
            <div key={w} className="h-2.5 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted animate-pulse">AI is analyzing {"—"} typically 20–40s on a local model…</p>
    </div>
  );
}

export function AIVerdictCard({ symbol }: { symbol: string }) {
  const [verdict, setVerdict] = useState<InvestmentVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedFor = useRef<string>("");

  useEffect(() => {
    if (!symbol || fetchedFor.current === symbol) return;
    fetchedFor.current = symbol;
    setLoading(true);
    setVerdict(null);
    setError(null);

    void fetch(`/api/ai/verdict?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const json = await r.json() as InvestmentVerdict & { error?: string };
        if (!r.ok || json.error) throw new Error(json.error ?? "Verdict failed");
        setVerdict(json);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "AI analysis failed"))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <VerdictSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">
        AI verdict unavailable: {error}
      </div>
    );
  }

  if (!verdict) return null;

  const colors = VERDICT_COLORS[verdict.verdict];

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-5`}>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest ${colors.badge}`}>
            {verdict.verdict}
          </span>
          <h2 className="font-semibold text-sm leading-snug">{verdict.headline}</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted">Confidence</span>
            <span className={`text-xs font-semibold ${CONFIDENCE_COLOR[verdict.confidence]}`}>
              {verdict.confidence}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted">Horizon</span>
            <span className="text-xs text-foreground">{verdict.timeHorizon}</span>
          </div>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            Local AI
          </span>
        </div>
      </div>

      {/* Thesis */}
      <p className="text-sm leading-6 text-foreground/90 mb-4">{verdict.thesis}</p>

      {/* Catalysts + Risks */}
      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-positive/80">Catalysts</p>
          <ul className="space-y-1.5">
            {verdict.catalysts.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive/60" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-negative/80">Risks</p>
          <ul className="space-y-1.5">
            {verdict.risks.map((r, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/60" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Key metrics pills */}
      {verdict.keyMetrics.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {verdict.keyMetrics.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1">
              <span className="text-[11px] text-muted">{m.label}</span>
              <span className={`font-mono text-[11px] font-semibold ${SIGNAL_COLOR[m.signal]}`}>{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Verified grounding: how many of the verdict's figures trace to data */}
      {verdict.grounding && (
        <div className="mt-3 border-t border-border pt-3">
          <GroundingBadge grounding={verdict.grounding} />
        </div>
      )}
    </div>
  );
}
