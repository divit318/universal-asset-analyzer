"use client";

import { useEffect, useRef, useState } from "react";
import type { PortfolioBrief } from "@/app/api/ai/portfolio-brief/route";

export interface BriefContext {
  health: number;
  grade: string;
  actionCount: number;
  topSymbol?: string;
  topAction?: string;
}

function BriefSkeleton() {
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/4 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-4 w-36 animate-pulse rounded bg-accent/15" />
        <div className="h-4 w-16 animate-pulse rounded-full bg-accent/15 ml-auto" />
      </div>
      <div className="space-y-2 mb-4">
        {[92, 80, 68].map((w) => (
          <div key={w} className="h-3 animate-pulse rounded bg-accent/10" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-accent/10 bg-accent/5 p-3 space-y-2">
          <div className="h-2.5 w-20 animate-pulse rounded bg-accent/15" />
          <div className="h-3 w-full animate-pulse rounded bg-accent/10" />
        </div>
        <div className="rounded-lg border border-accent/10 bg-accent/5 p-3 space-y-2">
          <div className="h-2.5 w-20 animate-pulse rounded bg-accent/15" />
          <div className="h-3 w-full animate-pulse rounded bg-accent/10" />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted/60 animate-pulse">AI is analyzing your portfolio…</p>
    </div>
  );
}

export function AIPortfolioBrief({ context }: { context?: BriefContext }) {
  const [brief, setBrief] = useState<PortfolioBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    let url = "/api/ai/portfolio-brief";
    if (context) {
      const p = new URLSearchParams();
      p.set("h", String(context.health));
      p.set("g", context.grade);
      p.set("actions", String(context.actionCount));
      if (context.topSymbol) p.set("top", context.topSymbol);
      if (context.topAction) p.set("act", context.topAction);
      url += `?${p.toString()}`;
    }

    void fetch(url)
      .then(async (r) => {
        const json = await r.json() as PortfolioBrief & { error?: string };
        if (!r.ok) throw new Error(json.error ?? "Portfolio brief failed");
        setBrief(json);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "AI analysis failed"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <BriefSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">AI brief unavailable — start Ollama for daily portfolio intelligence.</p>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60 shrink-0">Local AI</span>
      </div>
    );
  }

  if (!brief) return null;

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/4 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-accent/70 mb-0.5">AI Portfolio Intelligence</p>
          <p className="font-semibold text-sm">{brief.headline}</p>
        </div>
        <span className="rounded-full border border-accent/25 bg-accent/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent shrink-0">
          Local AI
        </span>
      </div>

      {/* Narrative */}
      <p className="text-sm leading-6 text-foreground/85 mb-4">{brief.narrative}</p>

      {/* Opportunity + Risk */}
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <div className="rounded-lg border border-positive/20 bg-positive/5 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-positive/70 mb-1">Top opportunity</p>
          <p className="text-xs leading-5 text-foreground/80">{brief.topOpportunity}</p>
        </div>
        <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-negative/70 mb-1">Biggest risk</p>
          <p className="text-xs leading-5 text-foreground/80">{brief.biggestRisk}</p>
        </div>
      </div>

      {/* Action items */}
      {brief.actionItems.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Priority actions</p>
          <ul className="space-y-1.5">
            {brief.actionItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
